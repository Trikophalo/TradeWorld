"use client";

import { useTranslations } from "next-intl";
import type { JobPosting } from "@/features/game/types";

type JobTitleKey = Parameters<ReturnType<typeof useTranslations<"jobTitles">>>[0];

/** AI postings carry a title key, player postings their own title. */
export function useJobTitle(job: Pick<JobPosting, "titleKey" | "title">): string {
  const t = useTranslations("jobTitles");
  if (job.titleKey && t.has(job.titleKey as JobTitleKey)) return t(job.titleKey as JobTitleKey);
  return job.title ?? job.titleKey ?? "";
}
