import type { Metadata } from "next";
import { Suspense } from "react";
import { Page } from "@/components/layout/page";
import { Skeleton } from "@/components/ui/skeleton";
import { CRYPTO } from "@/config/crypto";
import { CoinDetailView } from "@/features/crypto/components/coin-detail";

type Params = PageProps<"/crypto/[ticker]">["params"];

/** The seeded coins are prerendered; player coins and new meme coins render on request. */
export async function generateStaticParams() {
  return CRYPTO.coins.map((coin) => ({ ticker: coin.ticker }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { ticker } = await params;
  const coin = CRYPTO.coins.find((c) => c.ticker === ticker.toUpperCase());
  return { title: coin ? `${coin.name} (${coin.ticker})` : ticker.toUpperCase() };
}

export default function CoinPage({ params }: { params: Params }) {
  return (
    <Page>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-lg" />}>
        <Coin params={params} />
      </Suspense>
    </Page>
  );
}

async function Coin({ params }: { params: Params }) {
  const { ticker } = await params;
  return <CoinDetailView ticker={ticker.toUpperCase()} />;
}
