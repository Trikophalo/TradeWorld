import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WALLET } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { OrdersList } from "@/features/portfolio/components/orders-list";
import { PortfolioSummary } from "@/features/portfolio/components/portfolio-summary";
import { PositionsList } from "@/features/portfolio/components/positions-list";
import { TradeHistory } from "@/features/portfolio/components/trade-history";
import { Reveal } from "@/features/progression/components/reveal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portfolio");
  return { title: t("title") };
}

export default async function PortfolioPage() {
  const t = await getTranslations("portfolio");
  const th = await getTranslations("pageHero");
  return (
    <Page>
      <PageHeader title={t("title")} intro={th("portfolio")} art={WALLET} />
      <PortfolioSummary />
      <div className="grid gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6">
        <div className="space-y-5 lg:space-y-6">
          <PositionsList />
          <OrdersList />
        </div>
        <Reveal feature="portfolioHistory">
          <TradeHistory />
        </Reveal>
      </div>
    </Page>
  );
}
