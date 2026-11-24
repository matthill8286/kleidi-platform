import { and, desc, eq } from "drizzle-orm";
import { publishEvents, withFirm, type Db } from "@kleidi/db";
import { documentExplanations, documents, documentVersions } from "@kleidi/db/schema/documents";
import { AppError } from "@kleidi/kernel";
import type { Actor, FirmContext } from "../firms/index.ts";
import { findUsersByIds } from "../identity/index.ts";
import { EXPLAINABLE_TYPES, type Assist } from "./assist.ts";
import type { ExplanationCreated, ExplanationShared } from "./events.ts";
import type { ObjectStore } from "./storage.ts";

const MAX_EXPLAIN_BYTES = 15 * 1024 * 1024;

async function readAll(body: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/**
 * Sends one clean document version to Kleidi Assist and keeps the English explanation on the
 * case. It stays inside the firm until a lawyer shares it with the client.
 */
export async function explainVersion(
  db: Db,
  store: ObjectStore,
  assist: Assist | undefined,
  input: { firm: FirmContext; actor: Actor; versionId: string; question?: string | undefined },
) {
  if (!assist) {
    throw new AppError("unavailable", "Kleidi Assist is not set up", "assistUnavailable");
  }
  const found = await withFirm(db, input.firm.firmId, async (tx) => {
    const [row] = await tx
      .select({ v: documentVersions, d: documents })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(eq(documentVersions.id, input.versionId))
      .limit(1);
    return row;
  });
  if (!found) throw new AppError("not_found", "Document not found", "documentNotFound");
  const { v, d } = found;
  if (v.scanStatus !== "clean") {
    throw new AppError("conflict", "This file is still being checked", "fileScanning");
  }
  if (!EXPLAINABLE_TYPES.has(v.mimeType) || v.byteSize > MAX_EXPLAIN_BYTES) {
    throw new AppError(
      "invalid",
      "Kleidi Assist reads PDF, JPEG, PNG and text files up to 15 MB",
      "explainUnsupported",
    );
  }

  const bytes = await readAll((await store.read(v.objectKey)).body);
  const question = input.question?.trim() || null;
  const result = await assist.explainCyprus({
    document: { name: v.fileName, mediaType: v.mimeType, bytes },
    question: question ?? undefined,
  });

  const saved = await withFirm(db, input.firm.firmId, async (tx) => {
    const [row] = await tx
      .insert(documentExplanations)
      .values({
        firmId: input.firm.firmId,
        caseId: d.caseId,
        documentId: d.id,
        versionId: v.id,
        kind: "cyprus_explanation",
        question,
        result: result.explanation,
        markdown: result.markdown,
        model: result.model,
        createdById: input.actor.userId,
      })
      .returning();
    const event: ExplanationCreated = {
      type: "documents.ExplanationCreated",
      firmId: input.firm.firmId,
      actorUserId: input.actor.userId,
      payload: {
        entityType: "case",
        entityId: d.caseId,
        documentId: d.id,
        requirementKey: d.requirementKey,
        title: d.title,
        explanationId: row!.id,
        versionId: v.id,
        model: result.model,
      },
    };
    await publishEvents(tx, [event]);
    return row!;
  });
  return present(saved, { title: d.title, fileName: v.fileName }, input.actor.name);
}

function present(
  e: typeof documentExplanations.$inferSelect,
  doc: { title: string; fileName: string },
  createdBy: string | null,
) {
  return {
    id: e.id,
    documentId: e.documentId,
    versionId: e.versionId,
    documentTitle: doc.title,
    fileName: doc.fileName,
    kind: e.kind,
    question: e.question,
    result: e.result,
    markdown: e.markdown,
    model: e.model,
    sharedWithClient: e.sharedWithClient,
    createdBy,
    createdAt: e.createdAt,
  };
}

/** Every explanation on a case, newest first, for the firm. */
export async function listExplanations(db: Db, firmId: string, caseId: string) {
  const rows = await withFirm(db, firmId, (tx) =>
    tx
      .select({
        e: documentExplanations,
        title: documents.title,
        fileName: documentVersions.fileName,
      })
      .from(documentExplanations)
      .innerJoin(documents, eq(documents.id, documentExplanations.documentId))
      .innerJoin(documentVersions, eq(documentVersions.id, documentExplanations.versionId))
      .where(eq(documentExplanations.caseId, caseId))
      .orderBy(desc(documentExplanations.createdAt)),
  );
  const people = new Map(
    (await findUsersByIds(db, [...new Set(rows.map((r) => r.e.createdById))])).map((u) => [
      u.id,
      u.name,
    ]),
  );
  return rows.map((r) => present(r.e, r, people.get(r.e.createdById) ?? null));
}

/** Shares an explanation with the case's clients, or takes it back. */
export async function shareExplanation(
  db: Db,
  input: { firm: FirmContext; actor: Actor; explanationId: string; shared: boolean },
) {
  await withFirm(db, input.firm.firmId, async (tx) => {
    const [row] = await tx
      .select({ e: documentExplanations, d: documents })
      .from(documentExplanations)
      .innerJoin(documents, eq(documents.id, documentExplanations.documentId))
      .where(eq(documentExplanations.id, input.explanationId))
      .for("update");
    if (!row) throw new AppError("not_found", "Explanation not found", "explanationNotFound");
    if (row.e.sharedWithClient === input.shared) return;
    await tx
      .update(documentExplanations)
      .set({ sharedWithClient: input.shared })
      .where(eq(documentExplanations.id, row.e.id));
    const event: ExplanationShared = {
      type: "documents.ExplanationShared",
      firmId: input.firm.firmId,
      actorUserId: input.actor.userId,
      payload: {
        entityType: "case",
        entityId: row.d.caseId,
        documentId: row.d.id,
        requirementKey: row.d.requirementKey,
        title: row.d.title,
        explanationId: row.e.id,
        shared: input.shared,
      },
    };
    await publishEvents(tx, [event]);
  });
}

/** The explanations a lawyer has shared on a case: what the client portal shows. */
export async function listClientExplanations(db: Db, firmId: string, caseId: string) {
  const rows = await withFirm(db, firmId, (tx) =>
    tx
      .select({ e: documentExplanations, title: documents.title })
      .from(documentExplanations)
      .innerJoin(documents, eq(documents.id, documentExplanations.documentId))
      .where(
        and(
          eq(documentExplanations.caseId, caseId),
          eq(documentExplanations.sharedWithClient, true),
        ),
      )
      .orderBy(desc(documentExplanations.createdAt)),
  );
  return rows.map(({ e, title }) => ({
    id: e.id,
    documentTitle: title,
    result: e.result,
    createdAt: e.createdAt,
  }));
}
