import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { asc, desc, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { checklistTemplates, onboardingRequests, type RequestStage } from "@/db/schema";
import { Badge, Card, Empty, PageHeader, Skeleton, fmtDate, input } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { StageBadge } from "@/components/stage";
import { ACTIVE_STAGES, STAGES, STAGE_META, collectionLeadDays, fieldLabel } from "@/lib/onboarding/stages";
import { effective, missingFor } from "@/lib/onboarding/engine";
import { jiraMode } from "@/lib/integrations/jira-client";
import { syncNow } from "../actions";
import { addChecklistTemplate, createDummyTicket, toggleChecklistTemplate } from "./actions";
import { DummyTicketButton } from "./dummy-ticket-button";

export const metadata = { title: "Onboarding requests" };
type SP = Promise<{ stage?: string }>;

export default function OnboardingPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader
        title="Onboarding requests"
        description="Every onboarding ticket from Jira, from the first contact to the first day. The Jira ticket moves to Work in progress when the employee is contacted and to Done when the first-day checklist is complete."
        actions={
          <ActionForm action={syncNow} className="flex flex-col items-end">
            <input type="hidden" name="source" value="jira" />
            <SubmitButton pending="Syncing…">↻ Sync Jira now</SubmitButton>
          </ActionForm>
        }
      />
      <Suspense fallback={<Skeleton rows={8} />}>
        <Requests searchParams={searchParams} />
      </Suspense>
    </>
  );
}

/** Demo-mode notice with the controls that only make sense without real Jira. */
function DemoBanner() {
  return (
    <section aria-label="Jira demo mode" className="flex flex-wrap items-center gap-4 rounded-xl border border-violet-200 bg-violet-50 px-5 py-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-violet-600 text-white" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3h6M10 3v6L5 18a2 2 0 001.8 3h10.4a2 2 0 001.8-3l-5-9V3M7.5 14h9" />
        </svg>
      </div>
      <div className="min-w-64 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-violet-950">Jira demo mode</h2>
          <span className="rounded-full bg-violet-600/10 px-2 py-0.5 text-[11px] font-medium text-violet-800">Dummy tickets</span>
        </div>
        <p className="mt-0.5 text-sm text-violet-900/80">
          Jira isn&apos;t connected yet, so tickets are stored in the app. Everything else works as it will with real Jira. To connect, set <code className="rounded bg-white/70 px-1">JIRA_BASE_URL</code>, <code className="rounded bg-white/70 px-1">JIRA_EMAIL</code>, <code className="rounded bg-white/70 px-1">JIRA_API_TOKEN</code> and <code className="rounded bg-white/70 px-1">JIRA_MODE=live</code>.
        </p>
      </div>
      <ActionForm action={createDummyTicket} className="flex shrink-0 flex-col items-end">
        <DummyTicketButton />
      </ActionForm>
    </section>
  );
}

