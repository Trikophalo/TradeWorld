import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NEWSPAPER } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { NewsFeed } from "@/features/news/news-feed";
import { ProtestsCard } from "@/features/news/protests";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("newsTab");
  return { title: t("title") };
}

/** News tab (ADR-129): stock hints, company news of every player company, market news and funny items. */
export default async function NewsPage() {
  const t = await getTranslations("newsTab");
  const th = await getTranslations("pageHero");
  return (
    <Page>
      <PageHeader title={t("title")} intro={th("news")} art={NEWSPAPER} />
      <div className="mx-auto max-w-2xl space-y-4">
        <ProtestsCard />
        <NewsFeed />
      </div>
    </Page>
  );
}
