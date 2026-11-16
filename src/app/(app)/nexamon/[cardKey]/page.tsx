import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { nexamonCard } from "@/config/nexamon";
import { Page } from "@/components/layout/page";
import { Skeleton } from "@/components/ui/skeleton";
import { CardInspect } from "@/features/nexamon/components/card-inspect";

type Params = PageProps<"/nexamon/[cardKey]">["params"];

/**
 * Cache Components needs at least one prerendered param; every other card is rendered on request. The data loads
 * on the client.
 */
export async function generateStaticParams() {
  return [{ cardKey: "me-001" }];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { cardKey } = await params;
  const t = await getTranslations("nexamon");
  const card = nexamonCard(decodeURIComponent(cardKey));
  return { title: card ? `${card.name} · ${t("title")}` : t("title") };
}

/** One Nexamon card up close (ADR-165): deep link for the binder, the market, the feed and notifications. */
export default function NexamonCardPage({ params }: { params: Params }) {
  return (
    <Page>
      <Suspense fallback={<Skeleton className="h-112 w-full rounded-lg" />}>
        <Inspect params={params} />
      </Suspense>
    </Page>
  );
}

async function Inspect({ params }: { params: Params }) {
  const { cardKey } = await params;
  return <CardInspect cardKey={decodeURIComponent(cardKey)} />;
}
