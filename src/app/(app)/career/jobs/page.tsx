import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { BRIEFCASE } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { Skeleton } from "@/components/ui/skeleton";
import { JobPortal } from "@/features/career/components/job-portal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("jobs");
  return { title: t("title") };
}

export default async function JobsPage() {
  const t = await getTranslations("jobs");
  const th = await getTranslations("pageHero");
  return (
    <Page>
      <PageHeader title={t("title")} intro={th("careerJobs")} art={BRIEFCASE} />
      {/* ?holder=clone opens the clone's side (ADR-206), read with useSearchParams */}
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-lg" />}>
        <JobPortal />
      </Suspense>
    </Page>
  );
}
