import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@kleidi/db";
import {
  approveLeaseReview,
  getLeaseReview,
  reviewLeaseForCase,
  updateLeaseReview,
  type Assist,
  type ObjectStore,
} from "@kleidi/modules/documents";
import type { Context } from "../plugins/context.ts";

const LeaseReview = z.object({
  id: z.string(),
  documentId: z.string(),
  versionId: z.string(),
  documentTitle: z.string(),
  buyer: z.object({
    plansToLet: z.boolean().optional(),
    propertyValue: z.number().optional(),
    inLondon: z.boolean().optional(),
  }),
  result: z.record(z.string(), z.unknown()),
  report: z.string(),
  buyerSummary: z.string(),
  status: z.enum(["draft", "approved"]),
  model: z.string(),
  approvedAt: z.date().nullable(),
  createdAt: z.date(),
});

/** Lease reviews for leasehold sales in England and Wales, done by Kleidi Assist and approved by the lawyer. */
export const leaseReviewRoutes: FastifyPluginAsyncZod<{
  db: Db;
  store: ObjectStore;
  ctx: Context;
  assist?: Assist | undefined;
}> = async (app, { db, store, ctx, assist }) => {
  app.get(
    "/cases/:id/lease-review",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ review: LeaseReview.nullable(), available: z.boolean() }) },
      },
    },
    async (request) => {
      const { firm } = await ctx.requireFirm(request);
      return {
        review: await getLeaseReview(db, firm.firmId, request.params.id),
        available: Boolean(assist),
      };
    },
  );

  app.post(
    "/cases/:id/lease-review",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: z.object({
          documentId: z.uuid(),
          plansToLet: z.boolean().optional(),
          propertyValue: z.number().positive().max(1_000_000_000).optional(),
          inLondon: z.boolean().optional(),
        }),
        response: { 201: LeaseReview },
      },
    },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      const { documentId, ...buyer } = request.body;
      const review = await reviewLeaseForCase(db, store, assist, {
        firm,
        actor: user,
        caseId: request.params.id,
        documentId,
        buyer,
      });
      return reply.code(201).send(review);
    },
  );

  app.patch(
    "/lease-reviews/:id",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: z.object({
          report: z.string().min(1).max(100_000).optional(),
          buyerSummary: z.string().min(1).max(20_000).optional(),
        }),
        response: { 200: LeaseReview },
      },
    },
    async (request) => {
      const { firm } = await ctx.requireFirm(request);
      return updateLeaseReview(db, { firm, reviewId: request.params.id, ...request.body });
    },
  );

  app.post(
    "/lease-reviews/:id/approve",
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: LeaseReview } } },
    async (request) => {
      const { user, firm } = await ctx.requireFirm(request);
      return approveLeaseReview(db, assist, { firm, actor: user, reviewId: request.params.id });
    },
  );
};
