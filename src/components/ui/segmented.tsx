"use client";

import { motion } from "motion/react";
import { ToggleGroup } from "radix-ui";
import { useId } from "react";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  label: string;
  size?: "sm" | "md";
  block?: boolean;
  className?: string;
}

/** Single-choice control (time ranges, filters). The marker slides between options. */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  label,
  size = "md",
  block,
  className,
}: SegmentedProps<T>) {
  const id = useId();
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => next && onValueChange(next as T)}
      aria-label={label}
      className={cn(
        "no-scrollbar inline-flex max-w-full overflow-x-auto rounded-md bg-surface-2 p-1",
        block && "flex w-full",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <ToggleGroup.Item
            key={option.value}
            value={option.value}
            className={cn(
              "relative shrink-0 rounded-sm px-3 label-pixel focus-ring transition-colors duration-fast",
              size === "sm" ? "h-7" : "h-9",
              block && "flex-1",
              active ? "text-fg-1" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {active && (
              <motion.span
                layoutId={`segmented-${id}`}
                className="absolute inset-0 rounded-sm bg-surface-3 shadow-1"
                transition={SPRING.snappy}
              />
            )}
            <span className="relative">{option.label}</span>
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
