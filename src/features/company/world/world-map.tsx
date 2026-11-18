"use client";

import { useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { flagArt, hqArt, companyInitials } from "@/components/pixel/hq";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { COUNTRIES } from "@/config/countries";
import type { WorldPlace } from "@/features/game/world-types";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { cellOf, MAP_COLS, MAP_ROWS, worldMapArt } from "./land";
import { placesByCountry } from "./hooks";

const ZOOMS = [1, 2, 3] as const;

/** The pixel art of the first place of a country: its headquarters building (or a small office). */
export function placeArt(p: WorldPlace) {
  const country = COUNTRIES.find((c) => c.key === p.country);
  return hqArt({
    tier: p.kind === "hq" ? p.hqTier : 0,
    wall: p.hqStyle.wall,
    roof: p.hqStyle.roof,
    sign: p.hqStyle.sign,
    roofKind: p.kind === "hq" ? p.hqStyle.roofKind : "flat",
    deco: p.kind === "hq" ? p.hqStyle.deco : "none",
    flag: p.kind === "hq" && p.hqStyle.flag && country ? country.flag : null,
    flagVertical: country?.flagVertical,
    initials: companyInitials(p.name),
  });
}

/**
 * The world map (ADR-208): a pixel map with every country as a button. Countries with companies show the building of
 * the first one and a count. Drag to pan, pinch or wheel to zoom (whole steps only: pixel art scales by integers),
 * buttons for keyboard and mouse. Tapping a country calls onSelect.
 */
export function WorldMap({
  places,
  selected,
  focus,
  onSelect,
  className,
}: {
  places: readonly WorldPlace[];
  selected?: string | null;
  /** Country to center on first (the own headquarters). */
  focus?: string | null;
  onSelect: (country: string) => void;
  className?: string;
}) {
  const t = useTranslations("world.map");
  const reduced = Boolean(useReducedMotionConfig());
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 358, h: 260 });
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; px: number; py: number; dist: number; moved: number } | null>(null);
  const centered = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Whole pixels per map cell: fills the box at zoom 1, times the zoom step.
  const base = Math.max(3, Math.ceil(Math.max(size.w / MAP_COLS, size.h / MAP_ROWS)));
  const cell = base * zoom;
  const mapW = MAP_COLS * cell;
  const mapH = MAP_ROWS * cell;

  const clamp = useCallback(
    (x: number, y: number, c = cell) => ({
      x: Math.round(Math.min(0, Math.max(size.w - MAP_COLS * c, x))),
      y: Math.round(Math.min(0, Math.max(size.h - MAP_ROWS * c, y))),
    }),
    [cell, size.w, size.h],
  );

  // the map always stays inside the box, whatever the box size or the zoom
  const shown = clamp(pan.x, pan.y);

  const centerOn = useCallback(
    (country: string | null | undefined, c = cell) => {
      const k = COUNTRIES.find((x) => x.key === country);
      const at = k ? cellOf(k.map) : { col: MAP_COLS / 2 - 0.5, row: MAP_ROWS / 3 };
      setPan(clamp(size.w / 2 - (at.col + 0.5) * c, size.h / 2 - (at.row + 0.5) * c, c));
    },
    [cell, clamp, size.w, size.h],
  );

  useEffect(() => {
    if (centered.current || size.w <= 0) return;
    centered.current = true;
    centerOn(focus ?? "de");
  }, [centerOn, focus, size.w]);

  const zoomTo = useCallback(
    (next: number, anchor?: { x: number; y: number }) => {
      const z = Math.min(ZOOMS.at(-1)!, Math.max(ZOOMS[0], next));
      if (z === zoom) return;
      const a = anchor ?? { x: size.w / 2, y: size.h / 2 };
      const nc = base * z;
      const ratio = nc / cell;
      setZoom(z);
      setPan(clamp(a.x - (a.x - shown.x) * ratio, a.y - (a.y - shown.y) * ratio, nc));
      haptic("tap");
    },
    [base, cell, clamp, shown.x, shown.y, size.w, size.h, zoom],
  );

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const dist = pts.length > 1 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0;
    gesture.current = {
      x: pts[0]!.x,
      y: pts[0]!.y,
      px: shown.x,
      py: shown.y,
      dist,
      moved: gesture.current?.moved ?? 0,
    };
    if (pts.length === 1) gesture.current.moved = 0;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length >= 2) {
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      const mid = { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };
      g.moved += 10;
      if (g.dist > 0 && dist / g.dist > 1.35) {
        zoomTo(zoom + 1, mid);
        g.dist = dist;
      } else if (g.dist > 0 && dist / g.dist < 0.74) {
        zoomTo(zoom - 1, mid);
        g.dist = dist;
      }
      return;
    }
    const p = pts[0]!;
    const dx = p.x - g.x;
    const dy = p.y - g.y;
    g.moved = Math.max(g.moved, Math.hypot(dx, dy));
    if (g.moved > 4) {
      if (!dragging) {
        setDragging(true);
        box.current?.setPointerCapture?.(e.pointerId);
      }
      setPan(clamp(g.px + dx, g.py + dy));
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setDragging(false);
    const rest = [...pointers.current.values()][0];
    if (rest && gesture.current)
      gesture.current = { ...gesture.current, x: rest.x, y: rest.y, px: shown.x, py: shown.y };
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) < 4) return;
    zoomTo(zoom + (e.deltaY < 0 ? 1 : -1), local(e));
  };

  const byCountry = useMemo(() => placesByCountry(places), [places]);
  const land = useMemo(() => worldMapArt(), []);
  const pick = (key: string) => {
    // a drag that ended on a marker is not a tap
    if ((gesture.current?.moved ?? 0) > 6) return;
    haptic("tap");
    onSelect(key);
  };

  return (
    <div className={cn("space-y-2", className)} id="world-map" data-testid="world-map">
      <div
        ref={box}
        role="group"
        aria-label={t("label")}
        className={cn(
          "relative h-64 touch-none overflow-hidden rounded-lg bg-surface-2 ring-1 ring-line-1 select-none sm:h-80 lg:h-96",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        data-zoom={zoom}
      >
        <div
          className={cn(
            "absolute top-0 left-0 will-change-transform",
            !dragging && !reduced && "transition-transform duration-fast ease-out",
          )}
          style={{ width: mapW, height: mapH, transform: `translate3d(${shown.x}px, ${shown.y}px, 0)` }}
        >
          <PixelIcon {...land} scale={cell} className="absolute inset-0" />
          {COUNTRIES.map((c) => {
            const list = byCountry.get(c.key) ?? [];
            const first = list[0];
            const mine = list.some((p) => p.mine);
            const active = selected === c.key;
            return (
              <button
                key={c.key}
                type="button"
                data-testid={`world-country-${c.key}`}
                data-count={list.length}
                aria-label={t("marker", { country: c.name, companies: t("companies", { count: list.length }) })}
                aria-pressed={active}
                onClick={() => pick(c.key)}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  gesture.current = null;
                }}
                onPointerUp={(e) => e.stopPropagation()}
                className={cn(
                  "group absolute flex -translate-x-1/2 -translate-y-full flex-col items-center rounded-sm focus-ring transition-transform duration-fast hover:-translate-y-[calc(100%+2px)] active:scale-95",
                  active && "z-10",
                )}
                style={{ left: Math.round((c.map.x / 100) * mapW), top: Math.round((c.map.y / 100) * mapH) + 4 }}
              >
                {first ? (
                  <span
                    className={cn(
                      "relative rounded-sm bg-surface-1/80 p-0.5 ring-1",
                      mine ? "ring-accent" : active ? "ring-fg-2" : "ring-line-2",
                    )}
                  >
                    <PixelIcon {...placeArt(first)} scale={zoom >= 2 ? 2 : 1} />
                    {list.length > 1 && (
                      <span className="absolute -top-1.5 -right-1.5 rounded-pill bg-accent px-1 nums text-2xs leading-4 text-on-accent">
                        {list.length}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className={cn("rounded-xs p-px ring-1", active ? "ring-accent" : "ring-line-2")}>
                    <PixelIcon {...flagArt(c.flag, c.flagVertical)} scale={zoom >= 2 ? 3 : 2} />
                  </span>
                )}
                {(zoom >= 2 || active) && (
                  <span className="mt-0.5 max-w-24 truncate rounded-xs bg-surface-1/90 px-1 text-2xs font-medium text-fg-1">
                    {c.name}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="absolute right-2 bottom-2 flex flex-col gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <MapButton label={t("zoomIn")} disabled={zoom >= ZOOMS.at(-1)!} onClick={() => zoomTo(zoom + 1)}>
            +
          </MapButton>
          <MapButton label={t("zoomOut")} disabled={zoom <= ZOOMS[0]} onClick={() => zoomTo(zoom - 1)}>
            −
          </MapButton>
          <MapButton
            label={t("reset")}
            onClick={() => {
              setZoom(1);
              centerOn(focus ?? "de", base);
            }}
          >
            ⌂
          </MapButton>
        </div>
      </div>
      <p className="text-2xs text-pretty text-fg-3">{t("hint")}</p>
    </div>
  );
}

function MapButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-md bg-surface-1 font-semibold text-fg-1 shadow-1 ring-1 ring-line-2 focus-ring transition duration-fast hover:bg-surface-3 active:scale-95 disabled:opacity-40"
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}
