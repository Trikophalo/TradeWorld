"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { PixelLoader } from "@/components/ui/button";

import { burstConfetti } from "@/components/ui/effects";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { LockBadge } from "@/components/ui/lock-badge";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { useGame, usePlayerLevel, useSecurity } from "@/features/game/store";
import type { OrderSide, OrderType } from "@/features/game/types";
import { emitTutorial } from "@/features/tutorial/store";
import { formatInteger, formatMoney, formatPrice } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE } from "@/lib/motion";
import { isUnlocked, unlockLevel } from "@/lib/sim/progression";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import {
  ORDER_FEE_CENTS,
  orderValueCents,
  parseEuroCents,
  parsePriceE4,
  quantityForBudget,
  quantityForProceeds,
} from "../order-schema";

export type { OrderSide };
type InputMode = "shares" | "amount";

const money = (value: number) => formatMoney(Math.round(value));
const LIMIT_LEVEL = unlockLevel("limit_orders") ?? 1;
const MAX_QUANTITY = 100_000;
/** Above this share of the cash a celebration is worth it on profit. */
const BIG_WIN_CENTS = 100_000;
const TAX_BPS = BALANCE.trading.capitalGainsTaxBps;

/** Euro text with German formatting but without the currency sign, for input fields. */
const euroInput = (cents: number) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(
    cents / 100,
  );
const priceInput = (e4: number) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false }).format(
    e4 / 10_000,
  );

export interface OrderSheetProps {
  ticker: string;
  side: OrderSide | null;
  onClose: () => void;
}

/**
 * Order form: bottom sheet on phones, side panel on desktop. The player types
 * either a number of shares or a euro amount (whole shares are bought, the
 * rest stays in cash). Market orders fill at once, limit orders (from level 3)
 * wait in the order book. Confirmation is "hold to buy", so nothing happens by
 * accident. The estimate here is only a preview; the server decides the price.
 */
