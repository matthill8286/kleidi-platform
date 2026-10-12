CREATE TYPE "public"."review_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "review" "review_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "reviewed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;