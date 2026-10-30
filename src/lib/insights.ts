import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export type QualityIssue = { key: string; label: string; count: number; href: string; severity: "high" | "medium" | "low" };

/** Data-quality checks that catch the manual mistakes the headcount file suffers from. */
export async function dataQuality(): Promise<QualityIssue[]> {
  const db = getDb();
  const q = async (where: string) =>
    (await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from employees where ${where}`))).rows[0].n;
  const dupNames = (
    await db.execute<{ n: number }>(sql`select coalesce(sum(c),0)::int as n from (select count(*) c from employees where status not in ('offboarded','inactive') group by lower(full_name) having count(*) > 1) t`)
  ).rows[0].n;
  const checks: QualityIssue[] = [
    { key: "no_email", label: "Current employees without email", count: await q(`email is null and status not in ('offboarded','inactive')`), href: "/employees?quality=no_email", severity: "high" },
    { key: "no_bu", label: "Missing business unit", count: await q(`business_unit is null and status not in ('offboarded','inactive')`), href: "/employees?quality=no_bu", severity: "high" },
    { key: "no_start", label: "Missing start date", count: await q(`start_date is null`), href: "/employees?quality=no_start", severity: "medium" },
    { key: "ended_active", label: "End date passed but still active", count: await q(`end_date < current_date and status in ('active','onboarding','on_leave')`), href: "/employees?quality=ended_active", severity: "high" },
    { key: "offboarded_no_end", label: "Offboarded without end date", count: await q(`status = 'offboarded' and end_date is null`), href: "/employees?quality=offboarded_no_end", severity: "medium" },
    { key: "end_before_start", label: "End date before start date", count: await q(`end_date < start_date`), href: "/employees?quality=end_before_start", severity: "high" },
    { key: "started_pre", label: "Start date passed, still pre-onboarding", count: await q(`status = 'pre_onboarding' and start_date < current_date`), href: "/employees?quality=started_pre", severity: "medium" },
    { key: "no_country", label: "Missing country", count: await q(`country_code is null and status not in ('offboarded','inactive')`), href: "/employees?quality=no_country", severity: "low" },
    { key: "dup_names", label: "Possible duplicates (same name)", count: dupNames, href: "/employees?quality=dup_names", severity: "medium" },
  ];
  return checks;
}

export const QUALITY_SQL: Record<string, string> = {
  no_email: `email is null and status not in ('offboarded','inactive')`,
  no_bu: `business_unit is null and status not in ('offboarded','inactive')`,
  no_start: `start_date is null`,
  ended_active: `end_date < current_date and status in ('active','onboarding','on_leave')`,
  offboarded_no_end: `status = 'offboarded' and end_date is null`,
  end_before_start: `end_date < start_date`,
  started_pre: `status = 'pre_onboarding' and start_date < current_date`,
  no_country: `country_code is null and status not in ('offboarded','inactive')`,
  dup_names: `status not in ('offboarded','inactive') and lower(full_name) in (select lower(full_name) from employees where status not in ('offboarded','inactive') group by lower(full_name) having count(*) > 1)`,
};

export async function dashboardStats() {
  const db = getDb();
  const one = async <T,>(s: ReturnType<typeof sql>) => (await db.execute(s)).rows[0] as T;
  const [totals, byStatus, byBu, upcoming, probation, leavers] = await Promise.all([
    one<{ total: number; headcount: number; joiners_month: number; leavers_month: number; joiners_30: number }>(sql`
      select count(*)::int total,
        count(*) filter (where status in ('active','onboarding','on_leave','offboarding'))::int headcount,
        count(*) filter (where date_trunc('month', start_date) = date_trunc('month', current_date))::int joiners_month,
        count(*) filter (where date_trunc('month', end_date) = date_trunc('month', current_date))::int leavers_month,
        count(*) filter (where start_date between current_date and current_date + 30)::int joiners_30
      from employees`),
    db.execute<{ status: string; n: number }>(sql`select status::text, count(*)::int n from employees group by status order by n desc`),
    db.execute<{ bu: string; n: number }>(sql`select coalesce(business_unit,'(none)') bu, count(*)::int n from employees where status in ('active','onboarding','on_leave','offboarding') group by 1 order by n desc limit 12`),
    db.execute<{ id: number; full_name: string; start_date: string; business_unit: string | null; job_title: string | null }>(sql`select id, full_name, start_date::text, business_unit, job_title from employees where start_date between current_date and current_date + 30 order by start_date limit 10`),
    db.execute<{ id: number; full_name: string; probation_end_date: string; manager: string | null }>(sql`select id, full_name, probation_end_date::text, manager from employees where probation_end_date between current_date and current_date + 30 and status not in ('offboarded','inactive') order by probation_end_date limit 10`),
    db.execute<{ id: number; full_name: string; end_date: string; business_unit: string | null }>(sql`select id, full_name, end_date::text, business_unit from employees where end_date between current_date and current_date + 30 order by end_date limit 10`),
  ]);
  // Continuous month series (gaps shown as empty) from the first snapshot, max 24 months back
  const trend = await db.execute<{ month: string; n: number | null }>(sql`
    with bounds as (
      select greatest(date_trunc('month', min(month)), date_trunc('month', current_date) - interval '23 months') as lo
      from monthly_snapshots
    ), months as (
      select (generate_series((select lo from bounds), date_trunc('month', current_date), interval '1 month') + interval '1 month - 1 day')::date as m
    )
    select to_char(m, 'YYYY-MM') as month,
      (select count(*) filter (where case when s.value ~ '^[0-9]+(\.[0-9]+)?$' then s.value::numeric > 0 else coalesce(s.status,'') in ('active','onboarding','on_leave','offboarding') end)
         from monthly_snapshots s where s.month = months.m)::int as n
    from months where (select lo from bounds) is not null order by m`);
  return { totals, byStatus: byStatus.rows, byBu: byBu.rows, upcoming: upcoming.rows, probation: probation.rows, leavers: leavers.rows, trend: trend.rows };
}
