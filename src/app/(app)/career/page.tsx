import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/layout/page";
import { CareerHub } from "@/features/career/components/career-hub";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("career");
  return { title: t("title") };
}

export default async function CareerPage() {
  const t = await getTranslations("career");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <CareerHub />
    </Page>
  );
}
