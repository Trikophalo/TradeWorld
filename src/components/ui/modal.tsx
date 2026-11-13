"use client";

import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * A large window in the middle of the screen, for work that needs room (the pixel editors, ADR-079).
 * Focus trap, Escape and scroll lock come from the dialog primitive. Enters with opacity and scale only.
 */
export function Modal({ open, onOpenChange, title, description, children, footer, className }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-overlay bg-scrim backdrop-blur-sm data-[state=open]:animate-[fade-in_var(--duration-base)_var(--ease-out)]" />
        <Dialog.Content
          className={cn(
            "fixed inset-0 z-sheet m-auto flex h-fit max-h-[94dvh] w-[min(96vw,1100px)] flex-col rounded-xl border-2 border-line-2 bg-surface-1 shadow-3 outline-none",
            "data-[state=open]:animate-[modal-in_var(--duration-slow)_var(--ease-out)]",
            className,
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b-2 border-line-1 px-5 py-4 lg:px-6">
            <div>
              <Dialog.Title className="font-pixel text-base text-fg-1 uppercase">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-1 text-sm text-fg-2">{description}</Dialog.Description>}
            </div>
            <Dialog.Close
              aria-label="Schließen"
              className="-mt-1 -mr-2 grid size-9 place-items-center rounded-sm text-fg-3 focus-ring transition-colors duration-fast hover:bg-surface-2 hover:text-fg-1"
            >
              <svg viewBox="0 0 7 7" width="14" height="14" shapeRendering="crispEdges" aria-hidden>
                <path
                  fill="currentColor"
                  d="M0 0h1v1H0zM1 1h1v1H1zM2 2h1v1H2zM3 3h1v1H3zM4 4h1v1H4zM5 5h1v1H5zM6 6h1v1H6zM6 0h1v1H6zM5 1h1v1H5zM4 2h1v1H4zM2 4h1v1H2zM1 5h1v1H1zM0 6h1v1H0z"
                />
              </svg>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:p-6">{children}</div>
          {footer && <footer className="border-t-2 border-line-1 px-5 py-4 lg:px-6">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
