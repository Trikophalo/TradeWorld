import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { BOOK } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { Skeleton } from "@/components/ui/skeleton";
import { SkillPointGuide } from "@/features/career/components/skill-guide";
import { SkillTree } from "@/features/career/components/skill-tree";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("skillTree");
  return { title: t("title") };
}

export default async function SkillsPage() {
  const t = await getTranslations("skillTree");
  return (
    <Page>
      <PageHeader title={t("title")} intro={t("intro")} art={BOOK} />
      {/* ?skill=<key> opens one skill (ADR-194), read with useSearchParams */}
      <Suspense fallback={<Skeleton className="h-[70dvh] w-full rounded-lg" />}>
        <SkillTree />
      </Suspense>
      <SkillPointGuide />
    </Page>
  );
}
