"use client";

import { motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MIRA, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerClock } from "@/features/game/server-clock";
import type { MyCompany } from "@/features/game/types";
import { useDisclosed } from "@/features/progression/components/reveal";
import { useVisitTour } from "@/features/tutorial/use-visit-tour";
import type { HealthFactorKey } from "@/lib/sim/company-health";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { askMira, MiraChat, type MiraOpen } from "../assistant/mira-chat";
import { useCompanyHealth } from "../health";
import { BoardView } from "../listed/board";
import { useListedCompany } from "../listed/shared";
import { companyTodos } from "../listed/view";
import { companyHref, resolveCompanyTarget, sectionTarget, type CompanyTab, type CompanyTarget } from "../tabs";
import { useCompanyAutopilot } from "./autopilot-card";
import { BannerEditor } from "./banner-editor";
import { useCompanyTodoItems } from "./todo-center";
import { HireSheet, type HireRequest } from "./employer";
import { HeadquartersHero } from "./headquarters";
import { SideJobNotice } from "./listing";
import { LogoEditor } from "./logo-editor";
import { CampaignStrip } from "./routes";
import { BooksTab } from "./tabs/books-tab";
import { ControllingTab } from "./tabs/controlling-tab";
import { DashboardTab, ListedTeaser } from "./tabs/dashboard-tab";
import { StaffTab } from "./tabs/staff-tab";
import { announceFocus, FirmSection } from "./firm-layout";

const money = (cents: number) => formatMoney(cents, { whole: true });

/**
 * The founder's view of the own company (ADR-057), in five tabs since ADR-167: Dashboard (numbers and charts first),
 * Controlling (every lever), Mitarbeiter (team, tasks and chat), and for listed companies Buchhaltung and
 * Geschäftsrat. The tab and the section are part of the URL (`?tab=…&section=…`); the old tabs and Mira's sections
 * are mapped in ../tabs.ts.
 */
