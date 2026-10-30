import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { employees, employeeChanges, monthlySnapshots, type Employee } from "@/db/schema";
import { FIELD_MAP, SOURCE_OWNERSHIP, type EmployeeField } from "./fields";
import { countryToCode, splitName, todayIso } from "./normalize";

export type WriteSource = "excel" | "manual" | "leapsome" | "timebase" | "jira";
export type Incoming = Partial<Record<EmployeeField, string | null>> & { extra?: Record<string, unknown> };
export type WriteResult = {
  result: "created" | "updated" | "unchanged" | "skipped";
  employeeId?: number;
  changes: { field: string; from: string | null; to: string | null }[];
  issues: string[];
};

type Options = {
  source: WriteSource;
  syncRunId?: number;
  importBatchId?: number;
  changedBy?: string;
  /** Create a new employee when no match is found (default true). */
  createIfMissing?: boolean;
  /** Compute the outcome without writing anything (used for import preview). */
  dryRun?: boolean;
  /** Apply to this exact employee instead of matching (manual edits). */
  matchId?: number;
  /**
   * Excel only. "respect_sources" (default): fields owned by Leapsome/Timebase are only filled when empty
   * for people those systems already manage, so an old file can't revert fresher system data.
   * "overwrite": the file wins everywhere (except manually locked fields).
   */
  excelMode?: "respect_sources" | "overwrite";
};

const lc = (s: string | null | undefined) => (s ? s.trim().toLowerCase() : "");

/**
 * Loads all employees once and applies incoming records with consistent matching
 * and conflict rules. One instance per import / sync run.
 */
export type DbLike = Pick<ReturnType<typeof getDb>, "select" | "insert" | "update" | "execute">;

export class EmployeeWriter {
  constructor(private db: DbLike) {}
  private byId = new Map<number, Employee>();
  private idx = {
    leapsomeId: new Map<string, number>(),
    timebaseId: new Map<string, number>(),
    employeeCode: new Map<string, number>(),
    email: new Map<string, number>(),
    nameStart: new Map<string, number>(),
    name: new Map<string, number[]>(),
  };
  private tempId = -1;
  private snapshotBuffer: (typeof monthlySnapshots.$inferInsert)[] = [];

  static async create(db: DbLike = getDb()) {
    const w = new EmployeeWriter(db);
    const rows = await db.select().from(employees);
    rows.forEach((r) => w.index(r));
    return w;
  }

  private index(e: Employee) {
    this.byId.set(e.id, e);
    if (e.leapsomeId) this.idx.leapsomeId.set(e.leapsomeId, e.id);
    if (e.timebaseId) this.idx.timebaseId.set(e.timebaseId, e.id);
    if (e.employeeCode) this.idx.employeeCode.set(lc(e.employeeCode), e.id);
    if (e.email) this.idx.email.set(lc(e.email), e.id);
    if (e.fullName && e.startDate) this.idx.nameStart.set(`${lc(e.fullName)}|${e.startDate}`, e.id);
    if (e.fullName) {
      const list = this.idx.name.get(lc(e.fullName)) ?? [];
      if (!list.includes(e.id)) list.push(e.id);
      this.idx.name.set(lc(e.fullName), list);
    }
  }

  get all() {
    return [...this.byId.values()];
  }

  /** Strong identifiers first, then name + start date. Name alone only matches when unique and the source isn't creating. */
  match(inc: Incoming, nameOnly: "never" | "unique" | "uniqueWithoutEmail" = "never"): Employee | undefined {
    const tryKey = (m: Map<string, number>, k?: string | null) => (k ? m.get(k) : undefined);
    const id =
      tryKey(this.idx.leapsomeId, inc.leapsomeId) ??
      tryKey(this.idx.timebaseId, inc.timebaseId) ??
      tryKey(this.idx.employeeCode, lc(inc.employeeCode)) ??
      tryKey(this.idx.email, lc(inc.email)) ??
      (inc.fullName && inc.startDate ? this.idx.nameStart.get(`${lc(inc.fullName)}|${inc.startDate}`) : undefined);
    if (id !== undefined) return this.byId.get(id);
    if (nameOnly !== "never" && inc.fullName) {
      const list = this.idx.name.get(lc(inc.fullName));
      if (list?.length === 1) {
        const cand = this.byId.get(list[0])!;
        if (inc.email && cand.email && lc(inc.email) !== lc(cand.email)) return undefined; // conflicting emails → different people
        // An HRIS record with an email may only claim a same-name person who has no email yet
        if (nameOnly === "unique" || (!cand.email && !cand.leapsomeId)) return cand;
      }
    }
    return undefined;
  }

