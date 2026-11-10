import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Placeholder in the shape of the content that will replace it.
 * The shimmer moves with `transform` only.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div aria-hidden className={cn("relative overflow-hidden rounded-sm bg-surface-3", className)} {...props}>
      <div className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-fg-1/8 to-transparent" />
    </div>
  );
}

/** Skeleton for one row of a security list. */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Skeleton className="size-10 rounded-md" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="flex flex-col items-end gap-2">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}
