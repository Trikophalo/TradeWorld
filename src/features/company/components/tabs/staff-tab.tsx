"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import type { ListedCompany } from "@/features/game/listed-types";
import type { MyCompany } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { SatisfactionPanel } from "../../listed/satisfaction";
import { TaskBoard } from "../../tasks/task-board";
import { CompanyChat } from "../company-chat";
import { TeamView, type HireRequest } from "../employer";
import { StaffValueCard } from "../staff-value-card";

/**
 * The staff tab (ADR-167, UI): the team with seats, applicants, postings, AI workers and trainings, the tasks, and
 * the company chat right next to it (below the shortcuts on phones). Listed companies start with the satisfaction.
 */
export function StaffTab({
  company,
  listed,
  listedPending,
  onHire,
}: {
  company: MyCompany;
  listed: ListedCompany | null;
  listedPending: boolean;
  onHire: (request: HireRequest) => void;
}) {
  const t = useTranslations("hq.staff");
  const jump = (id: string) => {
    haptic("tap");
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const shortcuts = [
    ...(listed ? [["satisfaction", t("jump.satisfaction")] as const] : []),
    ["team", t("jump.team")] as const,
    ["tasks", t("jump.tasks")] as const,
    ["chat", t("jump.chat")] as const,
  ];
  return (
    <div className="space-y-4" data-testid="company-staff">
      <nav aria-label={t("jump.label")} className="-mx-1 no-scrollbar flex gap-2 overflow-x-auto px-1 lg:hidden">
        {shortcuts.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => jump(id)}
            className="shrink-0 rounded-pill border border-line-1 bg-surface-1 px-3 py-1.5 text-xs font-medium text-fg-2 focus-ring transition duration-fast hover:border-accent hover:text-fg-1 active:scale-95"
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="grid items-start gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <aside
          id="chat"
          aria-label={t("jump.chat")}
          className="scroll-mt-24 lg:sticky lg:top-20 lg:order-2"
          data-testid="staff-chat"
        >
          <CompanyChat className="h-[min(60dvh,460px)] lg:h-[min(calc(100dvh-7rem),720px)]" />
        </aside>
        <div className="space-y-8 lg:order-1">
          {listedPending && <Skeleton className="h-80 w-full rounded-lg" />}
          {listed && <SatisfactionPanel listed={listed} />}
          <div id="team" className="scroll-mt-24">
            <TeamView company={company} onHire={onHire} />
          </div>
          <StaffValueCard company={company} />
          <div id="tasks" className="scroll-mt-24">
            <TaskBoard />
          </div>
        </div>
      </div>
    </div>
  );
}
