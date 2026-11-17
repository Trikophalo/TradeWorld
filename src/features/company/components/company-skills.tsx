"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { useClockSkew } from "@/features/game/server-clock";
import { engine } from "@/features/game/store";
import type { CompanySkill, CompanySkillEffect, CompanySkillsState } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useCompanyRefresh } from "../hooks";

export const COMPANY_SKILLS_KEY = ["company", "skills"] as const;

/** Pixel icon of every Fertigkeit (ADR-194). */
export const COMPANY_SKILL_ICONS = {
  data_analysis: UI_ICONS.markets,
  automation: UI_ICONS.robot,
  cost_control: UI_ICONS.portfolio,
  contracts: UI_ICONS.deal,
  craftsmanship: UI_ICONS.upgrade,
  campaigns: UI_ICONS.news,
  leadership: UI_ICONS.profile,
  research: UI_ICONS.search,
  supply_chain: UI_ICONS.briefcase,
} as const;
const iconOf = (key: string) => COMPANY_SKILL_ICONS[key as keyof typeof COMPANY_SKILL_ICONS] ?? UI_ICONS.star;

type T = ReturnType<typeof useTranslations<"companySkills">>;
type Ts = ReturnType<typeof useTranslations<"skills">>;

export const companySkillName = (t: T, key: string) => t(`items.${key}.name` as Parameters<T>[0]);
const skillDesc = (t: T, key: string) => t(`items.${key}.desc` as Parameters<T>[0]);
const mapSkillName = (ts: Ts, key: string) => ts(`nodes.${key}.name` as Parameters<Ts>[0]).replaceAll("­", "");

/** "Nachfrage +3 %" from basis points (quality: points of 100). */
export function effectText(t: T, effect: CompanySkillEffect, bps: number): string {
  const pct = (bps / 100).toLocaleString("de-DE", { maximumFractionDigits: 1 });
  return t(`effects.${effect}`, { pct });
}

/** Link to the skill map, opened on one skill. */
export const skillMapHref = (skillKey: string) => `/career/skills?skill=${encodeURIComponent(skillKey)}`;

/**
 * Fertigkeiten of the own company (ADR-194): one row per Fertigkeit with icon, level, effect now and next, price
 * and training time. A locked level names the missing skill of the map and links there.
 */
