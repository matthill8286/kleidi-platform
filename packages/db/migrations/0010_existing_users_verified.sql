-- Accounts created before email verification was required count as verified.
UPDATE "users" SET "email_verified" = true WHERE "email_verified" = false;
