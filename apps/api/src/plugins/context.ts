import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";
import { AppError } from "@kleidi/kernel";
import { getMembership, type Actor, type FirmContext } from "@kleidi/modules/firms";
import type { Auth } from "@kleidi/modules/identity";
import {
  isReadMethod,
  requireLicence,
  type Licence,
  type Licensing,
} from "@kleidi/modules/licensing";
import type { Db } from "@kleidi/db";

export const FIRM_HEADER = "x-kleidi-firm";

export type SessionUser = Actor & { twoFactorEnabled: boolean; locale: string };

/** Resolves who is calling and, when asked, which firm they act for. */
export function createContext(deps: { db: Db; auth: Auth; licensing: Licensing }) {
  async function currentUser(request: FastifyRequest): Promise<SessionUser | null> {
    const session = await deps.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) return null;
    const u = session.user as typeof session.user & {
      locale?: string;
      twoFactorEnabled?: boolean | null;
    };
    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      twoFactorEnabled: Boolean(u.twoFactorEnabled),
      locale: u.locale ?? "en",
    };
  }

  /** Firm users must have two-factor login switched on before they touch any firm data. */
  async function requireUser(
    request: FastifyRequest,
    options: { allowWithoutTwoFactor?: boolean } = {},
  ) {
    const user = await currentUser(request);
    if (!user) throw new AppError("unauthenticated", "Sign in to continue", "signIn");
    if (!user.twoFactorEnabled && !options.allowWithoutTwoFactor) {
      throw new AppError(
        "two_factor_required",
        "Set up two-factor sign-in to continue",
        "twoFactorRequired",
      );
    }
    return user;
  }

  /**
   * The caller's firm. The firm's licence is checked here, so every firm route refuses a firm
   * that cannot be used, and refuses changes to a firm that can only be read.
   */
  async function requireFirm(
    request: FastifyRequest,
  ): Promise<{ user: SessionUser; firm: FirmContext; licence: Licence | null }> {
    const user = await requireUser(request);
    const firmId = request.headers[FIRM_HEADER];
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof firmId !== "string" || !uuid.test(firmId)) {
      throw new AppError("invalid", `Send the firm id in the ${FIRM_HEADER} header`);
    }
    const role = await getMembership(deps.db, user.userId, firmId);
    if (!role) throw new AppError("forbidden", "You are not a member of this firm", "notMember");
    const licence = await requireLicence(deps.licensing, firmId, !isReadMethod(request.method));
    return { user, firm: { firmId, role }, licence };
  }

  return { currentUser, requireUser, requireFirm };
}

export type Context = ReturnType<typeof createContext>;
