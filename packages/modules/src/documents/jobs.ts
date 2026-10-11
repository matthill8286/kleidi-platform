import { and, isNotNull, lte } from "drizzle-orm";
import { withFirm, type Db } from "@kleidi/db";
import { documents } from "@kleidi/db/schema/documents";
import { listFirmIds } from "../firms/index.ts";
import { EXPIRY_WARNING_DAYS, expiryStatus } from "./expiry.ts";

/** Counts documents expiring or expired per firm. Lawyer alerts are wired in milestone 3. */
export async function summariseExpiringDocuments(db: Db, today = new Date()) {
  const horizon = new Date(today.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const summary: { firmId: string; expiring: number; expired: number }[] = [];
  for (const firmId of await listFirmIds(db)) {
    const docs = await withFirm(db, firmId, (tx) =>
      tx
        .select({ expiresOn: documents.expiresOn })
        .from(documents)
        .where(and(isNotNull(documents.expiresOn), lte(documents.expiresOn, horizon))),
    );
    const statuses = docs.map((d) => expiryStatus(d.expiresOn, today));
    const expiring = statuses.filter((s) => s === "expiring").length;
    const expired = statuses.filter((s) => s === "expired").length;
    if (expiring || expired) summary.push({ firmId, expiring, expired });
  }
  return summary;
}
