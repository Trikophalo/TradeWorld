import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover feedback. Use for cards that are links or buttons. */
  interactive?: boolean;
  padding?: "none" | "md" | "lg";
}

export function Card({ className, interactive, padding = "md", ...props }: CardProps) {
  return (
    <div
      className={cn(
        // A panel with weight: thick border, a hard edge underneath (ADR-108).
        "rounded-lg border-2 border-line-1 bg-surface-1 shadow-1",
        padding === "md" && "p-4",
        padding === "lg" && "p-5 lg:p-6",
        interactive &&
          "transition duration-fast ease-standard hover:-translate-y-1 hover:border-line-2 hover:bg-surface-2 hover:shadow-2 active:translate-y-0.5 active:shadow-none",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-3 flex items-center justify-between gap-3", className)} {...props} />;
}

/** Section label in the pixel font. */
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("label-pixel text-fg-2", className)} {...props} />;
}
