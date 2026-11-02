CREATE TYPE "public"."probation_decision" AS ENUM('pending', 'confirmed', 'extended', 'terminated');--> statement-breakpoint
CREATE TABLE "probation_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" integer NOT NULL,
	"reviewer_name" text NOT NULL,
	"reviewer_role" text,
	"skill_score" integer,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "probation_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"due_date" date,
	"decision" "probation_decision" DEFAULT 'pending' NOT NULL,
	"decision_date" date,
	"decided_by" text,
	"extended_to_date" date,
	"committee_notes" text,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "probation_feedback" ADD CONSTRAINT "probation_feedback_review_id_probation_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."probation_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probation_reviews" ADD CONSTRAINT "probation_reviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "probation_feedback_review_idx" ON "probation_feedback" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "probation_reviews_employee_idx" ON "probation_reviews" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "probation_reviews_due_idx" ON "probation_reviews" USING btree ("due_date");