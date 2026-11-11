import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Page } from "@/components/layout/page";
import { Skeleton } from "@/components/ui/skeleton";
import { PlayerProfile } from "@/features/career/components/player-profile";

type Params = PageProps<"/players/[nickname]">["params"];

/**
 * Cache Components needs at least one prerendered param; every other name is
 * rendered on request. The card itself loads on the client.
 */
export async function generateStaticParams() {
  return [{ nickname: "DemoSpieler" }];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { nickname } = await params;
  const t = await getTranslations("playerCard");
  return { title: `${decodeURIComponent(nickname)} · ${t("title")}` };
}

/** Public business card of a player, reached from the rich list (ADR-054). */
export default function PlayerPage({ params }: { params: Params }) {
  return (
    <Page>
      <Suspense fallback={<Skeleton className="h-72 w-full max-w-xl rounded-xl" />}>
        <Player params={params} />
      </Suspense>
    </Page>
  );
}

async function Player({ params }: { params: Params }) {
  const { nickname } = await params;
  return <PlayerProfile nickname={decodeURIComponent(nickname)} />;
}
