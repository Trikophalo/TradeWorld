import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Page, PageHeader } from "@/components/layout/page";
import { Skeleton } from "@/components/ui/skeleton";
import { DealsHub } from "@/features/deals/components/deals-hub";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("deals");
  return { title: t("title") };
}

/** Deals between players and trust (ADR-098). */
export default async function DealsPage() {
  const t = await getTranslations("deals");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <p className="text-pretty text-fg-2">{t("intro")}</p>
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xs" />}>
        <DealsHub />
      </Suspense>
    </Page>
  );
}
