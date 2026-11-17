"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { BALANCE } from "@/config/balance";
import { nexamonCard, type NexamonRarity } from "@/config/nexamon";
import { Badge } from "@/components/ui/badge";
import { Button, PixelLoader, type ButtonState } from "@/components/ui/button";
import { HoldButton } from "@/components/ui/hold-button";
import { toast } from "@/components/ui/toast";
import { engine } from "@/features/game/store";
import { formatMoney } from "@/lib/format";
import { nexamonInstantPayout, nexamonInstantSellCents } from "@/lib/sim/nexamon";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useNexamonAction } from "../hooks";
import { formatChance } from "../view";
import { RarityBadge } from "./badges";

/** A fresh pull that can go to the game at once (ADR-196). */
export interface InstantSellItem {
  copyId: string;
  cardKey: string;
  rarity: NexamonRarity;
  valueCents: number;
}

const cfg = BALANCE.nexamon.instantSell;

/**
 * ADR-196: right after a pack opening or a won Pack Battle, the fresh pulls can go to the game for 90 % of their
 * value: all at once (hold to confirm) or card by card. A One of One asks once more. The server checks the window
 * (instantSell.windowSeconds) and pays; the shown sums use the values at pull time.
 */
export function InstantSell({ items, className }: { items: readonly InstantSellItem[]; className?: string }) {
  const t = useTranslations("nexamon.instant");
  const [sold, setSold] = useState<ReadonlySet<string>>(new Set());
  const [paid, setPaid] = useState(0);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const all = useNexamonAction();
  const one = useNexamonAction();
  const left = items.filter((i) => !sold.has(i.copyId));
  const payout = nexamonInstantPayout(left.map((i) => i.valueCents));
  const hasOneOfOne = left.some((i) => i.rarity === "one_of_one");
  const rate = formatChance(cfg.payoutBps);
  if (items.length === 0) return null;

  const sell = (picked: readonly InstantSellItem[], action: ReturnType<typeof useNexamonAction>) =>
    action.run(
      (requestId) =>
        engine.instantSellNexamon(
          requestId,
          picked.map((i) => i.copyId),
        ),
      {
        errorTitle: t("failed"),
        onDone: (r) => {
          void playSound("coin");
          setSold((s) => new Set([...s, ...r.sold.map((x) => x.copyId)]));
          setPaid((p) => p + r.totalCents);
          toast.success(t("sold", { count: r.count }), formatMoney(r.totalCents), { silent: true });
        },
      },
    );

  const sellOne = async (item: InstantSellItem) => {
    if (item.rarity === "one_of_one" && confirmId !== item.copyId) {
      setConfirmId(item.copyId);
      return;
    }
    setConfirmId(null);
    setBusyId(item.copyId);
    await sell([item], one);
    setBusyId(null);
  };

  return (
    <section
      className={cn("w-full space-y-2 rounded-lg border-2 border-line-1 bg-surface-1 p-3 text-left", className)}
      data-testid="instant-sell"
      aria-label={t("title", { rate })}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="label-pixel text-fg-2">{t("title", { rate })}</h3>
        {paid > 0 && (
          <span className="nums text-xs font-semibold text-gain" data-testid="instant-paid">
            {t("paid", { amount: formatMoney(paid) })}
          </span>
        )}
      </div>
      {left.length > 0 ? (
        <div data-testid="instant-all">
          {all.state === "loading" ? (
            <div className="grid h-9 w-full place-items-center rounded-md border border-line-2 bg-surface-2 text-fg-2">
              <PixelLoader />
            </div>
          ) : (
            <HoldButton
              tone="gain"
              duration={hasOneOfOne ? 1.6 : 0.9}
              onConfirm={() => void sell(left, all)}
              className="h-9 px-2 text-2xs leading-tight"
            >
              {t("all", { amount: formatMoney(payout.payoutCents) })}
            </HoldButton>
          )}
          <p className="mt-1 text-2xs text-pretty text-fg-3">
            {hasOneOfOne ? t("holdOneOfOne") : t("hold", { minutes: Math.round(cfg.windowSeconds / 60) })}
          </p>
        </div>
      ) : (
        <p className="text-xs text-fg-2" data-testid="instant-done">
          {t("allSold")}
        </p>
      )}
      {items.length > 1 && left.length > 0 ? (
        <button
          type="button"
          className="text-2xs text-fg-2 underline-offset-2 focus-ring hover:text-fg-1 hover:underline"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          data-testid="instant-toggle"
        >
          {open ? t("hideSingle") : t("showSingle")}
        </button>
      ) : null}
      {(open || items.length === 1) && left.length > 0 && (
        <ul className="divide-y divide-line-1" data-testid="instant-list">
          {items.map((item) => {
            const card = nexamonCard(item.cardKey);
            const done = sold.has(item.copyId);
            const state: ButtonState = busyId === item.copyId ? one.state : "idle";
            const asking = confirmId === item.copyId;
            return (
              <li key={item.copyId} className="flex min-w-0 items-center gap-2 py-1.5" data-testid="instant-row">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-fg-1">{card?.name ?? item.cardKey}</span>
                  <RarityBadge rarity={item.rarity} short />
                </span>
                <span className="shrink-0 nums text-xs text-fg-2">
                  {formatMoney(nexamonInstantSellCents(item.valueCents))}
                </span>
                {done ? (
                  <Badge tone="gain">{t("soldOne")}</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant={asking ? "loss" : "secondary"}
                    className="h-7 px-2"
                    state={state}
                    disabled={busyId !== null && busyId !== item.copyId}
                    onClick={() => void sellOne(item)}
                    data-testid="instant-one"
                  >
                    {asking ? t("confirmOneOfOne") : t("one", { rate })}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
