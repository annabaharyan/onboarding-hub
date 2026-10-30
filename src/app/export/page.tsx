import { Suspense } from "react";
import { connection } from "next/server";
import { Card, PageHeader, Skeleton, label } from "@/components/ui";
import { FilterBar } from "@/components/filters";
import { filterOptions, parseFilters } from "@/lib/queries";
import { DEFAULT_COLUMNS, FIELDS } from "@/lib/fields";

export const metadata = { title: "Export Excel" };
type SP = Promise<Record<string, string | string[] | undefined>>;

const PRESETS: { label: string; href: string }[] = [
  { label: "Full headcount (all records)", href: "/api/export?snapshots=1&summary=1&extra=1" },
  { label: "Current headcount", href: "/api/export?status=active,onboarding,on_leave,offboarding" },
  { label: "Pre-onboarding & onboarding", href: "/api/export?status=pre_onboarding,onboarding&onboarding=1&snapshots=0" },
  { label: "Leavers (offboarding/offboarded)", href: "/api/export?status=offboarding,offboarded&snapshots=0" },
  { label: "Payroll view (no monthly sheet)", href: "/api/export?status=active,onboarding,on_leave,offboarding&snapshots=0&columns=employeeCode,fullName,legalEntity,country,businessUnit,employmentType,startDate,endDate,probationEndDate" },
];

export default function ExportPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader title="Export Excel" description="Build an Excel file with exactly the people, columns and sheets you need. Every export reflects the latest synced data." />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Quick exports" className="h-fit">
          <ul className="space-y-1">
            {PRESETS.map((p) => (
              <li key={p.label}>
                <a href={p.href} className="flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-canvas">
                  {p.label} <span className="text-accent">⬇</span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Custom export" className="xl:col-span-2">
          <Suspense fallback={<Skeleton rows={6} />}>
            <Builder searchParams={searchParams} />
          </Suspense>
        </Card>
      </div>
    </>
  );
}

async function Builder({ searchParams }: { searchParams: SP }) {
  await connection();
  const f = parseFilters(await searchParams);
  const options = await filterOptions();
  return (
    <FilterBar f={f} options={options} action="/api/export" resetHref="/export" submitLabel="⬇ Download Excel">
      <fieldset>
        <legend className={label}>Columns</legend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {FIELDS.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="columns" value={c.key} defaultChecked={DEFAULT_COLUMNS.includes(c.key)} className="accent-accent" />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className={label}>Sheets & extras</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {[
            ["snapshots", "Monthly headcount sheet", true],
            ["summary", "Summary by business unit", true],
            ["extra", "Extra columns from imported file", false],
            ["onboarding", "Onboarding requests (Jira)", false],
            ["changes", "Change log (last 90 days)", false],
          ].map(([k, l, on]) => (
            <label key={k as string} className="flex items-center gap-2">
              <input type="hidden" name={k as string} value="0" />
              <input type="checkbox" name={k as string} value="1" defaultChecked={on as boolean} className="accent-accent" />
              {l}
            </label>
          ))}
        </div>
        <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
          <div><label className={label}>Monthly sheet from</label><input type="date" name="snapshotFrom" className="w-full rounded-lg border border-line px-3 py-2 text-sm" /></div>
          <div><label className={label}>Monthly sheet to</label><input type="date" name="snapshotTo" className="w-full rounded-lg border border-line px-3 py-2 text-sm" /></div>
        </div>
      </fieldset>
    </FilterBar>
  );
}
