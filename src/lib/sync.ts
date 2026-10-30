import { desc, eq, sql } from "drizzle-orm";
import { getDb, getPool } from "@/db";
import { syncRuns, type SyncRun } from "@/db/schema";
import { EmployeeWriter, snapshotCurrentMonth } from "./employee-writer";
import { leapsome } from "./integrations/leapsome";
import { timebase } from "./integrations/timebase";
import { jira } from "./integrations/jira";
import type { Connector, ConnectorId } from "./integrations/types";

export const CONNECTORS: Record<ConnectorId, Connector> = { leapsome, timebase, jira };
const LOCK_KEY = 7_311_204; // arbitrary app-wide advisory lock id

export function defaultSources(): ConnectorId[] {
  // Leapsome first (creates/updates people), then Timebase (enriches), then Jira (new joiners)
  return (process.env.SYNC_SOURCES || "leapsome,timebase,jira")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ConnectorId => s in CONNECTORS);
}

export type SyncReport = { locked: boolean; runs: SyncRun[] };

/**
 * Runs the given connectors sequentially. A Postgres advisory lock guarantees only one sync
 * at a time across all app instances (cron + manual clicks). Each source is isolated:
 * one failing source never stops the others.
 */
export async function runSync(sources: ConnectorId[], trigger: "cron" | "manual"): Promise<SyncReport> {
  const pool = getPool();
  const lockClient = await pool.connect();
  try {
    const { rows } = await lockClient.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [LOCK_KEY]);
    if (!rows[0].ok) return { locked: true, runs: [] };

    const db = getDb();
    // Recover runs left "running" by a crashed process
    await db.update(syncRuns).set({ status: "failed", message: "Interrupted", finishedAt: new Date() }).where(sql`${syncRuns.status} = 'running' and ${syncRuns.startedAt} < now() - interval '2 hours'`);

    const writer = await EmployeeWriter.create();
    const runs: SyncRun[] = [];
    for (const id of sources) {
      const connector = CONNECTORS[id];
      const missing = connector.missingConfig();
      if (missing.length) {
        const [run] = await db
          .insert(syncRuns)
          .values({ source: id, trigger, status: "skipped", message: `Not configured: ${missing.join(", ")}`, finishedAt: new Date() })
          .returning();
        runs.push(run);
        continue;
      }
      const [run] = await db.insert(syncRuns).values({ source: id, trigger }).returning();
      try {
        const c = await connector.sync({ writer, runId: run.id });
        const status = c.errors.length ? "partial" : "success";
        const [done] = await db
          .update(syncRuns)
          .set({ ...c, errors: c.errors.slice(0, 200), status, message: c.message ?? null, finishedAt: new Date() })
          .where(eq(syncRuns.id, run.id))
          .returning();
        runs.push(done);
      } catch (e) {
        const [failed] = await db
          .update(syncRuns)
          .set({ status: "failed", message: (e as Error).message.slice(0, 1000), finishedAt: new Date() })
          .where(eq(syncRuns.id, run.id))
          .returning();
        runs.push(failed);
      }
    }
    await snapshotCurrentMonth();
    return { locked: false, runs };
  } finally {
    await lockClient.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    lockClient.release();
  }
}

export async function lastRuns(limit = 30) {
  return getDb().select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(limit);
}

export async function latestRunPerSource() {
  const rows = await getDb().execute<SyncRun & { started_at: Date }>(sql`
    select distinct on (source) * from sync_runs order by source, started_at desc
  `);
  const out: Partial<Record<string, { status: string; startedAt: Date; finishedAt: Date | null; message: string | null; created: number; updated: number; fetched: number }>> = {};
  for (const r of rows.rows as unknown as Record<string, unknown>[])
    out[r.source as string] = {
      status: r.status as string,
      startedAt: r.started_at as Date,
      finishedAt: (r.finished_at as Date) ?? null,
      message: (r.message as string) ?? null,
      created: r.created as number,
      updated: r.updated as number,
      fetched: r.fetched as number,
    };
  return out;
}
