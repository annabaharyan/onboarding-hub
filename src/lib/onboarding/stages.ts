import type { RequestCorrections, RequestStage } from "@/db/schema";

/** Order and labels of the onboarding process, matching the approved flow diagram. */
export const STAGES: RequestStage[] = ["new", "pre_onboarding", "collecting", "needs_info", "ready_for_review", "approved", "first_day", "completed", "cancelled"];

/** The main path shown in the progress bar (needs_info is a side state of collecting). */
export const STAGE_PATH: RequestStage[] = ["new", "pre_onboarding", "collecting", "ready_for_review", "approved", "first_day", "completed"];

export const ACTIVE_STAGES: RequestStage[] = ["new", "pre_onboarding", "collecting", "needs_info", "ready_for_review", "approved", "first_day"];

export const STAGE_META: Record<RequestStage, { label: string; hint: string; jira: "open" | "inProgress" | "done" | "keep"; tone: string }> = {
  new: { label: "New request", hint: "Ticket received — contact the employee", jira: "open", tone: "bg-slate-100 text-slate-700 ring-slate-200" },
  pre_onboarding: { label: "Pre-onboarding", hint: "Contacted — waiting for the collection date", jira: "inProgress", tone: "bg-violet-50 text-violet-700 ring-violet-200" },
  collecting: { label: "Collecting info", hint: "Checking the request", jira: "inProgress", tone: "bg-sky-50 text-sky-700 ring-sky-200" },
  needs_info: { label: "Needs info", hint: "Waiting for the requester or a correction", jira: "inProgress", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  ready_for_review: { label: "Ready for review", hint: "All checks passed — review and approve", jira: "inProgress", tone: "bg-orange-50 text-orange-700 ring-orange-200" },
  approved: { label: "Approved", hint: "Employee record saved — waiting for the first day", jira: "inProgress", tone: "bg-teal-50 text-teal-700 ring-teal-200" },
  first_day: { label: "First day", hint: "Tick the first-day checklist", jira: "inProgress", tone: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  completed: { label: "Completed", hint: "All done — Jira ticket closed", jira: "done", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  cancelled: { label: "Cancelled", hint: "Request withdrawn", jira: "keep", tone: "bg-rose-50 text-rose-700 ring-rose-200" },
};

/** Allowed moves. Everything else is refused by the engine. */
export const ALLOWED: Record<RequestStage, RequestStage[]> = {
  new: ["pre_onboarding", "cancelled"],
  pre_onboarding: ["collecting", "cancelled"],
  collecting: ["needs_info", "ready_for_review", "cancelled"],
  needs_info: ["ready_for_review", "cancelled"],
  ready_for_review: ["needs_info", "approved", "cancelled"],
  approved: ["first_day", "cancelled"],
  first_day: ["completed", "cancelled"],
  completed: [],
  cancelled: ["new"],
};

export const REQUEST_FIELDS: { key: keyof RequestCorrections; label: string; type: "text" | "date" | "email" }[] = [
  { key: "fullName", label: "Full name", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "startDate", label: "Start date", type: "date" },
  { key: "businessUnit", label: "Business unit", type: "text" },
  { key: "jobTitle", label: "Job title", type: "text" },
  { key: "location", label: "Location", type: "text" },
  { key: "manager", label: "Manager", type: "text" },
];

export type RequestFieldKey = keyof RequestCorrections;

/** Fields a request must have before it can be approved. Configure with ONBOARDING_REQUIRED_FIELDS. */
export function requiredFields(): RequestFieldKey[] {
  const keys = REQUEST_FIELDS.map((f) => f.key) as string[];
  return (process.env.ONBOARDING_REQUIRED_FIELDS || process.env.JIRA_REQUIRED_FIELDS || "fullName,email,startDate,businessUnit,jobTitle,location,manager")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is RequestFieldKey => keys.includes(s));
}

/** How many days before the start date collection is suggested to start. */
export function collectionLeadDays(): number {
  const n = Number(process.env.ONBOARDING_COLLECTION_LEAD_DAYS ?? 21);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 21;
}

export const fieldLabel = (k: string) => REQUEST_FIELDS.find((f) => f.key === k)?.label ?? k;
