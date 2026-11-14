"use client";

import { Collapsible } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A titled section that folds away (ADR-138): keeps long pages like the company overview short. The header shows a
 * one-line summary while closed. Content fades in; the height change itself is not animated (motion rules).
 */
export function CollapsibleSection({
  id,
  title,
  summary,
  icon,
  open,
  onOpenChange,
  badge,
  children,
  className,
}: {
  id: string;
  title: string;
  summary?: ReactNode;
  icon?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Small marker next to the title, e.g. a count of things to do. */
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Collapsible.Root
      open={open}
      onOpenChange={onOpenChange}
      id={`section-${id}`}
      data-section={id}
      className={cn("scroll-mt-24 rounded-lg border border-line-1 bg-surface-1", className)}
    >
      <Collapsible.Trigger
        className="group flex w-full items-center gap-3 rounded-lg px-4 py-3.5 text-left focus-ring transition-colors duration-fast hover:bg-surface-2 active:bg-surface-2"
        data-testid={`section-${id}`}
      >
        {icon && <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 font-semibold text-fg-1">
            {title}
            {badge}
          </span>
          {summary && <span className="block truncate text-sm text-fg-3">{summary}</span>}
        </span>
        <svg
          viewBox="0 0 7 4"
          width="14"
          height="8"
          shapeRendering="crispEdges"
          aria-hidden
          className="shrink-0 text-fg-3 transition-transform duration-base ease-out group-data-[state=open]:rotate-180"
        >
          <path fill="currentColor" d="M0 0h1v1H0zM1 1h1v1H1zM2 2h1v1H2zM3 3h1v1H3zM4 2h1v1H4zM5 1h1v1H5zM6 0h1v1H6z" />
        </svg>
      </Collapsible.Trigger>
      <Collapsible.Content className="space-y-5 px-3 pb-4 data-[state=open]:animate-[vt-fade_var(--duration-slow)_var(--ease-out)] sm:px-4">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
