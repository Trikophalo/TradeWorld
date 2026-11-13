"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SKILL_BRANCHES, SKILL_NODES, type SkillBranch, type SkillNodeConfig } from "@/config/skills";
import type { SkillState } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { SPRING, STAGGER } from "@/lib/motion";
import { learnCheck, pointsFor, skillCost, type LearnCheck } from "@/lib/sim/skills";
import { cn } from "@/lib/utils";
import { useMyJob } from "../hooks";

type NodeKey = Parameters<ReturnType<typeof useTranslations<"skills.nodes">>>[0];
type BranchKey = Parameters<ReturnType<typeof useTranslations<"skills.branches">>>[0];
type TierKey = Parameters<ReturnType<typeof useTranslations<"skillTree.tierNames">>>[0];
type Ts = ReturnType<typeof useTranslations<"skills">>;

const nodeName = (t: Ts, key: string) => t(`nodes.${key}.name` as `nodes.${NodeKey}`);
const branchName = (t: Ts, branch: SkillBranch) => t(`branches.${branch}.name` as `branches.${BranchKey}`);
const NEXT_MAX = 6;

/**
 * The skill paths (ADR-061 follow-up): what can be learned now, then every area as a path from the basics to
 * mastery. Each skill shows its state at a glance: learned, learnable, points missing, or still locked.
 */
export function SkillPaths({
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
    <div className="space-y-5" data-tour="skill-map" data-testid="skill-paths">
      <Card padding="lg" className="space-y-3">
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

      <div className="grid gap-4 lg:grid-cols-2">
        {SKILL_BRANCHES.map((b, i) => (
          <BranchPath
            key={b}
            branch={b}
            color={colors[b]}
            state={state}
            learned={learned}
            check={check}
            onOpen={onOpen}
            forJob={jobBranches.has(b)}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}

function BranchPath({
  branch,
  color,
  state,
  learned,
  check,
  onOpen,
  forJob,
  index,
}: {
  branch: SkillBranch;
  color: string;
  state: SkillState;
  learned: ReadonlySet<string>;
  check: (n: SkillNodeConfig) => LearnCheck;
  onOpen: (key: string) => void;
  forJob: boolean;
  index: number;
}) {
  const t = useTranslations("skillTree");
  const ts = useTranslations("skills");
  const reduced = useReducedMotion();
  const nodes = SKILL_NODES.filter((n) => n.branches[0] === branch);
  const done = nodes.filter((n) => learned.has(n.key)).length;
  const tiers = [...new Set(nodes.map((n) => n.tier))].sort((a, b) => a - b);
  // Only the reached tiers and the next one; the rest folds away until asked for.
  const reached = Math.max(1, ...nodes.filter((n) => check(n) !== "locked").map((n) => n.tier));
  const [all, setAll] = useState(false);
  const shown = all ? tiers : tiers.filter((tier) => tier <= reached + 1);
  const hidden = tiers.filter((tier) => !shown.includes(tier));

  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING.smooth, delay: reduced ? 0 : index * STAGGER }}
      className="overflow-hidden rounded-lg border border-line-1 bg-surface-1"
      data-branch={branch}
    >
      <header className="relative px-4 pt-3 pb-2.5">
        <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} />
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-medium text-fg-1">{branchName(ts, branch)}</h3>
            {forJob && <Badge tone="gain">{t("next.forJob")}</Badge>}
          </div>
          <span className="shrink-0 nums text-sm text-fg-2">
            {t("score", { score: state.branchScores[branch] ?? 0 })}
            {(state.branchPoints[branch] ?? 0) > 0 && (
              <span className="ml-1 text-gold">+{state.branchPoints[branch]}</span>
            )}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-3">
            <motion.div
              className="h-full origin-left rounded-pill"
              style={{ backgroundColor: color }}
              initial={false}
              animate={{ scaleX: nodes.length > 0 ? done / nodes.length : 0 }}
              transition={SPRING.smooth}
            />
          </div>
          <span className="nums text-xs text-fg-3">
            {done}/{nodes.length}
          </span>
        </div>
      </header>
      <ol className="space-y-2.5 px-4 pb-4">
        {shown.map((tier) => (
          <li key={tier}>
            <p className="mb-1 text-2xs text-fg-3 uppercase">
              {t("tier", { tier })} · {t(`tierNames.${tier}` as `tierNames.${TierKey}`)}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {nodes
                .filter((n) => n.tier === tier)
                .map((n) => (
                  <li key={n.key}>
                    <SkillChip node={n} check={check(n)} color={color} onOpen={onOpen} />
                  </li>
                ))}
            </ul>
          </li>
        ))}
        {hidden.length > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setAll(true)}
              className="text-xs text-accent focus-ring hover:underline"
              data-testid="more-tiers"
            >
              {t("moreTiers", { from: hidden[0]!, to: hidden.at(-1)! })}
            </button>
          </li>
        )}
      </ol>
    </motion.section>
  );
}

function SkillChip({
  node,
  check,
  color,
  onOpen,
}: {
  node: SkillNodeConfig;
  check: LearnCheck;
  color: string;
  onOpen: (key: string) => void;
}) {
  const t = useTranslations("skillTree");
  const ts = useTranslations("skills");
  const name = nodeName(ts, node.key);
  const learned = check === "learned";
  const open = check === "ok" || check === "points";
  return (
    <button
      type="button"
      data-skill={node.key}
      data-state={check}
      onClick={() => {
        haptic("tap");
        onOpen(node.key);
      }}
      title={check === "locked" ? t("lockedMap") : name}
      className={cn(
        "relative flex items-center gap-1.5 overflow-hidden rounded-md border px-2 py-1 text-xs focus-ring transition duration-fast active:scale-95",
        learned && "font-medium text-fg-1",
        open && "text-fg-1 hover:-translate-y-0.5",
        check === "points" && "border-dashed",
        check === "locked" && "border-line-1 text-fg-3 hover:text-fg-2",
      )}
      style={learned || open ? { borderColor: color } : undefined}
    >
      {learned && <span aria-hidden className="absolute inset-0 opacity-25" style={{ backgroundColor: color }} />}
      {check === "ok" && (
        <span
          aria-hidden
          className="relative size-1.5 shrink-0 rounded-pill motion-safe:animate-pulse"
          style={{ backgroundColor: color }}
        />
      )}
      {check === "locked" && (
        <span aria-hidden className="relative opacity-60">
          <PixelIcon {...UI_ICONS.lock} scale={1} />
        </span>
      )}
      <span className="relative">{name}</span>
      {learned && (
        <span aria-hidden className="relative text-gain">
          ✓
        </span>
      )}
      {node.branches.length > 1 && (
        <span aria-hidden className="relative text-2xs text-fg-3">
          ⇄
        </span>
      )}
    </button>
  );
}
