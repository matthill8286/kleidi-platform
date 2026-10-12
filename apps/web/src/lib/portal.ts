import { ApiError, type Localised } from "./api.ts";

export type PortalMe = {
  name: string;
  locale: string;
  privacyAccepted: boolean;
  privacyVersion: string;
};

export type PortalDocument = {
  id: string;
  title: string;
  requirementKey: string | null;
  requested: boolean;
  latest: {
    id: string;
    fileName: string;
    createdAt: string;
    fromYou: boolean;
    scanStatus: string;
    review: string;
    reviewNote: string | null;
    downloadable: boolean;
  } | null;
};

export type PortalCase = {
  firmName: string;
  lawyer: { name: string; email: string } | null;
  you: { name: string; role: string };
  case: {
    reference: string;
    propertyAddress: string | null;
    status: string;
    stages: {
      key: string;
      label: Localised;
      position: "done" | "current" | "next";
      reachedAt: string | null;
    }[];
  };
  documents: PortalDocument[];
  consents: {
    id: string;
    granteeType: string;
    granteeRef: string;
    grantedAt: string;
    revokedAt: string | null;
  }[];
};

export type LinkInfo = {
  firmName: string;
  partyName: string;
  maskedPhone: string;
  locale: string;
  sent: boolean;
};

/** The client portal's API: a cookie session for one case, never the firm's headers. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/portal${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const p = (await res.json().catch(() => ({}))) as {
      code?: string;
      title?: string;
      messageKey?: string;
      params?: Record<string, string | number>;
    };
    throw new ApiError(
      res.status,
      p.code ?? "error",
      p.title ?? res.statusText,
      p.messageKey,
      p.params,
    );
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const portal = {
  start: (token: string, resend = false) =>
    call<LinkInfo>("POST", `/link/${token}/start`, { resend }),
  verify: (token: string, code: string) => call<void>("POST", `/link/${token}/verify`, { code }),
  requestLink: (email: string) => call<void>("POST", "/sign-in", { email }),
  me: () => call<PortalMe>("GET", "/me"),
  setLocale: (locale: string) => call<void>("PATCH", "/me", { locale }),
  acceptPrivacy: () => call<void>("POST", "/privacy/accept", {}),
  case: () => call<PortalCase>("GET", "/case"),
  signOut: () => call<void>("POST", "/sign-out", {}),
  download: (versionId: string) => call<{ url: string }>("GET", `/documents/${versionId}/download`),
  grant: (granteeType: string, email: string) =>
    call<void>("POST", "/consents", { granteeType, email }),
  revoke: (id: string) => call<void>("DELETE", `/consents/${id}`),
  /** Same three steps as the firm's upload: signed link, straight to storage, confirm. */
  async upload(target: { documentId: string } | { title: string }, file: File) {
    const link = await call<{
      versionId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    }>("POST", "/uploads", {
      ...target,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      byteSize: file.size,
    });
    const put = await fetch(link.uploadUrl, {
      method: "PUT",
      headers: link.uploadHeaders,
      body: file,
    });
    if (!put.ok)
      throw new ApiError(put.status, "upload_failed", "The upload did not finish.", "uploadFailed");
    await call<void>("POST", `/uploads/${link.versionId}/complete`, {});
  },
};
