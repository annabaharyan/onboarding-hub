import { and, asc, eq, inArray, lte, or, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import {
  checklistTemplates,
  employeeChanges,
  employees,
  onboardingRequests,
  requestChecklistItems,
  requestEvents,
  type OnboardingRequest,
  type RequestCorrections,
  type RequestStage,
} from "@/db/schema";
import { EmployeeWriter } from "../employee-writer";
import { getJiraClient, jiraMode, jiraStatusNames } from "../integrations/jira-client";
import { ALLOWED, STAGE_META, collectionLeadDays, fieldLabel, requiredFields, type RequestFieldKey, REQUEST_FIELDS } from "./stages";

/**
 * The onboarding process engine. Every stage change goes through transition(), which checks the
 * allowed moves, records the timeline and keeps the Jira ticket status in step:
 *   new (Open) → pre_onboarding (Work in progress) → collecting → needs_info / ready_for_review
 *   → approved → first_day → completed (Done)
 */

export class FlowError extends Error {}

type Actor = string;
const SYSTEM: Actor = "system";

/** Today's date in the team's timezone (YYYY-MM-DD). */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE || process.env.CRON_TIMEZONE || "Asia/Yerevan" }).format(new Date());
}

const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Effective value = the team's correction if there is one; otherwise the approved value while a
 * Jira change is waiting for review; otherwise what Jira says.
 */
export function effective(r: OnboardingRequest): Record<RequestFieldKey, string | null> {
  const c = r.corrections ?? {};
  const pending = r.pendingChanges ?? {};
  const out = {} as Record<RequestFieldKey, string | null>;
  for (const f of REQUEST_FIELDS) {
    if (f.key in c) out[f.key] = c[f.key] ?? null;
    else if (pending[f.key]) out[f.key] = pending[f.key].from;
    else out[f.key] = (r[f.key] as string | null) ?? null;
  }
  return out;
}

export function missingFor(r: OnboardingRequest): RequestFieldKey[] {
  const v = effective(r);
  return requiredFields().filter((k) => !v[k]);
}

/** Suggested collection start: start date minus the lead time, never in the past. */
export function suggestCollectionDate(startDate: string | null): string | null {
  if (!startDate) return null;
  const d = addDays(startDate, -collectionLeadDays());
  const t = today();
  return d < t ? t : d;
}

export async function getRequest(id: number) {
  const [r] = await getDb().select().from(onboardingRequests).where(eq(onboardingRequests.id, id));
  if (!r) throw new FlowError("Request not found");
  return r;
}

export async function logEvent(requestId: number, e: { type: string; message?: string; actor?: Actor; fromStage?: RequestStage; toStage?: RequestStage }) {
  await getDb().insert(requestEvents).values({ requestId, type: e.type, message: e.message ?? null, actor: e.actor ?? SYSTEM, fromStage: e.fromStage, toStage: e.toStage });
}

const STAGE_TIMESTAMP: Partial<Record<RequestStage, keyof OnboardingRequest>> = {
  pre_onboarding: "contactedAt",
  approved: "approvedAt",
  first_day: "firstDayAt",
  completed: "completedAt",
  cancelled: "cancelledAt",
};

/** The Jira status a stage should leave the ticket in, or null to leave it as is. */
function jiraTargetFor(stage: RequestStage): string | null {
  const names = jiraStatusNames();
  const t = STAGE_META[stage].jira;
  if (t === "open") return null; // tickets arrive Open — never move them back automatically
  if (t === "inProgress") return names.inProgress;
  if (t === "done") return names.done;
  return stage === "cancelled" && names.cancelled ? names.cancelled : null;
}

