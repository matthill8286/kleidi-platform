import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@kleidi/db";
import { updatePartyContact } from "@kleidi/modules/cases";
import { setRequestedFromClient } from "@kleidi/modules/documents";
import { LOCALES } from "@kleidi/modules/identity";
import type { Notifier } from "@kleidi/modules/notifications";
import { inviteClient, listPortalAccess, revokeAccess } from "@kleidi/modules/portal";
import type { Context } from "../plugins/context.ts";

/** The firm's side of the portal: contact details, invitations and what to ask clients for. */
export const clientAccessRoutes: FastifyPluginAsyncZod<{
  db: Db;
  ctx: Context;
  notifier: Notifier;
  webOrigin: string;
}> = async (app, { db, ctx, notifier, webOrigin }) => {
  const CaseParty = z.object({ id: z.uuid(), partyId: z.uuid() });

  app.patch(
    "/cases/:id/parties/:partyId",
    {
      schema: {
        params: CaseParty,
        body: z.object({
          email: z.email().nullable().optional(),
          phone: z.string().max(40).nullable().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      await updatePartyContact(db, {
        firm,
        actor: user,
        caseId: request.params.id,
        partyId: request.params.partyId,
        ...request.body,
      });
      return reply.code(204).send();
    },
  );

  app.get(
    "/cases/:id/portal",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              partyId: z.string(),
              createdAt: z.date(),
              lastSeenAt: z.date().nullable(),
              revokedAt: z.date().nullable(),
            }),
          ),
        },
      },
    },
    async (request) => {
      const { firm } = await ctx.requireFirm(request);
      return listPortalAccess(db, firm.firmId, request.params.id);
    },
  );

  app.post(
    "/cases/:id/parties/:partyId/portal",
    { schema: { params: CaseParty, body: z.object({ locale: z.enum(LOCALES) }) } },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      await inviteClient(db, notifier, {
        firm,
        actor: user,
        caseId: request.params.id,
        partyId: request.params.partyId,
        locale: request.body.locale,
        appUrl: webOrigin,
      });
      return reply.code(204).send();
    },
  );

  app.delete(
    "/portal-access/:id",
    { schema: { params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      await revokeAccess(db, { firm, actor: user, accessId: request.params.id });
      return reply.code(204).send();
    },
  );

  app.post(
    "/cases/:id/documents/requests",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: z
          .object({
            requirementKey: z.string().max(80).optional(),
            documentId: z.uuid().optional(),
            requested: z.boolean(),
          })
          .refine((b) => Boolean(b.requirementKey) !== Boolean(b.documentId), {
            message: "Send either requirementKey or documentId",
          }),
      },
    },
    async (request, reply) => {
      const { user, firm } = await ctx.requireFirm(request);
      const { requirementKey, documentId, requested } = request.body;
      await setRequestedFromClient(db, {
        firm,
        actor: user,
        caseId: request.params.id,
        target: requirementKey ? { requirementKey } : { documentId: documentId! },
        requested,
      });
      return reply.code(204).send();
    },
  );
};
