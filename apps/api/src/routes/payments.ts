import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@kleidi/db";
import {
  addPayment,
  listPayments,
  PAYMENT_STATUSES,
  removePayment,
  updatePayment,
} from "@kleidi/modules/payments";
import type { Context } from "../plugins/context.ts";

export const Payment = z.object({
  id: z.string(),
  label: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  dueOn: z.string().nullable(),
  payTo: z.string().nullable(),
  status: z.enum(PAYMENT_STATUSES),
  paidOn: z.string().nullable(),
});
const IsoDate = z.iso.date();

// The buyer's payment schedule. The firm keeps it; the client portal shows it.
export const paymentRoutes: FastifyPluginAsyncZod<{ db: Db; ctx: Context }> = async (
  app,
  { db, ctx },
) => {
  app.get(
    "/cases/:id/payments",
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: z.array(Payment) } } },
    async (request) => {
      const { firm } = await ctx.requireFirm(request);
      return listPayments(db, firm.firmId, request.params.id);
    },
  );
  app.post(
    "/cases/:id/payments",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: z.object({
          label: z.string().max(200),
          amountMinor: z.number().int(),
          dueOn: IsoDate.nullable().optional(),
          payTo: z.string().max(300).nullable().optional(),
        }),
        response: { 201: Payment },
      },
    },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      const created = await addPayment(db, {
        firm,
        actor: user,
        caseId: request.params.id,
        ...request.body,
      });
      return reply.code(201).send(created);
    },
  );
  app.patch(
    "/payments/:id",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: z.object({
          label: z.string().max(200).optional(),
          amountMinor: z.number().int().optional(),
          dueOn: IsoDate.nullable().optional(),
          payTo: z.string().max(300).nullable().optional(),
          status: z.enum(PAYMENT_STATUSES).optional(),
          paidOn: IsoDate.nullable().optional(),
        }),
        response: { 200: Payment },
      },
    },
    async (request) => {
      const { user, firm } = await ctx.requireFirm(request);
      return updatePayment(db, {
        firm,
        actor: user,
        paymentId: request.params.id,
        ...request.body,
      });
    },
  );
  app.delete(
    "/payments/:id",
    { schema: { params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      await removePayment(db, { firm, actor: user, paymentId: request.params.id });
      return reply.code(204).send();
    },
  );
};
