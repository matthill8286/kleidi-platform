import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db } from "@kleidi/db";
import { AppError } from "@kleidi/kernel";
import { listForEntity } from "@kleidi/modules/audit";
import {
  addParty,
  CASE_STATUSES,
  getCase,
  listCases,
  openCase,
  PARTY_ROLES,
  PROPERTY_TYPES,
  transitionCase,
} from "@kleidi/modules/cases";
import type { Context } from "../plugins/context.ts";
import type { Idempotent } from "../plugins/idempotency.ts";

/** The case version travels as a strong ETag, "v3". */
const etag = (version: number) => `"v${version}"`;

function expectedVersion(request: FastifyRequest): number {
  const header = request.headers["if-match"];
  if (!header)
    throw new AppError("precondition_required", "Send the case version in the If-Match header");
  const match = /^(?:W\/)?"v(\d+)"$/.exec(header.trim());
  if (!match)
    throw new AppError("precondition_failed", "The If-Match header is not a case version");
  return Number(match[1]);
}

const Party = z.object({
  role: z.enum(PARTY_ROLES),
  fullName: z.string().trim().min(2).max(160),
  email: z.email().optional(),
  phone: z.string().trim().max(40).optional(),
});

const CaseSummary = z.object({
  id: z.string(),
  reference: z.string(),
  propertyAddress: z.string().nullable(),
  propertyType: z.string().nullable(),
  currentStageKey: z.string(),
  status: z.enum(CASE_STATUSES),
  buyers: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const CaseDetail = z.object({
  id: z.string(),
  reference: z.string(),
  jurisdictionCode: z.string(),
  propertyAddress: z.string().nullable(),
  plotOrRegNo: z.string().nullable(),
  propertyType: z.string().nullable(),
  developerName: z.string().nullable(),
  currentStageKey: z.string(),
  status: z.enum(CASE_STATUSES),
  statusReason: z.string().nullable(),
  version: z.number(),
  assignedLawyer: z.object({ id: z.string(), name: z.string() }).nullable(),
  parties: z.array(
    z.object({
      id: z.string(),
      role: z.enum(PARTY_ROLES),
      fullName: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
    }),
  ),
  stages: z.array(z.object({ key: z.string(), label: z.record(z.string(), z.string()) })),
  history: z.array(
    z.object({ stageKey: z.string(), enteredAt: z.date(), completedAt: z.date().nullable() }),
  ),
  createdAt: z.date(),
  updatedAt: z.date(),
  closedAt: z.date().nullable(),
});

const Activity = z.array(
  z.object({
    id: z.string(),
    action: z.string(),
    actorName: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.date(),
  }),
);

const Transition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("advance") }),
  z.object({ kind: z.literal("resume") }),
  z.object({ kind: z.literal("stepBack"), reason: z.string().max(500) }),
  z.object({ kind: z.literal("hold"), reason: z.string().max(500) }),
  z.object({ kind: z.literal("cancel"), reason: z.string().max(500) }),
]);

const CaseId = z.object({ id: z.uuid() });

export const caseRoutes: FastifyPluginAsyncZod<{
  db: Db;
  ctx: Context;
  idempotent: Idempotent;
}> = async (app, { db, ctx, idempotent }) => {
  /** Reads the case again so every write answers with the same shape as GET. */
  async function detail(firmId: string, id: string) {
    const c = await getCase(db, firmId, id);
    return { status: 200, body: c, headers: { etag: etag(c.version) } };
  }

  app.get(
    "/cases",
    {
      schema: {
        querystring: z.object({
          status: z.enum(CASE_STATUSES).optional(),
          q: z.string().max(100).optional(),
          cursor: z.string().max(500).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
        response: {
          200: z.object({ items: z.array(CaseSummary), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const { firm } = await ctx.requireFirm(request);
      return listCases(db, firm.firmId, request.query);
    },
  );

  app.post(
    "/cases",
    {
      schema: {
        body: z.object({
          propertyAddress: z.string().trim().min(3).max(300),
          plotOrRegNo: z.string().trim().max(80).optional(),
          propertyType: z.enum(PROPERTY_TYPES),
          developerName: z.string().trim().max(160).optional(),
          assignedLawyerId: z.uuid().optional(),
          parties: z.array(Party).min(1).max(20),
        }),
        response: { 201: CaseDetail },
      },
    },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      return idempotent(request, reply, user.userId, async () => {
        const created = await openCase(db, { ...request.body, firm, actor: user });
        const result = await detail(firm.firmId, created.id);
        return {
          ...result,
          status: 201,
          headers: { ...result.headers, location: `/api/v1/cases/${created.id}` },
        };
      });
    },
  );

  app.get(
    "/cases/:id",
    { schema: { params: CaseId, response: { 200: CaseDetail } } },
    async (request, reply) => {
      const { firm } = await ctx.requireFirm(request);
      const result = await detail(firm.firmId, request.params.id);
      return reply.headers(result.headers).send(result.body);
    },
  );

  app.get(
    "/cases/:id/activity",
    { schema: { params: CaseId, response: { 200: Activity } } },
    async (request) => {
      const { firm } = await ctx.requireFirm(request);
      // Reading the case first turns another firm's id into a 404, not an empty list.
      await getCase(db, firm.firmId, request.params.id);
      return listForEntity(db, firm.firmId, "case", request.params.id);
    },
  );

  app.post(
    "/cases/:id/transitions",
    { schema: { params: CaseId, body: Transition, response: { 200: CaseDetail } } },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      const version = expectedVersion(request);
      return idempotent(request, reply, user.userId, async () => {
        await transitionCase(db, {
          firm,
          actor: user,
          caseId: request.params.id,
          expectedVersion: version,
          command: request.body,
        });
        return detail(firm.firmId, request.params.id);
      });
    },
  );

  app.post(
    "/cases/:id/parties",
    { schema: { params: CaseId, body: Party, response: { 200: CaseDetail } } },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      const version = expectedVersion(request);
      return idempotent(request, reply, user.userId, async () => {
        await addParty(db, {
          firm,
          actor: user,
          caseId: request.params.id,
          expectedVersion: version,
          party: request.body,
        });
        return detail(firm.firmId, request.params.id);
      });
    },
  );
};
