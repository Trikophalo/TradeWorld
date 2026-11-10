"use client";

import type { ReactNode } from "react";
import { Drawer } from "vaul";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * One component, two shapes: a bottom sheet that can be swiped away on
 * phones and a side panel on desktop. Focus trap, Escape and scroll lock
 * come from the underlying dialog primitive.
 */
export function Sheet({ open, onOpenChange, title, description, children, footer }: SheetProps) {
  const desktop = useMediaQuery("(min-width: 1024px)");
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction={desktop ? "right" : "bottom"}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-overlay bg-scrim" />
        <Drawer.Content
          className={cn(
            "fixed z-sheet flex flex-col border-line-2 bg-surface-1 shadow-3 outline-none",
            desktop
              ? "inset-y-3 right-3 w-[420px] rounded-xl border"
              : "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-xl border-t pb-safe",
          )}
        >
          {!desktop && <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-pill bg-line-2" />}
          <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
            <div>
              <Drawer.Title className="font-pixel text-sm text-fg-1 uppercase">{title}</Drawer.Title>
              {description && <Drawer.Description className="mt-1 text-sm text-fg-2">{description}</Drawer.Description>}
            </div>
            <Drawer.Close
              aria-label="Schließen"
              className="-mt-1 -mr-2 grid size-9 place-items-center rounded-sm text-fg-3 focus-ring transition-colors duration-fast hover:bg-surface-2 hover:text-fg-1"
            >
              <svg viewBox="0 0 7 7" width="14" height="14" shapeRendering="crispEdges" aria-hidden>
                <path
                  fill="currentColor"
                  d="M0 0h1v1H0zM1 1h1v1H1zM2 2h1v1H2zM3 3h1v1H3zM4 4h1v1H4zM5 5h1v1H5zM6 6h1v1H6zM6 0h1v1H6zM5 1h1v1H5zM4 2h1v1H4zM2 4h1v1H2zM1 5h1v1H1zM0 6h1v1H0z"
                />
              </svg>
            </Drawer.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && <footer className="border-t border-line-1 p-5">{footer}</footer>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
