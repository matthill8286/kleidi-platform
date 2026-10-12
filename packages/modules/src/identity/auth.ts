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
  /** Sends the link that proves a new user owns their email address. */
  sendVerificationEmail: (message: {
    to: string;
    name: string;
    locale: string;
    url: string;
  }) => Promise<void>;
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
    // Nobody signs in until they prove they own the address, so an invitation link alone
    // cannot be used to register someone else's email and take their seat.
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      autoSignIn: true,
      requireEmailVerification: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        options.sendVerificationEmail({
          to: user.email,
          name: user.name,
          locale: (user as { locale?: string }).locale ?? "en",
          url,
        }),
    },
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
