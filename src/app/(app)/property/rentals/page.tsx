import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { KEY } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { RentalMarket } from "@/features/property/components/rental-market";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("rentals");
  return { title: t("marketTitle") };
}

/** The rental market (ADR-158): places in other players' homes. */
export default async function RentalMarketPage() {
  const t = await getTranslations("rentals");
  return (
    <Page>
      <PageHeader title={t("marketTitle")} intro={t("marketIntro")} art={KEY} />
      <RentalMarket />
    </Page>
  );
}
