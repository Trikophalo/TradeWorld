"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { useJobTitle } from "@/features/career/components/job-title";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { CareerTier, CompanyApplication, JobRequirementInfo, MyCompany, TeamMember } from "@/features/game/types";
import { formatBps, formatMoney } from "@/lib/format";
import { fitPercent } from "@/lib/sim/skills";
import { trainingFor } from "@/lib/sim/startup";
import { isDemoMode } from "@/lib/supabase/env";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useCompanyApplications, useCompanyPostings, useCompanyRefresh, useCompanyTeam } from "../hooks";

type BranchKey = Parameters<ReturnType<typeof useTranslations<"skills.branches">>>[0];
const TIERS = BALANCE.careers.tiers.map((t) => t.id) as CareerTier[];
const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short" });
const factor = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const baseWage = (tier: CareerTier): number =>
  BALANCE.careers.tiers.find((t) => t.id === tier)?.salaryCentsPerHour ?? 15_000;

// ------------------------------------------------------------------ postings

export function Postings({ company, prefillSkills }: { company: MyCompany; prefillSkills?: string[] }) {
  const t = useTranslations("firm");
  const tc = useTranslations("careerTiers");
  const tb = useTranslations("skills.branches");
  const tn = useTranslations("skills.nodes");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const postings = useCompanyPostings(true);
  // Coming from the growth card: open the form with the missing skills.
  const [creating, setCreating] = useState(Boolean(prefillSkills?.length));

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
      <Button onClick={() => setCreating(true)}>{t("newPosting")}</Button>
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
      <CreatePostingSheet
        company={company}
        open={creating}
        initialSkills={prefillSkills}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}

function CreatePostingSheet({
  company,
  open,
  initialSkills,
  onClose,
}: {
  company: MyCompany;
  open: boolean;
  initialSkills?: string[];
  onClose: () => void;
}) {
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
  const [state, setState] = useState<ButtonState>("idle");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setState("idle");
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

  const low = Math.round(baseWage(tier) / 2);
  const high = baseWage(tier) * 3;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("newPosting")}
      footer={
        <Button
          block
          size="lg"
          state={state}
          disabled={title.trim().length < 3 || required.length === 0}
          onClick={() => void create()}
        >
          {t("postingCreate")}
        </Button>
      }
    >
      <div className="space-y-5">
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
                  tier === id ? "border-accent bg-accent-soft text-fg-1" : "border-line-1 text-fg-2 hover:bg-surface-2",
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
      </div>
    </Sheet>
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
      {pending && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void respond("reject")}>
            {t("reject")}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={onCounter}>
            {t("counter")}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void respond("accept")}>
            {t("accept")}
          </Button>
        </div>
      )}
    </Card>
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

export function Team({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const team = useCompanyTeam(company.id);
  const [firing, setFiring] = useState<TeamMember | null>(null);
  const [training, setTraining] = useState<TeamMember | null>(null);
  if (!team.data) return <Skeleton className="h-32 w-full rounded-lg" />;
  if (team.data.length === 0) {
    return (
      <EmptyState
        art={<PixelIcon {...UI_ICONS.profile} scale={4} />}
        title={t("tabTeam")}
        description={t("teamEmpty")}
      />
    );
  }
  return (
    <>
      <ul className="space-y-3">
        {team.data.map((m) => (
          <li key={m.playerJobId}>
            <MemberRow member={m} onFire={() => setFiring(m)} onTrain={() => setTraining(m)} />
          </li>
        ))}
      </ul>
      <FireSheet member={firing} onClose={() => setFiring(null)} />
      <TrainSheet company={company} member={training} onClose={() => setTraining(null)} />
    </>
  );
}

function MemberRow({ member, onFire, onTrain }: { member: TeamMember; onFire: () => void; onTrain: () => void }) {
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
    <Card padding="md">
      <div className="flex items-start gap-3">
        <Avatar avatarKey={member.avatarKey} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-fg-1">{member.nickname}</p>
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
        <div className="flex flex-col gap-2">
          <Button size="sm" onClick={onTrain}>
            {t("train")}
          </Button>
          <Button size="sm" variant="danger" onClick={onFire}>
            {t("fire")}
          </Button>
        </div>
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
