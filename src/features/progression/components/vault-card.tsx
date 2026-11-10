"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { COIN } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { flyCoins } from "@/components/ui/effects";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/toast";
import { DEMO_VAULT, useDemo, vaultCents } from "@/lib/demo/store";
import { formatCountdown, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { useClock } from "@/lib/use-now";

const format = (value: number) => formatMoney(Math.round(value));
const CAP_CENTS = DEMO_VAULT.ratePerHourCents * DEMO_VAULT.capHours;

/**
 * Basic income collects here, up to eight hours. Emptying it sends pixel
 * coins to the cash balance in the top bar. In M2 the amount is computed and
 * booked by the `claim_vault` RPC; this card only shows the estimate.
 */
export function VaultCard() {
  const t = useTranslations("vault");
  const now = useClock();
  const claimedAt = useDemo((state) => state.vaultClaimedAt);
  const claim = useDemo((state) => state.claimVault);
  const [state, setState] = useState<ButtonState>("idle");
  const art = useRef<HTMLDivElement>(null);

  const amount = now === null ? 0 : vaultCents(claimedAt, now);
  const full = amount >= CAP_CENTS;
  const secondsToFull = ((CAP_CENTS - amount) / DEMO_VAULT.ratePerHourCents) * 3600;

  const onClaim = () => {
    const claimed = claim();
    if (claimed <= 0) return;
    if (art.current) flyCoins(art.current, document.querySelector('[data-fly-target="cash"]'));
    void playSound("coin");
    haptic("success");
    setState("success");
    toast.success(t("claimed"), t("claimedText", { amount: formatMoney(claimed) }));
    window.setTimeout(() => setState("idle"), 1200);
  };

  return (
    <Card padding="lg">
      <div className="flex items-center gap-4">
        <div ref={art} className="grid size-16 shrink-0 place-items-center rounded-lg bg-surface-2">
          <PixelIcon {...COIN} scale={3} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="label-pixel text-fg-2">{t("title")}</h2>
          <NumberTicker value={amount} format={format} className="mt-0.5 text-2xl font-semibold text-fg-1" />
          <p className="truncate text-sm text-fg-3">
            {t("subtitle", { rate: formatMoney(DEMO_VAULT.ratePerHourCents, { whole: true }) })}
          </p>
        </div>
      </div>
      <Progress value={amount / CAP_CENTS} label={t("progress")} tone={full ? "warn" : "gold"} className="mt-4" />
      <div className="mt-2 flex justify-between text-sm">
        <span className={full ? "text-warn" : "text-fg-3"}>{full ? t("fullHint") : t("fillsIn")}</span>
        {!full && <span className="nums text-fg-2">{now === null ? "--:--" : formatCountdown(secondsToFull)}</span>}
      </div>
      <Button block className="mt-4" state={state} disabled={amount < 100} onClick={onClaim}>
        {amount < 100 ? t("empty") : t("claim")}
      </Button>
    </Card>
  );
}
