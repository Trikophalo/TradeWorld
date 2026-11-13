"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CONTRACT } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import type { Deal } from "@/features/game/types";
import { useDealBoard, useDeals } from "../hooks";
import { DealCard } from "./deal-card";
import { DealForm } from "./deal-form";
import { TrustBadge } from "./trust-badge";

type Tab = "board" | "mine" | "new";
const TABS: readonly Tab[] = ["board", "mine", "new"];

/** Deals between players (ADR-098): own trust on top, then the board, own deals and a new offer. */
export function DealsHub() {
  const t = useTranslations("deals");
  const tt = useTranslations("trust");
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "board";
  const deals = useDeals();
  const go = (next: Tab) => router.replace(`/deals?tab=${next}`, { scroll: false });

  return (
    <div className="space-y-5">
      <Card
        padding="lg"
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        data-testid="my-trust"
      >
        {deals.data ? <TrustBadge trust={deals.data.trust} size="lg" /> : <Skeleton className="h-14 w-48 rounded-xs" />}
        <p className="max-w-md text-sm text-pretty text-fg-3">{tt("explain")}</p>
      </Card>
      <Segmented
        value={tab}
        onValueChange={go}
        options={TABS.map((value) => ({
          value,
          label: t(`tabs.${value}`),
          adornment:
            value === "mine" && (deals.data?.incoming.length ?? 0) > 0 ? (
              <span className="size-2 rounded-pill bg-accent" aria-hidden />
            ) : undefined,
        }))}
        label={t("title")}
        block
      />
      {tab === "board" && <Board />}
      {tab === "mine" && <Mine />}
      {tab === "new" && <DealForm onSent={() => go("mine")} />}
    </div>
  );
}

function DealList({ deals }: { deals: Deal[] }) {
  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {deals.map((deal) => (
        <li key={deal.id}>
          <DealCard deal={deal} />
        </li>
      ))}
    </ul>
  );
}

function Board() {
  const t = useTranslations("deals");
  const board = useDealBoard();
  if (board.isPending) return <Skeleton className="h-64 w-full rounded-xs" />;
  return (
    <section className="space-y-3" data-testid="deal-board">
      <p className="text-sm text-pretty text-fg-3">{t("board.hint")}</p>
      {board.data && board.data.length > 0 ? (
        <DealList deals={board.data} />
      ) : (
        <EmptyState
          art={<PixelIcon {...CONTRACT} scale={4} />}
          title={t("empty.board")}
          description={t("empty.boardText")}
        />
      )}
    </section>
  );
}

function Mine() {
  const t = useTranslations("deals");
  const deals = useDeals();
  if (deals.isPending) return <Skeleton className="h-64 w-full rounded-xs" />;
  const d = deals.data;
  const sections = d
    ? ([
        ["incoming", d.incoming],
        ["running", d.running],
        ["outgoing", d.outgoing],
        ["history", d.history],
      ] as const)
    : [];
  const any = sections.some(([, list]) => list.length > 0);
  if (!any) {
    return (
      <EmptyState
        art={<PixelIcon {...CONTRACT} scale={4} />}
        title={t("empty.mine")}
        description={t("empty.mineText")}
      />
    );
  }
  return (
    <div className="space-y-6" data-testid="my-deals">
      {sections
        .filter(([, list]) => list.length > 0)
        .map(([key, list]) => (
          <section key={key} className="space-y-3" data-section={key}>
            <h2 className="label-pixel text-fg-2">{t(`sections.${key}`)}</h2>
            <DealList deals={list} />
          </section>
        ))}
    </div>
  );
}
