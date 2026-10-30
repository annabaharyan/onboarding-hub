CREATE TYPE "public"."data_source" AS ENUM('excel', 'manual', 'leapsome', 'timebase', 'jira', 'claude', 'system');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('pre_onboarding', 'onboarding', 'active', 'on_leave', 'offboarding', 'offboarded', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'success', 'partial', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."validation_status" AS ENUM('unchecked', 'valid', 'missing_info', 'error');--> statement-breakpoint
CREATE TABLE "employee_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"source" "data_source" NOT NULL,
	"sync_run_id" integer,
	"import_batch_id" integer,
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_code" text,
	"email" text,
	"first_name" text,
	"last_name" text,
	"full_name" text NOT NULL,
	"gender" text,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"employment_type" text,
	"rotation" text,
	"rotation_date" date,
	"business_unit" text,
	"department" text,
	"job_title" text,
	"manager" text,
	"location" text,
	"country" text,
	"country_code" text,
	"legal_entity" text,
	"start_date" date,
	"end_date" date,
	"probation_end_date" date,
	"offboarding_reason" text,
	"leapsome_id" text,
	"timebase_id" text,
	"jira_key" text,
	"sources" text[] DEFAULT '{}' NOT NULL,
	"locked_fields" text[] DEFAULT '{}' NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"sheet_name" text,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"snapshots" integer DEFAULT 0 NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"month" date NOT NULL,
	"value" text,
	"status" text,
	"business_unit" text,
	"source" "data_source" DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"jira_key" text NOT NULL,
	"summary" text,
	"jira_status" text,
	"reporter" text,
	"full_name" text,
	"email" text,
	"start_date" date,
	"business_unit" text,
	"job_title" text,
	"location" text,
	"manager" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation_status" "validation_status" DEFAULT 'unchecked' NOT NULL,
	"missing_fields" text[] DEFAULT '{}' NOT NULL,
	"validation_notes" text,
	"commented_at" timestamp with time zone,
	"employee_id" integer,
	"jira_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"country_code" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"local_name" text,
	"global" boolean DEFAULT true NOT NULL,
	"pushed_to_timebase_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" "data_source" NOT NULL,
	"trigger" text NOT NULL,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "employee_changes" ADD CONSTRAINT "employee_changes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_snapshots" ADD CONSTRAINT "monthly_snapshots_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD CONSTRAINT "onboarding_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changes_emp_idx" ON "employee_changes" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "changes_at_idx" ON "employee_changes" USING btree ("changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_email_uq" ON "employees" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_code_uq" ON "employees" USING btree ("employee_code");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_leapsome_uq" ON "employees" USING btree ("leapsome_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_timebase_uq" ON "employees" USING btree ("timebase_id");--> statement-breakpoint
CREATE INDEX "employees_status_idx" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "employees_bu_idx" ON "employees" USING btree ("business_unit");--> statement-breakpoint
CREATE INDEX "employees_start_idx" ON "employees" USING btree ("start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "snap_emp_month_uq" ON "monthly_snapshots" USING btree ("employee_id","month");--> statement-breakpoint
CREATE INDEX "snap_month_idx" ON "monthly_snapshots" USING btree ("month");--> statement-breakpoint
CREATE UNIQUE INDEX "onb_jira_uq" ON "onboarding_requests" USING btree ("jira_key");--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_uq" ON "public_holidays" USING btree ("country_code","date","name");--> statement-breakpoint
CREATE INDEX "sync_source_idx" ON "sync_runs" USING btree ("source","started_at");