"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { NexamonCard } from "@/config/nexamon";
import { BALANCE } from "@/config/balance";
import { Button } from "@/components/ui/button";
import { Countdown } from "@/components/ui/countdown";
import { Field } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import type { NexamonCopy } from "@/features/game/nexamon-types";
import { engine } from "@/features/game/store";
import { parseEuroCents } from "@/features/market/order-schema";
import { formatMoney } from "@/lib/format";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useNexamonAction } from "../hooks";
import { formatGrade, isBlackLabel } from "../lib";
import {
  centsToInput,
  aiBuyHint,
  conditionFactorBps,
  copyStatus,
  dealBps,
  formatChance,
  formatFactor,
  gradingQuote,
  isListablePrice,
  listingProceeds,
  quickSellOffer,
  suggestedPriceCents,
} from "../view";
import { CopyQuality, FactRow, GradeChip } from "./parts";

type Dialog = "sell" | "quick" | "grade" | "crack" | null;

/**
 * Everything a player can do with one copy (ADR-165): list it, take it back, sell it to the AI at once, send it to
 * ASP, crack its slab. Each action explains what it costs and brings before it runs.
 */
export function CopyActions({
  copy,
  card,
  population = AI_HINT_POPULATION,
  className,
}: {
  copy: NexamonCopy;
  card: NexamonCard;
  /** The card's population, for how fast AI collectors buy above the value. */
  population?: number;
  className?: string;
}) {
  const t = useTranslations("nexamon");
  const [dialog, setDialog] = useState<Dialog>(null);
  const unlist = useNexamonAction();
  const status = copyStatus(copy);
  const quick = quickSellOffer(copy, card.rarity);
  const close = () => setDialog(null);

  if (status === "grading") {
    return (
      <p className={cn("text-sm text-fg-2", className)} data-testid="copy-grading">
        {t("copy.atAsp")}{" "}
        {copy.gradingUntil && <Countdown target={Date.parse(copy.gradingUntil)} className="font-semibold text-fg-1" />}
      </p>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {status === "listed" && copy.listing ? (
        <>
          <span className="nums text-sm text-fg-2" data-testid="copy-listed">
            {t("copy.listedFor", { price: formatMoney(copy.listing.priceCents) })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            state={unlist.state}
            data-testid="copy-unlist"
            onClick={() =>
              void unlist.run((requestId) => engine.unlistNexamonCard(requestId, copy.listing!.id), {
                errorTitle: t("copy.unlistFailed"),
                onDone: () => toast.success(t("copy.unlistDone"), card.name),
              })
            }
          >
            {t("copy.unlist")}
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" onClick={() => setDialog("sell")} data-testid="copy-sell">
            {t("copy.sell")}
          </Button>
          {status === "raw" && (
            <Button size="sm" variant="secondary" onClick={() => setDialog("grade")} data-testid="copy-grade">
              {t("copy.grade")}
            </Button>
          )}
          {quick !== null && (
            <Button size="sm" variant="ghost" onClick={() => setDialog("quick")} data-testid="copy-quick">
              {t("copy.quick")}
            </Button>
          )}
          {status === "graded" && (
            <Button size="sm" variant="danger" onClick={() => setDialog("crack")} data-testid="copy-crack">
              {t("copy.crack")}
            </Button>
          )}
        </>
      )}
      {/* Mounted only while open: every opening starts with fresh numbers. */}
      {dialog === "sell" && <SellSheet copy={copy} card={card} population={population} onClose={close} />}
      {dialog === "quick" && quick !== null && <QuickSheet copy={copy} card={card} offer={quick} onClose={close} />}
      {dialog === "grade" && <GradeSheet copy={copy} card={card} onClose={close} />}
      {dialog === "crack" && <CrackSheet copy={copy} card={card} onClose={close} />}
    </div>
  );
}

interface SheetProps {
  copy: NexamonCopy;
  card: NexamonCard;
  onClose: () => void;
}

function CopyLine({ copy, card }: Pick<SheetProps, "copy" | "card">) {
  const t = useTranslations("nexamon");
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
      <span className="font-medium text-fg-1">{card.name}</span>
      <span className="nums">{t("serial", { serial: copy.serial })}</span>
      <CopyQuality copy={copy} />
    </p>
  );
}

/** Without the card's population the hint assumes a well-known card (the slowest case). */
const AI_HINT_POPULATION = 100_000;

function SellSheet({ copy, card, population, onClose }: SheetProps & { population: number }) {
  const t = useTranslations("nexamon");
  const action = useNexamonAction();
  const [text, setText] = useState(() => centsToInput(suggestedPriceCents(copy.valueCents)));
  const cents = parseEuroCents(text);
  const valid = isListablePrice(cents);
  const { feeCents, netCents, feeBps } = listingProceeds(valid ? cents : 0);
  const against = valid ? dealBps(cents, copy.valueCents) : 0;
  // Far above the value a listing no longer counts as supply; AI collectors pay at most value x (1 + premium).
  const tooHigh = valid && against > BALANCE.nexamon.value.trade.bandBps;
  const ai = aiBuyHint(copy, card.rarity, population, valid ? cents : 0);
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("sell.title")}
      footer={
        <Button
          block
          size="lg"
          state={action.state}
          disabled={!valid}
          data-testid="sell-confirm"
          onClick={() =>
            valid &&
            void action.run((requestId) => engine.listNexamonCard(requestId, copy.id, cents), {
              errorTitle: t("sell.failed"),
              onDone: () => {
                toast.success(t("sell.done"), formatMoney(cents));
                onClose();
              },
            })
          }
        >
          {valid ? t("sell.confirm", { price: formatMoney(cents) }) : t("sell.confirmPlain")}
        </Button>
      }
    >
      <div className="space-y-4" data-testid="sell-sheet">
        <CopyLine copy={copy} card={card} />
        <Field
          label={t("sell.price")}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
          error={
            text.trim() !== "" && !valid
              ? t("sell.invalid", { min: formatMoney(BALANCE.nexamon.market.minPriceCents) })
              : undefined
          }
          hint={t("sell.hint", { value: formatMoney(copy.valueCents) })}
          data-testid="sell-price"
        />
        <dl className="divide-y divide-line-1 rounded-md bg-surface-2 px-3">
          <FactRow label={t("sell.value")}>{formatMoney(copy.valueCents)}</FactRow>
          <FactRow label={t("sell.fee", { rate: formatChance(feeBps) })}>
            {valid ? `−${formatMoney(feeCents)}` : "–"}
          </FactRow>
          <FactRow label={t("sell.net")} strong>
            <span data-testid="sell-net">{valid ? formatMoney(netCents) : "–"}</span>
          </FactRow>
        </dl>
        {tooHigh && (
          <p className="text-sm text-pretty text-warn">
            {t("sell.tooHigh", { band: formatChance(BALANCE.nexamon.value.trade.bandBps) })}
          </p>
        )}
        <div className="rounded-md border-2 border-line-1 p-3 text-sm text-pretty" data-testid="sell-ai-hint">
          <p className={cn("font-medium", valid && ai.instant ? "text-gain" : "text-fg-1")}>{t("sell.atValue")}</p>
          <p className="mt-1 text-fg-2" data-testid="sell-ai-max">
            {ai.premiumBps > 0
              ? t("sell.aiMax", { max: formatMoney(ai.maxCents), premium: formatChance(ai.premiumBps) })
              : t("sell.aiMaxValue")}
          </p>
          {valid && !ai.instant && (
            <p className="mt-1 text-fg-3" data-testid="sell-ai-speed">
              {ai.minutes === null ? t("sell.aiNever") : t("sell.aiMinutes", { minutes: ai.minutes })}
            </p>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function QuickSheet({ copy, card, offer, onClose }: SheetProps & { offer: number }) {
  const t = useTranslations("nexamon");
  const action = useNexamonAction();
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("quick.title")}
      footer={
        <Button
          block
          size="lg"
          state={action.state}
          data-testid="quick-confirm"
          onClick={() =>
            void action.run((requestId) => engine.sellNexamonToAi(requestId, [copy.id]), {
              errorTitle: t("quick.failed"),
              onDone: (result) => {
                void playSound("coin");
                toast.success(t("quick.done"), formatMoney(result.totalCents), { silent: true });
                onClose();
              },
            })
          }
        >
          {t("quick.confirm", { price: formatMoney(offer) })}
        </Button>
      }
    >
      <div className="space-y-4" data-testid="quick-sheet">
        <CopyLine copy={copy} card={card} />
        <dl className="divide-y divide-line-1 rounded-md bg-surface-2 px-3">
          <FactRow label={t("sell.value")}>{formatMoney(copy.valueCents)}</FactRow>
          <FactRow label={t("quick.offer", { rate: formatChance(BALANCE.nexamon.quickSell.bps) })} strong>
            {formatMoney(offer)}
          </FactRow>
        </dl>
        <p className="text-sm text-pretty text-fg-2">{t("quick.text")}</p>
      </div>
    </Sheet>
  );
}

function GradeSheet({ copy, card, onClose }: SheetProps) {
  const t = useTranslations("nexamon");
  const tc = useTranslations("nexamonCards");
  const action = useNexamonAction();
  const quote = gradingQuote(copy);
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("grade.title")}
      footer={
        <Button
          block
          size="lg"
          state={action.state}
          data-testid="grade-confirm"
          onClick={() =>
            void action.run((requestId) => engine.gradeNexamonCard(requestId, copy.id), {
              errorTitle: t("grade.failed"),
              onDone: () => {
                toast.success(t("grade.done"), t("grade.doneText", { minutes: quote.minutes }));
                onClose();
              },
            })
          }
        >
          {t("grade.confirm", { fee: formatMoney(quote.feeCents) })}
        </Button>
      }
    >
      <div className="space-y-4" data-testid="grade-sheet">
        <CopyLine copy={copy} card={card} />
        <p className="text-sm text-pretty text-fg-2">{t("grade.text")}</p>
        <dl className="divide-y divide-line-1 rounded-md bg-surface-2 px-3">
          <FactRow label={t("sell.value")}>{formatMoney(copy.valueCents)}</FactRow>
          <FactRow label={t("grade.fee", { rate: formatChance(BALANCE.nexamon.grading.feeBps) })} strong>
            <span data-testid="grade-fee">{formatMoney(quote.feeCents)}</span>
          </FactRow>
          <FactRow label={t("grade.duration")}>{t("grade.minutes", { minutes: quote.minutes })}</FactRow>
          <FactRow label={t("grade.better")}>{formatChance(quote.betterBps)}</FactRow>
          <FactRow label={t("grade.expected")}>{formatFactor(quote.expectedFactorBps)}</FactRow>
        </dl>
        <div>
          <p className="mb-1.5 label-pixel text-fg-3">
            {t("grade.table", { condition: tc(`condition.${copy.condition}`) })}
          </p>
          <ul className="divide-y divide-line-1 rounded-md border-2 border-line-1" data-testid="grade-chances">
            {quote.blackLabel.chanceBps === 0 && (
              <li className="px-3 py-1.5 text-sm" data-grade={quote.blackLabel.grade} data-testid="grade-black-label">
                <span className="flex items-center gap-3">
                  <GradeChip grade={quote.blackLabel.grade} />
                  <span className="ml-auto nums text-fg-3">{formatChance(0)}</span>
                  <span className="w-12 text-right nums text-fg-3">{formatFactor(quote.blackLabel.factorBps)}</span>
                </span>
                <span className="mt-1 block text-xs text-pretty text-fg-3">{t("blackLabel.onlyMint")}</span>
              </li>
            )}
            {quote.chances.map((row) => (
              <li key={row.grade} className="flex items-center gap-3 px-3 py-1.5 text-sm" data-grade={row.grade}>
                <GradeChip grade={row.grade} />
                <span className="ml-auto nums text-fg-1">{formatChance(row.chanceBps)}</span>
                <span className={cn("w-12 text-right nums", row.factorBps > 10_000 ? "text-gain" : "text-loss")}>
                  {formatFactor(row.factorBps)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-pretty text-fg-3">
            {t("grade.tableNote", {
              grade: formatGrade(
                BALANCE.nexamon.grading.grades[BALANCE.nexamon.grading.valueBps.findIndex((bps) => bps > 10_000)]!,
              ),
            })}
          </p>
        </div>
      </div>
    </Sheet>
  );
}

function CrackSheet({ copy, card, onClose }: SheetProps) {
  const t = useTranslations("nexamon");
  const tc = useTranslations("nexamonCards");
  const action = useNexamonAction();
  const black = isBlackLabel(copy.grade);
  const blackCfg = BALANCE.nexamon.grading.blackLabel;
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("crack.title")}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:grid sm:grid-cols-2">
          <Button variant="secondary" block onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            block
            variant="loss"
            state={action.state}
            data-testid="crack-confirm"
            onClick={() =>
              void action.run((requestId) => engine.crackNexamonSlab(requestId, copy.id), {
                errorTitle: t("crack.failed"),
                onDone: () => {
                  void playSound("battleCrack");
                  toast.info(t("crack.done"), card.name, { silent: true });
                  onClose();
                },
              })
            }
          >
            {black ? t("crack.blackLabelConfirm") : t("crack.confirm")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4" data-testid="crack-sheet" data-black-label={black}>
        <CopyLine copy={copy} card={card} />
        {black && (
          <div
            role="alert"
            className="rounded-md border-2 border-loss bg-loss-soft p-3"
            data-testid="crack-black-label-warning"
          >
            <p className="font-pixel text-sm text-loss uppercase">{t("crack.blackLabelTitle")}</p>
            <p className="mt-1 text-sm text-pretty text-fg-1">
              {t("crack.blackLabelText", {
                slab: formatMoney(copy.valueCents),
                raw: formatMoney(
                  Math.round((copy.valueCents * conditionFactorBps(copy.condition)) / blackCfg.valueBps),
                ),
                chance: formatChance(blackCfg.chanceBps.mint),
              })}
            </p>
          </div>
        )}
        <p className="text-sm text-pretty text-fg-2">
          {t("crack.text", { condition: tc(`condition.${copy.condition}`) })}
        </p>
        <p className="text-sm font-medium text-pretty text-warn">{t("crack.noRefund")}</p>
      </div>
    </Sheet>
  );
}
