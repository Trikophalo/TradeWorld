import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BULL } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { OffersCard } from "@/features/company/components/listing";
import { MarketMoodCard } from "@/features/market/components/confidence";
import { MarketBrowser } from "@/features/market/components/market-browser";
import { Reveal } from "@/features/progression/components/reveal";
import { StockNewsCard } from "@/features/news/stock-news";

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
      <Reveal feature="marketMood">
        <MarketMoodCard />
      </Reveal>
      <StockNewsCard />
      <OffersCard />
      <MarketBrowser />
    </Page>
  );
}