export function OrderSheet({ ticker, side, onClose }: OrderSheetProps) {
  const t = useTranslations("order");
  const tl = useTranslations("locks");
  const errorText = useGameErrorText();
  const security = useSecurity(ticker);
  const cash = useGame((state) => state.portfolio?.cashCents ?? 0);
  const position = useGame((state) => state.portfolio?.positions.find((p) => p.ticker === ticker));
  const lossPot = useGame((state) => state.portfolio?.lossPotCents ?? 0);
  const session = useGame((state) => state.snapshot?.session);
  const placeOrder = useGame((state) => state.placeOrder);
  const level = usePlayerLevel();
  const limitUnlocked = isUnlocked("limit_orders", level);

  // Keep the last side while the sheet animates out.
  const [shown, setShown] = useState<OrderSide>("buy");
  if (side && side !== shown) setShown(side);
  const open = side !== null;

  const [mode, setMode] = useState<InputMode>("shares");
  const [type, setType] = useState<OrderType>("market");
  const [sharesText, setSharesText] = useState("1");
  const [amountText, setAmountText] = useState("");
  const [limitText, setLimitText] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string>("");
  const anchor = useRef<HTMLDivElement>(null);

  // Fresh form and a new idempotency key every time the sheet opens.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      requestId.current = crypto.randomUUID();
      setType("market");
      setSharesText("1");
      setAmountText("");
      setLimitText(security ? priceInput(side === "sell" ? security.bidE4 : security.askE4) : "");
      setBusy(false);
    }
    if (open !== wasOpen.current) emitTutorial(open ? "order-sheet-opened" : "order-sheet-closed");
    wasOpen.current = open;
  }, [open, side, security]);

  const buying = shown === "buy";
  const marketPrice = security ? (buying ? security.askE4 : security.bidE4) : 0;
  const limitPrice = type === "limit" ? parsePriceE4(limitText) : null;
  const price = type === "limit" && limitPrice ? limitPrice : marketPrice;
  const held = position ? position.quantity - position.reservedQuantity : 0;

  const { quantity, inputError } = useMemo(() => {
    if (mode === "shares") {
      const valid = /^\d+$/.test(sharesText.trim());
      const n = valid ? Number(sharesText) : 0;
      return { quantity: n, inputError: !valid || n < 1 || n > MAX_QUANTITY ? t("quantityError") : null };
    }
    const cents = parseEuroCents(amountText);
    if (cents === null) return { quantity: 0, inputError: amountText.trim() ? t("amountError") : null };
    const n = buying ? quantityForBudget(cents, price) : Math.min(held, quantityForProceeds(cents, price));
    return { quantity: n, inputError: n < 1 ? t("amountTooSmall") : null };
  }, [mode, sharesText, amountText, buying, price, held, t]);

  const value = quantity > 0 ? orderValueCents(quantity, price) : 0;
  const total = buying ? value + ORDER_FEE_CENTS : value - ORDER_FEE_CENTS;
  // Rough tax preview for sells: gain over the average entry price, minus the loss pot.
  const estimatedGain =
    !buying && position ? value - orderValueCents(quantity, position.avgPriceE4) - ORDER_FEE_CENTS : 0;
  const estimatedTax = estimatedGain > 0 ? Math.round((Math.max(0, estimatedGain - lossPot) * TAX_BPS) / 10_000) : 0;

  const problem =
    inputError ??
    (type === "limit" && !limitPrice ? t("limitError") : null) ??
    (buying && total > cash ? t("insufficient") : null) ??
    (!buying && quantity > held ? t("insufficientShares") : null);

  const chips = buying
    ? [10_000, 50_000, 100_000].map((cents) => ({ label: money(cents).replace(",00", ""), cents }))
    : [];

  const setMax = () => {
    if (buying) {
      if (mode === "amount") setAmountText(euroInput(cash));
      else setSharesText(String(Math.min(MAX_QUANTITY, quantityForBudget(cash, price))));
    } else if (mode === "amount") setAmountText(euroInput(orderValueCents(held, price)));
    else setSharesText(String(held));
  };

  const confirm = async () => {
    if (!security || problem || busy) return;
    setBusy(true);
    try {
      const result = await placeOrder({
        requestId: requestId.current,
        ticker,
        side: shown,
        type,
        quantity,
        limitPriceE4: type === "limit" ? limitPrice : null,
      });
      emitTutorial("order-confirmed");
      if (result.status === "open") {
        toast.info(t("restingTitle"), t("restingText", { quantity, ticker, price: formatPrice(limitPrice ?? 0) }));
      } else {
        void playSound(buying ? "buy" : "sell");
        haptic("success");
        const lines = [
          t("filledText", {
            quantity: formatInteger(result.filledQuantity),
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
      // A failed attempt may be retried with the same key: the server answers with the same outcome.
    } finally {
      setBusy(false);
    }
  };

  const typeOptions = [
    { value: "market" as const, label: t("typeMarket") },
    {
      value: "limit" as const,
      label: t("typeLimit"),
      adornment: limitUnlocked ? undefined : <LockBadge level={LIMIT_LEVEL} />,
    },
  ];

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
                <HoldButton
                  tone={buying ? "gain" : "loss"}
                  disabled={!!problem || !security}
                  onConfirm={() => void confirm()}
                >
                  {t(type === "limit" ? (buying ? "holdLimitBuy" : "holdLimitSell") : buying ? "holdBuy" : "holdSell")}
                </HoldButton>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={type}
          onValueChange={(next) => {
            if (next === "limit" && !limitUnlocked) {
              haptic("warning");
              toast.info(
                tl("lockedToast", { level: LIMIT_LEVEL }),
                tl("lockedToastText", { feature: t("typeLimit"), level: LIMIT_LEVEL }),
              );
              return;
            }
            setType(next);
          }}
          options={typeOptions}
          label={t("type")}
          block
          size="sm"
        />

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            {mode === "shares" ? (
              <Field
                label={t("quantity")}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={sharesText}
                onChange={(event) => setSharesText(event.target.value)}
                className="nums text-lg font-semibold"
              />
            ) : (
              <Field
                label={t(buying ? "amountBuy" : "amountSell")}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
                className="nums text-lg font-semibold"
              />
            )}
          </div>
          <Segmented
            value={mode}
            onValueChange={setMode}
            label={t("inputMode")}
            className="shrink-0"
            options={[
              { value: "shares", label: t("modeShares") },
              { value: "amount", label: t("modeAmount") },
            ]}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {mode === "amount" &&
            chips.map((chip) => (
              <button
                key={chip.cents}
                type="button"
                onClick={() => setAmountText(euroInput(chip.cents))}
                className="h-8 rounded-sm border border-line-2 px-3 text-sm text-fg-2 focus-ring transition duration-fast hover:bg-surface-2 hover:text-fg-1 active:scale-[0.97]"
              >
                {chip.label}
              </button>
            ))}
          <button
            type="button"
            onClick={setMax}
            className="h-8 rounded-sm border border-line-2 px-3 label-pixel text-fg-2 focus-ring transition duration-fast hover:bg-surface-2 hover:text-fg-1 active:scale-[0.97]"
          >
            {t(buying ? "max" : "all")}
          </button>
        </div>

        <AnimatePresence initial={false}>
          {type === "limit" && (
            <motion.div
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
          {problem ??
            (mode === "amount" && quantity > 0
              ? t("amountResult", { quantity: formatInteger(quantity) })
              : t("estimateHint"))}
        </p>

        <dl className="space-y-3 text-fg-2">
          <div className="flex justify-between">
            <dt>{t(type === "limit" ? "limitPrice" : buying ? "priceAsk" : "priceBid")}</dt>
            <dd className="nums text-fg-1">{formatPrice(price)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{t("value", { quantity: formatInteger(quantity) })}</dt>
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
            <dd className="nums">{buying ? formatMoney(cash) : formatInteger(held)}</dd>
          </div>
        </dl>
      </div>
    </Sheet>
  );
}
