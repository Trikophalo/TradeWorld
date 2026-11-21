"use client";

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import { BALANCE } from "@/config/balance";
import type { NexamonSetKey } from "@/config/nexamon";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatMoney } from "@/lib/format";
import { DURATION, EASE } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { NexamonPack } from "../components/pack";
import { lineupCount, lineupGroups, moveLineupGroup, removeLineupGroup, setLineupCount } from "./battle-lineup";

const cfg = BALANCE.nexamon;

/**
 * The lineup of a new Pack Battle (ADR-192 Nachtrag): per set a stepper and a slider for 0..maxPerSet packs, the
 * packs of a set stand together; below, the order of the sets (move up/down, remove). The running total and the
 * overall maximum (packBattle.maxPacks) sit in the header.
 */
export function BattleLineupPicker({
  lineup,
  onChange,
  sets,
  price,
}: {
  lineup: NexamonSetKey[];
  onChange: (next: NexamonSetKey[]) => void;
  /** The sets that can be picked (released). */
  sets: readonly NexamonSetKey[];
  /** The stake per player for this lineup (with promotions as the caller computes it). */
  price: number;
}) {
  const t = useTranslations("nexamonLive");
  const reduced = useReducedMotionConfig();
  const maxPacks = cfg.packBattle.maxPacks;
  const perSet = cfg.packBattle.maxPerSet;
  const groups = lineupGroups(lineup);
  const full = lineup.length >= maxPacks;
  const set = (key: NexamonSetKey, count: number) => {
    const next = setLineupCount(lineup, key, count, perSet, maxPacks);
    if (next.length === lineup.length && next.every((s, i) => s === lineup[i])) return;
    void playSound("battleClick");
    onChange(next);
  };

  return (
    <section className="space-y-2" data-testid="lineup-picker">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="label-pixel text-fg-3">{t("create.lineup", { count: lineup.length, max: maxPacks })}</h3>
        <span className="nums text-sm font-semibold text-fg-1" data-testid="lineup-total" data-cents={price}>
          {t("create.total", { price: formatMoney(price, { whole: true }) })}
        </span>
      </div>
      <p className="text-2xs text-pretty text-fg-3">{t("create.perSet", { count: perSet })}</p>
      <ul className="space-y-1.5" aria-label={t("challenge.setLabel")}>
        {sets.map((key) => {
          const count = lineupCount(lineup, key);
          const room = Math.min(perSet, maxPacks - (lineup.length - count));
          const name = t(`sets.${key}`);
          return (
            <li
              key={key}
              className={cn(
                "rounded-md border-2 bg-surface-1 p-1.5 transition-colors duration-fast ease-standard",
                count > 0 ? "border-accent" : "border-line-1",
              )}
              data-testid={`challenge-set-row-${key}`}
              data-count={count}
            >
              <div className="flex items-center gap-2">
                <NexamonPack set={key} scale={1} sheen={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-fg-1">{name}</span>
                  <span className="block nums text-2xs text-fg-2">
                    {formatMoney(cfg.sets[key].packPriceCents, { whole: true })}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={t("create.less", { set: name })}
                  disabled={count === 0}
                  onClick={() => set(key, count - 1)}
                  data-testid={`challenge-set-minus-${key}`}
                >
                  −
                </Button>
                <span
                  className="relative grid w-7 place-items-center overflow-hidden"
                  aria-live="polite"
                  data-testid={`challenge-set-count-${key}`}
                  data-count={count}
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={count}
                      className={cn("nums text-sm font-semibold", count > 0 ? "text-fg-1" : "text-fg-3")}
                      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                      transition={{ duration: DURATION.fast, ease: EASE.out }}
                    >
                      {count}
                    </motion.span>
                  </AnimatePresence>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={t("create.more", { set: name })}
                  disabled={count >= room}
                  onClick={() => set(key, count + 1)}
                  data-testid={`challenge-set-${key}`}
                >
                  +
                </Button>
              </div>
              <Slider
                value={count / perSet}
                onValueChange={(v) => set(key, Math.round(v * perSet))}
                label={t("create.amount", { set: name })}
                valueText={t("create.amountText", { count })}
                marks={[0.5, 1]}
                disabled={room === 0 && count === 0}
                className="h-8 px-1"
              />
            </li>
          );
        })}
      </ul>

      {groups.length === 0 ? (
        <p className="rounded-md border-2 border-dashed border-line-1 p-3 text-center text-xs text-fg-3">
          {t("create.empty")}
        </p>
      ) : (
        <div className="space-y-1">
          <h4 className="text-2xs text-fg-3">{t("create.order")}</h4>
          <ol className="space-y-1" data-testid="lineup">
            {groups.map((g, i) => (
              <li
                key={g.set}
                className="flex items-center gap-2 rounded-md border-2 border-line-1 bg-surface-1 p-1.5"
                data-testid="lineup-item"
                data-set={g.set}
                data-count={g.count}
              >
                <span className="w-5 text-center nums text-xs text-fg-3">{i + 1}</span>
                <NexamonPack set={g.set} scale={1} sheen={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg-1">{t(`sets.${g.set}`)}</span>
                  <span className="block nums text-xs text-fg-2">
                    {t("create.groupPrice", {
                      count: g.count,
                      price: formatMoney(cfg.sets[g.set].packPriceCents, { whole: true }),
                    })}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("create.up")}
                  disabled={i === 0}
                  onClick={() => onChange(moveLineupGroup(lineup, i, i - 1))}
                  data-testid="lineup-up"
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("create.down")}
                  disabled={i === groups.length - 1}
                  onClick={() => onChange(moveLineupGroup(lineup, i, i + 1))}
                  data-testid="lineup-down"
                >
                  ↓
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("create.remove")}
                  onClick={() => onChange(removeLineupGroup(lineup, i))}
                  data-testid="lineup-remove"
                >
                  ✕
                </Button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {full && <p className="text-xs text-fg-3">{t("create.maxPacks", { count: maxPacks })}</p>}
    </section>
  );
}
