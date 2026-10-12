import type { DomainEvent } from "@kleidi/kernel";
import type { Role } from "./domain.ts";

export type FirmCreated = DomainEvent<
  "firms.FirmCreated",
  { entityType: "firm"; entityId: string; name: string }
>;

/** Carries the raw token so the notifications module can email the link; only its hash is stored. */
export type MemberInvited = DomainEvent<
  "firms.MemberInvited",
  {
    entityType: "invitation";
    entityId: string;
    email: string;
    role: Role;
    token: string;
    firmName: string;
    inviterName: string;
    expiresAt: string;
  }
>;

export type MemberJoined = DomainEvent<
  "firms.MemberJoined",
  { entityType: "member"; entityId: string; role: Role }
>;

export type MemberRemoved = DomainEvent<
  "firms.MemberRemoved",
  { entityType: "member"; entityId: string; name: string; role: Role }
>;

export type FirmsEvent = FirmCreated | MemberInvited | MemberJoined | MemberRemoved;
