ALTER TYPE "public"."data_source" ADD VALUE 'google_forms';--> statement-breakpoint
CREATE TABLE "climate_survey_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"sheet_row" integer NOT NULL,
	"submitted_at" timestamp with time zone,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "climate_survey_row_uq" ON "climate_survey_responses" USING btree ("sheet_row");