"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { LiveMoney, ShortMoney } from "@/components/ui/live-money";
import { Skeleton } from "@/components/ui/skeleton";
import { BALANCE } from "@/config/balance";
import type { ListedCompany } from "@/features/game/listed-types";
import { useServerClock } from "@/features/game/server-clock";
import { engine } from "@/features/game/store";
import type { CompanyAutopilot, MyCompany } from "@/features/game/types";
import { Reveal } from "@/features/progression/components/reveal";
import type { CompanyHealth } from "@/lib/sim/company-health";
import { formatBps, formatMoney, formatPrice } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { MiraChat, type MiraOpen } from "../../assistant/mira-chat";
import { useCompanyEvent } from "../../hooks";
import { HoursChart, ZoneGauge, ZoneHistoryChart } from "../../listed/charts";
import { money, Panel, ServerCountdown, signed, Stat } from "../../listed/shared";
import { companyTodos, type CompanyTodo } from "../../listed/view";
import { companyPulse } from "../../pulse";
import { hourlyCloseOverdue } from "../../routes";
import type { CompanyTarget } from "../../tabs";
import { useCompanyTasks } from "../../tasks/task-board";
import { COMPANY_MOVES_KEY, moveText } from "../company-moves";
import { HistoryCard, QuarterReceipt } from "../company-parts";
import { HealthPanel, type AskMira } from "../health-panel";
import { CloseErrorNote, StrengthsCard } from "../strengths-card";
import { FirmSection, SectionNav, type NavItem } from "../firm-layout";
import { ReputationCard } from "../reputation-card";
import { OfficeScene } from "../office-scene";
import { StaffValueCard } from "../staff-value-card";
import { InterviewCard } from "../interview-card";
import { PitchCard } from "../pitch-card";
import { CompanyNewsCard, SituationCard } from "../situation";
import { AutopilotCard, useCompanyAutopilot } from "../autopilot-card";
import { PulseCard } from "../pulse-card";

type Go = (target: CompanyTarget) => void;

/**
 * The first tab of the own company (ADR-167; flat since ADR-183): what is due, then six sections without folding,
 * each with a header that says what it is for and a sticky jump bar: numbers, helpers (autopilot and Mira),
 * diagnosis (strengths and "Wo es fehlt"), reputation and mood, the team's value and the office, the situation.
 */
