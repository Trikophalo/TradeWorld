import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { Skeleton } from "@/components/ui/skeleton";
import { NexamonHub } from "@/features/nexamon/components/nexamon-hub";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nexamon");
  return { title: t("title") };
}

/** Nexamon collectible cards (ADR-165): shop, binder, card market and the ASP desk. */
export default async function NexamonPage() {
  const t = await getTranslations("nexamon");
  const th = await getTranslations("pageHero");
  return (
    <Page>
      <PageHeader title={t("title")} intro={th("nexamon")} art={UI_ICONS.nexamon} />
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-lg" />}>
        <NexamonHub />
      </Suspense>
    </Page>
  );
}
