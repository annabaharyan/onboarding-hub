/**
 * End-to-end check of the onboarding flow against the configured database, in Jira demo mode.
 *   JIRA_MODE=mock npx tsx scripts/flow-check.ts
 * Creates dummy tickets, walks one through every stage and prints what happened.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb, getPool } from "@/db";
import { mockJiraIssues, onboardingRequests, requestChecklistItems } from "@/db/schema";
import { runSync } from "@/lib/sync";
import * as flow from "@/lib/onboarding/engine";
import { answerMockTicket, getMockTicket, jiraMode } from "@/lib/integrations/jira-client";
import { fetchIssue, processIssue } from "@/lib/integrations/jira";

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
};

async function byKey(key: string) {
  const [r] = await getDb().select().from(onboardingRequests).where(eq(onboardingRequests.jiraKey, key));
  return r;
}

async function main() {
  if (jiraMode() !== "mock") throw new Error("Run with JIRA_MODE=mock — this script must never touch real Jira.");
  console.log("1. First sync loads dummy tickets as new requests");
  const rep = await runSync(["jira"], "manual");
  console.log("   ", rep.runs.map((r) => `${r.source}: ${r.status} fetched=${r.fetched} created=${r.created} ${r.message ?? ""}`).join("; "));
  let far = await byKey("DEMO-101");
  assert(far?.stage === "new", "DEMO-101 is a new request");
  assert((await getMockTicket("DEMO-101"))?.status === "Open", "its Jira ticket is Open");

  console.log("2. Contacting a far-off hire puts them in pre-onboarding with a suggested collection date");
  far = await flow.markContacted(far.id, "test");
  assert(far.stage === "pre_onboarding", "stage is pre_onboarding");
  assert(far.collectionDate && far.collectionDate > flow.today(), `collection date ${far.collectionDate} is in the future`);
  assert((await getMockTicket("DEMO-101"))?.status === "Work in progress", "Jira moved to Work in progress");

  console.log("3. Sync again — nothing should change (idempotent)");
  await runSync(["jira"], "manual");
  assert((await flow.getRequest(far.id)).stage === "pre_onboarding", "still pre_onboarding");

  console.log("4. Contacting a soon hire with a missing manager goes straight to Needs info and comments once");
  let soon = await byKey("DEMO-103");
  soon = await flow.markContacted(soon.id, "test");
  assert(soon.stage === "needs_info", `stage is needs_info (missing ${flow.missingFor(soon).join(",")})`);
  let t = await getMockTicket("DEMO-103");
  assert(t?.comments.length === 1, "one comment posted to Jira");
  await runSync(["jira"], "manual");
  t = await getMockTicket("DEMO-103");
  assert(t?.comments.length === 1, "no duplicate comment after another sync");

  console.log("5. Requester adds the manager → next sync makes it ready for review");
  await answerMockTicket("DEMO-103", { Manager: "Morgan Brandt" });
  await runSync(["jira"], "manual");
  soon = await flow.getRequest(soon.id);
  assert(soon.stage === "ready_for_review", "ready_for_review");

  console.log("6. A team correction is kept across syncs");
  await flow.saveCorrections(soon.id, { location: "Gyumri" }, "test");
  await runSync(["jira"], "manual");
  assert(flow.effective(await flow.getRequest(soon.id)).location === "Gyumri", "correction survives sync");

  console.log("7. Approve → employee + checklist; start first day; tick all → completed and Jira Done");
  soon = await flow.approve(soon.id, "test");
  assert(soon.stage === "approved" && soon.employeeId, "approved with employee record");
  const items = await getDb().select().from(requestChecklistItems).where(eq(requestChecklistItems.requestId, soon.id));
  assert(items.length === 3, "3 checklist items created");
  soon = await flow.startFirstDay(soon.id, "test");
  assert(soon.stage === "first_day", "first_day");
  for (const i of items) await flow.setChecklistItem(i.id, true, "test");
  soon = await flow.getRequest(soon.id);
  assert(soon.stage === "completed", "completed after last tick");
  assert((await getMockTicket("DEMO-103"))?.status === "Done", "Jira moved to Done");

  console.log("8. Change in Jira after approval is flagged, not applied");
  const [row] = await getDb().select().from(mockJiraIssues).where(eq(mockJiraIssues.key, "DEMO-103"));
  await getDb().update(mockJiraIssues).set({ description: row.description.replace(/Job title: .*/, "Job title: Senior Associate") }).where(eq(mockJiraIssues.key, "DEMO-103"));
  await processIssue(await fetchIssue("DEMO-103"));
  soon = await flow.getRequest(soon.id);
  assert(soon.pendingChanges.jobTitle?.to === "Senior Associate", "pending change recorded");
  assert(flow.effective(soon).jobTitle === "Associate", "approved value still used while the change waits");
  soon = await flow.acceptPendingChange(soon.id, "jobTitle", "test");
  assert(flow.effective(soon).jobTitle === "Senior Associate" && !soon.pendingChanges.jobTitle, "accepting applies the Jira value");

  console.log("9. A missing start date collects immediately; illegal moves are refused");
  let nodate = await byKey("DEMO-105");
  nodate = await flow.markContacted(nodate.id, "test");
  assert(nodate.stage === "needs_info", "no start date → needs_info right away");
  let refused = false;
  try { await flow.approve(nodate.id, "test"); } catch { refused = true; }
  assert(refused, "approve refused while info is missing");

  console.log("\nAll checks passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
