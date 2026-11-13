import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { COTTAGE } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { PropertyHub } from "@/features/property/components/property-hub";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("estate");
  return { title: t("title") };
}

export default async function PropertyPage() {
  const t = await getTranslations("estate");
  const th = await getTranslations("pageHero");
  return (
    <Page>
      <PageHeader title={t("title")} intro={th("property")} art={COTTAGE} />
      <PropertyHub />
    </Page>
  );
}
