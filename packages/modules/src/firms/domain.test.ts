import { describe, expect, it } from "vitest";
import {
  canManageTeam,
  hashToken,
  invitationExpiry,
  invitationState,
  newInvitationToken,
  normaliseEmail,
  slugify,
} from "./domain.ts";

describe("firms domain", () => {
  it("lets only firm admins manage the team", () => {
    expect(canManageTeam("firm_admin")).toBe(true);
    expect(canManageTeam("lawyer")).toBe(false);
    expect(canManageTeam("staff")).toBe(false);
  });

  it("normalises emails and slugs", () => {
    expect(normaliseEmail("  Elena@Christou.Example ")).toBe("elena@christou.example");
    expect(slugify("Christou & Co")).toBe("christou-co");
    expect(slugify("Χρήστου")).toBe("firm");
  });

  it("stores only a hash of the invitation token", () => {
    const { token, tokenHash } = newInvitationToken();
    expect(token).not.toEqual(tokenHash);
    expect(hashToken(token)).toEqual(tokenHash);
  });

  it("expires invitations after seven days", () => {
    const sent = new Date("2026-10-11T09:00:00Z");
    const expiresAt = invitationExpiry(sent);
    expect(invitationState({ expiresAt, acceptedAt: null }, new Date("2026-10-17T09:00:00Z"))).toBe(
      "pending",
    );
    expect(invitationState({ expiresAt, acceptedAt: null }, new Date("2026-10-18T09:00:00Z"))).toBe(
      "expired",
    );
    expect(invitationState({ expiresAt, acceptedAt: sent }, new Date("2026-10-20T09:00:00Z"))).toBe(
      "accepted",
    );
  });
});