  private derive(inc: Incoming): Incoming {
    const out: Incoming = { ...inc };
    if (!out.fullName && (out.firstName || out.lastName))
      out.fullName = [out.firstName, out.lastName].filter(Boolean).join(" ");
    if (out.fullName && !out.firstName && !out.lastName) Object.assign(out, splitName(out.fullName));
    if (out.country && !out.countryCode) out.countryCode = countryToCode(out.country);
    if (out.email) out.email = out.email.toLowerCase();
    return out;
  }

  private canWrite(field: EmployeeField, existing: Employee, source: WriteSource, incomingValue: string | null, excelMode: Options["excelMode"] = "respect_sources"): boolean {
    const current = existing[field] as string | null;
    if (source === "manual") return true;
    if (existing.lockedFields.includes(field)) return false;
    if (source === "excel") {
      if (excelMode === "overwrite") return true;
      const managedBy = (["leapsome", "timebase"] as const).filter((s) => existing.sources.includes(s) && (SOURCE_OWNERSHIP[s] as string[]).includes(field));
      return managedBy.length === 0 || current === null || current === "";
    }
    if ((SOURCE_OWNERSHIP[source] as string[]).includes(field)) {
      if (field === "status") return this.statusTransitionAllowed(existing, incomingValue);
      return true;
    }
    return current === null || current === "";
  }

  /** Avoid HRIS "active/inactive" flattening more specific lifecycle states we track. */
  private statusTransitionAllowed(e: Employee, next: string | null): boolean {
    if (!next) return false;
    if (next === "inactive" && (e.status === "offboarded" || e.status === "offboarding")) return false;
    if (next === "active" && (e.status === "onboarding" || e.status === "pre_onboarding")) {
      // still in probation → keep onboarding; otherwise promote to active
      return !e.probationEndDate || e.probationEndDate <= todayIso();
    }
    if (next === "active" && e.status === "on_leave") return true;
    return true;
  }

  async apply(raw: Incoming, opts: Options): Promise<WriteResult> {
    const inc = this.derive(raw);
    const issues: string[] = [];
    const existing = opts.matchId !== undefined ? this.byId.get(opts.matchId) : this.match(inc, opts.source === "timebase" ? "unique" : opts.source === "leapsome" ? "uniqueWithoutEmail" : "never");
    if (opts.matchId !== undefined && !existing) return { result: "skipped", changes: [], issues: ["Employee not found"] };

    if (!existing) {
      if (opts.createIfMissing === false) {
        return { result: "skipped", changes: [], issues: [`No matching employee for ${inc.email ?? inc.fullName ?? inc.timebaseId ?? "record"}`] };
      }
      if (!inc.fullName) return { result: "skipped", changes: [], issues: ["Missing name — row skipped"] };
      // uniqueness guards
      for (const k of ["email", "employeeCode", "leapsomeId", "timebaseId"] as const) {
        const v = inc[k];
        const m = k === "email" || k === "employeeCode" ? this.idx[k].get(lc(v)) : v ? this.idx[k].get(v) : undefined;
        if (v && m !== undefined) {
          issues.push(`${FIELD_MAP[k].label} "${v}" already belongs to another employee — ignored`);
          inc[k] = null;
        }
      }
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(inc)) if (k !== "extra" && v !== undefined && v !== null) values[k] = v;
      const record = {
        ...values,
        fullName: inc.fullName,
        status: (inc.status as Employee["status"]) ?? (opts.source === "jira" ? "pre_onboarding" : "active"),
        sources: [opts.source],
        extra: inc.extra ?? {},
        lastSyncedAt: opts.source === "excel" || opts.source === "manual" ? null : new Date(),
      } as typeof employees.$inferInsert;

      let created: Employee;
      if (opts.dryRun) {
        created = { ...(record as Employee), id: this.tempId--, lockedFields: [], createdAt: new Date(), updatedAt: new Date() };
      } else {
        [created] = await this.db.insert(employees).values(record).returning();
        await this.db.insert(employeeChanges).values({
          employeeId: created.id,
          field: "*",
          oldValue: null,
          newValue: "created",
          source: opts.source,
          syncRunId: opts.syncRunId,
          importBatchId: opts.importBatchId,
          changedBy: opts.changedBy,
        });
      }
      this.index(created);
      return { result: "created", employeeId: created.id, changes: [], issues };
    }

