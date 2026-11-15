"use client";

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { PlayerFigure } from "@/components/ui/player-figure";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/*
 * A pixel speech bubble and a dressed player figure with one above it (ADR-157). Used by the studio audience of the
 * news show; anywhere else that people should be seen talking can use it too.
 */

export interface SpeechBubbleProps {
  /** Who says it (in front of the text, like in a comic caption), optional. */
  author?: ReactNode;
  children: ReactNode;
  /** Horizontal position of the tail inside the bubble, in px from its left edge. Default: the middle. */
  tailX?: number;
  /** A longer tail down to the speaker, in px (for bubbles stacked above others). */
  stem?: number;
  /** Lines of text at most (the rest is cut with "…"). Default 2. */
  lines?: 1 | 2 | 3;
  tone?: "default" | "accent";
  className?: string;
  style?: CSSProperties;
}

/** A small comic bubble with a stepped pixel tail pointing down. Content only; position it from outside. */
export function SpeechBubble({
  author,
  children,
  tailX,
  stem = 0,
  lines = 2,
  tone = "default",
  className,
  style,
}: SpeechBubbleProps) {
  const fill = tone === "accent" ? "bg-accent-soft" : "bg-surface-1";
  const left = tailX === undefined ? "50%" : tailX;
  return (
    <div className={cn("relative", className)} style={style}>
      <div className={cn("relative z-10 rounded-xs border-2 border-fg-1 px-2 py-1 shadow-1", fill)}>
        <p
          className={cn(
            "text-xs leading-4 break-words text-fg-1",
            lines === 1 ? "line-clamp-1" : lines === 2 ? "line-clamp-2" : "line-clamp-3",
          )}
        >
          {author && <span className="font-semibold text-fg-2">{author}: </span>}
          {children}
        </p>
      </div>
      {/* the tail: three pixel steps, then an optional stem down to the speaker */}
      <span aria-hidden className="absolute top-full z-20 -mt-0.5 -translate-x-1/2" style={{ left }}>
        <span className="mx-auto flex h-0.5 w-2.5 justify-center bg-fg-1">
          <span className={cn("h-full w-1.5", fill)} />
        </span>
        <span className="mx-auto flex h-0.5 w-1.5 justify-center bg-fg-1">
          <span className={cn("h-full w-0.5", fill)} />
        </span>
        <span className="mx-auto block h-0.5 w-0.5 bg-fg-1" />
        {stem > 0 && <span className="mx-auto block w-0.5 bg-fg-3" style={{ height: stem }} />}
      </span>
    </div>
  );
}

export interface FigureBubbleProps {
  avatarKey: string | null | undefined;
  accessories?: readonly string[];
  /** Whole-number scale of the 24×32 figure. Default 3. */
  scale?: number;
  /** What the figure says right now; a new `bubbleKey` pops a new bubble. Null: silent. */
  bubble?: { key: string | number; text: ReactNode; author?: ReactNode } | null;
  /** Where the bubble sits over the figure, so it stays inside narrow containers. Default "center". */
  align?: "start" | "center" | "end";
  /** Width of the bubble in px. Default 160. */
  bubbleWidth?: number;
  /** Under the feet (a name, a badge). */
  label?: ReactNode;
  title?: string;
  className?: string;
}

/** A dressed figure with a speech bubble above it that pops in and fades out. */
export function FigureBubble({
  avatarKey,
  accessories,
  scale = 3,
  bubble,
  align = "center",
  bubbleWidth = 160,
  label,
  title,
  className,
}: FigureBubbleProps) {
  const reduced = Boolean(useReducedMotionConfig());
  const width = 24 * scale;
  const tailX = align === "start" ? width / 2 : align === "end" ? bubbleWidth - width / 2 : bubbleWidth / 2;
  return (
    <div className={cn("relative inline-flex flex-col items-center", className)} style={{ width }}>
      <AnimatePresence>
        {bubble && (
          <motion.div
            key={bubble.key}
            className={cn(
              "absolute bottom-full mb-1",
              align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -ml-(--half)",
            )}
            style={{ width: bubbleWidth, "--half": `${bubbleWidth / 2}px` } as CSSProperties}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.base, ease: EASE.out }}
            data-testid="figure-bubble"
          >
            <SpeechBubble author={bubble.author} tailX={tailX}>
              {bubble.text}
            </SpeechBubble>
          </motion.div>
        )}
      </AnimatePresence>
      <PlayerFigure avatarKey={avatarKey} accessories={accessories} scale={scale} title={title} className="block" />
      {label}
    </div>
  );
}
