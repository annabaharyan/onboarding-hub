import type { EmployeeWriter } from "../employee-writer";

export type ConnectorId = "leapsome" | "timebase" | "jira";

export type SyncCounts = { fetched: number; created: number; updated: number; unchanged: number; skipped: number; errors: string[]; message?: string };

export type SyncContext = { writer: EmployeeWriter; runId: number };

export interface Connector {
  id: ConnectorId;
  label: string;
  description: string;
  envVars: string[];
  missingConfig(): string[];
  test(): Promise<string>;
  sync(ctx: SyncContext): Promise<SyncCounts>;
}

export const emptyCounts = (): SyncCounts => ({ fetched: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, errors: [] });

export function tally(c: SyncCounts, r: { result: "created" | "updated" | "unchanged" | "skipped"; issues: string[] }, label: string) {
  c[r.result]++;
  for (const i of r.issues) if (c.errors.length < 200) c.errors.push(`${label}: ${i}`);
}
