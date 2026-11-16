"use client";

import { Tooltip as RadixTooltip } from "radix-ui";
import { useState, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TooltipProps {
  /** What the bubble says. */
  content: ReactNode;
  /** The element the bubble belongs to: it must be focusable (a button or a link). */
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  testId?: string;
  className?: string;
}

/**
 * A small bubble with details about an element: it shows on hover, on keyboard focus and, on touch screens, on a
 * tap (a tap elsewhere closes it). It never holds anything that cannot be reached another way.
 */
export function Tooltip({ content, children, side = "top", testId, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <RadixTooltip.Provider delayDuration={120} skipDelayDuration={300}>
      <RadixTooltip.Root open={open} onOpenChange={setOpen}>
        <RadixTooltip.Trigger
          asChild
          // Radix closes a tooltip on press; here a press (the only gesture a touch screen has) opens it.
          onPointerDown={(event) => event.preventDefault()}
          onFocus={() => setOpen(true)}
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
        >
          {children}
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            data-testid={testId}
            className={cn(
              "pointer-events-none z-toast max-w-56 rounded-md border-2 border-line-2 bg-surface-1 px-2.5 py-2 text-xs text-fg-1 shadow-3 motion-safe:animate-pop",
              className,
            )}
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
