import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
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
      <PageHeader title={t("title")} />
      <p className="text-pretty text-fg-2">{t("intro")}</p>
      <UpgradeShop />
    </Page>
  );
}