export function CompanySkillsCard({ preview }: { preview?: CompanySkillsState } = {}) {
  const t = useTranslations("companySkills");
  const live = useQuery({
    queryKey: COMPANY_SKILLS_KEY,
    queryFn: () => engine.companySkills(),
    refetchInterval: 30_000,
    enabled: !preview,
  });
  const data = preview ?? live.data;

  return (
    <Card padding="lg" className="space-y-4" id="company-skills" data-testid="company-skills">
      <div>
        <p className="label-pixel text-fg-2">{t("title")}</p>
        <p className="mt-1 text-sm text-pretty text-fg-3">{t("intro")}</p>
      </div>
      {!data ? (
        live.isError ? (
          <EmptyState art={<PixelIcon {...UI_ICONS.lock} scale={4} />} title={t("title")} description={t("empty")} />
        ) : (
          <div className="space-y-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-md" />
            ))}
          </div>
        )
      ) : (
        <>
          <TotalStrip data={data} />
          <ul className="grid gap-2.5 *:min-w-0 lg:grid-cols-2">
            {data.skills.map((s) => (
              <SkillRow key={s.key} skill={s} cash={data.freeCashCents} preview={Boolean(preview)} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function TotalStrip({ data }: { data: CompanySkillsState }) {
  const t = useTranslations("companySkills");
  const kinds = (Object.keys(data.totalBps) as CompanySkillEffect[]).filter((k) => data.totalBps[k] > 0);
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2.5" data-testid="company-skills-total">
      <p className="text-2xs text-fg-3">{t("total")}</p>
      {kinds.length === 0 ? (
        <p className="mt-0.5 text-sm text-pretty text-fg-2">{t("totalNone")}</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {kinds.map((k) => (
            <li key={k}>
              <Badge tone="gain">
                <span className="nums">
                  {effectText(t, k, data.totalBps[k])} · {t("capLabel")} {effectText(t, k, data.capBps[k])}
                </span>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SkillRow({ skill, cash, preview }: { skill: CompanySkill; cash: number; preview: boolean }) {
  const t = useTranslations("companySkills");
  const ts = useTranslations("skills");
  const skew = useClockSkew();
  const client = useQueryClient();
  const refresh = useCompanyRefresh();
  const errorText = useGameErrorText();
  const [state, setState] = useState<ButtonState>("idle");
  const name = companySkillName(t, skill.key);
  const maxed = skill.level >= skill.maxLevel;
  const training = skill.trainingUntil !== null;
  const noCash = skill.nextCostCents !== null && cash < skill.nextCostCents;
  const blocked = maxed || training || skill.missing !== null || noCash || preview;

  const learn = async () => {
    setState("loading");
    try {
      const next = await engine.learnCompanySkill(crypto.randomUUID(), skill.key);
      client.setQueryData(COMPANY_SKILLS_KEY, next);
      haptic("success");
      void playSound("success");
      toast.success(t("learned", { name, level: skill.level + 1 }), t("learnedText", { hours: skill.nextHours ?? 0 }), {
        silent: true,
      });
      setState("success");
      void refresh();
    } catch (error) {
      toast.error(name, errorText(error));
      setState("idle");
    }
  };

  return (
    <li
      className="flex h-full flex-col rounded-md border border-line-1 bg-surface-1 p-3"
      data-testid={`company-skill-${skill.key}`}
      data-level={skill.level}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2">
          <PixelIcon {...iconOf(skill.key)} scale={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg-1">{name}</p>
          <p className="mt-0.5 text-xs text-pretty text-fg-3">{skillDesc(t, skill.key)}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="flex gap-1" aria-hidden>
          {Array.from({ length: skill.maxLevel }, (_, i) => (
            <span
              key={i}
              className={cn(
                "size-2.5 rounded-xs",
                i < skill.level - (training ? 1 : 0) ? "bg-gain" : i < skill.level ? "bg-warn" : "bg-surface-3",
              )}
            />
          ))}
        </div>
        <span className="nums text-2xs text-fg-3">{t("level", { level: skill.level, max: skill.maxLevel })}</span>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-sm bg-surface-2 px-2 py-1.5">
          <dt className="text-2xs text-fg-3">{t("nowLabel")}</dt>
          <dd className={cn("nums font-semibold", skill.effectBps > 0 ? "text-gain" : "text-fg-3")}>
            {skill.effectBps > 0 ? effectText(t, skill.effect, skill.effectBps) : t("none")}
          </dd>
        </div>
        <div className="rounded-sm bg-surface-2 px-2 py-1.5">
          <dt className="text-2xs text-fg-3">{t("nextLabel")}</dt>
          <dd className="nums font-semibold text-fg-1">
            {skill.nextEffectBps !== null ? effectText(t, skill.effect, skill.nextEffectBps) : t("maxed")}
          </dd>
        </div>
      </dl>

      {training && skill.trainingUntil && (
        <p className="mt-2 rounded-sm bg-warn-soft px-2.5 py-1.5 text-xs text-warn" role="timer">
          <span aria-hidden>⏳ </span>
          {t("trainingLabel")} <Countdown target={Date.parse(skill.trainingUntil) + skew} className="font-semibold" />
        </p>
      )}

      {!maxed && skill.missing && (
        <div className="mt-2 rounded-sm bg-surface-2 px-2.5 py-2 text-xs" data-testid="company-skill-locked">
          <p className="flex items-center gap-1.5 font-medium text-fg-1">
            <PixelIcon {...UI_ICONS.lock} scale={1} />
            {t("locked", { skill: mapSkillName(ts, skill.missing) })}
          </p>
          <p className="mt-0.5 text-2xs text-pretty text-fg-3">{t("lockedHint")}</p>
          <Link
            href={skillMapHref(skill.missing)}
            className="mt-1 inline-block text-accent underline-offset-2 focus-ring hover:underline"
          >
            {t("toSkill")} →
          </Link>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 pt-3">
        <p className="min-w-0 nums text-2xs text-pretty text-fg-3">
          {!maxed && skill.nextCostCents !== null
            ? noCash && !skill.missing
              ? t("noCash")
              : t("cost", {
                  amount: formatMoney(skill.nextCostCents, { whole: true }),
                  hours: skill.nextHours ?? 0,
                })
            : null}
        </p>
        {!maxed && (
          <Button
            size="sm"
            state={state}
            disabled={blocked && state === "idle"}
            onClick={() => void learn()}
            data-testid={`company-skill-learn-${skill.key}`}
          >
            {t("learn", { level: skill.level + 1 })}
          </Button>
        )}
      </div>
    </li>
  );
}
