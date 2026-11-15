"use client";

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import { ToggleGroup } from "radix-ui";
import { useDeferredValue, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { burstConfetti } from "@/components/ui/effects";
import { EmptyState } from "@/components/ui/empty-state";
import { LockBadge } from "@/components/ui/lock-badge";
import { PlayerFigure } from "@/components/ui/player-figure";
import { PlazaGround } from "@/components/ui/plaza-ground";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import {
  ACCESSORIES,
  ACCESSORY_RARITIES,
  accessoryByKey,
  type AccessoryItem,
  type AccessoryRarity,
} from "@/config/accessories";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame, usePlayerLevel } from "@/features/game/store";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import {
  DEFAULT_WARDROBE_FILTER,
  SHOP_SLOTS,
  WARDROBE_SORTS,
  filterAccessories,
  groupBySet,
  isFiltered,
  type WardrobeFilter,
  type WardrobeSort,
} from "../filter";
import { previewWorn, useSetWardrobe, useWardrobe } from "../hooks";
import { RARITY_STYLE } from "./rarity";

const slotOf = (key: string) => accessoryByKey(key)?.slot;
/** Rarities a purchase is celebrated louder for. */
const BIG_RARITIES: readonly AccessoryRarity[] = ["epic", "legendary", "mythic"];

/**
 * The wardrobe and accessory shop (ADR-155): the own figure large on a stage, every accessory to try on, buy,
 * put on and take off. A purchase is celebrated with confetti and a fanfare (both quiet with reduced motion / sound
 * off).
 */
