import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, relayOutbox } from "@kleidi/db";
import { recordAuditFromEvent } from "@kleidi/modules/audit";
import { createAuth } from "@kleidi/modules/identity";
import { buildApp } from "../src/app.ts";
import { enrolledUser, TEST_SECRET, WEB_ORIGIN, testStore } from "./helpers.ts";

const NEW_CASE = {
  propertyAddress: "12 Anexartisias, Limassol 3036",
  plotOrRegNo: "0/12345",
  propertyType: "resale",
  parties: [
    { role: "buyer", fullName: "Anna Petrova", email: "anna@example.test" },
    { role: "seller", fullName: "Giorgos Ioannou" },
  ],
};

// Integration: the case journey against the local Postgres, including the audit trail.
describe.skipIf(!process.env.DATABASE_URL)("cases", () => {
  const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 4 });
  let app: FastifyInstance;

  beforeAll(async () => {
    const auth = createAuth({
      db,
      baseURL: WEB_ORIGIN,
      secret: TEST_SECRET,
      trustedOrigins: [WEB_ORIGIN],
    });
    app = await buildApp({ db, auth, webOrigin: WEB_ORIGIN, store: testStore() });
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  async function lawyerWithFirm(name: string) {
    const { c } = await enrolledUser(app, name);
    const firm = await c.post("/api/v1/firms", { name: `${name} Law` });
    c.useFirm(firm.json().id);
    return c;
  }

  it("takes a case through every Cyprus stage with a full audit trail", async () => {
    const c = await lawyerWithFirm("Stage Walker");
    const opened = await c.post("/api/v1/cases", NEW_CASE, { "idempotency-key": randomUUID() });
    expect(opened.statusCode).toBe(201);
    const created = opened.json();
    expect(created.reference).toMatch(/^CY-\d{4}-001$/);
    expect(created.currentStageKey).toBe("reservation");
    expect(created.parties).toHaveLength(2);
    expect(created.stages).toHaveLength(8);
    expect(opened.headers.etag).toBe('"v1"');

    let etag = opened.headers.etag as string;
    for (let i = 1; i < created.stages.length; i++) {
      const moved = await c.post(
        `/api/v1/cases/${created.id}/transitions`,
        { kind: "advance" },
        { "if-match": etag },
      );
      expect(moved.statusCode).toBe(200);
      expect(moved.json().currentStageKey).toBe(created.stages[i].key);
      etag = moved.headers.etag as string;
    }
    const done = await c.get(`/api/v1/cases/${created.id}`);
    expect(done.json()).toMatchObject({
      status: "completed",
      currentStageKey: "completed",
      version: 8,
    });
    expect(done.json().history).toHaveLength(8);
    expect(done.json().closedAt).not.toBeNull();

    // A second case gets the next reference in the same firm.
    const second = await c.post("/api/v1/cases", NEW_CASE);
    expect(second.json().reference).toMatch(/^CY-\d{4}-002$/);

    // The outbox carries every change to the audit trail. Another relay may be running, so poll.
    let activity: { action: string; actorName: string }[] = [];
    for (let attempt = 0; attempt < 20 && activity.length < 9; attempt++) {
      await relayOutbox(db, async (event) => void (await recordAuditFromEvent(db, event)));
      activity = (await c.get(`/api/v1/cases/${created.id}/activity`)).json();
      if (activity.length < 9) await new Promise((r) => setTimeout(r, 100));
    }
    expect(activity.map((a) => a.action)).toEqual([
      "cases.CaseOpened",
      ...Array(7).fill("cases.StageChanged"),
      "cases.StatusChanged",
    ]);
    expect(activity[0]!.actorName).toBe("Stage Walker");
  });

  it("needs the current version to change a case", async () => {
    const c = await lawyerWithFirm("Version Keeper");
    const created = (await c.post("/api/v1/cases", NEW_CASE)).json();
    const url = `/api/v1/cases/${created.id}/transitions`;

    const missing = await c.post(url, { kind: "advance" });
    expect(missing.statusCode).toBe(428);
    const ok = await c.post(url, { kind: "advance" }, { "if-match": '"v1"' });
    expect(ok.statusCode).toBe(200);
    const stale = await c.post(url, { kind: "advance" }, { "if-match": '"v1"' });
    expect(stale.statusCode).toBe(412);
    expect(stale.json().code).toBe("precondition_failed");
  });

  it("explains rule breaks and keeps reasons for holds and step-backs", async () => {
    const c = await lawyerWithFirm("Rule Follower");
    const created = (await c.post("/api/v1/cases", NEW_CASE)).json();
    const url = `/api/v1/cases/${created.id}/transitions`;

    const noReason = await c.post(url, { kind: "hold", reason: "" }, { "if-match": '"v1"' });
    expect(noReason.statusCode).toBe(422);
    const held = await c.post(
      url,
      { kind: "hold", reason: "Buyer abroad until May" },
      { "if-match": '"v1"' },
    );
    expect(held.json()).toMatchObject({
      status: "on_hold",
      statusReason: "Buyer abroad until May",
    });
    const frozen = await c.post(url, { kind: "advance" }, { "if-match": '"v2"' });
    expect(frozen.statusCode).toBe(422);
    const resumed = await c.post(url, { kind: "resume" }, { "if-match": '"v2"' });
    expect(resumed.json()).toMatchObject({ status: "open", statusReason: null });
    await c.post(url, { kind: "advance" }, { "if-match": '"v3"' });
    const back = await c.post(
      url,
      { kind: "stepBack", reason: "Searches came back incomplete" },
      { "if-match": '"v4"' },
    );
    expect(back.json().currentStageKey).toBe("reservation");
  });

  it("replays a repeated request instead of opening a second case", async () => {
    const c = await lawyerWithFirm("Double Clicker");
    const key = randomUUID();
    const first = await c.post("/api/v1/cases", NEW_CASE, { "idempotency-key": key });
    const again = await c.post("/api/v1/cases", NEW_CASE, { "idempotency-key": key });
    expect(again.statusCode).toBe(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.json().id).toBe(first.json().id);
    expect((await c.get("/api/v1/cases")).json().items).toHaveLength(1);

    const different = await c.post(
      "/api/v1/cases",
      { ...NEW_CASE, propertyAddress: "Somewhere else, Paphos" },
      { "idempotency-key": key },
    );
    expect(different.statusCode).toBe(422);

    // A failed request frees its key, so the client can fix the input and retry.
    const retryKey = randomUUID();
    const bad = await c.post(
      "/api/v1/cases",
      { ...NEW_CASE, parties: [{ role: "seller", fullName: "Only Seller" }] },
      { "idempotency-key": retryKey },
    );
    expect(bad.statusCode).toBe(422);
    const fixed = await c.post("/api/v1/cases", NEW_CASE, { "idempotency-key": retryKey });
    expect(fixed.statusCode).toBe(201);
  });

  it("lists, searches and pages a firm's cases", async () => {
    const c = await lawyerWithFirm("Busy Practice");
    for (const town of ["Limassol", "Paphos", "Larnaca"]) {
      await c.post("/api/v1/cases", { ...NEW_CASE, propertyAddress: `1 Main Street, ${town}` });
    }
    const page1 = (await c.get("/api/v1/cases?limit=2")).json();
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].buyers).toEqual(["Anna Petrova"]);
    const page2 = (await c.get(`/api/v1/cases?limit=2&cursor=${page1.nextCursor}`)).json();
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    const found = (await c.get("/api/v1/cases?q=paphos")).json();
    expect(found.items.map((i: { propertyAddress: string }) => i.propertyAddress)).toEqual([
      "1 Main Street, Paphos",
    ]);
  });

  it("hides one firm's cases from another firm", async () => {
    const owner = await lawyerWithFirm("Private Firm");
    const created = (await owner.post("/api/v1/cases", NEW_CASE)).json();
    const outsider = await lawyerWithFirm("Nosy Firm");
    expect((await outsider.get(`/api/v1/cases/${created.id}`)).statusCode).toBe(404);
    expect((await outsider.get(`/api/v1/cases/${created.id}/activity`)).statusCode).toBe(404);
    const move = await outsider.post(
      `/api/v1/cases/${created.id}/transitions`,
      { kind: "advance" },
      { "if-match": '"v1"' },
    );
    expect(move.statusCode).toBe(404);
    expect((await outsider.get("/api/v1/cases")).json().items).toHaveLength(0);
  });
});
