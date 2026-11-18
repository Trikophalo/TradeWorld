"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { LiveMoney, ShortMoney } from "@/components/ui/live-money";
import { Skeleton } from "@/components/ui/skeleton";
import { BALANCE } from "@/config/balance";
import type { ListedCompany } from "@/features/game/listed-types";
import { useServerClock } from "@/features/game/server-clock";
import { engine } from "@/features/game/store";
import type { MyCompany } from "@/features/game/types";
import { Reveal } from "@/features/progression/components/reveal";
import type { CompanyHealth, HealthFactorKey } from "@/lib/sim/company-health";
import { formatBps, formatMoney, formatPrice } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { useCompanyEvent } from "../../hooks";
import { HoursChart, ZoneGauge, ZoneHistoryChart } from "../../listed/charts";
import { money, Panel, ServerCountdown, signed, Stat } from "../../listed/shared";
import { hourlyCloseOverdue } from "../../routes";
import type { CompanyTarget } from "../../tabs";
import { useCompanyAutopilot } from "../autopilot-card";
import { COMPANY_MOVES_KEY, moveText } from "../company-moves";
import { COMPANY_SKILLS_KEY } from "../company-skills";
import { COMPANY_TALENTS_KEY } from "../talents";
import { HourCostsSheet, useHourCosts, type CostKind } from "../hour-costs";
import { countryOf, useWorld } from "../../world/hooks";
import { HistoryCard, QuarterReceipt } from "../company-parts";
import { ChartLink, DashLink, FirmSection, SectionNav, useWhere, type NavItem } from "../firm-layout";
import { HealthPanel, type AskMira } from "../health-panel";
import { StockConfidenceCard } from "@/features/market/components/confidence";
import { StockTierCard } from "@/features/market/components/stock-tier";
import { PulseCard } from "../pulse-card";
import { reputationOf, ReputationCard } from "../reputation-card";
import { CloseErrorNote } from "../strengths-card";

type Go = (target: CompanyTarget) => void;

/** Where each factor of "Wo es fehlt" is influenced (ADR-187). */
const FACTOR_TARGET: Record<HealthFactorKey, CompanyTarget> = {
  awareness: { tab: "controlling", section: "marketing" },
  capacity: { tab: "controlling", section: "business" },
  quality: { tab: "controlling", section: "expansion" },
  image: { tab: "staff", section: "situation" },
  price: { tab: "controlling", section: "profit" },
  team: { tab: "staff", section: "staff-team" },
  cash: { tab: "controlling", section: "money" },
  momentum: { tab: "staff", section: "staff-tasks" },
};

/**
 * The first tab of the own company: numbers and charts only (ADR-187). Every number and every chart leads to where
 * it is influenced ("Beeinflussen in Controlling → Marketing"); the levers, Mira, the autopilot and the to-do list live
 * on the other tabs. Three sections with a jump bar: the numbers (with what runs against a clock and what is due),
 * the charts, and strengths and weaknesses in one view.
 */
