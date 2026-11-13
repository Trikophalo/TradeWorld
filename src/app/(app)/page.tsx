import { getTranslations } from "next-intl/server";
import { Page } from "@/components/layout/page";
import { IndexCard } from "@/features/market/components/index-card";
import { MoversCard } from "@/features/market/components/movers-card";
import { WealthHero } from "@/features/portfolio/components/wealth-hero";
import { DebtCard } from "@/features/progression/components/debt-card";
import { DailyRewardCard } from "@/features/progression/components/daily-reward";
import { MissionsCard } from "@/features/progression/components/missions-card";
import { NextGoalCard } from "@/features/progression/components/next-goal-card";
import { Reveal } from "@/features/progression/components/reveal";
import { VaultCard } from "@/features/progression/components/vault-card";
import { MyRankCard } from "@/features/rich-list/components/my-rank-card";
import { NextEventsCard } from "@/features/market/components/event-strip";
import { FeedPreview } from "@/features/social/components/feed";
import { LeaguePreview } from "@/features/social/components/league";

/**
 * Start page. From the first minute: wealth, vault, missions, rank and a few
 * stocks. Index chart and event strip join as the level rises
 * (src/config/disclosure.ts).
 */
export default async function HomePage() {
  const t = await getTranslations("home");
  return (
    <Page>
      <h1 className="sr-only">{t("title")}</h1>
      <WealthHero />
      <div className="grid items-start gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        {/* On phones the vault and the missions come first. */}
        <div className="space-y-5 lg:col-start-2 lg:row-start-1 lg:space-y-6">
          <DebtCard />
          <DailyRewardCard />
          <VaultCard />
          <MissionsCard />
        </div>
        <div className="space-y-5 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:space-y-6">
          <MyRankCard link />
          <Reveal feature="homeSocial">
            <FeedPreview />
          </Reveal>
          <Reveal feature="homeIndex">
            <IndexCard />
          </Reveal>
          <MoversCard />
        </div>
        <div className="space-y-5 lg:col-start-2 lg:row-start-2 lg:space-y-6">
          <NextGoalCard />
          <Reveal feature="homeSocial">
            <LeaguePreview />
          </Reveal>
          <Reveal feature="homeEvents">
            <NextEventsCard />
          </Reveal>
        </div>
      </div>
    </Page>
  );
}
