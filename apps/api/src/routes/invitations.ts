import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@kleidi/db";
import { acceptInvitation, previewInvitation, ROLES } from "@kleidi/modules/firms";
import type { Context } from "../plugins/context.ts";

const Token = z.object({ token: z.string().min(20).max(200) });

export const invitationRoutes: FastifyPluginAsyncZod<{ db: Db; ctx: Context }> = async (
  app,
  { db, ctx },
) => {
  // Public: shows the invitee which firm invited them before they sign up or sign in.
  app.get(
    "/invitations/:token",
    {
      schema: {
        params: Token,
        response: {
          200: z.object({
            firmName: z.string(),
            email: z.string(),
            role: z.enum(ROLES),
            state: z.enum(["pending", "accepted", "expired"]),
          }),
        },
      },
    },
    async (request) => previewInvitation(db, request.params.token),
  );

  app.post(
    "/invitations/:token/accept",
    {
      schema: {
        params: Token,
        response: { 200: z.object({ firmId: z.string(), role: z.enum(ROLES) }) },
      },
    },
    async (request) => {
      const user = await ctx.requireUser(request);
      return acceptInvitation(db, { token: request.params.token, actor: user });
    },
  );
};
