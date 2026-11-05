"use server";

import { revalidatePath } from "next/cache";
import { eq, max } from "drizzle-orm";
import { getDb } from "@/db";
import { checklistTemplates, type RequestCorrections } from "@/db/schema";
import type { ActionState } from "@/app/actions";
import { cleanEmail, cleanText, parseDate } from "@/lib/normalize";
import * as flow from "@/lib/onboarding/engine";
import { REQUEST_FIELDS, type RequestFieldKey } from "@/lib/onboarding/stages";
import { fetchIssue, processIssue } from "@/lib/integrations/jira";
import { answerMockTicket, createMockTicket, jiraMode } from "@/lib/integrations/jira-client";

/** The app uses one shared password, so actions are attributed to the team. */
const ACTOR = "HR team";

function refresh(id?: number) {
  revalidatePath("/onboarding");
  if (id) revalidatePath(`/onboarding/${id}`);
  revalidatePath("/employees");
  revalidatePath("/");
}

async function run(id: number, fn: () => Promise<unknown>, ok: string): Promise<ActionState> {
  try {
    await fn();
    const r = await flow.getRequest(id);
    refresh(id);
    return { ok: !r.jiraError, message: r.jiraError ? `${ok} — but ${r.jiraError}` : ok };
  } catch (e) {
    refresh(id);
    return { ok: false, message: (e as Error).message };
  }
}

const idOf = (form: FormData) => Number(form.get("id"));

export async function markContacted(_: ActionState, form: FormData) {
  const id = idOf(form);
  return run(id, () => flow.markContacted(id, ACTOR), "Marked as contacted. The Jira ticket is now Work in progress.");
}

export async function startCollectingNow(_: ActionState, form: FormData) {
  const id = idOf(form);
  return run(id, () => flow.startCollecting(id, ACTOR), "Collection started.");
}

export async function updateCollectionDate(_: ActionState, form: FormData) {
  const id = idOf(form);
  const raw = String(form.get("collectionDate") ?? "").trim();
  const reset = form.get("reset") === "1";
  const date = reset ? null : parseDate(raw);
  if (!reset && !date) return { ok: false, message: "Enter a valid date." };
  return run(id, () => flow.setCollectionDate(id, date, ACTOR), reset ? "Collection date reset to the suggestion." : "Collection date saved.");
}

export async function saveRequestCorrections(_: ActionState, form: FormData): Promise<ActionState> {
  const id = idOf(form);
  const input: RequestCorrections = {};
  const errors: string[] = [];
  for (const f of REQUEST_FIELDS) {
    const raw = String(form.get(f.key) ?? "").trim();
    if (!raw) continue;
    if (f.type === "date") {
      const d = parseDate(raw);
      if (!d) errors.push(`${f.label}: invalid date`);
      input[f.key] = d;
    } else if (f.type === "email") {
      const e = cleanEmail(raw);
      if (!e) errors.push("Email is invalid");
      input[f.key] = e;
    } else input[f.key] = cleanText(raw);
  }
  if (errors.length) return { ok: false, message: errors.join("; ") };
  try {
    const { changed } = await flow.saveCorrections(id, input, ACTOR);
    refresh(id);
    return { ok: true, message: changed ? `Saved ${changed} change(s).` : "No changes." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function askRequester(_: ActionState, form: FormData) {
  const id = idOf(form);
  return run(id, () => flow.askRequester(id, String(form.get("message") ?? ""), ACTOR), "Comment posted on the Jira ticket.");
}

export async function approveRequest(_: ActionState, form: FormData) {
  const id = idOf(form);
  return run(id, () => flow.approve(id, ACTOR), "Approved — the employee record is saved.");
}

export async function startFirstDayNow(_: ActionState, form: FormData) {
  const id = idOf(form);
  return run(id, () => flow.startFirstDay(id, ACTOR), "First day started.");
}

export async function toggleChecklistItem(form: FormData) {
  const id = Number(form.get("requestId"));
  try {
    await flow.setChecklistItem(Number(form.get("itemId")), form.get("done") === "1", ACTOR);
  } finally {
    refresh(id);
  }
}

export async function cancelRequest(_: ActionState, form: FormData) {
  const id = idOf(form);
  return run(id, () => flow.cancel(id, cleanText(form.get("reason")), ACTOR), "Request cancelled.");
}

export async function reopenRequest(_: ActionState, form: FormData) {
  const id = idOf(form);
  return run(id, () => flow.reopen(id, ACTOR), "Request reopened.");
}

export async function resolvePendingChange(form: FormData) {
  const id = idOf(form);
  const field = String(form.get("field")) as RequestFieldKey;
  try {
    if (form.get("decision") === "accept") await flow.acceptPendingChange(id, field, ACTOR);
    else await flow.dismissPendingChange(id, field, ACTOR);
  } finally {
    refresh(id);
  }
}

export async function retryJira(_: ActionState, form: FormData) {
  const id = idOf(form);
  return run(id, async () => flow.pushJiraStatus(await flow.getRequest(id), ACTOR), "Jira updated.");
}

/** Reads the ticket from Jira again and re-runs the checks. */
export async function recheckTicket(_: ActionState, form: FormData) {
  const id = idOf(form);
  return run(
    id,
    async () => {
      const r = await flow.getRequest(id);
      await processIssue(await fetchIssue(r.jiraKey), { force: true });
      await flow.advance(id, ACTOR);
    },
    "Ticket re-read from Jira.",
  );
}

// ─── Demo mode (dummy Jira) ──────────────────────────────────────────────────

export async function createDummyTicket(): Promise<ActionState> {
  if (jiraMode() !== "mock") return { ok: false, message: "Dummy tickets are only available in demo mode." };
  try {
    const key = await createMockTicket();
    await processIssue(await fetchIssue(key));
    refresh();
    return { ok: true, message: `Dummy ticket ${key} created.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Demo only: plays the requester adding the missing information to the ticket. */
export async function answerAsRequester(_: ActionState, form: FormData): Promise<ActionState> {
  if (jiraMode() !== "mock") return { ok: false, message: "Only available in demo mode." };
  const id = idOf(form);
  try {
    const r = await flow.getRequest(id);
    const values: Record<string, string> = {};
    for (const f of REQUEST_FIELDS) {
      const v = cleanText(form.get(f.key));
      if (v) values[f.label] = v;
    }
    await answerMockTicket(r.jiraKey, values);
    await processIssue(await fetchIssue(r.jiraKey));
    await flow.advance(id, "Demo requester");
    refresh(id);
    return { ok: true, message: "The dummy ticket was updated and checked again." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ─── Checklist template ──────────────────────────────────────────────────────

export async function addChecklistTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  const label = cleanText(form.get("label"));
  if (!label) return { ok: false, message: "Enter the item's name." };
  const db = getDb();
  const [{ m }] = await db.select({ m: max(checklistTemplates.sortOrder) }).from(checklistTemplates);
  await db.insert(checklistTemplates).values({ label, sortOrder: (m ?? 0) + 1 });
  revalidatePath("/onboarding");
  return { ok: true, message: `Added "${label}". New approvals will include it.` };
}

export async function toggleChecklistTemplate(form: FormData) {
  const id = Number(form.get("id"));
  await getDb().update(checklistTemplates).set({ active: form.get("active") === "1" }).where(eq(checklistTemplates.id, id));
  revalidatePath("/onboarding");
}
