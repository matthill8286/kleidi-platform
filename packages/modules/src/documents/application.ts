import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { handleOnce, publishEvents, withFirm, type Db, type Tx } from "@kleidi/db";
import { documents, documentVersions } from "@kleidi/db/schema/documents";
import { AppError, systemClock, type Clock, type StoredEvent } from "@kleidi/kernel";
import { findCase } from "../cases/index.ts";
import type { Actor, FirmContext } from "../firms/index.ts";
import { listFirmIds } from "../firms/index.ts";
import { findUsersByIds } from "../identity/index.ts";
import { getTemplate } from "../jurisdictions/index.ts";
import {
  defaultExpiry,
  itemState,
  needsAttention,
  quarantineKey,
  releasedKey,
  sortChecklist,
  uploadProblem,
  type ScanStatus,
} from "./domain.ts";
import type {
  DocumentUpdated,
  ExpiryFlagged,
  VersionQuarantined,
  VersionReleased,
  VersionUploaded,
} from "./events.ts";
import { expiryStatus } from "./expiry.ts";
import type { Scanner } from "./scanner.ts";
import type { ObjectStore } from "./storage.ts";

export const SCANNER_CONSUMER = "scanner";
const UPLOAD_LINK_SECONDS = 15 * 60;
const DOWNLOAD_LINK_SECONDS = 5 * 60;

export type UploadTarget = { requirementKey: string } | { documentId: string } | { title: string };

async function caseOrThrow(tx: Tx, caseId: string) {
  const c = await findCase(tx, caseId);
  if (!c) throw new AppError("not_found", "Case not found", "caseNotFound");
  return c;
}

async function requirementFor(db: Db, jurisdiction: string, key: string) {
  const template = await getTemplate(db, jurisdiction);
  const requirement = template.requirements.find((r) => r.key === key);
  if (!requirement)
    throw new AppError("invalid", `Unknown checklist item ${key}`, "unknownRequirement");
  return requirement;
}

/** Finds or creates the document this upload belongs to, locked for the version bump. */
async function targetDocument(
  db: Db,
  tx: Tx,
  firmId: string,
  caseId: string,
  jurisdiction: string,
  target: UploadTarget,
) {
  if ("documentId" in target) {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, target.documentId), eq(documents.caseId, caseId)))
      .for("update");
    if (!doc) throw new AppError("not_found", "Document not found", "documentNotFound");
    return doc;
  }
  if ("requirementKey" in target) {
    const requirement = await requirementFor(db, jurisdiction, target.requirementKey);
    await tx
      .insert(documents)
      .values({ firmId, caseId, requirementKey: requirement.key, title: requirement.label.en })
      .onConflictDoNothing();
    const [doc] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.caseId, caseId), eq(documents.requirementKey, requirement.key)))
      .for("update");
    return doc!;
  }
  const title = target.title.trim();
  if (title.length < 2) throw new AppError("invalid", "Give the document a title", "documentTitle");
  const [doc] = await tx.insert(documents).values({ firmId, caseId, title }).returning();
  return doc!;
}

/**
 * Step 1 of an upload: records a new version and returns a short-lived link that lets the
 * browser put the file straight into quarantine storage. The API never handles the bytes.
 */
export async function requestUpload(
  db: Db,
  store: ObjectStore,
  input: {
    firm: FirmContext;
    actor: Actor;
    caseId: string;
    target: UploadTarget;
    fileName: string;
    mimeType: string;
    byteSize: number;
  },
) {
  const problem = uploadProblem(input);
  if (problem) throw AppError.from("invalid", problem);

  const created = await withFirm(db, input.firm.firmId, async (tx) => {
    const c = await caseOrThrow(tx, input.caseId);
    if (c.status === "cancelled")
      throw new AppError(
        "invalid",
        "A cancelled case cannot take documents",
        "caseCancelledDocuments",
      );
    const doc = await targetDocument(
      db,
      tx,
      input.firm.firmId,
      c.id,
      c.jurisdictionCode,
      input.target,
    );
    const version = doc.latestVersion + 1;
    await tx.update(documents).set({ latestVersion: version }).where(eq(documents.id, doc.id));
    const versionId = crypto.randomUUID();
    const key = quarantineKey(input.firm.firmId, versionId);
    await tx.insert(documentVersions).values({
      id: versionId,
      firmId: input.firm.firmId,
      documentId: doc.id,
      version,
      fileName: input.fileName.trim(),
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      objectKey: key,
      uploadedById: input.actor.userId,
    });
    return { documentId: doc.id, versionId, version, key };
  });

  const uploadUrl = await store.signUpload(
    created.key,
    input.mimeType,
    input.byteSize,
    UPLOAD_LINK_SECONDS,
  );
  return {
    documentId: created.documentId,
    versionId: created.versionId,
    version: created.version,
    uploadUrl,
    uploadHeaders: { "content-type": input.mimeType },
  };
}

