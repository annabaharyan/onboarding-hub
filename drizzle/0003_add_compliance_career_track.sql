CREATE TYPE "public"."career_track" AS ENUM('partner_track', 'partner_ap', 'specialist', 'junior', 'guest', 'field', 'flexible_specialist', 'senior_affiliated_staff', 'expert_partner', 'external_pp');--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "career_track" "career_track";--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "contract_in_timebase" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "nda_signed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "gdpr_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "cv_on_file" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "welcome_kit_sent" boolean DEFAULT false NOT NULL;