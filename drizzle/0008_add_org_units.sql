CREATE TABLE "org_units" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster" text,
	"business_unit" text NOT NULL,
	"hrbp" text,
	"head_of_business_ops" text,
	"business_controller" text,
	"staffing_partner" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_bu_uq" ON "org_units" USING btree ("business_unit");