"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { NexamonCard } from "@/config/nexamon";
import { Badge } from "@/components/ui/badge";
import type { NexamonCopy } from "@/features/game/nexamon-types";
import { cn } from "@/lib/utils";
import { gradeWordKey } from "../lib";
import { ConditionBadge } from "./badges";
import { CardThumb } from "./card-face";
import { NexamonSlab } from "./slab";

/** A small labelled number for the summary rows of the Nexamon pages. */
export function Stat({
  label,
  children,
  hint,
  testId,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-md bg-surface-2 px-3 py-2.5", className)} data-testid={testId}>
      <p className="truncate label-pixel text-fg-3">{label}</p>
      <p className="mt-0.5 truncate nums text-base font-semibold text-fg-1">{children}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-fg-3">{hint}</p>}
    </div>
  );
}

/** The ASP grade of a slab as a chip: "ASP 10 · Gem Mint". Gold for a 10. */
export function GradeChip({ grade, short = false, className }: { grade: number; short?: boolean; className?: string }) {
  const t = useTranslations("nexamonCards");
  const tn = useTranslations("nexamon");
  return (
    <Badge
      tone={grade >= 8 ? "gain" : "neutral"}
      data-grade={grade}
      className={cn(grade === 10 && "bg-gold text-on-accent", className)}
      title={t(`grade.${gradeWordKey(grade)}`)}
    >
      {short ? tn("gradeShort", { grade }) : tn("gradeLong", { grade, word: t(`grade.${gradeWordKey(grade)}`) })}
    </Badge>
  );
}

/** Condition of a raw copy or the grade of a slab: what a row says about a copy's state. */
export function CopyQuality({
  copy,
  short = false,
}: {
  copy: Pick<NexamonCopy, "grade" | "condition">;
  short?: boolean;
}) {
  return copy.grade !== null ? (
    <GradeChip grade={copy.grade} short={short} />
  ) : (
    <ConditionBadge condition={copy.condition} />
  );
}

/**
 * A copy as a small picture for lists: the card, or its slab once it is graded. Still (no tilt, no flip), so a
 * wall of them stays cheap. Slabs are larger than cards; rows align them at the bottom.
 */
export function CopyVisual({
  card,
  grade,
  serial,
  scale = 1,
  dimmed = false,
  className,
}: {
  card: NexamonCard;
  grade?: number | null;
  serial?: number;
  scale?: number;
  dimmed?: boolean;
  className?: string;
}) {
  if (grade != null)
    return (
      <span className={cn("pointer-events-none block", className)} data-testid="copy-slab">
        <NexamonSlab card={card} grade={grade} serial={serial ?? 0} scale={scale} tilt={false} flippable={false} />
      </span>
    );
  return <CardThumb card={card} scale={scale} dimmed={dimmed} className={className} />;
}

/** A native select in the look of the app: for filters with more choices than a row of buttons can hold. */
export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  testId,
  className,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  testId?: string;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 label-pixel text-fg-3", className)}>
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        data-testid={testId}
        className="h-10 w-full min-w-0 rounded-sm border-2 border-line-1 bg-surface-1 px-2 font-sans text-sm font-normal tracking-normal text-fg-1 normal-case focus-ring transition-colors duration-fast hover:border-line-2"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Rows of a small facts table: label left, value right. */
export function FactRow({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-sm text-fg-2">{label}</dt>
      <dd className={cn("text-right nums text-sm", strong ? "font-semibold text-fg-1" : "text-fg-1")}>{children}</dd>
    </div>
  );
}
