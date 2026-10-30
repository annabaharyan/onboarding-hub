import type { Employee } from "@/db/schema";

export type EmployeeField = Exclude<
  keyof Employee,
  "id" | "sources" | "lockedFields" | "extra" | "createdAt" | "updatedAt" | "lastSyncedAt"
>;

export type FieldDef = {
  key: EmployeeField;
  label: string;
  type: "text" | "date" | "status";
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
  { key: "startDate", label: "Start date", type: "date", synonyms: ["start date", "hire date", "joining date", "date of joining", "onboarding date", "first working day", "employment start", "start"] },
  { key: "endDate", label: "End date", type: "date", synonyms: ["end date", "termination date", "leaving date", "last working day", "offboarding date", "exit date", "date of leaving"] },
  { key: "probationEndDate", label: "Probation end", type: "date", synonyms: ["probation end", "probation end date", "end of probation", "probation"] },
  { key: "offboardingReason", label: "Offboarding reason", type: "text", synonyms: ["offboarding reason", "termination reason", "reason for leaving", "leaving reason", "exit reason"] },
  { key: "leapsomeId", label: "Leapsome ID", type: "text", synonyms: ["leapsome id"] },
  { key: "timebaseId", label: "Timebase ID", type: "text", synonyms: ["timebase id"] },
  { key: "jiraKey", label: "Jira ticket", type: "text", synonyms: ["jira", "jira key", "jira ticket", "ticket"] },
  { key: "countryCode", label: "Country code", type: "text", synonyms: ["country code", "iso country"] },
];

export const FIELD_MAP = Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<EmployeeField, FieldDef>;

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
