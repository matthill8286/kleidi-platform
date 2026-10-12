ALTER TABLE "case_parties" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "case_parties" ADD COLUMN "removed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "case_parties" ADD CONSTRAINT "case_parties_removed_by_id_users_id_fk" FOREIGN KEY ("removed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;