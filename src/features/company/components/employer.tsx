"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { SKILL_BRANCHES, SKILL_NODES, type SkillBranch } from "@/config/skills";
import { BusinessCard } from "@/features/career/components/business-card";
import { useJobTitle } from "@/features/career/components/job-title";
import { usePlayerCard } from "@/features/career/hooks";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { CareerTier, CompanyApplication, JobRequirementInfo, MyCompany, TeamMember } from "@/features/game/types";
import { formatBps, formatMoney } from "@/lib/format";
import { fitPercent } from "@/lib/sim/skills";
import { trainingFor } from "@/lib/sim/startup";
import { isDemoMode } from "@/lib/supabase/env";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { useCompanyApplications, useCompanyPostings, useCompanyRefresh, useCompanyTeam } from "../hooks";

type BranchKey = Parameters<ReturnType<typeof useTranslations<"skills.branches">>>[0];
const TIERS = BALANCE.careers.tiers.map((t) => t.id) as CareerTier[];
const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short" });
const factor = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const baseWage = (tier: CareerTier): number =>
  BALANCE.careers.tiers.find((t) => t.id === tier)?.salaryCentsPerHour ?? 15_000;

// ------------------------------------------------------------------ postings

export function Postings({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations("firm");
  const tc = useTranslations("careerTiers");
  const tb = useTranslations("skills.branches");
  const tn = useTranslations("skills.nodes");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const postings = useCompanyPostings(true);

  const close = async (id: string) => {
    try {
      await engine.closeJobPosting(crypto.randomUUID(), id);
      await refresh();
    } catch (error) {
      toast.error(t("postingClose"), errorText(error));
    }
  };

  return (
    <div className="space-y-4">
      <Button onClick={onCreate}>{t("newPosting")}</Button>
      {!postings.data ? (
        <Skeleton className="h-28 w-full rounded-lg" />
      ) : postings.data.length === 0 ? (
        <EmptyState
          art={<PixelIcon {...UI_ICONS.briefcase} scale={4} />}
          title={t("tabPostings")}
          description={t("postingsEmpty")}
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {postings.data.map((p) => (
            <li key={p.id}>
              <Card padding="md" className={cn("space-y-2", p.status === "closed" && "opacity-60")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-fg-1">{p.title}</p>
                    <p className="text-sm text-fg-3">
                      {tc(p.tier)} · {formatMoney(p.salaryCentsPerHour)}/Std.
                    </p>
                  </div>
                  <Badge tone={p.status === "open" ? "gain" : "neutral"}>
                    {p.status === "open" ? t("postingOpen", { open: p.slotsOpen, slots: p.slots }) : t("postingClosed")}
                  </Badge>
                </div>
                <p className="text-xs text-fg-3">
                  {p.required
                    .map(
                      (r) =>
                        `${tb(`${r.branch as SkillBranch}.name` as `${BranchKey}`)} ${t("postingMin", { score: r.minScore })}`,
                    )
                    .join(" · ")}
                </p>
                {p.requiredSkills.length > 0 && (
                  <p className="text-xs text-accent">
                    {p.requiredSkills.map((k) => tn(`${k}.name` as Parameters<typeof tn>[0])).join(" · ")}
                  </p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-fg-2">{t("postingPending", { count: p.applicationsPending })}</span>
                  {p.status === "open" && (
                    <Button size="sm" variant="ghost" onClick={() => void close(p.id)}>
                      {t("postingClose")}
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface HireRequest {
  skills?: string[];
  kind?: "player" | "ai";
}

/** One form for both: post a job for players, or hire AI workers at once (ADR-069, ADR-071). */
export function HireSheet({
  company,
  request,
  onClose,
}: {
  company: MyCompany;
  request: HireRequest | null;
  onClose: () => void;
}) {
  const open = request !== null;
  const initialSkills = request?.skills;
  const t = useTranslations("firm");
  const tc = useTranslations("careerTiers");
  const tb = useTranslations("skills.branches");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const sectorBranches = (BALANCE.jobs.sectorBranches[company.sector] ?? SKILL_BRANCHES) as readonly SkillBranch[];
  const [title, setTitle] = useState("");
  const [tier, setTier] = useState<CareerTier>("intern");
  const [required, setRequired] = useState<JobRequirementInfo[]>([{ branch: sectorBranches[0]!, minScore: 0 }]);
  const [wage, setWage] = useState(baseWage("intern"));
  const [slots, setSlots] = useState(1);
  const [skills, setSkills] = useState<string[]>(initialSkills ?? []);
  const [kind, setKind] = useState<"player" | "ai">(request?.kind ?? "player");
  const [aiCount, setAiCount] = useState(1);
  const [aiSkill, setAiSkill] = useState<string | null>(null);
  const [state, setState] = useState<ButtonState>("idle");
  const freeSlots = Math.max(0, company.maxEmployees - company.employees - company.aiWorkers);
  const hireCount = Math.max(1, Math.min(aiCount, freeSlots));
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setState("idle");
      setAiCount(1);
      setKind(request?.kind ?? "player");
      setSkills(initialSkills ?? []);
      setAiSkill(initialSkills?.length === 1 ? initialSkills[0]! : null);
    }
  }

  const toggle = (branch: SkillBranch) => {
    setRequired((list) =>
      list.some((r) => r.branch === branch)
        ? list.filter((r) => r.branch !== branch)
        : list.length >= 2
          ? list
          : [...list, { branch, minScore: BALANCE.jobs.tierMinScore[tier] ?? 0 }],
    );
  };

  const create = async () => {
    setState("loading");
    try {
      await engine.createJobPosting({
        requestId: crypto.randomUUID(),
        companyId: company.id,
        tier,
        title: title.trim(),
        required,
        salaryCentsPerHour: wage,
        slots,
        requiredSkills: skills,
      });
      setState("success");
      void playSound("success");
      toast.success(t("postingCreated"), title.trim(), { silent: true });
      await refresh();
      window.setTimeout(onClose, 400);
    } catch (error) {
      setState("idle");
      toast.error(t("newPosting"), errorText(error));
    }
  };

  // AI workers are hired at once (ADR-069): no applications, standard work.
  const hireAi = async () => {
    setState("loading");
    try {
      await engine.hireAiWorkers(crypto.randomUUID(), aiSkill ? 1 : hireCount, aiSkill);
      setState("success");
      void playSound("success");
      toast.success(t("aiHired", { count: hireCount }), undefined, { silent: true });
      await refresh();
      window.setTimeout(onClose, 400);
    } catch (error) {
      setState("idle");
      toast.error(t("aiWorkers"), errorText(error));
    }
  };

  const low = Math.round(baseWage(tier) / 2);
  const high = baseWage(tier) * 3;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("newPosting")}
      footer={
        kind === "ai" ? (
          <Button block size="lg" state={state} disabled={freeSlots === 0} onClick={() => void hireAi()}>
            {t("aiHire", { count: aiSkill ? 1 : hireCount })}
          </Button>
        ) : (
          <Button
            block
            size="lg"
            state={state}
            disabled={title.trim().length < 3 || required.length === 0}
            onClick={() => void create()}
          >
            {t("postingCreate")}
          </Button>
        )
      }
    >
      <div className="space-y-5">
        <Segmented<"player" | "ai">
          value={kind}
          onValueChange={setKind}
          label={t("postingKind")}
          block
          options={[
            { value: "player", label: t("postingKindPlayer") },
            { value: "ai", label: t("postingKindAi") },
          ]}
        />
        {kind === "ai" ? (
          <AiHirePanel
            company={company}
            count={aiSkill ? 1 : aiCount}
            freeSlots={freeSlots}
            onCount={setAiCount}
            skill={aiSkill}
            onSkill={setAiSkill}
          />
        ) : (
          <PlayerPostingFields>
            <Field
              label={t("postingTitle")}
              value={title}
              maxLength={40}
              placeholder={t("postingTitlePlaceholder")}
              onChange={(event) => setTitle(event.target.value)}
            />
            <div>
              <p className="mb-2 label-pixel text-fg-2">{t("postingTier")}</p>
              <div className="flex flex-wrap gap-2">
                {TIERS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={tier === id}
                    onClick={() => {
                      setTier(id);
                      setWage(baseWage(id));
                      setRequired((list) => list.map((r) => ({ ...r, minScore: BALANCE.jobs.tierMinScore[id] ?? 0 })));
                    }}
                    className={cn(
                      "rounded-sm border px-3 py-1.5 text-sm focus-ring transition-colors duration-fast",
                      tier === id
                        ? "border-accent bg-accent-soft text-fg-1"
                        : "border-line-1 text-fg-2 hover:bg-surface-2",
                    )}
                  >
                    {tc(id)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="label-pixel text-fg-2">{t("postingSkills")}</p>
              <p className="mb-2 text-xs text-fg-3">{t("postingSkillsHint")}</p>
              <div className="flex flex-wrap gap-2">
                {SKILL_BRANCHES.map((branch) => {
                  const req = required.find((r) => r.branch === branch);
                  return (
                    <button
                      key={branch}
                      type="button"
                      aria-pressed={Boolean(req)}
                      onClick={() => toggle(branch)}
                      className={cn(
                        "rounded-sm border px-2.5 py-1.5 text-xs focus-ring transition-colors duration-fast",
                        req ? "border-accent bg-accent-soft text-fg-1" : "border-line-1 text-fg-2 hover:bg-surface-2",
                        sectorBranches.includes(branch) && !req && "border-dashed",
                      )}
                    >
                      {tb(`${branch}.name` as `${BranchKey}`)}
                      {req && <span className="ml-1 nums text-accent">{t("postingMin", { score: req.minScore })}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="label-pixel text-fg-2">{t("postingWage")}</span>
                <span className="nums font-semibold text-fg-1">{formatMoney(wage)}/Std.</span>
              </div>
              <Slider
                value={(wage - low) / (high - low)}
                onValueChange={(v) => setWage(Math.round((low + v * (high - low)) / 100) * 100)}
                label={t("postingWage")}
                marks={[(baseWage(tier) - low) / (high - low)]}
              />
            </div>
            <SkillPicker value={skills} onChange={setSkills} />
            <div className="flex items-center justify-between">
              <span className="label-pixel text-fg-2">{t("postingSlots")}</span>
              <Segmented<string>
                value={String(slots)}
                onValueChange={(v) => setSlots(Number(v))}
                label={t("postingSlots")}
                size="sm"
                options={Array.from({ length: Math.max(1, Math.min(3, company.maxEmployees)) }, (_, i) => ({
                  value: String(i + 1),
                  label: String(i + 1),
                }))}
              />
            </div>
          </PlayerPostingFields>
        )}
      </div>
    </Sheet>
  );
}

function PlayerPostingFields({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}

/** Hiring AI workers from the posting form (ADR-069): wage, count and what they cannot do. */
function AiHirePanel({
  company,
  count,
  freeSlots,
  onCount,
  skill,
  onSkill,
}: {
  company: MyCompany;
  count: number;
  freeSlots: number;
  onCount: (count: number) => void;
  skill: string | null;
  onSkill: (skill: string | null) => void;
}) {
  const t = useTranslations("firm");
  const tn = useTranslations("skills.nodes");
  // Open stage seats an AI worker can fill (ADR-071).
  const open = company.stages.flatMap((st) => st.skills).filter((s) => !s.coveredBy && !s.coveredByAi);
  const penalty = BALANCE.startups.aiQualityPenalty;
  return (
    <div className="space-y-4" data-testid="ai-hire">
      <Card padding="md" className="space-y-1.5 bg-surface-2">
        <p className="text-sm text-fg-1">{t("aiIntro")}</p>
        <ul className="list-disc space-y-1 pl-4 text-xs text-pretty text-fg-3">
          <li>{t("aiPointProductivity")}</li>
          <li>{t("aiPointSkills")}</li>
          <li>{t("aiPointQuality", { percent: Math.round(penalty * 100) })}</li>
        </ul>
      </Card>
      {open.length > 0 && (
        <div>
          <p className="mb-1.5 label-pixel text-fg-2">{t("aiFor")}</p>
          <div role="radiogroup" aria-label={t("aiFor")} className="flex flex-wrap gap-1.5">
            {[null, ...open.map((s) => s.key)].map((key) => (
              <button
                key={key ?? "general"}
                type="button"
                role="radio"
                aria-checked={skill === key}
                onClick={() => onSkill(key)}
                className={cn(
                  "rounded-sm border px-2.5 py-1.5 text-xs focus-ring transition-colors duration-fast",
                  skill === key
                    ? "border-accent bg-accent-soft text-fg-1"
                    : "border-line-1 text-fg-2 hover:bg-surface-2",
                )}
              >
                {key ? tn(`${key}.name` as Parameters<typeof tn>[0]) : t("aiGeneral")}
              </button>
            ))}
          </div>
          {skill && <p className="mt-1.5 text-xs text-pretty text-fg-3">{t("aiForHint")}</p>}
        </div>
      )}
      <div className="flex items-baseline justify-between">
        <span className="label-pixel text-fg-2">{t("aiWage")}</span>
        <span className="nums font-semibold text-fg-1">
          {t("aiWageValue", { amount: formatMoney(company.aiWageCentsPerHour, { whole: true }) })}
        </span>
      </div>
      {freeSlots === 0 ? (
        <p className="text-sm text-loss">{t("aiNoSlots", { max: company.maxEmployees })}</p>
      ) : skill ? null : (
        <div className="flex items-center justify-between">
          <span className="label-pixel text-fg-2">{t("aiCount")}</span>
          <Segmented<string>
            value={String(Math.min(count, freeSlots))}
            onValueChange={(v) => onCount(Number(v))}
            label={t("aiCount")}
            size="sm"
            options={Array.from({ length: Math.min(3, freeSlots) }, (_, i) => ({
              value: String(i + 1),
              label: String(i + 1),
            }))}
          />
        </div>
      )}
      <p className="text-xs text-fg-3">
        {t("aiTotal", {
          amount: formatMoney(company.aiWageCentsPerHour * Math.min(count, Math.max(1, freeSlots)), { whole: true }),
        })}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ applications

export function Applications({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const applications = useCompanyApplications(company.id);
  const [counter, setCounter] = useState<CompanyApplication | null>(null);
  if (!applications.data) return <Skeleton className="h-32 w-full rounded-lg" />;
  if (applications.data.length === 0) {
    return (
      <EmptyState
        art={<PixelIcon {...UI_ICONS.card} scale={4} />}
        title={t("tabApplications")}
        description={isDemoMode ? t("applicationsDemo") : t("applicationsEmpty")}
      />
    );
  }
  return (
    <>
      <ul className="space-y-3">
        {applications.data.map((a) => (
          <li key={a.id}>
            <ApplicantRow application={a} onCounter={() => setCounter(a)} />
          </li>
        ))}
      </ul>
      <CounterSheet application={counter} onClose={() => setCounter(null)} />
    </>
  );
}

function ApplicantRow({ application, onCounter }: { application: CompanyApplication; onCounter: () => void }) {
  const t = useTranslations("firm");
  const tj = useTranslations("jobs");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const title = useJobTitle(application.posting);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const fit = fitPercent(application.posting.required, application.applicant.branchScores);
  const pending = application.status === "pending";

  const respond = async (action: "accept" | "reject") => {
    setBusy(true);
    try {
      await engine.respondApplication(crypto.randomUUID(), application.id, action);
      toast.success(action === "accept" ? t("accepted") : t("rejected"), undefined, { silent: true });
      void playSound(action === "accept" ? "success" : "tap");
      await refresh();
    } catch (error) {
      toast.error(t("tabApplications"), errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="md" data-applicant={application.applicant.nickname}>
      <div className="flex items-start gap-3">
        <Avatar avatarKey={application.applicant.avatarKey} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/players/${encodeURIComponent(application.applicant.nickname)}`}
              className="truncate font-semibold text-fg-1 focus-ring hover:underline"
            >
              {application.applicant.nickname}
            </Link>
            <Badge>Level {application.applicant.level}</Badge>
            <Badge tone={STATUS_TONE[application.status]}>{tj(`status.${application.status}`)}</Badge>
          </div>
          <p className="truncate text-sm text-fg-3">
            {title} · {t("fit", { percent: `${Math.min(100, fit)} %` })} ·{" "}
            {t("wish", { amount: formatMoney(application.salaryWishCentsPerHour) })}
          </p>
          {application.message && <p className="mt-1 text-sm text-pretty text-fg-2">„{application.message}“</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setViewing(true)}>
          {t("viewCard")}
        </Button>
        {pending && (
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void respond("reject")}>
              {t("reject")}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={onCounter}>
              {t("counter")}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void respond("accept")}>
              {t("accept")}
            </Button>
          </>
        )}
      </div>
      <ApplicantCardSheet
        nickname={viewing ? application.applicant.nickname : null}
        canAccept={pending}
        busy={busy}
        onAccept={() => {
          setViewing(false);
          void respond("accept");
        }}
        onClose={() => setViewing(false)}
      />
    </Card>
  );
}

/** The applicant's business card, to look at before accepting. */
function ApplicantCardSheet({
  nickname,
  canAccept,
  busy,
  onAccept,
  onClose,
}: {
  nickname: string | null;
  canAccept: boolean;
  busy: boolean;
  onAccept: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("firm");
  const [shown, setShown] = useState(nickname);
  if (nickname !== null && nickname !== shown) setShown(nickname);
  const card = usePlayerCard(shown ?? "");
  return (
    <Sheet
      open={nickname !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t("cardTitle", { name: shown ?? "" })}
      footer={
        canAccept ? (
          <Button block size="lg" disabled={busy} onClick={onAccept}>
            {t("accept")}
          </Button>
        ) : undefined
      }
    >
      <div data-testid="applicant-card">
        {card.data ? <BusinessCard card={card.data} /> : <Skeleton className="h-48 w-full rounded-lg" />}
        {shown && (
          <Link
            href={`/players/${encodeURIComponent(shown)}`}
            className="mt-3 inline-block text-sm text-accent focus-ring hover:underline"
          >
            {t("fullProfile")}
          </Link>
        )}
      </div>
    </Sheet>
  );
}

const STATUS_TONE = {
  pending: "info",
  offered: "accent",
  rejected: "loss",
  declined: "neutral",
  withdrawn: "neutral",
  expired: "warn",
  signed: "gain",
  closed: "neutral",
} as const;

function CounterSheet({ application, onClose }: { application: CompanyApplication | null; onClose: () => void }) {
  const t = useTranslations("firm");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const [shown, setShown] = useState(application);
  const [wage, setWage] = useState(0);
  const [state, setState] = useState<ButtonState>("idle");
  if (application && application !== shown) {
    setShown(application);
    setWage(application.salaryWishCentsPerHour);
    setState("idle");
  }
  if (!shown) return null;
  const low = Math.round(shown.salaryWishCentsPerHour / 2);
  const high = shown.salaryWishCentsPerHour * 2;
  const send = async () => {
    setState("loading");
    try {
      await engine.respondApplication(crypto.randomUUID(), shown.id, "counter", wage);
      setState("success");
      toast.success(t("accepted"), undefined, { silent: true });
      await refresh();
      window.setTimeout(onClose, 400);
    } catch (error) {
      setState("idle");
      toast.error(t("counter"), errorText(error));
    }
  };
  return (
    <Sheet
      open={application !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t("counterTitle")}
      description={shown.applicant.nickname}
      footer={
        <Button block size="lg" state={state} onClick={() => void send()}>
          {t("counterSend")}
        </Button>
      }
    >
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-fg-2">{t("wish", { amount: formatMoney(shown.salaryWishCentsPerHour) })}</span>
          <span className="nums text-lg font-semibold text-fg-1">{formatMoney(wage)}/Std.</span>
        </div>
        <Slider
          value={(wage - low) / (high - low)}
          onValueChange={(v) => setWage(Math.round((low + v * (high - low)) / 100) * 100)}
          label={t("counterTitle")}
          marks={[0.5]}
        />
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ team

export function TeamView({ company, onHire }: { company: MyCompany; onHire: (request: HireRequest) => void }) {
  const t = useTranslations("firm");
  const team = useCompanyTeam(company.id);
  const [firing, setFiring] = useState<TeamMember | null>(null);
  const general = Math.max(0, company.aiWorkers - company.aiWorkerSkills.length);
  const used = company.employees + company.aiWorkers;
  const free = Math.max(0, company.maxEmployees - used);
  return (
    <div className="space-y-8">
      <Section title={t("seatsTitle")} aside={t("staffCount", { used, max: company.maxEmployees })}>
        {!team.data ? (
          <Skeleton className="h-32 w-full rounded-lg" />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2" data-testid="seats">
            <li>
              <FounderSeat company={company} />
            </li>
            {team.data.map((m) => (
              <li key={m.playerJobId}>
                <MemberRow member={m} onFire={() => setFiring(m)} />
              </li>
            ))}
            {company.aiWorkerSkills.map((skill) => (
              <li key={`ai-${skill}`}>
                <AiWorkerRow company={company} skill={skill} />
              </li>
            ))}
            {Array.from({ length: general }, (_, i) => (
              <li key={`ai-general-${i}`}>
                <AiWorkerRow company={company} skill={null} />
              </li>
            ))}
            {Array.from({ length: free }, (_, i) => (
              <li key={`free-${i}`}>
                <FreeSeat onHire={() => onHire({})} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t("tabApplications")}>
        <Applications company={company} />
      </Section>
      <Section title={t("tabPostings")}>
        <Postings onCreate={() => onHire({})} />
      </Section>
      <Section id="training" title={t("trainingTitle")}>
        <Training company={company} members={team.data ?? []} />
      </Section>
      <FireSheet member={firing} onClose={() => setFiring(null)} />
    </div>
  );
}

function Section({ id, title, aside, children }: { id?: string; title: string; aside?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-line-1 pb-2">
        <h3 className="label-pixel text-fg-1">{title}</h3>
        {aside && <span className="nums text-xs text-fg-3">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function FounderSeat({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const nickname = useGame((state) => state.portfolio?.nickname ?? "");
  const avatarKey = useGame((state) => state.portfolio?.avatarKey ?? null);
  return (
    <Card padding="md" className="flex h-full items-center gap-3 border-accent/40 bg-accent-soft">
      <Avatar avatarKey={avatarKey} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-fg-1">{nickname}</p>
        <p className="text-sm text-fg-2">
          {company.founderHasJob ? t("founderSideJob") : t("founderSeat")} ·{" "}
          <span className="nums text-gain">
            {t("productivityValue", { value: factor.format(company.founderProductivityBps / 10_000) })}
          </span>
        </p>
      </div>
      <span className="label-pixel text-accent">{t("boss")}</span>
    </Card>
  );
}

function FreeSeat({ onHire }: { onHire: () => void }) {
  const t = useTranslations("firm");
  return (
    <button
      type="button"
      onClick={() => {
        haptic("tap");
        onHire();
      }}
      className="flex h-full min-h-20 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line-2 px-4 py-3 text-sm text-fg-2 focus-ring transition duration-fast hover:-translate-y-0.5 hover:border-accent hover:bg-surface-1 hover:text-fg-1 active:translate-y-0 active:scale-[0.98]"
    >
      <span className="text-lg text-accent">+</span> {t("freeSeat")}
    </button>
  );
}

/** Trainings (ADR-062) unlock once the team is big enough (ADR-071). */
function Training({ company, members }: { company: MyCompany; members: TeamMember[] }) {
  const t = useTranslations("firm");
  const [training, setTraining] = useState<TeamMember | null>(null);
  const size = company.employees + company.aiWorkers;
  if (size < company.trainingFrom) {
    return (
      <Card padding="lg" className="flex items-center gap-4 bg-surface-2/60" data-testid="training-locked">
        <PixelIcon {...UI_ICONS.lock} scale={3} className="text-fg-3" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm text-pretty text-fg-2">{t("trainingLocked", { count: company.trainingFrom })}</p>
          <div className="h-2 overflow-hidden rounded-pill bg-surface-3">
            <div
              className="h-full origin-left rounded-pill bg-accent"
              style={{ transform: `scaleX(${size / company.trainingFrom})` }}
            />
          </div>
          <p className="nums text-xs text-fg-3">{t("trainingProgress", { size, count: company.trainingFrom })}</p>
        </div>
      </Card>
    );
  }
  if (members.length === 0) {
    return <p className="text-sm text-fg-3">{t("trainingNoPlayers")}</p>;
  }
  return (
    <>
      <p className="text-sm text-pretty text-fg-3">{t("trainIntro")}</p>
      <ul className="grid gap-2 lg:grid-cols-2">
        {members.map((m) => (
          <li key={m.playerJobId}>
            <Card padding="md" className="flex items-center gap-3">
              <Avatar avatarKey={m.avatarKey} size="xs" />
              <Link
                href={`/players/${encodeURIComponent(m.nickname)}`}
                className="min-w-0 flex-1 truncate text-sm text-fg-1 focus-ring hover:underline"
              >
                {m.nickname}
              </Link>
              <Button size="sm" onClick={() => setTraining(m)}>
                {t("train")}
              </Button>
            </Card>
          </li>
        ))}
      </ul>
      <TrainSheet company={company} member={training} onClose={() => setTraining(null)} />
    </>
  );
}

/** One AI worker in the team list (ADR-069, ADR-071): wage, maybe a stage skill it covers, can be let go at once. */
function AiWorkerRow({ company, skill }: { company: MyCompany; skill: string | null }) {
  const t = useTranslations("firm");
  const tn = useTranslations("skills.nodes");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const [state, setState] = useState<ButtonState>("idle");
  const dismiss = async () => {
    setState("loading");
    try {
      await engine.dismissAiWorker(crypto.randomUUID(), skill);
      toast.success(t("aiDismissed"), undefined, { silent: true });
      await refresh();
    } catch (error) {
      toast.error(t("aiWorkers"), errorText(error));
    } finally {
      setState("idle");
    }
  };
  return (
    <Card padding="md" className="flex h-full items-center gap-3 border-info/30" data-testid="ai-seat">
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-info-soft text-info">
        <PixelIcon {...UI_ICONS.robot} scale={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-fg-1">{t("aiWorkerName")}</p>
        <p className="truncate text-xs text-info">
          {skill ? t("aiForSkill", { skill: tn(`${skill}.name` as Parameters<typeof tn>[0]) }) : t("aiGeneral")}
        </p>
        <p className="text-xs text-fg-3">
          {t("aiWageValue", { amount: formatMoney(company.aiWageCentsPerHour, { whole: true }) })} ·{" "}
          {t("productivityValue", { value: factor.format(1) })}
        </p>
      </div>
      <Button size="sm" variant="ghost" state={state} onClick={() => void dismiss()}>
        {t("aiDismiss")}
      </Button>
    </Card>
  );
}

function MemberRow({ member, onFire }: { member: TeamMember; onFire: () => void }) {
  const tn = useTranslations("skills.nodes");
  const t = useTranslations("firm");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const [busy, setBusy] = useState(false);
  const raise = async (accept: boolean) => {
    setBusy(true);
    try {
      await engine.respondRaise(crypto.randomUUID(), member.playerJobId, accept);
      await refresh();
    } catch (error) {
      toast.error(t("tabTeam"), errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card padding="md" className="h-full">
      <div className="flex items-start gap-3">
        <Avatar avatarKey={member.avatarKey} size="sm" />
        <div className="min-w-0 flex-1">
          <Link
            href={`/players/${encodeURIComponent(member.nickname)}`}
            className="block truncate font-semibold text-fg-1 focus-ring hover:underline"
            data-testid="member-profile"
          >
            {member.nickname}
          </Link>
          <p className="truncate text-sm text-fg-3">
            {member.title} · {t("since", { date: date.format(new Date(member.startedAt)) })}
          </p>
          <p className="mt-1 text-sm">
            <span className="nums text-fg-1">{formatMoney(member.salaryCentsPerHour)}/Std.</span> ·{" "}
            <span className="nums text-gain">
              {t("productivityValue", { value: factor.format(member.productivityBps / 10_000) })}
            </span>
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onFire}>
          {t("fire")}
        </Button>
      </div>
      {member.skills.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {member.skills.slice(0, 8).map((key) => (
            <li key={key} className="rounded-xs bg-surface-3 px-1.5 py-0.5 text-xs text-fg-2">
              {tn(`${key}.name` as Parameters<typeof tn>[0])}
            </li>
          ))}
        </ul>
      )}
      {member.noticeEndsAt && (
        <p className="mt-2 text-xs text-warn">
          {t("noticeMember", { date: date.format(new Date(member.noticeEndsAt)) })}
        </p>
      )}
      {member.pendingRaise && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2">
          <span className="text-sm text-fg-2">
            {t("raiseRequest", { percent: formatBps(member.pendingRaise.requestedBps).replace("+", "") })}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void raise(false)}>
              {t("raiseReject")}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void raise(true)}>
              {t("raiseAccept")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function FireSheet({ member, onClose }: { member: TeamMember | null; onClose: () => void }) {
  const t = useTranslations("firm");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(member);
  if (member && member !== shown) setShown(member);
  if (!shown) return null;
  const fire = async () => {
    setBusy(true);
    try {
      const r = await engine.fireEmployee(crypto.randomUUID(), shown.playerJobId);
      toast.success(t("fired"), t("firedText", { amount: formatMoney(r.severanceCents) }));
      await refresh();
      onClose();
    } catch (error) {
      toast.error(t("fire"), errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={member !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t("fireTitle", { name: shown.nickname })}
      footer={
        <HoldButton tone="loss" onConfirm={() => void fire()} disabled={busy} className="w-full">
          {t("fireConfirm")}
        </HoldButton>
      }
    >
      <p className="text-pretty text-fg-2">{t("fireText")}</p>
    </Sheet>
  );
}

// ------------------------------------------------------------------ concrete skills and trainings (ADR-062)

/** Searchable choice of up to four concrete skills. */
function SkillPicker({ value, onChange }: { value: string[]; onChange: (skills: string[]) => void }) {
  const t = useTranslations("firm");
  const tn = useTranslations("skills.nodes");
  const [query, setQuery] = useState("");
  const name = (key: string) => tn(`${key}.name` as Parameters<typeof tn>[0]);
  const q = query.trim().toLowerCase();
  const matches = q
    ? SKILL_NODES.filter((n) => !value.includes(n.key) && name(n.key).toLowerCase().includes(q)).slice(0, 6)
    : [];
  return (
    <div>
      <p className="label-pixel text-fg-2">{t("postingConcrete")}</p>
      <p className="mb-2 text-xs text-fg-3">{t("postingConcreteHint")}</p>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((key) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => onChange(value.filter((k) => k !== key))}
                className="rounded-xs border border-accent bg-accent-soft px-2 py-1 text-xs text-fg-1 focus-ring"
              >
                {name(key)} ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length < 4 && (
        <>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("postingSearch")}
            aria-label={t("postingSearch")}
            className="h-10 w-full rounded-md border border-line-2 bg-surface-2 px-3 text-sm text-fg-1 focus-ring placeholder:text-fg-3"
          />
          {matches.length > 0 && (
            <ul className="mt-1 divide-y divide-line-1 rounded-md border border-line-1">
              {matches.map((n) => (
                <li key={n.key}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange([...value, n.key]);
                      setQuery("");
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-fg-1 focus-ring hover:bg-surface-2"
                  >
                    {name(n.key)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function TrainSheet({
  company,
  member,
  onClose,
}: {
  company: MyCompany;
  member: TeamMember | null;
  onClose: () => void;
}) {
  const t = useTranslations("firm");
  const tn = useTranslations("skills.nodes");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const [shown, setShown] = useState(member);
  const [skill, setSkill] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (member && member !== shown) {
    setShown(member);
    setSkill(null);
  }
  if (!shown) return null;
  const name = (key: string) => tn(`${key}.name` as Parameters<typeof tn>[0]);
  const knows = new Set(shown.skills);
  const needed = company.stages
    .flatMap((st) => st.skills)
    .filter((s) => !s.coveredBy && !knows.has(s.key))
    .map((s) => s.key);
  const others = (BALANCE.jobs.sectorBranches[company.sector] ?? [])
    .flatMap((b) => SKILL_NODES.filter((n) => n.branches[0] === b && n.tier <= 3))
    .map((n) => n.key)
    .filter((k) => !knows.has(k) && !needed.includes(k))
    .slice(0, 10);
  const node = skill ? SKILL_NODES.find((n) => n.key === skill) : undefined;
  const price = node ? trainingFor(node.tier) : null;

  const train = async () => {
    if (!skill) return;
    setBusy(true);
    try {
      const r = await engine.trainEmployee(crypto.randomUUID(), shown.playerJobId, skill);
      void playSound("levelUp", 0.6);
      toast.success(t("trained"), t("trainedText", { amount: formatMoney(r.salaryCentsPerHour) }));
      await refresh();
      onClose();
    } catch (error) {
      toast.error(t("train"), errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const option = (key: string) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={skill === key}
      onClick={() => setSkill(key)}
      className={cn(
        "rounded-sm border px-2.5 py-1.5 text-left text-xs focus-ring transition-colors duration-fast",
        skill === key ? "border-accent bg-accent-soft text-fg-1" : "border-line-1 text-fg-2 hover:bg-surface-2",
      )}
    >
      {name(key)}
    </button>
  );

  return (
    <Sheet
      open={member !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t("trainTitle", { name: shown.nickname })}
      footer={
        <HoldButton tone="accent" onConfirm={() => void train()} disabled={!skill || busy} className="w-full">
          {t("trainConfirm")}
        </HoldButton>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-pretty text-fg-2">{t("trainIntro")}</p>
        {needed.length > 0 && (
          <div>
            <p className="mb-1.5 label-pixel text-accent">{t("trainNeeded")}</p>
            <div role="radiogroup" className="flex flex-wrap gap-1.5">
              {needed.map(option)}
            </div>
          </div>
        )}
        {others.length > 0 && (
          <div>
            <p className="mb-1.5 label-pixel text-fg-3">{t("trainOther")}</p>
            <div role="radiogroup" className="flex flex-wrap gap-1.5">
              {others.map(option)}
            </div>
          </div>
        )}
        {price && (
          <p className="rounded-md bg-surface-2 px-3 py-2 nums text-sm text-fg-1">
            {t("trainCost", {
              amount: formatMoney(price.costCents, { whole: true }),
              percent: formatBps(price.raiseBps).replace("+", ""),
            })}
          </p>
        )}
      </div>
    </Sheet>
  );
}
