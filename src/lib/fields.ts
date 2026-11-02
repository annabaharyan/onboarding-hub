import type { Employee } from "@/db/schema";

export type EmployeeField = Exclude<
  keyof Employee,
  "id" | "sources" | "lockedFields" | "extra" | "createdAt" | "updatedAt" | "lastSyncedAt"
>;

/** Fields stored as real booleans (not text) — drives Incoming's per-field typing in employee-writer.ts. */
export const BOOLEAN_FIELDS = ["contractInTimebase", "ndaSigned", "gdprConsent", "cvOnFile", "welcomeKitSent", "welcomeTrainingDone", "elearningCompleted", "twoWeekCheckinDone", "hrbpNotified"] as const;
export type BooleanField = (typeof BOOLEAN_FIELDS)[number];

export type FieldDef = {
  key: EmployeeField;
  label: string;
  type: "text" | "date" | "status" | "boolean" | "careerTrack" | "offboardingReasonCategory";
  /** Normalised header names that map to this field during Excel import. */
  synonyms: string[];
  editable?: boolean;
};

export const FIELDS: FieldDef[] = [
  { key: "employeeCode", label: "Employee ID", type: "text", synonyms: ["employee id", "employee code", "emp id", "id", "personnel number", "staff id", "employee number", "emp no"] },
  { key: "fullName", label: "Full name", type: "text", synonyms: ["full name", "name", "employee name", "employee", "name surname", "name and surname"] },
  { key: "firstName", label: "First name", type: "text", synonyms: ["first name", "firstname", "given name", "name first"] },
  { key: "lastName", label: "Last name", type: "text", synonyms: ["last name", "lastname", "surname", "family name"] },
  { key: "email", label: "Email", type: "text", synonyms: ["email", "e mail", "work email", "email address", "company email", "corporate email"] },
  { key: "gender", label: "Gender", type: "text", synonyms: ["gender", "sex"] },
  { key: "status", label: "Status", type: "status", synonyms: ["status", "employee status", "employment status", "active status", "state"] },
  { key: "employmentType", label: "Employment type", type: "text", synonyms: ["employment type", "contract type", "type of contract", "contract", "type"] },
  { key: "rotation", label: "Rotation", type: "text", synonyms: ["rotation", "rotation type", "rotation status", "rotations"] },
  { key: "rotationDate", label: "Rotation date", type: "date", synonyms: ["rotation date", "date of rotation", "rotation start"] },
  { key: "businessUnit", label: "Business unit", type: "text", synonyms: ["business unit", "bu", "unit", "division", "business line"] },
  { key: "department", label: "Department", type: "text", synonyms: ["department", "dept", "team", "function"] },
  { key: "jobTitle", label: "Job title", type: "text", synonyms: ["job title", "position", "title", "role", "job position"] },
  { key: "manager", label: "Manager", type: "text", synonyms: ["manager", "line manager", "direct manager", "reports to", "supervisor"] },
  { key: "location", label: "Location", type: "text", synonyms: ["location", "office", "city", "work location", "site"] },
  { key: "country", label: "Country", type: "text", synonyms: ["country", "country of employment", "work country"] },
  { key: "legalEntity", label: "Legal entity", type: "text", synonyms: ["legal entity", "entity", "company", "employer", "contracting entity"] },
  { key: "preferredFullName", label: "Preferred full name", type: "text", synonyms: ["preferred full name", "preferred name", "display name", "nickname"] },
  { key: "team", label: "Team", type: "text", synonyms: ["leapsome team"] },
  { key: "careerTrack", label: "Career track", type: "careerTrack", synonyms: ["career track", "employee type (track)", "track"] },
  { key: "contractInTimebase", label: "Contract in Timebase", type: "boolean", synonyms: ["contract in tb", "contract in timebase", "contract signed"] },
  { key: "ndaSigned", label: "NDA signed", type: "boolean", synonyms: ["nda status", "nda signed", "nda"] },
  { key: "gdprConsent", label: "GDPR consent", type: "boolean", synonyms: ["gdpr status", "gdpr consent", "gdpr"] },
  { key: "cvOnFile", label: "CV on file", type: "boolean", synonyms: ["cv in tb", "cv on file", "cv uploaded"] },
  { key: "welcomeKitSent", label: "Welcome kit sent", type: "boolean", synonyms: ["welcome kit", "welcome kit sent"] },
  { key: "welcomeTrainingDone", label: "Welcome training done", type: "boolean", synonyms: ["welcome training", "welcome training done", "induction training", "onboarding training"] },
  { key: "elearningCompleted", label: "E-learning completed", type: "boolean", synonyms: ["e-learning", "elearning", "e-learning completed", "online training completed", "lms completed"] },
  { key: "twoWeekCheckinDone", label: "2-week check-in done", type: "boolean", synonyms: ["2 week check in", "two week check in", "2-week checkin", "14 day check in"] },
  { key: "hrbpNotified", label: "HRBP notified", type: "boolean", synonyms: ["hrbp notified", "hrbp notification", "hr business partner notified"] },
  { key: "startDate", label: "Start date", type: "date", synonyms: ["start date", "hire date", "joining date", "date of joining", "onboarding date", "first working day", "employment start", "start"] },
  { key: "endDate", label: "End date", type: "date", synonyms: ["end date", "termination date", "leaving date", "last working day", "offboarding date", "exit date", "date of leaving"] },
  { key: "probationEndDate", label: "Probation end", type: "date", synonyms: ["probation end", "probation end date", "end of probation", "probation"] },
  { key: "offboardingReason", label: "Offboarding reason (detail)", type: "text", synonyms: ["offboarding reason", "termination reason", "reason for leaving", "leaving reason", "exit reason"] },
  { key: "offboardingReasonCategory", label: "Offboarding reason category", type: "offboardingReasonCategory", synonyms: ["offboarding reason category", "offboarding category", "leaving category", "exit category", "termination category"] },
  { key: "leapsomeId", label: "Leapsome ID", type: "text", synonyms: ["leapsome id"] },
  { key: "timebaseId", label: "Timebase ID", type: "text", synonyms: ["timebase id"] },
  { key: "jiraKey", label: "Jira ticket", type: "text", synonyms: ["jira", "jira key", "jira ticket", "ticket"] },
  { key: "countryCode", label: "Country code", type: "text", synonyms: ["country code", "iso country"] },
];

