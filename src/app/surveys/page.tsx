import { Suspense } from "react";
import { connection } from "next/server";
import { BarList, Card, Empty, PageHeader, Skeleton } from "@/components/ui";
import { surveyReport, SURVEY_IMPROVEMENT_LABEL, SURVEY_LIKE_LABEL, type SurveyImprovement, type SurveyLike } from "@/lib/survey";

export default function SurveysPage() {
  return (
    <>
      <PageHeader title="6-month survey" description="Onboarding experience, manager support and overall satisfaction, segmented by business unit and career track." />
      <Suspense fallback={<Skeleton rows={8} />}>
        <Report />
      </Suspense>
    </>
  );
}

function fmtScore(n: number | null) {
  return n == null ? "—" : n.toFixed(1);
}

async function Report() {
  await connection();
  const r = await surveyReport();

  if (r.overall.responses === 0)
    return (
      <Card>
        <Empty title="No survey responses yet">Mark an invite as sent and record a response from an employee&apos;s page to see results here.</Empty>
      </Card>
    );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Onboarding experience"><p className="text-3xl font-semibold text-ink">{fmtScore(r.overall.avgOnboarding)}<span className="text-sm text-muted"> / 5</span></p></Card>
        <Card title="Manager support"><p className="text-3xl font-semibold text-ink">{fmtScore(r.overall.avgManagerSupport)}<span className="text-sm text-muted"> / 5</span></p></Card>
        <Card title="Overall satisfaction"><p className="text-3xl font-semibold text-ink">{fmtScore(r.overall.avgOverall)}<span className="text-sm text-muted"> / 5</span></p></Card>
      </div>
      <p className="text-xs text-muted">{r.overall.responses} response(s) so far.</p>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="By business unit" padded={false}>
          {r.byBusinessUnit.length ? (
            <table className="data">
              <thead><tr><th>Business unit</th><th>Responses</th><th>Onboarding</th><th>Manager</th><th>Overall</th></tr></thead>
              <tbody>
                {r.byBusinessUnit.map((s) => (
                  <tr key={s.segment}>
                    <td>{s.segment}</td><td>{s.responses}</td>
                    <td>{fmtScore(s.avgOnboarding)}</td><td>{fmtScore(s.avgManagerSupport)}</td><td>{fmtScore(s.avgOverall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="p-5 text-sm text-muted">No responses yet.</p>}
        </Card>
        <Card title="By career track" padded={false}>
          {r.byCareerTrack.length ? (
            <table className="data">
              <thead><tr><th>Career track</th><th>Responses</th><th>Onboarding</th><th>Manager</th><th>Overall</th></tr></thead>
              <tbody>
                {r.byCareerTrack.map((s) => (
                  <tr key={s.segment}>
                    <td>{s.segment}</td><td>{s.responses}</td>
                    <td>{fmtScore(s.avgOnboarding)}</td><td>{fmtScore(s.avgManagerSupport)}</td><td>{fmtScore(s.avgOverall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="p-5 text-sm text-muted">No responses yet.</p>}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="What people liked">
          {r.likeFrequency.length ? (
            <BarList items={r.likeFrequency.map((f) => ({ label: SURVEY_LIKE_LABEL[f.option as SurveyLike] ?? f.option, value: f.count }))} />
          ) : <Empty title="No answers yet" />}
        </Card>
        <Card title="What could improve">
          {r.improvementFrequency.length ? (
            <BarList items={r.improvementFrequency.map((f) => ({ label: SURVEY_IMPROVEMENT_LABEL[f.option as SurveyImprovement] ?? f.option, value: f.count }))} />
          ) : <Empty title="No answers yet" />}
        </Card>
      </div>
    </div>
  );
}