async function Requests({ searchParams }: { searchParams: SP }) {
  await connection();
  const { stage: raw } = await searchParams;
  const view = raw === "all" || (STAGES as string[]).includes(raw ?? "") ? (raw as RequestStage | "all") : "active";
  const db = getDb();
  const [all, templates] = await Promise.all([
    db.select().from(onboardingRequests).orderBy(asc(sql`coalesce(${onboardingRequests.corrections}->>'startDate', ${onboardingRequests.startDate}::text)`), desc(onboardingRequests.jiraCreatedAt)),
    db.select().from(checklistTemplates).orderBy(asc(checklistTemplates.sortOrder), asc(checklistTemplates.id)),
  ]);
  const count = (s: RequestStage) => all.filter((r) => r.stage === s).length;
  const rows = view === "all" ? all : view === "active" ? all.filter((r) => ACTIVE_STAGES.includes(r.stage)) : all.filter((r) => r.stage === view);
  const mock = jiraMode() === "mock";

  const tab = (key: string, label: string, n: number) => {
    const on = view === key;
    return (
      <Link
        key={key}
        href={key === "active" ? "/onboarding" : `/onboarding?stage=${key}`}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${on ? "border-accent bg-accent/5 font-medium text-accent" : "border-line bg-surface text-ink hover:border-accent/40"}`}
      >
        {label}
        <span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? "bg-accent text-white" : "bg-canvas text-muted"}`}>{n}</span>
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      {mock && <DemoBanner />}

      <nav className="flex flex-wrap gap-2" aria-label="Filter by stage">
        {tab("active", "In progress", all.filter((r) => ACTIVE_STAGES.includes(r.stage)).length)}
        {ACTIVE_STAGES.map((s) => tab(s, STAGE_META[s].label, count(s)))}
        {tab("completed", "Completed", count("completed"))}
        {tab("cancelled", "Cancelled", count("cancelled"))}
        {tab("all", "All", all.length)}
      </nav>

      <Card padded={false} title={view === "active" ? "In progress" : view === "all" ? "All requests" : STAGE_META[view].label} actions={view !== "active" && view !== "all" ? <span className="text-xs text-muted">{STAGE_META[view].hint}</span> : undefined}>
        {rows.length === 0 ? (
          <div className="p-5">
            <Empty title={all.length ? "Nothing in this stage" : "No onboarding requests yet"}>
              {all.length ? "Pick another stage above." : mock ? "Click “Sync Jira now” to load the dummy tickets." : "Run a Jira sync to load onboarding tickets."}
            </Empty>
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>New joiner</th>
                  <th>Start date</th>
                  <th>Collection date</th>
                  <th>Stage</th>
                  <th>Needs attention</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const v = effective(r);
                  const missing = ["collecting", "needs_info", "ready_for_review"].includes(r.stage) ? missingFor(r) : [];
                  const pending = Object.keys(r.pendingChanges).length;
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/onboarding/${r.id}`} className="font-medium text-accent hover:underline">{r.jiraKey}</Link>
                        <div className="text-xs text-muted">Jira: {r.jiraStatus ?? "—"}</div>
                      </td>
                      <td>
                        {v.fullName ?? <span className="text-muted">—</span>}
                        <div className="text-xs text-muted">{[v.jobTitle, v.businessUnit].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="tabular-nums">{fmtDate(v.startDate)}</td>
                      <td className="tabular-nums">
                        {r.stage === "pre_onboarding" || r.stage === "new" ? (
                          <>
                            {fmtDate(r.collectionDate)}
                            {r.collectionDate && <span className="ml-1 text-xs text-muted">{r.collectionDateOverridden ? "set by hand" : "suggested"}</span>}
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td><StageBadge stage={r.stage} /></td>
                      <td className="max-w-xs whitespace-normal text-xs">
                        <div className="flex flex-wrap gap-1">
                          {r.stage === "new" && <Badge tone="blue">Contact the employee</Badge>}
                          {missing.length > 0 && <Badge tone="amber">Missing: {missing.map(fieldLabel).join(", ")}</Badge>}
                          {r.stage === "ready_for_review" && <Badge tone="blue">Review &amp; approve</Badge>}
                          {pending > 0 && <Badge tone="amber">{pending} Jira change(s) to review</Badge>}
                          {r.jiraError && <Badge tone="red">Jira update failed</Badge>}
                        </div>
                      </td>
                      <td><Link href={`/onboarding/${r.id}`} className="text-xs text-accent hover:underline">Open →</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="First-day checklist items">
          <p className="mb-3 text-sm text-muted">Every approved request gets these items. Your team ticks them; when all are ticked on or after the first day, the request is completed and the Jira ticket moves to Done.</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className={t.active ? "text-ink" : "text-muted line-through"}>{t.label}</span>
                <form action={toggleChecklistTemplate}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="active" value={t.active ? "0" : "1"} />
                  <button className="text-xs text-accent hover:underline">{t.active ? "Turn off" : "Turn on"}</button>
                </form>
              </li>
            ))}
          </ul>
          <ActionForm action={addChecklistTemplate} className="mt-3">
            <div className="flex gap-2">
              <label htmlFor="new-checklist-item" className="sr-only">New checklist item</label>
              <input id="new-checklist-item" name="label" placeholder="e.g. Equipment handed over" className={input} />
              <SubmitButton variant="secondary" pending="Adding…">Add</SubmitButton>
            </div>
          </ActionForm>
        </Card>
        <Card title="How dates work">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
            <li>When the employee is contacted, the Hub suggests a collection date <strong className="text-ink">{collectionLeadDays()} days</strong> before the start date. You can change it for each person or start collecting right away.</li>
            <li>If the start date changes in Jira, a suggested collection date moves with it. A date you set by hand stays.</li>
            <li>The daily sync starts collection on the collection date, and starts the first day on the start date.</li>
            <li>After approval, changes in Jira are shown for review instead of changing the employee record.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
