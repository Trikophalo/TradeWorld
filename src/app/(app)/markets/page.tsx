import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BULL } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { OffersCard } from "@/features/company/components/listing";
import { MarketBrowser } from "@/features/market/components/market-browser";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("markets");
  return { title: t("title") };
}

export default async function MarketsPage() {
  const t = await getTranslations("markets");
  const th = await getTranslations("pageHero");
  return (
    <Page>
      <PageHeader title={t("title")} intro={th("markets")} art={BULL} />
      <OffersCard />
      <MarketBrowser />
    </Page>
  );
}