/** Moves the Jira ticket to match the stage. Failures are recorded on the request, not thrown. */
export async function pushJiraStatus(r: OnboardingRequest, actor: Actor = SYSTEM): Promise<string | null> {
  const target = jiraTargetFor(r.stage);
  if (!target || (r.jiraStatus ?? "").toLowerCase() === target.toLowerCase()) {
    if (r.jiraError) await getDb().update(onboardingRequests).set({ jiraError: null }).where(eq(onboardingRequests.id, r.id));
    return null;
  }
  try {
    await getJiraClient().transition(r.jiraKey, target);
    await getDb().update(onboardingRequests).set({ jiraStatus: target, jiraError: null }).where(eq(onboardingRequests.id, r.id));
    await logEvent(r.id, { type: "jira", message: `Jira ticket moved to "${target}"`, actor });
    return null;
  } catch (e) {
    const msg = `Could not move the Jira ticket to "${target}": ${(e as Error).message}`;
    await getDb().update(onboardingRequests).set({ jiraError: msg }).where(eq(onboardingRequests.id, r.id));
    await logEvent(r.id, { type: "jira", message: msg, actor });
    return msg;
  }
}

/** The single place where a request changes stage. */
export async function transition(id: number, to: RequestStage, opts: { actor?: Actor; message?: string; patch?: Partial<typeof onboardingRequests.$inferInsert> } = {}) {
  const db = getDb();
  const r = await getRequest(id);
  if (r.stage === to) return r;
  if (!ALLOWED[r.stage].includes(to)) throw new FlowError(`Can't move from "${STAGE_META[r.stage].label}" to "${STAGE_META[to].label}".`);
  const now = new Date();
  const set: Partial<typeof onboardingRequests.$inferInsert> = { ...opts.patch, stage: to, stageChangedAt: now, updatedAt: now };
  const ts = STAGE_TIMESTAMP[to];
  if (ts) (set as Record<string, unknown>)[ts] = now;
  if (to === "new") Object.assign(set, { cancelledAt: null, cancelReason: null });
  const [updated] = await db.update(onboardingRequests).set(set).where(eq(onboardingRequests.id, id)).returning();
  await logEvent(id, { type: "stage", fromStage: r.stage, toStage: to, message: opts.message, actor: opts.actor });
  await pushJiraStatus(updated, opts.actor);
  return getRequest(id);
}

// ─── Collecting: checks and requester comments ────────────────────────────────

/**
 * Re-evaluates a request that is collecting information: missing required fields send it to
 * "Needs info" (and comment on Jira once per set of missing fields); a complete request goes to
 * "Ready for review". Warnings from Claude are shown but never block.
 */
export async function settle(id: number, actor: Actor = SYSTEM) {
  let r = await getRequest(id);
  if (!["collecting", "needs_info", "ready_for_review"].includes(r.stage)) return r;
  const missing = missingFor(r);
  if (missing.length) {
    if (r.stage !== "needs_info") r = await transition(id, "needs_info", { actor, message: `Missing: ${missing.map(fieldLabel).join(", ")}` });
    await commentMissing(r, missing, actor);
  } else if (r.stage !== "ready_for_review") {
    r = await transition(id, "ready_for_review", { actor, message: "All required information is present" });
  }
  return r;
}

/** Always on in demo mode (comments only go to dummy tickets); in live mode JIRA_COMMENT_ON_MISSING=false turns them off. */
const commentsEnabled = () => jiraMode() === "mock" || process.env.JIRA_COMMENT_ON_MISSING !== "false";

async function commentMissing(r: OnboardingRequest, missing: RequestFieldKey[], actor: Actor) {
  if (!commentsEnabled()) return;
  const key = [...missing].sort().join(",");
  if (r.lastCommentKey === key) return;
  const lines = missing.map((m) => `${fieldLabel(m)} is missing`);
  try {
    await getJiraClient().comment(r.jiraKey, "Onboarding Hub: to prepare this new hire's onboarding, please add the following to the ticket:", lines);
    await getDb().update(onboardingRequests).set({ lastCommentKey: key, commentedAt: new Date(), jiraError: null }).where(eq(onboardingRequests.id, r.id));
    await logEvent(r.id, { type: "jira", message: `Asked the requester for: ${missing.map(fieldLabel).join(", ")}`, actor });
  } catch (e) {
    const msg = `Could not comment on the Jira ticket: ${(e as Error).message}`;
    await getDb().update(onboardingRequests).set({ jiraError: msg }).where(eq(onboardingRequests.id, r.id));
    await logEvent(r.id, { type: "jira", message: msg, actor });
  }
}

