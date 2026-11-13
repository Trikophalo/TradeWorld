import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MEGAPHONE } from "@/components/pixel/art";
import { Page, PageHeader } from "@/components/layout/page";
import { EventStrip } from "@/features/market/components/event-strip";
import { RichNews } from "@/features/rich-list/components/rich-news";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("events");
  return { title: t("title") };
}

/** Upcoming events and headlines, moved off the start page (ADR-064). */
export default async function EventsPage() {
  const t = await getTranslations("events");
  const th = await getTranslations("pageHero");
  return (
    <Page>
      <PageHeader title={t("title")} intro={th("events")} art={MEGAPHONE} />
      <EventStrip />
      <RichNews limit={20} />
    </Page>
  );
}
