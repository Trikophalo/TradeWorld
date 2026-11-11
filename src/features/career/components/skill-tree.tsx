"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { burstConfetti } from "@/components/ui/effects";
import { HoldButton } from "@/components/ui/hold-button";
import { Progress } from "@/components/ui/progress";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { MAP_ORDER, SKILL_BRANCHES, SKILL_NODES, type SkillBranch, type SkillNodeConfig } from "@/config/skills";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { SkillState } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { learnCheck, payForSkill, pointsFor, skillCost, type LearnCheck } from "@/lib/sim/skills";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useVisitTour } from "@/features/tutorial/use-visit-tour";
import { useCareerRefresh, useSkills } from "../hooks";

type NodeKey = Parameters<ReturnType<typeof useTranslations<"skills.nodes">>>[0];
type BranchKey = Parameters<ReturnType<typeof useTranslations<"skills.branches">>>[0];
type TierKey = Parameters<ReturnType<typeof useTranslations<"skillTree.tierNames">>>[0];
type Ts = ReturnType<typeof useTranslations<"skills">>;

const nodeName = (t: Ts, key: string) => t(`nodes.${key}.name` as `nodes.${NodeKey}`);
const branchName = (t: Ts, branch: SkillBranch) => t(`branches.${branch}.name` as `branches.${BranchKey}`);

/** Colours of the eight directions (data, like company colours). */
export const BRANCH_COLORS: Record<SkillBranch, string> = {
  it: "#4f8cff",
  finance: "#2fb45a",
  law: "#c03fb8",
  management: "#e0a100",
  sales: "#ef6c1a",
  logistics: "#0f9e8a",
  craft: "#9a6b3c",
  science: "#7a5cff",
};

const SIZE = 30; // hex radius in map units
const SQRT3 = Math.sqrt(3);
const toPixel = (q: number, r: number) => ({ x: SIZE * SQRT3 * (q + r / 2), y: SIZE * 1.5 * r });
const HEX = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return `${(SIZE * 0.94 * Math.cos(a)).toFixed(2)},${(SIZE * 0.94 * Math.sin(a)).toFixed(2)}`;
}).join(" ");
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const START_ZOOM = 1.2;

/** Two short lines for a hex label. */
function label(name: string): [string, string] {
  const words = name.split(/[\s-]+/);
  if (words.length === 1) return [name.length > 11 ? `${name.slice(0, 10)}.` : name, ""];
  const first = words[0]!.length > 11 ? `${words[0]!.slice(0, 10)}.` : words[0]!;
  const rest = words.slice(1).join(" ");
  return [first, rest.length > 11 ? `${rest.slice(0, 10)}.` : rest];
}

