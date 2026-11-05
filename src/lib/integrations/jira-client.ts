import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { mockJiraIssues } from "@/db/schema";
import { safeJson } from "../normalize";
import { fetchJson } from "./http";

/**
 * One interface for Jira, with two implementations:
 *  - live: Jira Cloud REST API v3 (needs JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)
 *  - mock: dummy tickets stored in the app's own database, so the whole flow can be
 *          used and demonstrated before real Jira credentials exist.
 *
 * Mode: JIRA_MODE=live|mock. When unset, the app uses "live" only if a real API token is
 * set; an empty token or one starting with "dummy" means mock.
 */

export type JiraIssue = { key: string; fields: Record<string, unknown> };

export interface JiraClient {
  mode: "live" | "mock";
  search(): AsyncGenerator<JiraIssue>;
  get(key: string): Promise<JiraIssue>;
  /** Moves the ticket to the status with this name (e.g. "Work in progress"). */
  transition(key: string, statusName: string): Promise<void>;
  /** Adds a comment: an intro line followed by bullet points. */
  comment(key: string, intro: string, lines: string[]): Promise<void>;
  browseUrl(key: string): string | null;
  whoami(): Promise<string>;
}

export function jiraMode(): "live" | "mock" {
  const explicit = (process.env.JIRA_MODE || "").toLowerCase();
  if (explicit === "live" || explicit === "mock") return explicit;
  const token = process.env.JIRA_API_TOKEN || "";
  return token && !token.toLowerCase().startsWith("dummy") ? "live" : "mock";
}

/** Jira status names used by your workflow. Override if your Jira names them differently. */
export const jiraStatusNames = () => ({
  open: process.env.JIRA_STATUS_OPEN || "Open",
  inProgress: process.env.JIRA_STATUS_IN_PROGRESS || "Work in progress",
  done: process.env.JIRA_STATUS_DONE || "Done",
  /** Optional — leave empty to keep the ticket's status when a request is cancelled. */
  cancelled: process.env.JIRA_STATUS_CANCELLED || "",
});

export function getJiraClient(): JiraClient {
  return jiraMode() === "live" ? liveClient : mockClient;
}

// ─── Live ────────────────────────────────────────────────────────────────────

const liveEnv = () => ({
  base: (process.env.JIRA_BASE_URL || "").replace(/\/$/, ""),
  email: process.env.JIRA_EMAIL,
  token: process.env.JIRA_API_TOKEN,
  jql: process.env.JIRA_ONBOARDING_JQL || 'issuetype = "Onboarding" AND updated >= -7d ORDER BY created DESC',
  fieldMap: safeJson<Record<string, string>>(process.env.JIRA_FIELD_MAP, {}),
});

const authHeaders = () => {
  const { email, token } = liveEnv();
  return {
    Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
};

const BASE_FIELDS = ["summary", "description", "status", "reporter", "created", "updated"];

const liveClient: JiraClient = {
  mode: "live",
  async *search() {
    const { base, jql, fieldMap } = liveEnv();
    const fields = [...BASE_FIELDS, ...Object.values(fieldMap)];
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
  },
  async get(key) {
    const { base, fieldMap } = liveEnv();
    const fields = [...BASE_FIELDS, ...Object.values(fieldMap)].join(",");
    return fetchJson<JiraIssue>(`${base}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`, { headers: authHeaders() });
  },
  async transition(key, statusName) {
    const { base } = liveEnv();
    const url = `${base}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`;
    const { transitions } = await fetchJson<{ transitions: { id: string; name: string; to?: { name?: string } }[] }>(url, { headers: authHeaders() });
    const want = statusName.trim().toLowerCase();
    const t = transitions.find((x) => x.to?.name?.toLowerCase() === want) ?? transitions.find((x) => x.name.toLowerCase() === want);
    if (!t) {
      const available = transitions.map((x) => x.to?.name ?? x.name).join(", ") || "none";
      throw new Error(`Jira has no transition to "${statusName}" from the ticket's current status. Available: ${available}.`);
    }
    await fetchJson(url, { method: "POST", headers: authHeaders(), body: JSON.stringify({ transition: { id: t.id } }) });
  },
  async comment(key, intro, lines) {
    const { base } = liveEnv();
    const body = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: intro }] },
        ...(lines.length
          ? [{ type: "bulletList", content: lines.map((l) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: l }] }] })) }]
          : []),
      ],
    };
    await fetchJson(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ body }) });
  },
  browseUrl(key) {
    const { base } = liveEnv();
    return base ? `${base}/browse/${key}` : null;
  },
  async whoami() {
    const { base } = liveEnv();
    const me = await fetchJson<{ displayName: string }>(`${base}/rest/api/3/myself`, { headers: authHeaders(), retries: 0 });
    return `Connected as ${me.displayName}.`;
  },
};