export function CompanyDashboard({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const th = useTranslations("hq.tabs");
  const tb = useTranslations("hq.board");
  const tl = useTranslations("logo");
  const tm = useTranslations("hq.miraPanel");
  const router = useRouter();
  const params = useSearchParams();
  const rawTab = params.get("tab");
  const rawSection = params.get("section");
  const boardParam = params.get("board");
  const current = useMemo(
    () => (boardParam ? { tab: "board" as const } : resolveCompanyTarget(rawTab, rawSection)),
    [boardParam, rawTab, rawSection],
  );
  const tab = current.tab;

  const isListed = company.listing?.status === "listed";
  const listedQuery = useListedCompany(isListed);
  const listed = isListed ? (listedQuery.data ?? null) : null;
  const listedPending = isListed && listedQuery.isPending;
  const teaser = useDisclosed("companyListed");
  const now = useServerClock();

  const [miraOpen, setMiraOpen] = useState(() => current.target === "mira");

  /**
   * Scrolls to the place (nothing folds any more, ADR-183), with a short highlight. A merged card switches to the
   * right pane first (ADR-187); Mira opens her panel.
   */
  const focus = useCallback((target: CompanyTarget) => {
    if (target.target === "mira") {
      window.setTimeout(() => setMiraOpen(true), 0);
      return;
    }
    announceFocus(target);
    const id = target.target ?? (target.section ? `section-${target.section}` : null);
    if (!id) return;
    let tries = 0;
    const look = () => {
      const el = document.getElementById(id);
      if (!el) {
        if (++tries < 20) window.setTimeout(look, 100);
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.setAttribute("data-highlight", "");
      window.setTimeout(() => el.removeAttribute("data-highlight"), 1_800);
    };
    window.setTimeout(look, 80);
  }, []);

  const go = useCallback(
    (target: CompanyTarget) => {
      if (target.target === "mira") {
        setMiraOpen(true);
        return;
      }
      router.replace(companyHref(target), { scroll: false });
      if (target.section || target.target) focus(target);
    },
    [router, focus],
  );

  // A link from outside (notification, Mira on another page, the old tabs): open and scroll once per address.
  const arrived = useRef<string | null>(null);
  useEffect(() => {
    const key = `${rawTab ?? ""}|${rawSection ?? ""}`;
    if (arrived.current === key) return;
    arrived.current = key;
    if (current.section || current.target) focus(current);
  }, [rawTab, rawSection, current, focus]);

  const autopilot = useCompanyAutopilot();
  const todoItems = useCompanyTodoItems(company, listed, autopilot.data ?? null);
  const [hire, setHire] = useState<HireRequest | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  useVisitTour("visit_company");

  // Where the company loses money (ADR-162): on the dashboard; every factor goes to Mira.
  const health = useCompanyHealth(company);
  const miraHealth = useMemo(
    () => ({
      result: health,
      priceLevel: company.priceLevel,
      contractWork: company.contractWork,
      marketingCentsPerQuarter: company.marketingCentsPerQuarter,
      aiWageCentsPerHour: company.aiWageCentsPerHour,
    }),
    [health, company.priceLevel, company.contractWork, company.marketingCentsPerQuarter, company.aiWageCentsPerHour],
  );
  const questions = useTranslations("companyHealth.questions");
  const askAbout = (factor: HealthFactorKey) => {
    haptic("tap");
    askMira(questions(factor));
    setMiraOpen(true);
  };
  // Mira opens a place: her panel closes, the page goes there.
  const onMira: MiraOpen = (section) => {
    const target = sectionTarget(section);
    if (target.target !== "mira") setMiraOpen(false);
    go(target);
  };

  const todos = listed && now !== null ? companyTodos(listed, now) : [];
  const booksBadge = todos.filter((x) => x.key === "books" || x.key === "tax").length;
  const tabs: TabItem[] = [
    { value: "dashboard", label: th("dashboard"), icon: "home" },
    { value: "controlling", label: th("controlling"), icon: "markets" },
    {
      value: "staff",
      label: th("staff"),
      icon: "profile",
      badge: todoItems.filter((x) => x.target.tab === "staff").length,
    },
    ...(isListed || teaser
      ? ([
          { value: "books", label: th("books"), icon: "portfolio", badge: booksBadge, locked: !isListed },
          { value: "board", label: th("board"), icon: "deal", badge: listed?.board.toVote ?? 0, locked: !isListed },
        ] satisfies TabItem[])
      : []),
  ];

  return (
    <div className="space-y-5">
      <HeadquartersHero
        company={company}
        onDrawLogo={() => setDrawing(true)}
        onEditBanner={() => setBannerOpen(true)}
      />

      <LogoEditor company={company} open={drawing} onClose={() => setDrawing(false)} />
      <BannerEditor company={company} open={bannerOpen} onClose={() => setBannerOpen(false)} />
      {company.logoHidden && <p className="rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">{tl("hidden")}</p>}
      {company.logo === null && (
        <Card
          padding="md"
          className="flex flex-wrap items-center gap-4 border-accent/40 bg-accent-soft"
          data-testid="logo-prompt"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-fg-1">{tl("promptTitle")}</p>
            <p className="text-sm text-pretty text-fg-2">{tl("promptText")}</p>
          </div>
          <Button onClick={() => setDrawing(true)}>{tl("promptButton")}</Button>
        </Card>
      )}
      <SideJobNotice company={company} />
      {company.distress && (
        <p className="rounded-md bg-loss-soft px-4 py-3 text-sm text-pretty text-loss" data-testid="distress">
          {t("distressCountdown", {
            amount: money(company.unpaidCents),
            count: Math.max(1, company.graceQuarters - company.distressQuarters),
          })}
        </p>
      )}

      {/* A running campaign stays in sight on every tab (ADR-168). */}
      <CampaignStrip
        company={company}
        onShow={() => go({ tab: "controlling", section: "marketing", target: "campaign" })}
      />

      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">
          <CompanyTabs value={tab} onChange={(next) => go({ tab: next })} tabs={tabs} label={t("title")} />
        </div>
        <MiraLauncher onOpen={() => setMiraOpen(true)} />
      </div>

      <div role="tabpanel" aria-label={tabs.find((x) => x.value === tab)?.label} data-tab={tab}>
        {tab === "dashboard" && (
          <DashboardTab
            company={company}
            listed={listed}
            listedPending={listedPending}
            health={health}
            onAsk={askAbout}
            todoCount={todoItems.length}
            urgentCount={todoItems.filter((x) => x.tone === "urgent").length}
            go={go}
          />
        )}
        {tab === "controlling" && (
          <ControllingTab
            company={company}
            listed={listed}
            listedPending={listedPending}
            go={go}
            onHire={setHire}
            onDrawLogo={() => setDrawing(true)}
            onEditBanner={() => setBannerOpen(true)}
          />
        )}
        {tab === "staff" && (
          <StaffTab
            company={company}
            listed={listed}
            listedPending={listedPending}
            onHire={setHire}
            todos={todoItems}
            go={go}
          />
        )}
        {tab === "books" &&
          (listed ? <BooksTab listed={listed} /> : listedPending ? <ListedSkeleton /> : <ListedTeaser focus="books" />)}
        {tab === "board" &&
          (isListed ? (
            <FirmSection id="board" icon={UI_ICONS.deal} title={th("board")} description={tb("tabText")}>
              <BoardView companyId={null} />
            </FirmSection>
          ) : (
            <ListedTeaser focus="board" />
          ))}
      </div>

      <HireSheet company={company} request={hire} onClose={() => setHire(null)} />
      {/* Mira on every tab (ADR-187): her own panel instead of a block on the dashboard. */}
      <Sheet open={miraOpen} onOpenChange={setMiraOpen} title={tm("title")} description={tm("text")}>
        <MiraChat
          applications={company.pendingApplications}
          health={miraHealth}
          company={company}
          onOpen={onMira}
          className="h-[min(68dvh,640px)]"
        />
      </Sheet>
    </div>
  );
}

/** The button that opens Mira's panel, next to the tabs on every tab. */
function MiraLauncher({ onOpen }: { onOpen: () => void }) {
  const tm = useTranslations("hq.miraPanel");
  return (
    <button
      type="button"
      onClick={() => {
        haptic("tap");
        void playSound("tap");
        onOpen();
      }}
      aria-label={tm("open")}
      data-testid="mira-open"
      data-tour="assistant"
      className="flex shrink-0 flex-col items-center justify-center gap-1 rounded-lg bg-accent-soft px-3 text-2xs font-medium text-fg-1 ring-1 ring-accent/40 focus-ring transition duration-fast hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] sm:flex-row sm:gap-2 sm:text-sm"
    >
      <PixelIcon {...MIRA.idle} scale={2} />
      <span>{tm("short")}</span>
    </button>
  );
}

function ListedSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2" aria-hidden>
      <Skeleton className="h-72 w-full rounded-lg" />
      <Skeleton className="h-72 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg lg:col-span-2" />
    </div>
  );
}

