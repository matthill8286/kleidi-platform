import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CaseStatus, Localised } from "./api.ts";

export const STATUS_CHIP: Record<CaseStatus, string> = {
  open: "c-blue",
  on_hold: "c-amber",
  completed: "c-green",
  cancelled: "c-grey",
};

type Template = {
  stages: { key: string; label: Localised }[];
  requirements: { key: string; label: Localised }[];
};

/** Stage and checklist names in the reader's language, from the country template. */
export function useStageLabels(jurisdiction = "CY") {
  const { i18n } = useTranslation();
  const template = useQuery({
    queryKey: ["template", jurisdiction],
    queryFn: async () =>
      (await (await fetch(`/api/v1/jurisdictions/${jurisdiction}/template`)).json()) as Template,
    staleTime: Infinity,
  });
  const stages = template.data?.stages ?? [];
  const requirements = template.data?.requirements ?? [];
  const pick = (l: Localised | undefined) => l?.[i18n.resolvedLanguage ?? "en"] ?? l?.en;
  return {
    stages,
    label: (key: string) => pick(stages.find((s) => s.key === key)?.label) ?? key,
    /** A document's title: translated for checklist items, as typed for anything else. */
    documentTitle: (requirementKey: string | null | undefined, title: string) => {
      // Older events carry only the English title, so match on that too.
      const r = requirements.find(
        (q) => q.key === requirementKey || (!requirementKey && q.label.en === title),
      );
      return pick(r?.label) ?? title;
    },
  };
}

export const newKey = () => crypto.randomUUID();