/** Step 2: the browser says the file is up. It is checked for size and queued for scanning. */
export async function completeUpload(
  db: Db,
  store: ObjectStore,
  input: {
    firm: FirmContext;
    actor: Actor;
    versionId: string;
    expiresOn?: string | null | undefined;
  },
  clock: Clock = systemClock,
) {
  return withFirm(db, input.firm.firmId, async (tx) => {
    const [row] = await tx
      .select({ v: documentVersions, d: documents })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(eq(documentVersions.id, input.versionId))
      .for("update");
    if (!row) throw new AppError("not_found", "Upload not found", "uploadNotFound");
    const { v, d } = row;
    // Completing twice is harmless: the second call changes nothing.
    if (v.scanStatus !== "uploading")
      return { documentId: d.id, versionId: v.id, scanStatus: v.scanStatus };

    const size = await store.size(v.objectKey);
    if (size === null)
      throw new AppError(
        "invalid",
        "The file has not arrived yet. Try the upload again.",
        "fileNotArrived",
      );
    if (size !== v.byteSize) {
      await tx
        .update(documentVersions)
        .set({ scanStatus: "failed", scanDetail: "The stored file size does not match" })
        .where(eq(documentVersions.id, v.id));
      await store.remove(v.objectKey);
      return { documentId: d.id, versionId: v.id, scanStatus: "failed" as const };
    }

    let expiresOn = input.expiresOn;
    if (expiresOn === undefined) {
      const c = await caseOrThrow(tx, d.caseId);
      const requirement = d.requirementKey
        ? await requirementFor(db, c.jurisdictionCode, d.requirementKey)
        : null;
      expiresOn = defaultExpiry(requirement?.expiryDays ?? null, clock.now()) ?? d.expiresOn;
    }
    await tx
      .update(documentVersions)
      .set({ scanStatus: "pending" })
      .where(eq(documentVersions.id, v.id));
    await tx
      .update(documents)
      .set({ expiresOn, expiryFlag: null, updatedAt: clock.now() })
      .where(eq(documents.id, d.id));

    const uploaded: VersionUploaded = {
      type: "documents.VersionUploaded",
      firmId: input.firm.firmId,
      actorUserId: input.actor.userId,
      payload: {
        entityType: "case",
        entityId: d.caseId,
        documentId: d.id,
        requirementKey: d.requirementKey,
        title: d.title,
        versionId: v.id,
        version: v.version,
        fileName: v.fileName,
      },
    };
    await publishEvents(tx, [uploaded]);
    return { documentId: d.id, versionId: v.id, scanStatus: "pending" as const };
  });
}

/**
 * The scanner consumer. A clean file moves out of quarantine and becomes downloadable; an
 * infected one stays in quarantine for good. A scanner error throws, so the job retries.
 */
