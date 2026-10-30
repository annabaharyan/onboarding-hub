import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { onboardingRequests } from "@/db/schema";
import { Badge, Card, Empty, PageHeader, Skeleton, Stat, fmtDate, fmtDateTime } from "@/components/ui";
import { FIELD_MAP, type EmployeeField } from "@/lib/fields";
import { claudeConfigured } from "@/lib/integrations/claude";
import { linkTicketToNewEmployee, revalidateTicket } from "../actions";

export const metadata = { title: "Onboarding requests" };
type SP = Promise<{ v?: string }>;

export default function OnboardingPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader
        title="Onboarding requests"
        description="Onboarding tickets from Jira, checked against the required-information template. Complete requests become pre-onboarding employees automatically; incomplete ones are flagged (and, if enabled, the reporter gets a Jira comment)."
      />
      <Suspense fallback={<Skeleton rows={8} />}>
        <Requests searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Requests({ searchParams }: { searchParams: SP }) {
  await connection();
  const { v } = await searchParams;
  const db = getDb();
  const filter = v === "missing_info" || v === "valid" ? v : undefined;
  const rows = await db
    .select()
    .from(onboardingRequests)
    .where(filter ? eq(onboardingRequests.validationStatus, filter) : undefined)
    .orderBy(desc(onboardingRequests.jiraCreatedAt))
    .limit(300);
  const all = filter ? await db.select({ s: onboardingRequests.validationStatus }).from(onboardingRequests) : rows.map((r) => ({ s: r.validationStatus }));
  const count = (s: string) => all.filter((r) => r.s === s).length;
  const jiraBase = process.env.JIRA_BASE_URL?.replace(/\/$/, "");

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="All requests" value={all.length} href="/onboarding" />
        <Stat label="Complete" value={count("valid")} href="/onboarding?v=valid" />
        <Stat label="Missing information" value={count("missing_info")} href="/onboarding?v=missing_info" />
      </div>
      {!claudeConfigured() && (
        <p className="rounded-lg bg-sky-50 px-4 py-2 text-sm text-sky-900">
          Claude isn&apos;t connected, so checks are rule-based only (required fields present). Add <code>ANTHROPIC_API_KEY</code> to have Claude read free-text tickets, catch implausible values and write the reporter comment.
        </p>
      )}
      <Card padded={false} title={filter ? (filter === "valid" ? "Complete requests" : "Requests missing information") : "All requests"}>
        {rows.length === 0 ? (
          <div className="p-5"><Empty title="No onboarding requests yet">Configure Jira on the <Link href="/integrations" className="text-accent underline">Integrations</Link> page and run a sync.</Empty></div>
        ) : (
          <div className="overflow-auto">
            <table className="data">
              <thead><tr><th>Ticket</th><th>New joiner</th><th>Start</th><th>Business unit</th><th>Role</th><th>Check</th><th>Missing / notes</th><th>Employee</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {jiraBase ? <a href={`${jiraBase}/browse/${r.jiraKey}`} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">{r.jiraKey}</a> : r.jiraKey}
                      <div className="text-xs text-muted">{r.jiraStatus} · {fmtDateTime(r.jiraCreatedAt)}</div>
                    </td>
                    <td>{r.fullName ?? <span className="text-muted">—</span>}<div className="text-xs text-muted">{r.email}</div></td>
                    <td className="tabular-nums">{fmtDate(r.startDate)}</td>
                    <td>{r.businessUnit ?? "—"}</td>
                    <td>{r.jobTitle ?? "—"}</td>
                    <td>
                      {r.validationStatus === "valid" ? <Badge tone="green">✓ Complete</Badge> : r.validationStatus === "missing_info" ? <Badge tone="amber">! Missing info</Badge> : <Badge>{r.validationStatus}</Badge>}
                      {r.commentedAt && <div className="mt-1 text-xs text-muted">Reporter notified</div>}
                    </td>
                    <td className="max-w-sm whitespace-normal text-xs">
                      {r.missingFields.length > 0 && <div className="text-amber-800">Missing: {r.missingFields.map((m) => FIELD_MAP[m as EmployeeField]?.label ?? m).join(", ")}</div>}
                      {r.validationNotes && <div className="text-muted">{r.validationNotes}</div>}
                    </td>
                    <td>
                      {r.employeeId ? (
                        <Link href={`/employees/${r.employeeId}`} className="text-accent hover:underline">Open →</Link>
                      ) : r.fullName ? (
                        <form action={linkTicketToNewEmployee}><input type="hidden" name="id" value={r.id} /><button className="text-xs text-accent hover:underline">Create employee</button></form>
                      ) : "—"}
                    </td>
                    <td>
                      <form action={revalidateTicket}><input type="hidden" name="key" value={r.jiraKey} /><button className="text-xs text-accent hover:underline">Re-check</button></form>
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
