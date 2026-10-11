// Prints the current authenticator code for DEV_LOGIN_EMAIL, for local browser testing only.
import { symmetricDecrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@kleidi/db";
import { totp } from "../test/helpers.ts";

process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
const { db, close } = createDb(process.env.DATABASE_ADMIN_URL!, { max: 1 });
const [row] = await db
  .select({ secret: schema.twoFactors.secret })
  .from(schema.twoFactors)
  .innerJoin(schema.users, eq(schema.users.id, schema.twoFactors.userId))
  .where(eq(schema.users.email, process.env.DEV_LOGIN_EMAIL!));
await close();
if (!row) throw new Error("No authenticator set up for DEV_LOGIN_EMAIL");
const secret = await symmetricDecrypt({ key: process.env.BETTER_AUTH_SECRET!, data: row.secret });
// The stored secret is raw; authenticator apps see its base32 form.
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const bits = [...Buffer.from(secret)].map((b) => b.toString(2).padStart(8, "0")).join("");
const base32 = (bits.match(/.{1,5}/g) ?? [])
  .map((c) => alphabet[parseInt(c.padEnd(5, "0"), 2)])
  .join("");
console.log(totp(base32));
