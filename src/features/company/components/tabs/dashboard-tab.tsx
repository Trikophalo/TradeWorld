"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { LiveMoney, ShortMoney } from "@/components/ui/live-money";
import { Skeleton } from "@/components/ui/skeleton";
import { BALANCE } from "@/config/balance";
import type { ListedCompany } from "@/features/game/listed-types";
import { useServerClock } from "@/features/game/server-clock";
import { engine } from "@/features/game/store";
import type { MyCompany } from "@/features/game/types";
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
import { hourlyCloseOverdue } from "../../routes";
import type { CompanyTarget } from "../../tabs";
import { useCompanyTasks } from "../../tasks/task-board";
import { COMPANY_MOVES_KEY, moveText } from "../company-moves";
import { HistoryCard, QuarterReceipt } from "../company-parts";
import { netProfit } from "../headquarters";
import { HealthPanel, type AskMira } from "../health-panel";
import { OfficeScene } from "../office-scene";
import { StaffValueCard } from "../staff-value-card";
import { InterviewCard } from "../interview-card";
import { PitchCard } from "../pitch-card";
import { CompanyNewsCard, SituationCard } from "../situation";

type Go = (target: CompanyTarget) => void;
type SectionProps = (id: string) => { id: string; open: boolean; onOpenChange: (open: boolean) => void };

/**
 * The first tab of the own company (ADR-167, UI): what is due, the important numbers and charts, the eight factors,
 * running timers, the office and Mira. Listed companies also see share price, reputation and the team's mood.
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
  section,
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
  section: SectionProps;
}) {
  const ts = useTranslations("firm.sections");
  const th = useTranslations("hq.dashboard");
  const late = hourlyCloseOverdue(company, useServerClock());
  return (
    <div className="space-y-4" data-testid="company-dashboard">
      <TodoStrip company={company} listed={listed} go={go} />
      <div className="grid items-start gap-4 *:min-w-0 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-5">
        <div className="space-y-4">
          <NumbersCard company={company} listed={listed} listedPending={listedPending} />
          {listedPending && <Skeleton className="h-64 w-full rounded-lg" />}
          {listed && <MoodCard listed={listed} go={go} />}
        </div>
        <div className="space-y-4">
          <TimersCard company={company} listed={listed} go={go} />
          <div id="mira" className="scroll-mt-24">
            <MiraChat applications={company.pendingApplications} health={miraHealth} onOpen={onMira} />
          </div>
          <OfficeScene company={company} onTeam={() => go({ tab: "staff" })} />
        </div>
      </div>
      <div id="health" className="scroll-mt-24">
        <HealthPanel health={health} onAsk={onAsk} late={late} />
      </div>
      <StaffValueCard company={company} id="staff-value" />
      <div className="grid items-start gap-4 *:min-w-0 lg:grid-cols-2 lg:gap-5">
        <div className="space-y-4">
          <CollapsibleSection
            {...section("situation")}
            title={ts("situation")}
            summary={ts("situationSummary")}
            icon={<PixelIcon {...UI_ICONS.news} scale={2} />}
          >
            <SituationCard />
            <Reveal feature="companyInterview">
              <InterviewCard />
            </Reveal>
            <PitchCard kind="event" />
            <CompanyNewsCard />
          </CollapsibleSection>
        </div>
        <div className="space-y-4">
          <CollapsibleSection
            {...section("numbers")}
            title={th("numbersSection")}
            summary={
              company.lastQuarter
                ? ts("moneySummary", { amount: money(netProfit(company.lastQuarter)) })
                : ts("moneyEmpty")
            }
            icon={<PixelIcon {...UI_ICONS.portfolio} scale={2} />}
          >
            <div id="quarter" className="scroll-mt-24">
              <QuarterReceipt company={company} />
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            {...section("history")}
            title={ts("history")}
            summary={ts("historySummary")}
            icon={<PixelIcon {...UI_ICONS.markets} scale={2} />}
          >
            <HistoryCard company={company} />
          </CollapsibleSection>
        </div>
      </div>
      {!company.listing && (
        <Reveal feature="companyListed">
          <ListedTeaser />
        </Reveal>
      )}
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
function TodoStrip({ company, listed, go }: { company: MyCompany; listed: ListedCompany | null; go: Go }) {
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
          testId="stat-revenue"
          hint={last && delta(last.revenueCents, prev?.revenueCents)}
        >
          {last ? <ShortMoney cents={last.revenueCents} /> : "–"}
        </Stat>
        <Stat
          label={t("costsHour")}
          testId="stat-costs"
          hint={last && delta(costs(last), prev ? costs(prev) : undefined)}
        >
          {last ? <ShortMoney cents={costs(last)} /> : "–"}
        </Stat>
        <Stat
          label={t("profitHour")}
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
                  testId="stat-upkeep"
                  hint={t("upkeepRef", { amount: money(listed.refRevenueCents) })}
                >
                  {t("perHour", { amount: money(listed.upkeepPerHourCents) })}
                </Stat>
                <Stat
                  label={t("taxDue")}
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
      id="reputation"
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
