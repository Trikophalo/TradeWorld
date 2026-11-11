"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { burstConfetti } from "@/components/ui/effects";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { LockBadge } from "@/components/ui/lock-badge";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import type { SkillBranch } from "@/config/skills";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame, usePlayerLevel } from "@/features/game/store";
import type { JobApplication, JobPosting, JobRequirementInfo } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING, fadeUp, staggerContainer } from "@/lib/motion";
import { unlockLevel } from "@/lib/sim/progression";
import { fitPercent } from "@/lib/sim/skills";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useApplications, useCareerRefresh, useJobBoard, useMyJob, useSkills } from "../hooks";
import { useJobTitle } from "./job-title";
import { EmployerLogo } from "./my-job-card";
import { MIN_INK, SignaturePad } from "./signature-pad";

type BranchKey = Parameters<ReturnType<typeof useTranslations<"skills.branches">>>[0];
type Tab = "postings" | "applications";
type Filter = "all" | "fit";

const OPEN: readonly JobApplication["status"][] = ["pending", "offered"];
const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const hours = BALANCE.careers.paidHoursPerDayCap;

/** Job portal (ADR-051): postings, applications, offers and the contract. */
export function JobPortal() {
  const t = useTranslations("jobs");
  const tc = useTranslations("career");
  const level = usePlayerLevel();
  const applications = useApplications();
  const [tab, setTab] = useState<Tab>("postings");
  const [applyTo, setApplyTo] = useState<JobPosting | null>(null);
  const [contract, setContract] = useState<JobApplication | null>(null);
  const [counter, setCounter] = useState<JobApplication | null>(null);
  const firstJob = unlockLevel("first_job") ?? 2;
  const openCount = applications.data?.filter((a) => OPEN.includes(a.status)).length ?? 0;
  const offers = applications.data?.filter((a) => a.status === "offered").length ?? 0;

  if (level < firstJob) {
    return (
      <EmptyState
        art={<PixelIcon {...UI_ICONS.lock} scale={4} />}
        title={t("title")}
        description={tc("noJobLocked")}
        action={<LockBadge level={firstJob} />}
      />
    );
  }

  const openApplication = (id: string) => {
    const application = applications.data?.find((a) => a.id === id);
    if (application?.status === "offered") setContract(application);
    else setTab("applications");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Tab>
          value={tab}
          onValueChange={setTab}
          label={t("title")}
          options={[
            { value: "postings", label: t("tabPostings") },
            {
              value: "applications",
              label: t("tabApplications"),
              adornment:
                offers > 0 ? (
                  <span className="rounded-pill bg-accent px-1.5 nums text-2xs text-on-accent">{offers}</span>
                ) : undefined,
            },
          ]}
        />
        <span className="nums text-xs text-fg-3">
          {t("openCount", { count: openCount, max: BALANCE.jobs.maxOpenApplications })}
        </span>
      </div>

      {tab === "postings" ? (
        <Postings onApply={setApplyTo} onOpenApplication={openApplication} />
      ) : (
        <Applications onContract={setContract} onCounter={setCounter} />
      )}

      <ApplySheet posting={applyTo} onClose={() => setApplyTo(null)} onApplied={() => setTab("applications")} />
      <CounterSheet application={counter} onClose={() => setCounter(null)} />
      <ContractSheet application={contract} onClose={() => setContract(null)} />
    </div>
  );
}

// ------------------------------------------------------------------ postings

