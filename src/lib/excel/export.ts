import ExcelJS from "exceljs";
import { and, asc, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { employees, monthlySnapshots, onboardingRequests, employeeChanges } from "@/db/schema";
import { FIELD_MAP, STATUS_LABEL, type EmployeeField, type Status } from "../fields";
import { buildWhere, type EmployeeFilters } from "../queries";

export type ExportOptions = {
  columns: EmployeeField[];
  includeExtra: boolean;
  includeSnapshots: boolean;
  includeSummary: boolean;
  includeOnboarding: boolean;
  includeChanges: boolean;
  snapshotFrom?: string;
  snapshotTo?: string;
};

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle" };
  row.height = 20;
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
  if (ws.columnCount > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

function autoWidth(ws: ExcelJS.Worksheet) {
  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: false }, (c) => {
      const len = c.value instanceof Date ? 10 : String(c.value ?? "").length;
      if (len > max) max = len;
    });
    col.width = Math.min(45, max + 2);
  });
}

const toDate = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

export async function buildExport(filters: EmployeeFilters, opts: ExportOptions): Promise<Buffer> {
  const db = getDb();
  const where = buildWhere(filters);
  const rows = await db.select().from(employees).where(where).orderBy(asc(employees.fullName));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Onboarding Hub";
  wb.created = new Date();

  // ── Employees ──
  const ws = wb.addWorksheet("Employees");
  const extraKeys = opts.includeExtra ? [...new Set(rows.flatMap((r) => Object.keys(r.extra ?? {})))].sort() : [];
  ws.columns = [
    ...opts.columns.map((c) => ({ header: FIELD_MAP[c].label, key: c })),
    { header: "Sources", key: "_sources" },
    { header: "Last updated", key: "_updated" },
    ...extraKeys.map((k) => ({ header: k, key: `x:${k}` })),
  ];
  for (const r of rows) {
    const record: Record<string, unknown> = {};
    for (const c of opts.columns) {
      const def = FIELD_MAP[c];
      const v = r[c] as string | null;
      record[c] = def.type === "date" ? toDate(v) : def.type === "status" ? STATUS_LABEL[v as Status] ?? v : v;
    }
    record._sources = r.sources.join(", ");
    record._updated = r.updatedAt;
    for (const k of extraKeys) record[`x:${k}`] = r.extra?.[k] ?? null;
    ws.addRow(record);
  }
  opts.columns.forEach((c, i) => {
    if (FIELD_MAP[c].type === "date") ws.getColumn(i + 1).numFmt = "dd.mm.yyyy";
  });
  ws.getColumn(opts.columns.length + 2).numFmt = "dd.mm.yyyy hh:mm";
  styleHeader(ws);
  autoWidth(ws);

  // ── Monthly headcount (pivot, like the original file's technical columns) ──
  if (opts.includeSnapshots && rows.length) {
    const ids = rows.map((r) => r.id);
    const conds = [inArray(monthlySnapshots.employeeId, ids)];
    if (opts.snapshotFrom) conds.push(gte(monthlySnapshots.month, opts.snapshotFrom));
    if (opts.snapshotTo) conds.push(lte(monthlySnapshots.month, opts.snapshotTo));
    const snaps: { employeeId: number; month: string; value: string | null }[] = [];
    for (let i = 0; i < ids.length; i += 5000) {
      const chunk = ids.slice(i, i + 5000);
      const c2 = [inArray(monthlySnapshots.employeeId, chunk), ...conds.slice(1)];
      snaps.push(...(await db.select({ employeeId: monthlySnapshots.employeeId, month: monthlySnapshots.month, value: monthlySnapshots.value }).from(monthlySnapshots).where(and(...c2))));
    }
    const months = [...new Set(snaps.map((s) => s.month))].sort();
    const byEmp = new Map<number, Map<string, string | null>>();
    for (const s of snaps) {
      if (!byEmp.has(s.employeeId)) byEmp.set(s.employeeId, new Map());
      byEmp.get(s.employeeId)!.set(s.month, s.value);
    }
    const ms = wb.addWorksheet("Monthly headcount");
    ms.columns = [
      { header: "Employee ID", key: "code" },
      { header: "Full name", key: "name" },
      { header: "Business unit", key: "bu" },
      { header: "Status", key: "status" },
      ...months.map((m) => ({ header: m.split("-").reverse().join("."), key: m })),
    ];
    for (const r of rows) {
      const m = byEmp.get(r.id);
      const rec: Record<string, unknown> = { code: r.employeeCode, name: r.fullName, bu: r.businessUnit, status: STATUS_LABEL[r.status] };
      for (const mo of months) {
        const v = m?.get(mo) ?? null;
        rec[mo] = v !== null && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
      }
      ms.addRow(rec);
    }
    if (months.length) {
      const total: Record<string, unknown> = { name: "TOTAL" };
      months.forEach((mo, i) => {
        const col = ms.getColumn(5 + i).letter;
        total[mo] = { formula: `SUM(${col}2:${col}${rows.length + 1})` };
      });
      const tr = ms.addRow(total);
      tr.font = { bold: true };
    }
    styleHeader(ms);
    autoWidth(ms);
  }

  // ── Summary ──
  if (opts.includeSummary) {
    const sm = wb.addWorksheet("Summary");
    sm.columns = [{ header: "Business unit", key: "bu" }, ...Object.entries(STATUS_LABEL).map(([k, l]) => ({ header: l, key: k })), { header: "Total", key: "total" }];
    const grouped = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const bu = r.businessUnit ?? "(none)";
      const g = grouped.get(bu) ?? {};
      g[r.status] = (g[r.status] ?? 0) + 1;
      g.total = (g.total ?? 0) + 1;
      grouped.set(bu, g);
    }
    [...grouped.entries()].sort().forEach(([bu, g]) => sm.addRow({ bu, ...g }));
    const last = grouped.size + 1;
    const totalRow: Record<string, unknown> = { bu: "TOTAL" };
    sm.columns.slice(1).forEach((_, i) => {
      const L = sm.getColumn(i + 2).letter;
      totalRow[sm.columns[i + 1].key as string] = { formula: `SUM(${L}2:${L}${last})` };
    });
    sm.addRow(totalRow).font = { bold: true };
    sm.addRow({});
    sm.addRow({ bu: `Exported ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC — ${rows.length} employees` });
    styleHeader(sm);
    autoWidth(sm);
  }

  if (opts.includeOnboarding) {
    const ob = await db.select().from(onboardingRequests).orderBy(asc(onboardingRequests.startDate));
    const os = wb.addWorksheet("Onboarding requests");
    os.columns = [
      { header: "Jira", key: "jiraKey" }, { header: "Jira status", key: "jiraStatus" }, { header: "Name", key: "fullName" },
      { header: "Email", key: "email" }, { header: "Start date", key: "startDate" }, { header: "Business unit", key: "businessUnit" },
      { header: "Job title", key: "jobTitle" }, { header: "Location", key: "location" }, { header: "Manager", key: "manager" },
      { header: "Validation", key: "validationStatus" }, { header: "Missing", key: "missing" }, { header: "Notes", key: "validationNotes" },
    ];
    ob.forEach((o) => os.addRow({ ...o, startDate: toDate(o.startDate), missing: o.missingFields.join(", ") }));
    os.getColumn(5).numFmt = "dd.mm.yyyy";
    styleHeader(os);
    autoWidth(os);
  }

  if (opts.includeChanges && rows.length) {
    const ids = rows.map((r) => r.id);
    const ch = await db
      .select({ c: employeeChanges, name: employees.fullName })
      .from(employeeChanges)
      .innerJoin(employees, sql`${employees.id} = ${employeeChanges.employeeId}`)
      .where(and(inArray(employeeChanges.employeeId, ids.slice(0, 30000)), gte(employeeChanges.changedAt, new Date(Date.now() - 90 * 864e5))))
      .orderBy(asc(employeeChanges.changedAt))
      .limit(50000);
    const cs = wb.addWorksheet("Change log (90d)");
    cs.columns = [
      { header: "When", key: "at" }, { header: "Employee", key: "name" }, { header: "Field", key: "field" },
      { header: "Old value", key: "old" }, { header: "New value", key: "new" }, { header: "Source", key: "source" },
    ];
    ch.forEach(({ c, name }) => cs.addRow({ at: c.changedAt, name, field: c.field === "*" ? "Record created" : FIELD_MAP[c.field as EmployeeField]?.label ?? c.field, old: c.oldValue, new: c.newValue, source: c.source }));
    cs.getColumn(1).numFmt = "dd.mm.yyyy hh:mm";
    styleHeader(cs);
    autoWidth(cs);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Blank template with the canonical headers, for teams starting a new file. */
export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Employees");
  ws.columns = Object.values(FIELD_MAP)
    .filter((f) => !["leapsomeId", "timebaseId", "countryCode"].includes(f.key))
    .map((f) => ({ header: f.label, key: f.key, width: 18 }));
  ws.addRow({ employeeCode: "E-0001", fullName: "Jane Doe", email: "jane.doe@company.com", gender: "Female", status: "Active", businessUnit: "Engineering", startDate: new Date("2025-01-15T00:00:00Z"), location: "Yerevan", country: "Armenia" });
  styleHeader(ws);
  const notes = wb.addWorksheet("How to use");
  notes.addRows([
    ["Required: Full name (or First + Last name). Strongly recommended: Email or Employee ID for reliable matching."],
    ["Dates: any common format (31.12.2024, 2024-12-31, Excel dates). Ambiguous dates are read day-first."],
    ["Monthly headcount: add columns whose header is a month-end date (e.g. 31.12.2024 or Dec 2024)."],
    ["Any other column is kept as an extra field and included in exports."],
    ["Blank cells never erase existing data."],
  ]);
  notes.getColumn(1).width = 110;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
