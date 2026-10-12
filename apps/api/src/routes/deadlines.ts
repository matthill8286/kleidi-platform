import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@kleidi/db";
import {
  addDeadline,
  changeDeadline,
  listDeadlines,
  REMINDER_CHOICES,
  removeDeadline,
  setDeadlineDone,
} from "@kleidi/modules/deadlines";
import type { Context } from "../plugins/context.ts";
import type { Idempotent } from "../plugins/idempotency.ts";

const Deadline = z.object({
  id: z.string(),
  caseId: z.string(),
  caseReference: z.string(),
  propertyAddress: z.string().nullable(),
  title: z.string(),
  notes: z.string().nullable(),
  dueAt: z.date(),
  owner: z.object({ id: z.string(), name: z.string() }).nullable(),
  remindBeforeHours: z.array(z.number()),
  completedAt: z.date().nullable(),
  urgency: z.enum(["done", "overdue", "today", "week", "later"]),
});

const Reminders = z.array(z.union(REMINDER_CHOICES.map((h) => z.literal(h)))).max(4);
const Id = z.object({ id: z.uuid() });

export const deadlineRoutes: FastifyPluginAsyncZod<{
  db: Db;
  ctx: Context;
  idempotent: Idempotent;
}> = async (app, { db, ctx, idempotent }) => {
  app.get(
    "/deadlines",
    {
      schema: {
        querystring: z.object({
          caseId: z.uuid().optional(),
          mine: z.stringbool().optional(),
          includeDone: z.stringbool().optional(),
        }),
        response: { 200: z.array(Deadline) },
      },
    },
    async (request) => {
      const { user, firm } = await ctx.requireFirm(request);
      return listDeadlines(db, firm.firmId, {
        caseId: request.query.caseId,
        ownerId: request.query.mine ? user.userId : undefined,
        includeDone: request.query.includeDone,
      });
    },
  );

  app.post(
    "/cases/:id/deadlines",
    {
      schema: {
        params: Id,
        body: z.object({
          title: z.string().trim().min(2).max(160),
          dueAt: z.coerce.date(),
          ownerId: z.uuid().optional(),
          remindBeforeHours: Reminders.optional(),
          notes: z.string().max(1000).optional(),
        }),
        response: { 201: z.object({ id: z.string() }) },
      },
    },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      return idempotent(request, reply, user.userId, async () => {
        const row = await addDeadline(db, {
          firm,
          actor: user,
          caseId: request.params.id,
          ...request.body,
        });
        return { status: 201, body: { id: row.id } };
      });
    },
  );

  app.patch(
    "/deadlines/:id",
    {
      schema: {
        params: Id,
        body: z.object({
          title: z.string().trim().min(2).max(160).optional(),
          dueAt: z.coerce.date().optional(),
          ownerId: z.uuid().optional(),
          remindBeforeHours: Reminders.optional(),
          notes: z.string().max(1000).nullable().optional(),
          done: z.boolean().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      const { done, ...changes } = request.body;
      if (Object.values(changes).some((v) => v !== undefined)) {
        await changeDeadline(db, { firm, actor: user, deadlineId: request.params.id, ...changes });
      }
      if (done !== undefined) {
        await setDeadlineDone(db, { firm, actor: user, deadlineId: request.params.id, done });
      }
      return reply.code(204).send();
    },
  );

  app.delete("/deadlines/:id", { schema: { params: Id } }, async (request, reply) => {
    const { user, firm } = await ctx.requireFirm(request);
    await removeDeadline(db, { firm, actor: user, deadlineId: request.params.id });
    return reply.code(204).send();
  });
};
