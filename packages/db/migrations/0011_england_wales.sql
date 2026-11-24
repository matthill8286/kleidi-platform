CREATE TYPE "public"."tenure" AS ENUM('freehold', 'leasehold', 'commonhold');--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD COLUMN "timezone" text DEFAULT 'Asia/Nicosia' NOT NULL;--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD COLUMN "phone_example" text DEFAULT '+357 99 123456' NOT NULL;--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD COLUMN "asks_tenure" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "tenure" "tenure";