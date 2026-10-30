import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { employees, employeeChanges, monthlySnapshots, onboardingRequests } from "@/db/schema";
import { Badge, Card, PageHeader, Skeleton, StatusBadge, fmtDate, fmtDateTime } from "@/components/ui";
import { FIELD_MAP, type EmployeeField } from "@/lib/fields";
import { EditEmployee } from "./edit-form";
import { unlockField } from "@/app/actions";

export default function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton rows={10} />}>
      <EmployeeView params={params} />
    </Suspense>
  );
}

async function EmployeeView({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const [e] = await db.select().from(employees).where(eq(employees.id, id));
  if (!e) notFound();
  const [changes, snaps, tickets] = await Promise.all([
    db.select().from(employeeChanges).where(eq(employeeChanges.employeeId, id)).orderBy(desc(employeeChanges.changedAt)).limit(100),
    db.select().from(monthlySnapshots).where(eq(monthlySnapshots.employeeId, id)).orderBy(desc(monthlySnapshots.month)).limit(24),
    db.select().from(onboardingRequests).where(eq(onboardingRequests.employeeId, id)),
  ]);

  return (
    <>
      <div className="mb-3 text-sm"><Link href="/employees" className="text-accent hover:underline">← Employees</Link></div>
      <PageHeader
        title={e.fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={e.status} />
            {[e.jobTitle, e.businessUnit, e.location].filter(Boolean).join(" · ")}
            {e.sources.map((s) => <Badge key={s}>{s}</Badge>)}
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Details" actions={<span className="text-xs text-muted">Edited fields are locked from sync overwrites</span>}>
            <EditEmployee employee={JSON.parse(JSON.stringify(e))} />
          </Card>
          {Object.keys(e.extra).length > 0 && (
            <Card title="Additional columns from the headcount file">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {Object.entries(e.extra).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-line py-1">
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-right">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {e.lockedFields.length > 0 && (
            <Card title="Locked fields">
              <ul className="space-y-1.5">
                {e.lockedFields.map((f) => (
                  <li key={f} className="flex items-center justify-between text-sm">
                    🔒 {FIELD_MAP[f as EmployeeField]?.label ?? f}
                    <form action={unlockField}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="field" value={f} />
                      <button className="text-xs text-accent hover:underline">Let sync update</button>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="System IDs">
            <dl className="space-y-1.5 text-sm">
              {[["Leapsome", e.leapsomeId], ["Timebase", e.timebaseId], ["Jira", e.jiraKey], ["Last synced", fmtDateTime(e.lastSyncedAt)], ["Created", fmtDateTime(e.createdAt)]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2"><dt className="text-muted">{k}</dt><dd className="truncate">{v ?? "—"}</dd></div>
              ))}
            </dl>
          </Card>
          {tickets.length > 0 && (
            <Card title="Onboarding tickets">
              {tickets.map((t) => (
                <div key={t.id} className="text-sm"><span className="font-medium">{t.jiraKey}</span> — {t.summary}</div>
              ))}
            </Card>
          )}
          <Card title="Monthly snapshots" padded={false}>
            {snaps.length ? (
              <table className="data">
                <thead><tr><th>Month end</th><th>Value</th><th>Source</th></tr></thead>
                <tbody>{snaps.map((s) => <tr key={s.id}><td>{fmtDate(s.month)}</td><td>{s.value ?? s.status}</td><td className="text-xs text-muted">{s.source}</td></tr>)}</tbody>
              </table>
            ) : <p className="p-5 text-sm text-muted">No snapshots yet.</p>}
          </Card>
          <Card title="Change history" padded={false}>
            {changes.length ? (
              <ul className="max-h-[480px] divide-y divide-line overflow-auto">
                {changes.map((c) => (
                  <li key={c.id} className="px-5 py-2.5 text-sm">
                    <div className="flex justify-between text-xs text-muted"><span>{c.source}{c.changedBy ? ` · ${c.changedBy}` : ""}</span><span>{fmtDateTime(c.changedAt)}</span></div>
                    {c.field === "*" ? <div>Record created</div> : (
                      <div><span className="font-medium">{FIELD_MAP[c.field as EmployeeField]?.label ?? c.field}</span>: <span className="text-muted line-through">{c.oldValue ?? "empty"}</span> → {c.newValue ?? "empty"}</div>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="p-5 text-sm text-muted">No changes recorded.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
