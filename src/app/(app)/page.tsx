import { getTranslations } from "next-intl/server";
import { Page } from "@/components/layout/page";
import { HomeHero, NextSteps, QuickStats } from "@/features/home/components/home-view";
import { DebtCard } from "@/features/progression/components/debt-card";
import { Reveal } from "@/features/progression/components/reveal";
import { VaultCard } from "@/features/progression/components/vault-card";
import { InstallHint } from "@/features/settings/components/install-hint";

/**
 * Start page (ADR-109): calm on purpose. A scene with Finn and the wealth, one thing to do next, the vault and
 * three small tiles. Rankings, friends, index, movers and events live on their own pages.
 */
export default async function HomePage() {
  const t = await getTranslations("home");
  return (
    <Page>
      <h1 className="sr-only">{t("title")}</h1>
      <HomeHero />
      <InstallHint />
      <DebtCard />
      <div className="grid items-start gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <NextSteps />
        <VaultCard />
      </div>
      <Reveal feature="homeStats">
        <QuickStats />
      </Reveal>
    </Page>
  );
}
