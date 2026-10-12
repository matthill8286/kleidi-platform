import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@kleidi/db";
import { AppError } from "@kleidi/kernel";
import { createFirm, inviteMember, listTeam, removeMember, ROLES } from "@kleidi/modules/firms";
import type { Context } from "../plugins/context.ts";

const Firm = z.object({ id: z.string(), name: z.string(), slug: z.string() });
const Invitation = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  expiresAt: z.date(),
});
const Team = z.object({
  members: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.enum(ROLES),
      joinedAt: z.date(),
    }),
  ),
  invitations: z.array(Invitation),
});

export const firmRoutes: FastifyPluginAsyncZod<{
  db: Db;
  ctx: Context;
  // When set, only these addresses may create a firm: pilot firms are onboarded, not self-serve.
  firmCreators?: string[] | undefined;
}> = async (app, { db, ctx, firmCreators }) => {
  app.post(
    "/firms",
    { schema: { body: z.object({ name: z.string().min(2).max(120) }), response: { 201: Firm } } },
    async (request, reply) => {
      const user = await ctx.requireUser(request);
      if (firmCreators && !firmCreators.includes(user.email.toLowerCase())) {
        throw new AppError(
          "forbidden",
          "Kleidi is open to invited firms only",
          "firmCreationClosed",
        );
      }
      const firm = await createFirm(db, { name: request.body.name, actor: user });
      return reply.code(201).send({ id: firm.id, name: firm.name, slug: firm.slug });
    },
  );

  app.get("/team", { schema: { response: { 200: Team } } }, async (request) => {
    const { firm } = await ctx.requireFirm(request);
    return listTeam(db, firm.firmId);
  });

  app.post(
    "/team/invitations",
    {
      schema: {
        body: z.object({ email: z.email(), role: z.enum(ROLES) }),
        response: { 201: Invitation },
      },
    },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      const invitation = await inviteMember(db, {
        firm,
        actor: user,
        email: request.body.email,
        role: request.body.role,
      });
      return reply.code(201).send(invitation);
    },
  );

  app.delete(
    "/team/members/:userId",
    { schema: { params: z.object({ userId: z.uuid() }) } },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      await removeMember(db, { firm, actor: user, userId: request.params.userId });
      return reply.code(204).send();
    },
  );
};
