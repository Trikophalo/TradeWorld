import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GRADUATE } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { CareerHub } from "@/features/career/components/career-hub";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("career");
  return { title: t("title") };
}

export default async function CareerPage() {
  const t = await getTranslations("career");
  const th = await getTranslations("pageHero");
  return (
    <Page>
      <PageHeader title={t("title")} intro={th("career")} art={GRADUATE} />
      <CareerHub />
    </Page>
  );
}