export function WardrobeView() {
  const t = useTranslations("wardrobe");
  const errorText = useGameErrorText();
  const wardrobe = useWardrobe();
  const setWardrobe = useSetWardrobe();
  const level = usePlayerLevel();
  const cash = useGame((state) => state.portfolio?.cashCents ?? 0);
  const avatarKey = useGame((state) => state.portfolio?.avatarKey ?? null);
  const [filter, setFilter] = useState<WardrobeFilter>(DEFAULT_WARDROBE_FILTER);
  const [bySets, setBySets] = useState(false);
  const query = useDeferredValue(filter.query);
  const [preview, setPreview] = useState<string | null>(null);
  const [actions, setActions] = useState<Record<string, ButtonState>>({});
  const stage = useRef<HTMLDivElement>(null);

  const owned = useMemo(() => wardrobe.data?.owned ?? [], [wardrobe.data]);
  const items = useMemo(
    () => filterAccessories(ACCESSORIES, { ...filter, query }, { owned, level, cashCents: cash }),
    [filter, query, owned, level, cash],
  );

  if (!wardrobe.data) return <WardrobeSkeleton />;
  const { worn } = wardrobe.data;
  const shown = previewWorn(worn, preview, slotOf);
  const figureKey = wardrobe.data.avatarKey || avatarKey;
  const patch = (next: Partial<WardrobeFilter>) => setFilter((current) => ({ ...current, ...next }));

  const setAction = (key: string, state: ButtonState) => setActions((all) => ({ ...all, [key]: state }));

  const buy = async (item: AccessoryItem) => {
    setAction(item.key, "loading");
    try {
      const result = await engine.buyAccessory(crypto.randomUUID(), item.key);
      setWardrobe(result);
      setPreview(null);
      void useGame.getState().refreshPortfolio();
      setAction(item.key, "success");
      window.setTimeout(() => setAction(item.key, "idle"), 900);
      void playSound(BIG_RARITIES.includes(item.rarity) ? "levelUp" : "win");
      haptic("success");
      if (stage.current)
        burstConfetti(stage.current, item.rarity === "mythic" ? 72 : item.rarity === "legendary" ? 48 : 28);
      toast.success(t("bought", { name: item.name }), t("boughtText"), { silent: true });
    } catch (error) {
      setAction(item.key, "idle");
      toast.error(t("title"), errorText(error));
    }
  };

  const wear = async (item: AccessoryItem, on: boolean) => {
    setAction(item.key, "loading");
    try {
      setWardrobe(await engine.wearAccessory(crypto.randomUUID(), item.key, on));
      if (preview && slotOf(preview) === item.slot) setPreview(null);
      setAction(item.key, "idle");
      void playSound(on ? "toggle" : "tap");
      haptic("tap");
    } catch (error) {
      setAction(item.key, "idle");
      toast.error(t("title"), errorText(error));
    }
  };

  const renderItem = (item: AccessoryItem) => (
    <ItemCard
      key={item.key}
      item={item}
      avatarKey={figureKey}
      owned={owned.includes(item.key)}
      worn={worn.includes(item.key)}
      trying={preview === item.key}
      locked={level < item.minLevel}
      affordable={cash >= item.priceCents}
      state={actions[item.key] ?? "idle"}
      onTry={() => {
        setPreview((current) => (current === item.key ? null : item.key));
        void playSound("tap");
      }}
      onBuy={() => void buy(item)}
      onWear={(on) => void wear(item, on)}
    />
  );

  return (
    <div className="grid gap-5 *:min-w-0 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-6">
      <div className="lg:sticky lg:top-20 lg:self-start">
        <Card padding="none" className="overflow-hidden" data-testid="wardrobe-stage">
          <div ref={stage} className="relative isolate grid place-items-center bg-spotlight px-4 pt-6 pb-0">
            <span aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-14">
              <PlazaGround />
            </span>
            <AnimatePresence>
              {preview && (
                <motion.span
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: DURATION.fast, ease: EASE.out }}
                  className="absolute top-3 left-3"
                >
                  <Badge tone="accent" data-testid="wardrobe-preview">
                    {t("trying")}
                  </Badge>
                </motion.span>
              )}
            </AnimatePresence>
            <span className="absolute top-3 right-3 nums text-2xs text-fg-3">
              {t("collected", { owned: owned.length, total: ACCESSORIES.length })}
            </span>
            <StageFigure avatarKey={figureKey} worn={shown} />
          </div>
          <div className="space-y-3 border-t-2 border-line-1 p-4">
            {preview ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-pretty text-fg-2">{t("previewHint")}</p>
                <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                  {t("previewReset")}
                </Button>
              </div>
            ) : null}
            <div>
              <p className="label-pixel text-fg-3">{t("wearing")}</p>
              {worn.length === 0 ? (
                <p className="mt-1 text-sm text-fg-3">{t("wearingNothing")}</p>
              ) : (
                <ul className="mt-1.5 flex flex-wrap gap-1.5" data-testid="wardrobe-worn">
                  {worn.map((key) => {
                    const item = accessoryByKey(key);
                    if (!item) return null;
                    return (
                      <li key={key} className={cn("rounded-xs px-1.5 py-0.5 text-xs", RARITY_STYLE[item.rarity].soft)}>
                        <span className={RARITY_STYLE[item.rarity].text}>{item.name}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <ShopFilters
          filter={filter}
          onChange={patch}
          bySets={bySets}
          onBySets={setBySets}
          count={items.length}
          onReset={() => setFilter(DEFAULT_WARDROBE_FILTER)}
        />

        {items.length === 0 ? (
          <Card padding="none">
            <EmptyState
              art={<PlayerFigure avatarKey={figureKey} accessories={["tinfoil_hat"]} scale={2} />}
              title={t("emptyTitle")}
              description={t("emptyText")}
              action={
                <Button size="sm" variant="secondary" onClick={() => setFilter(DEFAULT_WARDROBE_FILTER)}>
                  {t("resetFilters")}
                </Button>
              }
            />
          </Card>
        ) : bySets ? (
          <div className="space-y-6" data-testid="wardrobe-sets">
            {groupBySet(items).map((group) => {
              const all = ACCESSORIES.filter((a) => a.set === (group.set ?? undefined));
              return (
                <section key={group.set ?? "none"} data-testid="wardrobe-set" data-set={group.set ?? "none"}>
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <h2 className="font-pixel text-sm text-fg-1 uppercase">
                      {group.set ? t(`sets.${group.set}`) : t("singles")}
                    </h2>
                    <span className="nums text-2xs text-fg-3">
                      {t("setOwned", {
                        owned: all.filter((a) => owned.includes(a.key)).length,
                        total: all.length,
                      })}
                    </span>
                  </div>
                  <ItemGrid>{group.items.map(renderItem)}</ItemGrid>
                </section>
              );
            })}
          </div>
        ) : (
          <ItemGrid>{items.map(renderItem)}</ItemGrid>
        )}
      </div>
    </div>
  );
}

function ItemGrid({ children }: { children: ReactNode }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4" data-testid="wardrobe-items">
      {children}
    </ul>
  );
}

const chip = (active: boolean) =>
  cn(
    "h-8 shrink-0 rounded-sm border-2 px-3 label-pixel focus-ring transition duration-fast ease-standard active:scale-95",
    active
      ? "border-accent bg-accent-soft text-accent"
      : "border-line-1 bg-surface-1 text-fg-2 hover:border-line-2 hover:text-fg-1",
  );

/** Search, slot and rarity chips, sorting and the two switches above the shop (ADR-155 addendum). */
function ShopFilters({
  filter,
  onChange,
  bySets,
  onBySets,
  count,
  onReset,
}: {
  filter: WardrobeFilter;
  onChange: (next: Partial<WardrobeFilter>) => void;
  bySets: boolean;
  onBySets: (on: boolean) => void;
  count: number;
  onReset: () => void;
}) {
  const t = useTranslations("wardrobe");
  const id = useId();
  return (
    <div className="space-y-3" data-testid="wardrobe-filters">
      <div className="relative">
        <svg
          viewBox="0 0 7 7"
          width="14"
          height="14"
          shapeRendering="crispEdges"
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3"
        >
          <path fill="currentColor" d="M1 0h3v1H1zM0 1h1v3H0zM4 1h1v3H4zM1 4h3v1H1zM4 4h1v1H4zM5 5h1v1H5zM6 6h1v1H6z" />
        </svg>
        <input
          type="search"
          value={filter.query}
          onChange={(event) => onChange({ query: event.target.value })}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          data-testid="wardrobe-search"
          className={cn(
            "h-11 w-full rounded-md border-2 border-line-2 bg-surface-2 pr-3 pl-9 text-base text-fg-1 sunken placeholder:text-fg-3",
            "transition-colors duration-fast ease-standard hover:border-fg-3",
            "outline-2 outline-offset-0 outline-transparent focus:border-accent focus:outline-accent-soft",
          )}
        />
      </div>

      <ToggleGroup.Root
        type="single"
        value={filter.slot}
        onValueChange={(next) => {
          if (!next) return;
          onChange({ slot: next as WardrobeFilter["slot"] });
          void playSound("tap");
        }}
        aria-label={t("slotsLabel")}
        className="flex flex-wrap gap-1.5"
      >
        {(["all", ...SHOP_SLOTS] as const).map((value) => (
          <ToggleGroup.Item key={value} value={value} className={chip(filter.slot === value)}>
            {value === "all" ? t("filterAll") : t(`slots.${value}`)}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>

      <ToggleGroup.Root
        type="single"
        value={filter.rarity}
        onValueChange={(next) => {
          if (!next) return;
          onChange({ rarity: next as WardrobeFilter["rarity"] });
          void playSound("tap");
        }}
        aria-label={t("raritiesLabel")}
        className="flex flex-wrap gap-1.5"
        data-testid="wardrobe-rarities"
      >
        {(["all", ...ACCESSORY_RARITIES] as const).map((value) => (
          <ToggleGroup.Item
            key={value}
            value={value}
            className={cn(
              chip(filter.rarity === value),
              value !== "all" && filter.rarity !== value && RARITY_STYLE[value].text,
            )}
          >
            {value === "all" ? t("filterAllRarities") : t(`rarities.${value}`)}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-xs text-fg-2">
          {t("sortLabel")}
          <select
            value={filter.sort}
            onChange={(event) => onChange({ sort: event.target.value as WardrobeSort })}
            className="h-9 rounded-sm border-2 border-line-1 bg-surface-1 px-2 text-xs text-fg-1 focus-ring hover:border-line-2"
            data-testid="wardrobe-sort"
          >
            {WARDROBE_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {t(`sort.${sort}`)}
              </option>
            ))}
          </select>
        </label>
        <span className="flex items-center gap-2">
          <Switch
            id={`${id}-affordable`}
            checked={filter.affordableOnly}
            onCheckedChange={(on) => onChange({ affordableOnly: on })}
            label={t("affordableOnly")}
          />
          <label htmlFor={`${id}-affordable`} className="text-xs text-fg-2">
            {t("affordableOnly")}
          </label>
        </span>
        <span className="flex items-center gap-2">
          <Switch id={`${id}-sets`} checked={bySets} onCheckedChange={onBySets} label={t("groupSets")} />
          <label htmlFor={`${id}-sets`} className="text-xs text-fg-2">
            {t("groupSets")}
          </label>
        </span>
      </div>

      <div className="flex min-h-8 items-center justify-between gap-3">
        <p className="nums text-xs text-fg-3" aria-live="polite" data-testid="wardrobe-count">
          {t("results", { count })}
        </p>
        {isFiltered(filter) && (
          <Button size="sm" variant="ghost" onClick={onReset} data-testid="wardrobe-reset">
            {t("resetFilters")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The figure on the stage: pops a little whenever what it wears changes. */
function StageFigure({ avatarKey, worn }: { avatarKey: string | null; worn: readonly string[] }) {
  const reduced = useReducedMotionConfig();
  return (
    <div className="relative pb-3">
      <motion.div
        key={worn.join(",")}
        initial={reduced ? false : { scale: 0.92, y: 6 }}
        animate={{ scale: 1, y: 0 }}
        transition={SPRING.bouncy}
        className="relative z-10 origin-bottom"
        data-testid="wardrobe-figure"
        data-worn={worn.join(",")}
      >
        <PlayerFigure avatarKey={avatarKey} accessories={worn} scale={6} className="lg:h-64 lg:w-48" />
      </motion.div>
      <span aria-hidden className="absolute inset-x-6 bottom-2 h-3 rounded-pill bg-shade opacity-70" />
    </div>
  );
}

function ItemCard({
  item,
  avatarKey,
  owned,
  worn,
  trying,
  locked,
  affordable,
  state,
  onTry,
  onBuy,
  onWear,
}: {
  item: AccessoryItem;
  avatarKey: string | null;
  owned: boolean;
  worn: boolean;
  trying: boolean;
  locked: boolean;
  affordable: boolean;
  state: ButtonState;
  onTry: () => void;
  onBuy: () => void;
  onWear: (on: boolean) => void;
}) {
  const t = useTranslations("wardrobe");
  const style = RARITY_STYLE[item.rarity];
  const price = formatMoney(item.priceCents, { whole: true });
  return (
    <li data-testid="accessory" data-key={item.key} data-owned={owned} data-worn={worn}>
      <Card
        padding="none"
        className={cn(
          "flex h-full flex-col overflow-hidden transition duration-fast ease-standard",
          trying && "ring-2 ring-accent",
          worn && !trying && "ring-2 ring-gain",
        )}
      >
        <button
          type="button"
          onClick={onTry}
          aria-pressed={trying}
          aria-label={`${item.name}: ${t("tryOn")}`}
          className={cn(
            "group relative grid h-32 place-items-end justify-center overflow-hidden focus-ring",
            style.soft,
          )}
        >
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-6 opacity-70">
            <PlazaGround />
          </span>
          <span className="relative transition duration-fast ease-standard group-hover:-translate-y-1 group-active:translate-y-0">
            <PlayerFigure avatarKey={avatarKey} accessories={[item.key]} scale={3} />
          </span>
          <span className={cn("absolute top-2 left-2 label-pixel text-2xs", style.text)}>
            {t(`rarities.${item.rarity}`)}
          </span>
          {worn && (
            <span className="absolute top-1.5 right-1.5">
              <Badge tone="gain">{t("worn")}</Badge>
            </span>
          )}
          {!worn && owned && (
            <span className="absolute top-1.5 right-1.5">
              <Badge>{t("owned")}</Badge>
            </span>
          )}
        </button>
        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <p className="text-sm leading-tight font-semibold text-pretty text-fg-1">{item.name}</p>
          <p className="text-xs text-pretty text-fg-3">{item.description}</p>
          <div className="mt-auto space-y-2 pt-1">
            {owned ? (
              <Button
                block
                size="sm"
                variant={worn ? "secondary" : "primary"}
                state={state}
                onClick={() => onWear(!worn)}
                data-testid="accessory-wear"
              >
                {worn ? t("takeOff") : t("wear")}
              </Button>
            ) : (
              <>
                <p className={cn("nums text-sm font-semibold", affordable ? "text-fg-1" : "text-loss")}>{price}</p>
                {locked ? (
                  <LockBadge level={item.minLevel} />
                ) : (
                  <Button
                    block
                    size="sm"
                    variant={item.rarity === "legendary" || item.rarity === "mythic" ? "gain" : "primary"}
                    state={state}
                    disabled={!affordable}
                    title={affordable ? undefined : t("tooExpensive")}
                    aria-label={t("buyLabel", { name: item.name, price })}
                    onClick={onBuy}
                    data-testid="accessory-buy"
                  >
                    {affordable ? t("buy") : t("tooExpensive")}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </Card>
    </li>
  );
}

function WardrobeSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-6">
      <Skeleton className="h-96 w-full rounded-lg" />
      <div className="space-y-4">
        <Skeleton className="h-8 w-full max-w-md rounded-sm" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
