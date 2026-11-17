"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ListedCompany } from "@/features/game/listed-types";
import { useServerClock } from "@/features/game/server-clock";
import { engine } from "@/features/game/store";
import type { CompanyAutopilot, MyCompany } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { useCompanyEvent } from "../hooks";
import { money, ServerCountdown } from "../listed/shared";
import { companyTodos, type CompanyTodo } from "../listed/view";
import { companyPulse } from "../pulse";
import type { CompanyTarget } from "../tabs";
import { useCompanyTasks } from "../tasks/task-board";
import { INTERVIEW_KEY } from "./interview-card";

/*
 * The to-do center (ADR-187): everything that waits for the founder in one list, grouped by urgency, one line per
 * item with a direct link to where it is done. Before, these were chips on the dashboard and badges on four tabs.
 */

export type TodoTone = "urgent" | "warn" | "normal";

export interface TodoItem {
  key: string;
  tone: TodoTone;
  label: string;
  deadline?: string;
  target: CompanyTarget;
}

const LISTED_TARGET: Record<string, CompanyTarget> = {
  books: { tab: "books", target: "books-duty" },
  taxes: { tab: "books", target: "taxes" },
  board: { tab: "board" },
  satisfaction: { tab: "staff", section: "staff-mood", target: "satisfaction" },
  growth: { tab: "controlling", section: "growth" },
  research: { tab: "controlling", section: "research" },
};

/** Everything that is due, most urgent first (the order inside a tone is the order of importance). */
export function useCompanyTodoItems(
  company: MyCompany,
  listed: ListedCompany | null,
  autopilot: CompanyAutopilot | null,
): TodoItem[] {
  const t = useTranslations("hq.todo");
  const tc = useTranslations("hq.todoCenter");
  const now = useServerClock();
  const tasks = useCompanyTasks();
  const event = useCompanyEvent();
  const interview = useQuery({
    queryKey: INTERVIEW_KEY,
    queryFn: () => engine.companyInterview(),
    refetchInterval: 60_000,
  });
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
  if (listed && now !== null) {
    for (const todo of companyTodos(listed, now)) {
      items.push({
        key: todo.key,
        tone: todo.tone,
        label: listedLabel(todo),
        deadline: todo.deadline,
        target: LISTED_TARGET[todo.section] ?? { tab: "dashboard" },
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
      target: { tab: "staff", section: "situation" },
    });
  }
  const iv = interview.data?.interview;
  if (iv && iv.status === "requested") {
    items.push({
      key: "interview",
      tone: "warn",
      label: tc("interview"),
      target: { tab: "staff", section: "situation" },
    });
  }
  if (company.distress) {
    items.push({
      key: "distress",
      tone: "urgent",
      label: t("distress", { amount: money(company.unpaidCents) }),
      target: { tab: "controlling", section: "money" },
    });
  } else if (company.unpaidCents > 0) {
    items.push({
      key: "unpaid",
      tone: "warn",
      label: tc("unpaid", { amount: money(company.unpaidCents) }),
      target: { tab: "controlling", section: "money" },
    });
  }
  if (company.pendingApplications > 0) {
    items.push({
      key: "applications",
      tone: "normal",
      label: t("applications", { count: company.pendingApplications }),
      target: { tab: "staff", section: "staff-team", target: "applications" },
    });
  }
  if (openTasks > 0) {
    items.push({
      key: "tasks",
      tone: "normal",
      label: t("tasks", { count: openTasks }),
      target: { tab: "staff", section: "staff-tasks", target: "tasks" },
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
      target: { tab: "controlling", section: "business" },
    });
  }
  if (pulse.soldOut) {
    items.push({
      key: "soldOut",
      tone: "normal",
      label: t("soldOut"),
      target: { tab: "staff", section: "staff-team" },
    });
  }
  if (autopilot && !autopilot.on && autopilot.canToggle) {
    items.push({
      key: "autopilot",
      tone: "normal",
      label: t("autopilot"),
      target: { tab: "staff", section: "todo", target: "autopilot" },
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
  return items;
}

const TONES: TodoTone[] = ["urgent", "warn", "normal"];
const DOT = { urgent: "bg-loss", warn: "bg-warn", normal: "bg-accent" } as const;
const TEXT = { urgent: "text-loss", warn: "text-warn", normal: "text-fg-2" } as const;

/** The list: one group per urgency, one line per item, the button leads straight to the place. */
export function TodoCenter({ items, go }: { items: TodoItem[]; go: (target: CompanyTarget) => void }) {
  const t = useTranslations("hq.todo");
  const tc = useTranslations("hq.todoCenter");
  return (
    <div className="space-y-3" id="todo-list" data-testid="company-todo">
      {items.length === 0 && (
        <p className="rounded-md bg-gain-soft px-3 py-2.5 text-sm text-gain" data-testid="todo-none">
          {t("none")}
        </p>
      )}
      {TONES.map((tone) => {
        const rows = items.filter((x) => x.tone === tone);
        if (rows.length === 0) return null;
        return (
          <div key={tone} className="space-y-1.5" data-testid={`todo-group-${tone}`}>
            <p className={cn("flex items-center gap-1.5 label-pixel", TEXT[tone])}>
              <span aria-hidden className={cn("size-2 rounded-pill", DOT[tone])} />
              {tc(tone)} <span className="nums text-fg-3">{rows.length}</span>
            </p>
            <ul className="divide-y divide-line-1 overflow-hidden rounded-md border border-line-1 bg-surface-2">
              {rows.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => {
                      haptic("tap");
                      go(item.target);
                    }}
                    data-testid={`todo-${item.key}`}
                    data-tone={item.tone}
                    className="group flex w-full items-center gap-3 px-3 py-2 text-left text-sm focus-ring transition duration-fast hover:bg-surface-3 active:scale-[0.99]"
                  >
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-pill", DOT[item.tone])} />
                    <span className="min-w-0 flex-1 truncate text-fg-1">{item.label}</span>
                    {item.deadline && (
                      <ServerCountdown at={item.deadline} className="shrink-0 nums text-xs font-semibold text-fg-2" />
                    )}
                    <span className="shrink-0 rounded-sm px-1.5 py-0.5 text-xs font-medium text-accent transition-transform duration-fast group-hover:translate-x-0.5">
                      {tc("open")} ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
