"use client";

import { useTranslations } from "next-intl";
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
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
import {
  learnCheck,
  payForSkill,
  pointsFor,
  prerequisites,
  skillCost,
  unlocksSkills,
  type LearnCheck,
} from "@/lib/sim/skills";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useVisitTour } from "@/features/tutorial/use-visit-tour";
import { useCareerRefresh, useSkills } from "../hooks";
import { NextSkills } from "./skill-paths";

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
/** Tiles are a little smaller than their field, so the paths between them show. */
const TILE = 0.84;
const HEX = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return `${(SIZE * TILE * Math.cos(a)).toFixed(2)},${(SIZE * TILE * Math.sin(a)).toFixed(2)}`;
}).join(" ");
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const START_ZOOM = 1.2;

const SOFT = "\u00ad";
const LINE_MAX = 11;
const plain = (name: string) => name.replaceAll(SOFT, "");

/**
 * Up to three short lines for a tile. Names break at spaces, at hyphens and at the soft hyphens the texts carry
 * for long words ("Software\u00adarchitektur" becomes "Software-" and "architektur").
 */
export function hexLabel(name: string): string[] {
  const pieces = [...name.matchAll(/([^\s\u00ad-]+)([\s\u00ad-]?)/g)].map((m) => ({ text: m[1]!, sep: m[2] ?? "" }));
  const lines: string[] = [];
  let line = "";
  let sep = "";
  for (const piece of pieces) {
    const joined = line + (sep === SOFT ? "" : sep) + piece.text;
    if (line === "" || joined.length <= LINE_MAX) {
      line = line === "" ? piece.text : joined;
    } else {
      lines.push(sep === " " ? line : `${line}-`);
      line = piece.text;
    }
    sep = piece.sep;
  }
  if (line) lines.push(line);
  return lines.length > 3 ? [lines[0]!, lines[1]!, `${lines[2]!.slice(0, LINE_MAX - 1)}.`] : lines;
}

/** Every step of the order of learning (ADR-115): from a skill to the one it opens. */
const PATHS = SKILL_NODES.flatMap((node) =>
  node.requires.flatMap((key) => {
    const from = SKILL_NODES.find((n) => n.key === key);
    return from ? [{ from, to: node }] : [];
  }),
);

/**
 * The skills page: the map is always there (owner decision, ADR-115). Around it: the points, what can be learned
 * now, and the eight areas.
 */
