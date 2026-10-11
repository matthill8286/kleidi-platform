import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, schema, withFirm } from "../src/index.ts";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;

// Integration suite: needs the local Postgres from docker compose, migrated and seeded.
describe.skipIf(!adminUrl || !appUrl)("row-level security", () => {
  const admin = createDb(adminUrl!, { max: 1 });
  const app = createDb(appUrl!, { max: 2 });
  const firmA = randomUUID();
  const firmB = randomUUID();

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    await admin.db.insert(schema.firms).values([
      { id: firmA, name: "Firm A", slug: `firm-a-${suffix}`, jurisdictionCode: "CY" },
      { id: firmB, name: "Firm B", slug: `firm-b-${suffix}`, jurisdictionCode: "CY" },
    ]);
    await admin.db.insert(schema.cases).values([
      { firmId: firmA, jurisdictionCode: "CY", reference: "A-1", currentStageKey: "reservation" },
      { firmId: firmB, jurisdictionCode: "CY", reference: "B-1", currentStageKey: "reservation" },
    ]);
  });

  // Test firms are left in place: their audit rows are append-only by design.
  afterAll(async () => {
    await Promise.all([admin.close(), app.close()]);
  });

  it("enables a firm_isolation policy on every firm-scoped table", async () => {
    const rows = await admin.db.$client<{ tablename: string }[]>`
      select tablename from pg_policies where policyname = 'firm_isolation'`;
    expect(rows.map((r) => r.tablename).sort()).toEqual([...schema.FIRM_SCOPED_TABLES].sort());
  });

  it("shows a firm only its own cases", async () => {
    const seen = await withFirm(app.db, firmA, (tx) => tx.select().from(schema.cases));
    expect(seen.map((c) => c.reference)).toEqual(["A-1"]);
  });

  it("shows nothing when no firm is set", async () => {
    const seen = await app.db.select().from(schema.cases);
    expect(seen).toEqual([]);
  });

  it("rejects writing a row for another firm", async () => {
    await expect(
      withFirm(app.db, firmA, (tx) =>
        tx.insert(schema.cases).values({
          firmId: firmB,
          jurisdictionCode: "CY",
          reference: "A-sneaky",
          currentStageKey: "reservation",
        }),
      ),
    ).rejects.toThrow();
  });

  it("keeps the audit trail append-only", async () => {
    const [event] = await withFirm(app.db, firmA, (tx) =>
      tx
        .insert(schema.auditEvents)
        .values({ firmId: firmA, action: "case.viewed", entityType: "case" })
        .returning(),
    );
    await expect(
      withFirm(app.db, firmA, (tx) =>
        tx
          .update(schema.auditEvents)
          .set({ action: "tampered" })
          .where(eq(schema.auditEvents.id, event!.id)),
      ),
    ).rejects.toThrow();
  });
});
