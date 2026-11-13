import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/layout/page";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { FriendsHub } from "@/features/social/components/friends-hub";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("friends");
  return { title: t("title") };
}

/** Friends hub: news, weekly league, friends (ADR-084, ADR-088, ADR-089). */
export default async function FriendsPage() {
  const t = await getTranslations("friends");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <p className="text-pretty text-fg-2">{t("intro")}</p>
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xs" />}>
        <FriendsHub />
      </Suspense>
    </Page>
  );
}
