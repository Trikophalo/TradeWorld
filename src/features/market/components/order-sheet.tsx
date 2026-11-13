"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { PixelLoader } from "@/components/ui/button";
import { burstConfetti } from "@/components/ui/effects";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { useGame, useSecurity } from "@/features/game/store";
import type { OrderSide, OrderType } from "@/features/game/types";
import { emitTutorial } from "@/features/tutorial/store";
import { formatMoney, formatPrice, formatShares } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import {
  MAX_QUANTITY_E6,
  MIN_ORDER_CENTS,
  ORDER_FEE_CENTS,
  QUANTITY_SCALE,
  parseEuroCents,
  parsePriceE4,
  parseQuantityE6,
  quantityE6ForBudget,
  quantityE6ForProceeds,
  valueCents,
} from "../order-schema";

export type { OrderSide };
type InputMode = "amount" | "shares";

const money = (value: number) => formatMoney(Math.round(value));
/** A sale with this much realized profit gets confetti. */
const BIG_WIN_CENTS = 100_000;
const TAX_BPS = BALANCE.trading.capitalGainsTaxBps;
const MARKS = [0.25, 0.5, 0.75, 1] as const;

/** Euro text with German formatting but without the currency sign, for input fields. */
const euroInput = (cents: number) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(
    cents / 100,
  );
const priceInput = (e4: number) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false }).format(
    e4 / 10_000,
  );
const sharesInput = (e6: number) =>
  new Intl.NumberFormat("de-DE", { maximumFractionDigits: 6, useGrouping: false }).format(e6 / QUANTITY_SCALE);

export interface OrderSheetProps {
  ticker: string;
  side: OrderSide | null;
  onClose: () => void;
}

/**
 * Order form: bottom sheet on phones, side panel on desktop. The player picks
 * an amount in euros (default, like a neo-broker) or a number of shares,
 * fractions allowed (ADR-040), by typing, by quick buttons or with the slider.
 * Market orders fill at once (the only kind, ADR-117). Limit orders would wait in the order
 * book. Confirmation is "hold to buy", so nothing happens by accident. The
 * estimate is only a preview; the server decides price and quantity.
 */
