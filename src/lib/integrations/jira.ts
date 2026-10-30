import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { onboardingRequests } from "@/db/schema";
import { FIELDS, FIELD_MAP, type EmployeeField } from "../fields";
import { cleanEmail, cleanText, getPath, normHeader, parseDate, safeJson, todayIso } from "../normalize";
import type { Incoming } from "../employee-writer";
import { fetchJson } from "./http";
import { claudeConfigured, validateTicketWithClaude } from "./claude";
import { emptyCounts, tally, type Connector, type SyncCounts } from "./types";

const env = () => ({
  base: (process.env.JIRA_BASE_URL || "").replace(/\/$/, ""),
  email: process.env.JIRA_EMAIL,
  token: process.env.JIRA_API_TOKEN,
  jql: process.env.JIRA_ONBOARDING_JQL || 'issuetype = "Onboarding" AND updated >= -7d ORDER BY created DESC',
  fieldMap: safeJson<Partial<Record<EmployeeField, string>>>(process.env.JIRA_FIELD_MAP, {}),
  required: (process.env.JIRA_REQUIRED_FIELDS || "fullName,email,startDate,businessUnit,jobTitle,location,manager")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is EmployeeField => s in FIELD_MAP),
  comment: process.env.JIRA_COMMENT_ON_MISSING === "true",
});

const authHeaders = () => {
  const { email, token } = env();
  return {
    Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
};

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

type JiraIssue = { key: string; fields: Record<string, unknown> };

async function* searchIssues(): AsyncGenerator<JiraIssue> {
  const { base, jql, fieldMap } = env();
  const fields = ["summary", "description", "status", "reporter", "created", "updated", ...Object.values(fieldMap)];
  let nextPageToken: string | undefined;
  let guard = 0;
  do {
    const json = await fetchJson<{ issues: JiraIssue[]; nextPageToken?: string; isLast?: boolean }>(`${base}/rest/api/3/search/jql`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ jql, fields, maxResults: 100, nextPageToken }),
    });
    for (const i of json.issues ?? []) yield i;
    nextPageToken = json.isLast ? undefined : json.nextPageToken;
  } while (nextPageToken && guard++ < 100);
}

function normalise(fields: Partial<Record<EmployeeField, string | null>>): Incoming {
  const out: Incoming = {};
  for (const [k, v] of Object.entries(fields) as [EmployeeField, string | null][]) {
    if (!v || !(k in FIELD_MAP)) continue;
    if (FIELD_MAP[k].type === "date") out[k] = parseDate(v);
    else if (k === "email") out.email = cleanEmail(v);
    else out[k] = cleanText(v);
  }
  return out;
}

async function postComment(key: string, lines: string[]) {
  const { base } = env();
  const appUrl = process.env.APP_URL;
  const body = {
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Onboarding Hub: this request is missing information needed to start onboarding:" }] },
      { type: "bulletList", content: lines.map((l) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: l }] }] })) },
      ...(appUrl ? [{ type: "paragraph", content: [{ type: "text", text: "Questions? Contact HR Operations." }] }] : []),
    ],
  };
  await fetchJson(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ body }) });
}

/** Validates one ticket (rules + optional Claude) and stores it. Returns the merged record. */
export async function processIssue(issue: JiraIssue, opts: { force?: boolean } = {}) {
  const db = getDb();
  const { fieldMap, required, comment } = env();
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
  let aiComment = "";

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
      aiComment = v.comment;
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
  const [row] = await db
    .insert(onboardingRequests)
    .values(values)
    .onConflictDoUpdate({ target: onboardingRequests.jiraKey, set: values })
    .returning();

  // Ask the reporter for missing info — once per ticket version
  if (comment && status === "missing_info" && !unchanged) {
    const lines = aiComment
      ? aiComment.split("\n").map((l) => l.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean)
      : missing.map((m) => `${FIELD_MAP[m].label} is missing`);
    try {
      await postComment(issue.key, lines);
      await db.update(onboardingRequests).set({ commentedAt: new Date() }).where(eq(onboardingRequests.id, row.id));
    } catch (e) {
      notes.push(`Could not comment on Jira: ${(e as Error).message}`);
    }
  }
  return { row, merged: { ...merged, jiraKey: issue.key } as Incoming };
}

export async function fetchIssue(key: string): Promise<JiraIssue> {
  const { base, fieldMap } = env();
  const fields = ["summary", "description", "status", "reporter", "created", ...Object.values(fieldMap)].join(",");
  return fetchJson<JiraIssue>(`${base}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`, { headers: authHeaders() });
}

export const jira: Connector = {
  id: "jira",
  label: "Jira",
  description: "Onboarding requests. Tickets are validated (Claude, if configured) and new joiners are added as pre-onboarding.",
  envVars: ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_ONBOARDING_JQL", "JIRA_FIELD_MAP", "JIRA_REQUIRED_FIELDS"],
  missingConfig() {
    const e = env();
    return [!e.base && "JIRA_BASE_URL", !e.email && "JIRA_EMAIL", !e.token && "JIRA_API_TOKEN"].filter(Boolean) as string[];
  },
  async test() {
    const { base } = env();
    const me = await fetchJson<{ displayName: string }>(`${base}/rest/api/3/myself`, { headers: authHeaders(), retries: 0 });
    return `Connected as ${me.displayName}.`;
  },
  async sync({ writer, runId }) {
    const c: SyncCounts = emptyCounts();
    let invalid = 0;
    for await (const issue of searchIssues()) {
      c.fetched++;
      try {
        const { row, merged } = await processIssue(issue);
        if (row.validationStatus === "missing_info") invalid++;
        // Only create/link an employee when we can identify the person reliably
        if (!merged.fullName || (!merged.email && !merged.startDate)) {
          c.skipped++;
          continue;
        }
        const res = await writer.apply({ ...merged, status: "pre_onboarding" }, { source: "jira", syncRunId: runId });
        tally(c, res, issue.key);
        if (res.employeeId && res.employeeId > 0 && row.employeeId !== res.employeeId)
          await getDb().update(onboardingRequests).set({ employeeId: res.employeeId }).where(eq(onboardingRequests.id, row.id));
      } catch (e) {
        c.skipped++;
        c.errors.push(`${issue.key}: ${(e as Error).message}`);
      }
    }
    c.message = invalid ? `${invalid} ticket(s) missing information` : undefined;
    return c;
  },
};
