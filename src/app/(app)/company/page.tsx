import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { COMPANY_BUILDINGS } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { CompanyHub, HubSkeleton } from "@/features/company/components/company-hub";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("firm");
  return { title: t("title") };
}

export default async function CompanyPage() {
  const t = await getTranslations("firm");
  const th = await getTranslations("pageHero");
  return (
    <Page>
      <PageHeader title={t("title")} intro={th("company")} art={COMPANY_BUILDINGS.garage} />
      <Suspense fallback={<HubSkeleton />}>
        <CompanyHub />
      </Suspense>
    </Page>
  );
}
