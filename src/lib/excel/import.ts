import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { getDb } from "@/db";
import { importBatches, type ImportIssue } from "@/db/schema";
import { FIELDS, FIELD_MAP, type EmployeeField } from "../fields";
import { cleanEmail, cleanText, monthEnd, normHeader, parseDate, parseGender, parseStatus, todayIso } from "../normalize";
import { EmployeeWriter, type DbLike, type Incoming } from "../employee-writer";

/** Mapping target for a column: an employee field, a monthly snapshot column, kept as extra, or ignored. */
export type ColumnTarget = EmployeeField | "snapshot" | "extra" | "ignore";

export type ColumnInfo = {
  index: number; // 1-based column index
  header: string;
  target: ColumnTarget;
  snapshotMonth?: string; // YYYY-MM-DD month end, when target = snapshot
  sample: string[];
};

export type ParsedSheet = {
  sheets: string[];
  sheetName: string;
  headerRow: number;
  columns: ColumnInfo[];
  rows: { rowNumber: number; cells: unknown[] }[];
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function headerAsMonth(raw: unknown): string | null {
  if (raw instanceof Date) return monthEnd(parseDate(raw)!);
  const s = cleanText(raw);
  if (!s) return null;
  const m = s.toLowerCase().match(/^([a-z]{3})[a-z]*[\s\-'.,/]*(\d{2,4})$/);
  if (m && MONTHS.includes(m[1])) {
    let y = +m[2];
    if (y < 100) y += 2000;
    return monthEnd(`${y}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}-01`);
  }
  if (/^\d{4}[-/.]\d{1,2}$/.test(s)) {
    const [y, mo] = s.split(/[-/.]/).map(Number);
    return monthEnd(`${y}-${String(mo).padStart(2, "0")}-01`);
  }
  if (/\d/.test(s) && /^[\d\s\-/.]+$/.test(s)) {
    const d = parseDate(s);
    return d ? monthEnd(d) : null;
  }
  return null;
}

export function suggestTarget(header: unknown): { target: ColumnTarget; snapshotMonth?: string } {
  const month = headerAsMonth(header);
  if (month) return { target: "snapshot", snapshotMonth: month };
  const h = normHeader(cleanText(header));
  if (!h) return { target: "ignore" };
  for (const f of FIELDS) if (f.synonyms.includes(h) || normHeader(f.label) === h || normHeader(f.key) === h) return { target: f.key };
  // loose contains-match for longer headers like "Start date (first working day)"
  for (const f of FIELDS)
    for (const syn of f.synonyms) if (syn.length > 4 && h.startsWith(syn + " ")) return { target: f.key };
  return { target: "extra" };
}

async function loadWorkbook(buffer: ArrayBuffer, fileName: string) {
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(fileName)) {
    await wb.csv.read(Readable.from(Buffer.from(buffer)), { parserOptions: { delimiter: undefined } } as never);
  } else {
    await wb.xlsx.load(buffer as never);
  }
  return wb;
}

function cellValue(c: ExcelJS.Cell): unknown {
  const v = c.value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return (v as { result: unknown }).result;
    if ("text" in v) return (v as { text: unknown }).text;
    if ("richText" in v) return cleanText(v);
    if ("error" in v) return null;
  }
  return v;
}

export async function parseSheet(buffer: ArrayBuffer, fileName: string, sheet?: string, headerRowOverride?: number): Promise<ParsedSheet> {
  const wb = await loadWorkbook(buffer, fileName);
  const sheets = wb.worksheets.filter((w) => w.state !== "veryHidden").map((w) => w.name);
  if (!sheets.length) throw new Error("The file has no worksheets.");
  // Pick requested sheet, else the one with the most rows
  const ws =
    (sheet && wb.getWorksheet(sheet)) ||
    wb.worksheets.reduce((a, b) => (b.actualRowCount > a.actualRowCount ? b : a));

  // Header row detection: the row (within the first 20) whose cells best match known fields
  let headerRow = headerRowOverride ?? 1;
  if (!headerRowOverride) {
    let best = -1;
    for (let r = 1; r <= Math.min(20, ws.rowCount); r++) {
      const row = ws.getRow(r);
      let score = 0;
      row.eachCell((c) => {
        const t = suggestTarget(cellValue(c)).target;
        if (t !== "extra" && t !== "ignore") score += t === "snapshot" ? 0.25 : 2;
        else if (typeof cellValue(c) === "string") score += 0.1;
      });
      if (score > best) {
        best = score;
        headerRow = r;
      }
    }
  }

  const hdr = ws.getRow(headerRow);
  const colCount = Math.max(ws.columnCount, hdr.cellCount);
  const columns: ColumnInfo[] = [];
  const used = new Set<string>();
  for (let c = 1; c <= colCount; c++) {
    const raw = cellValue(hdr.getCell(c));
    const header = raw instanceof Date ? parseDate(raw)! : cleanText(raw) ?? "";
    if (!header) continue;
    const suggested = suggestTarget(raw);
    let target = suggested.target;
    const snapshotMonth = suggested.snapshotMonth;
    // the first column wins when two headers map to the same field
    if (target !== "extra" && target !== "ignore" && target !== "snapshot") {
      if (used.has(target)) target = "extra";
      else used.add(target);
    }
    columns.push({ index: c, header, target, snapshotMonth, sample: [] });
  }

  const rows: ParsedSheet["rows"] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row.hasValues) continue;
    const cells: unknown[] = [];
    let nonEmpty = 0;
    for (const col of columns) {
      const v = cellValue(row.getCell(col.index));
      cells.push(v);
      if (cleanText(v instanceof Date ? v.toISOString() : v)) nonEmpty++;
    }
    if (!nonEmpty) continue;
    rows.push({ rowNumber: r, cells });
  }
  columns.forEach((col, i) => {
    col.sample = rows
      .slice(0, 50)
      .map((r) => r.cells[i])
      .map((v) => (v instanceof Date ? parseDate(v)! : cleanText(v) ?? ""))
      .filter(Boolean)
      .slice(0, 3);
  });
  return { sheets, sheetName: ws.name, headerRow, columns, rows };
}