export async function scanUploadedVersion(
  db: Db,
  store: ObjectStore,
  scanner: Scanner,
  event: StoredEvent,
  clock: Clock = systemClock,
): Promise<boolean> {
  if (event.type !== "documents.VersionUploaded" || !event.firmId) return false;
  const payload = (event as unknown as VersionUploaded).payload;
  const firmId = event.firmId;

  return withFirm(db, firmId, (tx) =>
    handleOnce(tx, SCANNER_CONSUMER, event.id, async () => {
      const [v] = await tx
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.id, payload.versionId))
        .for("update");
      if (!v || v.scanStatus !== "pending") return;

      const target = releasedKey(firmId, payload.entityId, v.id, v.mimeType);
      // A retry after the move succeeded but the commit failed finds the file already released.
      const alreadyReleased =
        (await store.size(v.objectKey)) === null && (await store.size(target)) !== null;
      const result = alreadyReleased
        ? { clean: true as const }
        : await scanner.scan(await store.read(v.objectKey));
      const base = { firmId, actorUserId: null };

      if (result.clean) {
        if (!alreadyReleased) await store.move(v.objectKey, target);
        await tx
          .update(documentVersions)
          .set({ scanStatus: "clean", objectKey: target, scannedAt: clock.now(), scanDetail: null })
          .where(eq(documentVersions.id, v.id));
        const released: VersionReleased = { ...base, type: "documents.VersionReleased", payload };
        await publishEvents(tx, [released]);
      } else {
        await tx
          .update(documentVersions)
          .set({ scanStatus: "infected", scanDetail: result.signature, scannedAt: clock.now() })
          .where(eq(documentVersions.id, v.id));
        const quarantined: VersionQuarantined = {
          ...base,
          type: "documents.VersionQuarantined",
          payload: { ...payload, signature: result.signature },
        };
        await publishEvents(tx, [quarantined]);
      }
    }),
  );
}

/** A five-minute download link. Only scanned, clean files are ever handed out. */
export async function downloadLink(db: Db, store: ObjectStore, firmId: string, versionId: string) {
  const v = await withFirm(db, firmId, async (tx) => {
    const [row] = await tx
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, versionId))
      .limit(1);
    return row;
  });
  if (!v) throw new AppError("not_found", "Document not found", "documentNotFound");
  if (v.scanStatus === "infected")
    throw new AppError(
      "forbidden",
      "This file failed the virus scan and is quarantined",
      "fileQuarantined",
    );
  if (v.scanStatus !== "clean")
    throw new AppError("conflict", "This file is still being checked", "fileScanning");
  return { url: await store.signDownload(v.objectKey, v.fileName, DOWNLOAD_LINK_SECONDS) };
}

export async function updateDocument(
  db: Db,
  input: {
    firm: FirmContext;
    actor: Actor;
    documentId: string;
    visibility?: "client" | "firm" | undefined;
    expiresOn?: string | null | undefined;
  },
  clock: Clock = systemClock,
) {
  return withFirm(db, input.firm.firmId, async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, input.documentId))
      .for("update");
    if (!doc) throw new AppError("not_found", "Document not found", "documentNotFound");
    const changes = {
      ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
      ...(input.expiresOn === undefined ? {} : { expiresOn: input.expiresOn, expiryFlag: null }),
    };
    if (Object.keys(changes).length === 0) return;
    await tx
      .update(documents)
      .set({ ...changes, updatedAt: clock.now() })
      .where(eq(documents.id, doc.id));
    const updated: DocumentUpdated = {
      type: "documents.DocumentUpdated",
      firmId: input.firm.firmId,
      actorUserId: input.actor.userId,
      payload: {
        entityType: "case",
        entityId: doc.caseId,
        documentId: doc.id,
        requirementKey: doc.requirementKey,
        title: doc.title,
        ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
        ...(input.expiresOn === undefined ? {} : { expiresOn: input.expiresOn }),
      },
    };
    await publishEvents(tx, [updated]);
  });
}

type VersionRow = typeof documentVersions.$inferSelect;

