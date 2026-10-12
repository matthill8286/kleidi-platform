-- The firm's own files no longer wait for review; only client uploads do.
UPDATE "document_versions" SET "review" = 'accepted' WHERE "uploaded_by_party_id" IS NULL AND "review" = 'pending';
