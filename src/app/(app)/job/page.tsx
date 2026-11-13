import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BRIEFCASE } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { JobView } from "@/features/career/components/job-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("jobTab");
  return { title: t("title") };
}

/** Job tab (ADR-064): work runs by itself, here the player sees it and the employer. */
export default async function JobPage() {
  const t = await getTranslations("jobTab");
  const th = await getTranslations("pageHero");
  return (
    <Page>
      <PageHeader title={t("title")} intro={th("job")} art={BRIEFCASE} />
      <JobView />
    </Page>
  );
}
