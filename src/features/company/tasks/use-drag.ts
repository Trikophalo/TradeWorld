"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** Moves below this many pixels count as a tap, not a drag. */
const TAP_SLOP = 6;

export interface DragEnd {
  /** `data-drop` of the drop zone under the pointer, null if there is none. */
  zone: string | null;
  dx: number;
  dy: number;
}

/**
 * Pointer drag for a card in the task games (ADR-144): mouse, touch and pen alike. The card follows the pointer via
 * `offset` (render it as a transform); on release the drop zone under the pointer (an element with `data-drop`) is
 * reported. A press without movement is a tap.
 */
export function useDragCard({
  disabled,
  onDrop,
  onTap,
}: {
  disabled?: boolean;
  onDrop: (end: DragEnd) => void;
  onTap?: () => void;
}) {
  const start = useRef<{ x: number; y: number; id: number; moved: boolean } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const finish = (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const s = start.current;
    if (!s || s.id !== event.pointerId) return;
    start.current = null;
    const dx = event.clientX - s.x;
    const dy = event.clientY - s.y;
    setOffset({ x: 0, y: 0 });
    setDragging(false);
    if (cancelled) return;
    if (!s.moved) {
      onTap?.();
      return;
    }
    const self = event.currentTarget;
    const hit = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((el) => !self.contains(el) && el.closest("[data-drop]"));
    onDrop({ zone: hit?.closest("[data-drop]")?.getAttribute("data-drop") ?? null, dx, dy });
  };

  return {
    offset,
    dragging,
    handlers: {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
        start.current = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const s = start.current;
        if (!s || s.id !== event.pointerId) return;
        const dx = event.clientX - s.x;
        const dy = event.clientY - s.y;
        if (!s.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
        if (!s.moved) {
          s.moved = true;
          setDragging(true);
        }
        setOffset({ x: dx, y: dy });
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => finish(event, false),
      onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => finish(event, true),
    },
  };
}
