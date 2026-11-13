"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { MEGAPHONE } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { HoldButton } from "@/components/ui/hold-button";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { CampaignKind, MyCompany } from "@/features/game/types";
import { formatBps, formatCountdown, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING, STAGGER } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { campaignCostCents, campaignFactor, campaignGainPerHourCents } from "@/lib/sim/campaigns";
import { priceEffect } from "@/lib/sim/startup";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useCompanyRefresh } from "../hooks";
import { bottleneck, profitRoutes, type ProfitRoute, type RouteState } from "../routes";

const STATE_TONE: Record<RouteState, "accent" | "gain" | "neutral" | "info"> = {
  active: "gain",
  possible: "accent",
  locked: "neutral",
  fits: "info",
};

const DEAL_ROUTES = new Set(["supplyBuy", "supplySell", "stake"]);
const money = (cents: number) => formatMoney(cents, { whole: true });

/**
 * Profit routes (ADR-096): the bottleneck in one sentence, then every lever with its state and an estimate from the
 * last hour. The best chances come first.
 */
export function ProfitRoutes({ company }: { company: MyCompany }) {
  const t = useTranslations("routes");
  const reduced = useReducedMotion();
  const level = useGame((s) => s.portfolio?.level ?? 1);
  const neck = bottleneck(company);
  const routes = profitRoutes(company, level);
  const order = (r: ProfitRoute) =>
    r.state === "possible" && (r.gainCentsPerHour ?? 0) > 0
      ? -1e12 - (r.gainCentsPerHour ?? 0)
      : r.state === "active"
        ? 0
        : 1;
  const sorted = [...routes].sort((a, b) => order(a) - order(b));

  return (
    <Card padding="lg" className="space-y-4" data-testid="profit-routes">
      <div>
        <h2 className="label-pixel text-fg-2">{t("title")}</h2>
        <p className="mt-1 text-sm text-pretty text-fg-3">{t("intro")}</p>
      </div>
      <p
        className={cn(
          "rounded-md px-3 py-2 text-sm text-pretty",
          neck.kind === "customers"
            ? "bg-warn-soft text-warn"
            : neck.kind === "staff"
              ? "bg-info-soft text-info"
              : "bg-surface-2 text-fg-2",
        )}
        data-testid="bottleneck"
        data-kind={neck.kind}
      >
        {neck.kind === "customers"
          ? t("bottleneck.customers", { free: money(neck.cents) })
          : neck.kind === "staff"
            ? t("bottleneck.staff", { missing: money(neck.cents) })
            : t(`bottleneck.${neck.kind}`)}
      </p>
      <ul className="divide-y divide-line-1">
        {sorted.map((route, i) => (
          <motion.li
            key={route.key}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING.smooth, delay: reduced ? 0 : i * STAGGER }}
            className="flex items-start justify-between gap-3 py-3"
            data-route={route.key}
            data-state={route.state}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-fg-1">{t(`items.${route.key}.name`)}</p>
                <Badge tone={STATE_TONE[route.state]}>{t(`state.${route.state}`)}</Badge>
              </div>
              <p className="mt-0.5 text-sm text-pretty text-fg-3">{t(`items.${route.key}.text`)}</p>
              <RouteHint route={route} company={company} />
            </div>
            {route.gainCentsPerHour !== null && route.state !== "active" && route.key !== "campaign" && (
              <span
                className={cn(
                  "shrink-0 rounded-xs px-1.5 py-0.5 nums text-sm font-semibold",
                  route.gainCentsPerHour >= 0 ? "bg-gain-soft text-gain" : "bg-loss-soft text-loss",
                )}
              >
                {route.gainCentsPerHour >= 0 ? "+" : "−"}
                {t("perHour", { amount: money(Math.abs(route.gainCentsPerHour)) })}
              </span>
            )}
          </motion.li>
        ))}
      </ul>
    </Card>
  );
}

function RouteHint({ route, company }: { route: ProfitRoute; company: MyCompany }) {
  const t = useTranslations("routes");
  const tc = useTranslations("campaigns.kinds");
  const g = route.gainCentsPerHour;
  let text: string | null = null;
  switch (route.key) {
    case "price":
      text =
        route.priceLevel && g !== null
          ? t("hints.priceBetter", { level: t(`levels.${route.priceLevel}`), amount: `+${money(g)}` })
          : t("hints.priceFits");
      break;
    case "contract":
      text =
        route.state === "active"
          ? t("hints.contractOn", { amount: money(g ?? 0) })
          : g !== null
            ? t("hints.contractOff", { amount: money(g) })
            : null;
      break;
    case "staff":
      text =
        g === null
          ? null
          : g >= 0
            ? t("hints.staffGain", { amount: money(g) })
            : t("hints.staffLoss", { amount: money(-g) });
      break;
    case "campaign":
      text =
        route.state === "active"
          ? null
          : route.campaign && (route.totalCents ?? 0) > 0
            ? t("hints.campaignBest", { kind: tc(`${route.campaign}.name`), amount: money(route.totalCents ?? 0) })
            : t("hints.campaignNone");
      break;
    case "supplyBuy":
      text = g !== null ? t("hints.supplyBuyGain", { amount: money(g) }) : t("hints.notNow");
      break;
    case "supplySell":
      text = g !== null ? t("hints.supplySellGain", { amount: money(g) }) : t("hints.notNow");
      break;
    case "stake":
      text = t("hints.stakeHint");
      break;
    case "expand":
      text = route.totalCents !== undefined ? t("hints.expandCost", { amount: money(route.totalCents) }) : null;
      break;
    case "ipo":
      text = company.listing ? t("hints.listed") : t("hints.ipoOpen", { level: BALANCE.startups.ipo.minLevel });
      break;
  }
  return (
    <>
      {text && <p className="mt-1 nums text-xs text-fg-2">{text}</p>}
      {DEAL_ROUTES.has(route.key) && (
        <Link href="/deals?tab=new" className="mt-1 inline-block text-xs text-accent focus-ring hover:underline">
          {t("toDeals")}
        </Link>
      )}
    </>
  );
}