export function DashboardTab({
  company,
  listed,
  listedPending,
  health,
  onAsk,
  todoCount,
  urgentCount,
  go,
}: {
  company: MyCompany;
  listed: ListedCompany | null;
  /** The company is listed, its listed state is still loading. */
  listedPending: boolean;
  health: CompanyHealth;
  onAsk: AskMira;
  /** Open items of the to-do center (Mitarbeiter tab) and how many of them are urgent. */
  todoCount: number;
  urgentCount: number;
  go: Go;
}) {
  const th = useTranslations("hq.dash");
  const tn = useTranslations("hq.dashNew");
  const where = useWhere();
  const late = hourlyCloseOverdue(company, useServerClock());
  const autopilot = useCompanyAutopilot();
  const nav: NavItem[] = [
    { id: "numbers", label: tn("numbers.nav"), icon: UI_ICONS.portfolio },
    { id: "charts", label: tn("charts.nav"), icon: UI_ICONS.markets },
    { id: "diagnosis", label: tn("diagnosis.nav"), icon: UI_ICONS.star },
  ];
  const link = (target: CompanyTarget) => ({ hint: where(target), onGo: () => go(target) });
  const showMood = Boolean(listed || listedPending);
  return (
    <div className="space-y-6" data-testid="company-dashboard">
      <CloseErrorNote company={company} />
      <CloseWarningsNote company={company} />
      <SectionNav items={nav} label={th("navLabel")} testId="dashboard-nav" />

      <FirmSection id="numbers" icon={UI_ICONS.portfolio} title={tn("numbers.title")} description={tn("numbers.text")}>
        <KpiGrid
          company={company}
          listed={listed}
          listedPending={listedPending}
          todoCount={todoCount}
          urgentCount={urgentCount}
          go={go}
        />
        <TimerChips company={company} listed={listed} go={go} />
      </FirmSection>

      <FirmSection
        id="charts"
        icon={UI_ICONS.markets}
        title={tn("charts.title")}
        description={tn("charts.text")}
        columns={2}
      >
        <ChartLink testId="chart-trend" {...link({ tab: "controlling", section: "profit" })}>
          <TrendCard company={company} />
        </ChartLink>
        <ChartLink testId="chart-pulse" {...link({ tab: "controlling", section: "business" })}>
          <PulseCard lastHour={autopilot.data?.lastHour} />
        </ChartLink>
        <ChartLink testId="chart-reputation" {...link({ tab: "controlling", section: "moves" })}>
          <ReputationCard company={company} listed={listed} />
        </ChartLink>
        {company.listing?.status === "listed" && company.listing.ticker && (
          <Reveal feature="stockConfidence">
            <StockConfidenceCard ticker={company.listing.ticker} variant="company" />
          </Reveal>
        )}
        {company.listing?.status === "listed" && company.listing.ticker && (
          <Reveal feature="stockTier">
            <StockTierCard ticker={company.listing.ticker} />
          </Reveal>
        )}
        {showMood && (
          <ChartLink testId="chart-mood" {...link({ tab: "staff", section: "staff-mood", target: "satisfaction" })}>
            {listed ? <MoodCard listed={listed} go={go} /> : <Skeleton className="h-64 w-full rounded-lg" />}
          </ChartLink>
        )}
        <ChartLink testId="chart-quarter" {...link({ tab: "controlling", section: "money" })}>
          <div id="quarter" className="scroll-mt-32">
            <QuarterReceipt company={company} />
          </div>
        </ChartLink>
        <ChartLink testId="chart-history" {...link({ tab: "controlling", section: "profit" })}>
          <div id="history" className="scroll-mt-32">
            <HistoryCard company={company} />
          </div>
        </ChartLink>
      </FirmSection>

      <FirmSection id="diagnosis" icon={UI_ICONS.star} title={tn("diagnosis.title")} description={tn("diagnosis.text")}>
        {/* One view for "Wo es fehlt" (now) and the strengths (long-term) since ADR-187: each topic once. */}
        <div id="health" className="scroll-mt-32">
          <HealthPanel
            health={health}
            onAsk={onAsk}
            late={late}
            strengths={company.strengths}
            goTo={{ hint: (f) => where(FACTOR_TARGET[f]), go: (f) => go(FACTOR_TARGET[f]) }}
          />
        </div>
      </FirmSection>

      {!company.listing && (
        <Reveal feature="companyListed">
          <ListedTeaser />
        </Reveal>
      )}
    </div>
  );
}

