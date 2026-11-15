"use client";

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import { ToggleGroup } from "radix-ui";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { burstConfetti } from "@/components/ui/effects";
import { LockBadge } from "@/components/ui/lock-badge";
import { PlayerFigure } from "@/components/ui/player-figure";
import { PlazaGround } from "@/components/ui/plaza-ground";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { catalogItemByKey } from "@/config/accessory-catalog";
import { ACCESSORIES, type AccessoryItem, type AccessorySlot } from "@/config/accessories";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame, usePlayerLevel } from "@/features/game/store";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { previewWorn, useSetWardrobe, useWardrobe } from "../hooks";
import { BattleSkins } from "./battle-skins";
import { RARITY_STYLE } from "./rarity";

type Filter = "all" | AccessorySlot;
/** Shop order of the slots: what people look at first. */
const SHOP_SLOTS: readonly AccessorySlot[] = ["head", "face", "body", "hand", "pet", "back"];
const slotOf = (key: string) => catalogItemByKey(key)?.slot;
const shopOrder = (a: AccessoryItem, b: AccessoryItem) =>
  SHOP_SLOTS.indexOf(a.slot) - SHOP_SLOTS.indexOf(b.slot) || a.priceCents - b.priceCents;

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
  const [filter, setFilter] = useState<Filter>("all");
  const [preview, setPreview] = useState<string | null>(null);
  const [actions, setActions] = useState<Record<string, ButtonState>>({});
  const stage = useRef<HTMLDivElement>(null);

  if (!wardrobe.data) return <WardrobeSkeleton />;
  const { owned, worn } = wardrobe.data;
  const shown = previewWorn(worn, preview, slotOf);
  const items = ACCESSORIES.filter((a) => filter === "all" || a.slot === filter).toSorted(shopOrder);
  const figureKey = wardrobe.data.avatarKey || avatarKey;

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
      void playSound(item.rarity === "legendary" || item.rarity === "epic" ? "levelUp" : "win");
      haptic("success");
      if (stage.current) burstConfetti(stage.current, item.rarity === "legendary" ? 48 : 28);
      toast.success(t("bought", { name: item.name }), t("boughtText"), { silent: true });
    } catch (error) {
      setAction(item.key, "idle");
      toast.error(t("title"), errorText(error));
    }
  };

  const wear = async (item: Pick<AccessoryItem, "key" | "slot">, on: boolean) => {
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
                    const item = catalogItemByKey(key);
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
        <ToggleGroup.Root
          type="single"
          value={filter}
          onValueChange={(next) => {
            if (!next) return;
            setFilter(next as Filter);
            void playSound("tap");
          }}
          aria-label={t("slotsLabel")}
          className="flex flex-wrap gap-1.5"
        >
          {(["all", ...SHOP_SLOTS] as const).map((value) => (
            <ToggleGroup.Item
              key={value}
              value={value}
              className={cn(
                "h-8 rounded-sm border-2 px-3 label-pixel focus-ring transition duration-fast ease-standard active:scale-95",
                filter === value
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line-1 bg-surface-1 text-fg-2 hover:border-line-2 hover:text-fg-1",
              )}
            >
              {value === "all" ? t("filterAll") : t(`slots.${value}`)}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4" data-testid="wardrobe-items">
          {items.map((item) => (
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
          ))}
        </ul>
        {/* Only won in news battles (ADR-160) */}
        <BattleSkins
          avatarKey={figureKey}
          owned={owned}
          worn={worn}
          actions={actions}
          onWear={(item, on) => void wear(item, on)}
        />
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
                    variant={item.rarity === "legendary" ? "gain" : "primary"}
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