export function SkillTree() {
  const t = useTranslations("skillTree");
  const ts = useTranslations("skills");
  const skills = useSkills();
  const [open, setOpen] = useState<string | null>(null);
  const [focus, setFocus] = useState<SkillBranch | null>(null);
  const [goTo, setGoTo] = useState<{ branch: SkillBranch; n: number } | null>(null);
  const data = skills.data;
  const learned = useMemo(() => new Set(data?.learned.map((l) => l.key) ?? []), [data]);
  useVisitTour("visit_skill_map", Boolean(data));

  if (!data) return <Skeleton className="h-[70dvh] w-full rounded-lg" />;

  return (
    <div className="space-y-5">
      <Card padding="lg" className="flex flex-wrap items-center gap-4">
        <div>
          <p className="label-pixel text-fg-3">{t("freePoints")}</p>
          <p className="mt-1 nums text-3xl font-semibold text-fg-1" data-testid="free-points">
            {data.freePoints}
          </p>
        </div>
        <div className="max-w-md min-w-0 flex-1">
          <Badge tone="accent">{t("progressHint", { done: learned.size, total: SKILL_NODES.length })}</Badge>
          <p className="mt-1.5 text-sm text-pretty text-fg-3">{t("freePointsHint")}</p>
        </div>
      </Card>
      <div className="grid gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6">
        <HexMap state={data} learned={learned} onOpen={setOpen} focus={focus} goTo={goTo} />
        <Card padding="md" className="self-start">
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
                    data-branch={b}
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
      <NextSkills state={data} learned={learned} colors={BRANCH_COLORS} onOpen={setOpen} />
      <LearnSheet skillKey={open} state={data} learned={learned} onOpen={setOpen} onClose={() => setOpen(null)} />
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

  // The wheel zooms the map and must not scroll the page. React listens passively, so the listener is set by hand.
  const zoomAtRef = useRef(zoomAt);
  useEffect(() => {
    zoomAtRef.current = zoomAt;
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      zoomAtRef.current(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX, event.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

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
          {/* The order of learning: a path from every skill to the ones it opens. */}
          <g strokeLinecap="round">
            {PATHS.map(({ from, to }) => {
              const a = toPixel(from.q, from.r);
              const b = toPixel(to.q, to.r);
              const walked = learned.has(from.key) && learned.has(to.key);
              const ahead = learned.has(from.key) && !learned.has(to.key);
              const dim = focus !== null && !to.branches.includes(focus);
              return (
                <line
                  key={`${from.key}>${to.key}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={walked ? "var(--fg-1)" : ahead ? "var(--fg-2)" : "var(--line-2)"}
                  strokeWidth={walked ? 5 : 4}
                  strokeDasharray={ahead ? "1 7" : undefined}
                  opacity={dim ? 0.15 : 1}
                  className="transition-opacity duration-base"
                />
              );
            })}
          </g>
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
                className="font-pixel uppercase transition-opacity duration-base"
                fontSize={13}
                fill={BRANCH_COLORS[b]}
                opacity={focus !== null && focus !== b ? 0.25 : 1}
              >
                {branchName(ts, b)}
              </text>
            );
          })}
          <g>
            <polygon points={HEX} transform="translate(0 3)" fill="var(--edge)" />
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
          learned={learned}
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
          <span aria-hidden className="size-2.5 rounded-xs border border-line-2 bg-surface-1" /> {t("legendLocked")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 rounded-pill bg-fg-2" /> {t("legendPath")}
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
  learned,
  x,
  y,
  width,
}: {
  node: SkillNodeConfig;
  learned: ReadonlySet<string>;
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
        <span>· {t(`tierNames.${node.tier}` as `tierNames.${TierKey}`)}</span>
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
              : t("hoverLocked", {
                  names: prerequisites(node)
                    .filter((p) => !learned.has(p.key))
                    .map((p) => nodeName(ts, p.key))
                    .join(t("and")),
                })}
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
  const lines = hexLabel(name);
  const learned = check === "learned";
  const open = check === "ok" || check === "points";
  const locked = !learned && !open;
  return (
    <g
      transform={`translate(${x} ${y})`}
      data-skill={node.key}
      data-state={check}
      className="cursor-pointer"
      style={{ opacity: dim ? 0.2 : 1, transition: "opacity var(--duration-base) var(--ease-standard)" }}
    >
      <title>{plain(name)}</title>
      <g
        style={{
          transform: hovered ? "translateY(-2px) scale(1.1)" : "none",
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
            strokeWidth={6}
            strokeOpacity={0.35}
            className="motion-safe:animate-pulse"
          />
        )}
        {/* A tile with weight: a hard edge underneath, like every panel (ADR-108). */}
        <polygon points={HEX} transform="translate(0 3)" fill="var(--edge)" />
        <polygon points={HEX} fill={learned ? color : locked ? "var(--color-surface-3)" : "var(--color-surface-1)"} />
        {!learned && <polygon points={HEX} fill={color} fillOpacity={open ? 0.2 : 0.06} />}
        <polygon
          points={HEX}
          fill="none"
          stroke={locked ? "var(--line-2)" : (second ?? color)}
          strokeWidth={locked ? 1 : hovered ? 3 : 2}
          strokeDasharray={check === "points" ? "4 3" : undefined}
        />
        {learned && (
          <polygon points={HEX} transform="scale(0.84)" fill="none" stroke="var(--shine)" strokeWidth={1.5} />
        )}
        {showText ? (
          <text
            textAnchor="middle"
            fontSize={7.2}
            className={learned ? "fill-on-accent font-medium" : locked ? "fill-fg-2" : "fill-fg-1 font-medium"}
            pointerEvents="none"
          >
            {lines.map((line, i) => (
              <tspan key={i} x={0} y={(i - (lines.length - 1) / 2) * 8 + 1}>
                {line}
              </tspan>
            ))}
          </text>
        ) : null}
        {/* Tier as small pips at the foot of the tile. */}
        <g pointerEvents="none" opacity={locked ? 0.5 : 1}>
          {Array.from({ length: node.tier }, (_, i) => (
            <rect
              key={i}
              x={(i - (node.tier - 1) / 2) * 4.5 - 1.5}
              y={showText ? 16.5 : -1.5}
              width={3}
              height={3}
              fill={learned ? "var(--on-accent)" : locked ? "var(--fg-3)" : color}
            />
          ))}
        </g>
      </g>
    </g>
  );
});

function LearnSheet({
  skillKey,
  state,
  learned,
  onOpen,
  onClose,
}: {
  skillKey: string | null;
  state: SkillState;
  learned: ReadonlySet<string>;
  /** Jump to another skill, e.g. a missing prerequisite. */
  onOpen: (key: string) => void;
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
  const before = prerequisites(node);
  const after = unlocksSkills(node);

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
      title={plain(nodeName(ts, node.key))}
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
        {before.length > 0 && (
          <div data-testid="skill-requires">
            <p className="label-pixel text-fg-3">{t("requires")}</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {before.map((p) => {
                const done = learned.has(p.key);
                return (
                  <li key={p.key}>
                    <button
                      type="button"
                      data-requires={p.key}
                      data-done={done}
                      onClick={() => {
                        haptic("tap");
                        onOpen(p.key);
                      }}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md border-2 px-2.5 py-1 text-sm focus-ring transition duration-fast hover:-translate-y-0.5 active:translate-y-0",
                        done ? "border-gain bg-gain-soft text-gain" : "border-line-2 bg-surface-2 text-fg-1",
                      )}
                    >
                      <span aria-hidden>{done ? "✓" : "→"}</span>
                      {nodeName(ts, p.key)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {check === "locked" && (
          <p className="rounded-md bg-surface-2 px-4 py-3 text-sm text-pretty text-fg-2" data-testid="skill-locked">
            {t("locked", {
              names: before
                .filter((p) => !learned.has(p.key))
                .map((p) => nodeName(ts, p.key))
                .join(t("and")),
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
        {after.length > 0 && (
          <div>
            <p className="label-pixel text-fg-3">{t("unlocks")}</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {after.map((n) => (
                <li key={n.key}>
                  <button
                    type="button"
                    onClick={() => {
                      haptic("tap");
                      onOpen(n.key);
                    }}
                    className="rounded-md border border-line-1 bg-surface-2 px-2.5 py-1 text-sm text-fg-2 focus-ring transition duration-fast hover:text-fg-1 active:scale-95"
                  >
                    {nodeName(ts, n.key)}
                  </button>
                </li>
              ))}
            </ul>
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
