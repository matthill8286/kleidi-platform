import type { QueryClient } from "@tanstack/react-query";
import { api, ApiError, type Me } from "./api.ts";

export const ME_KEY = ["me"] as const;

/** The signed-in user and their firms, or null when nobody is signed in. */
export async function loadMe(queryClient: QueryClient): Promise<Me | null> {
  try {
    return await queryClient.fetchQuery({ queryKey: ME_KEY, queryFn: api.me, staleTime: 30_000 });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** Accepts only same-site paths, so a crafted link cannot send users elsewhere after sign-in. */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\\")) return undefined;
  if ([...value].some((c) => c.charCodeAt(0) < 32)) return undefined;
  // Whatever the path looks like, it must resolve to this site.
  const url = new URL(value, window.location.origin);
  return url.origin === window.location.origin
    ? `${url.pathname}${url.search}${url.hash}`
    : undefined;
}

export const redirectSearch = (search: Record<string, unknown>): { redirect?: string } => {
  const redirect = safeRedirect(search.redirect);
  return redirect ? { redirect } : {};
};
