CREATE TYPE "public"."request_stage" AS ENUM('new', 'pre_onboarding', 'collecting', 'needs_info', 'ready_for_review', 'approved', 'first_day', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_jira_issues" (
	"key" text PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"reporter" text,
	"comments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"template_id" integer,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" text
);
--> statement-breakpoint
CREATE TABLE "request_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"type" text NOT NULL,
	"from_stage" "request_stage",
	"to_stage" "request_stage",
	"message" text,
	"actor" text DEFAULT 'system' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD COLUMN "stage" "request_stage" DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD COLUMN "stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD COLUMN "corrections" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD COLUMN "collection_date" date;--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD COLUMN "collection_date_overridden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD COLUMN "pending_changes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD COLUMN "jira_error" text;--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD COLUMN "last_comment_key" text;--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD COLUMN "contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD COLUMN "first_day_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding_requests" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "request_checklist_items" ADD CONSTRAINT "request_checklist_items_request_id_onboarding_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."onboarding_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_checklist_items" ADD CONSTRAINT "request_checklist_items_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_request_id_onboarding_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."onboarding_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_request_idx" ON "request_checklist_items" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_request_template_uq" ON "request_checklist_items" USING btree ("request_id","template_id");--> statement-breakpoint
CREATE INDEX "request_events_request_idx" ON "request_events" USING btree ("request_id","at");--> statement-breakpoint
CREATE INDEX "onb_stage_idx" ON "onboarding_requests" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "onb_collection_idx" ON "onboarding_requests" USING btree ("collection_date");--> statement-breakpoint
-- Default first-day checklist (all ticked by hand for now)
INSERT INTO "checklist_templates" ("label", "sort_order", "source") VALUES
  ('Contract in Timebase', 1, 'manual'),
  ('Accounts opened', 2, 'manual'),
  ('Introduction profile shared', 3, 'manual');--> statement-breakpoint
-- Existing requests that were already turned into employees count as approved; the rest start as new
UPDATE "onboarding_requests" SET "stage" = 'approved', "approved_at" = "updated_at" WHERE "employee_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "request_checklist_items" ("request_id", "template_id", "label", "sort_order")
  SELECT r."id", t."id", t."label", t."sort_order" FROM "onboarding_requests" r CROSS JOIN "checklist_templates" t WHERE r."stage" = 'approved';
