import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { climateSurveyResponses, syncRuns, type SyncRun } from "@/db/schema";
import { fetchSheetRows, missingConfig, testConnection } from "./integrations/google-sheets";
import { emptyCounts, type SyncCounts } from "./integrations/types";

export { missingConfig, testConnection };

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function syncRows(): Promise<SyncCounts> {
  const c = emptyCounts();
  const rows = await fetchSheetRows();
  const headers = rows[0] ?? [];
  const timestampIdx = headers.findIndex((h) => /timestamp/i.test(h));
  const dataRows = rows.slice(1);
  c.fetched = dataRows.length;
  if (!dataRows.length) return c;

  const db = getDb();
  const existing = new Set(
    (await db.select({ row: climateSurveyResponses.sheetRow }).from(climateSurveyResponses)).map((r) => r.row),
  );

  const toInsert: (typeof climateSurveyResponses.$inferInsert)[] = [];
  dataRows.forEach((cells, i) => {
    const sheetRow = i + 2; // +1 for 0-index, +1 because row 1 is the header
    if (existing.has(sheetRow)) {
      c.unchanged++;
      return;
    }
    const answers: Record<string, unknown> = {};
    headers.forEach((h, k) => {
      if (k === timestampIdx) return;
      if (cells[k] !== undefined && cells[k] !== "") answers[h] = cells[k];
    });
    toInsert.push({
      sheetRow,
      submittedAt: timestampIdx >= 0 ? parseDate(cells[timestampIdx]) : null,
      answers,
    });
  });

  if (toInsert.length) {
    await db.insert(climateSurveyResponses).values(toInsert).onConflictDoNothing();
    c.created = toInsert.length;
  }
  return c;
}

/** Runs (or records as skipped, if unconfigured) one climate-survey sync, tracked the same way as the other integrations. */
export async function runClimateSurveySync(trigger: "cron" | "manual"): Promise<SyncRun> {
  const db = getDb();
  const missing = missingConfig();
  if (missing.length) {
    const [run] = await db
      .insert(syncRuns)
      .values({ source: "google_forms", trigger, status: "skipped", message: `Not configured: ${missing.join(", ")}`, finishedAt: new Date() })
      .returning();
    return run;
  }
  const [run] = await db.insert(syncRuns).values({ source: "google_forms", trigger }).returning();
  try {
    const c = await syncRows();
    const status = c.errors.length ? "partial" : "success";
    const [done] = await db
      .update(syncRuns)
      .set({ ...c, errors: c.errors.slice(0, 200), status, message: c.message ?? null, finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id))
      .returning();
    return done;
  } catch (e) {
    const [failed] = await db
      .update(syncRuns)
      .set({ status: "failed", message: (e as Error).message.slice(0, 1000), finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id))
      .returning();
    return failed;
  }
}

export type QuestionSummary =
  | { question: string; kind: "scale"; average: number; distribution: { option: string; count: number }[]; responses: number }
  | { question: string; kind: "choice"; distribution: { option: string; count: number }[]; responses: number }
  | { question: string; kind: "text"; responses: number };

/** Builds one summary per question found across all responses, picking a chart shape per question automatically. */
export async function climateSurveyReport(): Promise<{ totalResponses: number; questions: QuestionSummary[] }> {
  const db = getDb();
  const rows = await db.select().from(climateSurveyResponses);
  const byQuestion = new Map<string, string[]>();
  for (const r of rows) {
    for (const [q, v] of Object.entries(r.answers)) {
      if (v === null || v === undefined || v === "") continue;
      const arr = byQuestion.get(q) ?? [];
      arr.push(String(v));
      byQuestion.set(q, arr);
    }
  }

  const questions: QuestionSummary[] = [];
  for (const [question, values] of byQuestion) {
    const distinct = new Set(values);
    const allNumeric = values.every((v) => /^\d+(\.\d+)?$/.test(v.trim()));
    if (allNumeric && distinct.size <= 11) {
      const nums = values.map(Number);
      const average = nums.reduce((a, b) => a + b, 0) / nums.length;
      const counts = new Map<string, number>();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      const distribution = [...counts.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([option, count]) => ({ option, count }));
      questions.push({ question, kind: "scale", average, distribution, responses: values.length });
    } else if (distinct.size <= 10) {
      const counts = new Map<string, number>();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      const distribution = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([option, count]) => ({ option, count }));
      questions.push({ question, kind: "choice", distribution, responses: values.length });
    } else {
      questions.push({ question, kind: "text", responses: values.length });
    }
  }
  return { totalResponses: rows.length, questions };
}
