import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@kleidi/db";
import { listMessages, MAX_MESSAGE_LENGTH, postFirmMessage } from "@kleidi/modules/messages";
import type { Context } from "../plugins/context.ts";

export const Message = z.object({
  id: z.string(),
  body: z.string(),
  author: z.object({ kind: z.enum(["firm", "client"]), name: z.string() }),
  createdAt: z.date(),
});
export const MessageBody = z.object({ body: z.string().max(MAX_MESSAGE_LENGTH + 100) });

// The case thread between the firm and its clients.
export const messageRoutes: FastifyPluginAsyncZod<{ db: Db; ctx: Context }> = async (
  app,
  { db, ctx },
) => {
  const CaseId = z.object({ id: z.uuid() });
  app.get(
    "/cases/:id/messages",
    { schema: { params: CaseId, response: { 200: z.array(Message) } } },
    async (request) => {
      const { firm } = await ctx.requireFirm(request);
      return listMessages(db, firm.firmId, request.params.id);
    },
  );
  app.post(
    "/cases/:id/messages",
    { schema: { params: CaseId, body: MessageBody, response: { 201: Message } } },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      const sent = await postFirmMessage(db, {
        firm,
        actor: user,
        caseId: request.params.id,
        body: request.body.body,
      });
      return reply.code(201).send(sent);
    },
  );
};