function rowToIncoming(columns: ColumnInfo[], cells: unknown[], rowNumber: number, issues: ImportIssue[]) {
  const inc: Incoming = {};
  const extra: Record<string, unknown> = {};
  const snapshots: { month: string; value: string }[] = [];
  columns.forEach((col, i) => {
    const v = cells[i];
    if (col.target === "ignore") return;
    if (col.target === "snapshot" && col.snapshotMonth) {
      const s = v instanceof Date ? parseDate(v) : cleanText(v);
      if (s) snapshots.push({ month: col.snapshotMonth, value: s });
      return;
    }
    if (col.target === "extra") {
      const s = v instanceof Date ? parseDate(v) : typeof v === "number" ? v : cleanText(v);
      if (s !== null && s !== undefined && s !== "") extra[col.header] = s;
      return;
    }
    const def = FIELD_MAP[col.target as EmployeeField];
    if (!def) return;
    if (def.type === "date") {
      const d = parseDate(v);
      if (v !== null && v !== undefined && cleanText(v instanceof Date ? "d" : v) && !d)
        issues.push({ row: rowNumber, level: "warning", message: `${def.label}: couldn't read date "${cleanText(v)}"` });
      inc[def.key] = d;
    } else if (def.type === "status") {
      const s = parseStatus(v);
      if (cleanText(v) && !s) {
        issues.push({ row: rowNumber, level: "warning", message: `Status "${cleanText(v)}" not recognised — kept in extra columns` });
        extra[col.header] = cleanText(v);
      }
      inc.status = s;
    } else if (def.key === "email") {
      const e = cleanEmail(v);
      if (cleanText(v) && !e) issues.push({ row: rowNumber, level: "warning", message: `Invalid email "${cleanText(v)}"` });
      inc.email = e;
    } else if (def.key === "gender") {
      inc.gender = parseGender(v);
    } else {
      const s = typeof v === "number" ? String(v) : cleanText(v);
      inc[def.key] = s;
    }
  });
  // Infer lifecycle status from dates when the file has none
  if (!inc.status) {
    const today = todayIso();
    if (inc.endDate && inc.endDate < today) inc.status = "offboarded";
    else if (inc.endDate) inc.status = "offboarding";
    else if (inc.startDate && inc.startDate > today) inc.status = "pre_onboarding";
  }
  if (Object.keys(extra).length) inc.extra = extra;
  return { inc, snapshots };
}

export type ImportSummary = {
  batchId?: number;
  dryRun: boolean;
  fileName: string;
  sheetName: string;
  totalRows: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  snapshots: number;
  snapshotMonths: number;
  issues: ImportIssue[];
  sampleChanges: { row: number; name: string; result: string; changes: { field: string; from: string | null; to: string | null }[] }[];
};

