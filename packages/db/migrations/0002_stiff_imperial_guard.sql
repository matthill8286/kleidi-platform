DROP INDEX "outbox_unpublished";--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "event_position" bigint;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "position" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_unpublished" ON "outbox" USING btree ("position") WHERE published_at is null;