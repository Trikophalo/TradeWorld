import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/layout/page";
import { CompanyHub } from "@/features/company/components/company-hub";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("firm");
  return { title: t("title") };
}

export default async function CompanyPage() {
  const t = await getTranslations("firm");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <CompanyHub />
    </Page>
  );
}
