"use client";

import { Switch as RadixSwitch } from "radix-ui";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
}

export function Switch({ checked, onCheckedChange, label, id, disabled }: SwitchProps) {
  return (
    <RadixSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-sm bg-surface-3 focus-ring transition-colors duration-base ease-standard",
        "disabled:opacity-40 data-[state=checked]:bg-accent-strong",
      )}
    >
      <RadixSwitch.Thumb
        className={cn(
          "block size-5 translate-x-1 rounded-xs bg-fg-2 transition duration-base ease-out",
          "data-[state=checked]:translate-x-6 data-[state=checked]:bg-on-accent",
        )}
      />
    </RadixSwitch.Root>
  );
}
