"use client";

import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { Skeleton } from "@/components/ui/skeleton";
import type { ListedCompany } from "@/features/game/listed-types";
import type { MyCompany } from "@/features/game/types";
import { Reveal } from "@/features/progression/components/reveal";
import { SatisfactionPanel } from "../../listed/satisfaction";
import type { CompanyTarget } from "../../tabs";
import { TaskBoard } from "../../tasks/task-board";
import { AutopilotCard } from "../autopilot-card";
import { CompanyChat } from "../company-chat";
import { TeamView, type HireRequest } from "../employer";
import { FirmSection, FoldBlock, MergedCard, SectionNav, type NavItem, type Pane } from "../firm-layout";
import { InterviewCard } from "../interview-card";
import { OfficeScene } from "../office-scene";
import { PitchCard } from "../pitch-card";
import { CompanyNewsCard, SituationCard } from "../situation";
import { StaffValueCard } from "../staff-value-card";
import { TodoCenter, type TodoItem } from "../todo-center";

/** From this many people "Was jeder leistet" starts closed. */
const FOLD_TEAM_FROM = 6;

/**
 * The staff tab (ADR-167; to-do center and merged team card since ADR-187): first everything that is due as one
 * list with the autopilot next to it, then the company tasks, the situation (events, crises, interviews, news), the
 * team in one card (seats and applicants, mood for listed companies, what everyone brings) and the company chat
 * (next to it from lg, last on phones).
 */
export function StaffTab({
  company,
  listed,
  listedPending,
  onHire,
  todos,
  go,
}: {
  company: MyCompany;
  listed: ListedCompany | null;
  listedPending: boolean;
  onHire: (request: HireRequest) => void;
  todos: TodoItem[];
  go: (target: CompanyTarget) => void;
}) {
  const t = useTranslations("hq.staff");
  const tw = useTranslations("hq.where.places");
  const tgr = useTranslations("hq.groupCards");
  const tt = useTranslations("hq.todo");
  const tf = useTranslations("hq.folds");
  const heads = company.employees + company.aiWorkers + 1;
  const nav: NavItem[] = [
    { id: "todo", label: tt("title"), icon: UI_ICONS.bell, badge: todos.length },
    { id: "staff-tasks", label: t("jump.tasks"), icon: UI_ICONS.briefcase },
    { id: "situation", label: tw("situation"), icon: UI_ICONS.news },
    { id: "group-team", label: t("jump.team"), icon: UI_ICONS.profile, badge: company.pendingApplications },
    { id: "staff-chat", label: t("jump.chat"), icon: UI_ICONS.news },
  ];
  const team: Pane[] = [
    {
      id: "staff-team",
      label: tw("staff-team"),
      description: t("sections.team.text"),
      content: (
        <div className="space-y-4">
          <div id="team" className="scroll-mt-32">
            <TeamView company={company} onHire={onHire} />
          </div>
          <div id="office" className="scroll-mt-32">
            <OfficeScene company={company} onTeam={() => go({ tab: "staff", section: "staff-team" })} />
          </div>
        </div>
      ),
    },
    ...(listed || listedPending
      ? [
          {
            id: "staff-mood",
            label: tw("staff-mood"),
            description: t("sections.mood.text"),
            content: listed ? <SatisfactionPanel listed={listed} /> : <Skeleton className="h-80 w-full rounded-lg" />,
          },
        ]
      : []),
    {
      id: "staff-value",
      label: tw("staff-value"),
      description: t("sections.value.text"),
      content: (
        // Closed by default once the team is long (ADR-187); the count says what is inside.
        <FoldBlock
          id="staff-value"
          title={tw("staff-value")}
          summary={tf("people", { count: heads })}
          defaultOpen={heads <= FOLD_TEAM_FROM}
        >
          <StaffValueCard company={company} id="staff-value-card" />
        </FoldBlock>
      ),
    },
  ];
  return (
    <div className="space-y-6" data-testid="company-staff">
      <SectionNav items={nav} label={t("jump.label")} testId="staff-nav" />
      <div className="grid items-start gap-6 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <div className="space-y-6">
          <FirmSection
            id="todo"
            icon={UI_ICONS.bell}
            title={tt("title")}
            description={tgr("todo")}
            columns={2}
            testId="firm-section-todo"
          >
            <TodoCenter items={todos} go={go} />
            <div id="autopilot" className="scroll-mt-32">
              <AutopilotCard />
            </div>
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
          <FirmSection
            id="situation"
            icon={UI_ICONS.news}
            title={tw("situation")}
            description={tgr("situation")}
            columns={2}
          >
            <div className="space-y-4">
              <SituationCard />
              <Reveal feature="companyInterview">
                <div id="interview" className="scroll-mt-32">
                  <InterviewCard />
                </div>
              </Reveal>
            </div>
            <div className="space-y-4">
              <PitchCard kind="event" />
              <CompanyNewsCard />
            </div>
          </FirmSection>
          <MergedCard
            id="group-team"
            icon={UI_ICONS.profile}
            title={t("jump.team")}
            description={tgr("group-team")}
            panes={team}
          />
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
