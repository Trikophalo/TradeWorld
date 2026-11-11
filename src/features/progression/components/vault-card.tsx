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
import { BALANCE } from "@/config/balance";
import { useGame } from "@/features/game/store";
import { useGameErrorText } from "@/features/game/errors";
import { formatCountdown, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { emitTutorial } from "@/features/tutorial/store";
import { playSound } from "@/lib/sound";
import { useClock } from "@/lib/use-now";

const format = (value: number) => formatMoney(Math.round(value));
const RATE = BALANCE.economy.basicIncomeCentsPerHour;
const CAP_CENTS = RATE * BALANCE.economy.vaultCapHours;
const HOUR_MS = 3_600_000;

/**
 * Basic income collects here, up to eight hours. Emptying it sends pixel
 * coins to the cash balance in the top bar. The server books the amount
 * (`claim_vault`); the card counts up locally between two portfolio refreshes.
 */
export function VaultCard() {
  const t = useTranslations("vault");
  const now = useClock();
  const vault = useGame((state) => state.portfolio?.vault);
  const skew = useGame((state) => state.clockSkewMs);
  const claim = useGame((state) => state.claimVault);
  const errorText = useGameErrorText();
  const [state, setState] = useState<ButtonState>("idle");
  const art = useRef<HTMLDivElement>(null);

  // Amount as of now: the server value plus what accrued since it was read, capped.
  const amount =
    !vault || now === null
      ? 0
      : Math.min(
          vault.capCents,
          vault.accruedCents + ((now - skew - Date.parse(vault.serverTime)) / HOUR_MS) * vault.rateCentsPerHour,
        );
  const full = amount >= CAP_CENTS;
  const secondsToFull = ((CAP_CENTS - amount) / RATE) * 3600;

  const onClaim = async () => {
    setState("loading");
    try {
      const claimed = await claim();
      emitTutorial("vault-claimed");
      if (art.current) flyCoins(art.current, document.querySelector('[data-fly-target="cash"]'));
      void playSound("coin");
      haptic("success");
      setState("success");
      toast.success(t("claimed"), t("claimedText", { amount: formatMoney(claimed) }), { silent: true });
      window.setTimeout(() => setState("idle"), 1200);
    } catch (error) {
      setState("idle");
      toast.error(t("claimFailed"), errorText(error));
    }
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
            {t("subtitle", { rate: formatMoney(vault?.rateCentsPerHour ?? RATE, { whole: true }) })}
            {vault && vault.factorBps < 10_000 && ` · ${t("treasuryLow")}`}
          </p>
        </div>
      </div>
      <Progress value={amount / CAP_CENTS} label={t("progress")} tone={full ? "warn" : "gold"} className="mt-4" />
      <div className="mt-2 flex justify-between text-sm">
        <span className={full ? "text-warn" : "text-fg-3"}>{full ? t("fullHint") : t("fillsIn")}</span>
        {!full && <span className="nums text-fg-2">{now === null ? "--:--" : formatCountdown(secondsToFull)}</span>}
      </div>
      <Button
        block
        className="mt-4"
        data-tour="vault-claim"
        state={state}
        disabled={amount < 100}
        onClick={() => void onClaim()}
      >
        {amount < 100 ? t("empty") : t("claim")}
      </Button>
    </Card>
  );
}
