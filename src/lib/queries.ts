import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { employees } from "@/db/schema";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { QUALITY_SQL } from "./insights";
import { DEFAULT_COLUMNS, FIELD_MAP, STATUSES, type EmployeeField, type Status } from "./fields";

export type EmployeeFilters = {
  q?: string;
  status?: Status[];
  businessUnit?: string[];
  department?: string;
  location?: string;
  country?: string;
  gender?: string;
  employmentType?: string;
  source?: string;
  startFrom?: string;
  startTo?: string;
  endFrom?: string;
  endTo?: string;
  /** Employed on this date (start <= d and (no end or end >= d)) — "headcount as of". */
  activeOn?: string;
  /** Data-quality check key (see insights.ts). */
  quality?: string;
  sort?: EmployeeField;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

type ParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

function getAll(p: ParamsLike, k: string): string[] {
  if (p instanceof URLSearchParams) return p.getAll(k).flatMap((v) => v.split(",")).filter(Boolean);
  const v = p[k];
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).flatMap((x) => x.split(",")).filter(Boolean);
}
const get1 = (p: ParamsLike, k: string) => getAll(p, k)[0] || undefined;
const isDate = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

export function parseFilters(p: ParamsLike): EmployeeFilters {
  const sort = get1(p, "sort") as EmployeeField | undefined;
  return {
    q: get1(p, "q")?.slice(0, 200),
    status: getAll(p, "status").filter((s): s is Status => (STATUSES as readonly string[]).includes(s)),
    businessUnit: getAll(p, "businessUnit"),
    department: get1(p, "department"),
    location: get1(p, "location"),
    country: get1(p, "country"),
    gender: get1(p, "gender"),
    employmentType: get1(p, "employmentType"),
    source: get1(p, "source"),
    startFrom: isDate(get1(p, "startFrom")),
    startTo: isDate(get1(p, "startTo")),
    endFrom: isDate(get1(p, "endFrom")),
    endTo: isDate(get1(p, "endTo")),
    activeOn: isDate(get1(p, "activeOn")),
    quality: (() => { const q = get1(p, "quality"); return q && q in QUALITY_SQL ? q : undefined; })(),
    sort: sort && sort in FIELD_MAP ? sort : undefined,
    dir: get1(p, "dir") === "desc" ? "desc" : "asc",
    page: Math.max(1, Number(get1(p, "page")) || 1),
    pageSize: Math.min(500, Math.max(10, Number(get1(p, "pageSize")) || 50)),
  };
}

export function filtersToSearch(f: EmployeeFilters, extra: Record<string, string | undefined> = {}): string {
  const sp = new URLSearchParams();
  const put = (k: string, v?: string | string[]) => {
    if (!v || (Array.isArray(v) && !v.length)) return;
    sp.set(k, Array.isArray(v) ? v.join(",") : v);
  };
  put("q", f.q); put("status", f.status); put("businessUnit", f.businessUnit); put("department", f.department);
  put("location", f.location); put("country", f.country); put("gender", f.gender); put("employmentType", f.employmentType);
  put("source", f.source); put("startFrom", f.startFrom); put("startTo", f.startTo); put("endFrom", f.endFrom);
  put("endTo", f.endTo); put("activeOn", f.activeOn); put("quality", f.quality);
  for (const [k, v] of Object.entries(extra)) put(k, v);
  return sp.toString();
}

export function buildWhere(f: EmployeeFilters): SQL | undefined {
  const c: (SQL | undefined)[] = [];
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "\\$&")}%`;
    c.push(or(ilike(employees.fullName, like), ilike(employees.email, like), ilike(employees.employeeCode, like), ilike(employees.jobTitle, like), ilike(employees.manager, like)));
  }
  if (f.status?.length) c.push(inArray(employees.status, f.status));
  if (f.businessUnit?.length) c.push(inArray(employees.businessUnit, f.businessUnit));
  if (f.department) c.push(eq(employees.department, f.department));
  if (f.location) c.push(eq(employees.location, f.location));
  if (f.country) c.push(eq(employees.country, f.country));
  if (f.gender) c.push(eq(employees.gender, f.gender));
  if (f.employmentType) c.push(eq(employees.employmentType, f.employmentType));
  if (f.source) c.push(sql`${f.source} = any(${employees.sources})`);
  if (f.startFrom) c.push(gte(employees.startDate, f.startFrom));
  if (f.startTo) c.push(lte(employees.startDate, f.startTo));
  if (f.endFrom) c.push(gte(employees.endDate, f.endFrom));
  if (f.endTo) c.push(lte(employees.endDate, f.endTo));
  if (f.activeOn) {
    c.push(or(isNull(employees.startDate), lte(employees.startDate, f.activeOn)));
    c.push(or(isNull(employees.endDate), gte(employees.endDate, f.activeOn)));
    c.push(sql`${employees.status} not in ('pre_onboarding')`);
  }
  if (f.quality && QUALITY_SQL[f.quality]) c.push(sql.raw(`(${QUALITY_SQL[f.quality]})`));
  const parts = c.filter(Boolean) as SQL[];
  return parts.length ? and(...parts) : undefined;
}

export async function listEmployees(f: EmployeeFilters) {
  const db = getDb();
  const where = buildWhere(f);
  const sortCol = employees[f.sort ?? "fullName"];
  const order = f.dir === "desc" ? desc(sortCol) : asc(sortCol);
  const pageSize = f.pageSize ?? 50;
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(employees).where(where).orderBy(order, asc(employees.id)).limit(pageSize).offset(((f.page ?? 1) - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(employees).where(where),
  ]);
  return { rows, total: count, pageSize, page: f.page ?? 1 };
}

export async function filterOptions() {
  const db = getDb();
  const distinct = async (col: AnyPgColumn) =>
    (await db.selectDistinct({ v: col }).from(employees).where(sql`${col} is not null and ${col} <> ''`).orderBy(asc(col))).map((r) => r.v as string);
  const [businessUnit, department, location, country, gender, employmentType] = await Promise.all([
    distinct(employees.businessUnit),
    distinct(employees.department),
    distinct(employees.location),
    distinct(employees.country),
    distinct(employees.gender),
    distinct(employees.employmentType),
  ]);
  return { businessUnit, department, location, country, gender, employmentType };
}

export function parseColumns(p: ParamsLike): EmployeeField[] {
  const cols = getAll(p, "columns").filter((c): c is EmployeeField => c in FIELD_MAP);
  return cols.length ? cols : DEFAULT_COLUMNS;
}
