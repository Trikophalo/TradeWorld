import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/layout/page";
import { JobPortal } from "@/features/career/components/job-portal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("jobs");
  return { title: t("title") };
}

export default async function JobsPage() {
  const t = await getTranslations("jobs");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <JobPortal />
    </Page>
  );
}
