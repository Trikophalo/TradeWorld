"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

const WIDTH = 300;
const HEIGHT = 100;
/** Ink needed before the signature counts (sum of stroke lengths in view units). */
export const MIN_INK = 60;

/**
 * Symbolic signature (ADR-051): draw with finger or mouse. It has no legal
 * meaning; it makes signing a deliberate act. The result is SVG path data.
 */
export function SignaturePad({
  onChange,
  className,
}: {
  onChange: (path: string, ink: number) => void;
  className?: string;
}) {
  const t = useTranslations("jobs");
  const [path, setPath] = useState("");
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const ink = useRef(0);
  const current = useRef("");

  const point = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * WIDTH),
      y: Math.round(((event.clientY - rect.top) / rect.height) * HEIGHT),
    };
  };

  const add = (segment: string, length: number) => {
    ink.current += length;
    current.current = `${current.current}${segment}`.slice(0, 8000);
    setPath(current.current);
    onChange(current.current, ink.current);
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between">
        <span className="label-pixel text-fg-2">{t("signHere")}</span>
        <button
          type="button"
          onClick={() => {
            ink.current = 0;
            current.current = "";
            setPath("");
            onChange("", 0);
          }}
          className="rounded-xs px-1.5 text-xs text-fg-3 focus-ring transition-colors duration-fast hover:text-fg-1"
        >
          {t("signClear")}
        </button>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={t("signHere")}
        data-testid="signature-pad"
        data-vaul-no-drag=""
        className="block aspect-[3/1] w-full touch-none rounded-md border border-dashed border-line-2 bg-surface-2 text-fg-1"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          const p = point(event);
          last.current = p;
          add(`M${p.x} ${p.y}`, 0);
        }}
        onPointerMove={(event) => {
          if (!drawing.current || !last.current) return;
          const p = point(event);
          const length = Math.hypot(p.x - last.current.x, p.y - last.current.y);
          if (length < 2) return;
          last.current = p;
          add(`L${p.x} ${p.y}`, length);
        }}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
        }}
        onPointerCancel={() => {
          drawing.current = false;
          last.current = null;
        }}
      >
        <line x1="16" x2={WIDTH - 16} y1={HEIGHT - 22} y2={HEIGHT - 22} className="stroke-line-2" strokeWidth={1} />
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p className="text-xs text-fg-3">{t("signHint")}</p>
    </div>
  );
}
