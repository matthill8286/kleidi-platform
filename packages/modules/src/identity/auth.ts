import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import type { Db } from "@kleidi/db";
import { accounts, sessions, twoFactors, users, verifications } from "@kleidi/db/schema/identity";

export type AuthOptions = {
  db: Db;
  /** Public origin of the web app; the auth routes live under /api/auth on it. */
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
};

export function createAuth(options: AuthOptions) {
  return betterAuth({
    appName: "Kleidi",
    baseURL: options.baseURL,
    basePath: "/api/auth",
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(options.db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        twoFactor: twoFactors,
      },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 12, autoSignIn: true },
    user: {
      additionalFields: {
        locale: { type: "string", required: false, defaultValue: "en", input: true },
      },
    },
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },
    plugins: [twoFactor({ issuer: "Kleidi" })],
    advanced: { database: { generateId: "uuid" } },
  });
}

export type Auth = ReturnType<typeof createAuth>;