function Postings({
  onApply,
  onOpenApplication,
}: {
  onApply: (p: JobPosting) => void;
  onOpenApplication: (id: string) => void;
}) {
  const t = useTranslations("jobs");
  const board = useJobBoard();
  const [filter, setFilter] = useState<Filter>("all");
  const postings = useMemo(() => {
    const list = [...(board.data?.postings ?? [])].sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        a.minLevel - b.minLevel ||
        b.salaryCentsPerHour - a.salaryCentsPerHour,
    );
    return filter === "fit" ? list.filter((p) => p.eligible) : list;
  }, [board.data, filter]);

  if (!board.data) {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-44 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Segmented<Filter>
        value={filter}
        onValueChange={setFilter}
        label={t("filterBranch")}
        size="sm"
        options={[
          { value: "all", label: t("filterAll") },
          { value: "fit", label: t("filterFit") },
        ]}
      />
      {postings.length === 0 ? (
        <EmptyState
          art={<PixelIcon {...UI_ICONS.briefcase} scale={4} />}
          title={t("empty")}
          description={t("emptyFit")}
        />
      ) : (
        <motion.ul variants={staggerContainer} initial="hidden" animate="visible" className="grid gap-3 lg:grid-cols-2">
          {postings.map((posting) => (
            <motion.li key={posting.id} variants={fadeUp} className="min-w-0">
              <PostingCard posting={posting} onApply={() => onApply(posting)} onOpenApplication={onOpenApplication} />
            </motion.li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}

function Requirements({
  required,
  requiredSkills = [],
}: {
  required: readonly JobRequirementInfo[];
  requiredSkills?: readonly string[];
}) {
  const t = useTranslations("jobs");
  const tb = useTranslations("skills.branches");
  const tn = useTranslations("skills.nodes");
  const skills = useSkills();
  const learned = new Set(skills.data?.learned.map((l) => l.key) ?? []);
  return (
    <ul className="flex flex-wrap gap-1.5">
      {requiredSkills.map((key) => (
        <li
          key={key}
          className={cn(
            "rounded-xs border px-1.5 py-0.5 text-xs",
            learned.has(key) ? "border-gain/50 bg-gain-soft text-gain" : "border-warn/50 text-warn",
          )}
          title={t("skillsRequired")}
        >
          {learned.has(key) ? "✓ " : ""}
          {tn(`${key}.name` as Parameters<typeof tn>[0])}
        </li>
      ))}
      {required.map((req) => {
        const met = (skills.data?.branchScores[req.branch] ?? 0) >= req.minScore;
        return (
          <li
            key={req.branch}
            className={cn(
              "rounded-xs px-1.5 py-0.5 text-xs",
              met ? "bg-gain-soft text-gain" : "bg-surface-3 text-fg-2",
            )}
          >
            {tb(`${req.branch as SkillBranch}.name` as `${BranchKey}`)} ·{" "}
            {req.minScore > 0 ? t("minScore", { score: req.minScore }) : t("anyScore")}
          </li>
        );
      })}
    </ul>
  );
}

function PostingCard({
  posting,
  onApply,
  onOpenApplication,
}: {
  posting: JobPosting;
  onApply: () => void;
  onOpenApplication: (id: string) => void;
}) {
  const t = useTranslations("jobs");
  const tc = useTranslations("careerTiers");
  const title = useJobTitle(posting);
  const level = usePlayerLevel();
  const skills = useSkills();
  const job = useMyJob();
  const fit = skills.data ? fitPercent(posting.required, skills.data.branchScores) : 0;
  const mine = posting.myApplication;
  const active = mine && (mine.status === "pending" || mine.status === "offered");
  const isMyJob = mine?.status === "signed" && job.data !== null;

  return (
    <Card padding="md" className="flex h-full flex-col gap-3" data-posting={posting.id}>
      <div className="flex items-start gap-3">
        <EmployerLogo job={posting} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-fg-1">{title}</p>
          <p className="truncate text-sm text-fg-2">{posting.company.name}</p>
        </div>
        <Badge tone={posting.company.isAi ? "neutral" : "accent"}>{tc(posting.tier)}</Badge>
      </div>
      <Requirements required={posting.required} requiredSkills={posting.requiredSkills} />
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="nums font-semibold text-fg-1">{formatMoney(posting.salaryCentsPerHour)}/Std.</p>
          <p className="text-xs text-fg-3">
            {posting.company.isAi && posting.maxSalaryCentsPerHour !== null
              ? t("aiHint", { amount: formatMoney(posting.maxSalaryCentsPerHour) })
              : t("playerEmployer")}
          </p>
        </div>
        {fit > 0 && (
          <span className={cn("nums text-xs", fit >= 100 ? "text-gain" : "text-fg-3")}>
            {t("fit", { percent: `${Math.min(fit, 100)} %` })}
          </span>
        )}
      </div>
      <div className="mt-auto">
        {isMyJob ? (
          <Badge tone="gain">{t("employed")}</Badge>
        ) : active ? (
          <Button
            block
            variant={mine.status === "offered" ? "primary" : "secondary"}
            onClick={() => onOpenApplication(mine.id)}
          >
            {mine.status === "offered" ? t("offerReady") : t("applied")}
          </Button>
        ) : level < posting.minLevel ? (
          <div className="flex h-11 items-center justify-center rounded-md bg-surface-2">
            <LockBadge level={posting.minLevel} />
          </div>
        ) : !posting.eligible ? (
          <Button block variant="secondary" disabled>
            {t("skillsNeeded")}
          </Button>
        ) : (
          <Button block onClick={onApply}>
            {t("apply")}
          </Button>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ salary picker

/** Slider between half the posted wage and the most this employer pays (AI) or twice the posting (players). */
function WishPicker({
  base,
  max,
  value,
  onChange,
}: {
  base: number;
  max: number | null;
  value: number;
  onChange: (cents: number) => void;
}) {
  const t = useTranslations("jobs");
  const low = Math.round(base / 2);
  const high = max ?? base * 2;
  const share = high > low ? (value - low) / (high - low) : 1;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="label-pixel text-fg-2">{t("wish")}</span>
        <span className="nums text-lg font-semibold text-fg-1" data-testid="wish-value">
          {formatMoney(value)}/Std.
        </span>
      </div>
      <Slider
        value={share}
        onValueChange={(next) => onChange(Math.round((low + (high - low) * next) / 100) * 100)}
        label={t("wish")}
        marks={[(base - low) / Math.max(1, high - low)]}
        valueText={`${formatMoney(value)}`}
      />
      <div className="flex justify-between gap-3 text-xs text-fg-3">
        <span>{t("wishHint", { amount: formatMoney(base) })}</span>
        <span className="nums">{t("wishPerDay", { amount: formatMoney(value * hours, { whole: true }) })}</span>
      </div>
      {max !== null && <p className="text-xs text-pretty text-fg-3">{t("wishAiMax", { amount: formatMoney(max) })}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ apply

function ApplySheet({
  posting,
  onClose,
  onApplied,
}: {
  posting: JobPosting | null;
  onClose: () => void;
  onApplied: () => void;
}) {
  const t = useTranslations("jobs");
  const errorText = useGameErrorText();
  const refresh = useCareerRefresh();
  const [shown, setShown] = useState(posting);
  const [wish, setWish] = useState(0);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  if (posting && posting !== shown) {
    setShown(posting);
    setWish(posting.maxSalaryCentsPerHour ?? posting.salaryCentsPerHour);
    setMessage("");
    setState("idle");
  }
  const title = useJobTitle(shown ?? { titleKey: null, title: null });
  if (!shown) return null;
  const max = BALANCE.jobs.applicationMessageMaxLength;

  const send = async () => {
    setState("loading");
    try {
      const application = await engine.applyForJob({
        requestId: crypto.randomUUID(),
        postingId: shown.id,
        salaryWishCentsPerHour: wish,
        message: message.trim(),
      });
      setState("success");
      void playSound("success");
      toast.success(t("sent"), application.status === "offered" ? t("sentAi") : t("sentPlayer"), { silent: true });
      await refresh();
      onApplied();
      window.setTimeout(onClose, 400);
    } catch (error) {
      setState("idle");
      toast.error(t("applyTitle"), errorText(error));
    }
  };

  return (
    <Sheet
      open={posting !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("applyTitle")}
      description={`${title} · ${shown.company.name}`}
      footer={
        <Button block size="lg" state={state} onClick={() => void send()}>
          {t("send")}
        </Button>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-pretty text-fg-2">{t("applyIntro")}</p>
        {shown.company.isAi ? (
          // AI employers offer their maximum, there is nothing to wish for (ADR-064).
          <p className="rounded-md bg-gain-soft px-4 py-3 text-sm text-pretty text-fg-1" data-testid="ai-offer">
            {t("aiOffer", { amount: formatMoney(shown.maxSalaryCentsPerHour ?? shown.salaryCentsPerHour) })}
          </p>
        ) : (
          <WishPicker
            base={shown.salaryCentsPerHour}
            max={shown.maxSalaryCentsPerHour}
            value={wish}
            onChange={setWish}
          />
        )}
        <Field
          label={t("message")}
          value={message}
          maxLength={max}
          placeholder={t("messagePlaceholder")}
          onChange={(event) => setMessage(event.target.value)}
          hint={<span className="nums">{t("messageCount", { count: message.length, max })}</span>}
        />
      </div>
    </Sheet>
  );
}

function CounterSheet({ application, onClose }: { application: JobApplication | null; onClose: () => void }) {
  const t = useTranslations("jobs");
  const errorText = useGameErrorText();
  const refresh = useCareerRefresh();
  const board = useJobBoard();
  const [shown, setShown] = useState(application);
  const [wish, setWish] = useState(0);
  const [state, setState] = useState<ButtonState>("idle");
  if (application && application !== shown) {
    setShown(application);
    setWish(application.salaryWishCentsPerHour);
    setState("idle");
  }
  if (!shown) return null;
  const posting = board.data?.postings.find((p) => p.id === shown.posting.id);
  const base = posting?.salaryCentsPerHour ?? shown.salaryWishCentsPerHour;

  const send = async () => {
    setState("loading");
    try {
      await engine.counterOffer(crypto.randomUUID(), shown.id, wish);
      setState("success");
      void playSound("success");
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
      onOpenChange={(open) => !open && onClose()}
      title={t("counterTitle")}
      footer={
        <Button block size="lg" state={state} onClick={() => void send()}>
          {t("counterSend")}
        </Button>
      }
    >
      <WishPicker base={base} max={posting?.maxSalaryCentsPerHour ?? null} value={wish} onChange={setWish} />
    </Sheet>
  );
}

// ------------------------------------------------------------------ applications

function Applications({
  onContract,
  onCounter,
}: {
  onContract: (a: JobApplication) => void;
  onCounter: (a: JobApplication) => void;
}) {
  const t = useTranslations("jobs");
  const applications = useApplications();
  if (!applications.data) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (applications.data.length === 0) {
    return (
      <EmptyState
        art={<PixelIcon {...UI_ICONS.briefcase} scale={4} />}
        title={t("tabApplications")}
        description={t("applicationsEmpty")}
      />
    );
  }
  return (
    <ul className="space-y-3">
      <AnimatePresence initial={false}>
        {applications.data.map((application) => (
          <motion.li key={application.id} layout transition={SPRING.smooth}>
            <ApplicationRow application={application} onContract={onContract} onCounter={onCounter} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
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

function ApplicationRow({
  application,
  onContract,
  onCounter,
}: {
  application: JobApplication;
  onContract: (a: JobApplication) => void;
  onCounter: (a: JobApplication) => void;
}) {
  const t = useTranslations("jobs");
  const errorText = useGameErrorText();
  const refresh = useCareerRefresh();
  const title = useJobTitle(application.posting);
  const [busy, setBusy] = useState(false);
  const offered = application.status === "offered";

  const withdraw = async () => {
    setBusy(true);
    try {
      await engine.withdrawApplication(crypto.randomUUID(), application.id);
      await refresh();
    } catch (error) {
      toast.error(t("withdraw"), errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="md" className={cn(offered && "ring-1 ring-accent")} data-application={application.status}>
      <div className="flex items-start gap-3">
        <EmployerLogo job={application.posting} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-fg-1">{title}</p>
          <p className="truncate text-sm text-fg-2">{application.posting.company.name}</p>
        </div>
        <Badge tone={STATUS_TONE[application.status]}>{t(`status.${application.status}`)}</Badge>
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div>
          <dt className="inline text-fg-3">{t("yourWish")}: </dt>
          <dd className="inline nums text-fg-1">{formatMoney(application.salaryWishCentsPerHour)}/Std.</dd>
        </div>
        {application.offerSalaryCentsPerHour !== null && (
          <div>
            <dt className="inline text-fg-3">{t("offer")}: </dt>
            <dd className="inline nums font-semibold text-gain">
              {formatMoney(application.offerSalaryCentsPerHour)}/Std.
            </dd>
          </div>
        )}
        {offered && application.offerExpiresAt && (
          <div className="text-xs text-fg-3">
            {t("offerExpires", { date: date.format(new Date(application.offerExpiresAt)) })}
          </div>
        )}
      </dl>
      {application.status === "pending" && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="ghost" state={busy ? "loading" : "idle"} onClick={() => void withdraw()}>
            {t("withdraw")}
          </Button>
        </div>
      )}
      {offered && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void withdraw()}>
            {t("decline")}
          </Button>
          {!application.posting.company.isAi && (
            <Button size="sm" variant="secondary" onClick={() => onCounter(application)}>
              {t("counter")}
            </Button>
          )}
          <Button size="sm" onClick={() => onContract(application)}>
            {t("toContract")}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ contract

function ContractSheet({ application, onClose }: { application: JobApplication | null; onClose: () => void }) {
  const t = useTranslations("jobs");
  const tc = useTranslations("careerTiers");
  const errorText = useGameErrorText();
  const refresh = useCareerRefresh();
  const router = useRouter();
  const nickname = useGame((state) => state.portfolio?.nickname ?? "");
  const job = useMyJob();
  const [shown, setShown] = useState(application);
  const [signature, setSignature] = useState({ path: "", ink: 0 });
  const [state, setState] = useState<ButtonState>("idle");
  const anchor = useRef<HTMLDivElement>(null);
  if (application && application !== shown) {
    setShown(application);
    setSignature({ path: "", ink: 0 });
    setState("idle");
  }
  const title = useJobTitle(shown?.posting ?? { titleKey: null, title: null });
  if (!shown) return null;
  const salary = shown.offerSalaryCentsPerHour ?? shown.salaryWishCentsPerHour;
  const hasJob = Boolean(job.data);

  const sign = async () => {
    setState("loading");
    try {
      await engine.signContract(crypto.randomUUID(), shown.id, signature.path);
      setState("success");
      void playSound("levelUp");
      haptic("success");
      if (anchor.current) burstConfetti(anchor.current, 36);
      toast.success(t("signedTitle"), t("signedText", { company: shown.posting.company.name }), { silent: true });
      await refresh();
      window.setTimeout(() => {
        onClose();
        router.push("/job");
      }, 900);
    } catch (error) {
      setState("idle");
      toast.error(t("contractTitle"), errorText(error));
    }
  };

  const rows: [string, string][] = [
    [t("contractRole"), `${title} (${tc(shown.posting.tier)})`],
    [t("contractSalary"), `${formatMoney(salary)}/Std.`],
    [t("contractHours"), t("contractHoursValue", { hours })],
    [t("contractQuit"), t("contractQuitValue", { amount: formatMoney(salary * BALANCE.jobs.salaryUnitHours) })],
    [t("contractFire"), t("contractFireValue")],
  ];

  return (
    <Sheet
      open={application !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("contractTitle")}
      description={t("contractParties", { company: shown.posting.company.name, name: nickname })}
      footer={
        <Button block size="lg" state={state} disabled={hasJob || signature.ink < MIN_INK} onClick={() => void sign()}>
          {t("sign")}
        </Button>
      }
    >
      <div ref={anchor} className="space-y-5">
        <dl className="divide-y divide-line-1 rounded-md border border-line-1">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-sm text-fg-3">{label}</dt>
              <dd className="text-sm text-fg-1 sm:text-right">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-fg-3">{t("contractNote")}</p>
        {hasJob ? (
          <p className="rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">{t("hasJobHint")}</p>
        ) : (
          <SignaturePad onChange={(path, ink) => setSignature({ path, ink })} />
        )}
      </div>
    </Sheet>
  );
}
