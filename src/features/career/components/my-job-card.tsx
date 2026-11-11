"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { HoldButton } from "@/components/ui/hold-button";
import { LockBadge } from "@/components/ui/lock-badge";
import { Progress } from "@/components/ui/progress";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { engine, usePlayerLevel } from "@/features/game/store";
import type { MyJob } from "@/features/game/types";
import { CompanyLogo } from "@/features/market/components/company-logo";
import { brandColor } from "@/features/market/brand";
import { unlockLevel } from "@/lib/sim/progression";
import { formatBps, formatMoney } from "@/lib/format";
import { playSound } from "@/lib/sound";
import { useClock } from "@/lib/use-now";
import { useCareerRefresh, useMyJob } from "../hooks";
import { useJobTitle } from "./job-title";

const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short" });
const noticeDate = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});
const factor = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function EmployerLogo({ job, scale = 2 }: { job: Pick<MyJob, "company">; scale?: 2 | 3 | 4 }) {
  const ticker = job.company.ticker ?? job.company.name.slice(0, 3).toUpperCase();
  return (
    <CompanyLogo
      ticker={ticker}
      color={job.company.color ?? brandColor(ticker)}
      scale={scale}
      logo={job.company.logo}
    />
  );
}

/** The current job with pay, productivity, today's hours, raise and quitting (ADR-051). */
export function MyJobCard() {
  const t = useTranslations("career");
  const level = usePlayerLevel();
  const job = useMyJob();
  const firstJobLevel = unlockLevel("first_job") ?? 2;

  if (job.isPending) return <Skeleton className="h-56 w-full rounded-lg" />;

  if (!job.data) {
    const locked = level < firstJobLevel;
    return (
      <Card padding="lg" data-tour="job-card">
        <div className="flex items-start gap-4">
          <div className="grid size-14 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-2">
            <PixelIcon {...UI_ICONS.briefcase} scale={3} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-pixel text-sm text-fg-1 uppercase">{t("noJobTitle")}</h2>
              {locked && <LockBadge level={firstJobLevel} />}
            </div>
            <p className="mt-1.5 text-sm text-pretty text-fg-2">{locked ? t("noJobLocked") : t("noJobText")}</p>
            {!locked && (
              <Link
                href="/career/jobs"
                transitionTypes={["nav-forward"]}
                className={buttonVariants({ className: "mt-4" })}
              >
                {t("toPortal")}
              </Link>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return <ActiveJob job={job.data} />;
}

export function ActiveJob({ job }: { job: MyJob }) {
  const t = useTranslations("career");
  const tc = useTranslations("careerTiers");
  const title = useJobTitle(job);
  const [quitting, setQuitting] = useState(false);
  const cap = job.paidHoursCap;
  const productivity = job.productivityBps / 10_000;

  return (
    <Card padding="lg" data-tour="job-card">
      <div className="flex items-start gap-4">
        <EmployerLogo job={job} scale={3} />
        <div className="min-w-0 flex-1">
          <p className="label-pixel text-fg-3">{t("jobCardTitle")}</p>
          <h2 className="mt-0.5 truncate text-lg font-semibold text-fg-1">{title}</h2>
          <p className="truncate text-sm text-fg-2">
            {job.company.name} · {tc(job.tier)} · {t("since", { date: date.format(new Date(job.startedAt)) })}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-md bg-surface-2 px-3 py-2.5">
          <dt className="label-pixel text-fg-3">{t("salary")}</dt>
          <dd className="mt-1 nums font-semibold text-fg-1">
            {t("perHour", { amount: formatMoney(job.effectiveSalaryCentsPerHour) })}
          </dd>
          <dd className="nums text-xs text-fg-3">
            {t("perDay", { amount: formatMoney(job.effectiveSalaryCentsPerHour * cap, { whole: true }) })}
          </dd>
          {job.payFactorBps !== 10_000 && (
            <dd className="mt-0.5 nums text-xs text-warn">{t("payFactor", { value: formatBps(job.payFactorBps) })}</dd>
          )}
        </div>
        <div className="rounded-md bg-surface-2 px-3 py-2.5" title={t("productivityHint")}>
          <dt className="label-pixel text-fg-3">{t("productivity")}</dt>
          <dd className="mt-1 nums font-semibold text-gain">
            {t("productivityValue", { value: factor.format(productivity) })}
          </dd>
          <dd className="text-xs text-pretty text-fg-3">{t("productivityHint")}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-sm">
          <span className="text-fg-2">{t("hoursToday")}</span>
          <span className="nums text-fg-2">{t("hoursValue", { hours: factor.format(job.paidHoursToday), cap })}</span>
        </div>
        <Progress value={job.paidHoursToday / cap} label={t("hoursToday")} tone="gain" />
        <p className="mt-2 nums text-xs text-fg-3">
          {t("earnedTotal")}: {formatMoney(job.earnedTotalCents)}
        </p>
        {job.lastBonusCents > 0 && (
          <p className="mt-1 nums text-xs text-gain">{t("lastBonus", { amount: formatMoney(job.lastBonusCents) })}</p>
        )}
      </div>

      <RaiseBox job={job} />

      {job.noticeEndsAt && <NoticeBox noticeEndsAt={job.noticeEndsAt} />}
      <div className="mt-4 flex justify-end">
        <Button variant="danger" size="sm" onClick={() => setQuitting(true)}>
          {job.noticeEndsAt ? t("quitNowTitle") : t("quit")}
        </Button>
      </div>
      <QuitSheet job={job} open={quitting} onOpenChange={setQuitting} />
    </Card>
  );
}

function RaiseBox({ job }: { job: MyJob }) {
  const t = useTranslations("career");
  const errorText = useGameErrorText();
  const refresh = useCareerRefresh();
  const now = useClock();
  const [state, setState] = useState<ButtonState>("idle");
  const waiting = job.raiseAvailableAt !== null && now !== null && Date.parse(job.raiseAvailableAt) > now;

  const ask = async () => {
    setState("loading");
    try {
      const result = await engine.requestRaise(crypto.randomUUID(), job.raiseMaxBps);
      setState("success");
      void playSound("win");
      if (result.status === "accepted") {
        toast.success(t("raiseAccepted"), t("raiseAcceptedText", { amount: formatMoney(result.salaryCentsPerHour) }), {
          silent: true,
        });
      } else {
        toast.success(t("raisePending"));
      }
      await refresh();
      setState("idle");
    } catch (error) {
      setState("idle");
      toast.error(t("raise"), errorText(error));
    }
  };

  return (
    <div className="mt-4 rounded-md border border-line-1 px-3 py-3">
      <p className="text-sm font-medium text-fg-1">{t("raise")}</p>
      {waiting ? (
        <p className="mt-1 text-sm text-fg-3">
          {t("raiseSoon", { date: date.format(new Date(job.raiseAvailableAt!)) })}
        </p>
      ) : job.raiseMaxBps > 0 ? (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-pretty text-fg-2">{t("raiseHint", { percent: formatBps(job.raiseMaxBps) })}</p>
          <Button size="sm" state={state} onClick={() => void ask()}>
            {t("raiseAsk", { percent: formatBps(job.raiseMaxBps) })}
          </Button>
        </div>
      ) : (
        <p className="mt-1 text-sm text-pretty text-fg-3">{t("raiseNone")}</p>
      )}
    </div>
  );
}

/** Running notice (ADR-063): countdown to the last day, can be taken back. */
function NoticeBox({ noticeEndsAt }: { noticeEndsAt: string }) {
  const t = useTranslations("jobTab");
  const errorText = useGameErrorText();
  const refresh = useCareerRefresh();
  const [state, setState] = useState<ButtonState>("idle");
  const cancel = async () => {
    setState("loading");
    try {
      await engine.cancelQuit(crypto.randomUUID());
      toast.success(t("noticeCancelled"), undefined, { silent: true });
      await refresh();
    } catch (error) {
      toast.error(t("cancelNotice"), errorText(error));
    } finally {
      setState("idle");
    }
  };
  return (
    <div className="mt-4 rounded-md bg-warn-soft px-3 py-3" data-testid="notice">
      <p className="text-sm text-warn">
        {t("notice")} <Countdown target={Date.parse(noticeEndsAt)} className="nums font-semibold" />
      </p>
      <p className="mt-0.5 text-xs text-pretty text-fg-2">{t("noticeHint")}</p>
      <Button size="sm" variant="secondary" className="mt-2" state={state} onClick={() => void cancel()}>
        {t("cancelNotice")}
      </Button>
    </div>
  );
}

function QuitSheet({ job, open, onOpenChange }: { job: MyJob; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("career");
  const errorText = useGameErrorText();
  const refresh = useCareerRefresh();
  const [busy, setBusy] = useState(false);

  const quit = async (immediate: boolean) => {
    setBusy(true);
    try {
      const result = await engine.quitJob(crypto.randomUUID(), immediate);
      if (result.ended) {
        toast.success(t("quitDone"), t("quitNowDoneText", { amount: formatMoney(result.paidCents) }));
      } else if (result.noticeEndsAt) {
        toast.success(t("quitDone"), t("quitDoneText", { date: noticeDate.format(new Date(result.noticeEndsAt)) }));
      }
      onOpenChange(false);
      await refresh();
    } catch (error) {
      toast.error(t("quit"), errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("quitTitle")}
      footer={
        <Button block variant="ghost" onClick={() => onOpenChange(false)}>
          {t("cancel")}
        </Button>
      }
    >
      <div className="space-y-4" data-job={job.id}>
        {!job.noticeEndsAt && (
          <div className="space-y-2 rounded-md border border-line-1 p-3">
            <p className="font-medium text-fg-1">{t("quitNoticeTitle")}</p>
            <p className="text-sm text-pretty text-fg-2">{t("quitText")}</p>
            <HoldButton tone="loss" onConfirm={() => void quit(false)} disabled={busy} className="w-full">
              {t("quitConfirm")}
            </HoldButton>
          </div>
        )}
        <div className="space-y-2 rounded-md border border-line-1 p-3">
          <p className="font-medium text-fg-1">{t("quitNowTitle")}</p>
          <p className="text-sm text-pretty text-fg-2">
            {t("quitNowText", { amount: formatMoney(job.quitNowCostCents) })}
          </p>
          <HoldButton tone="loss" onConfirm={() => void quit(true)} disabled={busy} className="w-full">
            {t("quitNowConfirm")}
          </HoldButton>
        </div>
      </div>
    </Sheet>
  );
}