/** Posts a free-text question from the team to the requester. */
export async function askRequester(id: number, message: string, actor: Actor) {
  const r = await getRequest(id);
  const text = message.trim();
  if (!text) throw new FlowError("Write a message first.");
  await getJiraClient().comment(r.jiraKey, "Onboarding Hub: a question about this onboarding request:", [text]);
  await getDb().update(onboardingRequests).set({ commentedAt: new Date() }).where(eq(onboardingRequests.id, id));
  await logEvent(id, { type: "jira", message: `Comment posted: ${text}`, actor });
}

// ─── Team actions ────────────────────────────────────────────────────────────

export async function markContacted(id: number, actor: Actor) {
  const r = await getRequest(id);
  const start = effective(r).startDate;
  const collectionDate = r.collectionDateOverridden ? r.collectionDate : suggestCollectionDate(start);
  await transition(id, "pre_onboarding", { actor, message: "Employee contacted", patch: { collectionDate } });
  return advance(id, actor);
}

export async function startCollecting(id: number, actor: Actor) {
  await transition(id, "collecting", { actor, message: "Collection started early", patch: { collectionDate: today(), collectionDateOverridden: true } });
  return settle(id, actor);
}

export async function setCollectionDate(id: number, date: string | null, actor: Actor) {
  const r = await getRequest(id);
  if (!["new", "pre_onboarding"].includes(r.stage)) throw new FlowError("The collection date can only be changed before collection starts.");
  const value = date ?? suggestCollectionDate(effective(r).startDate);
  await getDb().update(onboardingRequests).set({ collectionDate: value, collectionDateOverridden: Boolean(date), updatedAt: new Date() }).where(eq(onboardingRequests.id, id));
  await logEvent(id, { type: "note", message: date ? `Collection date set to ${date}` : `Collection date reset to the suggestion (${value ?? "no start date yet"})`, actor });
  return advance(id, actor);
}

/** Saves the team's corrections. A blank field means "use the Jira value". */
export async function saveCorrections(id: number, input: RequestCorrections, actor: Actor) {
  const r = await getRequest(id);
  if (["completed", "cancelled"].includes(r.stage)) throw new FlowError("This request is closed.");
  const next: RequestCorrections = {};
  const changes: string[] = [];
  for (const f of REQUEST_FIELDS) {
    const value = input[f.key] ?? null;
    const jiraValue = (r[f.key] as string | null) ?? null;
    if (value !== null && value !== jiraValue) next[f.key] = value;
    const before = f.key in r.corrections ? r.corrections[f.key] : undefined;
    if ((before ?? null) !== (next[f.key] ?? null)) changes.push(`${f.label}: ${next[f.key] ?? `back to Jira value (${jiraValue ?? "empty"})`}`);
  }
  if (!changes.length) return { request: r, changed: 0 };
  const patch: Partial<typeof onboardingRequests.$inferInsert> = { corrections: next, updatedAt: new Date() };
  const merged = { ...r, corrections: next };
  if (["new", "pre_onboarding"].includes(r.stage) && !r.collectionDateOverridden) patch.collectionDate = suggestCollectionDate(effective(merged).startDate);
  await getDb().update(onboardingRequests).set(patch).where(eq(onboardingRequests.id, id));
  await logEvent(id, { type: "correction", message: changes.join("; "), actor });
  if (r.employeeId && ["approved", "first_day"].includes(r.stage)) await updateEmployeeFromRequest(id, actor);
  await advance(id, actor);
  return { request: await getRequest(id), changed: changes.length };
}

export async function approve(id: number, actor: Actor) {
  const r = await getRequest(id);
  if (r.stage !== "ready_for_review") {
    const missing = missingFor(r);
    throw new FlowError(missing.length ? `Still missing: ${missing.map(fieldLabel).join(", ")}.` : "Only requests that are ready for review can be approved.");
  }
  const v = effective(r);
  const starting = v.startDate && v.startDate <= today();
  const writer = await EmployeeWriter.create();
  const res = await writer.apply(
    { ...v, jiraKey: r.jiraKey, status: starting ? "onboarding" : "pre_onboarding" },
    { source: "jira", changedBy: actor },
  );
  if (!res.employeeId || res.employeeId < 0) throw new FlowError(`Could not create the employee: ${res.issues.join("; ") || res.result}`);
  await getDb().update(onboardingRequests).set({ employeeId: res.employeeId }).where(eq(onboardingRequests.id, id));
  await createChecklist(id);
  await transition(id, "approved", {
    actor,
    message: res.result === "created" ? "Employee record created" : `Linked to existing employee record${res.issues.length ? ` (${res.issues.join("; ")})` : ""}`,
  });
  return advance(id, actor);
}

