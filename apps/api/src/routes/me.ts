import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@kleidi/db";
import { AppError } from "@kleidi/kernel";
import { listMyFirms, ROLES } from "@kleidi/modules/firms";
import { findUsersByIds, LOCALES, updateProfile } from "@kleidi/modules/identity";
import type { Context } from "../plugins/context.ts";

const Me = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    locale: z.string(),
    phone: z.string().nullable(),
    smsReminders: z.boolean(),
    twoFactorEnabled: z.boolean(),
  }),
  firms: z.array(
    z.object({ id: z.string(), name: z.string(), slug: z.string(), role: z.enum(ROLES) }),
  ),
});

export const meRoutes: FastifyPluginAsyncZod<{ db: Db; ctx: Context }> = async (
  app,
  { db, ctx },
) => {
  // Allowed before two-factor setup, so the web app knows where to send the user next.
  app.get("/me", { schema: { response: { 200: Me } } }, async (request) => {
    const user = await ctx.currentUser(request);
    if (!user) throw new AppError("unauthenticated", "Sign in to continue", "signIn");
    // The session cookie may cache an old profile, so read it fresh.
    const [profile] = await findUsersByIds(db, [user.userId]);
    return {
      user: {
        id: user.userId,
        name: user.name,
        email: user.email,
        locale: profile?.locale ?? user.locale,
        phone: profile?.phone ?? null,
        smsReminders: profile?.smsReminders ?? false,
        twoFactorEnabled: user.twoFactorEnabled,
      },
      firms: await listMyFirms(db, user.userId),
    };
  });

  // Language can change before two-factor setup; emails follow the saved language.
  app.patch(
    "/me",
    {
      schema: {
        body: z.object({
          locale: z.enum(LOCALES).optional(),
          phone: z.string().max(40).nullable().optional(),
          smsReminders: z.boolean().optional(),
        }),
      },
    },
    async (request, reply) => {
      const user = await ctx.requireUser(request, { allowWithoutTwoFactor: true });
      await updateProfile(db, user.userId, request.body);
      return reply.code(204).send();
    },
  );
};
