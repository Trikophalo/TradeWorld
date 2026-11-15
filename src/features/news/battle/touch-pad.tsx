"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type PointerEvent } from "react";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/*
 * Touch controls of the action games (ADR-160): a joystick that snaps to the four directions of the grid, and an
 * action button (Sumo: Rempler). Pointer events, so a mouse works too; the page does not scroll under them.
 */
const DEAD_ZONE = 14;

function dirOf(dx: number, dy: number): number {
  if (Math.hypot(dx, dy) < DEAD_ZONE) return 0;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 4) : dy > 0 ? 3 : 1;
}

export function TouchPad({
  onChange,
  action,
  className,
}: {
  onChange: (dir: number, action: boolean) => void;
  /** Label of the action button; none when the game has no action. */
  action?: string | null;
  className?: string;
}) {
  const t = useTranslations("battle.controls");
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [dir, setDir] = useState(0);
  const [pressed, setPressed] = useState(false);
  const state = useRef({ dir: 0, action: false });

  const update = (next: { dir?: number; action?: boolean }) => {
    const merged = { ...state.current, ...next };
    if (merged.dir !== state.current.dir || merged.action !== state.current.action) {
      if (merged.dir !== state.current.dir && merged.dir !== 0) haptic("tap");
      state.current = merged;
      onChange(merged.dir, merged.action);
    }
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const el = base.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = event.clientX - (r.left + r.width / 2);
    const dy = event.clientY - (r.top + r.height / 2);
    const max = r.width / 2 - 18;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, max / len);
    setKnob({ x: dx * k, y: dy * k });
    const d = dirOf(dx, dy);
    setDir(d);
    update({ dir: d });
  };
  const release = () => {
    setKnob({ x: 0, y: 0 });
    setDir(0);
    update({ dir: 0 });
  };

  return (
    <div className={cn("flex items-center justify-between gap-6 select-none", className)} data-testid="battle-touch">
      <div
        ref={base}
        role="application"
        aria-label={t("joystick")}
        className="relative size-36 touch-none rounded-full border-2 border-line-2 bg-surface-2 shadow-2"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        {[1, 2, 3, 4].map((d) => (
          <span
            key={d}
            aria-hidden
            className={cn(
              "absolute size-0 border-8 border-transparent transition-opacity duration-fast",
              d === 1 && "top-2 left-1/2 -translate-x-1/2 border-b-fg-3",
              d === 3 && "bottom-2 left-1/2 -translate-x-1/2 border-t-fg-3",
              d === 2 && "top-1/2 right-2 -translate-y-1/2 border-l-fg-3",
              d === 4 && "top-1/2 left-2 -translate-y-1/2 border-r-fg-3",
              dir === d ? "opacity-100" : "opacity-40",
            )}
          />
        ))}
        <span
          aria-hidden
          className="absolute top-1/2 left-1/2 -mt-8 -ml-8 size-16 rounded-full border-2 border-accent bg-accent-soft shadow-2"
          style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        />
      </div>
      {action ? (
        <button
          type="button"
          className={cn(
            "grid size-24 touch-none place-items-center rounded-full border-2 font-pixel text-xs text-on-accent uppercase shadow-2",
            "border-accent-strong bg-accent-strong focus-ring transition-transform duration-instant",
            pressed ? "scale-90" : "scale-100",
          )}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setPressed(true);
            haptic("tap");
            update({ action: true });
          }}
          onPointerUp={() => {
            setPressed(false);
            update({ action: false });
          }}
          onPointerCancel={() => {
            setPressed(false);
            update({ action: false });
          }}
        >
          {action}
        </button>
      ) : (
        <span aria-hidden className="size-24" />
      )}
    </div>
  );
}
