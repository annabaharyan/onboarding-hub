import { Suspense } from "react";
import { connection } from "next/server";
import { Badge, Card, PageHeader, Skeleton, SyncBadge, fmtDateTime } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { CONNECTORS, defaultSources, lastRuns, latestRunPerSource } from "@/lib/sync";
import { claudeConfigured } from "@/lib/integrations/claude";
import { SOURCE_OWNERSHIP, FIELD_MAP } from "@/lib/fields";
import { syncNow, testConnection } from "../actions";

export const metadata = { title: "Integrations & sync" };

export default function IntegrationsPage() {
  return (
    <>
      <PageHeader
        title="Integrations & sync"
        description="Credentials are read from environment variables on the server — never stored in the database or sent to the browser."
        actions={
          <ActionForm action={syncNow} className="flex flex-col items-end">
            <input type="hidden" name="source" value="all" />
            <SubmitButton pending="Syncing all sources…">↻ Sync all now</SubmitButton>
          </ActionForm>
        }
      />
      <Suspense fallback={<Skeleton rows={10} />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  await connection();
  const [latest, runs] = await Promise.all([latestRunPerSource(), lastRuns(40)]);
  const schedule = process.env.CRON_SCHEDULE || "0 8 * * *";
  const tz = process.env.CRON_TIMEZONE || "Asia/Yerevan";
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {Object.values(CONNECTORS).map((c) => {
          const missing = c.missingConfig();
          const l = latest[c.id];
          return (
            <Card
              key={c.id}
              title={<span className="flex items-center gap-2">{c.label} {missing.length ? <Badge tone="gray">Not configured</Badge> : <Badge tone="green">Configured</Badge>}</span>}
              actions={<SyncBadge status={l?.status} />}
            >
              <p className="text-sm text-muted">{c.description}</p>
              {l && (
                <p className="mt-3 text-xs text-muted">
                  Last run {fmtDateTime(l.startedAt)} — {l.fetched} fetched, {l.created} new, {l.updated} updated
                  {l.message && <span className={`block ${l.status === "failed" ? "text-rose-700" : "text-amber-800"}`}>{l.message}</span>}
                </p>
              )}
              {missing.length > 0 && <p className="mt-3 text-xs text-amber-800">Set: {missing.map((m) => <code key={m} className="mr-1 rounded bg-amber-50 px-1">{m}</code>)}</p>}
              <p className="mt-3 text-xs text-muted">
                Owns: {(SOURCE_OWNERSHIP[c.id] as string[]).map((f) => FIELD_MAP[f as keyof typeof FIELD_MAP]?.label ?? f).join(", ")}. Other fields are filled only when empty.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <ActionForm action={testConnection}>
                  <input type="hidden" name="id" value={c.id} />
                  <SubmitButton variant="secondary" pending="Testing…">Test connection</SubmitButton>
                </ActionForm>
                <ActionForm action={syncNow}>
                  <input type="hidden" name="source" value={c.id} />
                  <SubmitButton variant="secondary" pending="Syncing…">Sync now</SubmitButton>
                </ActionForm>
              </div>
            </Card>
          );
        })}
        <Card title={<span className="flex items-center gap-2">Claude {claudeConfigured() ? <Badge tone="green">Configured</Badge> : <Badge>Not configured</Badge>}</span>}>
          <p className="text-sm text-muted">
            Reads Jira onboarding tickets, extracts the new joiner&apos;s details from free text, flags missing or implausible information and drafts the reporter comment. Tickets are only re-checked when their content changes, to keep API costs low.
          </p>
          <p className="mt-3 text-xs text-muted">Model: <code>{process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5"}</code></p>
          <div className="mt-4">
            <ActionForm action={testConnection}>
              <input type="hidden" name="id" value="claude" />
              <SubmitButton variant="secondary" pending="Testing…">Test connection</SubmitButton>
            </ActionForm>
          </div>
        </Card>
      </div>

      <Card title="Daily automatic sync">
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          <div><div className="text-xs text-muted">Schedule</div><code>{schedule}</code> ({tz}) — every day at 08:00</div>
          <div><div className="text-xs text-muted">Order</div>{defaultSources().join(" → ")}</div>
          <div><div className="text-xs text-muted">Safety</div>One sync at a time (database lock); a failing source doesn&apos;t stop the others</div>
        </div>
      </Card>

      <Card title="Sync history" padded={false}>
        {runs.length === 0 ? <p className="p-5 text-sm text-muted">No syncs yet.</p> : (
          <div className="max-h-[520px] overflow-auto">
            <table className="data">
              <thead><tr><th>Started</th><th>Source</th><th>Trigger</th><th>Status</th><th>Fetched</th><th>New</th><th>Updated</th><th>Unchanged</th><th>Skipped</th><th>Duration</th><th>Details</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDateTime(r.startedAt)}</td>
                    <td className="capitalize">{r.source}</td>
                    <td>{r.trigger}</td>
                    <td><SyncBadge status={r.status} /></td>
                    <td className="tabular-nums">{r.fetched}</td>
                    <td className="tabular-nums">{r.created}</td>
                    <td className="tabular-nums">{r.updated}</td>
                    <td className="tabular-nums">{r.unchanged}</td>
                    <td className="tabular-nums">{r.skipped}</td>
                    <td className="tabular-nums">{r.finishedAt ? `${Math.max(0, Math.round((+r.finishedAt - +r.startedAt) / 1000))}s` : "—"}</td>
                    <td className="max-w-md whitespace-normal text-xs">
                      {r.message}
                      {r.errors.length > 0 && (
                        <details><summary className="cursor-pointer text-accent">{r.errors.length} issue(s)</summary><ul className="mt-1 max-h-40 overflow-auto">{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
