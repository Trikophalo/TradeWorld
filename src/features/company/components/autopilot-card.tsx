"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { CompanyAutopilot } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { useTaskText } from "../tasks/task-text";

export const COMPANY_AUTOPILOT_KEY = ["company", "autopilot"] as const;

/** Autopilot state, today's numbers and the last hour's economy (ADR-180). */
export function useCompanyAutopilot(enabled = true) {
  return useQuery({
    queryKey: COMPANY_AUTOPILOT_KEY,
    queryFn: () => engine.companyAutopilot(),
    refetchInterval: 30_000,
    enabled,
  });
}

const pct = (bps: number) => Math.round(bps / 100);

/**
 * The autopilot (ADR-180): one switch. While on, the server does every company task without a mini-game, also at
 * night; the chance follows the team's mood (60 % up to 120 %), the reward is less than playing yourself.
 */
export function AutopilotCard({ preview }: { preview?: CompanyAutopilot } = {}) {
  const t = useTranslations("hq.autopilot");
  const text = useTaskText();
  const errorText = useGameErrorText();
  const client = useQueryClient();
  const live = useCompanyAutopilot(!preview);
  const data = preview ?? live.data;
  const [busy, setBusy] = useState(false);

  if (!data) {
    return (
      <Card padding="lg" className="space-y-3" aria-hidden>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-12 w-full rounded-md" />
      </Card>
    );
  }
  const bonus = Math.max(0, data.chanceBps - 10_000);
  const toggle = async (on: boolean) => {
    setBusy(true);
    haptic("tap");
    try {
      const next = await engine.setCompanyAutopilot(crypto.randomUUID(), on);
      client.setQueryData(COMPANY_AUTOPILOT_KEY, next);
      toast.success(on ? t("onToast") : t("offToast"));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="lg" className="space-y-3" data-testid="company-autopilot">
      <label className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block label-pixel text-fg-2">{t("title")}</span>
          <span className="mt-1 block text-sm text-pretty text-fg-3">
            {t("intro", { reward: pct(data.rewardBps) })}
          </span>
        </span>
        <Switch
          checked={data.on}
          disabled={busy || !data.canToggle}
          label={t("title")}
          onCheckedChange={(on) => void toggle(on)}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md bg-surface-2 px-3 py-2.5" data-testid="autopilot-chance">
          <p className="text-2xs text-fg-3">{t("chance")}</p>
          <p className={cn("nums text-lg font-semibold", data.chanceBps >= 10_000 ? "text-gain" : "text-fg-1")}>
            {pct(data.chanceBps)} %
          </p>
          <p className="text-2xs text-pretty text-fg-3">
            {bonus > 0 ? t("bonus", { bonus: pct(bonus) }) : t("mood", { mood: Math.round(data.mood * 100) })}
          </p>
        </div>
        <div className="rounded-md bg-surface-2 px-3 py-2.5" data-testid="autopilot-today">
          <p className="text-2xs text-fg-3">{t("today")}</p>
          <p
            className={cn(
              "nums text-lg font-semibold",
              data.today.cents > 0 ? "text-gain" : data.today.cents < 0 ? "text-loss" : "text-fg-1",
            )}
          >
            {formatMoney(data.today.cents, { whole: true, sign: data.today.cents !== 0 })}
          </p>
          <p className="text-2xs text-pretty text-fg-3">
            {t("todayCount", { done: data.today.done, success: data.today.success })}
          </p>
        </div>
      </div>
      <p className="text-xs text-pretty text-fg-3">
        {t("rules", {
          perDay: data.maxPerDay,
          penalty: pct(data.failPenaltyBps),
          pay: (data.payFactorBps / 10_000).toLocaleString("de-DE", { maximumFractionDigits: 2 }),
        })}
      </p>
      {data.log.length > 0 && (
        <ul className="space-y-1" data-testid="autopilot-log">
          {data.log.slice(0, 5).map((l, i) => (
            <li key={`${l.at}-${i}`} className="flex items-center gap-2 text-xs">
              <span aria-hidden className={l.success ? "text-gain" : "text-loss"}>
                {l.success ? "✓" : "✗"}
              </span>
              <span className="min-w-0 flex-1 truncate text-fg-2">{text.name(l.key)}</span>
              <span className={cn("nums", l.resultCents >= 0 ? "text-gain" : "text-loss")}>
                {formatMoney(l.resultCents, { whole: true, sign: true })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
