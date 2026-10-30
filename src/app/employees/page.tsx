import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Card, Empty, PageHeader, Skeleton, StatusBadge, btn, fmtDate } from "@/components/ui";
import { FilterBar } from "@/components/filters";
import { NewEmployee } from "./new-employee";
import { filterOptions, filtersToSearch, listEmployees, parseFilters } from "@/lib/queries";
import { DEFAULT_COLUMNS, FIELD_MAP, type EmployeeField } from "@/lib/fields";
import { QUALITY_SQL } from "@/lib/insights";

export const metadata = { title: "Employees" };
type SP = Promise<Record<string, string | string[] | undefined>>;

const QUALITY_LABEL: Record<string, string> = {
  no_email: "Current employees without email",
  no_bu: "Missing business unit",
  no_start: "Missing start date",
  ended_active: "End date passed but still active",
  offboarded_no_end: "Offboarded without end date",
  end_before_start: "End date before start date",
  started_pre: "Start date passed, still pre-onboarding",
  no_country: "Missing country",
  dup_names: "Possible duplicates",
};

export default function EmployeesPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader title="Employees" description="Every person across the headcount file and connected systems. Filters are kept in the URL — bookmark or share a view, and export exactly what you see." actions={<NewEmployee />} />
      <Suspense fallback={<Skeleton rows={12} />}>
        <EmployeesView searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function EmployeesView({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const f = parseFilters(sp);
  const [{ rows, total, page, pageSize }, options] = await Promise.all([listEmployees(f), filterOptions()]);
  const qs = filtersToSearch(f);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cols: EmployeeField[] = DEFAULT_COLUMNS.filter((c) => !["firstName", "lastName", "email", "gender", "employmentType"].includes(c));
  const sortHref = (c: EmployeeField) => `/employees?${filtersToSearch(f, { sort: c, dir: f.sort === c && f.dir === "asc" ? "desc" : "asc" })}`;
  const pageHref = (p: number) => `/employees?${filtersToSearch(f, { page: String(p), sort: f.sort, dir: f.dir })}`;

  return (
    <div className="space-y-6">
      <details className="group rounded-xl border border-line bg-surface" open={Boolean(qs)}>
        <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm font-semibold">
          Filters {qs && <span className="text-xs font-normal text-accent">active</span>}
          <span className="text-muted group-open:rotate-180">⌄</span>
        </summary>
        <div className="border-t border-line p-5">
          <FilterBar f={f} options={options} action="/employees" resetHref="/employees" />
        </div>
      </details>

      {f.quality && QUALITY_SQL[f.quality] && (
        <div className="flex items-center justify-between rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Data-quality view: <strong>{QUALITY_LABEL[f.quality]}</strong>
          <Link href="/employees" className="underline">Clear</Link>
        </div>
      )}

      <Card
        padded={false}
        title={<span>{total.toLocaleString()} employee{total === 1 ? "" : "s"}</span>}
        actions={
          <a href={`/api/export?${qs}`} className={btn.secondary}>
            ⬇ Export these to Excel
          </a>
        }
      >
        {rows.length === 0 ? (
          <div className="p-5"><Empty title="No employees match these filters" /></div>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="data">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c}>
                      <Link href={sortHref(c)} className="hover:text-ink">
                        {FIELD_MAP[c].label}
                        {f.sort === c ? (f.dir === "asc" ? " ↑" : " ↓") : ""}
                      </Link>
                    </th>
                  ))}
                  <th>Sources</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {cols.map((c) => (
                      <td key={c}>
                        {c === "fullName" ? (
                          <Link href={`/employees/${r.id}`} className="font-medium text-accent hover:underline">
                            {r.fullName}
                            {r.email && <span className="block text-xs font-normal text-muted">{r.email}</span>}
                          </Link>
                        ) : c === "status" ? (
                          <StatusBadge status={r.status} />
                        ) : FIELD_MAP[c].type === "date" ? (
                          <span className="tabular-nums">{fmtDate(r[c] as string | null)}</span>
                        ) : (
                          (r[c] as string | null) ?? <span className="text-muted">—</span>
                        )}
                      </td>
                    ))}
                    <td className="text-xs text-muted">{r.sources.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm">
            <span className="text-muted">Page {page} of {pages}</span>
            <div className="flex gap-2">
              {page > 1 && <Link href={pageHref(page - 1)} className={btn.secondary}>← Previous</Link>}
              {page < pages && <Link href={pageHref(page + 1)} className={btn.secondary}>Next →</Link>}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
