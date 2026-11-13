import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** A pixel illustration. */
  art: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

/** Empty lists always explain themselves and offer the next step. */
export function EmptyState({ art, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-10 text-center", className)}>
      <div className="relative mb-5 grid size-24 place-items-center rounded-xl border-2 border-line-1 bg-surface-2 shadow-1">
        <span className="animate-float">{art}</span>
        <span aria-hidden className="absolute inset-x-6 bottom-2 h-1 rounded-pill bg-edge opacity-50" />
      </div>
      <h3 className="font-pixel text-sm text-fg-1 uppercase">{title}</h3>
      <p className="mt-2 max-w-xs text-sm text-pretty text-fg-2">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
