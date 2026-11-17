"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import {
  NEXAMON_CARDS,
  NEXAMON_RARITIES,
  NEXAMON_SETS,
  nexamonCard,
  nexamonSetRarities,
  type NexamonRarity,
  type NexamonSetKey,
} from "@/config/nexamon";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  NexamonCollection,
  NexamonListing,
  NexamonMarketQuery,
  NexamonMarketSeller,
  NexamonMarketSort,
  NexamonOverview,
} from "@/features/game/nexamon-types";
import { formatInteger, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNexamonMarket, useRememberedFilters } from "../hooks";
import { ownListings, setsByPackPrice } from "../view";
import { CopyActions } from "./copy-actions";
import { BuySheet, DealNote, ListingRow } from "./listing-row";
import { NexamonPack } from "./pack";
import { CopyQuality, CopyVisual, SelectField } from "./parts";

export type MarketView = "all" | "mine";
type Graded = "all" | "raw" | "slab" | "black";

interface MarketFilters {
  set: NexamonSetKey | "all";
  rarity: NexamonRarity | "all";
  seller: NexamonMarketSeller;
  graded: Graded;
  sort: NexamonMarketSort;
}
const MARKET_DEFAULTS: MarketFilters = { set: "all", rarity: "all", seller: "all", graded: "all", sort: "new" };
const MARKET_ALLOWED = {
  set: ["all", ...NEXAMON_SETS],
  rarity: ["all", ...NEXAMON_RARITIES],
  seller: ["all", "players", "ai", "mine"],
  graded: ["all", "raw", "slab", "black"],
  sort: ["new", "price_asc", "price_desc", "deal", "value", "number"],
} as const;
const SORTS: readonly NexamonMarketSort[] = ["new", "price_asc", "price_desc", "deal", "value", "number"];
const SELLERS: readonly NexamonMarketSeller[] = ["all", "players", "ai", "mine"];
const GRADED: readonly Graded[] = ["all", "raw", "slab", "black"];
const GRADED_LABEL = {
  all: "market.condition.all",
  raw: "market.condition.raw",
  slab: "market.condition.graded",
  black: "market.graded.black",
} as const satisfies Record<Graded, string>;

const dateTime = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export interface MarketProps {
  overview: NexamonOverview | undefined;
  collection: NexamonCollection | undefined;
  view: MarketView;
  onViewChange: (view: MarketView) => void;
  /** Only offers of this card (from the card's page). */
  cardKey: string | null;
  onCardChange: (cardKey: string | null) => void;
  /** The set in the address (`?set=`); null: the remembered one, or the set picker. */
  setKey?: NexamonSetKey | null;
  /** Chooses a set (null: back to the set picker). */
  onSetChange?: (set: NexamonSetKey | null) => void;
}

/**
 * The card market (ADR-165): single copies from players and the AI sellers, filtered and sorted by the server,
 * page by page. The second view lists the own offers with the way to take them back.
 */
export function Market({
  overview,
  collection,
  view,
  onViewChange,
  cardKey,
  onCardChange,
  setKey = null,
  onSetChange,
}: MarketProps) {
  const t = useTranslations("nexamon");
  const mine = collection ? ownListings(collection.copies) : [];
  return (
    <div className="space-y-4" data-testid="nexamon-market">
      <Segmented<MarketView>
        value={view}
        onValueChange={onViewChange}
        label={t("market.view")}
        block
        options={[
          { value: "all", label: t("market.viewAll") },
          {
            value: "mine",
            label: t("market.viewMine"),
            adornment: mine.length > 0 ? <span className="nums text-accent">{mine.length}</span> : undefined,
          },
        ]}
      />
      {view === "mine" ? (
        <OwnListings collection={collection} limit={overview?.limits.maxListings ?? null} />
      ) : (
        <Listings cardKey={cardKey} onCardChange={onCardChange} setKey={setKey} onSetChange={onSetChange} />
      )}
    </div>
  );
}

/**
 * The market of one set (ADR-174): first a set is chosen (a tile per set with its pack, offers and price span),
 * then its offers with Raw / Graded and the other filters. The set comes from the address, else from the
 * remembered filters; a card from its page brings its own set.
 */
