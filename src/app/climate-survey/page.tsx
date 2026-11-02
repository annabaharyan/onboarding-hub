import { Suspense } from "react";
import { connection } from "next/server";
import { BarList, Card, Empty, PageHeader, Skeleton, Stat } from "@/components/ui";
import { climateSurveyReport } from "@/lib/climate-survey";

export const metadata = { title: "Climate survey" };

export default function ClimateSurveyPage() {
  return (
    <>
      <PageHeader
        title="Climate survey"
        description="Anonymous responses pulled from the team's Google Form. No respondent identity is captured — only aggregate results are shown."
        actions={
          <a
            href="https://docs.google.com/forms/d/e/1FAIpQLSekfLJxaAE1YMVynn654Sh60jovLhDj7VuUuP4Wh4wo-DR0-Q/viewform"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-canvas"
          >
            Open the form ↗
          </a>
        }
      />
      <Suspense fallback={<Skeleton rows={8} />}>
        <Report />
      </Suspense>
    </>
  );
}

async function Report() {
  await connection();
  const { totalResponses, questions } = await climateSurveyReport();

  if (totalResponses === 0)
    return (
      <Card>
        <Empty title="No responses yet">
          Set up the connection on the <a href="/integrations" className="text-accent underline">Integrations</a> page, then click &ldquo;Sync now&rdquo; there to pull in responses.
        </Empty>
      </Card>
    );

  return (
    <div className="space-y-6">
      <Stat label="Total responses" value={totalResponses.toLocaleString()} />
      <div className="grid gap-6 lg:grid-cols-2">
        {questions.map((q) => (
          <Card key={q.question} title={q.question}>
            {q.kind === "scale" && (
              <>
                <p className="text-3xl font-semibold text-ink">
                  {q.average.toFixed(1)} <span className="text-sm font-normal text-muted">average · {q.responses} response(s)</span>
                </p>
                <div className="mt-4">
                  <BarList items={q.distribution.map((d) => ({ label: d.option, value: d.count }))} />
                </div>
              </>
            )}
            {q.kind === "choice" && <BarList items={q.distribution.map((d) => ({ label: d.option, value: d.count }))} />}
            {q.kind === "text" && <p className="text-sm text-muted">{q.responses} written response(s) — open text isn&apos;t charted.</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}
