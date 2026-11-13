import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GEARS } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { UpgradeShop } from "@/features/upgrades/components/upgrade-shop";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("upgrades");
  return { title: t("title") };
}

/** Upgrades for game money (ADR-093). */
export default async function UpgradesPage() {
  const t = await getTranslations("upgrades");
  return (
    <Page>
      <PageHeader title={t("title")} intro={t("intro")} art={GEARS} />
      <UpgradeShop />
    </Page>
  );
}
