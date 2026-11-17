"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { nexamonRarityCount, type NexamonSetKey } from "@/config/nexamon";
import { NEXAMON_CONDITIONS } from "@/config/nexamon-rules";
import { BALANCE } from "@/config/balance";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { NexamonCollection, NexamonOverview, NexamonPackResult } from "@/features/game/nexamon-types";
import { engine, useGame } from "@/features/game/store";
import { formatInteger, formatMoney } from "@/lib/format";
import { playSound } from "@/lib/sound";
import { useNexamonAction, usePendingPack } from "../hooks";
import { chanceBps, formatChance, formatDecimal, packOdds } from "../view";
import { ConditionBadge, RarityBadge } from "./badges";
import { NexamonPack, TiltPack } from "./pack";
import { PackOverlay } from "./pack-overlay";
import { SealedPacksStrip } from "./sealed-packs";

/**
 * The shop (ADR-165): the packs of the three sets, each leaning towards the pointer. A pack opens its popup:
 * price and balance, every card of the set, the one "Kaufen" step, then tearing the pack open by hand. The cards
 * are in the collection as soon as the server answers.
 */
export function Shop({
  overview,
  collection,
}: {
  overview: NexamonOverview | undefined;
  collection: NexamonCollection | undefined;
}) {
  const t = useTranslations("nexamon");
  const tc = useTranslations("nexamonCards");
  const cash = useGame((state) => state.portfolio?.cashCents ?? 0);
  const [pending, setPending] = usePendingPack();
  /** The set whose popup is open. */
  const [selected, setSelected] = useState<NexamonSetKey | null>(null);
  /** The bought pack on the table (always of the selected set). */
  const [pack, setPack] = useState<NexamonPackResult | null>(null);
  const action = useNexamonAction();

  const buy = (set: NexamonSetKey) =>
    void action.run((requestId) => engine.buyNexamonPack(requestId, set), {
      errorTitle: t("shop.buyFailed"),
      onDone: (bought) => {
        void playSound("buy");
        // Remembered until the summary shows: a closed window or a reload keeps the pack to tear open.
        setPending(bought);
        setPack(bought);
      },
    });
  const show = (set: NexamonSetKey) => {
    setPack(null);
    setSelected(set);
  };
  const resume = () => {
    if (!pending) return;
    setPack(pending);
    setSelected(pending.set);
  };
  const selectedSet = overview?.sets.find((s) => s.key === selected) ?? null;

  return (
    <div className="space-y-5" data-testid="nexamon-shop">
      <SealedPacksStrip
        onOpened={(opened) => {
          setPending(opened);
          setPack(opened);
          setSelected(opened.set);
        }}
      />
      {pending && selected === null && (
        <Card padding="lg" className="flex flex-wrap items-center gap-3 border-accent" data-testid="pending-pack">
          <NexamonPack set={pending.set} scale={1} sheen={false} />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-fg-1">{t("shop.pendingTitle", { set: tc(`sets.${pending.set}`) })}</p>
            <p className="mt-0.5 text-sm text-pretty text-fg-2">{t("shop.pendingText")}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={resume} data-testid="pending-open">
              {t("shop.pendingOpen")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              {t("shop.pendingDrop")}
            </Button>
          </div>
        </Card>
      )}

      {!overview ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-56 rounded-lg lg:h-112" />
          ))}
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4" data-tour="nexamon-packs">
          {[...overview.sets]
            .sort((a, b) => a.packPriceCents - b.packPriceCents)
            .map((set) => (
              <li key={set.key}>
                <button
                  type="button"
                  onClick={() => show(set.key)}
                  data-testid={`buy-${set.key}`}
                  aria-label={t("shop.openPack", {
                    set: tc(`sets.${set.key}`),
                    price: formatMoney(set.packPriceCents, { whole: true }),
                  })}
                  className="group flex h-full w-full gap-4 rounded-lg border-2 border-line-1 bg-surface-1 p-5 text-left shadow-1 focus-ring transition duration-fast ease-standard hover:border-line-2 hover:bg-surface-2 active:translate-y-0.5 active:shadow-none lg:flex-col lg:items-center lg:p-6 lg:text-center"
                >
                  <TiltPack set={set.key} scale={2} className="lg:hidden" />
                  <TiltPack set={set.key} scale={3} className="hidden lg:inline-block" />
                  <span className="flex min-w-0 flex-1 flex-col gap-3 lg:w-full">
                    <span className="block">
                      <span className="block font-pixel text-sm text-fg-1 uppercase">{tc(`sets.${set.key}`)}</span>
                      <span className="mt-1 block nums text-xl font-semibold text-fg-1">
                        {formatMoney(set.packPriceCents, { whole: true })}
                      </span>
                      <span className="mt-0.5 block text-xs text-pretty text-fg-3">
                        {t("shop.inside", { count: overview.packSize })}
                      </span>
                    </span>
                    <span className="block">
                      <span className="flex items-baseline justify-between gap-2 text-xs text-fg-2">
                        <span>{t("shop.progress")}</span>
                        <span className="nums font-medium text-fg-1" data-testid={`progress-${set.key}`}>
                          {t("shop.progressValue", { owned: set.ownedDistinct, total: set.cards })}
                        </span>
                      </span>
                      <Progress
                        value={set.cards > 0 ? set.ownedDistinct / set.cards : 0}
                        label={t("shop.progressLabel", { set: tc(`sets.${set.key}`) })}
                        size="sm"
                        tone={set.ownedDistinct >= set.cards ? "gold" : "accent"}
                        className="mt-1.5"
                      />
                      <span className="mt-1.5 block nums text-xs text-fg-3">
                        {t("shop.opened", { count: set.packsOpened })} ·{" "}
                        {t("shop.population", { count: formatInteger(set.population) })}
                      </span>
                    </span>
                    <span className="mt-auto block label-pixel text-accent transition-transform duration-fast group-hover:translate-x-0.5">
                      {t("shop.look")} <span aria-hidden>→</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}

      <OddsCard packSize={overview?.packSize ?? BALANCE.nexamon.packSize} />

      <PackOverlay
        set={selectedSet}
        pack={pack && pack.set === selected ? pack : null}
        collection={collection}
        cashCents={cash}
        onBuy={() => selected && buy(selected)}
        buyState={action.state}
        onFinished={() => setPending(null)}
        oneOfOnes={overview?.oneOfOnes}
        onClose={() => {
          setSelected(null);
          setPack(null);
        }}
      />
    </div>
  );
}

/** The pull rates, exactly as the server rolls them: the two slots that can hold more than a common. */
function OddsCard({ packSize }: { packSize: number }) {
  const t = useTranslations("nexamon");
  const rows = packOdds();
  // ADR-174: the One of One row of the set that has them
  const oneOfOne = packOdds("cosmic_winds").find((row) => row.kind === "one_of_one");
  const weights = BALANCE.nexamon.conditions.weightBps;
  return (
    <Card padding="lg" data-testid="nexamon-odds">
      <CardHeader>
        <CardTitle>{t("odds.title")}</CardTitle>
      </CardHeader>
      <p className="text-sm text-pretty text-fg-2">{t("odds.intro", { count: packSize, sure: packSize - 2 })}</p>
      <div className="mt-3 overflow-hidden rounded-md border-2 border-line-1">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-surface-2 label-pixel text-fg-3">
            <tr>
              <th className="w-[38%] px-2 py-2 font-normal sm:px-3">{t("odds.rarity")}</th>
              <th className="px-1 py-2 text-right font-normal sm:px-3">{t("odds.slot", { slot: packSize - 1 })}</th>
              <th className="px-1 py-2 text-right font-normal sm:px-3">{t("odds.slot", { slot: packSize })}</th>
              <th className="px-2 py-2 text-right font-normal sm:px-3">{t("odds.average")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-1 text-fg-1">
            {rows.map((row) => (
              <tr key={row.rarity} data-rarity={row.rarity}>
                <td className="px-2 py-2 sm:px-3">
                  <RarityBadge rarity={row.rarity} short />
                  <span className="mt-0.5 block text-xs text-fg-3">
                    {nexamonRarityCount("cosmic_winds", row.rarity) === nexamonRarityCount("mystic_energy", row.rarity)
                      ? t("odds.cardsInSet", { count: nexamonRarityCount("mystic_energy", row.rarity) })
                      : t("odds.cardsInSets", {
                          count: nexamonRarityCount("mystic_energy", row.rarity),
                          cosmic: nexamonRarityCount("cosmic_winds", row.rarity),
                        })}
                  </span>
                </td>
                <td className="px-1 py-2 text-right nums sm:px-3">
                  {row.slot4 > 0 ? formatChance(chanceBps(row.slot4, row.denominator)) : "–"}
                </td>
                <td className="px-1 py-2 text-right nums sm:px-3">
                  {row.slot5 > 0 ? formatChance(chanceBps(row.slot5, row.denominator)) : "–"}
                </td>
                <td className="px-2 py-2 text-right nums text-xs text-fg-2 sm:px-3 sm:text-sm">
                  {row.oneInPacks !== null
                    ? t("odds.oneIn", { count: formatInteger(row.oneInPacks) })
                    : t("odds.perPack", { count: formatDecimal(row.perPack) })}
                </td>
              </tr>
            ))}
            {oneOfOne && (
              <tr data-rarity="one_of_one" data-testid="odds-one-of-one">
                <td className="px-2 py-2 sm:px-3">
                  <RarityBadge rarity="one_of_one" short />
                  <span className="mt-0.5 block text-xs text-fg-3">
                    {t("odds.cardsInSet", { count: nexamonRarityCount("cosmic_winds", "one_of_one") })}
                  </span>
                </td>
                <td className="px-1 py-2 text-right nums sm:px-3">–</td>
                <td className="px-1 py-2 text-right nums sm:px-3">
                  {formatChance(chanceBps(oneOfOne.slot5, oneOfOne.denominator))}
                </td>
                <td className="px-2 py-2 text-right nums text-xs text-fg-2 sm:px-3 sm:text-sm">
                  {t("odds.oneOfOne", { count: formatInteger(oneOfOne.denominator) })}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {oneOfOne && (
        <p className="mt-3 text-sm text-pretty text-fg-2">
          {t("odds.oneOfOneNote", { count: formatInteger(oneOfOne.denominator) })}
        </p>
      )}
      <p className="mt-3 text-sm text-pretty text-fg-2">{t("odds.conditionIntro")}</p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {[...NEXAMON_CONDITIONS].reverse().map((condition) => (
          <li key={condition} className="flex items-center gap-1.5 nums text-sm text-fg-1">
            <ConditionBadge condition={condition} />
            {formatChance(weights[condition])}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-pretty text-fg-3">{t("odds.note")}</p>
    </Card>
  );
}
