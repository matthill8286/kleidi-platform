CREATE TABLE "portal_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"invited_by_id" uuid NOT NULL,
	"privacy_version" text,
	"privacy_accepted_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"access_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"codes_sent" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"access_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "document_versions" ALTER COLUMN "uploaded_by_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "uploaded_by_party_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "requested_from_client" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_access" ADD CONSTRAINT "portal_access_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_access" ADD CONSTRAINT "portal_access_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_access" ADD CONSTRAINT "portal_access_party_id_case_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."case_parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_access" ADD CONSTRAINT "portal_access_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_access_id_portal_access_id_fk" FOREIGN KEY ("access_id") REFERENCES "public"."portal_access"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_access_id_portal_access_id_fk" FOREIGN KEY ("access_id") REFERENCES "public"."portal_access"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_access_party" ON "portal_access" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "portal_access_email" ON "portal_access" USING btree ("email");--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_party_id_case_parties_id_fk" FOREIGN KEY ("uploaded_by_party_id") REFERENCES "public"."case_parties"("id") ON DELETE no action ON UPDATE no action;