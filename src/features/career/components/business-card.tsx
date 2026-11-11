"use client";

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotionConfig,
  useSpring,
  useTransform,
} from "motion/react";
import { useTranslations } from "next-intl";
import type { PointerEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { SKILL_BRANCHES, type SkillBranch } from "@/config/skills";
import { romanTier, titleForLevel } from "@/config/titles";
import type { PlayerCard } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type BranchKey = Parameters<ReturnType<typeof useTranslations<"skills.branches">>>[0];
type JobTitleKey = Parameters<ReturnType<typeof useTranslations<"jobTitles">>>[0];

const TILT_DEG = 7;
const date = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

/**
 * Digital business card (ADR-054): portrait, name, title, rank, strongest
 * skill branches and the current job. Tilts slightly towards the pointer with
 * a moving light reflex; stays flat with reduced motion.
 */
export function BusinessCard({ card, className }: { card: PlayerCard; className?: string }) {
  const t = useTranslations("playerCard");
  const tb = useTranslations("skills.branches");
  const tt = useTranslations("titles");
  const tj = useTranslations("jobTitles");
  const tc = useTranslations("careerTiers");
  const reduced = useReducedMotionConfig();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(py, [0, 1], [TILT_DEG, -TILT_DEG]), { stiffness: 220, damping: 22 });
  const rotateY = useSpring(useTransform(px, [0, 1], [-TILT_DEG, TILT_DEG]), { stiffness: 220, damping: 22 });
  const glareX = useTransform(px, [0, 1], ["0%", "100%"]);
  const glareY = useTransform(py, [0, 1], ["0%", "100%"]);
  const glare = useMotionTemplate`radial-gradient(circle at ${glareX} ${glareY}, var(--card-glare), transparent 55%)`;

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    const rect = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - rect.left) / rect.width);
    py.set((event.clientY - rect.top) / rect.height);
  };
  const reset = () => {
    px.set(0.5);
    py.set(0.5);
  };

  const title = titleForLevel(card.level);
  const strongest = SKILL_BRANCHES.map((branch) => ({ branch, score: card.branchScores[branch] ?? 0 }))
    .filter((b) => b.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const maxScore = Math.max(10, ...strongest.map((b) => b.score));
  const jobTitle = card.job ? (card.job.titleKey ? tj(card.job.titleKey as JobTitleKey) : card.job.title) : null;

  return (
    <div className={cn("[perspective:900px]", className)}>
      <motion.div
        onPointerMove={move}
        onPointerLeave={reset}
        onPointerUp={reset}
        style={reduced ? undefined : { rotateX, rotateY, transformStyle: "preserve-3d" }}
        className="relative overflow-hidden rounded-xl border border-line-2 bg-card-face p-5 shadow-3 select-none"
        data-testid="business-card"
      >
        {/* Pixel pattern and accent edge */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-card-pattern opacity-60" />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-accent" />
        {!reduced && (
          <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: glare }} />
        )}

        <div className="relative flex items-start gap-4" style={{ transform: "translateZ(30px)" }}>
          <Avatar avatarKey={card.avatarKey} size="lg" className="shadow-2" />
          <div className="min-w-0 flex-1 pt-1">
            <p className="label-pixel text-accent">{t("title")}</p>
            <p className="mt-1 truncate text-2xl font-semibold text-fg-1">{card.nickname}</p>
            <p className="mt-0.5 text-sm text-fg-2">
              {t("level", { level: card.level })} · {tt(title.key)} {romanTier(title.tier)}
            </p>
            <p className="mt-0.5 nums text-sm text-fg-3">
              {card.rank !== null ? t("rank", { rank: card.rank }) : t("noRank")} ·{" "}
              {formatMoney(card.netWorthCents, { compact: true })}
            </p>
          </div>
        </div>

        <div className="relative mt-5 grid gap-4 sm:grid-cols-2" style={{ transform: "translateZ(18px)" }}>
          <div>
            <p className="label-pixel text-fg-3">{t("topBranches")}</p>
            {strongest.length === 0 ? (
              <p className="mt-1.5 text-sm text-fg-3">{t("noSkills")}</p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {strongest.map(({ branch, score }) => (
                  <li key={branch}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate text-fg-1">
                        {tb(`${branch as SkillBranch}.name` as `${BranchKey}`)}
                      </span>
                      <span className="nums text-fg-2">{score}</span>
                    </div>
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-pill bg-surface-3">
                      <div
                        className="h-full origin-left rounded-pill bg-accent"
                        style={{ transform: `scaleX(${score / maxScore})` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <div className="col-span-2">
              <dt className="label-pixel text-fg-3">{t("job")}</dt>
              <dd className="mt-0.5 truncate text-fg-1">
                {card.job && jobTitle
                  ? t("jobAt", { title: jobTitle, company: card.job.companyName })
                  : card.company
                    ? t("founderAt", { company: card.company.name })
                    : t("noJob")}
              </dd>
              {card.job && <dd className="text-xs text-fg-3">{tc(card.job.tier)}</dd>}
            </div>
            <div>
              <dt className="label-pixel text-fg-3">{t("skills")}</dt>
              <dd className="mt-0.5 nums text-fg-1">{card.skillsLearned}</dd>
            </div>
            <div>
              <dt className="label-pixel text-fg-3">{t("streak")}</dt>
              <dd className="mt-0.5 nums text-fg-1">{t("streakValue", { days: card.streakDays })}</dd>
            </div>
            {card.company && (
              <div className="col-span-2" data-testid="card-founder">
                <dt className="label-pixel text-fg-3">{t("founder")}</dt>
                <dd className="mt-0.5 truncate font-medium text-fg-1">
                  {t("founderOf", { company: card.company.name })}
                  {card.company.ticker && <span className="ml-1.5 nums text-xs text-fg-3">{card.company.ticker}</span>}
                </dd>
              </div>
            )}
          </dl>
        </div>
        <p className="relative mt-4 text-xs text-fg-3">
          {t("memberSince", { date: date.format(new Date(card.memberSince)) })}
        </p>
      </motion.div>
    </div>
  );
}
