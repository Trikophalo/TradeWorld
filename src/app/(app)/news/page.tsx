import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NEWSPAPER } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { NewsFeed } from "@/features/news/news-feed";
import { ProtestsCard } from "@/features/news/protests";
import { NewsShow } from "@/features/news/show/news-show";
import { NewsBattle } from "@/features/news/battle/news-battle";
import { Reveal } from "@/features/progression/components/reveal";

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
      {/* The hourly live show with Mr. Doodle Dangle and its chat (ADR-150) */}
      {/* `isolate`: the TV's layers stack inside it and never paint over the sticky top bar */}
      <div className="isolate mx-auto mb-6 max-w-5xl">
        <NewsShow />
      </div>
      {/* News battles among the viewers (ADR-160) */}
      <Reveal feature="newsBattle">
        <div id="news-battle" className="mx-auto mb-6 max-w-5xl scroll-mt-20">
          <NewsBattle />
        </div>
      </Reveal>
      <div className="mx-auto max-w-2xl space-y-4">
        <ProtestsCard />
        <NewsFeed />
      </div>
    </Page>
  );
}
