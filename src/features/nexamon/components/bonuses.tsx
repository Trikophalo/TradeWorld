"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { BALANCE } from "@/config/balance";
import { NEXAMON_SETS, nexamonCard, type NexamonType } from "@/config/nexamon";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  NexamonBonusKind,
  NexamonBonuses,
  NexamonCardBonus,
  NexamonCollectionProgress,
} from "@/features/game/nexamon-types";
import { formatBps } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNexamonBonuses } from "../hooks";
import { SetIcon, TypeIcon } from "./badges";
import { LoadError } from "./parts";

/*
 * Card bonuses (ADR-171): the small tag a card shows, and the "Boni" tab with the totals against the caps and the
 * progress of every collection, with links to the market for what is missing (laid out anew in ADR-204).
 */
export const BONUS_ICON: Record<NexamonBonusKind, keyof typeof UI_ICONS> = {
  xp: "star",
  mission_xp: "upgrade",
  trade_xp: "markets",
  wage: "briefcase",
  vault: "estate",
  daily: "gift",
  company: "company",
};

/** "+0,5 % Tresorzinsen" with the kind's icon; dimmed while the bonus is not active. */
export function BonusTag({
  bonus,
  className,
  showState = true,
}: {
  bonus: Pick<NexamonCardBonus, "kind" | "bps" | "boostedBps" | "active">;
  className?: string;
  showState?: boolean;
}) {
  const t = useTranslations("nexamon.bonuses");
  const bps = bonus.active ? bonus.boostedBps : bonus.bps;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        showState && !bonus.active ? "text-fg-3" : "text-gain",
        className,
      )}
      data-testid="nexamon-bonus-tag"
      data-active={bonus.active}
    >
      <PixelIcon {...UI_ICONS[BONUS_ICON[bonus.kind]]} scale={1} />
      <span className="nums">{t("tag", { bps: formatBps(bps), kind: t(`kinds.${bonus.kind}`) })}</span>
      {showState && <span className="sr-only">{t(bonus.active ? "active" : "inactive")}</span>}
    </span>
  );
}

/** A ring that fills with `value` (0..1): the cap of a bonus kind or the progress of a collection. Static SVG. */
function Ring({
  value,
  size = 56,
  stroke = 5,
  tone,
  children,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone: "gain" | "gold" | "accent" | "dim";
  children?: ReactNode;
  label: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, value));
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90"
        aria-hidden
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-line-1" />
        {v > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeDasharray={`${c * v} ${c}`}
            strokeLinecap="butt"
            className={cn(
              tone === "gold"
                ? "stroke-gold"
                : tone === "gain"
                  ? "stroke-gain"
                  : tone === "accent"
                    ? "stroke-accent"
                    : "stroke-fg-3",
            )}
          />
        )}
      </svg>
      <span className="relative">{children}</span>
    </span>
  );
}

/** ADR-204: the incomplete collections closest to done, best first (share of cards, then fewest missing). */
export function nextCollections(cols: readonly NexamonCollectionProgress[], count = 3): NexamonCollectionProgress[] {
  return cols
    .filter((c) => !c.complete && c.have > 0)
    .sort((a, b) => b.have / b.need - a.have / a.need || a.need - a.have - (b.need - b.have))
    .slice(0, count);
}

/**
 * The "Boni" tab (ADR-171, redesigned in ADR-204). On top the seven bonus kinds as rings against their caps, then
 * the collections closest to done ("Als Nächstes"), the bonus cards (active first, the others on request) and every
 * set folded: a set opens to its complete and master set and a grid of its type collections. Nothing of the old tab
 * is gone, it is only one tap away.
 */
