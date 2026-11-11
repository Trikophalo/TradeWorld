"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { burstConfetti } from "@/components/ui/effects";
import { HoldButton } from "@/components/ui/hold-button";
import { Progress } from "@/components/ui/progress";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { SKILL_BRANCHES, SKILL_NODES, type SkillBranch, type SkillNodeConfig } from "@/config/skills";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { SkillState } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { learnCheck, payForSkill, pointsFor, skillCost, type LearnCheck } from "@/lib/sim/skills";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useCareerRefresh, useSkills } from "../hooks";

type NodeKey = Parameters<ReturnType<typeof useTranslations<"skills.nodes">>>[0];
type BranchKey = Parameters<ReturnType<typeof useTranslations<"skills.branches">>>[0];
type TierKey = Parameters<ReturnType<typeof useTranslations<"skillTree.tierNames">>>[0];

const nodeName = (t: ReturnType<typeof useTranslations<"skills">>, key: string) =>
  t(`nodes.${key}.name` as `nodes.${NodeKey}`);
const branchName = (t: ReturnType<typeof useTranslations<"skills">>, branch: SkillBranch) =>
  t(`branches.${branch}.name` as `branches.${BranchKey}`);

/** Column (0–2) of every single-branch skill in the three-column tree layout. */
function columnsOf(nodes: readonly SkillNodeConfig[]): Map<string, number> {
  const cols = new Map<string, number>();
  for (const node of [...nodes].sort((a, b) => a.tier - b.tier)) {
    if (node.tier === 1) cols.set(node.key, 1);
    else if (node.tier === 2) cols.set(node.key, nodes.filter((n) => n.tier === 2).indexOf(node));
    else {
      const parents = node.requires.map((r) => cols.get(r) ?? 1);
      cols.set(node.key, Math.round(parents.reduce((a, b) => a + b, 0) / parents.length));
    }
  }
  return cols;
}

