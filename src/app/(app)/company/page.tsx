import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/layout/page";
import { CompanyLocked } from "@/features/company/components/company-locked";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("company");
  return { title: t("title") };
}

export default async function CompanyPage() {
  const t = await getTranslations("company");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <CompanyLocked />
    </Page>
  );
}
