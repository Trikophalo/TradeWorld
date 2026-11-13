"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { BOOK, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useGame } from "@/features/game/store";
import type { DailyRewardState } from "@/features/game/types";
import { useUpgrades } from "@/features/upgrades/hooks";
import { formatInteger } from "@/lib/format";
import { xpForNextLevel } from "@/lib/sim/progression";
import { upgradeEffects } from "@/lib/sim/upgrades";
import { useDailyReward, useMyJob, useSkills } from "../hooks";

type BranchKey = Parameters<ReturnType<typeof useTranslations<"skills.branches">>>[0];

/** Days until the daily reward gives the next skill point (0 = today). */
export function daysToDailySkillPoint(daily: Pick<DailyRewardState, "day" | "claimable" | "cycle">): number | null {
  const n = daily.cycle.length;
  if (n === 0) return null;
  const first = daily.claimable ? daily.day : (daily.day % n) + 1;
  const offset = daily.claimable ? 0 : 1;
  for (let k = 0; k < n; k++) {
    const d = ((first - 1 + k) % n) + 1;
    if ((daily.cycle[d - 1]?.skillPoints ?? 0) > 0) return offset + k;
  }
  return null;
}

/**
 * "So bekommst du Skillpunkte" (ADR-095): every source of skill points with its live progress, and what skills
 * are good for.
 */
export function SkillPointGuide() {
  const t = useTranslations("skillGuide");
  const tb = useTranslations("skills.branches");
  const level = useGame((s) => s.portfolio?.level ?? 1);
  const xp = useGame((s) => s.portfolio?.xpIntoLevel ?? 0);
  const job = useMyJob().data ?? null;
  const skills = useSkills().data;
  const daily = useDailyReward(true).data;
  const upgrades = useUpgrades().data;
  const hours = upgradeEffects(upgrades?.levels ?? {}).workHoursPerBranchPoint;
  const needed = xpForNextLevel(level);
  const jobBranches = [...new Set(job?.required.map((r) => r.branch) ?? [])];
  const dailyIn = daily ? daysToDailySkillPoint(daily) : null;
  const benefits = t.raw("benefits.items") as string[];

  return (
    <section
      className="grid gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6"
      data-testid="skill-guide"
    >
      <Card padding="lg" className="space-y-4">
        <div>
          <h2 className="label-pixel text-fg-2">{t("title")}</h2>
          <p className="mt-1 text-sm text-pretty text-fg-3">{t("rule")}</p>
        </div>
        <ul className="space-y-4">
          <Source art={UI_ICONS.star} title={t("level.title")} text={t("level.text")} testId="source-level">
            <Progress value={needed > 0 ? xp / needed : 0} label={t("level.title")} size="sm" tone="accent" />
            <p className="mt-1 nums text-xs text-fg-3">
              {t("level.progress", { xp: formatInteger(Math.max(0, needed - xp)), level: level + 1 })}
            </p>
          </Source>

          <Source
            art={UI_ICONS.briefcase}
            title={t("work.title")}
            text={t("work.text", { hours })}
            testId="source-work"
          >
            {job && skills ? (
              <ul className="space-y-1.5">
                {jobBranches.map((b) => (
                  <li key={b}>
                    <div className="flex justify-between text-xs text-fg-3">
                      <span>{tb(`${b}.name` as BranchKey)}</span>
                      <span className="nums">{Math.round((skills.branchProgress[b] ?? 0) * 100)} %</span>
                    </div>
                    <Progress
                      value={skills.branchProgress[b] ?? 0}
                      label={tb(`${b}.name` as BranchKey)}
                      size="sm"
                      tone="gold"
                      className="mt-0.5"
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-pretty text-fg-3">
                {t("work.noJob")}{" "}
                <Link href="/career/jobs" className="text-accent focus-ring hover:underline">
                  {t("work.toJobs")}
                </Link>
              </p>
            )}
            <Link href="/upgrades" className="mt-1.5 inline-block text-xs text-accent focus-ring hover:underline">
              {t("work.faster")}
            </Link>
          </Source>

          <Source art={UI_ICONS.gift} title={t("daily.title")} text={t("daily.text")} testId="source-daily">
            {dailyIn !== null && (
              <p className={dailyIn === 0 ? "text-xs font-medium text-gain" : "text-xs text-fg-3"}>
                {dailyIn === 0 ? t("daily.today") : t("daily.inDays", { count: dailyIn })}
              </p>
            )}
          </Source>

          <Source art={UI_ICONS.flame} title={t("missions.title")} text={t("missions.text")} testId="source-missions" />
          <Source art={BOOK} title={t("training.title")} text={t("training.text")} testId="source-training" />
        </ul>
      </Card>

      <Card padding="lg" className="space-y-3">
        <h2 className="label-pixel text-fg-2">{t("benefits.title")}</h2>
        <ul className="space-y-2.5">
          {benefits.map((line) => (
            <li key={line} className="flex gap-2.5 text-sm text-pretty text-fg-2">
              <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-[2px] bg-accent" />
              {line}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function Source({
  art,
  title,
  text,
  testId,
  children,
}: {
  art: PixelArt;
  title: string;
  text: string;
  testId: string;
  children?: ReactNode;
}) {
  const scale = Math.max(1, Math.floor(24 / art.grid[0]!.length));
  return (
    <li className="flex gap-3" data-testid={testId}>
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-xs border-2 border-line-2 bg-surface-2 text-accent"
      >
        <PixelIcon {...art} scale={scale} />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div>
          <p className="text-sm font-medium text-fg-1">{title}</p>
          <p className="text-sm text-pretty text-fg-2">{text}</p>
        </div>
        {children}
      </div>
    </li>
  );
}
