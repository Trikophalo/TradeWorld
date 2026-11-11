"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { burstConfetti } from "@/components/ui/effects";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { emitTutorial } from "@/features/tutorial/store";
import type { DemoCompany } from "@/lib/demo/market";
import { useDemo } from "@/lib/demo/store";
import { formatMoney, formatPrice } from "@/lib/format";
import { ORDER_FEE_CENTS, orderDraftSchema, orderValueCents } from "../order-schema";

export type OrderSide = "buy" | "sell";

const money = (value: number) => formatMoney(Math.round(value));

export interface OrderSheetProps {
  company: DemoCompany;
  side: OrderSide | null;
  priceE4: number;
  onClose: () => void;
}

/**
 * Order form. In M0 it is a preview: it validates, shows costs and confirms,
 * but books nothing. From M1 the hold button calls the `place_order` RPC.
 */
export function OrderSheet({ company, side, priceE4, onClose }: OrderSheetProps) {
  const t = useTranslations("order");
  const cash = useDemo((state) => state.cashCents);
  const [raw, setRaw] = useState("1");
  const anchor = useRef<HTMLDivElement>(null);
  // Keep the last side while the sheet animates out.
  const [shown, setShown] = useState<OrderSide>("buy");
  if (side && side !== shown) setShown(side);

  const quantity = Number(raw);
  const parsed = orderDraftSchema.shape.quantity.safeParse(quantity);
  const valid = parsed.success && /^\d+$/.test(raw.trim());
  const value = valid ? orderValueCents(quantity, priceE4) : 0;
  const total = shown === "buy" ? value + ORDER_FEE_CENTS : value - ORDER_FEE_CENTS;
  const affordable = shown === "sell" || total <= cash;

  // Tell the tutorial when the sheet opens and closes.
  const open = side !== null;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open !== wasOpen.current) emitTutorial(open ? "order-sheet-opened" : "order-sheet-closed");
    wasOpen.current = open;
  }, [open]);

  const confirm = () => {
    emitTutorial("order-confirmed");
    if (anchor.current) burstConfetti(anchor.current);
    toast.success(
      t("demoDoneTitle"),
      t("demoDoneText", { quantity, ticker: company.ticker, total: formatMoney(total) }),
    );
    onClose();
  };

  const rows = [
    { label: t("price"), node: <span className="nums">{formatPrice(priceE4)}</span> },
    { label: t("value"), node: <NumberTicker value={value} format={money} /> },
    { label: t("fee"), node: <span className="nums">{formatMoney(ORDER_FEE_CENTS)}</span> },
  ];

  return (
    <Sheet
      open={side !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t(shown === "buy" ? "buyTitle" : "sellTitle", { ticker: company.ticker })}
      description={t("description")}
      footer={
        <div ref={anchor} data-tour="order-confirm">
          <HoldButton tone={shown === "buy" ? "gain" : "loss"} disabled={!valid || !affordable} onConfirm={confirm}>
            {t(shown === "buy" ? "holdBuy" : "holdSell")}
          </HoldButton>
        </div>
      }
    >
      <Field
        label={t("quantity")}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={raw}
        onChange={(event) => setRaw(event.target.value)}
        hint={t("quantityHint")}
        error={!valid ? t("quantityError") : !affordable ? t("insufficient") : undefined}
        className="nums text-lg font-semibold"
      />
      <dl className="mt-5 space-y-3 text-fg-2">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between">
            <dt>{row.label}</dt>
            <dd className="text-fg-1">{row.node}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t border-line-1 pt-3 text-base font-semibold text-fg-1">
          <dt>{t("total")}</dt>
          <dd>
            <NumberTicker value={Math.max(0, total)} format={money} />
          </dd>
        </div>
        <div className="flex justify-between text-sm text-fg-3">
          <dt>{t("available")}</dt>
          <dd className="nums">{formatMoney(cash)}</dd>
        </div>
      </dl>
    </Sheet>
  );
}
