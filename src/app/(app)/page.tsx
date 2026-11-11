import { getTranslations } from "next-intl/server";
import { BEAR } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Page } from "@/components/layout/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EventStrip } from "@/features/market/components/event-strip";
import { IndexCard } from "@/features/market/components/index-card";
import { MoversCard } from "@/features/market/components/movers-card";
import { WealthHero } from "@/features/portfolio/components/wealth-hero";
import { MissionsCard } from "@/features/progression/components/missions-card";
import { NextGoalCard } from "@/features/progression/components/next-goal-card";
import { Reveal } from "@/features/progression/components/reveal";
import { VaultCard } from "@/features/progression/components/vault-card";

/**
 * Start page. A new player sees four things: wealth, vault, the next goal and
 * a few stocks. Index, missions, events and news join as the level rises
 * (src/config/disclosure.ts).
 */
export default async function HomePage() {
  const t = await getTranslations("home");
  return (
    <Page>
      <h1 className="sr-only">{t("title")}</h1>
      <WealthHero />
      <Reveal feature="homeEvents">
        <EventStrip />
      </Reveal>
      <div className="grid items-start gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        {/* On phones the vault and the next goal come first. */}
        <div className="space-y-5 lg:col-start-2 lg:row-start-1 lg:space-y-6">
          <VaultCard />
          <NextGoalCard />
        </div>
        <div className="space-y-5 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:space-y-6">
          <Reveal feature="homeIndex">
            <IndexCard />
          </Reveal>
          <MoversCard />
        </div>
        <div className="space-y-5 empty:hidden lg:col-start-2 lg:row-start-2 lg:space-y-6">
          <Reveal feature="homeMissions">
            <MissionsCard />
          </Reveal>
          <Reveal feature="homeNews">
            <Card padding="lg">
              <CardHeader>
                <CardTitle>{t("news")}</CardTitle>
              </CardHeader>
              <EmptyState
                className="py-4"
                art={<PixelIcon {...BEAR} scale={4} />}
                title={t("newsEmptyTitle")}
                description={t("newsEmptyText")}
              />
            </Card>
          </Reveal>
        </div>
      </div>
    </Page>
  );
}
