"use client";

import { useTranslations } from "next-intl";
import { NEXAMON_CARD_SIZE, type NexamonArt, type NexamonCard as NexamonCardData } from "@/config/nexamon";
import { pixelScale } from "../lib";
import { NexamonCardBack, NexamonCardFace } from "./card-face";
import { TiltFlip, type CardSide } from "./tilt-flip";

export interface NexamonCardProps {
  card: NexamonCardData;
  art?: NexamonArt;
  /** CSS pixels per art pixel: 2 for lists, 3 to 5 for looking at a card. */
  scale?: number;
  evolvesFromName?: string;
  /** Controlled side; without it the card remembers its side itself. */
  side?: CardSide;
  defaultSide?: CardSide;
  onSideChange?: (side: CardSide) => void;
  /** Lean towards the pointer and move the foil with it. */
  tilt?: boolean;
  flippable?: boolean;
  className?: string;
}

/**
 * A card to hold: it leans towards the pointer, its foil follows the light, and a click, tap, Enter or Space
 * turns it around. `data-face` on the control says which side is up.
 */
export function NexamonCard({
  card,
  art,
  scale = 3,
  evolvesFromName,
  side,
  defaultSide,
  onSideChange,
  tilt = true,
  flippable = true,
  className,
}: NexamonCardProps) {
  const t = useTranslations("nexamonCards");
  const u = pixelScale(scale);
  return (
    <TiltFlip
      width={NEXAMON_CARD_SIZE.width * u}
      height={NEXAMON_CARD_SIZE.height * u}
      side={side}
      defaultSide={defaultSide}
      onSideChange={onSideChange}
      tilt={tilt}
      flippable={flippable}
      label={t("flipHint", { name: card.name })}
      className={className}
      testId="nexamon-card"
      front={(light) => (
        <NexamonCardFace card={card} art={art} scale={u} evolvesFromName={evolvesFromName} light={light} />
      )}
      back={<NexamonCardBack scale={u} />}
    />
  );
}
