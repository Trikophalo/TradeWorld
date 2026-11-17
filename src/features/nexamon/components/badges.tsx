"use client";

import { useTranslations } from "next-intl";
import type { NexamonRarity, NexamonSetKey, NexamonType } from "@/config/nexamon";
import { rarityMark, setSymbol, TYPE_SYMBOL } from "@/components/pixel/nexamon-symbols";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { NexamonCondition } from "../lib";

const RARITY_TONE: Record<NexamonRarity, BadgeProps["tone"]> = {
  common: "neutral",
  rare: "info",
  ultra: "warn",
  prisma: "accent",
  legendary: "warn",
  one_of_one: "neutral",
  iron: "neutral",
  titanium: "info",
  diamond: "accent",
  uranium: "gain",
};

export interface RarityBadgeProps {
  rarity: NexamonRarity;
  /** The short word ("Prisma") instead of the full name ("Prisma Illustration Rare"). */
  short?: boolean;
  className?: string;
}

/** Rarity of a card: its mark from the card footer and its name. */
export function RarityBadge({ rarity, short = false, className }: RarityBadgeProps) {
  const t = useTranslations("nexamonCards");
  const mark = rarityMark(rarity, "currentColor");
  return (
    <Badge
      tone={RARITY_TONE[rarity]}
      data-rarity={rarity}
      className={cn(
        rarity === "legendary" && "bg-gold text-on-accent",
        rarity === "one_of_one" && "border-gold bg-fg-1 text-gold",
        className,
      )}
      title={short ? t(`rarity.${rarity}`) : undefined}
    >
      <PixelIcon grid={mark.grid} palette={rarity === "legendary" ? { "#": "currentColor" } : mark.palette} scale={2} />
      {t(short ? `rarityShort.${rarity}` : `rarity.${rarity}`)}
    </Badge>
  );
}

const CONDITION_TONE: Record<NexamonCondition, BadgeProps["tone"]> = {
  poor: "loss",
  good: "warn",
  near_mint: "info",
  mint: "gain",
};

/** Condition of an ungraded card: Poor, Good, Near Mint or Mint. */
export function ConditionBadge({ condition, className }: { condition: NexamonCondition; className?: string }) {
  const t = useTranslations("nexamonCards");
  return (
    <Badge tone={CONDITION_TONE[condition]} data-condition={condition} className={className}>
      {t(`condition.${condition}`)}
    </Badge>
  );
}

export interface TypeIconProps {
  type: NexamonType;
  /** CSS pixels per art pixel; the symbol is nine art pixels across. */
  scale?: number;
  /** Shows the name of the type next to the symbol. Without it the name is the accessible label only. */
  label?: boolean;
  className?: string;
}

/** The symbol of one of the ten types. */
export function TypeIcon({ type, scale = 2, label = false, className }: TypeIconProps) {
  const t = useTranslations("nexamonCards");
  const name = t(`types.${type}`);
  if (!label) return <PixelIcon {...TYPE_SYMBOL[type]} scale={scale} title={name} className={className} />;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-fg-1", className)}>
      <PixelIcon {...TYPE_SYMBOL[type]} scale={scale} />
      {name}
    </span>
  );
}

export interface SetIconProps {
  set: NexamonSetKey;
  scale?: number;
  label?: boolean;
  className?: string;
}

/** The symbol of a set in the text colour, optionally with the set name. */
export function SetIcon({ set, scale = 2, label = false, className }: SetIconProps) {
  const t = useTranslations("nexamonCards");
  const name = t(`sets.${set}`);
  const symbol = setSymbol(set, "currentColor");
  if (!label) return <PixelIcon {...symbol} scale={scale} title={name} className={className} />;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-fg-1", className)}>
      <PixelIcon {...symbol} scale={scale} />
      {name}
    </span>
  );
}
