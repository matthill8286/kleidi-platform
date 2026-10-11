import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@kleidi/db";
import { createAuth } from "@kleidi/modules/identity";
import { buildApp } from "../src/app.ts";
import {
  client,
  enrolledUser,
  TEST_PASSWORD,
  TEST_SECRET,
  uniqueEmail,
  WEB_ORIGIN,
  testStore,
} from "./helpers.ts";

// Integration: the full identity and firm journey against the local Postgres.
describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_ADMIN_URL)(
  "identity and firms",
  () => {
    const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 4 });
    const admin = createDb(process.env.DATABASE_ADMIN_URL ?? "", { max: 1 });
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
      await Promise.all([close(), admin.close()]);
    });

    it("rejects calls without a session", async () => {
      const res = await client(app).get("/api/v1/me");
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("unauthenticated");
    });

    it("blocks firm actions until two-factor sign-in is set up", async () => {
      const c = client(app);
      await c.post("/api/auth/sign-up/email", {
        name: "New Lawyer",
        email: uniqueEmail("new"),
        password: TEST_PASSWORD,
      });
      const me = await c.get("/api/v1/me");
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({ user: { twoFactorEnabled: false }, firms: [] });
      const firm = await c.post("/api/v1/firms", { name: "Too Early & Co" });
      expect(firm.statusCode).toBe(403);
      expect(firm.json().code).toBe("two_factor_required");
    });

    it("rejects short passwords", async () => {
      const res = await client(app).post("/api/auth/sign-up/email", {
        name: "Short",
        email: uniqueEmail("short"),
        password: "short",
      });
      expect(res.statusCode).toBe(400);
    });

    it("creates a firm, invites a colleague and lets them join", async () => {
      const owner = await enrolledUser(app, "Elena Christou");
      const created = await owner.c.post("/api/v1/firms", { name: "Christou & Co" });
      expect(created.statusCode).toBe(201);
      const firmId = created.json().id as string;
      owner.c.useFirm(firmId);

      const me = (await owner.c.get("/api/v1/me")).json();
      expect(me.firms).toEqual([expect.objectContaining({ id: firmId, role: "firm_admin" })]);

      const colleagueEmail = uniqueEmail("andreas");
      const invite = await owner.c.post("/api/v1/team/invitations", {
        email: colleagueEmail.toUpperCase(),
        role: "lawyer",
      });
      expect(invite.statusCode).toBe(201);
      expect(invite.json().email).toBe(colleagueEmail);

      // The raw token travels only in the outbox event that the notifications module emails.
      const [event] = await admin.db
        .select()
        .from(schema.outbox)
        .where(eq(schema.outbox.type, "firms.MemberInvited"))
        .orderBy(desc(schema.outbox.occurredAt))
        .limit(1);
      const token = (event!.payload as { token: string }).token;
      const [stored] = await admin.db
        .select()
        .from(schema.firmInvitations)
        .where(eq(schema.firmInvitations.id, invite.json().id));
      expect(stored!.tokenHash).not.toBe(token);

      const preview = await client(app).get(`/api/v1/invitations/${token}`);
      expect(preview.json()).toMatchObject({
        firmName: "Christou & Co",
        email: colleagueEmail,
        state: "pending",
      });

      const stranger = await enrolledUser(app, "Someone Else");
      const wrongPerson = await stranger.c.post(`/api/v1/invitations/${token}/accept`);
      expect(wrongPerson.statusCode).toBe(403);

      const colleague = await enrolledUser(app, "Andreas Christou", colleagueEmail);
      const accepted = await colleague.c.post(`/api/v1/invitations/${token}/accept`);
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toEqual({ firmId, role: "lawyer" });
      const again = await colleague.c.post(`/api/v1/invitations/${token}/accept`);
      expect(again.statusCode).toBe(409);

      const team = (await owner.c.get("/api/v1/team")).json();
      expect(team.members.map((m: { email: string }) => m.email).sort()).toEqual(
        [colleagueEmail, owner.email].sort(),
      );
      expect(team.invitations).toEqual([]);

      colleague.c.useFirm(firmId);
      const notAdmin = await colleague.c.post("/api/v1/team/invitations", {
        email: uniqueEmail("x"),
        role: "staff",
      });
      expect(notAdmin.statusCode).toBe(403);

      stranger.c.useFirm(firmId);
      const outsider = await stranger.c.get("/api/v1/team");
      expect(outsider.statusCode).toBe(403);
    });
  },
);
