import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@kleidi/db";
import { AppError } from "@kleidi/kernel";
import {
  completeUpload,
  downloadLink,
  listCaseDocuments,
  MAX_UPLOAD_BYTES,
  requestUpload,
  reviewDocument,
  updateDocument,
  type ObjectStore,
  type UploadTarget,
} from "@kleidi/modules/documents";
import type { Context } from "../plugins/context.ts";
import type { Idempotent } from "../plugins/idempotency.ts";

const Localised = z.record(z.string(), z.string());
const ITEM_STATES = [
  "missing",
  "scanning",
  "review",
  "rejected",
  "ready",
  "infected",
  "failed",
  "expiring",
  "expired",
] as const;
const SCAN_STATUSES = ["uploading", "pending", "clean", "infected", "failed"] as const;
const IsoDate = z.iso.date();

const DocumentView = z.object({
  id: z.string(),
  title: z.string(),
  requirementKey: z.string().nullable(),
  visibility: z.enum(["client", "firm"]),
  expiresOn: z.string().nullable(),
  state: z.enum(ITEM_STATES),
  versions: z.array(
    z.object({
      id: z.string(),
      version: z.number(),
      fileName: z.string(),
      mimeType: z.string(),
      byteSize: z.number(),
      scanStatus: z.enum(SCAN_STATUSES),
      scanDetail: z.string().nullable(),
      review: z.enum(["pending", "accepted", "rejected"]),
      reviewNote: z.string().nullable(),
      reviewedBy: z.string().nullable(),
      reviewedAt: z.date().nullable(),
      uploadedBy: z.string().nullable(),
      createdAt: z.date(),
    }),
  ),
});

const CaseDocuments = z.object({
  stages: z.array(
    z.object({
      key: z.string(),
      label: Localised,
      position: z.enum(["past", "current", "future"]),
      outstanding: z.number(),
      items: z.array(
        z.object({
          requirementKey: z.string(),
          label: Localised,
          help: Localised,
          expiryDays: z.number().nullable(),
          state: z.enum(ITEM_STATES),
          document: DocumentView.nullable(),
        }),
      ),
    }),
  ),
  other: z.array(DocumentView),
  summary: z.object({
    total: z.number(),
    ready: z.number(),
    attention: z.number(),
    gapsBehind: z.number(),
  }),
});

const UploadRequest = z
  .object({
    requirementKey: z.string().max(80).optional(),
    documentId: z.uuid().optional(),
    title: z.string().trim().min(2).max(160).optional(),
    fileName: z.string().trim().min(1).max(200),
    mimeType: z.string().max(120),
    byteSize: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  })
  .refine((b) => [b.requirementKey, b.documentId, b.title].filter(Boolean).length === 1, {
    message: "Send exactly one of requirementKey, documentId or title",
  });

export const documentRoutes: FastifyPluginAsyncZod<{
  db: Db;
  store: ObjectStore;
  ctx: Context;
  idempotent: Idempotent;
}> = async (app, { db, store, ctx, idempotent }) => {
  app.get(
    "/cases/:id/documents",
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: CaseDocuments } } },
    async (request) => {
      const { firm } = await ctx.requireFirm(request);
      return listCaseDocuments(db, firm.firmId, request.params.id);
    },
  );

  app.post(
    "/cases/:id/documents/uploads",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: UploadRequest,
        response: {
          201: z.object({
            documentId: z.string(),
            versionId: z.string(),
            version: z.number(),
            uploadUrl: z.string(),
            uploadHeaders: z.record(z.string(), z.string()),
          }),
        },
      },
    },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      const { requirementKey, documentId, title, ...file } = request.body;
      const target: UploadTarget = requirementKey
        ? { requirementKey }
        : documentId
          ? { documentId }
          : { title: title! };
      return idempotent(request, reply, user.userId, async () => ({
        status: 201,
        body: await requestUpload(db, store, {
          firm,
          actor: user,
          caseId: request.params.id,
          target,
          ...file,
        }),
      }));
    },
  );

  app.post(
    "/documents/versions/:versionId/complete",
    {
      schema: {
        params: z.object({ versionId: z.uuid() }),
        body: z.object({ expiresOn: IsoDate.nullable().optional() }),
        response: {
          200: z.object({
            documentId: z.string(),
            versionId: z.string(),
            scanStatus: z.enum(SCAN_STATUSES),
          }),
        },
      },
    },
    async (request) => {
      const { user, firm } = await ctx.requireFirm(request);
      const result = await completeUpload(db, store, {
        firm,
        actor: user,
        versionId: request.params.versionId,
        expiresOn: request.body.expiresOn,
      });
      if (result.scanStatus === "failed") {
        throw new AppError(
          "invalid",
          "The upload did not arrive intact. Try again.",
          "uploadNotIntact",
        );
      }
      return result;
    },
  );

  app.post(
    "/documents/versions/:versionId/review",
    {
      schema: {
        params: z.object({ versionId: z.uuid() }),
        body: z.object({
          decision: z.enum(["accepted", "rejected"]),
          note: z.string().max(500).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      await reviewDocument(db, {
        firm,
        actor: user,
        versionId: request.params.versionId,
        ...request.body,
      });
      return reply.code(204).send();
    },
  );

  app.get(
    "/documents/versions/:versionId/download",
    {
      schema: {
        params: z.object({ versionId: z.uuid() }),
        response: { 200: z.object({ url: z.string() }) },
      },
    },
    async (request) => {
      const { firm } = await ctx.requireFirm(request);
      return downloadLink(db, store, firm.firmId, request.params.versionId);
    },
  );

  app.patch(
    "/documents/:id",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: z.object({
          visibility: z.enum(["client", "firm"]).optional(),
          expiresOn: IsoDate.nullable().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      await updateDocument(db, {
        firm,
        actor: user,
        documentId: request.params.id,
        ...request.body,
      });
      return reply.code(204).send();
    },
  );
};
