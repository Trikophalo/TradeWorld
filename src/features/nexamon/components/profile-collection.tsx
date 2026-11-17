"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import { BALANCE } from "@/config/balance";
import { nexamonCard, type NexamonCard, type NexamonType } from "@/config/nexamon";
import { DISCLOSURE } from "@/config/disclosure";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlayerNexamonCard } from "@/features/game/nexamon-types";
import { useDisclosed } from "@/features/progression/components/reveal";
import { formatMoney, formatMoneyShort } from "@/lib/format";
import { usePlayerNexamon } from "../hooks";
import { profileBinder, tileMoney } from "../view";
import { RarityBadge, SetIcon } from "./badges";
import { CopyVisual, LoadError, Stat } from "./parts";
import { SlabList } from "./slab-list";

/** Cards in the showcase of a profile: two rows on a phone, one on a wide screen. */
const SHOWCASE_CARDS = 8;
const GRID = "grid grid-cols-[repeat(auto-fill,86px)] items-end justify-between gap-x-1 gap-y-3";

/**
 * A player's collectibles on their profile (ADR-165): the collection in numbers, the most valuable cards (slabs
 * as slabs) and the whole binder behind a button, read-only. `nickname` null is the own collection, which also
 * links to the place where the cards are managed. Players without cards (or below the level) show nothing;
 * the own profile then says how to get the first card.
 */
export function ProfileNexamon({ nickname }: { nickname: string | null }) {
  const t = useTranslations("nexamon.profile");
  const state = usePlayerNexamon(nickname, SHOWCASE_CARDS);
  const [open, setOpen] = useState(false);
  const data = state.data;
  const own = nickname === null || data?.isMe === true;

  if (!data) {
    // Somebody else's profile stays quiet until there is something to show; the own one keeps its place.
    return nickname === null && !state.isError ? <Skeleton className="h-64 w-full rounded-xl" /> : null;
  }
  if (!data.unlocked) return null;
  if (data.summary.copies === 0) {
    if (!own) return null;
    return (
      <Card padding="lg" className="space-y-3" data-testid="profile-nexamon" data-empty="true">
        <p className="label-pixel text-fg-2">{t("title")}</p>
        <EmptyState
          className="py-4"
          art={<PixelIcon {...UI_ICONS.nexamon} scale={3} />}
          title={t("emptyTitle")}
          description={t("emptyText")}
          action={
            <Link href="/nexamon?tab=shop" className={buttonVariants({ variant: "secondary" })}>
              {t("toShop")}
            </Link>
          }
        />
      </Card>
    );
  }

  const { summary } = data;
  return (
    <Card padding="lg" className="space-y-4" data-testid="profile-nexamon">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="label-pixel text-fg-2">{t("title")}</p>
        <p className="nums text-xs text-fg-3" data-testid="profile-nexamon-summary">
          {t("summary", { copies: summary.copies, distinct: summary.distinct, total: summary.total })}
        </p>
      </div>
      {own && <p className="text-sm text-pretty text-fg-2">{t("hint")}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t("copies")} testId="profile-nexamon-copies">
          {summary.copies}
        </Stat>
        <Stat label={t("distinct")}>{`${summary.distinct} / ${summary.total}`}</Stat>
        <Stat label={t("value")} testId="profile-nexamon-value">
          <span title={formatMoney(summary.valueCents)}>{formatMoneyShort(summary.valueCents)}</span>
        </Stat>
        <Stat
          label={t("slabs")}
          hint={summary.graded > 0 ? (summary.tens > 0 ? t("tens", { count: summary.tens }) : t("noTens")) : undefined}
          testId="profile-nexamon-slabs"
        >
          {summary.graded}
        </Stat>
      </div>
      {data.badges.length > 0 && <CollectionBadges badges={data.badges} />}
      <div className="space-y-2">
        <p className="label-pixel text-fg-3">{t("showcase")}</p>
        <ul className={GRID} data-testid="profile-nexamon-showcase">
          {data.cards.map((owned) => {
            const card = nexamonCard(owned.cardKey);
            return card ? <Tile key={owned.cardKey} card={card} owned={owned} badge /> : null;
          })}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setOpen(true)} data-testid="profile-nexamon-all">
          {t("viewAll")}
        </Button>
        {own && (
          <Link
            href="/nexamon?tab=collection"
            className={buttonVariants({ variant: "ghost" })}
            data-testid="profile-nexamon-manage"
          >
            {t("toCollection")}
          </Link>
        )}
      </div>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={own ? t("sheetTitleOwn") : t("sheetTitle", { name: data.nickname })}
        description={t("summary", { copies: summary.copies, distinct: summary.distinct, total: summary.total })}
      >
        {open && <FullCollection nickname={nickname} />}
      </Sheet>
    </Card>
  );
}

type Show = "owned" | "all" | "slabs";

