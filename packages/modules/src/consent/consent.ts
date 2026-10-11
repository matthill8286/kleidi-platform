export type ConsentRecord = {
  granteeType: "agent" | "bank" | "insurer";
  granteeRef: string;
  scope: string;
  revokedAt: Date | null;
};

/** An agent, bank or insurer may see a case only while the buyer's consent is unrevoked. */
export function hasActiveConsent(
  consents: ConsentRecord[],
  grantee: { type: ConsentRecord["granteeType"]; ref: string },
  scope = "status",
): boolean {
  return consents.some(
    (c) =>
      c.granteeType === grantee.type &&
      c.granteeRef === grantee.ref &&
      c.scope === scope &&
      c.revokedAt === null,
  );
}