// ─── Mock ────────────────────────────────────────────────────────────────────

type MockRow = typeof mockJiraIssues.$inferSelect;

const toIssue = (r: MockRow): JiraIssue => ({
  key: r.key,
  fields: {
    summary: r.summary,
    description: r.description,
    status: { name: r.status },
    reporter: r.reporter ? { displayName: r.reporter } : null,
    created: r.createdAt.toISOString(),
    updated: r.updatedAt.toISOString(),
  },
});

const addDays = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Demo data must never contain real people: every name below is invented and every email uses the
// reserved ".test" domain, which can't belong to anyone.
const DEMO_DOMAIN = "demo-company.test";
const DEMO_REQUESTERS = ["Demo Requester", "Sam Requester"];
const DEMO_MANAGERS = ["Morgan Brandt", "Casey Holt", "Jamie Fenwick"];
const FIRST = ["Alex", "Taylor", "Jordan", "Riley", "Avery", "Rowan", "Quinn", "Skyler", "Reese", "Harper", "Emerson", "Finley"];
const LAST = ["Novak", "Keller", "Sorin", "Vance", "Marsh", "Doyle", "Carr", "Lindgren", "Tanaka", "Weaver", "Olsen", "Park"];
const BUS = [["Consulting", "Analyst"], ["Technology", "Backend Developer"], ["Finance", "Controller"], ["People", "HR Specialist"]];
const CITIES = ["Yerevan", "Warsaw", "Berlin", "Milan", "Tbilisi"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const demoEmail = (name: string) => `${name.toLowerCase().replace(/[^a-z ]/g, "").replace(/ +/g, ".")}@${DEMO_DOMAIN}`;

/** Dummy tickets covering the interesting cases: far-off start, soon start, missing info. */
function seedTickets(): Omit<MockRow, "createdAt" | "updatedAt" | "comments">[] {
  const open = jiraStatusNames().open;
  const t = (key: string, name: string, reporter: string, lines: Record<string, string | null>) => ({
    key,
    summary: `New hire: ${name}`,
    reporter,
    status: open,
    description: Object.entries(lines)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
  });
  const [r1, r2] = DEMO_REQUESTERS;
  const [m1, m2, m3] = DEMO_MANAGERS;
  return [
    t("DEMO-101", "Alex Novak", r1, {
      "Full name": "Alex Novak", Email: demoEmail("Alex Novak"), "Start date": addDays(75),
      "Business unit": "Consulting", "Job title": "Senior Analyst", Location: "Yerevan", Manager: m1,
    }),
    t("DEMO-102", "Taylor Keller", r2, {
      "Full name": "Taylor Keller", Email: demoEmail("Taylor Keller"), "Start date": addDays(40),
      "Business unit": "Technology", "Job title": "Data Engineer", Location: "Warsaw", Manager: m2,
    }),
    t("DEMO-103", "Jordan Sorin", r1, {
      "Full name": "Jordan Sorin", Email: demoEmail("Jordan Sorin"), "Start date": addDays(12),
      "Business unit": "Consulting", "Job title": "Associate", Location: "Yerevan", Manager: null,
    }),
    t("DEMO-104", "Riley Vance", r2, {
      "Full name": "Riley Vance", Email: null, "Start date": addDays(6),
      "Business unit": "Finance", "Job title": "Accountant", Location: "Milan", Manager: m3,
    }),
    t("DEMO-105", "Avery Marsh", r1, {
      "Full name": "Avery Marsh", Email: demoEmail("Avery Marsh"), "Start date": null,
      "Business unit": "Technology", "Job title": "Frontend Developer", Location: "Berlin", Manager: m2,
    }),
  ];
}

export async function createMockTicket(): Promise<string> {
  const db = getDb();
  await ensureMockSeed();
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(substring(key from 6)::int), 100)` }).from(mockJiraIssues);
  const key = `DEMO-${Number(max) + 1}`;
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  const [bu, role] = pick(BUS);
  const withEmail = Math.random() > 0.25;
  const lines: Record<string, string | null> = {
    "Full name": name,
    Email: withEmail ? demoEmail(name) : null,
    "Start date": addDays(5 + Math.floor(Math.random() * 80)),
    "Business unit": bu,
    "Job title": role,
    Location: pick(CITIES),
    Manager: Math.random() > 0.2 ? pick(DEMO_MANAGERS) : null,
  };
  await db.insert(mockJiraIssues).values({
    key,
    summary: `New hire: ${name}`,
    reporter: pick(DEMO_REQUESTERS),
    status: jiraStatusNames().open,
    description: Object.entries(lines).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n"),
  });
  return key;
}

/** Simulates the requester answering a "missing info" comment by filling the gaps. */
export async function answerMockTicket(key: string, values: Record<string, string>) {
  const db = getDb();
  const [row] = await db.select().from(mockJiraIssues).where(eq(mockJiraIssues.key, key));
  if (!row) throw new Error(`Dummy ticket ${key} not found`);
  const extra = Object.entries(values).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  if (!extra.length) return;
  await db
    .update(mockJiraIssues)
    .set({ description: [row.description, ...extra].filter(Boolean).join("\n"), updatedAt: new Date() })
    .where(eq(mockJiraIssues.key, key));
}

export async function getMockTicket(key: string) {
  const [row] = await getDb().select().from(mockJiraIssues).where(eq(mockJiraIssues.key, key));
  return row ?? null;
}

async function ensureMockSeed() {
  const db = getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(mockJiraIssues);
  if (n > 0) return;
  await db.insert(mockJiraIssues).values(seedTickets()).onConflictDoNothing();
}

const mockClient: JiraClient = {
  mode: "mock",
  async *search() {
    await ensureMockSeed();
    const rows = await getDb().select().from(mockJiraIssues).orderBy(asc(mockJiraIssues.createdAt), asc(mockJiraIssues.key));
    for (const r of rows) yield toIssue(r);
  },
  async get(key) {
    const row = await getMockTicket(key);
    if (!row) throw new Error(`Dummy ticket ${key} not found`);
    return toIssue(row);
  },
  async transition(key, statusName) {
    await getDb().update(mockJiraIssues).set({ status: statusName, updatedAt: new Date() }).where(eq(mockJiraIssues.key, key));
  },
  async comment(key, intro, lines) {
    const row = await getMockTicket(key);
    if (!row) throw new Error(`Dummy ticket ${key} not found`);
    const body = [intro, ...lines.map((l) => `• ${l}`)].join("\n");
    // Comments don't change the ticket's "updated" time used for change detection
    await getDb().update(mockJiraIssues).set({ comments: [...row.comments, { body, at: new Date().toISOString() }] }).where(eq(mockJiraIssues.key, key));
  },
  browseUrl() {
    return null;
  },
  async whoami() {
    await ensureMockSeed();
    return "Demo mode: using dummy tickets stored in the app. Add real Jira credentials and set JIRA_MODE=live to connect.";
  },
};
