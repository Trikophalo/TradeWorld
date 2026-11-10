import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/layout/page";
import { MarketBrowser } from "@/features/market/components/market-browser";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("markets");
  return { title: t("title") };
}

export default async function MarketsPage() {
  const t = await getTranslations("markets");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <MarketBrowser />
    </Page>
  );
}