/** The skill map (ADR-061): hex fields in 8 directions, pan by dragging, zoom with wheel, buttons or two fingers. */
export function SkillTree() {
  const t = useTranslations("skillTree");
  const ts = useTranslations("skills");
  const skills = useSkills();
  const [open, setOpen] = useState<string | null>(null);
  const data = skills.data;
  const learned = useMemo(() => new Set(data?.learned.map((l) => l.key) ?? []), [data]);
  useVisitTour("visit_skill_map", Boolean(data));

  if (!data) return <Skeleton className="h-[70dvh] w-full rounded-lg" />;

  return (
    <div className="grid gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6">
      <HexMap state={data} learned={learned} onOpen={setOpen} />
      <div className="space-y-4 lg:order-first lg:col-start-2 lg:row-start-1">
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
        <Card padding="md">
          <p className="mb-2 label-pixel text-fg-3">{t("overview")}</p>
          <ul className="space-y-2">
            {SKILL_BRANCHES.map((b) => (
              <li key={b} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="size-2.5 shrink-0" style={{ backgroundColor: BRANCH_COLORS[b] }} />
                    <span className="truncate text-fg-2">{branchName(ts, b)}</span>
                  </span>
                  <span className="nums text-fg-1">
                    {data.branchScores[b] ?? 0}
                    {(data.branchPoints[b] ?? 0) > 0 && <span className="ml-1 text-gold">+{data.branchPoints[b]}</span>}
                  </span>
                </div>
                {data.branchProgress[b] > 0 && (
                  <Progress
                    value={data.branchProgress[b]}
                    label={t("branchPoints")}
                    tone="gold"
                    size="sm"
                    className="mt-1"
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <LearnSheet skillKey={open} state={data} learned={learned} onClose={() => setOpen(null)} />
    </div>
  );
}

function HexMap({
  state,
  learned,
  onOpen,
}: {
  state: SkillState;
  learned: ReadonlySet<string>;
  onOpen: (key: string) => void;
}) {
  const t = useTranslations("skillTree");
  const ts = useTranslations("skills");
  const [view, setView] = useState({ x: 0, y: 0, zoom: START_ZOOM });
  // The map is drawn in screen pixels: one map unit = one CSS pixel at zoom 1.
  const [size, setSize] = useState({ w: 800, h: 600 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; moved: number; pinch: number | null; key: string | null } | null>(null);
  const box = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const zoomBy = (factor: number) =>
    setView((v) => ({ ...v, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor)) }));

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Remember the field before capturing: with pointer capture, later events target the svg itself.
    const key = (event.target as Element).closest("[data-skill]")?.getAttribute("data-skill") ?? null;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const list = [...pointers.current.values()];
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      moved: 0,
      pinch: list.length === 2 ? Math.hypot(list[0]!.x - list[1]!.x, list[0]!.y - list[1]!.y) : null,
      key: list.length === 1 ? key : null,
    };
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const list = [...pointers.current.values()];
    if (list.length === 2 && drag.current.pinch) {
      const distance = Math.hypot(list[0]!.x - list[1]!.x, list[0]!.y - list[1]!.y);
      zoomBy(distance / drag.current.pinch);
      drag.current.pinch = distance;
      drag.current.moved += 10;
      return;
    }
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
    drag.current.moved += Math.abs(dx) + Math.abs(dy);
    setView((v) => ({ ...v, x: v.x + dx / v.zoom, y: v.y + dy / v.zoom }));
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      // A short tap without movement opens the field under the pointer.
      const key = drag.current?.key;
      if (drag.current && drag.current.moved < 6 && key) {
        onOpen(key);
        void playSound("tap");
      }
      drag.current = null;
    }
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>) => zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);

  const showText = view.zoom >= 0.75;

  return (
    <Card padding="none" className="relative overflow-hidden" data-tour="skill-map">
      <svg
        ref={box}
        viewBox={`${-size.w / 2} ${-size.h / 2} ${size.w} ${size.h}`}
        role="application"
        aria-label={t("title")}
        data-testid="skill-map"
        className="block h-[68dvh] max-h-[720px] min-h-[420px] w-full cursor-grab touch-none bg-surface-2 select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <g transform={`scale(${view.zoom}) translate(${view.x} ${view.y})`}>
          {MAP_ORDER.map((b, i) => {
            const angle = (i * 45 * Math.PI) / 180;
            const d = SIZE * SQRT3 * 8.7;
            return (
              <text
                key={b}
                x={Math.cos(angle) * d}
                y={-Math.sin(angle) * d}
                textAnchor="middle"
                dominantBaseline="middle"
                className="font-pixel uppercase"
                fontSize={13}
                fill={BRANCH_COLORS[b]}
              >
                {branchName(ts, b)}
              </text>
            );
          })}
          <g>
            <polygon points={HEX} className="fill-surface-1 stroke-line-2" strokeWidth={1.5} />
            <text textAnchor="middle" dominantBaseline="middle" fontSize={9} className="fill-fg-1 font-pixel">
              {t("start")}
            </text>
          </g>
          {SKILL_NODES.map((node) => (
            <Hex
              key={node.key}
              node={node}
              check={learnCheck(node.key, learned, state.freePoints, state.branchPoints)}
              name={nodeName(ts, node.key)}
              showText={showText}
            />
          ))}
        </g>
      </svg>
      <div className="absolute top-3 right-3 flex flex-col gap-2">
        <Button size="icon" variant="secondary" aria-label={t("zoomIn")} onClick={() => zoomBy(1.25)}>
          +
        </Button>
        <Button size="icon" variant="secondary" aria-label={t("zoomOut")} onClick={() => zoomBy(0.8)}>
          −
        </Button>
        <Button
          size="icon"
          variant="secondary"
          aria-label={t("center")}
          onClick={() => setView({ x: 0, y: 0, zoom: START_ZOOM })}
        >
          ◎
        </Button>
      </div>
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-surface-1/90 px-3 py-2 text-xs text-fg-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 bg-accent" /> {t("legendLearned")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 border border-accent" /> {t("legendOpen")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 bg-line-2" /> {t("legendLocked")}
        </span>
        <span className="hidden text-fg-3 sm:inline">{t("mapHint")}</span>
      </div>
    </Card>
  );
}

function Hex({
  node,
  check,
  name,
  showText,
}: {
  node: SkillNodeConfig;
  check: LearnCheck;
  name: string;
  showText: boolean;
}) {
  const { x, y } = toPixel(node.q, node.r);
  const color = BRANCH_COLORS[node.branches[0]!];
  const second = node.branches[1] ? BRANCH_COLORS[node.branches[1]] : null;
  const [line1, line2] = label(name);
  const learned = check === "learned";
  const open = check === "ok" || check === "points";
  return (
    <g
      transform={`translate(${x} ${y})`}
      data-skill={node.key}
      data-state={check}
      className="cursor-pointer"
      opacity={check === "locked" ? 0.35 : 1}
    >
      <title>{name}</title>
      <polygon
        points={HEX}
        fill={learned ? color : open ? `${color}33` : "var(--bg-1)"}
        stroke={second ?? color}
        strokeWidth={learned ? 1 : open ? 2.5 : 1}
        strokeDasharray={check === "points" ? "4 3" : undefined}
        className="transition-[fill,stroke-width] duration-200"
      />
      {showText ? (
        <text
          textAnchor="middle"
          fontSize={7.2}
          className={learned ? "fill-on-accent font-medium" : "fill-fg-1"}
          pointerEvents="none"
        >
          <tspan x={0} y={line2 ? -2 : 2.5}>
            {line1}
          </tspan>
          {line2 && (
            <tspan x={0} y={7}>
              {line2}
            </tspan>
          )}
        </text>
      ) : (
        <text textAnchor="middle" dominantBaseline="middle" fontSize={11} className="fill-fg-1" pointerEvents="none">
          {"•".repeat(node.tier)}
        </text>
      )}
      {node.tier >= 4 && showText && (
        <text y={-17} textAnchor="middle" fontSize={7} className="fill-gold" pointerEvents="none">
          {"★".repeat(node.tier - 3)}
        </text>
      )}
    </g>
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
  const [shown, setShown] = useState<string | null>(skillKey);
  if (skillKey !== null && skillKey !== shown) setShown(skillKey);
  const node = SKILL_NODES.find((n) => n.key === shown);
  if (!node) return null;

  const check: LearnCheck = learnCheck(node.key, learned, state.freePoints, state.branchPoints);
  const cost = skillCost(node);
  const pay = payForSkill(node, state.freePoints, state.branchPoints);

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
      onOpenChange={(o) => !o && onClose()}
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
        {check === "locked" && <p className="rounded-md bg-surface-2 px-4 py-3 text-sm text-fg-2">{t("lockedMap")}</p>}
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
        <p className={cn("text-xs text-fg-3")}>
          {t("score", { score: BALANCE.skills.scoreByTier[node.tier - 1] ?? 0 })} ·{" "}
          {node.branches.map((b) => branchName(ts, b)).join(" + ")}
        </p>
      </div>
    </Sheet>
  );
}