    const patch: Record<string, unknown> = {};
    const changes: WriteResult["changes"] = [];
    for (const [k, raw] of Object.entries(inc)) {
      if (k === "extra" || typeof raw !== "string" || raw === "") continue; // absence never clears data
      const v = raw;
      const field = k as EmployeeField;
      if (!(field in FIELD_MAP)) continue;
      const cur = (existing[field] as string | null) ?? null;
      if (cur === v || (field === "email" && lc(cur) === lc(v))) continue;
      if (!this.canWrite(field, existing, opts.source, v, opts.excelMode)) continue;
      // uniqueness guard on update
      if (field === "email" || field === "employeeCode") {
        const other = this.idx[field].get(lc(v));
        if (other !== undefined && other !== existing.id) {
          issues.push(`${FIELD_MAP[field].label} "${v}" belongs to another employee — not changed`);
          continue;
        }
      }
      if (field === "leapsomeId" || field === "timebaseId") {
        const other = this.idx[field].get(v);
        if (other !== undefined && other !== existing.id) continue;
      }
      patch[field] = v;
      changes.push({ field, from: cur, to: v });
    }

    let extraChanged = false;
    if (inc.extra && Object.keys(inc.extra).length) {
      const merged = { ...existing.extra };
      for (const [k, v] of Object.entries(inc.extra)) {
        if (v === null || v === undefined || v === "") continue;
        if (JSON.stringify(merged[k]) !== JSON.stringify(v)) {
          merged[k] = v;
          extraChanged = true;
        }
      }
      if (extraChanged) patch.extra = merged;
    }

    const sources = existing.sources.includes(opts.source) ? existing.sources : [...existing.sources, opts.source];
    const touchedSources = sources !== existing.sources;
    if (!changes.length && !extraChanged && !touchedSources) {
      if (!opts.dryRun && opts.source !== "excel" && opts.source !== "manual")
        await this.db.update(employees).set({ lastSyncedAt: new Date() }).where(eq(employees.id, existing.id));
      return { result: "unchanged", employeeId: existing.id, changes: [], issues };
    }

    patch.sources = sources;
    patch.updatedAt = new Date();
    if (opts.source !== "excel" && opts.source !== "manual") patch.lastSyncedAt = new Date();
    if (opts.source === "manual") {
      patch.lockedFields = [...new Set([...existing.lockedFields, ...changes.map((c) => c.field)])];
    }

    const updated = { ...existing, ...patch } as Employee;
    if (!opts.dryRun) {
      await this.db.update(employees).set(patch).where(eq(employees.id, existing.id));
      if (changes.length)
        await this.db.insert(employeeChanges).values(
          changes.map((c) => ({
            employeeId: existing.id,
            field: c.field,
            oldValue: c.from,
            newValue: c.to,
            source: opts.source,
            syncRunId: opts.syncRunId,
            importBatchId: opts.importBatchId,
            changedBy: opts.changedBy,
          })),
        );
    }
    this.index(updated);
    return { result: changes.length || extraChanged ? "updated" : "unchanged", employeeId: existing.id, changes, issues };
  }

  queueSnapshot(s: typeof monthlySnapshots.$inferInsert) {
    if (s.employeeId > 0) this.snapshotBuffer.push(s);
  }

  async flushSnapshots(): Promise<number> {
    const buf = this.snapshotBuffer;
    this.snapshotBuffer = [];
    let n = 0;
    for (let i = 0; i < buf.length; i += 500) {
      const chunk = buf.slice(i, i + 500);
      await this.db
        .insert(monthlySnapshots)
        .values(chunk)
        .onConflictDoUpdate({
          target: [monthlySnapshots.employeeId, monthlySnapshots.month],
          set: {
            value: sql`excluded.value`,
            status: sql`excluded.status`,
            businessUnit: sql`excluded.business_unit`,
            source: sql`excluded.source`,
          },
        });
      n += chunk.length;
    }
    return n;
  }
}

/** Upserts the current month-end snapshot for every employee (run by the daily sync). */
export async function snapshotCurrentMonth() {
  const db = getDb();
  await db.execute(sql`
    insert into monthly_snapshots (employee_id, month, value, status, business_unit, source)
    select id, (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
           case when status in ('active','onboarding','on_leave','offboarding') then '1' else '0' end,
           status::text, business_unit, 'system'
    from employees
    where (start_date is null or start_date <= (date_trunc('month', current_date) + interval '1 month - 1 day')::date)
      and (end_date is null or end_date >= date_trunc('month', current_date)::date)
    on conflict (employee_id, month) do update
      set status = excluded.status, business_unit = excluded.business_unit, value = excluded.value
      where monthly_snapshots.source = 'system'
  `);
}
