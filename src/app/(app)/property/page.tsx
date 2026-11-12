import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/layout/page";
import { PropertyHub } from "@/features/property/components/property-hub";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("estate");
  return { title: t("title") };
}

export default async function PropertyPage() {
  const t = await getTranslations("estate");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <PropertyHub />
    </Page>
  );
}
