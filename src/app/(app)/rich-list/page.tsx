import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/layout/page";
import { RichListBoard } from "@/features/rich-list/components/rich-list-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("richList");
  return { title: t("title") };
}

export default async function RichListPage() {
  const t = await getTranslations("richList");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <RichListBoard />
    </Page>
  );
}
