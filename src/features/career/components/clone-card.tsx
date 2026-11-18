"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, type ButtonState } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { LockBadge } from "@/components/ui/lock-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { CloneState } from "@/features/game/types";
import { Reveal } from "@/features/progression/components/reveal";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { useCareerRefresh, useClone } from "../hooks";
import { ActiveJob } from "./my-job-card";
import { PixelWorker } from "./pixel-worker";

/** The clone (ADR-206) on the job tab: shown from the disclosure level, usable from jobs.clone.minLevel. */
export function CloneSection() {
  const clone = useClone();
  return (
    <Reveal feature="jobClone">
      {clone.data ? <CloneCard state={clone.data} /> : <Skeleton className="h-48 w-full rounded-lg" />}
    </Reveal>
  );
}

/** Create the clone, find it a job, or show the clone's job with the same controls as the own one. */
export function CloneCard({ state }: { state: CloneState }) {
  const t = useTranslations("jobTab.clone");
  const errorText = useGameErrorText();
  const refresh = useCareerRefresh();
  const avatarKey = useGame((s) => s.portfolio?.avatarKey ?? null);
  const [busy, setBusy] = useState<ButtonState>("idle");
  const locked = state.level < state.minLevel;

  if (state.clone && state.job) {
    return (
      <div className="space-y-3" data-testid="clone-job">
        <p className="label-pixel text-fg-3">{t("jobOf")}</p>
        <ActiveJob job={state.job} />
      </div>
    );
  }

  const create = async () => {
    setBusy("loading");
    try {
      await engine.createClone(crypto.randomUUID());
      setBusy("success");
      void playSound("levelUp");
      haptic("success");
      toast.success(t("created"), t("createdText"), { silent: true });
      await refresh();
    } catch (error) {
      setBusy("idle");
      toast.error(t("title"), errorText(error));
    }
  };

  return (
    <Card padding="lg" data-testid="clone-card" data-clone={state.clone ? "idle" : "none"}>
      <div className="flex items-start gap-4">
        <div className="grid size-16 shrink-0 place-items-end overflow-hidden rounded-lg bg-surface-2 opacity-80">
          <PixelWorker avatarKey={avatarKey} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-pixel text-sm text-fg-1 uppercase">{state.clone ? state.clone.name : t("title")}</h2>
            {locked && !state.clone && <LockBadge level={state.minLevel} />}
          </div>
          <p className="mt-1.5 text-sm text-pretty text-fg-2">
            {state.clone ? t("noJob") : t("pitch", { hours: BALANCE.careers.paidHoursPerDayCap })}
          </p>
          {!state.clone && <p className="mt-1 text-xs text-pretty text-fg-3">{t("rules")}</p>}
        </div>
      </div>
      {/* the action spans the whole card, so long labels never leave it on narrow columns */}
      <div className="mt-4">
        {state.clone ? (
          <Link
            href="/career/jobs?holder=clone"
            transitionTypes={["nav-forward"]}
            className={buttonVariants({ block: true })}
            data-testid="clone-portal"
          >
            {t("toPortal")}
          </Link>
        ) : locked ? (
          <p className="text-xs text-fg-3">{t("lockedHint", { level: state.minLevel })}</p>
        ) : (
          <div className="space-y-1.5">
            <Button block state={busy} onClick={() => void create()} data-testid="clone-create">
              {t("create")}
            </Button>
            <p className="text-center nums text-xs text-fg-3">
              {t("fee", { amount: formatMoney(state.feeCents, { whole: true }) })}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
