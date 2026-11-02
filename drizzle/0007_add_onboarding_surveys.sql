CREATE TABLE "onboarding_surveys" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"survey_type" text DEFAULT 'six_month' NOT NULL,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"onboarding_experience_score" integer,
	"manager_support_score" integer,
	"overall_satisfaction_score" integer,
	"likes" text[] DEFAULT '{}' NOT NULL,
	"improvements" text[] DEFAULT '{}' NOT NULL,
	"comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_surveys" ADD CONSTRAINT "onboarding_surveys_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "survey_emp_type_uq" ON "onboarding_surveys" USING btree ("employee_id","survey_type");