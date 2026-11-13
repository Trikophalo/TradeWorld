"use client";

import { Slider as RadixSlider } from "radix-ui";
import { useRef } from "react";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";

export interface SliderProps {
  /** 0 to 1 */
  value: number;
  onValueChange: (value: number) => void;
  label: string;
  /** Marks with a soft tick when crossed, e.g. [0.25, 0.5, 0.75, 1]. */
  marks?: readonly number[];
  disabled?: boolean;
  /** Text inside the thumb tooltip, e.g. "50 %". */
  valueText?: string;
  tone?: "accent" | "gain" | "loss";
  className?: string;
}

const TONES = {
  accent: { range: "bg-accent", thumb: "border-accent" },
  gain: { range: "bg-gain", thumb: "border-gain" },
  loss: { range: "bg-loss", thumb: "border-loss" },
} as const;

/**
 * Amount slider for touch and mouse. Crossing a mark gives a tiny tick
 * (sound and vibration), so the quarters can be found without looking.
 * Arrow keys move by 1 %, Page Up/Down by 10 %.
 */
export function Slider({
  value,
  onValueChange,
  label,
  marks = [],
  disabled,
  valueText,
  tone = "accent",
  className,
}: SliderProps) {
  const last = useRef(value);
  const styles = TONES[tone];

  const change = (next: number) => {
    const before = last.current;
    last.current = next;
    if (marks.some((mark) => (before < mark && next >= mark) || (before > mark && next <= mark))) {
      haptic("tap");
      void playSound("tap");
    }
    onValueChange(next);
  };

  return (
    <RadixSlider.Root
      // Inside a sheet: dragging the thumb sideways must not drag the sheet away.
      data-vaul-no-drag
      value={[Math.round(value * 1000)]}
      onValueChange={([next]) => change((next ?? 0) / 1000)}
      min={0}
      max={1000}
      step={1}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "relative flex h-10 w-full touch-none items-center select-none data-[disabled]:opacity-40",
        className,
      )}
    >
      <RadixSlider.Track className="relative h-2 grow overflow-hidden rounded-pill bg-surface-3">
        <RadixSlider.Range className={cn("absolute h-full", styles.range)} />
      </RadixSlider.Track>
      {marks.map((mark) => (
        <span
          key={mark}
          aria-hidden
          className={cn(
            "pointer-events-none absolute size-1.5 -translate-x-1/2 rounded-pill transition-colors duration-fast",
            value >= mark ? "bg-on-accent/80" : "bg-line-2",
          )}
          style={{ left: `${mark * 100}%` }}
        />
      ))}
      <RadixSlider.Thumb
        aria-valuetext={valueText}
        className={cn(
          "group relative block size-6 rounded-pill border-4 bg-surface-1 shadow-2 focus-ring transition-transform duration-fast ease-out active:scale-110",
          styles.thumb,
        )}
      >
        {valueText && (
          <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-xs bg-inverse px-1.5 py-0.5 nums text-xs whitespace-nowrap text-fg-inverse opacity-0 transition-opacity duration-fast group-focus-visible:opacity-100 group-active:opacity-100">
            {valueText}
          </span>
        )}
      </RadixSlider.Thumb>
    </RadixSlider.Root>
  );
}