function Listings({
  cardKey,
  onCardChange,
  setKey,
  onSetChange,
}: Pick<MarketProps, "cardKey" | "onCardChange" | "setKey" | "onSetChange">) {
  const [filters, patchFilters] = useRememberedFilters<MarketFilters>("market", MARKET_DEFAULTS, MARKET_ALLOWED);
  const chosen: NexamonSetKey | "all" = (cardKey ? nexamonCard(cardKey)?.set : null) ?? setKey ?? filters.set;
  const choose = (next: NexamonSetKey | null) => {
    patchFilters({ set: next ?? "all", rarity: "all" });
    if (next === null && cardKey) onCardChange(null);
    onSetChange?.(next);
  };
  if (chosen === "all") return <SetPicker onPick={choose} />;
  return (
    <SetListings
      set={chosen}
      filters={filters}
      patchFilters={patchFilters}
      cardKey={cardKey}
      onCardChange={onCardChange}
      onBack={() => choose(null)}
    />
  );
}

/** One tile per set: the pack, how many offers, the cheapest and the most expensive one. */
function SetPicker({ onPick }: { onPick: (set: NexamonSetKey) => void }) {
  const t = useTranslations("nexamon");
  return (
    <section className="space-y-3" data-testid="market-set-picker">
      <div>
        <h3 className="font-pixel text-sm text-fg-1 uppercase">{t("market.sets.title")}</h3>
        <p className="mt-1 text-sm text-pretty text-fg-2">{t("market.sets.intro")}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {setsByPackPrice().map((set) => (
          <li key={set}>
            <SetTile set={set} onPick={onPick} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SetTile({ set, onPick }: { set: NexamonSetKey; onPick: (set: NexamonSetKey) => void }) {
  const t = useTranslations("nexamon");
  const tc = useTranslations("nexamonCards");
  const base = { set, rarity: null, seller: "all", graded: null, blackLabel: null, cardKey: null, page: 1 } as const;
  const low = useNexamonMarket({ ...base, sort: "price_asc" });
  const high = useNexamonMarket({ ...base, sort: "price_desc" });
  const total = low.data?.total;
  const cheapest = low.data?.listings[0]?.priceCents;
  const top = high.data?.listings[0]?.priceCents;
  return (
    <button
      type="button"
      onClick={() => onPick(set)}
      data-testid={`market-set-${set}`}
      aria-label={t("market.sets.open", { set: tc(`sets.${set}`) })}
      className="group flex h-full w-full items-center gap-3 rounded-lg border-2 border-line-1 bg-surface-1 p-3 text-left shadow-1 focus-ring transition duration-fast ease-standard hover:border-line-2 hover:bg-surface-2 active:translate-y-0.5 active:shadow-none"
    >
      <NexamonPack set={set} scale={1} sheen={false} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-pixel text-sm text-fg-1 uppercase">{tc(`sets.${set}`)}</span>
        {total === undefined ? (
          <Skeleton className="h-4 w-24 rounded-xs" />
        ) : (
          <span className="nums text-sm text-fg-2" data-testid="market-set-total">
            {t("market.sets.listings", { count: total })}
          </span>
        )}
        {cheapest !== undefined && (
          <span className="nums text-xs text-fg-3">{t("market.sets.cheapest", { price: formatMoney(cheapest) })}</span>
        )}
        {top !== undefined && (
          <span className="nums text-xs text-fg-3">{t("market.sets.top", { price: formatMoney(top) })}</span>
        )}
        <span className="mt-auto label-pixel text-accent transition-transform duration-fast group-hover:translate-x-0.5">
          <span aria-hidden>→</span>
        </span>
      </span>
    </button>
  );
}

function SetListings({
  set,
  filters,
  patchFilters,
  cardKey,
  onCardChange,
  onBack,
}: {
  set: NexamonSetKey;
  filters: MarketFilters;
  patchFilters: (patch: Partial<MarketFilters>) => void;
  cardKey: string | null;
  onCardChange: (cardKey: string | null) => void;
  onBack: () => void;
}) {
  const t = useTranslations("nexamon");
  const tc = useTranslations("nexamonCards");
  const listId = useId();
  const { rarity, seller, graded, sort } = filters;
  const setRarity = (value: NexamonRarity | "all") => patchFilters({ rarity: value });
  const setSeller = (value: NexamonMarketSeller) => patchFilters({ seller: value });
  const setGraded = (value: Graded) => patchFilters({ graded: value });
  const setSort = (value: NexamonMarketSort) => patchFilters({ sort: value });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [buying, setBuying] = useState<NexamonListing | null>(null);

  const query: NexamonMarketQuery = useMemo(
    () => ({
      set,
      rarity: rarity === "all" ? null : rarity,
      seller,
      graded: graded === "all" || graded === "black" ? null : graded === "slab",
      blackLabel: graded === "black" ? true : null,
      cardKey,
      sort,
      page,
    }),
    [set, rarity, seller, graded, cardKey, sort, page],
  );
  const market = useNexamonMarket(query);
  const data = market.data;
  // Every filter change starts on the first page again.
  const first =
    <T,>(apply: (value: T) => void) =>
    (value: T) => {
      apply(value);
      setPage(1);
    };
  const card = cardKey ? nexamonCard(cardKey) : undefined;
  const pick = (text: string) => {
    setSearch(text);
    const found = NEXAMON_CARDS.find((c) => c.set === set && c.name.toLowerCase() === text.trim().toLowerCase());
    if (found) {
      onCardChange(found.key);
      setSearch("");
      setPage(1);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onBack} data-testid="market-back">
          <span aria-hidden>←</span> {t("market.sets.back")}
        </Button>
        <span className="flex items-center gap-2 font-pixel text-sm text-fg-1 uppercase" data-testid="market-set-title">
          <NexamonPack set={set} scale={1} sheen={false} className="h-8 w-auto" />
          {tc(`sets.${set}`)}
        </span>
      </div>
      <div data-testid="market-condition">
        <Segmented<Graded>
          value={graded}
          onValueChange={first(setGraded)}
          label={t("market.condition.label")}
          block
          options={GRADED.map((key) => ({ value: key, label: t(GRADED_LABEL[key]) }))}
        />
      </div>
      <div className="space-y-3 rounded-lg bg-surface-2 p-3">
        <div className="grid grid-cols-2 items-end gap-2 lg:grid-cols-4">
          <SelectField<NexamonRarity | "all">
            label={t("filter.rarity")}
            value={rarity}
            onChange={first(setRarity)}
            testId="market-rarity"
            options={[
              { value: "all", label: t("filter.allRarities") },
              ...nexamonSetRarities(set)
                .reverse()
                .map((key) => ({ value: key, label: tc(`rarityShort.${key}`) })),
            ]}
          />
          <SelectField<NexamonMarketSeller>
            label={t("filter.seller")}
            value={seller}
            onChange={first(setSeller)}
            testId="market-seller"
            options={SELLERS.map((key) => ({ value: key, label: t(`market.seller.${key}`) }))}
          />
          <SelectField<NexamonMarketSort>
            label={t("filter.sort")}
            value={sort}
            onChange={first(setSort)}
            testId="market-sort"
            options={SORTS.map((key) => ({ value: key, label: t(`market.sort.${key}`) }))}
          />
          {card ? (
            <p
              className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-fg-2"
              data-testid="market-card-filter"
            >
              {t("market.onlyCard")}
              <Link href={`/nexamon/${card.key}`} className="font-medium text-accent focus-ring hover:underline">
                {card.name}
              </Link>
              <Button size="sm" variant="ghost" onClick={() => onCardChange(null)}>
                {t("market.clearCard")}
              </Button>
            </p>
          ) : (
            <label className="flex flex-col gap-1 label-pixel text-fg-3">
              {t("market.search")}
              <input
                list={listId}
                value={search}
                onChange={(event) => pick(event.target.value)}
                placeholder={t("market.searchPlaceholder")}
                autoComplete="off"
                data-testid="market-search"
                className="h-10 w-full rounded-sm border-2 border-line-1 bg-surface-1 px-2 font-sans text-sm tracking-normal text-fg-1 normal-case focus-ring transition-colors duration-fast placeholder:text-fg-3 hover:border-line-2"
              />
              <datalist id={listId}>
                {NEXAMON_CARDS.filter((c) => c.set === set).map((c) => (
                  <option key={c.key} value={c.name} />
                ))}
              </datalist>
            </label>
          )}
        </div>
      </div>

      {!data ? (
        <ul className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i}>
              <Skeleton className="h-28 w-full rounded-lg" />
            </li>
          ))}
        </ul>
      ) : data.listings.length === 0 ? (
        <EmptyState
          art={<PixelIcon {...UI_ICONS.search} scale={4} />}
          title={t("market.emptyTitle")}
          description={t("market.emptyText")}
        />
      ) : (
        <>
          <p className="nums text-xs text-fg-3" data-testid="market-total">
            {t("market.total", { count: data.total, shown: formatInteger(data.total) })}
          </p>
          <ul
            className={cn(
              "grid gap-2 transition-opacity duration-fast lg:grid-cols-2",
              market.isPlaceholderData && "opacity-60",
            )}
            data-testid="market-list"
          >
            {data.listings.map((listing) => (
              <ListingRow
                key={listing.id}
                listing={listing}
                onBuy={setBuying}
                className="rounded-lg border-2 border-line-1 bg-surface-1 shadow-1"
              />
            ))}
          </ul>
          {data.pages > 1 && (
            <nav className="flex items-center justify-center gap-3" aria-label={t("market.pages")}>
              <Button
                size="sm"
                variant="secondary"
                disabled={data.page <= 1}
                onClick={() => setPage(Math.max(1, data.page - 1))}
                data-testid="market-prev"
              >
                {t("market.prev")}
              </Button>
              <span className="nums text-sm text-fg-2" data-testid="market-page">
                {t("market.page", { page: data.page, pages: data.pages })}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={data.page >= data.pages}
                onClick={() => setPage(Math.min(data.pages, data.page + 1))}
                data-testid="market-next"
              >
                {t("market.next")}
              </Button>
            </nav>
          )}
        </>
      )}
      <BuySheet listing={buying} onClose={() => setBuying(null)} />
    </div>
  );
}

function OwnListings({ collection, limit }: { collection: NexamonCollection | undefined; limit: number | null }) {
  const t = useTranslations("nexamon");
  if (!collection) return <Skeleton className="h-40 w-full rounded-lg" />;
  const mine = ownListings(collection.copies);
  if (mine.length === 0) {
    return (
      <EmptyState
        art={<PixelIcon {...UI_ICONS.deal} scale={4} />}
        title={t("market.mineEmptyTitle")}
        description={t("market.mineEmptyText")}
        action={
          <Link href="/nexamon?tab=collection" className="text-sm font-medium text-accent focus-ring hover:underline">
            {t("market.toCollection")}
          </Link>
        }
      />
    );
  }
  return (
    <div className="space-y-3" data-testid="own-listings">
      {limit !== null && (
        <p className="nums text-xs text-fg-3">{t("market.mineCount", { count: mine.length, max: limit })}</p>
      )}
      <ul className="grid gap-2 lg:grid-cols-2">
        {mine.map((copy) => {
          const card = nexamonCard(copy.cardKey);
          if (!card || !copy.listing) return null;
          return (
            <li key={copy.id} data-testid="own-listing" data-card={copy.cardKey}>
              <Card padding="none" className="flex items-center gap-3 px-3 py-2.5">
                <Link
                  href={`/nexamon/${card.key}`}
                  aria-label={card.name}
                  className="shrink-0 self-end rounded-sm focus-ring"
                >
                  <CopyVisual card={card} grade={copy.grade} serial={copy.serial} scale={1} />
                </Link>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <Link
                      href={`/nexamon/${card.key}`}
                      className="truncate font-medium text-fg-1 focus-ring hover:underline"
                    >
                      {card.name}
                    </Link>
                    <CopyQuality copy={copy} short />
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 nums text-xs text-fg-3">
                    <span>{t("serial", { serial: copy.serial })}</span>
                    <span>{t("market.since", { date: dateTime.format(new Date(copy.listing.listedAt)) })}</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-3">
                    {t("market.worth", { value: formatMoney(copy.valueCents) })}
                    <DealNote priceCents={copy.listing.priceCents} valueCents={copy.valueCents} />
                  </p>
                  <CopyActions copy={copy} card={card} />
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
