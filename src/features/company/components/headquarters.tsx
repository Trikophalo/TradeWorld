"use client";

import { motion, useAnimationControls } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { COIN, COMPANY_BUILDINGS, SECTOR_ICONS, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Countdown } from "@/components/ui/countdown";
import { LiveMoney, ShortMoney } from "@/components/ui/live-money";
import { BALANCE } from "@/config/balance";
import { demoCloseQuarter } from "@/features/game/demo-engine";
import type { CompanyQuarter, MyCompany } from "@/features/game/types";
import { logoArt } from "@/lib/sim/logo";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE } from "@/lib/motion";
import { isDemoMode } from "@/lib/supabase/env";
import { playSound } from "@/lib/sound";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useCompanyRefresh } from "../hooks";
import { useProductText } from "../product-name";

const QUARTER_MS = BALANCE.time.quarterHours * 3_600_000;
const day = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });

/** Profit after the player wages, which are paid continuously during the quarter. */
export const netProfit = (q: CompanyQuarter) => q.operatingProfitCents - q.wagesCents - (q.bonusCents ?? 0);

/**
 * The company's headquarters (ADR-071): the building grows with the tier, the sign carries the logo,
 * the key figures sit below like brass plates, and a time clock runs towards the quarter close.
 */
export function HeadquartersHero({
  company,
  onDrawLogo,
  onEditBanner,
}: {
  company: MyCompany;
  onDrawLogo: () => void;
  onEditBanner: () => void;
}) {
  const t = useTranslations("firm");
  const ts = useTranslations("sectors");
  const tl = useTranslations("logo");
  const product = useProductText();
  const building = useAnimationControls();
  const q = company.lastQuarter;
  const live = company.live;
  // The logo is drawn once (ADR-076); only one hidden after reports may be drawn again.
  const logoLocked = company.logo !== null && !company.logoHidden;
  const profit = q ? netProfit(q) : null;

  return (
    <section
      data-testid="company-header"
      aria-label={company.name}
      className="relative overflow-hidden rounded-xl border border-line-1 bg-surface-1 shadow-2"
    >
      <Banner company={company} onEdit={onEditBanner} />

      <div className="relative flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end sm:gap-6 lg:px-7">
        {/* The big logo, set onto the banner like a seal */}
        <button
          type="button"
          onClick={logoLocked ? undefined : onDrawLogo}
          disabled={logoLocked}
          aria-label={logoLocked ? tl("locked") : tl("draw")}
          title={logoLocked ? tl("locked") : undefined}
          data-testid="logo-button"
          className={cn(
            "group relative -mt-14 w-fit shrink-0 rounded-lg bg-surface-1 p-2 shadow-2 ring-1 ring-line-2 focus-ring sm:-mt-16",
            !logoLocked && "transition-transform duration-fast hover:-translate-y-0.5 active:scale-95",
          )}
        >
          {company.logo ? (
            <>
              <PixelIcon {...logoArt(company.logo)} scale={6} className="hidden sm:block" />
              <PixelIcon {...logoArt(company.logo)} scale={5} className="sm:hidden" />
            </>
          ) : (
            <span
              aria-hidden
              style={{ backgroundColor: company.color }}
              className="grid size-20 place-items-center font-pixel text-xl text-on-accent sm:size-24"
            >
              {company.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          {!logoLocked && (
            <span className="absolute -right-2 -bottom-2 rounded-xs bg-surface-3 px-1.5 py-0.5 label-pixel text-fg-2 ring-1 ring-line-2">
              ✎
            </span>
          )}
        </button>

        {/* Name plate */}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{t(`tiers.${company.tier}`)}</Badge>
            <span className="inline-flex items-center gap-1.5 text-sm text-fg-2">
              <PixelIcon {...SECTOR_ICONS[company.sector]} scale={1} /> {ts(company.sector)}
            </span>
            <span className="text-sm text-fg-3">· {product.name(company.productKey)}</span>
          </div>
          <h2 className="font-pixel text-2xl leading-tight text-balance text-fg-1 lg:text-3xl">{company.name}</h2>
          <p className="text-pretty text-fg-2 italic">„{company.idea}“</p>
          <p className="text-xs text-fg-3">
            {t("foundedOn", { date: day.format(new Date(company.foundedAt)) })} ·{" "}
            {t("teamSize", { count: company.employees + company.aiWorkers + 1 })}
          </p>
        </div>

        {/* The building grows with the tier */}
        <motion.button
          type="button"
          aria-label={t("buildingLabel", { tier: t(`tiers.${company.tier}`) })}
          animate={building}
          whileTap={{ scale: 0.96 }}
          onClick={() => {
            haptic("tap");
            void playSound("coin", 0.4);
            void building.start({ y: [0, -6, 0], transition: { duration: DURATION.slow, ease: EASE.out } });
          }}
          className="hidden shrink-0 flex-col items-center gap-1 rounded-md focus-ring sm:flex"
        >
          <PixelIcon {...COMPANY_BUILDINGS[company.tier]} scale={4} />
          <span aria-hidden className="h-1 w-14 rounded-pill bg-line-2" />
        </motion.button>
      </div>

      {/* Brass plates: the key figures */}
      <dl className="grid grid-cols-2 gap-px border-t border-line-1 bg-line-1 lg:grid-cols-4">
        <Plate icon={<PixelIcon {...COIN} scale={2} />} label={t("cash")}>
          {live ? (
            <LiveMoney cents={company.cashCents} perHourCents={live.profitPerHourCents} asOf={live.lastHourAt} />
          ) : (
            <ShortMoney cents={company.cashCents} />
          )}
        </Plate>
        <Plate icon={<PixelIcon {...UI_ICONS.markets} scale={2} />} label={t("value")}>
          <ShortMoney cents={company.valueCents} />
        </Plate>
        {live ? (
          <>
            <Plate icon={<PixelIcon {...UI_ICONS.portfolio} scale={2} />} label={t("revenueToday")} live>
              <LiveMoney
                cents={live.todayRevenueCents}
                perHourCents={live.revenuePerHourCents}
                asOf={live.lastHourAt}
              />
            </Plate>
            <Plate
              icon={<PixelIcon {...UI_ICONS.star} scale={2} />}
              label={t("profitToday")}
              tone={live.profitPerHourCents >= 0 ? "gain" : "loss"}
              live
            >
              <LiveMoney cents={live.todayProfitCents} perHourCents={live.profitPerHourCents} asOf={live.lastHourAt} />
            </Plate>
          </>
        ) : (
          <>
            <Plate icon={<PixelIcon {...UI_ICONS.portfolio} scale={2} />} label={t("revenue")}>
              {q ? <ShortMoney cents={q.revenueCents} /> : "–"}
            </Plate>
            <Plate
              icon={<PixelIcon {...UI_ICONS.star} scale={2} />}
              label={t("profit")}
              tone={profit === null ? undefined : profit >= 0 ? "gain" : "loss"}
            >
              {profit === null ? "–" : <ShortMoney cents={profit} />}
            </Plate>
          </>
        )}
      </dl>

      {live && (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-1 px-5 py-2.5 text-sm lg:px-7"
          data-testid="live-strip"
        >
          <span className="inline-flex items-center gap-1.5 label-pixel text-gain">
            <span className="size-2 rounded-pill bg-gain motion-safe:animate-pulse" aria-hidden /> {t("live")}
          </span>
          <span className="text-fg-2">
            {t("perHourRevenue")} <ShortMoney cents={live.revenuePerHourCents} className="font-semibold text-fg-1" />
          </span>
          <span className="text-fg-2">
            {t("perHourProfit")}{" "}
            <ShortMoney
              cents={live.profitPerHourCents}
              className={cn("font-semibold", live.profitPerHourCents >= 0 ? "text-gain" : "text-loss")}
            />
          </span>
          <span className={cn("text-fg-3", live.payFactorBps < 10_000 && "text-warn")}>
            {t("payFactorLive", { percent: Math.round(live.payFactorBps / 100) })}
          </span>
        </div>
      )}
      <QuarterClock company={company} />
    </section>
  );
}

function Plate({
  icon,
  label,
  tone,
  live,
  children,
}: {
  icon: ReactNode;
  label: string;
  tone?: "gain" | "loss";
  /** Runs live between two operating hours (ADR-072). */
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 bg-surface-1 px-4 py-3.5 lg:px-6">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2 text-fg-2 ring-1 ring-line-1">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="flex items-center gap-1.5 label-pixel text-fg-3">
          {label}
          {live && <span className="size-1.5 rounded-pill bg-gain motion-safe:animate-pulse" aria-hidden />}
        </dt>
        <dd
          className={cn(
            "truncate text-lg font-semibold",
            tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-fg-1",
          )}
        >
          {children}
        </dd>
      </div>
    </div>
  );
}

/** Time clock towards the quarter close, with the demo shortcut. */
function QuarterClock({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const refresh = useCompanyRefresh();
  const now = useClock();
  const end = Date.parse(company.nextQuarterAt);
  const progress = now === null ? 0 : Math.min(1, Math.max(0, 1 - (end - now) / QUARTER_MS));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-1 px-5 py-3 lg:px-7">
      <PixelIcon {...UI_ICONS.flame} scale={1} className="text-warn" />
      <span className="text-sm text-fg-2">
        {t("nextQuarter")} <Countdown target={end} className="nums font-semibold text-fg-1" />
      </span>
      <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-pill bg-surface-3" aria-hidden>
        <div
          className="h-full origin-left rounded-pill bg-warn transition-transform duration-slow ease-standard"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
      {isDemoMode && (
        <button
          type="button"
          onClick={() => {
            demoCloseQuarter();
            haptic("success");
            void playSound("coin");
            void refresh();
          }}
          className="text-xs text-accent underline-offset-2 focus-ring hover:underline"
        >
          {t("demoClose")}
        </button>
      )}
    </div>
  );
}

/**
 * The banner (ADR-078), scaled by whole pixels to fill the width; the free space on the sides takes the banner's
 * first colour. Without a banner: the company colour and an invitation to draw one.
 */
function Banner({ company, onEdit }: { company: MyCompany; onEdit: () => void }) {
  const t = useTranslations("banner");
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const banner = company.banner;
  // Whole pixels only; at most 8× so the banner stays a strip, the sides take its first colour.
  const scale = banner ? Math.min(8, Math.max(1, Math.floor(width / (banner.grid[0]?.length ?? 1)))) : 1;
  return (
    <div
      ref={box}
      data-testid="company-banner"
      className="relative flex min-h-24 items-center justify-center overflow-hidden sm:min-h-32"
      style={{
        backgroundColor: banner ? banner.palette[0] : undefined,
        backgroundImage: banner
          ? undefined
          : `linear-gradient(120deg, color-mix(in oklab, ${company.color} 70%, var(--bg-1)), color-mix(in oklab, ${company.color} 25%, var(--bg-1)))`,
      }}
    >
      {banner && width > 0 && <PixelIcon {...logoArt(banner)} scale={scale} />}
      <button
        type="button"
        onClick={() => {
          haptic("tap");
          onEdit();
        }}
        data-testid="banner-edit"
        className="absolute top-3 right-3 rounded-sm bg-bg/70 px-2.5 py-1.5 text-xs text-fg-1 shadow-1 focus-ring backdrop-blur transition duration-fast hover:bg-bg/90 active:scale-95"
      >
        ✎ {banner ? t("edit") : t("create")}
      </button>
    </div>
  );
}