export const FIELD_MAP = Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<EmployeeField, FieldDef>;

export const CAREER_TRACKS = [
  "partner_track",
  "partner_ap",
  "specialist",
  "junior",
  "guest",
  "field",
  "flexible_specialist",
  "senior_affiliated_staff",
  "expert_partner",
  "external_pp",
] as const;
export type CareerTrack = (typeof CAREER_TRACKS)[number];

export const CAREER_TRACK_LABEL: Record<CareerTrack, string> = {
  partner_track: "Partner track",
  partner_ap: "Partner / AP",
  specialist: "Specialist",
  junior: "Junior",
  guest: "Guest",
  field: "Field",
  flexible_specialist: "Flexible Specialist",
  senior_affiliated_staff: "Senior Affiliated Staff",
  expert_partner: "Expert Partner",
  external_pp: "External PP",
};

export const OFFBOARDING_REASONS = [
  "resignation",
  "dismissal_performance",
  "dismissal_conduct",
  "redundancy",
  "end_of_fixed_term_contract",
  "mutual_agreement",
  "retirement",
  "death",
  "other",
] as const;
export type OffboardingReason = (typeof OFFBOARDING_REASONS)[number];

export const OFFBOARDING_REASON_LABEL: Record<OffboardingReason, string> = {
  resignation: "Resignation",
  dismissal_performance: "Dismissal — performance",
  dismissal_conduct: "Dismissal — conduct",
  redundancy: "Redundancy",
  end_of_fixed_term_contract: "End of fixed-term contract",
  mutual_agreement: "Mutual agreement",
  retirement: "Retirement",
  death: "Death",
  other: "Other",
};

export const STATUSES = [
  "pre_onboarding",
  "onboarding",
  "active",
  "on_leave",
  "offboarding",
  "offboarded",
  "inactive",
] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  pre_onboarding: "Pre-onboarding",
  onboarding: "Onboarding",
  active: "Active",
  on_leave: "On leave",
  offboarding: "Offboarding",
  offboarded: "Offboarded",
  inactive: "Inactive",
};

/** Default columns for exports and the employee table. */
export const DEFAULT_COLUMNS: EmployeeField[] = [
  "employeeCode",
  "fullName",
  "email",
  "gender",
  "status",
  "businessUnit",
  "department",
  "jobTitle",
  "manager",
  "location",
  "country",
  "rotation",
  "employmentType",
  "startDate",
  "probationEndDate",
  "endDate",
];

/**
 * Field ownership: which source may overwrite which fields during sync.
 * - "overwrite": the source is authoritative for the field.
 * - otherwise the source may only fill the field when it is empty.
 * Excel imports and manual edits are always authoritative; manual edits also lock the field.
 */
export const SOURCE_OWNERSHIP: Record<"leapsome" | "timebase" | "jira", EmployeeField[]> = {
  leapsome: [
    "firstName", "lastName", "fullName", "email", "gender", "jobTitle", "department",
    "businessUnit", "manager", "legalEntity", "employmentType", "leapsomeId", "status",
    "preferredFullName", "team",
  ],
  timebase: ["location", "country", "countryCode", "rotation", "rotationDate", "timebaseId"],
  jira: ["jiraKey"],
};
