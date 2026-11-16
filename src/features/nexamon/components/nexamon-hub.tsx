"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { BALANCE } from "@/config/balance";
import { NEXAMON_SET_SIZE, NEXAMON_SETS } from "@/config/nexamon";
import { DISCLOSURE } from "@/config/disclosure";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useGame } from "@/features/game/store";
import { LockedFeature } from "@/features/progression/components/locked-feature";
import { Reveal, useDisclosed } from "@/features/progression/components/reveal";
import { useVisitTour } from "@/features/tutorial/use-visit-tour";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNexamonCollection, useNexamonOverview, useRevealedSlabs } from "../hooks";
import { formatFactor, splitGraded } from "../view";
import { Binder } from "./binder";
import { GradingDesk } from "./grading-desk";
import { Market, type MarketView } from "./market";
import { NexamonPack } from "./pack";
import { LoadError } from "./parts";
import { Shop } from "./shop";

export type NexamonTab = "shop" | "collection" | "market" | "grading";
const TABS: readonly NexamonTab[] = ["shop", "collection", "market", "grading"];

/**
 * The Nexamon area (ADR-165): shop, binder, card market and the ASP desk as tabs of one page. The tab, the market
 * view and a card filter live in the address, so notifications and other pages can link straight to them.
 * Before level 10 the page shows what is coming.
 */
export function NexamonHub() {
  const ready = useGame((state) => state.portfolio !== null);
  const unlocked = useDisclosed("nexamon");
  if (!ready) return <Skeleton className="h-96 w-full rounded-lg" />;
  if (!unlocked) return <Teaser />;
  return (
    <Reveal feature="nexamon">
      <Hub />
    </Reveal>
  );
}

function Hub() {
  const t = useTranslations("nexamon");
  const params = useSearchParams();
  const router = useRouter();
  const rawTab = params.get("tab");
  const tab: NexamonTab = TABS.includes(rawTab as NexamonTab) ? (rawTab as NexamonTab) : "shop";
  const view: MarketView = params.get("view") === "mine" ? "mine" : "all";
  const cardKey = params.get("card");
  // Finn shows the packs on the first visit; only where they are on the screen.
  useVisitTour("visit_nexamon", tab === "shop");
  const overview = useNexamonOverview();
  const collection = useNexamonCollection();
  const [revealed] = useRevealedSlabs();
  const fresh = collection.data ? splitGraded(collection.data.copies, revealed).fresh.length : 0;
  const grading = overview.data?.collection.grading ?? 0;

  const go = (next: { tab?: NexamonTab; view?: MarketView; card?: string | null }) => {
    const query = new URLSearchParams();
    const nextTab = next.tab ?? tab;
    query.set("tab", nextTab);
    if (nextTab === "market") {
      const nextView = next.view ?? (next.tab ? "all" : view);
      const nextCard = next.card !== undefined ? next.card : next.tab ? null : cardKey;
      if (nextView === "mine") query.set("view", "mine");
      if (nextCard) query.set("card", nextCard);
    }
    router.replace(`/nexamon?${query.toString()}`, { scroll: false });
  };

  const totals = overview.data?.collection;
  // Nothing to show and the read failed (offline, server busy): say so instead of loading forever.
  const failed = (!overview.data && overview.error) || (!collection.data && collection.error) || null;
  return (
    <div className="space-y-4" data-testid="nexamon-hub" data-tab={tab}>
      <div className={cn("nums text-sm text-fg-2", tab === "collection" && "sr-only")} data-testid="nexamon-summary">
        {totals ? (
          t("summary", {
            copies: totals.copies,
            distinct: totals.distinct,
            total: overview.data!.sets.reduce((sum, set) => sum + set.cards, 0),
            value: formatMoney(totals.valueCents),
          })
        ) : (
          <Skeleton className="h-4 w-64 max-w-full rounded-xs" />
        )}
      </div>
      <div data-tour="nexamon-tabs">
        <Segmented<NexamonTab>
          value={tab}
          onValueChange={(next) => go({ tab: next })}
          label={t("tabs.label")}
          block
          options={[
            { value: "shop", label: t("tabs.shop") },
            { value: "collection", label: t("tabs.collection") },
            { value: "market", label: t("tabs.market") },
            {
              value: "grading",
              label: t("tabs.grading"),
              adornment:
                fresh > 0 ? (
                  <span
                    className="size-2 rounded-pill bg-accent"
                    data-testid="grading-dot"
                    aria-label={t("tabs.gradingBack")}
                  />
                ) : grading > 0 ? (
                  <span className="nums text-accent">{grading}</span>
                ) : undefined,
            },
          ]}
        />
      </div>
      {failed ? (
        <LoadError
          error={failed}
          onRetry={() => {
            void overview.refetch();
            void collection.refetch();
          }}
        />
      ) : (
        <>
          {tab === "shop" && <Shop overview={overview.data} collection={collection.data} />}
          {tab === "collection" && <Binder collection={collection.data} />}
          {tab === "market" && (
            <Market
              overview={overview.data}
              collection={collection.data}
              view={view}
              onViewChange={(next) => go({ view: next })}
              cardKey={cardKey}
              onCardChange={(next) => go({ card: next })}
            />
          )}
          {tab === "grading" && <GradingDesk overview={overview.data} collection={collection.data} />}
        </>
      )}
    </div>
  );
}

/** Before the unlock: what Nexamon is, the three packs behind glass and how far the level is away. */
function Teaser() {
  const t = useTranslations("nexamon");
  return (
    <div className="space-y-4" data-testid="nexamon-locked">
      <LockedFeature
        level={DISCLOSURE.nexamon}
        title={t("locked.title")}
        description={t("locked.text", { level: DISCLOSURE.nexamon })}
        art={<PixelIcon {...UI_ICONS.nexamon} scale={3} />}
      />
      <Card padding="lg">
        <ul className="flex items-end justify-center gap-3 opacity-60 grayscale" aria-hidden>
          {NEXAMON_SETS.map((set) => (
            <li key={set}>
              <NexamonPack set={set} scale={1} sheen={false} />
            </li>
          ))}
        </ul>
        <ul className="mt-4 space-y-1.5 text-sm text-pretty text-fg-2">
          <li>{t("locked.point1", { sets: NEXAMON_SETS.length, cards: NEXAMON_SET_SIZE })}</li>
          <li>
            {t("locked.point2", {
              best: formatFactor(BALANCE.nexamon.grading.valueBps.at(-1)!),
              black: formatFactor(BALANCE.nexamon.grading.blackLabel.valueBps),
            })}
          </li>
          <li>{t("locked.point3")}</li>
        </ul>
      </Card>
    </div>
  );
}
