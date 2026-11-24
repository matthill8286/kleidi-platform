CREATE TABLE "lease_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"buyer" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"report" text NOT NULL,
	"buyer_summary" text NOT NULL,
	"translations" jsonb,
	"model" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_id" uuid,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lease_reviews" ADD CONSTRAINT "lease_reviews_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_reviews" ADD CONSTRAINT "lease_reviews_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_reviews" ADD CONSTRAINT "lease_reviews_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_reviews" ADD CONSTRAINT "lease_reviews_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_reviews" ADD CONSTRAINT "lease_reviews_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_reviews" ADD CONSTRAINT "lease_reviews_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lease_reviews_case" ON "lease_reviews" USING btree ("case_id");