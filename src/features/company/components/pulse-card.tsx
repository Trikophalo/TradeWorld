"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { BALANCE } from "@/config/balance";
import type { CompanyAutopilot } from "@/features/game/types";
import { cn } from "@/lib/utils";
import { companyPulse } from "../pulse";

const pts = (v: number) => v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * What the last hour says, in one line per lever (ADR-180): the AI workers (busy or "zu wenig Nachfrage"), where the
 * awareness came from and whether the company is sold out.
 */
export function PulseCard({ lastHour }: { lastHour: CompanyAutopilot["lastHour"] | undefined }) {
  const t = useTranslations("hq.pulse");
  if (!lastHour) return null;
  const p = companyPulse(lastHour);
  const a = p.awareness;
  const standby = Math.round(BALANCE.startups.aiWorkerStandbyBps / 100);
  const lines: { key: string; tone: "gain" | "warn" | "loss" | "neutral"; text: string }[] = [];
  lines.push({
    key: "awareness",
    tone: a.total > 0 ? "gain" : a.total < 0 ? "loss" : "neutral",
    text: t(a.total >= 0 ? "awarenessUp" : "awarenessDown", {
      total: pts(Math.abs(a.total)),
      marketing: pts(a.marketing),
      word: pts(a.wordOfMouth),
      extra: pts(a.extra),
      decay: pts(a.decay),
    }),
  });
  if (a.atCap) lines.push({ key: "cap", tone: "warn", text: t("awarenessCap") });
  if (p.ai === "busy") lines.push({ key: "ai", tone: "gain", text: t("aiBusy", { count: lastHour.aiWorkers }) });
  if (p.ai === "partly")
    lines.push({
      key: "ai",
      tone: "warn",
      text: t("aiPartly", { idle: p.idleAi, count: lastHour.aiWorkers, standby }),
    });
  if (p.ai === "idle")
    lines.push({ key: "ai", tone: "loss", text: t("aiIdle", { count: lastHour.aiWorkers, standby }) });
  if (p.soldOut) lines.push({ key: "soldOut", tone: "warn", text: t("soldOut") });

  return (
    <Card padding="lg" className="space-y-2" data-testid="company-pulse">
      <p className="label-pixel text-fg-2">{t("title")}</p>
      <ul className="space-y-1.5">
        {lines.map((l) => (
          <li key={l.key} className="flex items-start gap-2 text-sm text-pretty" data-testid={`pulse-${l.key}`}>
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-xs",
                l.tone === "gain"
                  ? "bg-gain"
                  : l.tone === "loss"
                    ? "bg-loss"
                    : l.tone === "warn"
                      ? "bg-warn"
                      : "bg-fg-3",
              )}
            />
            <span className="text-fg-2">{l.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
