import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { onboardingRequests, requestEvents, type PendingChanges } from "@/db/schema";
import { FIELDS, FIELD_MAP, type EmployeeField } from "../fields";
import { cleanEmail, cleanText, getPath, normHeader, parseDate, safeJson, todayIso } from "../normalize";
import { advanceAll } from "../onboarding/engine";
import { REQUEST_FIELDS, fieldLabel } from "../onboarding/stages";
import { claudeConfigured, validateTicketWithClaude } from "./claude";
import { getJiraClient, jiraMode, type JiraIssue } from "./jira-client";
import { emptyCounts, type Connector, type SyncCounts } from "./types";

const env = () => ({
  fieldMap: safeJson<Partial<Record<EmployeeField, string>>>(process.env.JIRA_FIELD_MAP, {}),
  required: (process.env.JIRA_REQUIRED_FIELDS || "fullName,email,startDate,businessUnit,jobTitle,location,manager")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is EmployeeField => s in FIELD_MAP),
});

/** Atlassian Document Format → plain text. */
export function adfToText(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  if (n.type === "mention") return String(n.attrs?.text ?? "");
  const inner = (n.content ?? []).map(adfToText).join("");
  if (["paragraph", "heading", "listItem", "tableRow"].includes(n.type ?? "")) return inner + "\n";
  if (n.type === "tableCell" || n.type === "tableHeader") return inner.trim() + " | ";
  return inner;
}

/** Reads "Label: value" lines from ticket descriptions using the same synonyms as Excel import. */
export function parseLabeledLines(text: string): Partial<Record<EmployeeField, string>> {
  const out: Partial<Record<EmployeeField, string>> = {};
  for (const line of text.split(/\n/)) {
    const m = line.match(/^\s*[-*•]?\s*([^:|]{2,40})\s*[:|]\s*(.+?)\s*\|?\s*$/);
    if (!m) continue;
    const label = normHeader(m[1]);
    const def = FIELDS.find((f) => f.synonyms.includes(label) || normHeader(f.label) === label);
    if (def && !out[def.key]) out[def.key] = m[2].trim();
  }
  return out;
}

function fieldValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return cleanText(o.value ?? o.displayName ?? o.emailAddress ?? o.name ?? (o.type === "doc" ? adfToText(o) : null));
  }
  return cleanText(v);
}

function normalise(fields: Partial<Record<EmployeeField, string | null>>): Partial<Record<EmployeeField, string | null>> {
  const out: Partial<Record<EmployeeField, string | null>> = {};
  for (const [k, v] of Object.entries(fields) as [EmployeeField, string | null][]) {
    if (!v || !(k in FIELD_MAP)) continue;
    if (FIELD_MAP[k].type === "date") out[k] = parseDate(v);
    else if (k === "email") out.email = cleanEmail(v);
    else out[k] = cleanText(v);
  }
  return out;
}

const AFTER_APPROVAL = ["approved", "first_day", "completed"];

/**
 * Validates one ticket (rules + optional Claude) and stores it as an onboarding request.
 * Never changes the request's stage or the team's corrections. Comments to the requester and
 * stage changes are handled by the onboarding engine. Changes to an already-approved request
 * are recorded as pending changes for the team to accept or dismiss.
 */