/** Extra steps of the hourly close that failed (ADR-183): the hour was recorded, this part was skipped. */
function CloseWarningsNote({ company }: { company: MyCompany }) {
  const t = useTranslations("hq.dash");
  type StepKey = Parameters<typeof t>[0];
  const w = company.closeWarnings;
  if (w.length === 0) return null;
  return (
    <div className="rounded-md bg-warn-soft px-3 py-2.5 text-sm text-pretty text-warn" data-testid="close-warnings">
      <p>
        {t("warnings", {
          steps: w
            .map((x) => (t.has(`steps.${x.step}` as StepKey) ? t(`steps.${x.step}` as StepKey) : x.step))
            .join(", "),
        })}
      </p>
      <ul className="mt-1 space-y-0.5 font-mono text-xs break-all">
        {w.map((x) => (
          <li key={x.step}>
            {x.step}: {x.error}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ numbers

const pct = (bps: number) => formatBps(bps).replace("+", "");

/** One number as a tile that leads to where it is influenced. */
function KpiTile({
  target,
  testId,
  go,
  ...stat
}: Omit<Parameters<typeof Stat>[0], "testId"> & { target: CompanyTarget; testId: string; go: Go }) {
  const where = useWhere();
  return <TileFrame link={where(target)} onGo={() => go(target)} testId={testId} {...stat} />;
}

/**
 * The frame of every number tile: label, value and hint each on one line (cut with …) and the link hint below, so all
 * tiles of the grid have the same size (ADR-208, Nachtrag).
 */
function TileFrame({
  link,
  onGo,
  testId,
  ...stat
}: Omit<Parameters<typeof Stat>[0], "testId"> & { link: string; onGo: () => void; testId: string }) {
  return (
    <DashLink hint={link} onGo={onGo} testId={`tile-${testId}`} className="h-full w-full" compact>
      <Stat
        {...stat}
        uniform
        testId={`stat-${testId}`}
        className="flex-1 transition-colors duration-fast group-hover:bg-surface-3"
      />
    </DashLink>
  );
}

/** Fixkosten and variable Kosten of the last closed hour; a tap opens where they arise (ADR-208, Nachtrag). */
function CostTile({ kind, onOpen }: { kind: CostKind; onOpen: (kind: CostKind) => void }) {
  const t = useTranslations("hq.dashNew.costs");
  const q = useHourCosts();
  const data = q.data;
  const cents = data ? (kind === "fixed" ? data.fixedCents : data.variableCents) : 0;
  const ready = data && data.hourStart !== null;
  return (
    <TileFrame
      link={t("open")}
      onGo={() => onOpen(kind)}
      testId={kind === "fixed" ? "fixed-costs" : "variable-costs"}
      label={t(kind)}
      tone="loss"
      hint={
        !data
          ? undefined
          : !ready
            ? t("none")
            : data.revenueCents > 0
              ? t("share", { percent: pct(Math.round((cents / data.revenueCents) * 10_000)) })
              : undefined
      }
    >
      {ready ? t("perHour", { amount: money(cents) }) : "–"}
    </TileFrame>
  );
}

/** Fertigkeiten (ADR-194): learned levels; they lift demand, capacity and quality and lower costs. */
function SkillsTile({ go }: { go: Go }) {
  const tc = useTranslations("companySkills");
  const q = useQuery({ queryKey: COMPANY_SKILLS_KEY, queryFn: () => engine.companySkills(), refetchInterval: 60_000 });
  const skills = q.data?.skills ?? [];
  const levels = skills.reduce((a, s) => a + s.level, 0);
  const max = skills.reduce((a, s) => a + s.maxLevel, 0);
  return (
    <KpiTile
      go={go}
      label={tc("title")}
      testId="skills"
      target={{ tab: "controlling", section: "skills" }}
      hint={tc("dashLink")}
    >
      {q.data ? tc("summary", { levels, max }) : "–"}
    </KpiTile>
  );
}

/** Stellen & Talente (ADR-199): filled seats, and how many talents are unhappy. */
function TalentsTile({ go }: { go: Go }) {
  const tl = useTranslations("talents");
  const q = useQuery({
    queryKey: COMPANY_TALENTS_KEY,
    queryFn: () => engine.companyTalents(),
    refetchInterval: 60_000,
  });
  const seats = q.data?.seats ?? [];
  const filled = seats.filter((s) => s.talent).length;
  const warn = seats.filter((s) => s.talent?.warned).length;
  return (
    <KpiTile
      go={go}
      label={tl("tile.label")}
      testId="talents"
      target={{ tab: "staff", section: "talents" }}
      hint={warn > 0 ? tl("tile.hint", { warn }) : tl("views.market")}
    >
      {q.data ? tl("tile.value", { filled, total: seats.length }) : "–"}
    </KpiTile>
  );
}

/** Standort (ADR-208): country and headquarters, or the way to the world map. */
function LocationTile({ go, worthCents }: { go: Go; worthCents: number }) {
  const tw = useTranslations("world");
  const q = useWorld();
  const me = q.data?.me ?? null;
  const country = countryOf(me?.country);
  const unlock = BALANCE.world.unlockWorthCents;
  return (
    <KpiTile go={go} label={tw("dash.label")} testId="location" target={{ tab: "location" }} hint={tw("dash.hint")}>
      {!q.data
        ? "–"
        : me && country
          ? tw("dash.placed", {
              country: country.name,
              tier: tw(`tiers.${BALANCE.world.hqTiers[me.hqTier - 1]?.key ?? "office"}`),
            })
          : worthCents >= unlock
            ? tw("dash.ready")
            : tw("dash.locked", { pct: Math.floor((Math.max(0, worthCents) / unlock) * 100) })}
    </KpiTile>
  );
}

/** The key numbers as tiles; each one leads to where it is influenced. */
function KpiGrid({
  company,
  listed,
  listedPending,
  todoCount,
  urgentCount,
  go,
}: {
  company: MyCompany;
  listed: ListedCompany | null;
  listedPending: boolean;
  todoCount: number;
  urgentCount: number;
  go: Go;
}) {
  const t = useTranslations("hq.dashboard");
  const tn = useTranslations("hq.dashNew");
  const live = company.live;
  const hours = company.hours.slice(-24);
  const last = hours[hours.length - 1];
  const prev = hours[hours.length - 2];
  const costs = (h: { revenueCents: number; profitCents: number }) => Math.max(0, h.revenueCents - h.profitCents);
  const delta = (now: number, before: number | undefined) =>
    before === undefined ? undefined : t("vsPrevious", { amount: signed(now - before) });
  const listing = company.listing?.status === "listed" ? company.listing : null;
  const reputation = reputationOf(company, listed);
  const [costSheet, setCostSheet] = useState<CostKind | null>(null);
  return (
    <>
      <HourCostsSheet kind={costSheet} onClose={() => setCostSheet(null)} />
      <div
        // every tile the same size: equal rows, each tile fills its cell (ADR-208, Nachtrag)
        className="grid auto-rows-fr grid-cols-2 gap-x-2 gap-y-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
        data-testid="dashboard-numbers"
      >
        <KpiTile
          go={go}
          label={t("cash")}
          testId="cash"
          target={{ tab: "controlling", section: "money" }}
          hint={
            listed
              ? listed.reservedCents > 0
                ? t("cashFree", { free: money(listed.freeCashCents), reserved: money(listed.reservedCents) })
                : t("cashAllFree")
              : company.unpaidCents > 0
                ? t("unpaid", { amount: money(company.unpaidCents) })
                : undefined
          }
        >
          {live ? (
            <LiveMoney cents={company.cashCents} perHourCents={live.profitPerHourCents} asOf={live.lastHourAt} />
          ) : (
            <ShortMoney cents={company.cashCents} />
          )}
        </KpiTile>
        <KpiTile
          go={go}
          label={t("revenueHour")}
          testId="revenue"
          tone="gain"
          target={{ tab: "controlling", section: "profit" }}
          hint={last && delta(last.revenueCents, prev?.revenueCents)}
        >
          {last ? <ShortMoney cents={last.revenueCents} /> : "–"}
        </KpiTile>
        <KpiTile
          go={go}
          label={t("costsHour")}
          testId="costs"
          tone="loss"
          target={{ tab: "controlling", section: "business" }}
          hint={last && delta(costs(last), prev ? costs(prev) : undefined)}
        >
          {last ? <ShortMoney cents={costs(last)} /> : "–"}
        </KpiTile>
        <CostTile kind="fixed" onOpen={setCostSheet} />
        <CostTile kind="variable" onOpen={setCostSheet} />
        <KpiTile
          go={go}
          label={t("profitHour")}
          testId="profit"
          target={{ tab: "controlling", section: "profit" }}
          tone={last ? (last.profitCents >= 0 ? "gain" : "loss") : undefined}
          hint={last && delta(last.profitCents, prev?.profitCents)}
        >
          {last ? <ShortMoney cents={last.profitCents} /> : "–"}
        </KpiTile>
        <KpiTile
          go={go}
          label={tn("awareness")}
          testId="awareness"
          target={{ tab: "controlling", section: "marketing" }}
          hint={tn("marketingHint", { amount: money(company.marketingCentsPerQuarter) })}
        >
          {pct(company.awarenessBps)}
        </KpiTile>
        <KpiTile
          go={go}
          label={tn("quality")}
          testId="quality"
          target={{ tab: "controlling", section: "expansion" }}
          tone={company.qualityBps >= 5_000 ? "gain" : undefined}
        >
          {pct(company.qualityBps)}
        </KpiTile>
        <Reveal feature="companySkills" className="min-w-0">
          <SkillsTile go={go} />
        </Reveal>
        <Reveal feature="companyTalents" className="min-w-0">
          <TalentsTile go={go} />
        </Reveal>
        <Reveal feature="companyWorld" className="min-w-0">
          <LocationTile go={go} worthCents={company.worth?.cents ?? 0} />
        </Reveal>
        {reputation && (
          <KpiTile
            go={go}
            label={t("reputation")}
            testId="reputation"
            target={{ tab: "controlling", section: "moves" }}
            tone={reputation.value >= 50 ? "gain" : reputation.value < 35 ? "loss" : "warn"}
            hint={t("reputationDemand", { percent: formatBps(Math.round((reputation.demandFactor - 1) * 10_000)) })}
          >
            {Math.round(reputation.value)}
            <span className="text-sm font-normal text-fg-3"> / 100</span>
          </KpiTile>
        )}
        {listed && (
          <KpiTile
            go={go}
            label={t("satisfaction")}
            testId="satisfaction"
            target={{ tab: "staff", section: "staff-mood", target: "satisfaction" }}
            tone={listed.satisfaction.zone === "green" ? "gain" : listed.satisfaction.zone === "red" ? "loss" : "warn"}
          >
            {Math.round(listed.satisfaction.value)}
            <span className="text-sm font-normal text-fg-3"> / 100</span>
          </KpiTile>
        )}
        {listing && (
          <KpiTile
            go={go}
            label={t("sharePrice")}
            testId="share"
            target={{ tab: "controlling", section: "capital" }}
            hint={listing.ticker ?? undefined}
          >
            {listing.lastPriceE4 !== null ? formatPrice(listing.lastPriceE4) : "–"}
          </KpiTile>
        )}
        {listing && listedPending && <Skeleton className="h-full min-h-[68px] rounded-md" />}
        {listed && (
          <>
            <KpiTile
              go={go}
              label={t("upkeep")}
              testId="upkeep"
              target={{ tab: "controlling", section: "growth" }}
              hint={t("upkeepRef", { amount: money(listed.refRevenueCents) })}
            >
              {t("perHour", { amount: money(listed.upkeepPerHourCents) })}
            </KpiTile>
            <KpiTile
              go={go}
              label={t("taxDue")}
              testId="tax"
              target={{ tab: "books", target: "taxes" }}
              tone={listed.taxes.dueCents > 0 ? "warn" : undefined}
              hint={t("taxRate", { percent: pct(listed.taxes.rateBps) })}
            >
              {money(listed.taxes.dueCents)}
            </KpiTile>
          </>
        )}
        <KpiTile
          go={go}
          label={tn("todo")}
          testId="todo"
          target={{ tab: "staff", section: "todo" }}
          tone={urgentCount > 0 ? "loss" : todoCount > 0 ? "warn" : "gain"}
          hint={urgentCount > 0 ? tn("urgent", { count: urgentCount }) : undefined}
        >
          {todoCount}
        </KpiTile>
      </div>
    </>
  );
}

/** Revenue and profit of the last 24 hours as a chart, today in one line. */
function TrendCard({ company }: { company: MyCompany }) {
  const t = useTranslations("hq.dashboard");
  const hours = company.hours.slice(-24);
  const live = company.live;
  return (
    <Panel title={t("trendTitle", { count: hours.length })} info={t("info.profit")} testId="dashboard-trend">
      <HoursChart hours={hours} />
      {live && (
        <p className="nums text-xs text-fg-3" data-testid="dashboard-today">
          {t("today", {
            revenue: formatMoney(live.todayRevenueCents, { whole: true }),
            profit: formatMoney(live.todayProfitCents, { whole: true }),
          })}
        </p>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ timers

/**
 * Everything that runs against a clock as small status chips: campaign, business moves, the current event, research
 * and building. Each chip leads to its place.
 */
function TimerChips({ company, listed, go }: { company: MyCompany; listed: ListedCompany | null; go: Go }) {
  const t = useTranslations("hq.timers");
  const tc = useTranslations("campaigns");
  const tm = useTranslations("companyMoves");
  const ti = useTranslations("listed.items");
  const where = useWhere();
  const now = useServerClock();
  const moves = useQuery({
    queryKey: COMPANY_MOVES_KEY,
    queryFn: () => engine.companyMoves(),
    refetchInterval: 20_000,
  });
  const event = useCompanyEvent();
  const rows: { key: string; label: string; at: string; target: CompanyTarget }[] = [];
  const running = (at: string | null | undefined): at is string =>
    typeof at === "string" && now !== null && Date.parse(at) > now;

  const c = company.campaign;
  if (c && running(c.endsAt)) {
    rows.push({
      key: "campaign",
      label: tc("stripTitle", { kind: tc(`kinds.${c.kind}.name`) }),
      at: c.endsAt,
      target: { tab: "controlling", section: "marketing", target: "campaign" },
    });
  }
  for (const m of moves.data?.running ?? []) {
    if (!running(m.endsAt)) continue;
    rows.push({
      key: `move-${m.id}`,
      label: t("move", { name: moveText(tm, m.key, "name") }),
      at: m.endsAt,
      target: { tab: "controlling", section: "moves" },
    });
  }
  const e = event.data?.event;
  const step = e?.steps.find((s) => s.status === "running");
  if (step && running(step.endsAt)) {
    rows.push({
      key: "event-step",
      label: t("eventStep"),
      at: step.endsAt,
      target: { tab: "staff", section: "situation" },
    });
  } else if (e && e.status === "open" && running(e.deadlineAt)) {
    rows.push({
      key: "event",
      label: t("eventDeadline"),
      at: e.deadlineAt,
      target: { tab: "staff", section: "situation" },
    });
  }
  for (const item of listed?.items ?? []) {
    if (!running(item.readyAt)) continue;
    const nameKey = `${item.key}.name` as Parameters<typeof ti>[0];
    rows.push({
      key: `item-${item.key}`,
      label: t(item.kind === "research" ? "research" : "building", { name: ti.has(nameKey) ? ti(nameKey) : item.key }),
      at: item.readyAt,
      target: { tab: "controlling", section: item.kind === "research" ? "research" : "growth" },
    });
  }
  rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="dashboard-timers" aria-label={t("title")}>
      <span className="mr-1 label-pixel text-fg-3">{t("title")}</span>
      {rows.length === 0 ? (
        <span className="text-xs text-fg-3" data-testid="timers-none">
          {t("noneShort")}
        </span>
      ) : (
        rows.map((row) => (
          <button
            key={row.key}
            type="button"
            title={where(row.target)}
            onClick={() => {
              haptic("tap");
              go(row.target);
            }}
            data-testid={`timer-${row.key}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded-pill border border-line-1 bg-surface-2 px-2.5 py-1 text-xs focus-ring transition duration-fast hover:border-accent hover:bg-surface-3 active:scale-95"
          >
            <span className="min-w-0 truncate text-fg-1">{row.label}</span>
            <ServerCountdown at={row.at} className="shrink-0 font-semibold text-accent" />
          </button>
        ))
      )}
    </div>
  );
}

/** Listed companies: the team's mood as a gauge, the reputation next to it, both over the last 72 hours. */
function MoodCard({ listed, go }: { listed: ListedCompany; go: Go }) {
  const t = useTranslations("hq.dashboard");
  const tz = useTranslations("listed.zones");
  const s = listed.satisfaction;
  const r = listed.reputation;
  const rules = BALANCE.listed.reputation;
  return (
    <Panel
      title={t("moodTitle")}
      id="mood"
      testId="dashboard-mood"
      aside={
        <button
          type="button"
          onClick={() => go({ tab: "staff", target: "satisfaction" })}
          className="rounded-sm px-1.5 py-1 text-xs font-medium text-accent focus-ring transition duration-fast hover:bg-surface-2 active:scale-[0.97]"
        >
          {t("moodMore")}
        </button>
      }
    >
      <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,190px)_minmax(0,1fr)]">
        <ZoneGauge
          value={s.value}
          target={s.target}
          green={s.green}
          red={s.red}
          label={t("satisfaction")}
          zoneLabel={tz(s.zone)}
          size="sm"
        />
        <div className="space-y-3">
          <p className="text-sm text-pretty text-fg-2">
            {t(s.zone === "green" ? "moodGreen" : s.zone === "red" ? "moodRed" : "moodYellow", {
              green: s.green,
              capacity: formatBps(Math.round((s.capacityFactor - 1) * 10_000)),
            })}
          </p>
          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-fg-2">{t("reputation")}</span>
              <span className="nums text-fg-1">
                {Math.round(r.value)}
                <span className="text-fg-3">
                  {" "}
                  {r.target > r.value + 0.5 ? "↗" : r.target < r.value - 0.5 ? "↘" : "→"} {Math.round(r.target)}
                </span>
              </span>
            </div>
            <div
              className="relative h-2.5 overflow-hidden rounded-pill bg-surface-3"
              role="meter"
              aria-label={t("reputation")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(r.value)}
            >
              <span
                className={cn("block h-full origin-left", r.value >= rules.base ? "bg-gain" : "bg-warn")}
                style={{ transform: `scaleX(${Math.min(1, Math.max(0, r.value / 100))})` }}
              />
              <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-fg-3" />
            </div>
            <p className="mt-1 nums text-xs text-pretty text-fg-3">
              {t("reputationEffects", {
                demand: formatBps(Math.round((r.demandFactor - 1) * 10_000)),
                price: formatBps(Math.round((r.priceFactor - 1) * 10_000)),
                // payouts far above the profit (e.g. when profit is tiny) read better as "> 100 %" than as "9.904 %"
                payout:
                  r.payoutRatioBps > 10_000
                    ? `> ${formatBps(10_000).replace("+", "")}`
                    : formatBps(r.payoutRatioBps).replace("+", ""),
              })}
            </p>
          </div>
        </div>
      </div>
      <ZoneHistoryChart
        history={listed.history}
        green={s.green}
        red={s.red}
        label={t("moodTitle")}
        series={[
          { key: "satisfaction", label: t("satisfaction"), pick: (p) => p.satisfaction, tone: "accent" },
          { key: "reputation", label: t("reputation"), pick: (p) => p.reputation, tone: "info" },
        ]}
      />
    </Panel>
  );
}

// ------------------------------------------------------------------ teaser

/** What going public brings: shown to founders of a private company once the IPO is in reach. */
export function ListedTeaser({ focus }: { focus?: "books" | "board" }) {
  const t = useTranslations("hq.teaser");
  const points = ["growth", "mood", "reputation", "books", "board"] as const;
  return (
    <Panel title={t("title")} testId="listed-teaser" className="border-dashed">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2 text-fg-3">
          <PixelIcon {...UI_ICONS.lock} scale={2} />
        </span>
        <p className="text-sm text-pretty text-fg-2">
          {t(focus === "books" ? "introBooks" : focus === "board" ? "introBoard" : "intro", {
            level: BALANCE.startups.ipo.minLevel,
          })}
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {points.map((p) => (
          <li key={p} className={cn("rounded-md bg-surface-2 px-3 py-2.5", focus === p && "ring-1 ring-accent")}>
            <p className="text-sm font-medium text-fg-1">{t(`${p}.title`)}</p>
            <p className="text-xs text-pretty text-fg-3">{t(`${p}.text`)}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