const KINDS: readonly CampaignKind[] = ["flyer", "online", "tv"];

/**
 * Marketing campaign (ADR-097): three sizes with price, duration, effect and the expected profit at the last hour's
 * numbers. A running campaign shows its resonance and how long it still runs.
 */
export function CampaignCard({ company }: { company: MyCompany }) {
  const t = useTranslations("campaigns");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const now = useClock();
  const [busy, setBusy] = useState(false);
  const cfg = BALANCE.startups;
  const live = company.live;
  const quality = company.qualityBps / 10_000;
  const price = priceEffect(company.priceLevel, quality).price;
  const running =
    company.campaign && now !== null && Date.parse(company.campaign.endsAt) > now ? company.campaign : null;
  const free = company.cashCents - company.unpaidCents;

  const start = async (kind: CampaignKind) => {
    setBusy(true);
    try {
      const c = await engine.startCampaign(crypto.randomUUID(), company.id, kind);
      void playSound("success");
      haptic("success");
      toast.success(t("started"), t(`resonance.${c.resonance}`));
      await refresh();
    } catch (error) {
      toast.error(t("title"), errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="lg" className="space-y-4" id="campaign" data-testid="campaign">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-12 shrink-0 place-items-center rounded-xs border-2 border-line-2 bg-surface-2"
        >
          <PixelIcon {...MEGAPHONE} scale={3} />
        </span>
        <div>
          <h2 className="label-pixel text-fg-2">{t("title")}</h2>
          <p className="mt-1 text-sm text-pretty text-fg-3">{t("intro")}</p>
        </div>
      </div>

      {running ? (
        <div
          className="space-y-1 rounded-md bg-accent-soft px-3 py-3"
          data-testid="campaign-running"
          data-resonance={running.resonance}
        >
          <p className="text-sm font-medium text-accent">{t("running", { kind: t(`kinds.${running.kind}.name`) })}</p>
          <p className="text-sm text-fg-1">{t(`resonance.${running.resonance}`)}</p>
          <p className="nums text-xs text-fg-2">
            {t("runningEffect", {
              percent: formatBps(Math.round(running.demandBps / 100) * 100).replace("+", ""),
              time: now === null ? "" : formatCountdown(Math.max(0, (Date.parse(running.endsAt) - now) / 1000)),
            })}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {KINDS.map((kind) => {
            const spec = cfg.campaigns.kinds[kind];
            const cost = company.campaignCosts?.[kind] ?? campaignCostCents(kind, live?.demandPerHourCents ?? 0);
            const perHour = live
              ? campaignGainPerHourCents(kind, {
                  demandCents: live.demandPerHourCents,
                  capacityCents: live.capacityPerHourCents,
                  quality,
                  price,
                  grossMargin: cfg.grossMargin[company.sector],
                })
              : 0;
            const total = perHour * spec.hours - cost;
            const soldOut = live !== null && live.demandPerHourCents >= live.capacityPerHourCents;
            // Whole percent: the effect is an estimate with average luck.
            const effect = Math.round((campaignFactor(kind, quality, 1) - 1) * 100) * 100;
            return (
              <li key={kind} className="rounded-md border border-line-1 p-3" data-campaign={kind}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-fg-1">{t(`kinds.${kind}.name`)}</p>
                  <p className="nums text-xs text-fg-3">
                    {t("effect", { percent: formatBps(effect).replace("+", ""), hours: spec.hours })}
                  </p>
                </div>
                <p className="text-sm text-fg-3">{t(`kinds.${kind}.text`)}</p>
                {live && (
                  <p
                    className={cn("mt-1 nums text-xs", soldOut ? "text-warn" : total >= 0 ? "text-gain" : "text-loss")}
                  >
                    {soldOut
                      ? t("soldOut")
                      : total >= 0
                        ? t("gain", { amount: money(Math.round(total)) })
                        : t("loss", { amount: money(Math.round(-total)) })}
                  </p>
                )}
                <HoldButton
                  tone="accent"
                  className="mt-2 w-full"
                  disabled={busy || free < cost}
                  onConfirm={() => void start(kind)}
                >
                  <span data-testid={`campaign-start-${kind}`}>{t("start", { price: money(cost) })}</span>
                </HoldButton>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-pretty text-fg-3">{t("luckHint")}</p>
    </Card>
  );
}
