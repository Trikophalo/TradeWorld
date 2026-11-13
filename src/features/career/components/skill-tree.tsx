"use client";

import { useTranslations } from "next-intl";
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { burstConfetti } from "@/components/ui/effects";
import { HoldButton } from "@/components/ui/hold-button";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { MAP_ORDER, SKILL_BRANCHES, SKILL_NODES, type SkillBranch, type SkillNodeConfig } from "@/config/skills";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { SkillState } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { learnCheck, neighbours, payForSkill, pointsFor, skillCost, type LearnCheck } from "@/lib/sim/skills";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useVisitTour } from "@/features/tutorial/use-visit-tour";
import { useCareerRefresh, useSkills } from "../hooks";
import { SkillPaths } from "./skill-paths";

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
  const [focus, setFocus] = useState<SkillBranch | null>(null);
  const [goTo, setGoTo] = useState<{ branch: SkillBranch; n: number } | null>(null);
  /** Paths are the default: easier to read than the map (ADR-105). */
  const [view, setView] = useState<"paths" | "map">("paths");
  const data = skills.data;
  const learned = useMemo(() => new Set(data?.learned.map((l) => l.key) ?? []), [data]);
  useVisitTour("visit_skill_map", Boolean(data));

  if (!data) return <Skeleton className="h-[70dvh] w-full rounded-lg" />;

  return (
    <div className="space-y-5">
      <Card padding="lg" className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div>
            <p className="label-pixel text-fg-3">{t("freePoints")}</p>
            <p className="mt-1 nums text-3xl font-semibold text-fg-1" data-testid="free-points">
              {data.freePoints}
            </p>
          </div>
          <div className="max-w-xs">
            <Badge tone="accent">{t("progressHint", { done: learned.size, total: SKILL_NODES.length })}</Badge>
            <p className="mt-1.5 text-sm text-pretty text-fg-3">{t("freePointsHint")}</p>
          </div>
        </div>
        <Segmented
          value={view}
          onValueChange={setView}
          options={[
            { value: "paths", label: t("view.paths") },
            { value: "map", label: t("view.map") },
          ]}
          label={t("view.label")}
          size="sm"
        />
      </Card>
      {view === "paths" ? (
        <SkillPaths state={data} learned={learned} colors={BRANCH_COLORS} onOpen={setOpen} />
      ) : (
        <div className="grid gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6">
          <HexMap state={data} learned={learned} onOpen={setOpen} focus={focus} goTo={goTo} />
          <div className="space-y-4 lg:order-first lg:col-start-2 lg:row-start-1">
            <Card padding="md">
              <p className="mb-1 label-pixel text-fg-3">{t("overview")}</p>
              <p className="mb-2 text-xs text-fg-3">{t("branchHint")}</p>
              <ul className="-mx-2 space-y-0.5" onPointerLeave={() => setFocus(null)}>
                {SKILL_BRANCHES.map((b) => {
                  const total = SKILL_NODES.filter((n) => n.branches[0] === b).length;
                  const done = SKILL_NODES.filter((n) => n.branches[0] === b && learned.has(n.key)).length;
                  return (
                    <li key={b}>
                      <button
                        type="button"
                        onPointerEnter={() => setFocus(b)}
                        onFocus={() => setFocus(b)}
                        onBlur={() => setFocus(null)}
                        onClick={() => {
                          haptic("tap");
                          setGoTo((g) => ({ branch: b, n: (g?.n ?? 0) + 1 }));
                        }}
                        className={cn(
                          "w-full rounded-md px-2 py-1.5 text-left text-sm focus-ring transition duration-fast active:scale-[0.98]",
                          focus === b ? "bg-surface-2" : "hover:bg-surface-2",
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              aria-hidden
                              className="size-2.5 shrink-0 rounded-xs"
                              style={{ backgroundColor: BRANCH_COLORS[b] }}
                            />
                            <span className="truncate text-fg-2">{branchName(ts, b)}</span>
                            <span className="nums text-xs text-fg-3">
                              {done}/{total}
                            </span>
                          </span>
                          <span className="nums text-fg-1">
                            {data.branchScores[b] ?? 0}
                            {(data.branchPoints[b] ?? 0) > 0 && (
                              <span className="ml-1 text-gold">+{data.branchPoints[b]}</span>
                            )}
                          </span>
                        </span>
                        {data.branchProgress[b] > 0 && (
                          <Progress
                            value={data.branchProgress[b]}
                            label={t("branchPoints")}
                            tone="gold"
                            size="sm"
                            className="mt-1"
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        </div>
      )}
      <LearnSheet skillKey={open} state={data} learned={learned} onClose={() => setOpen(null)} />
    </div>
  );
}

type Hover = { key: string; x: number; y: number };

function HexMap({
  state,
  learned,
  onOpen,
  focus,
  goTo,
}: {
  state: SkillState;
  learned: ReadonlySet<string>;
  onOpen: (key: string) => void;
  focus: SkillBranch | null;
  goTo: { branch: SkillBranch; n: number } | null;
}) {
  const t = useTranslations("skillTree");
  const ts = useTranslations("skills");
  const [view, setView] = useState({ x: 0, y: 0, zoom: START_ZOOM });
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
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

  // A branch in the overview was clicked: glide to its direction.
  const [lastGoTo, setLastGoTo] = useState(goTo);
  if (goTo !== lastGoTo) {
    setLastGoTo(goTo);
    if (goTo) {
      const angle = (MAP_ORDER.indexOf(goTo.branch) * 45 * Math.PI) / 180;
      const d = SIZE * SQRT3 * 4.5;
      setView({ x: -Math.cos(angle) * d, y: Math.sin(angle) * d, zoom: 1 });
    }
  }

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  const zoomBy = (factor: number) => setView((v) => ({ ...v, zoom: clampZoom(v.zoom * factor) }));

  /** Zoom keeping the map point under the pointer in place. */
  const zoomAt = (factor: number, clientX: number, clientY: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return zoomBy(factor);
    const sx = clientX - rect.left - rect.width / 2;
    const sy = clientY - rect.top - rect.height / 2;
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor);
      return { zoom, x: v.x + sx / zoom - sx / v.zoom, y: v.y + sy / zoom - sy / v.zoom };
    });
  };

  const fieldAt = (target: EventTarget | null) =>
    (target as Element | null)?.closest?.("[data-skill]")?.getAttribute("data-skill") ?? null;

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Remember the field before capturing: with pointer capture, later events target the svg itself.
    const key = fieldAt(event.target);
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
    if (!drag.current || !pointers.current.has(event.pointerId)) {
      // Hover (mouse only): a card follows the pointer.
      if (event.pointerType !== "mouse") return;
      const key = fieldAt(event.target);
      const rect = event.currentTarget.getBoundingClientRect();
      setHover(key ? { key, x: event.clientX - rect.left, y: event.clientY - rect.top } : null);
      return;
    }
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
    if (drag.current.moved > 6) {
      setDragging(true);
      setHover(null);
    }
    setView((v) => ({ ...v, x: v.x + dx / v.zoom, y: v.y + dy / v.zoom }));
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      // A short tap without movement opens the field under the pointer.
      const key = drag.current?.key;
      if (drag.current && drag.current.moved < 6 && key) {
        onOpen(key);
        haptic("tap");
        void playSound("tap");
      }
      drag.current = null;
      setDragging(false);
    }
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>) =>
    zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX, event.clientY);

  const showText = view.zoom >= 0.75;
  const hovered = hover ? SKILL_NODES.find((n) => n.key === hover.key) : undefined;

  return (
    <Card padding="none" className="relative overflow-hidden" data-tour="skill-map">
      <svg
        ref={box}
        viewBox={`${-size.w / 2} ${-size.h / 2} ${size.w} ${size.h}`}
        role="application"
        aria-label={t("title")}
        data-testid="skill-map"
        className={cn(
          "block h-[68dvh] max-h-[720px] min-h-[420px] w-full touch-none bg-surface-2 select-none",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onWheel={onWheel}
      >
        <defs>
          <pattern id="skill-dots" width={24} height={24} patternUnits="userSpaceOnUse">
            <circle cx={1} cy={1} r={1} className="fill-line-2" />
          </pattern>
          <radialGradient id="skill-glow">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.16} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </radialGradient>
        </defs>
        <rect x={-size.w / 2} y={-size.h / 2} width={size.w} height={size.h} fill="url(#skill-dots)" opacity={0.5} />
        <g
          style={{
            transform: `scale(${view.zoom}) translate(${view.x}px, ${view.y}px)`,
            transition: dragging ? "none" : "transform var(--duration-slow) var(--ease-standard)",
          }}
        >
          <circle r={SIZE * 6} fill="url(#skill-glow)" />
          {MAP_ORDER.map((b, i) => {
            const angle = (i * 45 * Math.PI) / 180;
            const d = SIZE * SQRT3 * 8.7;
            const dim = focus !== null && focus !== b;
            return (
              <g key={b} opacity={dim ? 0.25 : 1} className="transition-opacity duration-base">
                <line
                  x1={Math.cos(angle) * SIZE * 1.4}
                  y1={-Math.sin(angle) * SIZE * 1.4}
                  x2={Math.cos(angle) * (d - 18)}
                  y2={-Math.sin(angle) * (d - 18)}
                  stroke={BRANCH_COLORS[b]}
                  strokeOpacity={0.18}
                  strokeWidth={SIZE * 1.6}
                  strokeLinecap="round"
                />
                <text
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
              </g>
            );
          })}
          <g>
            <polygon points={HEX} className="fill-surface-1 stroke-accent" strokeWidth={2} />
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
              dim={focus !== null && !node.branches.includes(focus)}
              hovered={hover?.key === node.key}
            />
          ))}
        </g>
      </svg>

      {hover && hovered && !dragging && (
        <HoverCard
          node={hovered}
          check={learnCheck(hovered.key, learned, state.freePoints, state.branchPoints)}
          state={state}
          x={hover.x}
          y={hover.y}
          width={size.w}
        />
      )}

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
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-surface-1/90 px-3 py-2 text-xs text-fg-2 shadow-1 backdrop-blur">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-xs bg-accent" /> {t("legendLearned")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-xs border border-accent" /> {t("legendOpen")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-xs bg-line-2" /> {t("legendLocked")}
        </span>
        <span className="hidden text-fg-3 sm:inline">{t("mapHint")}</span>
      </div>
    </Card>
  );
}

