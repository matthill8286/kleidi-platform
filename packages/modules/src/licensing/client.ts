import { AppError, systemClock, type Clock } from "@kleidi/kernel";
import type { Licence } from "./domain.ts";

/** How long an answer is used before asking again. */
export const FRESH_MS = 5 * 60 * 1000;
/** How long "no licence" is believed, so a licence bound by an operator takes effect quickly. */
export const FRESH_MISSING_MS = 60 * 1000;
/** How long the last answer is used while the account service cannot be reached. */
export const STALE_MS = 24 * 60 * 60 * 1000;

export interface Licensing {
  /** False when licences are not checked, as in local development. */
  readonly enabled: boolean;
  /** The licence covering a firm, or null when none does. Cached for a few minutes. */
  forFirm(firmId: string): Promise<Licence | null>;
  /** A licence by its id, read fresh, or null. Used before the firm exists. */
  byId(id: string): Promise<Licence | null>;
  /** Records the firm a licence covers. It is set once, and the same firm again changes nothing. */
  bind(id: string, firmId: string): Promise<Licence>;
}

const OPEN: Licence = {
  id: "open",
  plan: "open",
  status: "active",
  seats: null,
  limits: {},
  endsAt: null,
  graceEndsAt: null,
  readOnlyEndsAt: null,
  tenant: null,
  owners: [],
};

/** Licences are not checked: every firm may do everything. For local development and tests. */
export const openLicensing: Licensing = {
  enabled: false,
  forFirm: async (firmId) => ({ ...OPEN, tenant: firmId }),
  byId: async () => null,
  bind: async (_id, firmId) => ({ ...OPEN, tenant: firmId }),
};

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type LicensingConfig = {
  /** The account service's address on the private network, such as http://account:5090. */
  url: string;
  /** Kleidi's service token there. */
  token: string;
  fetch?: Fetch;
  clock?: Clock;
  timeoutMs?: number;
};

const unavailable = () =>
  new AppError(
    "unavailable",
    "Kleidi cannot check this firm's licence right now. Try again shortly.",
    "licenceUnavailable",
  );

/**
 * Reads licences from the Impakt account service. An answer is kept for five minutes. If the
 * account service cannot be reached, the last answer is used for up to a day, so its outage
 * does not lock a firm out. A firm it has never answered for is refused until it does.
 */
export function createLicensing(config: LicensingConfig): Licensing {
  const base = config.url.replace(/\/$/, "");
  const clock = config.clock ?? systemClock;
  const doFetch: Fetch = config.fetch ?? ((url, init) => fetch(url, init));
  const cache = new Map<string, { licence: Licence | null; at: number }>();

  async function call(path: string, body?: unknown) {
    const res = await doFetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${config.token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(config.timeoutMs ?? 5000),
    });
    const json = (await res.json().catch(() => ({}))) as { licence?: Licence; code?: string };
    return { status: res.status, licence: json.licence ?? null, code: json.code };
  }

  /** The licence, null for 404, or a thrown error for anything that is not an answer. */
  async function read(path: string): Promise<Licence | null> {
    const r = await call(path);
    if (r.status === 404) return null;
    if (r.status !== 200 || !r.licence) throw new Error(`Account service answered ${r.status}`);
    return r.licence;
  }

  return {
    enabled: true,
    async forFirm(firmId) {
      const now = clock.now().getTime();
      const cached = cache.get(firmId);
      if (cached && now - cached.at < (cached.licence ? FRESH_MS : FRESH_MISSING_MS)) {
        return cached.licence;
      }
      try {
        const licence = await read(`/internal/licences?tenant=${encodeURIComponent(firmId)}`);
        cache.set(firmId, { licence, at: now });
        return licence;
      } catch {
        if (cached && now - cached.at < STALE_MS) return cached.licence;
        throw unavailable();
      }
    },
    async byId(id) {
      try {
        return await read(`/internal/licences/${encodeURIComponent(id)}`);
      } catch {
        throw unavailable();
      }
    },
    async bind(id, firmId) {
      let r: Awaited<ReturnType<typeof call>>;
      try {
        r = await call(`/internal/licences/${encodeURIComponent(id)}/tenant`, { tenant: firmId });
      } catch {
        throw unavailable();
      }
      if (r.status === 409 || r.status === 404) {
        throw new AppError(
          "conflict",
          "This licence has already been used to set up a firm",
          "licenceUsed",
        );
      }
      if (r.status !== 200 || !r.licence) throw unavailable();
      cache.set(firmId, { licence: r.licence, at: clock.now().getTime() });
      return r.licence;
    },
  };
}
