import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { BarList, Card, Empty, PageHeader, Skeleton, Stat, StatusBadge, SyncBadge, btn, fmtDate, fmtDateTime } from "@/components/ui";
import { dashboardStats, dataQuality } from "@/lib/insights";
import { latestRunPerSource } from "@/lib/sync";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Headcount, joiners, leavers and data health across Leapsome, Timebase, Jira and the headcount file."
        actions={
          <>
            <Link href="/import" className={btn.secondary}>Import Excel</Link>
            <Link href="/export" className={btn.primary}>Export Excel</Link>
          </>
        }
      />
      <Suspense fallback={<Skeleton rows={8} />}>
        <Dashboard />
      </Suspense>
    </>
  );
}

async function Dashboard() {
  await connection();
  let stats: Awaited<ReturnType<typeof dashboardStats>>;
  try {
    stats = await dashboardStats();
  } catch (e) {
    return <DbError error={e as Error} />;
  }
  const [quality, sync] = await Promise.all([dataQuality(), latestRunPerSource()]);
  const t = stats.totals;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";

  if (t.total === 0)
    return (
      <Card>
        <Empty title="No employee data yet">
          Start by <Link className="text-accent underline" href="/import">importing your headcount Excel</Link>, or{" "}
          <Link className="text-accent underline" href="/integrations">connect Leapsome</Link> and run a sync.
        </Empty>
      </Card>
    );

  const openIssues = quality.filter((q) => q.count > 0);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Current headcount" value={t.headcount.toLocaleString()} hint={`${t.total.toLocaleString()} records in total`} href={`/employees?activeOn=${today}`} />
        <Stat label="Joiners this month" value={t.joiners_month} hint={`${t.joiners_30} starting in the next 30 days`} href={`/employees?startFrom=${monthStart}`} />
        <Stat label="Leavers this month" value={t.leavers_month} href={`/employees?endFrom=${monthStart}`} />
        <Stat label="Data issues" value={openIssues.reduce((a, q) => a + q.count, 0)} hint={`${openIssues.length} checks need attention`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Headcount by business unit" className="xl:col-span-2">
          {stats.byBu.length ? (
            <BarList items={stats.byBu.map((b) => ({ label: b.bu, value: b.n }))} href={(l) => (l === "(none)" ? "/employees?quality=no_bu" : `/employees?businessUnit=${encodeURIComponent(l)}&status=active,onboarding,on_leave,offboarding`)} />
          ) : (
            <Empty title="No current employees" />
          )}
        </Card>
        <Card title="By status">
          <ul className="space-y-2">
            {stats.byStatus.map((s) => (
              <li key={s.status}>
                <Link href={`/employees?status=${s.status}`} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-canvas">
                  <StatusBadge status={s.status} />
                  <span className="tabular-nums text-sm text-ink">{s.n}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {stats.trend.length > 1 && (
        <Card title="Monthly headcount (month-end snapshots)" actions={<span className="text-xs text-muted">Grey = no snapshot for that month</span>}>
          <Trend data={stats.trend} />
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Starting in the next 30 days" padded={false}>
          <PeopleList rows={stats.upcoming.map((r) => ({ id: r.id, name: r.full_name, date: r.start_date, sub: [r.job_title, r.business_unit].filter(Boolean).join(" · ") }))} empty="No upcoming joiners" />
        </Card>
        <Card title="Probation ending in 30 days" padded={false}>
          <PeopleList rows={stats.probation.map((r) => ({ id: r.id, name: r.full_name, date: r.probation_end_date, sub: r.manager ? `Manager: ${r.manager}` : "" }))} empty="No probation reviews due" />
        </Card>
        <Card title="Leaving in the next 30 days" padded={false}>
          <PeopleList rows={stats.leavers.map((r) => ({ id: r.id, name: r.full_name, date: r.end_date, sub: r.business_unit ?? "" }))} empty="No upcoming leavers" />
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Data quality" actions={<span className="text-xs text-muted">Catches manual-entry mistakes</span>}>
          <ul className="divide-y divide-line">
            {quality.map((q) => (
              <li key={q.key} className="flex items-center justify-between py-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${q.count === 0 ? "bg-emerald-500" : q.severity === "high" ? "bg-rose-500" : q.severity === "medium" ? "bg-amber-500" : "bg-slate-400"}`} />
                  {q.label}
                </span>
                {q.count > 0 ? <Link href={q.href} className="font-medium tabular-nums text-accent hover:underline">{q.count} →</Link> : <span className="text-xs text-muted">OK</span>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Integrations" actions={<Link href="/integrations" className={btn.ghost}>Manage →</Link>}>
          <ul className="divide-y divide-line">
            {(["leapsome", "timebase", "jira"] as const).map((s) => (
              <li key={s} className="flex items-center justify-between py-2.5 text-sm">
                <span className="font-medium capitalize">{s}</span>
                <span className="flex items-center gap-3 text-xs text-muted">
                  {sync[s] && <span>{fmtDateTime(sync[s]!.startedAt)}</span>}
                  <SyncBadge status={sync[s]?.status} />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Automatic sync runs every morning at 08:00 (Asia/Yerevan).</p>
        </Card>
      </div>
    </div>
  );
}

function PeopleList({ rows, empty }: { rows: { id: number; name: string; date: string; sub: string }[]; empty: string }) {
  if (!rows.length) return <p className="px-5 py-6 text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/employees/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-canvas">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">{r.name}</span>
              {r.sub && <span className="block truncate text-xs text-muted">{r.sub}</span>}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted">{fmtDate(r.date)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Trend({ data }: { data: { month: string; n: number | null }[] }) {
  const max = Math.max(1, ...data.map((d) => d.n ?? 0));
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5 border-b border-line">
        {data.map((d) => (
          <div key={d.month} className="group relative flex h-full flex-1 flex-col justify-end" title={d.n ? `${d.month}: ${d.n}` : `${d.month}: no snapshot`}>
            {d.n ? (
              <div className="rounded-t-[4px] bg-accent/75 transition-colors group-hover:bg-accent" style={{ height: `${(d.n / max) * 100}%`, minHeight: 2 }} />
            ) : (
              <div className="h-1 rounded-t-[4px] bg-line" />
            )}
            <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-ink px-1.5 py-0.5 text-xs whitespace-nowrap text-white group-hover:block">{d.n || "no data"}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {data.map((d, i) => (
          <span key={d.month} className="flex-1 text-center text-[10px] text-muted">{i % 2 === 0 || data.length < 8 ? d.month.slice(2).replace("-", "/") : ""}</span>
        ))}
      </div>
    </div>
  );
}

function DbError({ error }: { error: Error }) {
  return (
    <Card title="Database not reachable">
      <p className="text-sm text-muted">The app couldn&apos;t query the database. Check <code className="rounded bg-canvas px-1">DATABASE_URL</code> and run <code className="rounded bg-canvas px-1">npm run db:migrate</code>.</p>
      <pre className="mt-3 overflow-auto rounded-md bg-canvas p-3 text-xs text-rose-700">{error.message}</pre>
    </Card>
  );
}

