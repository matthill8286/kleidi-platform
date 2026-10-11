export type Role = "firm_admin" | "lawyer" | "staff";

export type Me = {
  user: { id: string; name: string; email: string; locale: string; twoFactorEnabled: boolean };
  firms: { id: string; name: string; slug: string; role: Role }[];
};

export type Team = {
  members: { userId: string; name: string; email: string; role: Role; joinedAt: string }[];
  invitations: { id: string; email: string; role: Role; expiresAt: string }[];
};

export type InvitationPreview = {
  firmName: string;
  email: string;
  role: Role;
  state: "pending" | "accepted" | "expired";
};

/** An RFC 9457 problem from the API, with its stable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const FIRM_KEY = "kleidi.firm";
let activeFirm: string | null = (() => {
  try {
    return localStorage.getItem(FIRM_KEY);
  } catch {
    return null;
  }
})();

export const getActiveFirm = () => activeFirm;
export function setActiveFirm(id: string | null) {
  activeFirm = id;
  try {
    if (id) localStorage.setItem(FIRM_KEY, id);
    else localStorage.removeItem(FIRM_KEY);
  } catch {
    // Storage can be blocked; the choice just won't survive a reload.
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(activeFirm ? { "x-kleidi-firm": activeFirm } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as { code?: string; title?: string };
    throw new ApiError(res.status, problem.code ?? "error", problem.title ?? res.statusText);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  me: () => request<Me>("GET", "/api/v1/me"),
  createFirm: (name: string) =>
    request<{ id: string; name: string }>("POST", "/api/v1/firms", { name }),
  team: () => request<Team>("GET", "/api/v1/team"),
  invite: (email: string, role: Role) =>
    request<Team["invitations"][number]>("POST", "/api/v1/team/invitations", { email, role }),
  previewInvitation: (token: string) =>
    request<InvitationPreview>("GET", `/api/v1/invitations/${encodeURIComponent(token)}`),
  acceptInvitation: (token: string) =>
    request<{ firmId: string; role: Role }>(
      "POST",
      `/api/v1/invitations/${encodeURIComponent(token)}/accept`,
    ),
};
