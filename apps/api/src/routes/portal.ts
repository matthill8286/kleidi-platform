import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@kleidi/db";
import { AppError } from "@kleidi/kernel";
import { grantConsent, revokeConsent } from "@kleidi/modules/consent";
import {
  clientDownloadLink,
  completeUpload,
  MAX_UPLOAD_BYTES,
  requestUpload,
  type ObjectStore,
} from "@kleidi/modules/documents";
import { LOCALES } from "@kleidi/modules/identity";
import type { Notifier } from "@kleidi/modules/notifications";
import {
  acceptPrivacy,
  getClientCase,
  PRIVACY_VERSION,
  requestSignInLink,
  SESSION_DAYS,
  sessionFromToken,
  setClientLocale,
  signOutClient,
  startLink,
  verifyLink,
  type PortalSession,
} from "@kleidi/modules/portal";

export const PORTAL_COOKIE = "kleidi_portal";

type Deps = {
  db: Db;
  store: ObjectStore;
  notifier: Notifier;
  webOrigin: string;
  secureCookies: boolean;
};

const Localised = z.record(z.string(), z.string());

/**
 * The client portal. Clients are not firm users: they hold a session cookie for one case,
 * and every route here returns only what the firm shared with them.
 */
export const portalRoutes: FastifyPluginAsyncZod<Deps> = async (app, deps) => {
  const { db, store, notifier, webOrigin } = deps;

  // Cookie sessions need a same-origin check on every change, against cross-site requests.
  app.addHook("onRequest", async (request) => {
    if (request.method !== "GET" && request.headers.origin !== webOrigin) {
      throw new AppError("forbidden", "Request from an unknown origin");
    }
  });

  async function requireClient(
    request: FastifyRequest,
    options: { allowWithoutPrivacy?: boolean } = {},
  ): Promise<PortalSession> {
    const token = request.cookies[PORTAL_COOKIE];
    const session = token ? await sessionFromToken(db, token) : null;
    if (!session) throw new AppError("unauthenticated", "Sign in to continue", "signIn");
    if (!session.privacyAccepted && !options.allowWithoutPrivacy) {
      throw new AppError("forbidden", "Accept the privacy notice to continue", "privacyNeeded");
    }
    return session;
  }

  const setSession = (reply: FastifyReply, token: string) =>
    reply.setCookie(PORTAL_COOKIE, token, {
      path: "/api/portal",
      httpOnly: true,
      sameSite: "lax",
      secure: deps.secureCookies,
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });

  const Token = z.object({ token: z.string().min(20).max(200) });

  app.post(
    "/link/:token/start",
    {
      config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
      schema: {
        params: Token,
        body: z.object({ resend: z.boolean().optional() }),
        response: {
          200: z.object({
            firmName: z.string(),
            partyName: z.string(),
            maskedPhone: z.string(),
            locale: z.enum(LOCALES),
            sent: z.boolean(),
          }),
        },
      },
    },
    async (request) => startLink(db, notifier, { token: request.params.token, ...request.body }),
  );

  app.post(
    "/link/:token/verify",
    {
      config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
      schema: { params: Token, body: z.object({ code: z.string().max(12) }) },
    },
    async (request, reply) => {
      const { sessionToken } = await verifyLink(db, {
        token: request.params.token,
        code: request.body.code,
      });
      return setSession(reply, sessionToken).code(204).send();
    },
  );

  app.post(
    "/sign-in",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: { body: z.object({ email: z.email() }) },
    },
    async (request, reply) => {
      // Answer at once, known address or not, so the response time reveals nothing.
      void requestSignInLink(db, notifier, { email: request.body.email, appUrl: webOrigin }).catch(
        (error: unknown) => request.log.error(error),
      );
      return reply.code(204).send();
    },
  );

  app.post("/sign-out", async (request, reply) => {
    const session = await requireClient(request, { allowWithoutPrivacy: true });
    await signOutClient(db, session.sessionId);
    return reply.clearCookie(PORTAL_COOKIE, { path: "/api/portal" }).code(204).send();
  });

  app.get(
    "/me",
    {
      schema: {
        response: {
          200: z.object({
            name: z.string(),
            locale: z.enum(LOCALES),
            privacyAccepted: z.boolean(),
            privacyVersion: z.string(),
          }),
        },
      },
    },
    async (request) => {
      const s = await requireClient(request, { allowWithoutPrivacy: true });
      return {
        name: s.partyName,
        locale: s.locale,
        privacyAccepted: s.privacyAccepted,
        privacyVersion: PRIVACY_VERSION,
      };
    },
  );

  app.patch(
    "/me",
    { schema: { body: z.object({ locale: z.enum(LOCALES) }) } },
    async (request, reply) => {
      const s = await requireClient(request, { allowWithoutPrivacy: true });
      await setClientLocale(db, s, request.body.locale);
      return reply.code(204).send();
    },
  );

  app.post("/privacy/accept", async (request, reply) => {
    const s = await requireClient(request, { allowWithoutPrivacy: true });
    await acceptPrivacy(db, s);
    return reply.code(204).send();
  });

  app.get(
    "/case",
    {
      schema: {
        response: {
          200: z.object({
            firmName: z.string(),
            lawyer: z.object({ name: z.string(), email: z.string() }).nullable(),
            you: z.object({ name: z.string(), role: z.string() }),
            case: z.object({
              reference: z.string(),
              propertyAddress: z.string().nullable(),
              status: z.string(),
              stages: z.array(
                z.object({
                  key: z.string(),
                  label: Localised,
                  position: z.enum(["done", "current", "next"]),
                  reachedAt: z.date().nullable(),
                }),
              ),
            }),
            documents: z.array(
              z.object({
                id: z.string(),
                title: z.string(),
                requirementKey: z.string().nullable(),
                requested: z.boolean(),
                latest: z
                  .object({
                    id: z.string(),
                    fileName: z.string(),
                    createdAt: z.date(),
                    fromYou: z.boolean(),
                    scanStatus: z.string(),
                    review: z.string(),
                    reviewNote: z.string().nullable(),
                    downloadable: z.boolean(),
                  })
                  .nullable(),
              }),
            ),
            consents: z.array(
              z.object({
                id: z.string(),
                granteeType: z.string(),
                granteeRef: z.string(),
                grantedAt: z.date(),
                revokedAt: z.date().nullable(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => getClientCase(db, await requireClient(request)),
  );

  app.post(
    "/uploads",
    {
      schema: {
        body: z
          .object({
            documentId: z.uuid().optional(),
            title: z.string().trim().min(2).max(160).optional(),
            fileName: z.string().trim().min(1).max(200),
            mimeType: z.string().max(120),
            byteSize: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
          })
          .refine((b) => Boolean(b.documentId) !== Boolean(b.title), {
            message: "Send either documentId or title",
          }),
        response: {
          201: z.object({
            versionId: z.string(),
            uploadUrl: z.string(),
            uploadHeaders: z.record(z.string(), z.string()),
          }),
        },
      },
    },
    async (request, reply) => {
      const s = await requireClient(request);
      const { documentId, title, ...file } = request.body;
      const link = await requestUpload(db, store, {
        firm: { firmId: s.firmId },
        actor: { partyId: s.partyId, name: s.partyName },
        caseId: s.caseId,
        target: documentId ? { documentId } : { title: title! },
        ...file,
      });
      return reply.code(201).send({
        versionId: link.versionId,
        uploadUrl: link.uploadUrl,
        uploadHeaders: link.uploadHeaders,
      });
    },
  );

  app.post(
    "/uploads/:versionId/complete",
    { schema: { params: z.object({ versionId: z.uuid() }) } },
    async (request, reply) => {
      const s = await requireClient(request);
      const result = await completeUpload(db, store, {
        firm: { firmId: s.firmId },
        actor: { partyId: s.partyId, name: s.partyName },
        versionId: request.params.versionId,
      });
      if (result.scanStatus === "failed") {
        throw new AppError(
          "invalid",
          "The upload did not arrive intact. Try again.",
          "uploadNotIntact",
        );
      }
      return reply.code(204).send();
    },
  );

  app.get(
    "/documents/:versionId/download",
    {
      schema: {
        params: z.object({ versionId: z.uuid() }),
        response: { 200: z.object({ url: z.string() }) },
      },
    },
    async (request) => {
      const s = await requireClient(request);
      return clientDownloadLink(db, store, {
        firmId: s.firmId,
        caseId: s.caseId,
        partyId: s.partyId,
        partyName: s.partyName,
        versionId: request.params.versionId,
      });
    },
  );

  app.post(
    "/consents",
    {
      schema: {
        body: z.object({ granteeType: z.enum(["agent", "bank", "insurer"]), email: z.email() }),
      },
    },
    async (request, reply) => {
      const s = await requireClient(request);
      await grantConsent(
        db,
        { firmId: s.firmId, caseId: s.caseId, partyId: s.partyId },
        { type: request.body.granteeType, email: request.body.email },
      );
      return reply.code(204).send();
    },
  );

  app.delete(
    "/consents/:id",
    { schema: { params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const s = await requireClient(request);
      await revokeConsent(
        db,
        { firmId: s.firmId, caseId: s.caseId, partyId: s.partyId },
        request.params.id,
      );
      return reply.code(204).send();
    },
  );
};
