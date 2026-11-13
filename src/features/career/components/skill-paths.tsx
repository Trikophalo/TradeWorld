"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SKILL_NODES, type SkillBranch, type SkillNodeConfig } from "@/config/skills";
import type { SkillState } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { SPRING, STAGGER } from "@/lib/motion";
import { learnCheck, pointsFor, skillCost } from "@/lib/sim/skills";
import { useMyJob } from "../hooks";

type NodeKey = Parameters<ReturnType<typeof useTranslations<"skills.nodes">>>[0];
type BranchKey = Parameters<ReturnType<typeof useTranslations<"skills.branches">>>[0];
type TierKey = Parameters<ReturnType<typeof useTranslations<"skillTree.tierNames">>>[0];
type Ts = ReturnType<typeof useTranslations<"skills">>;

const nodeName = (t: Ts, key: string) => t(`nodes.${key}.name` as `nodes.${NodeKey}`);
const branchName = (t: Ts, branch: SkillBranch) => t(`branches.${branch}.name` as `branches.${BranchKey}`);
const NEXT_MAX = 6;

/**
 * What can be learned now, next to the map (ADR-115): skills whose prerequisites are learned. The ones the points
 * suffice for come first, then those of the job's areas.
 */
export function NextSkills({
  state,
  learned,
  colors,
  onOpen,
}: {
  state: SkillState;
  learned: ReadonlySet<string>;
  colors: Readonly<Record<SkillBranch, string>>;
  onOpen: (key: string) => void;
}) {
  const t = useTranslations("skillTree");
  const ts = useTranslations("skills");
  const reduced = useReducedMotion();
  const job = useMyJob().data ?? null;
  const jobBranches = new Set(job?.required.map((r) => r.branch) ?? []);
  const check = (n: SkillNodeConfig) => learnCheck(n.key, learned, state.freePoints, state.branchPoints);

  // Next steps: reachable and not learned; the job's areas first, then the cheaper tiers.
  const next = SKILL_NODES.filter((n) => {
    const c = check(n);
    return c === "ok" || c === "points";
  })
    .map((n) => ({ n, c: check(n), forJob: n.branches.some((b) => jobBranches.has(b)) }))
    .sort(
      (a, b) =>
        Number(b.c === "ok") - Number(a.c === "ok") ||
        Number(b.forJob) - Number(a.forJob) ||
        a.n.tier - b.n.tier ||
        a.n.key.localeCompare(b.n.key),
    )
    .slice(0, NEXT_MAX);
  const learnable = SKILL_NODES.filter((n) => check(n) === "ok").length;

  return (
    <Card padding="lg" className="space-y-3" data-testid="next-skills">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-pixel text-base text-fg-1 uppercase">{t("next.title")}</h2>
        <span className="text-sm text-fg-3">{t("next.count", { count: learnable })}</span>
      </div>
      <p className="text-sm text-pretty text-fg-3">{t("next.hint")}</p>
      {next.length === 0 ? (
        <p className="text-sm text-fg-2">{t("next.empty")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {next.map(({ n, c, forJob }, i) => {
            const color = colors[n.branches[0]!];
            const missing = skillCost(n) - pointsFor(n, state.freePoints, state.branchPoints);
            return (
              <motion.li
                key={n.key}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING.smooth, delay: reduced ? 0 : i * STAGGER }}
              >
                <button
                  type="button"
                  data-next-skill={n.key}
                  onClick={() => {
                    haptic("tap");
                    onOpen(n.key);
                  }}
                  className="relative flex w-full items-start gap-3 overflow-hidden rounded-lg border border-line-1 bg-surface-1 p-3 text-left focus-ring transition duration-fast hover:-translate-y-0.5 hover:border-line-2 hover:bg-surface-2 active:translate-y-0"
                >
                  <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color }} />
                  <span className="min-w-0 flex-1 pl-1">
                    <span className="block text-sm font-semibold text-pretty text-fg-1">{nodeName(ts, n.key)}</span>
                    <span className="mt-0.5 block text-xs text-fg-3">
                      {n.branches.map((b) => branchName(ts, b)).join(" + ")} ·{" "}
                      {t(`tierNames.${n.tier}` as `tierNames.${TierKey}`)}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {forJob && <Badge tone="gain">{t("next.forJob")}</Badge>}
                      {c === "ok" ? (
                        <Badge tone="accent">{t("cost", { count: skillCost(n) })}</Badge>
                      ) : (
                        <Badge tone="warn">{t("notEnough", { count: missing })}</Badge>
                      )}
                    </span>
                  </span>
                </button>
              </motion.li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
