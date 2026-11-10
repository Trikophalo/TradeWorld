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
      <div className="mb-5 grid size-24 place-items-center rounded-xl bg-surface-2">{art}</div>
      <h3 className="font-pixel text-sm text-fg-1 uppercase">{title}</h3>
      <p className="mt-2 max-w-xs text-sm text-pretty text-fg-2">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
