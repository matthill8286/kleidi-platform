-- Recreated rather than extended: a new enum value cannot be used in the transaction that adds it.
ALTER TABLE "documents" DROP COLUMN "scan_status";--> statement-breakpoint
DROP TYPE "public"."scan_status";--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('uploading', 'pending', 'clean', 'infected', 'failed');--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"object_key" text NOT NULL,
	"scan_status" "scan_status" DEFAULT 'uploading' NOT NULL,
	"scan_detail" text,
	"scanned_at" timestamp with time zone,
	"uploaded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_uploaded_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "visibility" SET DEFAULT 'firm';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "expiry_flag" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "latest_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_doc_version" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_case_requirement" ON "documents" USING btree ("case_id","requirement_key");--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "object_key";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "mime_type";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "byte_size";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "version";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "uploaded_by_id";