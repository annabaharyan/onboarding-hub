import Link from "next/link";
import { STATUSES, STATUS_LABEL } from "@/lib/fields";
import type { EmployeeFilters } from "@/lib/queries";
import { btn, input, label } from "./ui";

type Options = { businessUnit: string[]; department: string[]; location: string[]; country: string[]; gender: string[]; employmentType: string[] };

/** GET form — filters live in the URL so views are shareable and exports reuse them. */
export function FilterBar({ f, options, action, resetHref, children, submitLabel = "Apply filters" }: { f: EmployeeFilters; options: Options; action: string; resetHref: string; children?: React.ReactNode; submitLabel?: string }) {
  const sel = (name: keyof Options, lbl: string, value?: string) => (
    <div>
      <label className={label}>{lbl}</label>
      <select name={name} defaultValue={value ?? ""} className={input}>
        <option value="">All</option>
        {options[name].map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
  return (
    <form action={action} method="get" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <div className="sm:col-span-2">
          <label className={label}>Search</label>
          <input name="q" defaultValue={f.q} placeholder="Name, email, ID, title, manager…" className={input} />
        </div>
        <div>
          <label className={label}>Business unit</label>
          <select name="businessUnit" defaultValue={f.businessUnit?.[0] ?? ""} className={input}>
            <option value="">All</option>
            {options.businessUnit.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
        {sel("department", "Department", f.department)}
        {sel("location", "Location", f.location)}
        {sel("country", "Country", f.country)}
        {sel("gender", "Gender", f.gender)}
        {sel("employmentType", "Employment type", f.employmentType)}
        <div>
          <label className={label}>Source</label>
          <select name="source" defaultValue={f.source ?? ""} className={input}>
            <option value="">All</option>
            {["excel", "leapsome", "timebase", "jira", "manual"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Headcount as of</label>
          <input type="date" name="activeOn" defaultValue={f.activeOn} className={input} />
        </div>
        <div>
          <label className={label}>Start date from</label>
          <input type="date" name="startFrom" defaultValue={f.startFrom} className={input} />
        </div>
        <div>
          <label className={label}>Start date to</label>
          <input type="date" name="startTo" defaultValue={f.startTo} className={input} />
        </div>
        <div>
          <label className={label}>End date from</label>
          <input type="date" name="endFrom" defaultValue={f.endFrom} className={input} />
        </div>
        <div>
          <label className={label}>End date to</label>
          <input type="date" name="endTo" defaultValue={f.endTo} className={input} />
        </div>
      </div>
      <fieldset>
        <legend className={label}>Status</legend>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <label key={s} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs has-[:checked]:border-accent has-[:checked]:bg-accent/5 has-[:checked]:text-accent">
              <input type="checkbox" name="status" value={s} defaultChecked={f.status?.includes(s)} className="sr-only" />
              {STATUS_LABEL[s]}
            </label>
          ))}
        </div>
      </fieldset>
      {f.quality && <input type="hidden" name="quality" value={f.quality} />}
      {children}
      <div className="flex gap-2">
        <button className={btn.primary}>{submitLabel}</button>
        <Link href={resetHref} className={btn.secondary}>Reset</Link>
      </div>
    </form>
  );
}