export function DashboardTab({
  company,
  listed,
  listedPending,
  health,
  miraHealth,
  onAsk,
  onMira,
  go,
}: {
  company: MyCompany;
  listed: ListedCompany | null;
  /** The company is listed, its listed state is still loading. */
  listedPending: boolean;
  health: CompanyHealth;
  miraHealth: Parameters<typeof MiraChat>[0]["health"];
  onAsk: AskMira;
  onMira: MiraOpen;
  go: Go;
}) {
  const th = useTranslations("hq.dash");
  const late = hourlyCloseOverdue(company, useServerClock());
  const autopilot = useCompanyAutopilot();
  const nav: NavItem[] = [
    { id: "numbers", label: th("numbers.nav"), icon: UI_ICONS.portfolio },
    { id: "assist", label: th("assist.nav"), icon: UI_ICONS.robot },
    { id: "diagnosis", label: th("diagnosis.nav"), icon: UI_ICONS.star },
    { id: "reputation-mood", label: th("reputation.nav"), icon: UI_ICONS.heart },
    { id: "team-value", label: th("team.nav"), icon: UI_ICONS.profile },
    { id: "situation", label: th("situation.nav"), icon: UI_ICONS.news },
  ];
  return (
    <div className="space-y-6" data-testid="company-dashboard">
      <CloseErrorNote company={company} />
      <CloseWarningsNote company={company} />
      <TodoStrip company={company} listed={listed} go={go} autopilot={autopilot.data ?? null} />
      <SectionNav items={nav} label={th("navLabel")} testId="dashboard-nav" />

      <FirmSection id="numbers" icon={UI_ICONS.portfolio} title={th("numbers.title")} description={th("numbers.text")}>
        <NumbersCard company={company} listed={listed} listedPending={listedPending} />
        <PulseCard lastHour={autopilot.data?.lastHour} />
        <div className="grid items-start gap-4 *:min-w-0 lg:grid-cols-2 lg:gap-5">
          <div id="quarter" className="scroll-mt-32">
            <QuarterReceipt company={company} />
          </div>
          <div id="history" className="scroll-mt-32">
            <HistoryCard company={company} />
          </div>
        </div>
      </FirmSection>

      <FirmSection
        id="assist"
        icon={UI_ICONS.robot}
        title={th("assist.title")}
        description={th("assist.text")}
        columns={2}
      >
        <div id="autopilot" className="scroll-mt-32">
          <AutopilotCard />
        </div>
        <div id="mira" className="scroll-mt-32">
          <MiraChat applications={company.pendingApplications} health={miraHealth} onOpen={onMira} />
        </div>
      </FirmSection>

      <FirmSection id="diagnosis" icon={UI_ICONS.star} title={th("diagnosis.title")} description={th("diagnosis.text")}>
        {/* The strengths with their reward: what the company is good at, at a glance (ADR-176). */}
        <div id="strengths" className="scroll-mt-32">
          <StrengthsCard company={company} />
        </div>
        <div id="health" className="scroll-mt-32">
          <HealthPanel health={health} onAsk={onAsk} late={late} />
        </div>
      </FirmSection>

      <FirmSection
        id="reputation-mood"
        icon={UI_ICONS.heart}
        title={th("reputation.title")}
        description={th(listed || listedPending ? "reputation.textListed" : "reputation.text")}
        columns={listed || listedPending ? 2 : 1}
      >
        <ReputationCard company={company} listed={listed} />
        {listedPending && <Skeleton className="h-64 w-full rounded-lg" />}
        {listed && <MoodCard listed={listed} go={go} />}
      </FirmSection>

      <FirmSection
        id="team-value"
        icon={UI_ICONS.profile}
        title={th("team.title")}
        description={th("team.text")}
        columns={2}
      >
        <StaffValueCard company={company} id="staff-value" />
        <div className="space-y-4">
          <TimersCard company={company} listed={listed} go={go} />
          <OfficeScene company={company} onTeam={() => go({ tab: "staff" })} />
        </div>
      </FirmSection>

      <FirmSection
        id="situation"
        icon={UI_ICONS.news}
        title={th("situation.title")}
        description={th("situation.text")}
        columns={2}
      >
        <div className="space-y-4">
          <SituationCard />
          <Reveal feature="companyInterview">
            <InterviewCard />
          </Reveal>
        </div>
        <div className="space-y-4">
          <PitchCard kind="event" />
          <CompanyNewsCard />
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

// ------------------------------------------------------------------ what is due

const TONE = {
  urgent: "border-loss/50 bg-loss-soft text-loss",
  warn: "border-warn/50 bg-warn-soft text-warn",
  normal: "border-accent/40 bg-accent-soft text-accent",
} as const;

interface TodoItem {
  key: string;
  tone: keyof typeof TONE;
  label: string;
  deadline?: string;
  target: CompanyTarget;
}

/** Everything that waits for the founder, as one row of chips with direct links. */
function TodoStrip({
  company,
  listed,
  go,
  autopilot,
}: {
  company: MyCompany;
  listed: ListedCompany | null;
  go: Go;
  autopilot: CompanyAutopilot | null;
}) {
  const t = useTranslations("hq.todo");
  const now = useServerClock();
  const tasks = useCompanyTasks();
  const event = useCompanyEvent();
  const openTasks = tasks.data?.tasks.filter((x) => x.status === "open").length ?? 0;
  const items: TodoItem[] = [];

  const listedLabel = (todo: CompanyTodo): string => {
    switch (todo.key) {
      case "books":
        return t(todo.tone === "normal" ? "books" : "booksLate");
      case "tax":
        return t(todo.tone === "urgent" ? "taxLate" : "tax", { amount: money(todo.amountCents ?? 0) });
      case "board":
        return t("board", { count: todo.count ?? 0 });
      case "mood":
        return t(todo.tone === "urgent" ? "moodRed" : "moodYellow");
      case "paused":
        return t("paused", { count: todo.count ?? 0 });
      case "research":
        return t("research");
    }
  };
  const SECTION_TARGET: Record<string, CompanyTarget> = {
    books: { tab: "books", target: "books-duty" },
    taxes: { tab: "books", target: "taxes" },
    board: { tab: "board" },
    satisfaction: { tab: "staff", target: "satisfaction" },
    growth: { tab: "controlling", section: "growth" },
    research: { tab: "controlling", section: "research" },
  };
  if (listed && now !== null) {
    for (const todo of companyTodos(listed, now)) {
      items.push({
        key: todo.key,
        tone: todo.tone,
        label: listedLabel(todo),
        deadline: todo.deadline,
        target: SECTION_TARGET[todo.section] ?? { tab: "dashboard" },
      });
    }
  }
  const e = event.data?.canAct ? event.data.event : null;
  if (e && e.status === "open") {
    items.push({
      key: "event",
      tone: e.polarity === "crisis" ? "urgent" : "normal",
      label: t(e.polarity === "crisis" ? "crisis" : "chance"),
      deadline: e.deadlineAt,
      target: { tab: "dashboard", section: "situation" },
    });
  }
  if (company.distress) {
    items.push({
      key: "distress",
      tone: "urgent",
      label: t("distress", { amount: money(company.unpaidCents) }),
      target: { tab: "controlling", section: "money" },
    });
  }
  if (company.pendingApplications > 0) {
    items.push({
      key: "applications",
      tone: "normal",
      label: t("applications", { count: company.pendingApplications }),
      target: { tab: "staff", target: "applications" },
    });
  }
  if (openTasks > 0) {
    items.push({
      key: "tasks",
      tone: "normal",
      label: t("tasks", { count: openTasks }),
      target: { tab: "staff", target: "tasks" },
    });
  }
  // ADR-180: what to do next, from the last hour
  const pulse = companyPulse(autopilot?.lastHour ?? null);
  if (company.marketingCentsPerQuarter <= 0) {
    items.push({
      key: "marketing",
      tone: "warn",
      label: t("marketing"),
      target: { tab: "controlling", section: "marketing" },
    });
  }
  if (pulse.ai === "idle" || pulse.ai === "partly") {
    items.push({
      key: "aiIdle",
      tone: pulse.ai === "idle" ? "warn" : "normal",
      label: t("aiIdle", { count: pulse.idleAi }),
      target: { tab: "controlling", section: "marketing" },
    });
  }
  if (pulse.soldOut) {
    items.push({ key: "soldOut", tone: "normal", label: t("soldOut"), target: { tab: "staff" } });
  }
  if (autopilot && !autopilot.on && autopilot.canToggle) {
    items.push({
      key: "autopilot",
      tone: "normal",
      label: t("autopilot"),
      target: { tab: "dashboard", target: "autopilot" },
    });
  }
  if (company.listing?.status === "subscription") {
    items.push({
      key: "subscription",
      tone: "normal",
      label: t("subscription"),
      target: { tab: "controlling", section: "capital" },
    });
  } else if (!company.listing && company.canGoPublic) {
    items.push({ key: "ipo", tone: "normal", label: t("ipo"), target: { tab: "controlling", section: "capital" } });
  }

  return (
    <section
      id="todo"
      aria-label={t("title")}
      className="scroll-mt-24 rounded-lg border border-line-1 bg-surface-1 px-3 py-3"
      data-testid="company-todo"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-1 label-pixel text-fg-2">{t("title")}</h3>
        {items.length === 0 && (
          <p className="text-sm text-gain" data-testid="todo-none">
            {t("none")}
          </p>
        )}
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              haptic("tap");
              go(item.target);
            }}
            data-testid={`todo-${item.key}`}
            data-tone={item.tone}
            className={cn(
              "inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm font-medium focus-ring transition duration-fast hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97]",
              TONE[item.tone],
            )}
          >
            <span className="min-w-0 text-pretty">{item.label}</span>
            {item.deadline && <ServerCountdown at={item.deadline} className="shrink-0 text-xs opacity-90" />}
            <span aria-hidden className="shrink-0 font-pixel text-2xs">
              ›
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ numbers

/** Cash, the last hour and the trend of the last hours. */
function NumbersCard({
  company,
  listed,
  listedPending,
}: {
  company: MyCompany;
  listed: ListedCompany | null;
  listedPending: boolean;
}) {
  const t = useTranslations("hq.dashboard");
  const live = company.live;
  const hours = company.hours.slice(-24);
  const last = hours[hours.length - 1];
  const prev = hours[hours.length - 2];
  const costs = (h: { revenueCents: number; profitCents: number }) => Math.max(0, h.revenueCents - h.profitCents);
  const delta = (now: number, before: number | undefined) =>
    before === undefined ? undefined : t("vsPrevious", { amount: signed(now - before) });
  const listing = company.listing?.status === "listed" ? company.listing : null;
  return (
    <Panel
      title={t("numbersTitle")}
      aside={
        last ? (
          <span className="nums text-xs text-fg-3">
            {t("lastHourAt", { hour: new Date(last.hourStart).getHours() })}
          </span>
        ) : undefined
      }
      testId="dashboard-numbers"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label={t("cash")}
          info={t("info.cash")}
          testId="stat-cash"
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
        </Stat>
        <Stat
          label={t("revenueHour")}
          info={t("info.revenue")}
          testId="stat-revenue"
          hint={last && delta(last.revenueCents, prev?.revenueCents)}
        >
          {last ? <ShortMoney cents={last.revenueCents} /> : "–"}
        </Stat>
        <Stat
          label={t("costsHour")}
          info={t("info.costs")}
          testId="stat-costs"
          hint={last && delta(costs(last), prev ? costs(prev) : undefined)}
        >
          {last ? <ShortMoney cents={costs(last)} /> : "–"}
        </Stat>
        <Stat
          label={t("profitHour")}
          info={t("info.profit")}
          testId="stat-profit"
          tone={last ? (last.profitCents >= 0 ? "gain" : "loss") : undefined}
          hint={last && delta(last.profitCents, prev?.profitCents)}
        >
          {last ? <ShortMoney cents={last.profitCents} /> : "–"}
        </Stat>
        {listing && (
          <>
            <Stat
              label={t("sharePrice")}
              info={t("info.share")}
              testId="stat-share"
              hint={
                listing.ticker ? (
                  <Link href={`/markets/${listing.ticker}`} className="text-accent focus-ring hover:underline">
                    {t("toStock", { ticker: listing.ticker })}
                  </Link>
                ) : undefined
              }
            >
              {listing.lastPriceE4 !== null ? formatPrice(listing.lastPriceE4) : "–"}
            </Stat>
            {listedPending || !listed ? (
              <>
                <Skeleton className="h-[68px] rounded-md" />
                <Skeleton className="h-[68px] rounded-md" />
                <Skeleton className="h-[68px] rounded-md" />
              </>
            ) : (
              <>
                <Stat
                  label={t("reputation")}
                  testId="stat-reputation"
                  info={t("info.reputation")}
                  tone={listed.reputation.value >= 50 ? "gain" : listed.reputation.value < 35 ? "loss" : "warn"}
                  hint={t("reputationDemand", {
                    percent: formatBps(Math.round((listed.reputation.demandFactor - 1) * 10_000)),
                  })}
                >
                  {Math.round(listed.reputation.value)}
                  <span className="text-sm font-normal text-fg-3"> / 100</span>
                </Stat>
                <Stat
                  label={t("upkeep")}
                  info={t("info.upkeep")}
                  testId="stat-upkeep"
                  hint={t("upkeepRef", { amount: money(listed.refRevenueCents) })}
                >
                  {t("perHour", { amount: money(listed.upkeepPerHourCents) })}
                </Stat>
                <Stat
                  label={t("taxDue")}
                  info={t("info.tax")}
                  testId="stat-tax"
                  tone={listed.taxes.dueCents > 0 ? "warn" : undefined}
                  hint={t("taxRate", { percent: formatBps(listed.taxes.rateBps).replace("+", "") })}
                >
                  {money(listed.taxes.dueCents)}
                </Stat>
              </>
            )}
          </>
        )}
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-fg-1">{t("trendTitle", { count: hours.length })}</p>
        <HoursChart hours={hours} />
      </div>
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
                payout: formatBps(r.payoutRatioBps).replace("+", ""),
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

// ------------------------------------------------------------------ timers

/** Everything that is running against a clock: campaign, business moves, the current event, research and building. */
function TimersCard({ company, listed, go }: { company: MyCompany; listed: ListedCompany | null; go: Go }) {
  const t = useTranslations("hq.timers");
  const tc = useTranslations("campaigns");
  const tm = useTranslations("companyMoves");
  const ti = useTranslations("listed.items");
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
      target: { tab: "dashboard", section: "situation" },
    });
  } else if (e && e.status === "open" && running(e.deadlineAt)) {
    rows.push({
      key: "event",
      label: t("eventDeadline"),
      at: e.deadlineAt,
      target: { tab: "dashboard", section: "situation" },
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
    <Panel title={t("title")} testId="dashboard-timers">
      {rows.length === 0 ? (
        <p className="text-sm text-pretty text-fg-3" data-testid="timers-none">
          {t("none")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                onClick={() => {
                  haptic("tap");
                  go(row.target);
                }}
                data-testid={`timer-${row.key}`}
                className="flex w-full items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2 text-left text-sm focus-ring transition duration-fast hover:bg-surface-3 active:scale-[0.98]"
              >
                <span className="min-w-0 truncate text-fg-1">{row.label}</span>
                <ServerCountdown at={row.at} className="shrink-0 font-semibold text-accent" />
              </button>
            </li>
          ))}
        </ul>
      )}
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