export async function startFirstDay(id: number, actor: Actor) {
  const r = await getRequest(id);
  await transition(id, "first_day", { actor, message: actor === SYSTEM ? "Start date reached" : "First day started" });
  if (r.employeeId) await setEmployeeStatus(r.employeeId, "onboarding", actor);
  return completeIfDone(id, actor);
}

export async function cancel(id: number, reason: string | null, actor: Actor) {
  return transition(id, "cancelled", { actor, message: reason ?? undefined, patch: { cancelReason: reason } });
}

export async function reopen(id: number, actor: Actor) {
  return transition(id, "new", { actor, message: "Request reopened" });
}

// ─── First-day checklist ─────────────────────────────────────────────────────

async function createChecklist(requestId: number) {
  const db = getDb();
  const templates = await db.select().from(checklistTemplates).where(eq(checklistTemplates.active, true)).orderBy(asc(checklistTemplates.sortOrder), asc(checklistTemplates.id));
  if (!templates.length) return;
  await db
    .insert(requestChecklistItems)
    .values(templates.map((t) => ({ requestId, templateId: t.id, label: t.label, sortOrder: t.sortOrder })))
    .onConflictDoNothing();
}

export async function setChecklistItem(itemId: number, done: boolean, actor: Actor) {
  const db = getDb();
  const [item] = await db.select().from(requestChecklistItems).where(eq(requestChecklistItems.id, itemId));
  if (!item) throw new FlowError("Checklist item not found");
  const r = await getRequest(item.requestId);
  if (!["approved", "first_day"].includes(r.stage)) throw new FlowError("The checklist can only be changed while the request is approved or on its first day.");
  if (item.done === done) return r;
  await db.update(requestChecklistItems).set({ done, doneAt: done ? new Date() : null, doneBy: done ? actor : null }).where(eq(requestChecklistItems.id, itemId));
  await logEvent(item.requestId, { type: "checklist", message: `${done ? "Ticked" : "Unticked"}: ${item.label}`, actor });
  return completeIfDone(item.requestId, actor);
}

/** Closes the request (and the Jira ticket) when it's on its first day and every item is ticked. */
async function completeIfDone(id: number, actor: Actor) {
  const r = await getRequest(id);
  if (r.stage !== "first_day") return r;
  const items = await getDb().select().from(requestChecklistItems).where(eq(requestChecklistItems.requestId, id));
  if (items.some((i) => !i.done)) return r;
  return transition(id, "completed", { actor, message: items.length ? "All first-day checklist items ticked" : "No checklist items" });
}

// ─── Employee record ─────────────────────────────────────────────────────────

async function setEmployeeStatus(employeeId: number, status: "pre_onboarding" | "onboarding", actor: Actor) {
  const db = getDb();
  const [e] = await db.select({ status: employees.status }).from(employees).where(eq(employees.id, employeeId));
  if (!e || e.status === status || !["pre_onboarding", "onboarding"].includes(e.status)) return;
  await db.update(employees).set({ status, updatedAt: new Date() }).where(eq(employees.id, employeeId));
  await db.insert(employeeChanges).values({ employeeId, field: "status", oldValue: e.status, newValue: status, source: "jira", changedBy: actor });
}

/** Pushes the request's current values to the linked employee (used after a correction or an accepted Jira change). */
async function updateEmployeeFromRequest(id: number, actor: Actor, only?: RequestFieldKey[]) {
  const r = await getRequest(id);
  if (!r.employeeId) return;
  const v = effective(r);
  const inc = Object.fromEntries((only ?? REQUEST_FIELDS.map((f) => f.key)).map((k) => [k, v[k]]));
  const writer = await EmployeeWriter.create();
  // "manual" so the values are written even where another system owns the field — the team approved them
  await writer.apply(inc, { source: "manual", matchId: r.employeeId, changedBy: actor });
}

