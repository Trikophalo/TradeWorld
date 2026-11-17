"use client";

import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { Skeleton } from "@/components/ui/skeleton";
import type { ListedCompany } from "@/features/game/listed-types";
import type { MyCompany } from "@/features/game/types";
import { SatisfactionPanel } from "../../listed/satisfaction";
import { TaskBoard } from "../../tasks/task-board";
import { CompanyChat } from "../company-chat";
import { TeamView, type HireRequest } from "../employer";
import { FirmSection, SectionNav, type NavItem } from "../firm-layout";
import { StaffValueCard } from "../staff-value-card";

/**
 * The staff tab (ADR-167; sections since ADR-183): for listed companies the satisfaction first, then the team with
 * seats, applicants, postings, AI workers and trainings, what everyone brings and costs, the tasks, and the company
 * chat (next to it from lg, last on phones). A sticky jump bar leads to each section.
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
  const nav: NavItem[] = [
    ...(listed || listedPending ? [{ id: "staff-mood", label: t("jump.satisfaction"), icon: UI_ICONS.heart }] : []),
    { id: "staff-team", label: t("jump.team"), icon: UI_ICONS.profile, badge: company.pendingApplications },
    { id: "staff-value", label: t("jump.value"), icon: UI_ICONS.portfolio },
    { id: "staff-tasks", label: t("jump.tasks"), icon: UI_ICONS.briefcase },
    { id: "staff-chat", label: t("jump.chat"), icon: UI_ICONS.news },
  ];
  return (
    <div className="space-y-6" data-testid="company-staff">
      <SectionNav items={nav} label={t("jump.label")} testId="staff-nav" />
      <div className="grid items-start gap-6 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <div className="space-y-8">
          {(listed || listedPending) && (
            <FirmSection
              id="staff-mood"
              icon={UI_ICONS.heart}
              title={t("sections.mood.title")}
              description={t("sections.mood.text")}
            >
              {listedPending && <Skeleton className="h-80 w-full rounded-lg" />}
              {listed && <SatisfactionPanel listed={listed} />}
            </FirmSection>
          )}
          <FirmSection
            id="staff-team"
            icon={UI_ICONS.profile}
            title={t("sections.team.title")}
            description={t("sections.team.text")}
          >
            <div id="team" className="scroll-mt-32">
              <TeamView company={company} onHire={onHire} />
            </div>
          </FirmSection>
          <FirmSection
            id="staff-value"
            icon={UI_ICONS.portfolio}
            title={t("sections.value.title")}
            description={t("sections.value.text")}
          >
            <StaffValueCard company={company} />
          </FirmSection>
          <FirmSection
            id="staff-tasks"
            icon={UI_ICONS.briefcase}
            title={t("sections.tasks.title")}
            description={t("sections.tasks.text")}
          >
            <div id="tasks" className="scroll-mt-32">
              <TaskBoard />
            </div>
          </FirmSection>
        </div>
        <aside
          id="section-staff-chat"
          data-section="staff-chat"
          aria-label={t("jump.chat")}
          className="scroll-mt-32 space-y-3 lg:sticky lg:top-32"
          data-testid="staff-chat-section"
        >
          <header className="border-b-2 border-line-1 pb-2.5">
            <h2 className="font-semibold text-fg-1">{t("sections.chat.title")}</h2>
            <p className="text-sm text-pretty text-fg-3">{t("sections.chat.text")}</p>
          </header>
          <div id="chat" className="scroll-mt-32" data-testid="staff-chat">
            <CompanyChat className="h-[min(60dvh,460px)] lg:h-[min(calc(100dvh-12rem),680px)]" />
          </div>
        </aside>
      </div>
    </div>
  );
}
