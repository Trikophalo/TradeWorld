"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { useGame } from "@/features/game/store";
import type { OpenOrder } from "@/features/game/types";
import { formatPrice, formatShares } from "@/lib/format";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Resting limit orders with a cancel button. Hidden while there are none. */
export function OrdersList() {
  const t = useTranslations("portfolio");
  const orders = useGame((state) => state.portfolio?.openOrders);
  if (!orders || orders.length === 0) return null;

  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle>{t("openOrders")}</CardTitle>
      </CardHeader>
      <ul className="divide-y divide-line-1">
        <AnimatePresence initial={false}>
          {orders.map((order) => (
            <motion.li key={order.id} layout exit={{ opacity: 0, x: 24 }} transition={SPRING.smooth}>
              <OrderRow order={order} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Card>
  );
}

function OrderRow({ order }: { order: OpenOrder }) {
  const t = useTranslations("portfolio");
  const errorText = useGameErrorText();
  const cancel = useGame((state) => state.cancelOrder);
  const [state, setState] = useState<ButtonState>("idle");

  const onCancel = async () => {
    setState("loading");
    try {
      await cancel(order.id);
      toast.info(t("cancelled"));
    } catch (error) {
      setState("idle");
      toast.error(t("cancelFailed"), errorText(error));
    }
  };

  return (
    <div className="flex items-center gap-3 py-3">
      <span
        className={cn(
          "grid h-7 shrink-0 place-items-center rounded-xs px-2 label-pixel",
          order.side === "buy" ? "bg-gain-soft text-gain" : "bg-loss-soft text-loss",
        )}
      >
        {t(order.side === "buy" ? "sideBuy" : "sideSell")}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-fg-1">{order.ticker}</span>
        <span className="nums text-sm text-fg-3">
          {t("orderLine", { quantity: formatShares(order.quantityE6), price: formatPrice(order.limitPriceE4 ?? 0) })}
        </span>
      </span>
      <Button size="sm" variant="ghost" state={state} onClick={() => void onCancel()}>
        {t("cancel")}
      </Button>
    </div>
  );
}
