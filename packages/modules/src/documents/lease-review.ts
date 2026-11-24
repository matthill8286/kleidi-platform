import { and, desc, eq } from "drizzle-orm";
import { publishEvents, withFirm, type Db } from "@kleidi/db";
import { documents, documentVersions, leaseReviews } from "@kleidi/db/schema/documents";
import { AppError } from "@kleidi/kernel";
import { findCase } from "../cases/index.ts";
import type { Actor, FirmContext } from "../firms/index.ts";
import type { Assist, LeaseBuyer } from "./assist.ts";
import type { LeaseReviewApproved, LeaseReviewed } from "./events.ts";
import type { ObjectStore } from "./storage.ts";

const MAX_LEASE_BYTES = 15 * 1024 * 1024;
const LEASE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
// The portal languages the approved summary is translated into. English is the original.
const TRANSLATE_TO = ["el", "ru"] as const;

async function readAll(body: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

export type LeaseReviewView = {
  id: string;
  documentId: string;
  versionId: string;
  documentTitle: string;
  buyer: LeaseBuyer;
  result: Record<string, unknown>;
  report: string;
  buyerSummary: string;
  status: "draft" | "approved";
  model: string;
  approvedAt: Date | null;
  createdAt: Date;
};

/** Lease reviews are for leasehold sales in England and Wales, where Kleidi Assist knows the law. */
async function leaseholdCase(db: Db, firmId: string, caseId: string) {
  const c = await withFirm(db, firmId, (tx) => findCase(tx, caseId));
  if (!c) throw new AppError("not_found", "Case not found", "caseNotFound");
  if (c.jurisdictionCode !== "EW" || c.tenure !== "leasehold") {
    throw new AppError(
      "invalid",
      "Lease reviews are for leasehold sales in England and Wales",
      "leaseReviewNotApplicable",
    );
  }
  return c;
}

/**
 * Sends a lease on the case to Kleidi Assist and keeps the review as a draft for the lawyer.
 * The buyer sees nothing until the lawyer approves the summary.
 */
export async function reviewLeaseForCase(
  db: Db,
  store: ObjectStore,
  assist: Assist | undefined,
  input: { firm: FirmContext; actor: Actor; caseId: string; documentId: string; buyer: LeaseBuyer },
): Promise<LeaseReviewView> {
  if (!assist) {
    throw new AppError("unavailable", "Kleidi Assist is not switched on", "assistUnavailable");
  }
  const firmId = input.firm.firmId;
  await leaseholdCase(db, firmId, input.caseId);
  const row = await withFirm(db, firmId, async (tx) => {
    const [found] = await tx
      .select({ v: documentVersions, d: documents })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(and(eq(documents.id, input.documentId), eq(documents.caseId, input.caseId)))
      .orderBy(desc(documentVersions.version))
      .limit(1);
    return found;
  });
  if (!row) throw new AppError("not_found", "Document not found", "documentNotFound");
  const { v, d } = row;
  if (v.scanStatus !== "clean") {
    throw new AppError("conflict", "This file is still being checked", "fileScanning");
  }
  if (!LEASE_TYPES.has(v.mimeType) || v.byteSize > MAX_LEASE_BYTES) {
    throw new AppError(
      "invalid",
      "The lease must be a PDF or an image up to 15 MB",
      "leaseUnsupported",
    );
  }

  const bytes = await readAll((await store.read(v.objectKey)).body);
  const result = await assist.reviewLease({
    document: { name: v.fileName, mediaType: v.mimeType, bytes },
    buyer: input.buyer,
  });
  const flags = Array.isArray(result.review.flags) ? result.review.flags.length : 0;

  return withFirm(db, firmId, async (tx) => {
    const [saved] = await tx
      .insert(leaseReviews)
      .values({
        firmId,
        caseId: input.caseId,
        documentId: d.id,
        versionId: v.id,
        buyer: input.buyer,
        result: result.review,
        report: result.report,
        buyerSummary: result.buyerSummary,
        model: result.model,
        createdById: input.actor.userId,
      })
      .returning();
    const event: LeaseReviewed = {
      type: "documents.LeaseReviewed",
      firmId,
      actorUserId: input.actor.userId,
      payload: {
        entityType: "case",
        entityId: input.caseId,
        documentId: d.id,
        requirementKey: d.requirementKey,
        title: d.title,
        reviewId: saved!.id,
        versionId: v.id,
        model: result.model,
        flags,
      },
    };
    await publishEvents(tx, [event]);
    return view(saved!, d.title);
  });
}

function view(r: typeof leaseReviews.$inferSelect, documentTitle: string): LeaseReviewView {
  return {
    id: r.id,
    documentId: r.documentId,
    versionId: r.versionId,
    documentTitle,
    buyer: r.buyer,
    result: r.result,
    report: r.report,
    buyerSummary: r.buyerSummary,
    status: r.status as "draft" | "approved",
    model: r.model,
    approvedAt: r.approvedAt,
    createdAt: r.createdAt,
  };
}

/** The newest lease review on a case, or null. */
export async function getLeaseReview(db: Db, firmId: string, caseId: string) {
  const [row] = await withFirm(db, firmId, (tx) =>
    tx
      .select({ r: leaseReviews, title: documents.title })
      .from(leaseReviews)
      .innerJoin(documents, eq(documents.id, leaseReviews.documentId))
      .where(eq(leaseReviews.caseId, caseId))
      .orderBy(desc(leaseReviews.createdAt))
      .limit(1),
  );
  return row ? view(row.r, row.title) : null;
}

async function draft(db: Db, firmId: string, reviewId: string) {
  const [row] = await withFirm(db, firmId, (tx) =>
    tx
      .select({ r: leaseReviews, title: documents.title, requirementKey: documents.requirementKey })
      .from(leaseReviews)
      .innerJoin(documents, eq(documents.id, leaseReviews.documentId))
      .where(eq(leaseReviews.id, reviewId))
      .limit(1),
  );
  if (!row) throw new AppError("not_found", "Lease review not found", "leaseReviewNotFound");
  if (row.r.status !== "draft") {
    throw new AppError(
      "conflict",
      "This lease review has been approved and can no longer change",
      "leaseReviewApproved",
    );
  }
  return row;
}

/** The lawyer edits the report and the buyer's summary while the review is a draft. */
export async function updateLeaseReview(
  db: Db,
  input: {
    firm: FirmContext;
    reviewId: string;
    report?: string | undefined;
    buyerSummary?: string | undefined;
  },
) {
  const row = await draft(db, input.firm.firmId, input.reviewId);
  const [saved] = await withFirm(db, input.firm.firmId, (tx) =>
    tx
      .update(leaseReviews)
      .set({
        ...(input.report !== undefined ? { report: input.report } : {}),
        ...(input.buyerSummary !== undefined ? { buyerSummary: input.buyerSummary } : {}),
        updatedAt: new Date(),
      })
      .where(eq(leaseReviews.id, input.reviewId))
      .returning(),
  );
  return view(saved!, row.title);
}

/**
 * The lawyer approves the buyer's summary. Kleidi Assist translates it into the portal's other
 * languages, and the buyer then sees it in their own language.
 */
export async function approveLeaseReview(
  db: Db,
  assist: Assist | undefined,
  input: { firm: FirmContext; actor: Actor; reviewId: string },
) {
  if (!assist) {
    throw new AppError("unavailable", "Kleidi Assist is not switched on", "assistUnavailable");
  }
  const firmId = input.firm.firmId;
  const row = await draft(db, firmId, input.reviewId);
  const { translations } = await assist.translate({
    text: row.r.buyerSummary,
    to: [...TRANSLATE_TO],
  });
  return withFirm(db, firmId, async (tx) => {
    const [saved] = await tx
      .update(leaseReviews)
      .set({
        status: "approved",
        translations,
        approvedById: input.actor.userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(leaseReviews.id, input.reviewId))
      .returning();
    const event: LeaseReviewApproved = {
      type: "documents.LeaseReviewApproved",
      firmId,
      actorUserId: input.actor.userId,
      payload: {
        entityType: "case",
        entityId: row.r.caseId,
        documentId: row.r.documentId,
        requirementKey: row.requirementKey,
        title: row.title,
        reviewId: row.r.id,
      },
    };
    await publishEvents(tx, [event]);
    return view(saved!, row.title);
  });
}

/** The approved lease summary for the buyer's portal, in their language when there is a translation. */
export async function getClientLeaseSummary(
  db: Db,
  firmId: string,
  caseId: string,
  locale: string,
) {
  const [row] = await withFirm(db, firmId, (tx) =>
    tx
      .select()
      .from(leaseReviews)
      .where(and(eq(leaseReviews.caseId, caseId), eq(leaseReviews.status, "approved")))
      .orderBy(desc(leaseReviews.approvedAt))
      .limit(1),
  );
  if (!row) return null;
  const translated = row.translations?.[locale];
  return {
    markdown: translated ?? row.buyerSummary,
    locale: translated ? locale : "en",
    approvedAt: row.approvedAt,
  };
}
