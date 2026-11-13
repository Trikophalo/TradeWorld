import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FLASK } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { CoinStudio } from "@/features/crypto/components/coin-studio";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("crypto.studio");
  return { title: t("title") };
}

/** The player's own coin (ADR-101). */
export default async function CoinStudioPage() {
  const t = await getTranslations("crypto.studio");
  return (
    <Page>
      <PageHeader title={t("title")} intro={t("intro")} art={FLASK} />
      <CoinStudio />
    </Page>
  );
}
