import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/layout/page";
import { FriendsView } from "@/features/friends/components/friends";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("friends");
  return { title: t("title") };
}

/** Friends (ADR-084). */
export default async function FriendsPage() {
  const t = await getTranslations("friends");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <p className="text-pretty text-fg-2">{t("intro")}</p>
      <FriendsView />
    </Page>
  );
}
