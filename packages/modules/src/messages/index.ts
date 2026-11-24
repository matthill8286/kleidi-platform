import { asc, eq } from "drizzle-orm";
import { publishEvents, withFirm, type Db, type Tx } from "@kleidi/db";
import { caseMessages } from "@kleidi/db/schema/messages";
import { AppError, type DomainEvent } from "@kleidi/kernel";
import { findCase, findPartiesByIds } from "../cases/index.ts";
import type { Actor, FirmContext } from "../firms/index.ts";
import { findUsersByIds } from "../identity/index.ts";

export const MAX_MESSAGE_LENGTH = 4000;

// The body stays out of the event, so the audit trail records that a message was sent, not what it said.
export type MessagePosted = DomainEvent<
  "messages.MessagePosted",
  {
    entityType: "case";
    entityId: string;
    messageId: string;
    from: "firm" | "client";
    client?: string;
  }
>;

function cleanBody(body: string): string {
  const text = body.trim();
  if (!text) throw new AppError("invalid", "Write a message first", "messageEmpty");
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new AppError("invalid", "This message is too long", "messageTooLong", {
      max: MAX_MESSAGE_LENGTH,
    });
  }
  return text;
}

async function caseOrThrow(tx: Tx, caseId: string) {
  const c = await findCase(tx, caseId);
  if (!c) throw new AppError("not_found", "Case not found", "caseNotFound");
  return c;
}

/** The case thread, oldest first, with each author's name and side. */
export async function listMessages(db: Db, firmId: string, caseId: string) {
  return withFirm(db, firmId, async (tx) => {
    await caseOrThrow(tx, caseId);
    const rows = await tx
      .select()
      .from(caseMessages)
      .where(eq(caseMessages.caseId, caseId))
      .orderBy(asc(caseMessages.createdAt));
    const users = new Map(
      (
        await findUsersByIds(tx, [...new Set(rows.flatMap((r) => (r.userId ? [r.userId] : [])))])
      ).map((u) => [u.id, u.name]),
    );
    const parties = new Map(
      (
        await findPartiesByIds(tx, [
          ...new Set(rows.flatMap((r) => (r.partyId ? [r.partyId] : []))),
        ])
      ).map((p) => [p.id, p.fullName]),
    );
    return rows.map((r) => ({
      id: r.id,
      body: r.body,
      author: r.userId
        ? { kind: "firm" as const, name: users.get(r.userId) ?? "" }
        : { kind: "client" as const, name: parties.get(r.partyId ?? "") ?? "" },
      createdAt: r.createdAt,
    }));
  });
}

async function post(
  db: Db,
  firmId: string,
  caseId: string,
  author: { userId: string; name: string } | { partyId: string; name: string },
  body: string,
) {
  const text = cleanBody(body);
  return withFirm(db, firmId, async (tx) => {
    await caseOrThrow(tx, caseId);
    const fromFirm = "userId" in author;
    const [row] = await tx
      .insert(caseMessages)
      .values({
        firmId,
        caseId,
        userId: fromFirm ? author.userId : null,
        partyId: fromFirm ? null : author.partyId,
        body: text,
      })
      .returning();
    const event: MessagePosted = {
      type: "messages.MessagePosted",
      firmId,
      actorUserId: fromFirm ? author.userId : null,
      payload: {
        entityType: "case",
        entityId: caseId,
        messageId: row!.id,
        from: fromFirm ? "firm" : "client",
        ...(fromFirm ? {} : { client: author.name }),
      },
    };
    await publishEvents(tx, [event]);
    return {
      id: row!.id,
      body: row!.body,
      author: { kind: fromFirm ? ("firm" as const) : ("client" as const), name: author.name },
      createdAt: row!.createdAt,
    };
  });
}

/** A lawyer or staff member writes to the case's clients. */
export function postFirmMessage(
  db: Db,
  input: { firm: FirmContext; actor: Actor; caseId: string; body: string },
) {
  return post(
    db,
    input.firm.firmId,
    input.caseId,
    { userId: input.actor.userId, name: input.actor.name },
    input.body,
  );
}

/** A client writes to the firm from the portal. */
export function postClientMessage(
  db: Db,
  input: { firmId: string; caseId: string; partyId: string; partyName: string; body: string },
) {
  return post(
    db,
    input.firmId,
    input.caseId,
    { partyId: input.partyId, name: input.partyName },
    input.body,
  );
}