export async function runImport(opts: {
  buffer: ArrayBuffer;
  fileName: string;
  sheet?: string;
  headerRow?: number;
  overrides?: Record<string, ColumnTarget>; // column index → target
  dryRun: boolean;
  excelMode?: "respect_sources" | "overwrite";
}): Promise<{ parsed: Omit<ParsedSheet, "rows">; summary: ImportSummary }> {
  const parsed = await parseSheet(opts.buffer, opts.fileName, opts.sheet, opts.headerRow);
  if (opts.overrides) {
    for (const col of parsed.columns) {
      const o = opts.overrides[String(col.index)];
      if (!o) continue;
      col.target = o;
      if (o === "snapshot" && !col.snapshotMonth) {
        const m = headerAsMonth(col.header);
        if (m) col.snapshotMonth = m;
        else col.target = "extra";
      }
    }
  }
  const issues: ImportIssue[] = [];
  const mapped = new Set(parsed.columns.map((c) => c.target));
  if (!mapped.has("fullName") && !(mapped.has("firstName") || mapped.has("lastName")))
    issues.push({ row: parsed.headerRow, level: "error", message: "No name column mapped — map a column to Full name or First/Last name." });
  if (!mapped.has("email") && !mapped.has("employeeCode"))
    issues.push({ row: parsed.headerRow, level: "warning", message: "No Email or Employee ID column — matching will fall back to name + start date, which is less reliable." });

  const db = getDb();
  let batchId: number | undefined;
  if (!opts.dryRun) {
    const [b] = await db
      .insert(importBatches)
      .values({ fileName: opts.fileName, sheetName: parsed.sheetName, totalRows: parsed.rows.length, mapping: Object.fromEntries(parsed.columns.map((c) => [c.header, c.target])) })
      .returning({ id: importBatches.id });
    batchId = b.id;
  }

  const summary: ImportSummary = {
    batchId, dryRun: opts.dryRun, fileName: opts.fileName, sheetName: parsed.sheetName,
    totalRows: parsed.rows.length, created: 0, updated: 0, unchanged: 0, skipped: 0, snapshots: 0,
    snapshotMonths: new Set(parsed.columns.filter((c) => c.target === "snapshot").map((c) => c.snapshotMonth)).size,
    issues, sampleChanges: [],
  };

  const seen = new Map<string, number>();
  const fatal = issues.some((i) => i.level === "error");
  const processRows = async (tx: DbLike) => {
    const writer = await EmployeeWriter.create(tx);
    for (const row of parsed.rows) {
      const { inc, snapshots } = rowToIncoming(parsed.columns, row.cells, row.rowNumber, issues);
      const key = inc.employeeCode ? `c:${inc.employeeCode.toLowerCase()}` : inc.email ? `e:${inc.email}` : null;
      if (key) {
        const prev = seen.get(key);
        if (prev) issues.push({ row: row.rowNumber, level: "warning", message: `Duplicate of row ${prev} (${key.slice(2)}) — later row values win` });
        else seen.set(key, row.rowNumber);
      }
      const res = await writer.apply(inc, { source: "excel", importBatchId: batchId, dryRun: opts.dryRun, changedBy: "excel-import", excelMode: opts.excelMode });
      summary[res.result]++;
      res.issues.forEach((m) => issues.push({ row: row.rowNumber, level: res.result === "skipped" ? "error" : "warning", message: m }));
      if (res.employeeId)
        for (const s of snapshots)
          writer.queueSnapshot({ employeeId: res.employeeId, month: s.month, value: s.value, status: parseStatus(s.value) ?? null, source: "excel" });
      summary.snapshots += snapshots.length;
      if (summary.sampleChanges.length < 25 && (res.result === "created" || res.changes.length))
        summary.sampleChanges.push({ row: row.rowNumber, name: inc.fullName ?? [inc.firstName, inc.lastName].join(" "), result: res.result, changes: res.changes.slice(0, 8) });
    }
    if (!opts.dryRun) await writer.flushSnapshots();
  };
  if (!fatal) {
    if (opts.dryRun) await processRows(db);
    else {
      try {
        await db.transaction(async (tx) => processRows(tx));
      } catch (e) {
        summary.created = summary.updated = summary.unchanged = 0;
        summary.skipped = summary.totalRows;
        issues.unshift({ row: 0, level: "error", message: `Import rolled back — nothing was saved: ${(e as Error).message}` });
      }
    }
  }

  summary.issues = issues.slice(0, 1000);
  if (batchId) {
    const { eq } = await import("drizzle-orm");
    await getDb()
      .update(importBatches)
      .set({ created: summary.created, updated: summary.updated, unchanged: summary.unchanged, skipped: summary.skipped, snapshots: summary.snapshots, issues: summary.issues })
      .where(eq(importBatches.id, batchId));
  }
  const { rows: _rows, ...meta } = parsed;
  void _rows;
  return { parsed: meta, summary };
}
