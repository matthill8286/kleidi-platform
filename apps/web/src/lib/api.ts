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

export type CaseStatus = "open" | "on_hold" | "completed" | "cancelled";
export type PropertyType = "resale" | "offplan" | "land";
export type PartyRole = "buyer" | "seller" | "developer" | "bank";
export type Localised = Record<string, string>;

export type CaseSummary = {
  id: string;
  reference: string;
  propertyAddress: string | null;
  propertyType: PropertyType | null;
  currentStageKey: string;
  status: CaseStatus;
  buyers: string[];
  createdAt: string;
  updatedAt: string;
};

export type Party = {
  id: string;
  role: PartyRole;
  fullName: string;
  email: string | null;
  phone: string | null;
};
export type PartyInput = { role: PartyRole; fullName: string; email?: string; phone?: string };

export type CaseDetail = Omit<CaseSummary, "buyers"> & {
  jurisdictionCode: string;
  plotOrRegNo: string | null;
  developerName: string | null;
  statusReason: string | null;
  version: number;
  assignedLawyer: { id: string; name: string } | null;
  parties: Party[];
  stages: { key: string; label: Localised }[];
  history: { stageKey: string; enteredAt: string; completedAt: string | null }[];
  closedAt: string | null;
};

export type Activity = {
  id: string;
  action: string;
  actorName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}[];

export type NewCase = {
  propertyAddress: string;
  plotOrRegNo?: string;
  propertyType: PropertyType;
  developerName?: string;
  parties: PartyInput[];
};

export type Transition =
  | { kind: "advance" }
  | { kind: "resume" }
  | { kind: "stepBack" | "hold" | "cancel"; reason: string };

export type ItemState =
  "missing" | "scanning" | "ready" | "infected" | "failed" | "expiring" | "expired";

export type DocumentView = {
  id: string;
  title: string;
  requirementKey: string | null;
  visibility: "client" | "firm";
  expiresOn: string | null;
  state: ItemState;
  versions: {
    id: string;
    version: number;
    fileName: string;
    mimeType: string;
    byteSize: number;
    scanStatus: "uploading" | "pending" | "clean" | "infected" | "failed";
    scanDetail: string | null;
    uploadedBy: string | null;
    createdAt: string;
  }[];
};

export type CaseDocuments = {
  stages: {
    key: string;
    label: Localised;
    position: "past" | "current" | "future";
    items: {
      requirementKey: string;
      label: Localised;
      help: Localised;
      expiryDays: number | null;
      state: ItemState;
      document: DocumentView | null;
    }[];
  }[];
  other: DocumentView[];
  summary: { total: number; ready: number; attention: number };
};

export type UploadTarget = { requirementKey: string } | { documentId: string } | { title: string };

/** An RFC 9457 problem from the API, with its stable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  // The translation key and values for the message, when the API sends them.
  readonly key: string | undefined;
  readonly params: Record<string, string | number> | undefined;
  constructor(
    status: number,
    code: string,
    message: string,
    key?: string,
    params?: Record<string, string | number>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.key = key;
    this.params = params;
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

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(activeFirm ? { "x-kleidi-firm": activeFirm } : {}),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as {
      code?: string;
      title?: string;
      messageKey?: string;
      params?: Record<string, string | number>;
    };
    throw new ApiError(
      res.status,
      problem.code ?? "error",
      problem.title ?? res.statusText,
      problem.messageKey,
      problem.params,
    );
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

// Writes carry an Idempotency-Key so a retried click never opens a case twice,
// and an If-Match version so one lawyer cannot silently overwrite another.
const writeHeaders = (key: string, version?: number) => ({
  "idempotency-key": key,
  ...(version === undefined ? {} : { "if-match": `"v${version}"` }),
});

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
  listCases: (params: { q?: string; status?: CaseStatus; cursor?: string }) => {
    const search = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
    );
    return request<{ items: CaseSummary[]; nextCursor: string | null }>(
      "GET",
      `/api/v1/cases?${search}`,
    );
  },
  openCase: (body: NewCase, key: string) =>
    request<CaseDetail>("POST", "/api/v1/cases", body, writeHeaders(key)),
  getCase: (id: string) => request<CaseDetail>("GET", `/api/v1/cases/${id}`),
  caseActivity: (id: string) => request<Activity>("GET", `/api/v1/cases/${id}/activity`),
  transition: (id: string, version: number, body: Transition, key: string) =>
    request<CaseDetail>(
      "POST",
      `/api/v1/cases/${id}/transitions`,
      body,
      writeHeaders(key, version),
    ),
  addParty: (id: string, version: number, body: PartyInput, key: string) =>
    request<CaseDetail>("POST", `/api/v1/cases/${id}/parties`, body, writeHeaders(key, version)),
  caseDocuments: (id: string) => request<CaseDocuments>("GET", `/api/v1/cases/${id}/documents`),
  downloadLink: (versionId: string) =>
    request<{ url: string }>("GET", `/api/v1/documents/versions/${versionId}/download`),
  updateDocument: (
    id: string,
    body: { visibility?: "client" | "firm"; expiresOn?: string | null },
  ) => request<void>("PATCH", `/api/v1/documents/${id}`, body),
  /** Asks for a signed link, sends the file straight to storage, then confirms it arrived. */
  async upload(caseId: string, target: UploadTarget, file: File, key: string) {
    const link = await request<{
      versionId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    }>(
      "POST",
      `/api/v1/cases/${caseId}/documents/uploads`,
      {
        ...target,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        byteSize: file.size,
      },
      { "idempotency-key": key },
    );
    const put = await fetch(link.uploadUrl, {
      method: "PUT",
      headers: link.uploadHeaders,
      body: file,
    });
    if (!put.ok)
      throw new ApiError(
        put.status,
        "upload_failed",
        "The upload did not finish. Try again.",
        "uploadFailed",
      );
    return request<{ scanStatus: string }>(
      "POST",
      `/api/v1/documents/versions/${link.versionId}/complete`,
      {},
    );
  },
};
