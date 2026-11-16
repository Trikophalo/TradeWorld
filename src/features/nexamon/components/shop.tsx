"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { NEXAMON_RARITY_COUNTS, type NexamonSetKey } from "@/config/nexamon";
import { NEXAMON_CONDITIONS } from "@/config/nexamon-rules";
import { BALANCE } from "@/config/balance";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { NexamonOverview, NexamonPackResult, NexamonSetSummary } from "@/features/game/nexamon-types";
import { engine, useGame } from "@/features/game/store";
import { formatInteger, formatMoney } from "@/lib/format";
import { playSound } from "@/lib/sound";
import { useNexamonAction, usePendingPack } from "../hooks";
import { chanceBps, formatChance, formatDecimal, packNeedsConfirm, packOdds } from "../view";
import { ConditionBadge, RarityBadge } from "./badges";
import { NexamonPack } from "./pack";
import { PackOverlay } from "./pack-overlay";

/**
 * The shop (ADR-165): the three booster packs with price, contents, the exact pull rates and the own progress per
 * set. Buying opens the pack on the whole screen; the cards are in the collection as soon as the server answers.
 */
export function Shop({ overview }: { overview: NexamonOverview | undefined }) {
  const t = useTranslations("nexamon");
  const tc = useTranslations("nexamonCards");
  const cash = useGame((state) => state.portfolio?.cashCents ?? 0);
  const [pending, setPending] = usePendingPack();
  const [open, setOpen] = useState<NexamonPackResult | null>(null);
  const [confirm, setConfirm] = useState<NexamonSetSummary | null>(null);
  const [buying, setBuying] = useState<NexamonSetKey | null>(null);
  const action = useNexamonAction();

  const buy = async (set: NexamonSetKey) => {
    setBuying(set);
    await action.run((requestId) => engine.buyNexamonPack(requestId, set), {
      errorTitle: t("shop.buyFailed"),
      onDone: (pack) => {
        void playSound("buy");
        // Remembered until the summary shows: a closed window or a reload keeps the pack to open.
        setPending(pack);
        setOpen(pack);
      },
    });
    setBuying(null);
    setConfirm(null);
  };
  const ask = (set: NexamonSetSummary) => {
    if (packNeedsConfirm(set.packPriceCents)) setConfirm(set);
    else void buy(set.key);
  };

  const openSet = overview?.sets.find((s) => s.key === open?.set);

  return (
    <div className="space-y-5" data-testid="nexamon-shop">
      {pending && !open && (
        <Card padding="lg" className="flex flex-wrap items-center gap-3 border-accent" data-testid="pending-pack">
          <NexamonPack set={pending.set} scale={1} sheen={false} />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-fg-1">{t("shop.pendingTitle", { set: tc(`sets.${pending.set}`) })}</p>
            <p className="mt-0.5 text-sm text-pretty text-fg-2">{t("shop.pendingText")}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setOpen(pending)} data-testid="pending-open">
              {t("shop.pendingOpen")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              {t("shop.pendingDrop")}
            </Button>
          </div>
        </Card>
      )}

      {!overview ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 rounded-lg lg:h-112" />
          ))}
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-3" data-tour="nexamon-packs">
          {overview.sets.map((set) => {
            const short = Math.max(0, set.packPriceCents - cash);
            return (
              <li key={set.key}>
                <Card
                  padding="lg"
                  className="flex h-full gap-4 lg:flex-col lg:items-center lg:text-center"
                  data-testid={`pack-${set.key}`}
                >
                  <NexamonPack set={set.key} scale={2} className="lg:hidden" />
                  <NexamonPack set={set.key} scale={3} className="hidden lg:block" />
                  <div className="flex min-w-0 flex-1 flex-col gap-3 lg:w-full">
                    <div>
                      <h2 className="font-pixel text-sm text-fg-1 uppercase">{tc(`sets.${set.key}`)}</h2>
                      <p className="mt-1 nums text-xl font-semibold text-fg-1">
                        {formatMoney(set.packPriceCents, { whole: true })}
                      </p>
                      <p className="mt-0.5 text-xs text-pretty text-fg-3">
                        {t("shop.inside", { count: overview.packSize })}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-baseline justify-between gap-2 text-xs text-fg-2">
                        <span>{t("shop.progress")}</span>
                        <span className="nums font-medium text-fg-1" data-testid={`progress-${set.key}`}>
                          {t("shop.progressValue", { owned: set.ownedDistinct, total: set.cards })}
                        </span>
                      </div>
                      <Progress
                        value={set.cards > 0 ? set.ownedDistinct / set.cards : 0}
                        label={t("shop.progressLabel", { set: tc(`sets.${set.key}`) })}
                        size="sm"
                        tone={set.ownedDistinct >= set.cards ? "gold" : "accent"}
                        className="mt-1.5"
                      />
                      <p className="mt-1.5 nums text-xs text-fg-3">
                        {t("shop.opened", { count: set.packsOpened })} ·{" "}
                        {t("shop.population", { count: formatInteger(set.population) })}
                      </p>
                    </div>
                    <div className="mt-auto space-y-1.5">
                      <Button
                        block
                        state={buying === set.key ? action.state : "idle"}
                        disabled={short > 0 || (action.busy && buying !== set.key)}
                        onClick={() => ask(set)}
                        data-testid={`buy-${set.key}`}
                      >
                        {t("shop.buy", { price: formatMoney(set.packPriceCents, { whole: true }) })}
                      </Button>
                      {short > 0 && (
                        <p className="text-xs text-warn">{t("shop.short", { amount: formatMoney(short) })}</p>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <OddsCard packSize={overview?.packSize ?? BALANCE.nexamon.packSize} />

      <Modal
        open={confirm !== null}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={t("shop.confirmTitle")}
        className="max-w-md"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              {t("cancel")}
            </Button>
            <Button
              state={buying && confirm && buying === confirm.key ? action.state : "idle"}
              onClick={() => confirm && void buy(confirm.key)}
              data-testid="confirm-buy"
            >
              {confirm ? t("shop.buy", { price: formatMoney(confirm.packPriceCents, { whole: true }) }) : ""}
            </Button>
          </div>
        }
      >
        {confirm && (
          <div className="flex items-center gap-4">
            <NexamonPack set={confirm.key} scale={1} sheen={false} />
            <p className="text-sm text-pretty text-fg-2">
              {t("shop.confirmText", {
                set: tc(`sets.${confirm.key}`),
                price: formatMoney(confirm.packPriceCents, { whole: true }),
                cash: formatMoney(cash),
              })}
            </p>
          </div>
        )}
      </Modal>

      <PackOverlay
        pack={open}
        onFinished={() => setPending(null)}
        onClose={() => setOpen(null)}
        onAgain={() => openSet && ask(openSet)}
        againState={open && buying === open.set ? action.state : "idle"}
        againLabel={
          openSet
            ? t("opening.again", { price: formatMoney(openSet.packPriceCents, { whole: true }) })
            : t("opening.againPlain")
        }
        canAfford={openSet ? cash >= openSet.packPriceCents : false}
      />
    </div>
  );
}

/** The pull rates, exactly as the server rolls them: the two slots that can hold more than a common. */
function OddsCard({ packSize }: { packSize: number }) {
  const t = useTranslations("nexamon");
  const rows = packOdds();
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
                    {t("odds.cardsInSet", { count: NEXAMON_RARITY_COUNTS[row.rarity] })}
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
          </tbody>
        </table>
      </div>
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
