import { AppError } from "@kleidi/kernel";
import type { Licensing } from "./client.ts";
import { accessFor, setUpRefusal, type Licence, type SetUpRefusal } from "./domain.ts";

/**
 * Refuses a request the firm's licence does not allow: any request when the firm cannot be
 * used, and any change when it can only be read. Returns the licence otherwise.
 */
export async function requireLicence(
  licensing: Licensing,
  firmId: string,
  write: boolean,
): Promise<Licence | null> {
  const licence = await licensing.forFirm(firmId);
  const access = accessFor(licence);
  if (access === "none") {
    throw new AppError(
      "forbidden",
      "This firm's Kleidi licence is not active. Contact us to renew it.",
      "licenceInactive",
    );
  }
  if (access === "read" && write) {
    throw new AppError(
      "forbidden",
      "This firm's Kleidi licence has ended, so nothing can be changed. Contact us to renew it.",
      "licenceReadOnly",
    );
  }
  return licence;
}

const SET_UP_MESSAGES: Record<SetUpRefusal, string> = {
  licenceNotFound: "That licence was not found. Use the link we sent you.",
  licenceUsed: "This licence has already been used to set up a firm",
  licenceNotActive: "This licence is not active. Contact us.",
  licenceNotYours: "This licence was issued to another email address. Sign in with that address.",
};

/** The licence a person is setting a firm up under, or a refusal that says why they may not. */
export async function licenceToSetUp(
  licensing: Licensing,
  licenceId: string | undefined,
  email: string,
): Promise<Licence> {
  const licence = licenceId ? await licensing.byId(licenceId) : null;
  const refusal = setUpRefusal(licence, email);
  if (refusal) throw new AppError("forbidden", SET_UP_MESSAGES[refusal], refusal);
  return licence!;
}

/** Whether this address may make a Kleidi account because a licence names it and awaits its firm. */
export async function mayStartLicence(
  licensing: Licensing,
  licenceId: string | undefined,
  email: string,
): Promise<boolean> {
  if (!licenceId || !/^[0-9a-f-]{36}$/i.test(licenceId)) return false;
  return setUpRefusal(await licensing.byId(licenceId), email) === null;
}
