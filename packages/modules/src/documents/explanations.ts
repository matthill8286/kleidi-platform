import { and, count, desc, eq } from "drizzle-orm";
import { publishEvents, withFirm, type Db } from "@kleidi/db";
import { documentExplanations, documents, documentVersions } from "@kleidi/db/schema/documents";
import { AppError } from "@kleidi/kernel";
import { clientMaySee } from "./application.ts";
import { EXPLAINABLE_TYPES, type Assist } from "./assist.ts";
import type { ExplanationRequested } from "./events.ts";
import type { ObjectStore } from "./storage.ts";

const MAX_EXPLAIN_BYTES = 15 * 1024 * 1024;
// The per-sale price includes the AI; this cap keeps one case's running cost bounded.
export const MAX_EXPLANATIONS_PER_CASE = 25;

async function readAll(body: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

export type ClientRef = { firmId: string; caseId: string; partyId: string; partyName: string };

/**
 * A client asks for an English explanation of a document they can see in the portal. Only that
 * client sees it; the firm's activity log records that it was asked for.
 */
export async function explainForClient(
  db: Db,
  store: ObjectStore,
  assist: Assist | undefined,
  input: ClientRef & { versionId: string; question?: string | undefined },
) {
  if (!assist) {
    throw new AppError(
      "unavailable",
      "English explanations are not switched on",
      "assistUnavailable",
    );
  }
  const found = await withFirm(db, input.firmId, async (tx) => {
    const [row] = await tx
      .select({ v: documentVersions, d: documents })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(eq(documentVersions.id, input.versionId))
      .limit(1);
    const [used] = await tx
      .select({ n: count() })
      .from(documentExplanations)
      .where(eq(documentExplanations.caseId, input.caseId));
    return { row, used: used?.n ?? 0 };
  });
  const { row, used } = found;
  // Anything the client may not open is "not found", as with downloads.
  if (!row || row.d.caseId !== input.caseId || !clientMaySee(row.d, row.v, input.partyId)) {
    throw new AppError("not_found", "Document not found", "documentNotFound");
  }
  const { v, d } = row;
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
  if (used >= MAX_EXPLANATIONS_PER_CASE) {
    throw new AppError(
      "invalid",
      "This case has used all its explanations. Ask your lawyer.",
      "explanationLimit",
      { max: MAX_EXPLANATIONS_PER_CASE },
    );
  }

  const bytes = await readAll((await store.read(v.objectKey)).body);
  const question = input.question?.trim() || null;
  const result = await assist.explainCyprus({
    document: { name: v.fileName, mediaType: v.mimeType, bytes },
    question: question ?? undefined,
  });

  return withFirm(db, input.firmId, async (tx) => {
    const [saved] = await tx
      .insert(documentExplanations)
      .values({
        firmId: input.firmId,
        caseId: d.caseId,
        documentId: d.id,
        versionId: v.id,
        partyId: input.partyId,
        kind: "cyprus_explanation",
        question,
        result: result.explanation,
        markdown: result.markdown,
        model: result.model,
      })
      .returning();
    const event: ExplanationRequested = {
      type: "documents.ExplanationRequested",
      firmId: input.firmId,
      actorUserId: null,
      payload: {
        entityType: "case",
        entityId: d.caseId,
        documentId: d.id,
        requirementKey: d.requirementKey,
        title: d.title,
        explanationId: saved!.id,
        versionId: v.id,
        model: result.model,
        client: input.partyName,
      },
    };
    await publishEvents(tx, [event]);
    return {
      id: saved!.id,
      documentTitle: d.title,
      question: saved!.question,
      result: saved!.result,
      createdAt: saved!.createdAt,
    };
  });
}

/** The explanations one client asked for on their case, newest first. */
export async function listClientExplanations(
  db: Db,
  firmId: string,
  caseId: string,
  partyId: string,
) {
  const rows = await withFirm(db, firmId, (tx) =>
    tx
      .select({ e: documentExplanations, title: documents.title })
      .from(documentExplanations)
      .innerJoin(documents, eq(documents.id, documentExplanations.documentId))
      .where(
        and(eq(documentExplanations.caseId, caseId), eq(documentExplanations.partyId, partyId)),
      )
      .orderBy(desc(documentExplanations.createdAt)),
  );
  return rows.map(({ e, title }) => ({
    id: e.id,
    documentTitle: title,
    question: e.question,
    result: e.result,
    createdAt: e.createdAt,
  }));
}
