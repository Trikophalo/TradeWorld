import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PALETTE } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { ArtworksHub } from "@/features/artworks/components/artworks-hub";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("art");
  return { title: t("title") };
}

export default async function ArtworksPage() {
  const t = await getTranslations("art");
  const th = await getTranslations("pageHero");
  return (
    <Page>
      <PageHeader title={t("title")} intro={th("artworks")} art={PALETTE} />
      <ArtworksHub />
    </Page>
  );
}
