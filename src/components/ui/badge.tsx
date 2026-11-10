import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex h-5 items-center gap-1 rounded-xs px-1.5 label-pixel whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "bg-surface-3 text-fg-2",
      accent: "bg-accent-soft text-accent",
      gain: "bg-gain-soft text-gain",
      loss: "bg-loss-soft text-loss",
      warn: "bg-warn-soft text-warn",
      info: "bg-info-soft text-info",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
