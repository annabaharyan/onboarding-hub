"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { employees, employeeChanges, onboardingRequests, onboardingSurveys, orgUnits, probationFeedback, probationReviews } from "@/db/schema";
import { SESSION_COOKIE, createSessionToken, passwordMatches, sessionCookieOptions } from "@/lib/auth";
import { CONNECTORS, defaultSources, runSync } from "@/lib/sync";
import { EmployeeWriter, type Incoming } from "@/lib/employee-writer";
import { FIELDS, type EmployeeField } from "@/lib/fields";
import { buildWhere, parseFilters } from "@/lib/queries";
import { cleanEmail, cleanText, parseBoolean, parseCareerTrack, parseDate, parseOffboardingReason, parseStatus, todayIso } from "@/lib/normalize";
import { claudeConfigured, testClaude } from "@/lib/integrations/claude";
import { fetchIssue, processIssue } from "@/lib/integrations/jira";
import type { ConnectorId } from "@/lib/integrations/types";

export type ActionState = { ok: boolean; message: string } | null;

export async function login(_: ActionState, form: FormData): Promise<ActionState> {
  const pw = String(form.get("password") ?? "");
  if (!(await passwordMatches(pw))) {
    await new Promise((r) => setTimeout(r, 600)); // slow down brute force
    return { ok: false, message: "Incorrect password" };
  }
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
  const next = String(form.get("next") || "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function syncNow(_: ActionState, form: FormData): Promise<ActionState> {
  const source = form.get("source") as ConnectorId | "all";
  const sources = source === "all" || !source ? defaultSources() : [source];
  try {
    const report = await runSync(sources, "manual");
    if (report.locked) return { ok: false, message: "A sync is already running — try again in a few minutes." };
    revalidatePath("/", "layout");
    const parts = report.runs.map((r) =>
      r.status === "skipped" ? `${r.source}: skipped (${r.message})` : r.status === "failed" ? `${r.source}: failed — ${r.message}` : `${r.source}: ${r.fetched} fetched, ${r.created} new, ${r.updated} updated`,
    );
    return { ok: report.runs.every((r) => r.status !== "failed"), message: parts.join(" · ") };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function testConnection(_: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id"));
  try {
    if (id === "claude") {
      if (!claudeConfigured()) return { ok: false, message: "Set ANTHROPIC_API_KEY first." };
      return { ok: true, message: await testClaude() };
    }
    const c = CONNECTORS[id as ConnectorId];
    if (!c) return { ok: false, message: "Unknown connector" };
    const missing = c.missingConfig();
    if (missing.length) return { ok: false, message: `Missing configuration: ${missing.join(", ")}` };
    return { ok: true, message: await c.test() };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

const EDITABLE = FIELDS.filter((f) => !["leapsomeId", "timebaseId", "countryCode"].includes(f.key));

export async function updateEmployee(_: ActionState, form: FormData): Promise<ActionState> {
  const id = Number(form.get("id"));
  const inc: Incoming = {};
  const errors: string[] = [];
  for (const f of EDITABLE) {
    if (!form.has(f.key)) continue;
    const raw = String(form.get(f.key) ?? "");
    if (f.type === "date") {
      const d = raw ? parseDate(raw) : null;
      if (raw && !d) errors.push(`${f.label}: invalid date`);
      inc[f.key] = d;
    } else if (f.type === "status") inc.status = parseStatus(raw);
    else if (f.type === "careerTrack") inc.careerTrack = raw ? parseCareerTrack(raw) : null;
    else if (f.type === "offboardingReasonCategory") inc.offboardingReasonCategory = raw ? parseOffboardingReason(raw) : null;
    else if (f.type === "boolean") inc[f.key] = parseBoolean(raw) ?? false;
    else if (f.key === "email") {
      const e = raw ? cleanEmail(raw) : null;
      if (raw && !e) errors.push("Email is invalid");
      inc.email = e;
    } else inc[f.key] = cleanText(raw);
  }
  if (inc.startDate && inc.endDate && inc.endDate < inc.startDate) errors.push("End date is before start date");
  if (errors.length) return { ok: false, message: errors.join("; ") };

  const db = getDb();
  const [current] = await db.select().from(employees).where(eq(employees.id, id));
  if (!current) return { ok: false, message: "Employee not found" };

  // Pin the match to this record and apply as a manual edit (locks edited fields)
  const writer = await EmployeeWriter.create();
  const res = await writer.apply(inc, { source: "manual", changedBy: "web", matchId: id });

  // Manual edits may also clear a field — handle explicit blanks
  const cleared = (Object.keys(inc) as EmployeeField[]).filter((k) => inc[k] === null && current[k] !== null && k !== "fullName" && k !== "status");
  if (cleared.length) {
    await db.update(employees).set(Object.fromEntries(cleared.map((k) => [k, null]))).where(eq(employees.id, id));
    await db.insert(employeeChanges).values(cleared.map((k) => ({ employeeId: id, field: k, oldValue: String(current[k]), newValue: null, source: "manual" as const, changedBy: "web" })));
  }
  revalidatePath(`/employees/${id}`);
  revalidatePath("/employees");
  const n = res.changes.length + cleared.length;
  if (res.issues.length) return { ok: false, message: `Saved ${n} change(s), but: ${res.issues.join("; ")}` };
  return { ok: true, message: n ? `Saved ${n} change(s). Edited fields are now locked from sync overwrites.` : "No changes." };
}

/** Deletes a single employee (called directly from a client component, not a <form>). */
export async function deleteEmployee(id: number) {
  const db = getDb();
  await db.delete(employees).where(eq(employees.id, id));
  revalidatePath("/employees");
  revalidatePath("/");
}

/** Bulk-deletes the employees whose ids were checked in the list view. */
export async function deleteEmployees(ids: number[]) {
  const clean = ids.filter((n) => Number.isInteger(n));
  if (!clean.length) return;
  const db = getDb();
  await db.delete(employees).where(inArray(employees.id, clean));
  revalidatePath("/employees");
  revalidatePath("/");
}

/** Deletes every employee matching the current list filters (all employees if none are applied) — mirrors what "Export these to Excel" exports. */
export async function deleteAllEmployees(qs: string) {
  const f = parseFilters(new URLSearchParams(qs));
  const where = buildWhere(f);
  const db = getDb();
  await db.delete(employees).where(where);
  revalidatePath("/employees");
  revalidatePath("/");
}

export async function unlockField(form: FormData) {
  const id = Number(form.get("id"));
  const field = String(form.get("field"));
  const db = getDb();
  const [e] = await db.select({ locked: employees.lockedFields }).from(employees).where(eq(employees.id, id));
  if (!e) return;
  await db.update(employees).set({ lockedFields: e.locked.filter((f) => f !== field) }).where(eq(employees.id, id));
  revalidatePath(`/employees/${id}`);
}

export async function createEmployee(_: ActionState, form: FormData): Promise<ActionState> {
  const fullName = cleanText(form.get("fullName"));
  if (!fullName) return { ok: false, message: "Name is required" };
  const writer = await EmployeeWriter.create();
  const inc: Incoming = {
    fullName,
    email: cleanEmail(form.get("email")),
    businessUnit: cleanText(form.get("businessUnit")),
    startDate: parseDate(form.get("startDate")),
    status: parseStatus(form.get("status")) ?? "pre_onboarding",
  };
  if (writer.match(inc)) return { ok: false, message: "An employee with this email / name + start date already exists." };
  const res = await writer.apply(inc, { source: "manual", changedBy: "web" });
  revalidatePath("/employees");
  redirect(`/employees/${res.employeeId}`);
}

export async function revalidateTicket(form: FormData) {
  const key = String(form.get("key"));
  const issue = await fetchIssue(key);
  await processIssue(issue, { force: true });
  revalidatePath("/onboarding");
}

export async function linkTicketToNewEmployee(form: FormData) {
  const id = Number(form.get("id"));
  const db = getDb();
  const [t] = await db.select().from(onboardingRequests).where(eq(onboardingRequests.id, id));
  if (!t || !t.fullName) return;
  const writer = await EmployeeWriter.create();
  const res = await writer.apply(
    { fullName: t.fullName, email: t.email, startDate: t.startDate, businessUnit: t.businessUnit, jobTitle: t.jobTitle, location: t.location, manager: t.manager, jiraKey: t.jiraKey, status: "pre_onboarding" },
    { source: "jira", changedBy: "web" },
  );
  if (res.employeeId) await db.update(onboardingRequests).set({ employeeId: res.employeeId }).where(eq(onboardingRequests.id, id));
  revalidatePath("/onboarding");
}

/** Opens a new probation review cycle for an employee, snapshotting the current probation end date as the due date. */
export async function openProbationReview(form: FormData) {
  const employeeId = Number(form.get("employeeId"));
  const db = getDb();
  const [emp] = await db.select({ probationEndDate: employees.probationEndDate }).from(employees).where(eq(employees.id, employeeId));
  if (!emp) return;
  await db.insert(probationReviews).values({ employeeId, dueDate: emp.probationEndDate, decision: "pending" });
  revalidatePath(`/employees/${employeeId}`);
}

/** Records one stakeholder's skill score / comment against an open probation review. */
export async function addProbationFeedback(form: FormData) {
  const reviewId = Number(form.get("reviewId"));
  const employeeId = Number(form.get("employeeId"));
  const reviewerName = cleanText(form.get("reviewerName"));
  if (!reviewerName) return;
  const scoreRaw = String(form.get("skillScore") ?? "");
  const db = getDb();
  await db.insert(probationFeedback).values({
    reviewId,
    reviewerName,
    reviewerRole: cleanText(form.get("reviewerRole")),
    skillScore: scoreRaw ? Number(scoreRaw) : null,
    comment: cleanText(form.get("comment")),
  });
  revalidatePath(`/employees/${employeeId}`);
}

/** Records (or updates) an employee's six-month survey response. Upserted so the same employee can only have one response per survey type. */
export async function recordSurveyResponse(form: FormData) {
  const employeeId = Number(form.get("employeeId"));
  const surveyType = String(form.get("surveyType") || "six_month");
  const scoreOf = (name: string) => {
    const raw = String(form.get(name) ?? "");
    return raw ? Number(raw) : null;
  };
  const db = getDb();
  await db
    .insert(onboardingSurveys)
    .values({
      employeeId,
      surveyType,
      respondedAt: new Date(),
      onboardingExperienceScore: scoreOf("onboardingExperienceScore"),
      managerSupportScore: scoreOf("managerSupportScore"),
      overallSatisfactionScore: scoreOf("overallSatisfactionScore"),
      likes: form.getAll("likes").map(String),
      improvements: form.getAll("improvements").map(String),
      comments: cleanText(form.get("comments")),
    })
    .onConflictDoUpdate({
      target: [onboardingSurveys.employeeId, onboardingSurveys.surveyType],
      set: {
        respondedAt: new Date(),
        onboardingExperienceScore: scoreOf("onboardingExperienceScore"),
        managerSupportScore: scoreOf("managerSupportScore"),
        overallSatisfactionScore: scoreOf("overallSatisfactionScore"),
        likes: form.getAll("likes").map(String),
        improvements: form.getAll("improvements").map(String),
        comments: cleanText(form.get("comments")),
      },
    });
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/surveys");
}

/** Marks a six-month survey as sent (opens the record) without a response yet. */
export async function sendSurveyInvite(form: FormData) {
  const employeeId = Number(form.get("employeeId"));
  const surveyType = String(form.get("surveyType") || "six_month");
  const db = getDb();
  await db
    .insert(onboardingSurveys)
    .values({ employeeId, surveyType, sentAt: new Date() })
    .onConflictDoUpdate({ target: [onboardingSurveys.employeeId, onboardingSurveys.surveyType], set: { sentAt: new Date() } });
  revalidatePath(`/employees/${employeeId}`);
}

/** Creates or updates the org-hierarchy row for a business unit (one row per BU). */
export async function upsertOrgUnit(_: ActionState, form: FormData): Promise<ActionState> {
  const businessUnit = cleanText(form.get("businessUnit"));
  if (!businessUnit) return { ok: false, message: "Business unit is required" };
  const db = getDb();
  await db
    .insert(orgUnits)
    .values({
      businessUnit,
      cluster: cleanText(form.get("cluster")),
      hrbp: cleanText(form.get("hrbp")),
      headOfBusinessOps: cleanText(form.get("headOfBusinessOps")),
      businessController: cleanText(form.get("businessController")),
      staffingPartner: cleanText(form.get("staffingPartner")),
      notes: cleanText(form.get("notes")),
    })
    .onConflictDoUpdate({
      target: orgUnits.businessUnit,
      set: {
        cluster: cleanText(form.get("cluster")),
        hrbp: cleanText(form.get("hrbp")),
        headOfBusinessOps: cleanText(form.get("headOfBusinessOps")),
        businessController: cleanText(form.get("businessController")),
        staffingPartner: cleanText(form.get("staffingPartner")),
        notes: cleanText(form.get("notes")),
        updatedAt: new Date(),
      },
    });
  revalidatePath("/org");
  revalidatePath("/employees");
  return { ok: true, message: `Saved org hierarchy for "${businessUnit}".` };
}

export async function deleteOrgUnit(form: FormData) {
  const id = Number(form.get("id"));
  const db = getDb();
  await db.delete(orgUnits).where(eq(orgUnits.id, id));
  revalidatePath("/org");
}

const PROBATION_DECISIONS = ["confirmed", "extended", "terminated"] as const;

/** Records the hiring-committee decision for a probation review; an extension also pushes out the employee's probation end date. */
export async function recordProbationDecision(form: FormData) {
  const reviewId = Number(form.get("reviewId"));
  const employeeId = Number(form.get("employeeId"));
  const decisionRaw = String(form.get("decision"));
  if (!(PROBATION_DECISIONS as readonly string[]).includes(decisionRaw)) return;
  const decision = decisionRaw as (typeof PROBATION_DECISIONS)[number];
  const decidedBy = cleanText(form.get("decidedBy"));
  const extendedToDate = decision === "extended" ? parseDate(form.get("extendedToDate")) : null;
  const committeeNotes = cleanText(form.get("committeeNotes"));
  const db = getDb();
  await db.update(probationReviews).set({
    decision,
    decidedBy,
    extendedToDate,
    committeeNotes,
    decisionDate: todayIso(),
    updatedAt: new Date(),
  }).where(eq(probationReviews.id, reviewId));
  if (decision === "extended" && extendedToDate) {
    await db.update(employees).set({ probationEndDate: extendedToDate }).where(eq(employees.id, employeeId));
  } else if (decision === "confirmed") {
    await db.update(employees).set({ probationEndDate: null }).where(eq(employees.id, employeeId));
  }
  revalidatePath(`/employees/${employeeId}`);
}