// ─── Changes in Jira after approval ──────────────────────────────────────────

export async function acceptPendingChange(id: number, field: RequestFieldKey, actor: Actor) {
  const r = await getRequest(id);
  const change = r.pendingChanges[field];
  if (!change) return r;
  const rest = { ...r.pendingChanges };
  delete rest[field];
  // The Jira value is already stored on the request; drop any correction so it takes effect
  const corrections = { ...r.corrections };
  delete corrections[field];
  await getDb().update(onboardingRequests).set({ pendingChanges: rest, corrections, updatedAt: new Date() }).where(eq(onboardingRequests.id, id));
  await updateEmployeeFromRequest(id, actor, [field]);
  await logEvent(id, { type: "change", message: `Accepted Jira change — ${fieldLabel(field)}: ${change.from ?? "empty"} → ${change.to ?? "empty"}`, actor });
  return advance(id, actor);
}

export async function dismissPendingChange(id: number, field: RequestFieldKey, actor: Actor) {
  const r = await getRequest(id);
  const change = r.pendingChanges[field];
  if (!change) return r;
  const rest = { ...r.pendingChanges };
  delete rest[field];
  // Keep the approved value by turning it into a correction
  const corrections = { ...r.corrections, [field]: change.from };
  await getDb().update(onboardingRequests).set({ pendingChanges: rest, corrections, updatedAt: new Date() }).where(eq(onboardingRequests.id, id));
  await logEvent(id, { type: "change", message: `Kept the approved ${fieldLabel(field).toLowerCase()} (${change.from ?? "empty"}); ignored Jira's ${change.to ?? "empty"}`, actor });
  return getRequest(id);
}

// ─── Daily advance ───────────────────────────────────────────────────────────

/** Applies the date-driven rules to one request. Safe to run any number of times. */
export async function advance(id: number, actor: Actor = SYSTEM) {
  let r = await getRequest(id);
  const t = today();
  if (r.stage === "pre_onboarding") {
    if (!r.collectionDateOverridden) {
      const suggested = suggestCollectionDate(effective(r).startDate);
      if (suggested !== r.collectionDate) {
        await getDb().update(onboardingRequests).set({ collectionDate: suggested }).where(eq(onboardingRequests.id, id));
        r = await getRequest(id);
      }
    }
    // No start date yet → collect now, so the requester is asked for it
    if (!r.collectionDate || r.collectionDate <= t) {
      r = await transition(id, "collecting", { actor, message: r.collectionDate ? "Collection date reached" : "No start date — collecting now" });
    }
  }
  if (["collecting", "needs_info", "ready_for_review"].includes(r.stage)) r = await settle(id, actor);
  if (r.stage === "approved") {
    const start = effective(r).startDate;
    if (start && start <= t) r = await startFirstDay(id, actor);
  }
  if (r.stage === "first_day") r = await completeIfDone(id, actor);
  return r;
}

/** Runs advance() for every request that might be due. Called by the daily sync. */
export async function advanceAll(actor: Actor = SYSTEM) {
  const db = getDb();
  const t = today();
  const due = await db
    .select({ id: onboardingRequests.id })
    .from(onboardingRequests)
    .where(
      or(
        and(eq(onboardingRequests.stage, "pre_onboarding"), or(isNull(onboardingRequests.collectionDate), lte(onboardingRequests.collectionDate, t), eq(onboardingRequests.collectionDateOverridden, false))),
        inArray(onboardingRequests.stage, ["collecting", "needs_info", "ready_for_review", "approved", "first_day"]),
      ),
    );
  const errors: string[] = [];
  let moved = 0;
  for (const { id } of due) {
    try {
      const before = (await getRequest(id)).stage;
      const after = (await advance(id, actor)).stage;
      if (before !== after) moved++;
    } catch (e) {
      errors.push(`Request ${id}: ${(e as Error).message}`);
    }
  }
  return { checked: due.length, moved, errors };
}
