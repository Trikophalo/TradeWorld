"use client";

import { Accordion as RadixAccordion } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface AccordionItem {
  id: string;
  title: string;
  /** Short line under the title, visible while closed. */
  summary?: string;
  icon?: ReactNode;
  content: ReactNode;
}

/**
 * Expandable list. Content fades in; the height change itself is not
 * animated, in line with the motion rules (transform and opacity only).
 */
export function Accordion({ items, className }: { items: readonly AccordionItem[]; className?: string }) {
  return (
    <RadixAccordion.Root type="multiple" className={cn("divide-y divide-line-1", className)}>
      {items.map((item) => (
        <RadixAccordion.Item key={item.id} value={item.id} id={item.id} className="scroll-mt-20">
          <RadixAccordion.Header>
            <RadixAccordion.Trigger className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-3.5 text-left focus-ring transition-colors duration-fast hover:bg-surface-2">
              {item.icon && (
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2">{item.icon}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-fg-1">{item.title}</span>
                {item.summary && <span className="block truncate text-sm text-fg-3">{item.summary}</span>}
              </span>
              <svg
                viewBox="0 0 7 4"
                width="14"
                height="8"
                shapeRendering="crispEdges"
                aria-hidden
                className="shrink-0 text-fg-3 transition-transform duration-base ease-out group-data-[state=open]:rotate-180"
              >
                <path
                  fill="currentColor"
                  d="M0 0h1v1H0zM1 1h1v1H1zM2 2h1v1H2zM3 3h1v1H3zM4 2h1v1H4zM5 1h1v1H5zM6 0h1v1H6z"
                />
              </svg>
            </RadixAccordion.Trigger>
          </RadixAccordion.Header>
          <RadixAccordion.Content className="pb-4 text-fg-2 data-[state=open]:animate-[vt-fade_var(--duration-slow)_var(--ease-out)]">
            {item.content}
          </RadixAccordion.Content>
        </RadixAccordion.Item>
      ))}
    </RadixAccordion.Root>
  );
}