/** The whole binder of a player, set by set, read-only. Asked for only once the sheet opens. */
function FullCollection({ nickname }: { nickname: string | null }) {
  const t = useTranslations("nexamon.profile");
  const tb = useTranslations("nexamon.binder");
  const state = usePlayerNexamon(nickname, null);
  const canOpen = useDisclosed("nexamon");
  const [show, setShow] = useState<Show>("owned");
  const groups = useMemo(
    () => (state.data ? profileBinder(state.data.cards, show === "owned") : []),
    [state.data, show],
  );

  if (!state.data) {
    if (state.isError) return <LoadError error={state.error} onRetry={() => void state.refetch()} />;
    return (
      <div className={GRID}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="aspect-[72/100] rounded-sm" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-4" data-testid="profile-nexamon-binder">
      <p className="text-sm text-pretty text-fg-2">
        {canOpen ? t("sheetHint") : t("sheetHintLocked", { level: DISCLOSURE.nexamon })}
      </p>
      <Segmented<Show>
        value={show}
        onValueChange={setShow}
        label={t("show")}
        size="sm"
        block
        options={[
          { value: "owned", label: t("showOwned") },
          { value: "all", label: t("showAll") },
          { value: "slabs", label: tb("slabsOnly") },
        ]}
      />
      {show === "slabs" && (
        <SlabList
          linkCards={canOpen}
          items={state.data.slabs.map((s, i) => ({
            id: `${s.cardKey}-${s.serial}-${i}`,
            cardKey: s.cardKey,
            serial: s.serial,
            grade: s.grade,
            valueCents: s.valueCents,
          }))}
        />
      )}
      {show !== "slabs" &&
        groups.map((group) => (
          <section key={group.set} className="space-y-2" data-set={group.set}>
            <h3 className="flex items-center justify-between gap-2">
              <SetIcon set={group.set} label className="font-pixel text-xs uppercase" />
              <span className="nums text-xs text-fg-3">
                {t("setCount", { owned: group.owned, total: group.total })}
              </span>
            </h3>
            <ul className={GRID}>
              {group.entries.map((entry) => (
                <Tile key={entry.card.key} card={entry.card} owned={entry.owned} />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

/** Completed collections (ADR-171): type collections, full sets and master sets as small badges. */
function CollectionBadges({ badges }: { badges: { set: string; kind: string; type: string | null }[] }) {
  const t = useTranslations("nexamon.profile");
  const tc = useTranslations("nexamonCards");
  const setName = (set: string) => BALANCE.nexamon.sets[set as keyof typeof BALANCE.nexamon.sets]?.name ?? set;
  // the bigger badges first
  const order: Record<string, number> = { master: 0, complete: 1, type: 2 };
  return (
    <div className="space-y-1.5" data-testid="profile-nexamon-badges">
      <p className="label-pixel text-fg-3">{t("badges")}</p>
      <ul className="flex flex-wrap gap-1.5">
        {[...badges]
          .sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3))
          .map((b) => (
            <li key={`${b.set}:${b.kind}:${b.type ?? ""}`}>
              <Badge tone={b.kind === "master" ? "warn" : b.kind === "complete" ? "gain" : "neutral"}>
                {b.kind === "type"
                  ? t("badge.type", { type: tc(`types.${b.type as NexamonType}`), set: setName(b.set) })
                  : t(b.kind === "master" ? "badge.master" : "badge.complete", { set: setName(b.set) })}
              </Badge>
            </li>
          ))}
      </ul>
    </div>
  );
}

/**
 * One card of somebody's collection: the best copy (its slab once graded), how many there are and what it is
 * worth. Leads to the card's page once the viewer has reached the Nexamon level.
 */
function Tile({ card, owned, badge = false }: { card: NexamonCard; owned: PlayerNexamonCard | null; badge?: boolean }) {
  const t = useTranslations("nexamon.profile");
  const tb = useTranslations("nexamon.binder");
  const canOpen = useDisclosed("nexamon");
  const label = owned
    ? t("cardLabel", { name: card.name, count: owned.copies, value: formatMoney(owned.valueCents) })
    : t("missingLabel", { name: card.name });
  const body: ReactNode = (
    <>
      <span className="relative block transition-transform duration-fast ease-out group-hover:-translate-y-0.5 group-active:scale-[0.97]">
        <CopyVisual card={card} grade={owned?.grade ?? null} serial={owned?.serial} dimmed={!owned} />
        {owned && owned.copies > 1 && (
          <span
            className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-pill bg-accent-strong px-1 nums text-2xs font-semibold text-on-accent shadow-1"
            data-testid="profile-tile-count"
          >
            ×{owned.copies}
          </span>
        )}
      </span>
      {badge && <RarityBadge rarity={card.rarity} short />}
      <span className="nums text-2xs text-fg-3">
        {owned ? <span className="font-medium text-fg-1">{tileMoney(owned.valueCents)}</span> : tb("missing")}
      </span>
    </>
  );
  return (
    <li
      data-card={card.key}
      data-owned={owned !== null}
      data-graded={owned?.grade != null}
      data-testid="profile-nexamon-tile"
    >
      {canOpen ? (
        <Link
          href={`/nexamon/${card.key}`}
          aria-label={label}
          className="group flex flex-col items-center gap-1 rounded-sm focus-ring"
        >
          {body}
        </Link>
      ) : (
        <span title={label} className="group flex flex-col items-center gap-1">
          {body}
        </span>
      )}
    </li>
  );
}
