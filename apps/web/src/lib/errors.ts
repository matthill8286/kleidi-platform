import { useTranslation } from "react-i18next";
import { ApiError } from "./api.ts";

/**
 * Turns any error into text in the reader's language. API errors carry a message key;
 * Better Auth errors carry a code. Anything unknown falls back to a generic message.
 */
export function useErrorText() {
  const { t, i18n } = useTranslation();
  return (error: unknown, fallback?: string): string | null => {
    if (!error) return null;
    if (error instanceof ApiError) {
      if (error.key && i18n.exists(`errors.${error.key}`)) {
        const params = { ...error.params };
        if (typeof params.status === "string") params.status = t(`cases.statuses.${params.status}`);
        return t(`errors.${error.key}`, params);
      }
      return error.message;
    }
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && i18n.exists(`errors.auth.${code}`))
      return t(`errors.auth.${code}`);
    return fallback ?? t("common.error");
  };
}
