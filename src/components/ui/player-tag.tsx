"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatTag } from "@/lib/player-tag";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/**
 * The small player tag next to a name, e.g. "#K7Q2" (ADR-085). With `copy` a tap copies it to the clipboard.
 */
export function PlayerTag({ tag, copy, className }: { tag: string | null; copy?: boolean; className?: string }) {
  const t = useTranslations("playerTag");
  const [copied, setCopied] = useState(false);
  if (!tag) return null;
  const base = cn(
    "inline-flex items-center rounded-xs bg-surface-3 px-1.5 py-0.5 font-pixel text-2xs tracking-wide text-fg-2",
    className,
  );
  if (!copy) {
    return (
      <span className={base} title={t("title")} data-testid="player-tag">
        {formatTag(tag)}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={cn(base, "focus-ring transition duration-fast hover:text-fg-1 active:scale-95")}
      title={t("copy")}
      aria-label={t("copyLabel", { tag: formatTag(tag) })}
      data-testid="player-tag"
      onClick={() => {
        haptic("tap");
        void navigator.clipboard?.writeText(formatTag(tag)).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_200);
        });
      }}
    >
      {copied ? t("copied") : formatTag(tag)}
    </button>
  );
}