/** The case's checklist, stage by stage with outstanding items first, plus ad-hoc documents. */
export async function listCaseDocuments(
  db: Db,
  firmId: string,
  caseId: string,
  clock: Clock = systemClock,
) {
  const today = clock.now();
  const { c, docs, versions } = await withFirm(db, firmId, async (tx) => {
    const c = await caseOrThrow(tx, caseId);
    const docs = await tx.select().from(documents).where(eq(documents.caseId, caseId));
    const versions = docs.length
      ? await tx
          .select()
          .from(documentVersions)
          .where(
            inArray(
              documentVersions.documentId,
              docs.map((d) => d.id),
            ),
          )
          .orderBy(desc(documentVersions.version))
      : [];
    return { c, docs, versions };
  });
  const template = await getTemplate(db, c.jurisdictionCode);
  const uploaders = new Map(
    (await findUsersByIds(db, [...new Set(versions.map((v) => v.uploadedById))])).map((u) => [
      u.id,
      u.name,
    ]),
  );

  const view = (d: (typeof docs)[number]) => {
    // Abandoned uploads never arrived, so they are not part of the history.
    const history = versions.filter((v) => v.documentId === d.id && v.scanStatus !== "uploading");
    const latest = history[0] ?? null;
    return {
      id: d.id,
      title: d.title,
      requirementKey: d.requirementKey,
      visibility: d.visibility,
      expiresOn: d.expiresOn,
      state: itemState(latest as { scanStatus: ScanStatus } | null, d.expiresOn, today),
      versions: history.map((v: VersionRow) => ({
        id: v.id,
        version: v.version,
        fileName: v.fileName,
        mimeType: v.mimeType,
        byteSize: v.byteSize,
        scanStatus: v.scanStatus,
        scanDetail: v.scanDetail,
        uploadedBy: uploaders.get(v.uploadedById) ?? null,
        createdAt: v.createdAt,
      })),
    };
  };

  const byRequirement = new Map(
    docs.filter((d) => d.requirementKey).map((d) => [d.requirementKey!, view(d)]),
  );
  const stageIndex = template.stages.findIndex((s) => s.key === c.currentStageKey);
  const stages = template.stages.map((s, i) => {
    const items = template.requirements
      .map((r, sortOrder) => ({ r, sortOrder }))
      .filter(({ r }) => r.stageKey === s.key)
      .map(({ r, sortOrder }) => {
        const document = byRequirement.get(r.key) ?? null;
        return {
          requirementKey: r.key,
          label: r.label,
          help: r.help,
          expiryDays: r.expiryDays,
          sortOrder,
          state: document?.state ?? ("missing" as const),
          document,
        };
      });
    return {
      key: s.key,
      label: s.label,
      position:
        i < stageIndex
          ? ("past" as const)
          : i === stageIndex
            ? ("current" as const)
            : ("future" as const),
      items: sortChecklist(items),
    };
  });
  const all = stages.flatMap((s) => s.items);
  return {
    stages,
    other: docs.filter((d) => !d.requirementKey).map(view),
    summary: {
      total: all.length,
      ready: all.filter((i) => i.state === "ready" || i.state === "expiring").length,
      attention: all.filter((i) => i.document && needsAttention(i.state) && i.state !== "missing")
        .length,
    },
  };
}

/**
 * Daily job: flags each document the day it becomes expiring or expired. The flag is kept
 * on the document, so a state is announced once and re-announced only after it changes.
 */
export async function flagExpiringDocuments(db: Db, clock: Clock = systemClock) {
  const today = clock.now();
  const summary: { firmId: string; expiring: number; expired: number }[] = [];
  for (const firmId of await listFirmIds(db)) {
    const counts = await withFirm(db, firmId, async (tx) => {
      const docs = await tx
        .select()
        .from(documents)
        .where(isNotNull(documents.expiresOn))
        .for("update");
      const counts = { expiring: 0, expired: 0 };
      const events: ExpiryFlagged[] = [];
      for (const d of docs) {
        const status = expiryStatus(d.expiresOn, today);
        const flag = status === "expiring" || status === "expired" ? status : null;
        if (flag) counts[flag]++;
        if (flag === d.expiryFlag) continue;
        await tx.update(documents).set({ expiryFlag: flag }).where(eq(documents.id, d.id));
        if (flag) {
          events.push({
            type: "documents.ExpiryFlagged",
            firmId,
            actorUserId: null,
            payload: {
              entityType: "case",
              entityId: d.caseId,
              documentId: d.id,
              requirementKey: d.requirementKey,
              title: d.title,
              state: flag,
              expiresOn: d.expiresOn!,
            },
          });
        }
      }
      await publishEvents(tx, events);
      return counts;
    });
    if (counts.expiring || counts.expired) summary.push({ firmId, ...counts });
  }
  return summary;
}
