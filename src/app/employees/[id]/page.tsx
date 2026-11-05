import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { filterOptions } from "@/lib/queries";
import { employees, employeeChanges, monthlySnapshots, onboardingRequests, onboardingSurveys, orgUnits, probationFeedback, probationReviews } from "@/db/schema";
import { Badge, Card, PageHeader, Skeleton, StatusBadge, fmtDate, fmtDateTime, input } from "@/components/ui";
import { FIELD_MAP, type EmployeeField } from "@/lib/fields";
import { SURVEY_IMPROVEMENTS, SURVEY_IMPROVEMENT_LABEL, SURVEY_LIKES, SURVEY_LIKE_LABEL } from "@/lib/survey";
import { EditEmployee } from "./edit-form";
import { StageBadge } from "@/components/stage";
import { addProbationFeedback, openProbationReview, recordProbationDecision, recordSurveyResponse, sendSurveyInvite, unlockField } from "@/app/actions";

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
  const [changes, snaps, tickets, { legalEntity: legalEntityOptions }, reviews, allFeedback] = await Promise.all([
    db.select().from(employeeChanges).where(eq(employeeChanges.employeeId, id)).orderBy(desc(employeeChanges.changedAt)).limit(100),
    db.select().from(monthlySnapshots).where(eq(monthlySnapshots.employeeId, id)).orderBy(desc(monthlySnapshots.month)).limit(24),
    db.select().from(onboardingRequests).where(eq(onboardingRequests.employeeId, id)),
    filterOptions(),
    db.select().from(probationReviews).where(eq(probationReviews.employeeId, id)).orderBy(desc(probationReviews.createdAt)),
    db.select({ f: probationFeedback }).from(probationFeedback)
      .innerJoin(probationReviews, eq(probationFeedback.reviewId, probationReviews.id))
      .where(eq(probationReviews.employeeId, id))
      .orderBy(desc(probationFeedback.createdAt)),
  ]);
  const feedbackByReview = new Map<number, typeof allFeedback[number]["f"][]>();
  for (const { f } of allFeedback) feedbackByReview.set(f.reviewId, [...(feedbackByReview.get(f.reviewId) ?? []), f]);

  const [survey] = await db.select().from(onboardingSurveys).where(and(eq(onboardingSurveys.employeeId, id), eq(onboardingSurveys.surveyType, "six_month")));
  const [orgUnit] = e.businessUnit ? await db.select().from(orgUnits).where(eq(orgUnits.businessUnit, e.businessUnit)) : [];

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
            <EditEmployee employee={JSON.parse(JSON.stringify(e))} legalEntityOptions={legalEntityOptions} />
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
          <Card title="Probation">
            {reviews.length === 0 ? (
              <form action={openProbationReview}>
                <input type="hidden" name="employeeId" value={e.id} />
                <p className="mb-2 text-sm text-muted">No probation review opened yet{e.probationEndDate ? ` — current end date ${fmtDate(e.probationEndDate)}` : ""}.</p>
                <button className="text-xs text-accent hover:underline">Open probation review</button>
              </form>
            ) : (
              <ul className="space-y-4">
                {reviews.map((r) => {
                  const fb = feedbackByReview.get(r.id) ?? [];
                  return (
                    <li key={r.id} className="border-b border-line pb-4 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between text-sm">
                        <span>Opened {fmtDate(r.createdAt)}{r.dueDate ? ` · due ${fmtDate(r.dueDate)}` : ""}</span>
                        <Badge tone={r.decision === "pending" ? "gray" : r.decision === "terminated" ? "red" : "green"}>{r.decision}</Badge>
                      </div>
                      {fb.length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm text-muted">
                          {fb.map((f) => (
                            <li key={f.id}>
                              <span className="font-medium text-ink">{f.reviewerName}</span>
                              {f.reviewerRole ? ` (${f.reviewerRole})` : ""}
                              {f.skillScore != null ? ` — ${f.skillScore}/5` : ""}
                              {f.comment ? `: ${f.comment}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                      {r.decision === "pending" ? (
                        <>
                          <form action={addProbationFeedback} className="mt-3 grid gap-1.5 sm:grid-cols-2">
                            <input type="hidden" name="reviewId" value={r.id} />
                            <input type="hidden" name="employeeId" value={e.id} />
                            <input name="reviewerName" placeholder="Reviewer name" className={input} required />
                            <input name="reviewerRole" placeholder="Role (e.g. Manager)" className={input} />
                            <select name="skillScore" className={input} defaultValue="">
                              <option value="">Skill score</option>
                              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}/5</option>)}
                            </select>
                            <input name="comment" placeholder="Comment" className={input} />
                            <button className="col-span-full justify-self-start text-xs text-accent hover:underline">Add feedback</button>
                          </form>
                          <form action={recordProbationDecision} className="mt-3 grid gap-1.5 sm:grid-cols-2">
                            <input type="hidden" name="reviewId" value={r.id} />
                            <input type="hidden" name="employeeId" value={e.id} />
                            <select name="decision" className={input} required defaultValue="">
                              <option value="" disabled>Committee decision…</option>
                              <option value="confirmed">Confirm</option>
                              <option value="extended">Extend</option>
                              <option value="terminated">Terminate</option>
                            </select>
                            <input name="decidedBy" placeholder="Decided by" className={input} />
                            <input name="extendedToDate" type="date" className={input} title="New end date — only used if decision is Extend" />
                            <input name="committeeNotes" placeholder="Notes" className={input} />
                            <button className="col-span-full justify-self-start text-xs text-accent hover:underline">Record decision</button>
                          </form>
                        </>
                      ) : (
                        <p className="mt-2 text-xs text-muted">
                          Decided {r.decisionDate ? fmtDate(r.decisionDate) : ""}{r.decidedBy ? ` by ${r.decidedBy}` : ""}{r.committeeNotes ? ` — ${r.committeeNotes}` : ""}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {orgUnit && (
            <Card title="Org hierarchy" actions={<Link href="/org" className="text-xs text-accent hover:underline">Edit →</Link>}>
              <dl className="space-y-1.5 text-sm">
                {[["Cluster", orgUnit.cluster], ["Business unit", orgUnit.businessUnit], ["HRBP", orgUnit.hrbp], ["Head of Business Ops", orgUnit.headOfBusinessOps], ["Business Controller", orgUnit.businessController], ["Staffing Partner", orgUnit.staffingPartner]].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2"><dt className="text-muted">{k}</dt><dd className="truncate">{v ?? "—"}</dd></div>
                ))}
              </dl>
            </Card>
          )}
          <Card title="6-month survey">
            {!survey ? (
              <form action={sendSurveyInvite}>
                <input type="hidden" name="employeeId" value={e.id} />
                <p className="mb-2 text-sm text-muted">No survey sent yet.</p>
                <button className="text-xs text-accent hover:underline">Mark invite sent</button>
              </form>
            ) : survey.respondedAt ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Onboarding experience</dt><dd>{survey.onboardingExperienceScore ?? "—"}/5</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Manager support</dt><dd>{survey.managerSupportScore ?? "—"}/5</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Overall satisfaction</dt><dd>{survey.overallSatisfactionScore ?? "—"}/5</dd></div>
                {survey.likes.length > 0 && <p className="text-muted">Liked: {survey.likes.map((l) => SURVEY_LIKE_LABEL[l as keyof typeof SURVEY_LIKE_LABEL] ?? l).join(", ")}</p>}
                {survey.improvements.length > 0 && <p className="text-muted">Improve: {survey.improvements.map((i) => SURVEY_IMPROVEMENT_LABEL[i as keyof typeof SURVEY_IMPROVEMENT_LABEL] ?? i).join(", ")}</p>}
                {survey.comments && <p className="text-muted">&ldquo;{survey.comments}&rdquo;</p>}
                <p className="text-xs text-muted">Responded {fmtDateTime(survey.respondedAt)}</p>
              </div>
            ) : (
              <form action={recordSurveyResponse} className="space-y-2.5 text-sm">
                <input type="hidden" name="employeeId" value={e.id} />
                <p className="text-xs text-muted">Invite sent {fmtDateTime(survey.sentAt)} — record the response below.</p>
                {([
                  ["onboardingExperienceScore", "Onboarding experience"],
                  ["managerSupportScore", "Manager support"],
                  ["overallSatisfactionScore", "Overall satisfaction"],
                ] as const).map(([name, label]) => (
                  <label key={name} className="flex items-center justify-between gap-2">
                    {label}
                    <select name={name} className={`${input} w-24`} defaultValue="">
                      <option value="">—</option>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}/5</option>)}
                    </select>
                  </label>
                ))}
                <div>
                  <p className="mb-1 text-xs font-medium text-muted">What they liked</p>
                  <div className="flex flex-wrap gap-2">
                    {SURVEY_LIKES.map((l) => (
                      <label key={l} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" name="likes" value={l} className="size-3.5 rounded border-line" />
                        {SURVEY_LIKE_LABEL[l]}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted">What could improve</p>
                  <div className="flex flex-wrap gap-2">
                    {SURVEY_IMPROVEMENTS.map((imp) => (
                      <label key={imp} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" name="improvements" value={imp} className="size-3.5 rounded border-line" />
                        {SURVEY_IMPROVEMENT_LABEL[imp]}
                      </label>
                    ))}
                  </div>
                </div>
                <input name="comments" placeholder="Other comments" className={input} />
                <button className="text-xs text-accent hover:underline">Save response</button>
              </form>
            )}
          </Card>
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
                <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/onboarding/${t.id}`} className="font-medium text-accent hover:underline">{t.jiraKey}</Link>
                  <StageBadge stage={t.stage} />
                </div>
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
