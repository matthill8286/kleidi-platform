import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@kleidi/db";
import {
  explainVersion,
  listExplanations,
  shareExplanation,
  type Assist,
  type ObjectStore,
} from "@kleidi/modules/documents";
import type { Context } from "../plugins/context.ts";

const Explanation = z.object({
  id: z.string(),
  documentId: z.string(),
  versionId: z.string(),
  documentTitle: z.string(),
  fileName: z.string(),
  kind: z.string(),
  question: z.string().nullable(),
  result: z.record(z.string(), z.unknown()),
  markdown: z.string(),
  model: z.string(),
  sharedWithClient: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
});

// Kleidi Assist: English explanations of case documents, kept on the case and shared on request.
export const explanationRoutes: FastifyPluginAsyncZod<{
  db: Db;
  store: ObjectStore;
  ctx: Context;
  assist?: Assist | undefined;
}> = async (app, { db, store, ctx, assist }) => {
  app.get(
    "/features",
    { schema: { response: { 200: z.object({ assist: z.boolean() }) } } },
    async (request) => {
      await ctx.requireFirm(request);
      return { assist: Boolean(assist) };
    },
  );

  app.post(
    "/documents/versions/:versionId/explanations",
    {
      schema: {
        params: z.object({ versionId: z.uuid() }),
        body: z.object({ question: z.string().trim().max(1000).optional() }),
        response: { 201: Explanation },
      },
    },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      const created = await explainVersion(db, store, assist, {
        firm,
        actor: user,
        versionId: request.params.versionId,
        question: request.body.question,
      });
      return reply.code(201).send(created);
    },
  );

  app.get(
    "/cases/:id/explanations",
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: z.array(Explanation) } } },
    async (request) => {
      const { firm } = await ctx.requireFirm(request);
      return listExplanations(db, firm.firmId, request.params.id);
    },
  );

  app.patch(
    "/explanations/:id",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: z.object({ sharedWithClient: z.boolean() }),
      },
    },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      await shareExplanation(db, {
        firm,
        actor: user,
        explanationId: request.params.id,
        shared: request.body.sharedWithClient,
      });
      return reply.code(204).send();
    },
  );
};