export async function processIssue(issue: JiraIssue, opts: { force?: boolean } = {}) {
  const db = getDb();
  const { fieldMap, required } = env();
  const f = issue.fields;
  const summary = cleanText(f.summary) ?? "";
  const description = adfToText(f.description).trim();
  const structured: Partial<Record<EmployeeField, string | null>> = {};
  for (const [k, id] of Object.entries(fieldMap) as [EmployeeField, string][]) structured[k] = fieldValue(getPath(f, id));
  const fromText = parseLabeledLines(description);
  let merged = normalise({ ...fromText, ...Object.fromEntries(Object.entries(structured).filter(([, v]) => v)) });
  if (!merged.fullName) {
    const m = summary.match(/(?:onboarding|new hire|new joiner)\s*[:\-–]\s*(.+)$/i);
    if (m) merged.fullName = cleanText(m[1]);
  }

  const hash = createHash("sha1").update(JSON.stringify([summary, description, structured])).digest("hex");
  const [existing] = await db.select().from(onboardingRequests).where(eq(onboardingRequests.jiraKey, issue.key));
  const unchanged = existing && (existing.payload as { _hash?: string })._hash === hash && !opts.force;

  let missing = required.filter((r) => !merged[r]);
  let notes: string[] = [];
  let status: "valid" | "missing_info" | "error" = missing.length ? "missing_info" : "valid";

  if (unchanged) {
    // Nothing changed since last validation — don't spend API calls again
    missing = existing.missingFields as EmployeeField[];
    status = existing.validationStatus === "unchecked" ? status : (existing.validationStatus as typeof status);
    notes = existing.validationNotes ? [existing.validationNotes] : [];
    merged = { ...merged, ...normalise({ fullName: existing.fullName, email: existing.email, startDate: existing.startDate, businessUnit: existing.businessUnit, jobTitle: existing.jobTitle, location: existing.location, manager: existing.manager }) };
  } else if (claudeConfigured()) {
    try {
      const v = await validateTicketWithClaude({ key: issue.key, summary, description, knownFields: merged as Record<string, string | null>, required, today: todayIso() });
      // structured Jira fields win over AI extraction; AI fills gaps
      merged = { ...normalise(v.fields), ...Object.fromEntries(Object.entries(merged).filter(([, x]) => x)) };
      missing = required.filter((r) => !merged[r]);
      notes = v.problems;
      status = missing.length || v.problems.length ? "missing_info" : "valid";
    } catch (e) {
      notes = [`Claude validation failed: ${(e as Error).message}. Rule-based check used.`];
    }
  }

  const values = {
    jiraKey: issue.key,
    summary,
    jiraStatus: fieldValue(f.status),
    reporter: fieldValue(f.reporter),
    fullName: merged.fullName ?? null,
    email: merged.email ?? null,
    startDate: merged.startDate ?? null,
    businessUnit: merged.businessUnit ?? null,
    jobTitle: merged.jobTitle ?? null,
    location: merged.location ?? null,
    manager: merged.manager ?? null,
    payload: { _hash: hash, description: description.slice(0, 5000), fields: merged },
    validationStatus: status,
    missingFields: missing,
    validationNotes: notes.join("\n") || null,
    jiraCreatedAt: f.created ? new Date(String(f.created)) : null,
    updatedAt: new Date(),
  };

  // After approval, Jira edits don't silently change the employee: record them for review
  let pendingChanges: PendingChanges | undefined;
  const detected: string[] = [];
  if (existing && !unchanged && AFTER_APPROVAL.includes(existing.stage)) {
    pendingChanges = { ...existing.pendingChanges };
    for (const { key } of REQUEST_FIELDS) {
      const before = (existing[key] as string | null) ?? null;
      const after = (values[key] as string | null) ?? null;
      if (before === after || key in existing.corrections) continue;
      pendingChanges[key] = { from: pendingChanges[key]?.from ?? before, to: after, detectedAt: new Date().toISOString() };
      if (pendingChanges[key].from === after) delete pendingChanges[key];
      else detected.push(`${fieldLabel(key)}: ${before ?? "empty"} → ${after ?? "empty"}`);
    }
  }

  const [row] = await db
    .insert(onboardingRequests)
    .values(values)
    .onConflictDoUpdate({ target: onboardingRequests.jiraKey, set: pendingChanges ? { ...values, pendingChanges } : values })
    .returning();
  if (!existing) await db.insert(requestEvents).values({ requestId: row.id, type: "stage", toStage: "new", message: `Ticket ${issue.key} received from Jira` });
  if (detected.length) await db.insert(requestEvents).values({ requestId: row.id, type: "change", message: `Jira changed after approval — ${detected.join("; ")}` });
  return { row, created: !existing, changed: Boolean(existing && !unchanged) };
}

export async function fetchIssue(key: string): Promise<JiraIssue> {
  return getJiraClient().get(key);
}

export const jira: Connector = {
  id: "jira",
  label: "Jira",
  description:
    "Onboarding requests. New tickets appear on the Onboarding page as new requests; the Hub moves the ticket to Work in progress when the employee is contacted and to Done when onboarding is complete.",
  envVars: ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_ONBOARDING_JQL", "JIRA_FIELD_MAP", "JIRA_REQUIRED_FIELDS", "JIRA_MODE"],
  missingConfig() {
    if (jiraMode() === "mock") return [];
    const base = process.env.JIRA_BASE_URL;
    return [!base && "JIRA_BASE_URL", !process.env.JIRA_EMAIL && "JIRA_EMAIL", !process.env.JIRA_API_TOKEN && "JIRA_API_TOKEN"].filter(Boolean) as string[];
  },
  async test() {
    return getJiraClient().whoami();
  },
  async sync() {
    const c: SyncCounts = emptyCounts();
    for await (const issue of getJiraClient().search()) {
      c.fetched++;
      try {
        const res = await processIssue(issue);
        if (res.created) c.created++;
        else if (res.changed) c.updated++;
        else c.unchanged++;
      } catch (e) {
        c.skipped++;
        c.errors.push(`${issue.key}: ${(e as Error).message}`);
      }
    }
    // Date-driven steps: collection dates reached, first days, completed checklists
    const adv = await advanceAll();
    c.errors.push(...adv.errors);
    const parts = [jiraMode() === "mock" ? "Demo mode (dummy tickets)" : null, adv.moved ? `${adv.moved} request(s) moved to the next stage` : null].filter(Boolean);
    c.message = parts.join(" · ") || undefined;
    return c;
  },
};
