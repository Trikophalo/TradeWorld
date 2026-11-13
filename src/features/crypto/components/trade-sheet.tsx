"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, type ButtonState } from "@/components/ui/button";
import { flyCoins } from "@/components/ui/effects";
import { Field } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { CoinCategory, CoinDetail, MyCoin } from "@/features/game/types";
import { parseEuroCents, parseQuantityE6 } from "@/features/market/order-schema";
import { formatBps, formatMoney, formatPrice, formatShares } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { buySlippageBps, swapBuy, swapSell, type Pool } from "@/lib/sim/crypto";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useCryptoRefresh } from "../hooks";

export type TradeSide = "buy" | "sell";

const SLIPPAGE_OPTIONS = [100, 300, 500, 1500, 5000] as const;
const DEFAULT_SLIPPAGE: Record<CoinCategory, number> = { stable: 100, major: 300, alt: 500, meme: 1500, player: 1500 };

const ORDER_FEE = BALANCE.trading.orderFeeCents;

/**
 * What a trade would bring right now, from the coin's pool (the server checks it again). Like stocks, every trade
 * pays one order fee: on a buy it comes out of the amount, on a sell out of the proceeds.
 */
export function tradePreview(
  pool: Pool,
  feeBps: number,
  side: TradeSide,
  amount: number,
  orderFeeCents = ORDER_FEE,
): { quantityE6: number; cashCents: number; feeCents: number; avgE4: number; slippageBps: number } | null {
  if (amount <= 0 || pool.tokensE6 <= 0n) return null;
  const price = Number((pool.cashCents * 100_000_000n) / pool.tokensE6);
  if (side === "buy") {
    const swap = amount - orderFeeCents;
    if (swap <= 0) return null;
    const r = swapBuy(pool, BigInt(swap), feeBps);
    const quantity = Number(r.tokensOutE6);
    if (quantity <= 0) return null;
    return {
      quantityE6: quantity,
      cashCents: amount,
      feeCents: Number(r.feeCents),
      avgE4: Math.round((swap * 100_000_000) / quantity),
      slippageBps: buySlippageBps(pool, BigInt(swap), feeBps),
    };
  }
  const r = swapSell(pool, BigInt(amount), feeBps);
  const cash = Number(r.cashOutCents);
  const avg = Math.round((cash * 100_000_000) / amount);
  return {
    quantityE6: amount,
    cashCents: Math.max(0, cash - orderFeeCents),
    feeCents: Number(r.feeCents),
    avgE4: avg,
    slippageBps: price > 0 ? Math.round(((price - avg) / price) * 10_000) : 10_000,
  };
}