/** A small card next to the pointer: what the field is and whether it can be learned. */
function HoverCard({
  node,
  check,
  state,
  x,
  y,
  width,
}: {
  node: SkillNodeConfig;
  check: LearnCheck;
  state: SkillState;
  x: number;
  y: number;
  width: number;
}) {
  const t = useTranslations("skillTree");
  const ts = useTranslations("skills");
  const cost = skillCost(node);
  const left = x > width - 260;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 w-56 rounded-md border border-line-2 bg-surface-1/95 p-3 shadow-3 backdrop-blur motion-safe:animate-pop"
      style={{ left: left ? x - 236 : x + 18, top: Math.max(8, y - 20) }}
    >
      <p className="font-semibold text-fg-1">{nodeName(ts, node.key)}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-3">
        {node.branches.map((b) => (
          <span key={b} className="inline-flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-xs" style={{ backgroundColor: BRANCH_COLORS[b] }} />
            {branchName(ts, b)}
          </span>
        ))}
        <span>
          · {t(`tierNames.${node.tier}` as `tierNames.${TierKey}`)} {"★".repeat(node.tier)}
        </span>
      </p>
      <p
        className={cn(
          "mt-2 rounded-xs px-2 py-1 text-xs",
          check === "learned" && "bg-accent-soft text-accent",
          check === "ok" && "bg-gain-soft text-gain",
          check === "points" && "bg-warn-soft text-warn",
          check === "locked" && "bg-surface-2 text-fg-3",
        )}
      >
        {check === "learned"
          ? t("learned")
          : check === "ok"
            ? t("hoverOpen", { cost: t("cost", { count: cost }) })
            : check === "points"
              ? t("notEnough", { count: cost - pointsFor(node, state.freePoints, state.branchPoints) })
              : t("hoverLocked")}
      </p>
      <p className="mt-1.5 text-2xs text-fg-3">{t("hoverClick")}</p>
    </div>
  );
}