export function BonusesView() {
  const t = useTranslations("nexamon.bonuses");
  const query = useNexamonBonuses();
  const [showRule, setShowRule] = useState(false);
  const [showAllCards, setShowAllCards] = useState(false);
  const [openSet, setOpenSet] = useState<string | null | undefined>(undefined);
  if (!query.data && query.error) return <LoadError error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <BonusesSkeleton />;
  const data = query.data;
  const activeCards = data.cards.filter((c) => c.active);
  const inactiveCards = data.cards.filter((c) => !c.active);
  const next = nextCollections(data.collections);
  const activeKinds = data.totals.filter((x) => x.effectiveBps > 0).length;
  // The set with the most progress opens by itself (until the player picks one).
  const progressOf = (set: string) =>
    data.collections.filter((c) => c.set === set).reduce((sum, c) => sum + c.have / Math.max(1, c.need), 0);
  const firstOpen = [...NEXAMON_SETS].sort((a, b) => progressOf(b) - progressOf(a))[0] ?? null;
  const open = openSet === undefined ? firstOpen : openSet;

  return (
    <div className="space-y-4" data-testid="nexamon-bonuses">
      {/* The seven kinds against their caps. */}
      <Card padding="md" className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg-1">{t("totals")}</h2>
            <p className="mt-0.5 nums text-xs text-fg-2">
              {t("activeKinds", { n: activeKinds, total: data.totals.length })}
            </p>
          </div>
          <button
            type="button"
            aria-expanded={showRule}
            onClick={() => setShowRule((v) => !v)}
            className="h-8 shrink-0 rounded-sm px-2 text-xs font-medium text-accent focus-ring transition-colors duration-fast hover:bg-surface-2 active:scale-[0.98]"
            data-testid="bonus-rule-toggle"
          >
            {t(showRule ? "ruleHide" : "ruleShow")}
          </button>
        </div>
        {showRule && <p className="rounded-md bg-surface-2 p-2.5 text-xs text-pretty text-fg-2">{t("totalsHint")}</p>}
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {data.totals.map((total) => {
            const capped = total.effectiveBps >= total.capBps && total.capBps > 0;
            const on = total.effectiveBps > 0;
            return (
              <li
                key={total.kind}
                data-testid={`bonus-total-${total.kind}`}
                data-active={on}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md border-2 px-2 py-2.5 text-center",
                  capped
                    ? "border-gold bg-surface-2"
                    : on
                      ? "border-gain/50 bg-surface-1"
                      : "border-line-1 bg-surface-1",
                )}
              >
                <Ring
                  value={total.capBps > 0 ? total.effectiveBps / total.capBps : 0}
                  tone={capped ? "gold" : on ? "gain" : "dim"}
                  label={t(`kinds.${total.kind}`)}
                >
                  <PixelIcon {...UI_ICONS[BONUS_ICON[total.kind]]} scale={2} className={cn(!on && "opacity-40")} />
                </Ring>
                <span className="text-xs font-medium text-fg-1">{t(`kinds.${total.kind}`)}</span>
                <span className={cn("nums text-sm font-semibold", on ? "text-gain" : "text-fg-3")}>
                  {formatBps(total.effectiveBps)}
                </span>
                <span className="nums text-2xs text-fg-3">{t("capShort", { cap: formatBps(total.capBps) })}</span>
                {/* the long form for screen readers and the tests: "1,5 % von max. 5 %" */}
                <span className="sr-only">
                  {t("ofCap", { value: formatBps(total.effectiveBps), cap: formatBps(total.capBps) })}
                </span>
                {total.rawBps > total.effectiveBps && (
                  <Badge tone="warn">{t("diminishedShort", { raw: formatBps(total.rawBps) })}</Badge>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Closest to done: the next bonus within reach. */}
        <Card padding="md" className="space-y-3" data-testid="bonus-next">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg-1">
            <PixelIcon {...UI_ICONS.star} scale={2} />
            {t("next")}
          </h2>
          {next.length === 0 ? (
            <EmptyState
              art={<PixelIcon {...UI_ICONS.card} scale={3} />}
              title={t("nextEmptyTitle")}
              description={t("nextEmptyText")}
            />
          ) : (
            <ul className="space-y-3">
              {next.map((col) => (
                <li key={col.id} className="rounded-md border-2 border-accent/40 bg-surface-2 p-2.5">
                  <p className="mb-1.5 flex items-center gap-1.5 label-pixel text-fg-3">
                    <SetIcon set={col.set} scale={1} />
                    {BALANCE.nexamon.sets[col.set].name}
                  </p>
                  <CollectionRow col={col} testId={`bonus-next-${col.id}`} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* The bonus cards: active ones, the rest on request. */}
        <Card padding="md" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg-1">
              {t("cards", { n: activeCards.length, total: data.cards.length })}
            </h2>
            <Ring
              value={data.cards.length > 0 ? activeCards.length / data.cards.length : 0}
              size={36}
              stroke={4}
              tone="gain"
              label={t("cards", { n: activeCards.length, total: data.cards.length })}
            >
              <span className="nums text-2xs font-semibold text-fg-1">{activeCards.length}</span>
            </Ring>
          </div>
          {activeCards.length === 0 ? (
            <EmptyState
              art={<PixelIcon {...UI_ICONS.card} scale={3} />}
              title={t("noneTitle")}
              description={t("noneText")}
            />
          ) : (
            <BonusCardList cards={activeCards} />
          )}
          {inactiveCards.length > 0 && (
            <>
              <button
                type="button"
                aria-expanded={showAllCards}
                onClick={() => setShowAllCards((v) => !v)}
                className="text-xs text-fg-2 underline-offset-2 focus-ring hover:text-fg-1 hover:underline"
                data-testid="bonus-cards-toggle"
              >
                {t(showAllCards ? "hideMissingCards" : "showMissingCards", { n: inactiveCards.length })}
              </button>
              {showAllCards && <BonusCardList cards={inactiveCards} missing />}
            </>
          )}
        </Card>
      </div>

      {/* Every set, folded. */}
      <section className="space-y-2" aria-labelledby="bonus-sets-title">
        <h2 id="bonus-sets-title" className="label-pixel text-fg-2">
          {t("setsTitle")}
        </h2>
        {NEXAMON_SETS.map((set) => (
          <SetProgress
            key={set}
            set={set}
            data={data}
            open={open === set}
            onToggle={() => setOpenSet(open === set ? null : set)}
          />
        ))}
      </section>
    </div>
  );
}

function BonusesSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-48 w-full rounded-lg" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
      {NEXAMON_SETS.map((set) => (
        <Skeleton key={set} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

function BonusCardList({
  cards,
  missing = false,
}: {
  cards: readonly (NexamonCardBonus & { cardKey: string })[];
  missing?: boolean;
}) {
  return (
    <ul className="grid gap-x-3 sm:grid-cols-2" data-testid={missing ? "bonus-cards-missing" : "bonus-cards-active"}>
      {cards.map((c) => (
        <li
          key={c.cardKey}
          className="flex min-w-0 items-center justify-between gap-2 border-b border-line-1 py-1.5 text-sm"
        >
          <Link
            href={missing ? `/nexamon?tab=market&card=${c.cardKey}` : `/nexamon/${c.cardKey}`}
            className={cn("min-w-0 truncate focus-ring hover:text-accent", missing ? "text-fg-2" : "text-fg-1")}
          >
            {nexamonCard(c.cardKey)?.name ?? c.cardKey}
          </Link>
          <BonusTag bonus={c} className="shrink-0" />
        </li>
      ))}
    </ul>
  );
}

function SetProgress({
  set,
  data,
  open,
  onToggle,
}: {
  set: (typeof NEXAMON_SETS)[number];
  data: NexamonBonuses;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("nexamon.bonuses");
  const cols = data.collections.filter((c) => c.set === set);
  const complete = cols.find((c) => c.kind === "complete");
  const master = cols.find((c) => c.kind === "master");
  const types = cols.filter((c) => c.kind === "type");
  const done = cols.filter((c) => c.complete).length;
  const panelId = `bonus-set-panel-${set}`;
  return (
    <Card padding="none" className="overflow-hidden" data-testid={`bonus-set-${set}`} data-open={open}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left focus-ring transition-colors duration-fast hover:bg-surface-2 active:bg-surface-3 lg:px-4"
        data-testid={`bonus-set-toggle-${set}`}
      >
        <SetIcon set={set} scale={2} className="shrink-0 text-fg-1" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg-1">{BALANCE.nexamon.sets[set].name}</span>
          <span className="mt-1 flex items-center gap-2">
            {complete && (
              <Progress
                size="sm"
                tone={complete.complete ? "gold" : "accent"}
                value={complete.have / complete.need}
                label={t("kind.complete")}
                className="max-w-40 flex-1"
              />
            )}
            {complete && (
              <span className="shrink-0 nums text-xs text-fg-2">
                {complete.have}/{complete.need}
              </span>
            )}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className={cn("block nums text-sm font-semibold", done > 0 ? "text-gain" : "text-fg-3")}>
            {done}/{cols.length}
          </span>
          <span className="block text-2xs text-fg-3">{t("collectionsDone")}</span>
        </span>
        <span aria-hidden className={cn("shrink-0 text-fg-3 transition-transform duration-fast", open && "rotate-180")}>
          ▾
        </span>
      </button>
      {open && (
        <div id={panelId} className="space-y-3 border-t-2 border-line-1 px-3 py-3 lg:px-4">
          <div className="grid gap-3 lg:grid-cols-2">
            {complete && (
              <div className="rounded-md bg-surface-2 p-2.5">
                <CollectionRow col={complete} />
              </div>
            )}
            {master && (
              <div className="rounded-md bg-surface-2 p-2.5">
                <CollectionRow col={master} />
              </div>
            )}
          </div>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {types.map((col) => (
              <li key={col.id}>
                <TypeTile col={col} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-pretty text-fg-3">
            {t("masterRule", { grade: BALANCE.nexamon.bonuses.sets.masterMinGrade })}
          </p>
        </div>
      )}
    </Card>
  );
}

function bonusText(t: ReturnType<typeof useTranslations<"nexamon.bonuses">>, col: NexamonCollectionProgress) {
  return col.bonusKind
    ? t("tag", { bps: formatBps(col.bonusBps), kind: t(`kinds.${col.bonusKind}`) })
    : t("everyKind", { bps: formatBps(col.bonusBps) });
}

function MissingLinks({ col, max }: { col: NexamonCollectionProgress; max: number }) {
  const t = useTranslations("nexamon.bonuses");
  return (
    <p className="text-xs text-fg-2">
      {t("missing")}{" "}
      {col.missing.slice(0, max).map((key, i) => (
        <span key={key}>
          {i > 0 && ", "}
          <Link
            href={`/nexamon?tab=market&card=${key}`}
            className="text-accent underline-offset-2 focus-ring hover:underline"
            data-testid="bonus-missing-link"
          >
            {nexamonCard(key)?.name ?? key}
          </Link>
        </span>
      ))}
      {col.missing.length > max && ` ${t("more", { n: col.missing.length - max })}`}
    </p>
  );
}

/** A type collection as a small tile: ring, type, count and bonus; the missing cards when only a few are left. */
function TypeTile({ col }: { col: NexamonCollectionProgress }) {
  const t = useTranslations("nexamon.bonuses");
  const tc = useTranslations("nexamonCards");
  const type = col.type as NexamonType;
  const title = t("typeCollection", { type: tc(`types.${type}`) });
  return (
    <div
      className={cn(
        "flex h-full gap-2.5 rounded-md border-2 p-2",
        col.complete ? "border-gold bg-surface-2" : "border-line-1 bg-surface-1",
      )}
      data-testid={`bonus-col-${col.id}`}
      data-complete={col.complete}
    >
      <Ring value={col.have / col.need} size={44} stroke={4} tone={col.complete ? "gold" : "accent"} label={title}>
        <TypeIcon type={type} scale={2} />
      </Ring>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="truncate text-fg-1">{title}</span>
          <span className="shrink-0 nums text-xs text-fg-2">
            {col.have}/{col.need}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {col.complete ? <Badge tone="gain">{t("activeBadge")}</Badge> : null}
          <span className={col.complete ? "text-gain" : "text-fg-3"}>{bonusText(t, col)}</span>
          {col.completedAt && !col.complete && <span className="text-fg-3">{t("rewardPaid")}</span>}
        </div>
        {!col.complete && col.missing.length > 0 && col.missing.length <= 4 && <MissingLinks col={col} max={4} />}
      </div>
    </div>
  );
}

function CollectionRow({ col, testId }: { col: NexamonCollectionProgress; testId?: string }) {
  const t = useTranslations("nexamon.bonuses");
  const tc = useTranslations("nexamonCards");
  const title =
    col.kind === "type" ? t("typeCollection", { type: tc(`types.${col.type as NexamonType}`) }) : t(`kind.${col.kind}`);
  return (
    <div className="space-y-1" data-testid={testId ?? `bonus-col-${col.id}`} data-complete={col.complete}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate font-medium text-fg-1">{title}</span>
        <span className="shrink-0 nums text-fg-2">
          {col.have}/{col.need}
        </span>
      </div>
      <Progress size="sm" tone={col.complete ? "gold" : "accent"} value={col.have / col.need} label={title} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {col.complete ? <Badge tone="gain">{t("activeBadge")}</Badge> : null}
        <span className={col.complete ? "text-gain" : "text-fg-3"}>{bonusText(t, col)}</span>
        {col.completedAt && !col.complete && <span className="text-fg-3">{t("rewardPaid")}</span>}
      </div>
      {!col.complete && col.missing.length > 0 && <MissingLinks col={col} max={6} />}
    </div>
  );
}