/** Buy for an amount in euros or sell a number of coins, against the pool, with a slippage limit (ADR-101). */
export function CoinTradeSheet({
  coin,
  side,
  onClose,
  mine,
}: {
  coin: CoinDetail;
  side: TradeSide | null;
  onClose: () => void;
  /** The player's own coin, to warn before team coins are sold. */
  mine?: MyCoin | null;
}) {
  const t = useTranslations("crypto.trade");
  const errorText = useGameErrorText();
  const refresh = useCryptoRefresh();
  const cash = useGame((s) => s.portfolio?.cashCents ?? 0);
  const held = coin.myPosition?.quantityE6 ?? 0;
  const [input, setInput] = useState("");
  const [maxSlippage, setMaxSlippage] = useState(DEFAULT_SLIPPAGE[coin.category]);
  const [state, setState] = useState<ButtonState>("idle");
  const [shownSide, setShownSide] = useState(side);
  if (side !== shownSide) {
    setShownSide(side);
    if (side) {
      setInput("");
      setState("idle");
    }
  }
  const current = side ?? shownSide ?? "buy";

  const amount = current === "buy" ? parseEuroCents(input) : parseQuantityE6(input);
  const pool: Pool = { cashCents: BigInt(coin.pool.cashCents), tokensE6: BigInt(coin.pool.tokensE6) };
  const preview = amount ? tradePreview(pool, coin.feeBps, current, amount) : null;
  const overLimit = current === "buy" ? (amount ?? 0) > cash : (amount ?? 0) > held;
  const tooMuchSlip = preview !== null && preview.slippageBps > maxSlippage;
  const ownTeam = mine && mine.ticker === coin.ticker && mine.teamTokensE6 > 0 && current === "sell";
  const canTrade = Boolean(preview) && !overLimit && !tooMuchSlip && coin.status === "listed";

  const submit = async (target: HTMLElement) => {
    if (!amount) return;
    setState("loading");
    try {
      const r = await engine.cryptoTrade({
        requestId: crypto.randomUUID(),
        ticker: coin.ticker,
        side: current,
        ...(current === "buy" ? { amountCents: amount } : { quantityE6: amount }),
        maxSlippageBps: maxSlippage,
      });
      setState("success");
      haptic("success");
      if (current === "sell") {
        flyCoins(target, document.querySelector('[data-fly-target="cash"]'));
        void playSound("coin");
      } else void playSound("success");
      const values = {
        quantity: formatShares(r.quantityE6),
        ticker: coin.ticker,
        amount: formatMoney(r.cashCents),
      };
      toast.success(
        current === "buy" ? t("bought") : t("sold"),
        current === "buy" ? t("boughtText", values) : t("soldText", values),
        { silent: true },
      );
      if (r.rugPull) toast.error(t("sold"), t("rugPulled"));
      await refresh();
      window.setTimeout(onClose, 350);
    } catch (error) {
      setState("idle");
      toast.error(t("failed"), errorText(error));
    }
  };

  return (
    <Sheet
      open={side !== null}
      onOpenChange={(o) => !o && onClose()}
      title={current === "buy" ? t("buyTitle", { ticker: coin.ticker }) : t("sellTitle", { ticker: coin.ticker })}
      description={`${coin.name} · ${formatPrice(coin.priceE4)}`}
      footer={
        <Button
          variant={current === "buy" ? "primary" : "secondary"}
          block
          size="lg"
          state={state}
          disabled={!canTrade}
          onClick={(e) => void submit(e.currentTarget)}
          data-testid="crypto-trade-submit"
        >
          {current === "buy" ? t("buyTitle", { ticker: coin.ticker }) : t("sellTitle", { ticker: coin.ticker })}
        </Button>
      }
    >
      <div className="space-y-4" data-testid="crypto-trade">
        <Field
          label={current === "buy" ? t("amount") : t("quantity")}
          inputMode="decimal"
          autoComplete="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={current === "buy" ? "100" : formatShares(Math.round(held / 2))}
          hint={
            current === "buy"
              ? t("available", { amount: formatMoney(cash) })
              : t("holding", { amount: formatShares(held) })
          }
          error={
            overLimit ? (current === "buy" ? t("available", { amount: formatMoney(cash) }) : undefined) : undefined
          }
          data-testid="crypto-trade-input"
        />
        <div className="flex flex-wrap gap-1.5">
          {(current === "buy" ? [2_500, 10_000, 50_000] : [2_500, 5_000, 10_000]).map((x) => (
            <button
              key={x}
              type="button"
              className="h-8 rounded-pill border border-line-1 bg-surface-1 px-3 nums text-sm text-fg-2 focus-ring transition duration-fast hover:bg-surface-2 active:scale-95"
              onClick={() =>
                setInput(
                  current === "buy"
                    ? String(Math.floor(Math.min(cash, x * 100) / 100))
                    : formatShares(Math.floor((held * x) / 10_000), true).replace(/\./g, ""),
                )
              }
            >
              {current === "buy" ? formatMoney(x * 100, { whole: true }) : x === 10_000 ? t("all") : formatBps(x)}
            </button>
          ))}
        </div>

        <dl className="space-y-1.5 rounded-lg border border-line-1 bg-surface-2 p-3 text-sm">
          <Row label={t("price")} value={formatPrice(coin.priceE4)} />
          <Row
            label={current === "buy" ? t("youGet") : t("youReceive")}
            value={
              preview
                ? current === "buy"
                  ? `${formatShares(preview.quantityE6)} ${coin.ticker}`
                  : formatMoney(preview.cashCents)
                : "–"
            }
            strong
          />
          <Row label={t("avg")} value={preview ? formatPrice(preview.avgE4) : "–"} />
          <Row
            label={t("fee", { pct: formatBps(coin.feeBps).replace(/^\+/, "") })}
            value={preview ? formatMoney(preview.feeCents) : "–"}
          />
          <Row label={t("orderFee")} value={formatMoney(ORDER_FEE)} />
          <Row
            label={t("slippage")}
            value={preview ? formatBps(preview.slippageBps).replace(/^\+/, "") : "–"}
            tone={tooMuchSlip ? "loss" : undefined}
          />
        </dl>
        <p className="text-xs text-pretty text-fg-3">{t("slippageHint")}</p>

        <div className="space-y-1.5">
          <p className="text-sm text-fg-2">{t("maxSlippage")}</p>
          <Segmented
            value={String(maxSlippage)}
            onValueChange={(v) => setMaxSlippage(Number(v))}
            options={SLIPPAGE_OPTIONS.map((v) => ({ value: String(v), label: `${v / 100} %` }))}
            label={t("maxSlippage")}
            size="sm"
            block
          />
        </div>
        {tooMuchSlip && (
          <p role="alert" className="rounded-md bg-loss-soft px-3 py-2 text-sm text-loss">
            {t("tooMuch")}
          </p>
        )}
        {ownTeam && (
          <p role="alert" className="rounded-md bg-warn-soft px-3 py-2 text-sm text-pretty text-warn">
            {t("rugWarning", { limit: formatShares(mine.rugLimitE6) })}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "loss" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-3">{label}</dt>
      <dd
        className={cn(
          "text-right nums",
          strong ? "font-semibold text-fg-1" : "text-fg-2",
          tone === "loss" && "text-loss",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