interface TabItem {
  value: CompanyTab;
  label: string;
  icon: keyof typeof UI_ICONS;
  badge?: number;
  /** Listed-only tab of a private company: shown with a lock, leads to the teaser. */
  locked?: boolean;
}

/**
 * The tabs as chunky, pressable buttons. Five do not fit a phone: the bar scrolls sideways on its own (the page
 * does not), and the active tab is brought into view.
 */
function CompanyTabs({
  value,
  onChange,
  tabs,
  label,
}: {
  value: CompanyTab;
  onChange: (tab: CompanyTab) => void;
  tabs: TabItem[];
  label: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    const box = bar.current;
    if (!el || !box) return;
    // Only the bar scrolls: scrollIntoView would also move the page.
    const left = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
    box.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [value]);
  return (
    <div
      ref={bar}
      role="tablist"
      aria-label={label}
      data-testid="company-tabs"
      className="no-scrollbar flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1 sm:gap-1.5 sm:p-1.5"
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-tab={tab.value}
            data-locked={tab.locked || undefined}
            onClick={() => {
              if (active) return;
              haptic("tap");
              void playSound("tap");
              onChange(tab.value);
            }}
            className={cn(
              "relative flex min-w-[5.25rem] flex-1 shrink-0 flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-2xs font-medium focus-ring transition duration-fast active:scale-[0.97] sm:flex-row sm:gap-2 sm:px-3 sm:py-2.5 sm:text-sm",
              active ? "text-fg-1" : "text-fg-3 hover:text-fg-1",
            )}
          >
            {active && (
              <motion.span
                layoutId="company-tab"
                transition={SPRING.snappy}
                className="absolute inset-0 rounded-md bg-surface-1 shadow-1 ring-1 ring-line-2"
              />
            )}
            <PixelIcon {...UI_ICONS[tab.locked ? "lock" : tab.icon]} scale={1} className="relative" />
            <span className="relative max-w-full truncate">{tab.label}</span>
            {tab.badge ? (
              <span className="absolute top-0.5 right-0.5 rounded-pill bg-accent px-1.5 nums text-2xs text-on-accent sm:relative sm:top-auto sm:right-auto">
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
