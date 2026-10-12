import { describe, expect, it } from "vitest";
import {
  codeMatches,
  codeProblem,
  hashSecret,
  linkProblem,
  maskPhone,
  MAX_CODE_ATTEMPTS,
  newCode,
  shouldSendCode,
} from "./domain.ts";

const now = new Date("2026-10-12T10:00:00Z");
const minutes = (m: number) => new Date(now.getTime() + m * 60_000);
const link = {
  expiresAt: minutes(60),
  usedAt: null,
  codeHash: null,
  codeExpiresAt: null,
  codeAttempts: 0,
  codesSent: 0,
};

describe("portal sign-in rules", () => {
  it("makes six-digit codes and checks them by hash", () => {
    const code = newCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(codeMatches(code, hashSecret(code))).toBe(true);
    expect(codeMatches("000000", hashSecret("111111"))).toBe(false);
  });

  it("refuses used and expired links", () => {
    expect(linkProblem(link, now)).toBeNull();
    expect(linkProblem({ ...link, usedAt: now }, now)).toBe("linkUsed");
    expect(linkProblem({ ...link, expiresAt: minutes(-1) }, now)).toBe("linkExpired");
  });

  it("texts a code once, then only on request and not too often", () => {
    expect(shouldSendCode(link, now, false)).toBe("send");
    const sent = { ...link, codeHash: "h", codeExpiresAt: minutes(10), codesSent: 1 };
    expect(shouldSendCode(sent, now, false)).toBe("keep");
    expect(shouldSendCode(sent, now, true)).toBe("wait");
    expect(shouldSendCode(sent, minutes(1), true)).toBe("send");
    expect(shouldSendCode({ ...sent, codesSent: 5 }, minutes(1), true)).toBe("limit");
  });

  it("stops checking codes after too many attempts or once expired", () => {
    const sent = { ...link, codeHash: "h", codeExpiresAt: minutes(10) };
    expect(codeProblem(link, now)).toBe("codeNotSent");
    expect(codeProblem(sent, now)).toBeNull();
    expect(codeProblem({ ...sent, codeAttempts: MAX_CODE_ATTEMPTS }, now)).toBe("tooManyAttempts");
    expect(codeProblem(sent, minutes(11))).toBe("codeExpired");
  });

  it("masks the phone number", () => {
    expect(maskPhone("+35799123456")).toBe("+357 ••••• 456");
  });
});
