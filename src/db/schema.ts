import {
  pgTable,
  serial,
  text,
  date,
  timestamp,
  jsonb,
  integer,
  boolean,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

export const employeeStatus = pgEnum("employee_status", [
  "pre_onboarding",
  "onboarding",
  "active",
  "on_leave",
  "offboarding",
  "offboarded",
  "inactive",
]);

export const dataSource = pgEnum("data_source", [
  "excel",
  "manual",
  "leapsome",
  "timebase",
  "jira",
  "claude",
  "system",
]);

export const syncStatus = pgEnum("sync_status", [
  "running",
  "success",
  "partial",
  "failed",
  "skipped",
]);

export const validationStatus = pgEnum("validation_status", [
  "unchecked",
  "valid",
  "missing_info",
  "error",
]);

export const employees = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),
    employeeCode: text("employee_code"),
    email: text("email"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    fullName: text("full_name").notNull(),
    gender: text("gender"),
    status: employeeStatus("status").notNull().default("active"),
    employmentType: text("employment_type"),
    rotation: text("rotation"),
    rotationDate: date("rotation_date"),
    businessUnit: text("business_unit"),
    department: text("department"),
    jobTitle: text("job_title"),
    manager: text("manager"),
    location: text("location"),
    country: text("country"),
    countryCode: text("country_code"),
    legalEntity: text("legal_entity"),
    preferredFullName: text("preferred_full_name"),
    team: text("team"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    probationEndDate: date("probation_end_date"),
    offboardingReason: text("offboarding_reason"),
    leapsomeId: text("leapsome_id"),
    timebaseId: text("timebase_id"),
    jiraKey: text("jira_key"),
    sources: text("sources").array().notNull().default([]),
    /** Fields edited by hand in the app — integrations will not overwrite them. */
    lockedFields: text("locked_fields").array().notNull().default([]),
    /** Columns from the Excel file that don't map to a known field. Never dropped. */
    extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("employees_email_uq").on(t.email),
    uniqueIndex("employees_code_uq").on(t.employeeCode),
    uniqueIndex("employees_leapsome_uq").on(t.leapsomeId),
    uniqueIndex("employees_timebase_uq").on(t.timebaseId),
    index("employees_status_idx").on(t.status),
    index("employees_bu_idx").on(t.businessUnit),
    index("employees_start_idx").on(t.startDate),
  ],
);

/** Month-end headcount snapshot (the "technical" monthly columns of the headcount file). */
export const monthlySnapshots = pgTable(
  "monthly_snapshots",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    month: date("month").notNull(), // last day of month
    value: text("value"), // raw value from file, e.g. "1", "Active", "FTE 0.5"
    status: text("status"),
    businessUnit: text("business_unit"),
    source: dataSource("source").notNull().default("system"),
  },
  (t) => [uniqueIndex("snap_emp_month_uq").on(t.employeeId, t.month), index("snap_month_idx").on(t.month)],
);

/** Field-level audit trail. */
export const employeeChanges = pgTable(
  "employee_changes",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    source: dataSource("source").notNull(),
    syncRunId: integer("sync_run_id"),
    importBatchId: integer("import_batch_id"),
    changedBy: text("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("changes_emp_idx").on(t.employeeId), index("changes_at_idx").on(t.changedAt)],
);

export const onboardingRequests = pgTable(
  "onboarding_requests",
  {
    id: serial("id").primaryKey(),
    jiraKey: text("jira_key").notNull(),
    summary: text("summary"),
    jiraStatus: text("jira_status"),
    reporter: text("reporter"),
    fullName: text("full_name"),
    email: text("email"),
    startDate: date("start_date"),
    businessUnit: text("business_unit"),
    jobTitle: text("job_title"),
    location: text("location"),
    manager: text("manager"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    validationStatus: validationStatus("validation_status").notNull().default("unchecked"),
    missingFields: text("missing_fields").array().notNull().default([]),
    validationNotes: text("validation_notes"),
    commentedAt: timestamp("commented_at", { withTimezone: true }),
    employeeId: integer("employee_id").references(() => employees.id, { onDelete: "set null" }),
    jiraCreatedAt: timestamp("jira_created_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("onb_jira_uq").on(t.jiraKey)],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: serial("id").primaryKey(),
    source: dataSource("source").notNull(),
    trigger: text("trigger").notNull(), // cron | manual | import
    status: syncStatus("status").notNull().default("running"),
    fetched: integer("fetched").notNull().default(0),
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    unchanged: integer("unchanged").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
    message: text("message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("sync_source_idx").on(t.source, t.startedAt)],
);

export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  sheetName: text("sheet_name"),
  totalRows: integer("total_rows").notNull().default(0),
  created: integer("created").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  unchanged: integer("unchanged").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  snapshots: integer("snapshots").notNull().default(0),
  mapping: jsonb("mapping").$type<Record<string, string>>().notNull().default({}),
  issues: jsonb("issues").$type<ImportIssue[]>().notNull().default([]),
  dryRun: boolean("dry_run").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ImportIssue = { row: number; level: "error" | "warning"; message: string };
export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type OnboardingRequest = typeof onboardingRequests.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
