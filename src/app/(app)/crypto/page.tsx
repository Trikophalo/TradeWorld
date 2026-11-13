import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { COIN } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { CryptoMarketView } from "@/features/crypto/components/crypto-market";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("crypto");
  return { title: t("title") };
}

/** Crypto market (ADR-101). */
export default async function CryptoPage() {
  const t = await getTranslations("crypto");
  return (
    <Page>
      <PageHeader title={t("title")} intro={t("intro")} art={COIN} />
      <CryptoMarketView />
    </Page>
  );
}