/** The skill tree page body: branch picker, the branch's five tiers and its hybrid skills (ADR-050). */
export function SkillTree() {
  const t = useTranslations("skillTree");
  const ts = useTranslations("skills");
  const skills = useSkills();
  const [branch, setBranch] = useState<SkillBranch>("it");
  const [open, setOpen] = useState<string | null>(null);

  const data = skills.data;
  const learned = useMemo(() => new Set(data?.learned.map((l) => l.key) ?? []), [data]);
  const branchNodes = SKILL_NODES.filter((n) => n.branches.length === 1 && n.branches[0] === branch);
  const hybrids = SKILL_NODES.filter((n) => n.branches.length === 2 && n.branches.includes(branch));
  const cols = columnsOf(branchNodes);

  if (!data) return <TreeSkeleton />;

  return (
    <div className="grid gap-5 *:min-w-0 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-6">
      <div className="space-y-5 lg:space-y-6">
        <Card padding="lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="label-pixel text-fg-3">{t("freePoints")}</p>
              <p className="mt-1 nums text-3xl font-semibold text-fg-1" data-testid="free-points">
                {data.freePoints}
              </p>
            </div>
            <Badge tone="accent">{t("progressHint", { done: learned.size, total: SKILL_NODES.length })}</Badge>
          </div>
          <p className="mt-2 text-sm text-pretty text-fg-3">{t("freePointsHint")}</p>
        </Card>

        <div role="tablist" aria-label={t("overview")} className="grid grid-cols-2 gap-2">
          {SKILL_BRANCHES.map((b) => {
            const selected = b === branch;
            return (
              <button
                key={b}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setBranch(b);
                  void playSound("tap");
                }}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left focus-ring",
                  "transition duration-fast ease-standard active:scale-[0.98]",
                  selected ? "border-accent bg-accent-soft" : "border-line-1 bg-surface-1 hover:bg-surface-2",
                )}
              >
                <span className={cn("w-full truncate text-sm font-medium", selected ? "text-fg-1" : "text-fg-2")}>
                  {branchName(ts, b)}
                </span>
                <span className="flex items-center gap-2">
                  <span className="nums text-xs text-fg-3">{t("score", { score: data.branchScores[b] ?? 0 })}</span>
                  {(data.branchPoints[b] ?? 0) > 0 && (
                    <span className="rounded-xs bg-gold/20 px-1 nums text-2xs text-gold">+{data.branchPoints[b]}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Card padding="lg" className="space-y-1">
        <div className="mb-4">
          <h2 className="font-pixel text-sm text-fg-1 uppercase">{branchName(ts, branch)}</h2>
          <p className="mt-1 text-sm text-pretty text-fg-3">
            {ts(`branches.${branch}.desc` as `branches.${BranchKey}`)}
          </p>
          {(data.branchPoints[branch] > 0 || data.branchProgress[branch] > 0) && (
            <div className="mt-3 rounded-md bg-surface-2 px-3 py-2.5">
              <div className="mb-1.5 flex justify-between text-xs">
                <span className="text-fg-2">{t("branchPoints")}</span>
                <span className="nums text-gold">{data.branchPoints[branch]}</span>
              </div>
              <Progress value={data.branchProgress[branch]} label={t("branchPoints")} tone="gold" size="sm" />
            </div>
          )}
        </div>

        {[1, 2, 3, 4, 5].map((tier) => {
          const row = branchNodes.filter((n) => n.tier === tier);
          return (
            <div key={tier}>
              {tier > 1 && <Connectors nodes={row} cols={cols} learned={learned} />}
              <p className="mb-1.5 label-pixel text-fg-3">
                {t("tier", { tier })} · {t(`tierNames.${tier}` as `tierNames.${TierKey}`)}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {row.map((node) => (
                  <div key={node.key} style={{ gridColumnStart: (cols.get(node.key) ?? 1) + 1 }}>
                    <SkillNode node={node} state={data} learned={learned} onOpen={() => setOpen(node.key)} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {hybrids.length > 0 && (
          <div className="pt-5">
            <p className="label-pixel text-fg-2">{t("hybrids")}</p>
            <p className="mt-0.5 mb-2 text-sm text-fg-3">{t("hybridsHint")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {hybrids.map((node) => (
                <SkillNode key={node.key} node={node} state={data} learned={learned} onOpen={() => setOpen(node.key)} />
              ))}
            </div>
          </div>
        )}
      </Card>

      <LearnSheet skillKey={open} state={data} learned={learned} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Lines from the previous tier to this one: straight down in the same column, elbows across columns. */
function Connectors({
  nodes,
  cols,
  learned,
}: {
  nodes: readonly SkillNodeConfig[];
  cols: Map<string, number>;
  learned: ReadonlySet<string>;
}) {
  const x = (col: number) => 50 + col * 100;
  return (
    <svg viewBox="0 0 300 20" preserveAspectRatio="none" className="block h-5 w-full" aria-hidden>
      {nodes.flatMap((node) =>
        node.requires.map((req) => {
          const from = x(cols.get(req) ?? 1);
          const to = x(cols.get(node.key) ?? 1);
          const lit = learned.has(req);
          return (
            <path
              key={`${req}-${node.key}`}
              d={from === to ? `M${from} 0V20` : `M${from} 0V10H${to}V20`}
              fill="none"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              className={cn("transition-colors duration-slow", lit ? "stroke-accent" : "stroke-line-2")}
            />
          );
        }),
      )}
    </svg>
  );
}

function SkillNode({
  node,
  state,
  learned,
  onOpen,
}: {
  node: SkillNodeConfig;
  state: SkillState;
  learned: ReadonlySet<string>;
  onOpen: () => void;
}) {
  const ts = useTranslations("skills");
  const check = learnCheck(node.key, learned, state.freePoints, state.branchPoints);
  const cost = skillCost(node);
  return (
    <motion.button
      type="button"
      layout
      onClick={onOpen}
      whileTap={{ scale: 0.97 }}
      transition={SPRING.snappy}
      data-skill={node.key}
      data-state={check}
      className={cn(
        "relative flex h-full min-h-16 w-full flex-col justify-between gap-1 rounded-md border p-2 text-left focus-ring",
        "transition-colors duration-fast",
        check === "learned" && "border-accent bg-accent-soft",
        check === "ok" && "border-dashed border-accent/70 bg-surface-1 hover:bg-surface-2",
        check === "points" && "border-line-2 bg-surface-1 hover:bg-surface-2",
        check === "locked" && "border-line-1 bg-surface-2 opacity-55",
      )}
    >
      <span lang="de" className="line-clamp-2 text-xs font-medium break-words hyphens-auto text-fg-1 sm:text-sm">
        {nodeName(ts, node.key)}
      </span>
      <span className="flex items-center justify-between gap-1">
        {check === "learned" ? (
          <span className="label-pixel text-accent">✓</span>
        ) : check === "locked" ? (
          <PixelIcon {...UI_ICONS.lock} scale={1} className="text-fg-3" />
        ) : (
          <span className={cn("nums text-2xs", check === "ok" ? "text-accent" : "text-fg-3")}>{cost} P</span>
        )}
      </span>
    </motion.button>
  );
}

function LearnSheet({
  skillKey,
  state,
  learned,
  onClose,
}: {
  skillKey: string | null;
  state: SkillState;
  learned: ReadonlySet<string>;
  onClose: () => void;
}) {
  const t = useTranslations("skillTree");
  const ts = useTranslations("skills");
  const errorText = useGameErrorText();
  const refresh = useCareerRefresh();
  const [busy, setBusy] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  // Keep the last node while the sheet animates out.
  const [shown, setShown] = useState<string | null>(skillKey);
  if (skillKey !== null && skillKey !== shown) setShown(skillKey);
  const node = SKILL_NODES.find((n) => n.key === shown);
  if (!node) return null;

  const check: LearnCheck = learnCheck(node.key, learned, state.freePoints, state.branchPoints);
  const cost = skillCost(node);
  const pay = payForSkill(node, state.freePoints, state.branchPoints);
  const missing = node.requires.filter((r) => !learned.has(r));

  const learn = async () => {
    setBusy(true);
    try {
      const next = await engine.learnSkill(crypto.randomUUID(), node.key);
      void playSound("levelUp", 0.7);
      haptic("success");
      if (anchor.current) burstConfetti(anchor.current, 20);
      const b = node.branches[0]!;
      toast.success(
        t("learnedToast", { name: nodeName(ts, node.key) }),
        t("learnedToastText", { branch: branchName(ts, b), score: next.branchScores[b] ?? 0 }),
        { silent: true },
      );
      await refresh();
      onClose();
    } catch (error) {
      toast.error(nodeName(ts, node.key), errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={skillKey !== null}
      onOpenChange={(open) => !open && onClose()}
      title={nodeName(ts, node.key)}
      description={`${t("tier", { tier: node.tier })} · ${t(`tierNames.${node.tier}` as `tierNames.${TierKey}`)}`}
      footer={
        check === "ok" ? (
          <HoldButton tone="accent" onConfirm={() => void learn()} disabled={busy} className="w-full">
            {t("learnConfirm")}
          </HoldButton>
        ) : undefined
      }
    >
      <div ref={anchor} className="space-y-4">
        <p className="text-pretty text-fg-2">{ts(`nodes.${node.key}.desc` as `nodes.${NodeKey}`)}</p>
        <div className="flex flex-wrap gap-2">
          {node.branches.map((b) => (
            <Badge key={b}>{branchName(ts, b)}</Badge>
          ))}
          <Badge tone="accent">{t("cost", { count: cost })}</Badge>
        </div>
        {check === "learned" && (
          <p className="rounded-md bg-accent-soft px-4 py-3 text-sm text-accent">{t("learned")}</p>
        )}
        {check === "locked" && (
          <p className="rounded-md bg-surface-2 px-4 py-3 text-sm text-fg-2">
            {t("locked", { names: missing.map((r) => nodeName(ts, r)).join(", ") })}
          </p>
        )}
        {check === "points" && (
          <p className="rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">
            {t("notEnough", { count: cost - pointsFor(node, state.freePoints, state.branchPoints) })}
          </p>
        )}
        {check === "ok" && pay && (
          <div className="space-y-2 rounded-md bg-surface-2 px-4 py-3 text-sm">
            <p className="text-fg-1">{t("learnText", { cost: t("cost", { count: cost }) })}</p>
            {Object.entries(pay.branches).length > 0 && (
              <p className="text-fg-3">
                {t("learnPaid", {
                  branch: Object.keys(pay.branches)
                    .map((b) => branchName(ts, b as SkillBranch))
                    .join(" + "),
                  branchCount: Object.values(pay.branches).reduce((a, b) => a + (b ?? 0), 0),
                  free: pay.free,
                })}
              </p>
            )}
          </div>
        )}
        <p className="text-xs text-fg-3">
          {t("score", { score: BALANCE.skills.scoreByTier[node.tier - 1] ?? 0 })} ·{" "}
          {node.branches.map((b) => branchName(ts, b)).join(" + ")}
        </p>
      </div>
    </Sheet>
  );
}

function TreeSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-6">
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-lg" />
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      </div>
      <Skeleton className="h-[520px] w-full rounded-lg" />
    </div>
  );
}
