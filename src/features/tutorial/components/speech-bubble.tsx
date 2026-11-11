"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Mascot } from "@/components/pixel/mascot";
import { prefersReducedMotion } from "@/stores/settings";
import { cn } from "@/lib/utils";

const CHARS_PER_TICK = 3;
const TICK_MS = 20;

export interface SpeechBubbleProps {
  name: string;
  text: string;
  mood?: "happy";
  /** Large, centred variant for the first and the last step. */
  hero?: boolean;
  footer?: ReactNode;
}

/**
 * Finn with a speech bubble. The text is typed out; a tap on the bubble shows
 * the rest at once. Screen readers get the full text immediately.
 */
export function SpeechBubble({ name, text, mood, hero, footer }: SpeechBubbleProps) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? text.length : 0));
  const typing = shown < text.length;

  useEffect(() => {
    if (!typing) return;
    const timer = window.setInterval(() => setShown((count) => Math.min(text.length, count + CHARS_PER_TICK)), TICK_MS);
    return () => window.clearInterval(timer);
  }, [typing, text.length]);

  return (
    <div className={cn("flex items-end gap-2", hero && "flex-col items-center gap-4")}>
      <Mascot mood={mood ?? (typing ? "talk" : "idle")} scale={hero ? 6 : 4} className="shrink-0" />
      <div
        onClick={() => setShown(text.length)}
        className={cn(
          "relative min-w-0 flex-1 rounded-lg border border-line-2 bg-surface-2 p-4 shadow-3",
          hero && "w-full flex-none text-center",
        )}
      >
        {/* Tail pointing at Finn */}
        <span
          aria-hidden
          className={cn(
            "absolute size-3 rotate-45 border-line-2 bg-surface-2",
            hero ? "-top-1.5 left-1/2 -ml-1.5 border-t border-l" : "bottom-5 -left-1.5 border-b border-l",
          )}
        />
        <p className="label-pixel text-accent">{name}</p>
        <p className="sr-only" role="status">
          {text}
        </p>
        <p aria-hidden className={cn("mt-1 text-pretty text-fg-1", hero ? "text-lg" : "text-base")}>
          {text.slice(0, shown)}
          {/* Reserve the final height so the bubble does not grow while typing. */}
          <span className="invisible">{text.slice(shown)}</span>
        </p>
        {footer && (
          <div className={cn("mt-3 flex items-center justify-between gap-3", hero && "flex-col")}>{footer}</div>
        )}
      </div>
    </div>
  );
}
