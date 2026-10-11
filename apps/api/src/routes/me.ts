import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@kleidi/db";
import { AppError } from "@kleidi/kernel";
import { listMyFirms, ROLES } from "@kleidi/modules/firms";
import type { Context } from "../plugins/context.ts";

const Me = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    locale: z.string(),
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
    if (!user) throw new AppError("unauthenticated", "Sign in to continue");
    return {
      user: {
        id: user.userId,
        name: user.name,
        email: user.email,
        locale: user.locale,
        twoFactorEnabled: user.twoFactorEnabled,
      },
      firms: await listMyFirms(db, user.userId),
    };
  });
};
