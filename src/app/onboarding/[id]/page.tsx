import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { employees, onboardingRequests, requestChecklistItems, requestEvents } from "@/db/schema";
import { Badge, Card, PageHeader, Skeleton, btn, fmtDate, fmtDateTime, input, label } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { StageBadge, StageProgress } from "@/components/stage";
import { STAGE_META, REQUEST_FIELDS, collectionLeadDays, fieldLabel } from "@/lib/onboarding/stages";
import { effective, missingFor, suggestCollectionDate, today } from "@/lib/onboarding/engine";
import { getJiraClient, getMockTicket, jiraMode, jiraStatusNames } from "@/lib/integrations/jira-client";
import {
  answerAsRequester,
  approveRequest,
  askRequester,
  cancelRequest,
  markContacted,
  recheckTicket,
  reopenRequest,
  resolvePendingChange,
  retryJira,
  saveRequestCorrections,
  startCollectingNow,
  startFirstDayNow,
  toggleChecklistItem,
  updateCollectionDate,
} from "../actions";

export const metadata = { title: "Onboarding request" };

export default function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton rows={10} />}>
      <RequestView params={params} />
    </Suspense>
  );
}

async function RequestView({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const [r] = await db.select().from(onboardingRequests).where(eq(onboardingRequests.id, id));
  if (!r) notFound();
  const mock = jiraMode() === "mock";
  const [items, events, [employee], mockTicket] = await Promise.all([
    db.select().from(requestChecklistItems).where(eq(requestChecklistItems.requestId, id)).orderBy(asc(requestChecklistItems.sortOrder), asc(requestChecklistItems.id)),
    db.select().from(requestEvents).where(eq(requestEvents.requestId, id)).orderBy(desc(requestEvents.at), desc(requestEvents.id)).limit(100),
    r.employeeId ? db.select({ id: employees.id, fullName: employees.fullName, status: employees.status }).from(employees).where(eq(employees.id, r.employeeId)) : Promise.resolve([]),
    mock ? getMockTicket(r.jiraKey) : Promise.resolve(null),
  ]);
  const v = effective(r);
  const missing = missingFor(r);
  const closed = r.stage === "completed" || r.stage === "cancelled";
  const browse = getJiraClient().browseUrl(r.jiraKey);
  const pending = Object.entries(r.pendingChanges);
  const hidden = <input type="hidden" name="id" value={r.id} />;
  const description = typeof r.payload.description === "string" ? r.payload.description : "";

  return (
    <>
      <div className="mb-3 text-sm"><Link href="/onboarding" className="text-accent hover:underline">← Onboarding requests</Link></div>
      <PageHeader
        title={v.fullName ?? r.summary ?? r.jiraKey}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StageBadge stage={r.stage} />
            <span>{r.jiraKey}</span>
            <span>·</span>
            <span>Jira: {r.jiraStatus ?? "—"}</span>
            {[v.jobTitle, v.businessUnit, v.location].filter(Boolean).length > 0 && <span>· {[v.jobTitle, v.businessUnit, v.location].filter(Boolean).join(" · ")}</span>}
          </span>
        }
        actions={
          <ActionForm action={recheckTicket} className="flex flex-col items-end">
            {hidden}
            <SubmitButton variant="secondary" pending="Reading…">↻ Re-read from Jira</SubmitButton>
          </ActionForm>
        }
      />

      <div className="space-y-6">
        <Card><StageProgress stage={r.stage} /></Card>

        {r.jiraError && (
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            <p className="max-w-3xl">{r.jiraError}</p>
            <ActionForm action={retryJira}>{hidden}<SubmitButton variant="danger" pending="Retrying…">Retry Jira update</SubmitButton></ActionForm>
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <Card title="Next step" actions={<span className="text-xs text-muted">{STAGE_META[r.stage].hint}</span>}>
              {r.stage === "new" && (
                <div className="space-y-3 text-sm">
                  <p>Contact the new hire, then mark the request as contacted. The Jira ticket moves to <strong>{jiraStatusNames().inProgress}</strong> and the person enters pre-onboarding.</p>
                  <p className="text-muted">
                    Collection will be suggested for <strong className="text-ink">{fmtDate(suggestCollectionDate(v.startDate))}</strong>
                    {v.startDate ? ` (${collectionLeadDays()} days before the start date, ${fmtDate(v.startDate)})` : " — there is no start date yet, so collection starts right away and the requester is asked for it"}.
                  </p>
                  <ActionForm action={markContacted}>{hidden}<SubmitButton pending="Saving…">✓ Mark as contacted</SubmitButton></ActionForm>
                </div>
              )}

              {r.stage === "pre_onboarding" && (
                <div className="space-y-4 text-sm">
                  <p>
                    Information collection starts on <strong>{fmtDate(r.collectionDate)}</strong>
                    {r.collectionDateOverridden ? " (set by hand)." : ` (suggested: ${collectionLeadDays()} days before the start date).`} Until then, the contract can be signed and nothing else is needed.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <ActionForm action={updateCollectionDate} className="flex flex-wrap items-end gap-2">
                      {hidden}
                      <div>
                        <label htmlFor="collectionDate" className={label}>Collection date</label>
                        <input id="collectionDate" name="collectionDate" type="date" defaultValue={r.collectionDate ?? ""} min={today()} className={input} />
                      </div>
                      <SubmitButton variant="secondary" pending="Saving…">Save date</SubmitButton>
                    </ActionForm>
                    {r.collectionDateOverridden && (
                      <ActionForm action={updateCollectionDate}>
                        {hidden}
                        <input type="hidden" name="reset" value="1" />
                        <SubmitButton variant="secondary" pending="Saving…">Use suggestion</SubmitButton>
                      </ActionForm>
                    )}
                    <ActionForm action={startCollectingNow}>{hidden}<SubmitButton pending="Starting…">Start collecting now</SubmitButton></ActionForm>
                  </div>
                </div>
              )}

              {(r.stage === "collecting" || r.stage === "needs_info") && (
                <div className="space-y-4 text-sm">
                  {missing.length ? (
                    <p>
                      Missing: <strong>{missing.map(fieldLabel).join(", ")}</strong>.{" "}
                      {r.commentedAt ? `The requester was asked on the Jira ticket (${fmtDateTime(r.commentedAt)}).` : "The requester will be asked on the Jira ticket."} You can also fill the gaps yourself in the fields below.
                    </p>
                  ) : (
                    <p>All required information is present.</p>
                  )}
                  <ActionForm action={askRequester} className="space-y-2">
                    {hidden}
                    <label htmlFor="message" className={label}>Ask the requester something else</label>
                    <textarea id="message" name="message" rows={2} className={input} placeholder="e.g. Please confirm the office location." />
                    <SubmitButton variant="secondary" pending="Posting…">Post comment on Jira</SubmitButton>
                  </ActionForm>
                  {mock && missing.length > 0 && (
                    <details className="rounded-lg border border-dashed border-violet-300 bg-violet-50/50 p-3">
                      <summary className="cursor-pointer text-violet-900">Demo: answer as the requester</summary>
                      <ActionForm action={answerAsRequester} className="mt-3 space-y-2">
                        {hidden}
                        <div className="grid gap-2 sm:grid-cols-2">
                          {REQUEST_FIELDS.filter((f) => missing.includes(f.key)).map((f) => (
                            <div key={f.key}>
                              <label htmlFor={`demo-${f.key}`} className={label}>{f.label}</label>
                              <input id={`demo-${f.key}`} name={f.key} type={f.type === "date" ? "date" : f.type === "email" ? "email" : "text"} className={input} />
                            </div>
                          ))}
                        </div>
                        <SubmitButton variant="secondary" pending="Updating ticket…">Add to the dummy ticket</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </div>
              )}

              {r.stage === "ready_for_review" && (
                <div className="space-y-3 text-sm">
                  <p>Check the details below and correct anything that&apos;s wrong. Approving saves the employee record and adds the first-day checklist. The Jira ticket stays <strong>{jiraStatusNames().inProgress}</strong> until the checklist is done.</p>
                  {r.validationNotes && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">Warnings to check: {r.validationNotes}</p>}
                  <ActionForm action={approveRequest}>{hidden}<SubmitButton pending="Approving…">✓ Approve</SubmitButton></ActionForm>
                </div>
              )}

              {r.stage === "approved" && (
                <div className="space-y-3 text-sm">
                  <p>
                    Approved {fmtDateTime(r.approvedAt)}. The first day starts automatically on <strong>{fmtDate(v.startDate)}</strong>. You can tick checklist items ahead of time.
                  </p>
                  <ActionForm action={startFirstDayNow}>{hidden}<SubmitButton variant="secondary" pending="Starting…">Start first day now</SubmitButton></ActionForm>
                </div>
              )}

              {r.stage === "first_day" && (
                <p className="text-sm">Tick each item when it&apos;s done. When all are ticked, the request is completed and the Jira ticket moves to <strong>{jiraStatusNames().done}</strong>.</p>
              )}

              {r.stage === "completed" && <p className="text-sm">Onboarding completed {fmtDateTime(r.completedAt)}. The Jira ticket is {r.jiraStatus ?? "closed"}.</p>}

              {r.stage === "cancelled" && (
                <div className="space-y-3 text-sm">
                  <p>Cancelled {fmtDateTime(r.cancelledAt)}{r.cancelReason ? `: ${r.cancelReason}` : "."}</p>
                  <ActionForm action={reopenRequest}>{hidden}<SubmitButton variant="secondary" pending="Reopening…">Reopen request</SubmitButton></ActionForm>
                </div>
              )}

              {(r.stage === "approved" || r.stage === "first_day") && items.length > 0 && (
                <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
                  {items.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <form action={toggleChecklistItem} className="flex items-center gap-3">
                        <input type="hidden" name="requestId" value={r.id} />
                        <input type="hidden" name="itemId" value={i.id} />
                        <input type="hidden" name="done" value={i.done ? "0" : "1"} />
                        <button
                          aria-label={i.done ? `Untick ${i.label}` : `Tick ${i.label}`}
                          className={`grid size-5 place-items-center rounded border text-xs ${i.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-surface hover:border-accent"}`}
                        >
                          {i.done ? "✓" : ""}
                        </button>
                        <span className={i.done ? "text-muted line-through" : "text-ink"}>{i.label}</span>
                      </form>
                      {i.done && <span className="text-xs text-muted">{i.doneBy} · {fmtDateTime(i.doneAt)}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {r.stage === "completed" && items.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-muted">
                  {items.map((i) => <li key={i.id}>✓ {i.label} — {fmtDateTime(i.doneAt)}</li>)}
                </ul>
              )}

              {!closed && (
                <details className="mt-5 border-t border-line pt-3 text-sm">
                  <summary className="cursor-pointer text-muted">Cancel this request</summary>
                  <ActionForm action={cancelRequest} className="mt-2 flex flex-wrap items-end gap-2">
                    {hidden}
                    <div className="min-w-64 flex-1">
                      <label htmlFor="reason" className={label}>Reason</label>
                      <input id="reason" name="reason" className={input} placeholder="e.g. Offer withdrawn" />
                    </div>
                    <SubmitButton variant="danger" pending="Cancelling…">Cancel request</SubmitButton>
                  </ActionForm>
                </details>
              )}
            </Card>

            {pending.length > 0 && (
              <Card title="Changed in Jira after approval">
                <p className="mb-3 text-sm text-muted">The employee record keeps the approved values until you decide.</p>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {pending.map(([field, c]) => (
                    <li key={field} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <span>
                        <strong>{fieldLabel(field)}</strong>: {field === "startDate" ? fmtDate(c.from) : (c.from ?? "empty")} → <strong>{field === "startDate" ? fmtDate(c.to) : (c.to ?? "empty")}</strong>
                      </span>
                      <span className="flex gap-2">
                        {(["accept", "dismiss"] as const).map((d) => (
                          <form key={d} action={resolvePendingChange}>
                            {hidden}
                            <input type="hidden" name="field" value={field} />
                            <input type="hidden" name="decision" value={d} />
                            <button className={d === "accept" ? btn.primary : btn.secondary}>{d === "accept" ? "Use Jira value" : "Keep approved value"}</button>
                          </form>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card title="Details" actions={<span className="text-xs text-muted">Corrections are never overwritten by the Jira sync</span>}>
              <ActionForm action={saveRequestCorrections}>
                {hidden}
                <div className="overflow-auto">
                  <table className="data">
                    <thead><tr><th>Field</th><th>From Jira</th><th>Your correction</th><th>Used</th></tr></thead>
                    <tbody>
                      {REQUEST_FIELDS.map((f) => {
                        const jira = (r[f.key] as string | null) ?? null;
                        const corrected = f.key in r.corrections;
                        const isMissing = missing.includes(f.key);
                        const show = (x: string | null) => (f.type === "date" ? fmtDate(x) : (x ?? "—"));
                        return (
                          <tr key={f.key}>
                            <td className="font-medium">{f.label}{isMissing && <span className="ml-1 text-amber-700">· missing</span>}</td>
                            <td className="text-muted">{show(jira)}</td>
                            <td className="min-w-56">
                              <label htmlFor={`c-${f.key}`} className="sr-only">{f.label} correction</label>
                              <input
                                id={`c-${f.key}`}
                                name={f.key}
                                type={f.type === "date" ? "date" : f.type === "email" ? "email" : "text"}
                                defaultValue={corrected ? (r.corrections[f.key] ?? "") : ""}
                                placeholder={jira ? "Same as Jira" : "Add value"}
                                disabled={closed}
                                className={`${input} py-1.5 ${isMissing ? "border-amber-400" : ""}`}
                              />
                            </td>
                            <td>{show(v[f.key])}{corrected && <Badge tone="blue">corrected</Badge>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!closed && (
                  <div className="mt-3 flex items-center gap-3">
                    <SubmitButton variant="secondary" pending="Saving…">Save corrections</SubmitButton>
                    <span className="text-xs text-muted">Leave a field empty to use the Jira value.</span>
                  </div>
                )}
              </ActionForm>
              {r.validationNotes && r.stage !== "ready_for_review" && <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Warnings from the automatic check: {r.validationNotes}</p>}
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="Jira ticket" actions={browse ? <a href={browse} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Open in Jira ↗</a> : mock ? <Badge tone="gray">Dummy ticket</Badge> : undefined}>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-muted">Key</dt><dd>{r.jiraKey}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Status</dt><dd>{r.jiraStatus ?? "—"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Requester</dt><dd>{r.reporter ?? "—"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Created</dt><dd>{fmtDateTime(r.jiraCreatedAt)}</dd></div>
              </dl>
              {description && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-accent">Ticket description</summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-2 font-sans text-xs text-ink">{description}</pre>
                </details>
              )}
              {mockTicket && mockTicket.comments.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs font-medium text-muted">Comments posted by the Hub</div>
                  {mockTicket.comments.map((c, i) => (
                    <div key={i} className="rounded-md bg-canvas p-2 text-xs">
                      <div className="mb-1 text-muted">{fmtDateTime(c.at)}</div>
                      <div className="whitespace-pre-wrap">{c.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Employee record">
              {employee ? (
                <p className="text-sm">
                  <Link href={`/employees/${employee.id}`} className="text-accent hover:underline">{employee.fullName} →</Link>
                </p>
              ) : (
                <p className="text-sm text-muted">Created when the request is approved.</p>
              )}
            </Card>

            <Card title="Timeline" padded={false}>
              {events.length === 0 ? (
                <p className="p-5 text-sm text-muted">Nothing yet.</p>
              ) : (
                <ol className="max-h-[560px] divide-y divide-line overflow-auto">
                  {events.map((e) => (
                    <li key={e.id} className="px-5 py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted">
                        <span>{fmtDateTime(e.at)}</span>
                        <span>{e.actor}</span>
                      </div>
                      <div className="mt-0.5">
                        {e.type === "stage" && e.toStage ? <>Moved to <strong>{STAGE_META[e.toStage].label}</strong>{e.message ? ` — ${e.message}` : ""}</> : e.message}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
