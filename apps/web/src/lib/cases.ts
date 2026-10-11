import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CaseStatus, Localised } from "./api.ts";

export const STATUS_CHIP: Record<CaseStatus, string> = {
  open: "c-blue",
  on_hold: "c-amber",
  completed: "c-green",
  cancelled: "c-grey",
};

type Template = { stages: { key: string; label: Localised }[] };

/** Stage names in the reader's language, from the firm's country template. */
export function useStageLabels(jurisdiction = "CY") {
  const { i18n } = useTranslation();
  const template = useQuery({
    queryKey: ["template", jurisdiction],
    queryFn: async () =>
      (await (await fetch(`/api/v1/jurisdictions/${jurisdiction}/template`)).json()) as Template,
    staleTime: Infinity,
  });
  const stages = template.data?.stages ?? [];
  return {
    stages,
    label: (key: string) => {
      const l = stages.find((s) => s.key === key)?.label;
      return l?.[i18n.resolvedLanguage ?? "en"] ?? l?.en ?? key;
    },
  };
}

export const newKey = () => crypto.randomUUID();