const Hex = memo(function Hex({
  node,
  check,
  name,
  showText,
  dim,
  hovered,
}: {
  node: SkillNodeConfig;
  check: LearnCheck;
  name: string;
  showText: boolean;
  dim: boolean;
  hovered: boolean;
}) {
  const { x, y } = toPixel(node.q, node.r);
  const color = BRANCH_COLORS[node.branches[0]!];
  const second = node.branches[1] ? BRANCH_COLORS[node.branches[1]] : null;
  const [line1, line2] = label(name);
  const learned = check === "learned";
  const open = check === "ok" || check === "points";
  const opacity = dim ? 0.15 : check === "locked" ? (hovered ? 0.65 : 0.35) : 1;
  return (
    <g
      transform={`translate(${x} ${y})`}
      data-skill={node.key}
      data-state={check}
      className="cursor-pointer"
      style={{ opacity, transition: "opacity var(--duration-base) var(--ease-standard)" }}
    >
      <title>{name}</title>
      <g
        style={{
          transform: hovered ? "scale(1.14)" : "scale(1)",
          transformBox: "fill-box",
          transformOrigin: "center",
          transition: "transform var(--duration-fast) var(--ease-standard)",
        }}
      >
        {check === "ok" && (
          <polygon
            points={HEX}
            fill="none"
            stroke={color}
            strokeWidth={5}
            className="motion-safe:animate-pulse"
            strokeOpacity={0.35}
          />
        )}
        <polygon
          points={HEX}
          fill={learned ? color : open ? `${color}2e` : "var(--bg-1)"}
          stroke={second ?? color}
          strokeWidth={hovered ? 3 : learned ? 1 : open ? 2.5 : 1}
          strokeDasharray={check === "points" ? "4 3" : undefined}
        />
        {learned && (
          <polygon
            points={HEX}
            transform="scale(0.8)"
            fill="none"
            stroke="var(--on-accent)"
            strokeOpacity={0.35}
            strokeWidth={1}
          />
        )}
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
    </g>
  );
});

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
        {check === "locked" && (
          <p className="rounded-md bg-surface-2 px-4 py-3 text-sm text-pretty text-fg-2">
            {t("locked", {
              names: neighbours(node)
                .slice(0, 3)
                .map((n) => nodeName(ts, n.key))
                .join(t("or")),
            })}{" "}
            {t("lockedMap")}
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
        <p className={cn("text-xs text-fg-3")}>
          {t("score", { score: BALANCE.skills.scoreByTier[node.tier - 1] ?? 0 })} ·{" "}
          {node.branches.map((b) => branchName(ts, b)).join(" + ")}
        </p>
      </div>
    </Sheet>
  );
}
