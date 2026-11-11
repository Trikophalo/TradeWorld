import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/layout/page";
import { MissionsBoard } from "@/features/progression/components/missions-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("missions");
  return { title: t("title") };
}

export default async function MissionsPage() {
  const t = await getTranslations("missions");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <p className="max-w-2xl text-pretty text-fg-2">{t("intro")}</p>
      <MissionsBoard />
    </Page>
  );
}