export function OrderSheet({ ticker, side, onClose }: OrderSheetProps) {
  const t = useTranslations("order");
  const errorText = useGameErrorText();
  const security = useSecurity(ticker);
  const cash = useGame((state) => state.portfolio?.cashCents ?? 0);
  const position = useGame((state) => state.portfolio?.positions.find((p) => p.ticker === ticker));
  const lossPot = useGame((state) => state.portfolio?.lossPotCents ?? 0);
  const session = useGame((state) => state.snapshot?.session);
  const placeOrder = useGame((state) => state.placeOrder);

  // Keep the last side while the sheet animates out.
  const [shown, setShown] = useState<OrderSide>("buy");
  if (side && side !== shown) setShown(side);
  const open = side !== null;

  const [mode, setMode] = useState<InputMode>("amount");
  // Market orders only (ADR-117); the limit branches below stay for a later return.
  const type = "market" as OrderType;
  const [text, setText] = useState("");
  const [limitText, setLimitText] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string>("");
  const anchor = useRef<HTMLDivElement>(null);

  const buying = shown === "buy";
  const marketPrice = security ? (buying ? security.askE4 : security.bidE4) : 0;
  const limitPrice = type === "limit" ? parsePriceE4(limitText) : null;
  const price = type === "limit" && limitPrice ? limitPrice : marketPrice;
  const heldE6 = position ? position.quantityE6 - position.reservedQuantityE6 : 0;

  // What 100 % on the slider means: all cash (buy) or the whole free position (sell).
  const maxAmountCents = buying ? cash : valueCents(heldE6, price);
  const maxSharesE6 = buying ? Math.min(MAX_QUANTITY_E6, quantityE6ForBudget(cash, price)) : heldE6;

  // Fresh form and a new idempotency key every time the sheet opens.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      requestId.current = crypto.randomUUID();
      setMode("amount");
      setText("");
      setLimitText(security ? priceInput(side === "sell" ? security.bidE4 : security.askE4) : "");
      setBusy(false);
    }
    if (open !== wasOpen.current) emitTutorial(open ? "order-sheet-opened" : "order-sheet-closed");
    wasOpen.current = open;
  }, [open, side, security]);

  // Turn the input into an estimated quantity (e6) and value (cents).
  const { quantityE6, amountCents, inputError } = useMemo(() => {
    if (!text.trim()) return { quantityE6: 0, amountCents: null as number | null, inputError: null as string | null };
    if (mode === "shares") {
      const q = parseQuantityE6(text);
      if (q === null) return { quantityE6: 0, amountCents: null, inputError: t("quantityError") };
      return { quantityE6: q, amountCents: null, inputError: q > MAX_QUANTITY_E6 ? t("quantityError") : null };
    }
    const cents = parseEuroCents(text);
    if (cents === null) return { quantityE6: 0, amountCents: null, inputError: t("amountError") };
    const q = buying ? quantityE6ForBudget(cents, price) : quantityE6ForProceeds(cents, price);
    return { quantityE6: q, amountCents: cents, inputError: null };
  }, [mode, text, buying, price, t]);

  const value = quantityE6 > 0 ? valueCents(quantityE6, price) : 0;
  const total = buying ? value + ORDER_FEE_CENTS : value - ORDER_FEE_CENTS;
  // Rough tax preview for sells: gain over the average entry price, minus the loss pot.
  const estimatedGain = !buying && position ? value - valueCents(quantityE6, position.avgPriceE4) - ORDER_FEE_CENTS : 0;
  const estimatedTax = estimatedGain > 0 ? Math.round((Math.max(0, estimatedGain - lossPot) * TAX_BPS) / 10_000) : 0;

  const problem =
    inputError ??
    (type === "limit" && !limitPrice ? t("limitError") : null) ??
    (text.trim() && value < MIN_ORDER_CENTS ? t("tooSmall") : null) ??
    (buying && total > cash ? t("insufficient") : null) ??
    (!buying && quantityE6 > heldE6 * 1.001 ? t("insufficientShares") : null);
  const ready = !!security && !problem && quantityE6 > 0;

  // Slider position from the current input, and input from the slider.
  const ratio =
    mode === "amount"
      ? maxAmountCents > 0
        ? Math.min(1, (amountCents ?? 0) / maxAmountCents)
        : 0
      : maxSharesE6 > 0
        ? Math.min(1, quantityE6 / maxSharesE6)
        : 0;
  const setRatio = (next: number) => {
    const r = Math.max(0, Math.min(1, next));
    if (r === 0) {
      setText("");
      return;
    }
    if (mode === "amount")
      setText(euroInput(r >= 0.999 ? maxAmountCents : Math.round((maxAmountCents * r) / 100) * 100));
    else setText(sharesInput(r >= 0.999 ? maxSharesE6 : Math.floor((maxSharesE6 * r) / 10_000) * 10_000));
  };

  const switchMode = (next: InputMode) => {
    // Keep the same order when switching: translate the current input.
    if (next === mode) return;
    if (next === "shares") setText(quantityE6 > 0 ? sharesInput(quantityE6) : "");
    else setText(value > 0 ? euroInput(buying ? value + ORDER_FEE_CENTS : value) : "");
    setMode(next);
  };

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      // Selling (almost) everything sells everything: no tiny rest stays behind.
      const sellAll = !buying && quantityE6 >= heldE6 * 0.999;
      const result = await placeOrder({
        requestId: requestId.current,
        ticker,
        side: shown,
        type,
        ...(mode === "amount" && !sellAll ? { amountCents } : { quantityE6: sellAll ? heldE6 : quantityE6 }),
        limitPriceE4: type === "limit" ? limitPrice : null,
      });
      emitTutorial("order-confirmed");
      if (result.status === "open") {
        toast.info(
          t("restingTitle"),
          t("restingText", { quantity: formatShares(result.quantityE6), ticker, price: formatPrice(limitPrice ?? 0) }),
        );
      } else {
        void playSound(buying ? "buy" : "sell");
        haptic("success");
        const lines = [
          t("filledText", {
            quantity: formatShares(result.filledQuantityE6),
            ticker,
            price: formatPrice(result.avgPriceE4 ?? 0),
          }),
        ];
        if (result.taxCents > 0) lines.push(t("filledTax", { tax: formatMoney(result.taxCents) }));
        if (result.xpAwarded > 0) lines.push(t("filledXp", { xp: result.xpAwarded }));
        toast.success(t(buying ? "boughtTitle" : "soldTitle"), lines.join(" · "), { silent: true });
        if ((result.realizedPnlCents ?? 0) >= BIG_WIN_CENTS && anchor.current) {
          burstConfetti(anchor.current, 40);
          void playSound("win");
        }
      }
      onClose();
    } catch (error) {
      haptic("error");
      toast.error(t("failedTitle"), errorText(error));
      // A retry uses the same key: the server answers with the same outcome.
    } finally {
      setBusy(false);
    }
  };

  const summary =
    quantityE6 > 0
      ? mode === "amount"
        ? t(buying ? "amountResultBuy" : "amountResultSell", { quantity: formatShares(quantityE6) })
        : t("sharesResult", { value: formatMoney(value) })
      : t("pickHint");

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && !busy && onClose()}
      title={t(buying ? "buyTitle" : "sellTitle", { ticker })}
      description={security ? `${security.name} · ${formatPrice(security.lastE4)}` : undefined}
      footer={
        <div ref={anchor} data-tour="order-confirm" className="space-y-3">
          {session === "after_hours" && <p className="text-center text-xs text-warn">{t("afterHours")}</p>}
          <AnimatePresence mode="wait" initial={false}>
            {busy ? (
              <motion.div
                key="busy"
                className="grid h-13 place-items-center rounded-md border border-line-2 text-fg-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DURATION.fast }}
              >
                <PixelLoader />
              </motion.div>
            ) : (
              <motion.div
                key="hold"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DURATION.fast }}
              >
                <HoldButton tone={buying ? "gain" : "loss"} disabled={!ready} onConfirm={() => void confirm()}>
                  {t(type === "limit" ? "holdLimit" : buying ? "holdBuy" : "holdSell")}
                </HoldButton>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field
              label={t(mode === "shares" ? "quantity" : buying ? "amountBuy" : "amountSell")}
              inputMode="decimal"
              autoComplete="off"
              placeholder={mode === "shares" ? "0" : "0,00"}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="nums text-lg font-semibold"
            />
          </div>
          <Segmented
            value={mode}
            onValueChange={switchMode}
            label={t("inputMode")}
            className="shrink-0"
            options={[
              { value: "amount", label: t("modeAmount") },
              { value: "shares", label: t("modeShares") },
            ]}
          />
        </div>

        <div className="space-y-1">
          <Slider
            value={ratio}
            onValueChange={setRatio}
            label={t("slider")}
            marks={MARKS}
            disabled={maxAmountCents <= ORDER_FEE_CENTS}
            valueText={`${Math.round(ratio * 100)} %`}
            tone={buying ? "gain" : "loss"}
          />
          <div className="grid grid-cols-4 gap-2">
            {MARKS.map((mark) => (
              <button
                key={mark}
                type="button"
                onClick={() => setRatio(mark)}
                disabled={maxAmountCents <= ORDER_FEE_CENTS}
                className={cn(
                  "h-8 rounded-sm border px-2 label-pixel focus-ring transition duration-fast active:scale-[0.97] disabled:opacity-40",
                  Math.abs(ratio - mark) < 0.005
                    ? "border-accent bg-accent-soft text-fg-1"
                    : "border-line-2 text-fg-2 hover:bg-surface-2 hover:text-fg-1",
                )}
              >
                {mark === 1 ? t(buying ? "max" : "all") : `${mark * 100} %`}
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence initial={false}>
          {type === "limit" && (
            <motion.div
              data-tour="order-limit-price"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: DURATION.base, ease: EASE.out }}
            >
              <Field
                label={t("limitPrice")}
                inputMode="decimal"
                autoComplete="off"
                value={limitText}
                onChange={(event) => setLimitText(event.target.value)}
                hint={t(buying ? "limitHintBuy" : "limitHintSell")}
                className="nums"
              />
            </motion.div>
          )}
        </AnimatePresence>

        <p role={problem ? "alert" : undefined} className={cn("min-h-5 text-sm", problem ? "text-loss" : "text-fg-3")}>
          {problem ?? summary}
        </p>

        <dl className="space-y-3 text-fg-2">
          <div className="flex justify-between">
            <dt>{t(type === "limit" ? "limitPrice" : buying ? "priceAsk" : "priceBid")}</dt>
            <dd className="nums text-fg-1">{formatPrice(price)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{t("value", { quantity: formatShares(quantityE6) })}</dt>
            <dd className="text-fg-1">
              <NumberTicker value={value} format={money} />
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>{t("fee")}</dt>
            <dd className="nums text-fg-1">{formatMoney(ORDER_FEE_CENTS)}</dd>
          </div>
          {!buying && estimatedTax > 0 && (
            <div className="flex justify-between">
              <dt>{t("taxEstimate")}</dt>
              <dd className="nums text-fg-1">−{formatMoney(estimatedTax)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-line-1 pt-3 text-base font-semibold text-fg-1">
            <dt>{t(buying ? "total" : "proceeds")}</dt>
            <dd>
              <NumberTicker value={Math.max(0, total - estimatedTax)} format={money} />
            </dd>
          </div>
          <div className="flex justify-between text-sm text-fg-3">
            <dt>{t(buying ? "available" : "availableShares")}</dt>
            <dd className="nums">{buying ? formatMoney(cash) : formatShares(heldE6)}</dd>
          </div>
        </dl>
      </div>
    </Sheet>
  );
}
