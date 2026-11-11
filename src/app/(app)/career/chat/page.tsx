import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/layout/page";
import { CompanyChat } from "@/features/company/components/company-chat";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("chat");
  return { title: t("title") };
}

/** Company chat for employees of a player company (founders also have it on the company page). */
export default async function ChatPage() {
  const t = await getTranslations("chat");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <CompanyChat className="mx-auto max-w-2xl" />
    </Page>
  );
}
