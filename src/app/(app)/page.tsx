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
import { VaultCard } from "@/features/progression/components/vault-card";

export default async function HomePage() {
  const t = await getTranslations("home");
  return (
    <Page>
      <h1 className="sr-only">{t("title")}</h1>
      <WealthHero />
      <EventStrip />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <div className="space-y-5 lg:space-y-6">
          <IndexCard />
          <MoversCard />
        </div>
        <div className="space-y-5 lg:space-y-6">
          <VaultCard />
          <MissionsCard />
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
        </div>
      </div>
    </Page>
  );
}
