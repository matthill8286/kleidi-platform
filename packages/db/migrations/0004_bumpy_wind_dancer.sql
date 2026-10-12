ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sms_reminders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "completed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "created_by_id" uuid;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "deadlines" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "provider_id" text;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deadlines_case" ON "deadlines" USING btree ("case_id");