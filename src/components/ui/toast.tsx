"use client";

import type { ReactNode } from "react";
import { Toaster as Sonner, toast as sonner } from "sonner";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";

type Tone = "success" | "error" | "info" | "warn";

const TONE_STYLES: Record<Tone, string> = {
  success: "bg-gain-soft text-gain",
  error: "bg-loss-soft text-loss",
  info: "bg-info-soft text-info",
  warn: "bg-warn-soft text-warn",
};

const GLYPHS: Record<Tone, string> = {
  success: "M5 0h2v2H5zM4 1h2v2H4zM3 2h2v2H3zM2 3h2v2H2zM0 2h2v2H0zM1 3h2v3H1z",
  error: "M0 0h2v2H0zM5 0h2v2H5zM1 1h2v2H1zM4 1h2v2H4zM2 2h3v2H2zM1 3h2v2H1zM4 3h2v2H4zM0 4h2v2H0zM5 4h2v2H5z",
  info: "M3 0h2v2H3zM3 3h2v4H3z",
  warn: "M3 0h2v4H3zM3 5h2v2H3z",
};

function ToastCard({ tone, title, description }: { tone: Tone; title: string; description?: ReactNode }) {
  return (
    <div className="flex w-full items-start gap-3 rounded-lg border border-line-2 bg-surface-2 p-3.5 shadow-3 sm:w-[356px]">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-sm", TONE_STYLES[tone])}>
        <svg viewBox="0 0 8 7" width="16" height="14" shapeRendering="crispEdges" aria-hidden>
          <path fill="currentColor" d={GLYPHS[tone]} />
        </svg>
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-semibold text-fg-1">{title}</p>
        {description && <p className="mt-0.5 text-sm text-fg-2">{description}</p>}
      </div>
    </div>
  );
}

function show(tone: Tone, title: string, description?: ReactNode) {
  if (tone === "success") {
    void playSound("success");
    haptic("success");
  } else if (tone === "error") {
    void playSound("error");
    haptic("error");
  }
  return sonner.custom(() => <ToastCard tone={tone} title={title} description={description} />);
}

/** Confirmations and errors. Stacked, swipeable, announced to screen readers. */
export const toast = {
  success: (title: string, description?: ReactNode) => show("success", title, description),
  error: (title: string, description?: ReactNode) => show("error", title, description),
  info: (title: string, description?: ReactNode) => show("info", title, description),
  warn: (title: string, description?: ReactNode) => show("warn", title, description),
};

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      visibleToasts={3}
      duration={4000}
      gap={8}
      offset={{ top: "calc(var(--safe-top) + 12px)" }}
      mobileOffset={{ top: "calc(var(--safe-top) + 8px)", left: 12, right: 12 }}
      style={{ zIndex: "var(--z-toast)" }}
      toastOptions={{ unstyled: true, className: "w-full flex justify-center" }}
    />
  );
}
