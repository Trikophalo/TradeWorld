import { NEXAMON_RARITIES, NEXAMON_SET_SIZE, type NexamonRarity } from "@/config/nexamon/types";

/*
 * Pure helpers of the Nexamon card renderer (ADR-165): numbers, grades, text fitting and the decision whether a
 * dragged card flies away. No React, no DOM.
 */

/** "012/077": the number of a card within its set, both zero-padded to three digits. */
export function formatCardNumber(number: number, total: number = NEXAMON_SET_SIZE): string {
  const pad = (n: number) => String(Math.max(0, Math.trunc(n))).padStart(3, "0");
  return `${pad(number)}/${pad(total)}`;
}

/** Condition of an ungraded card, worst to best. */
export const NEXAMON_CONDITIONS = ["poor", "good", "near_mint", "mint"] as const;
export type NexamonCondition = (typeof NEXAMON_CONDITIONS)[number];

/** Grades of the grading company, 1 (worst) to 10 (best), with the key of their word in the messages. */
export const GRADE_WORDS = {
  1: "poor",
  2: "good",
  3: "veryGood",
  4: "veryGoodExcellent",
  5: "excellent",
  6: "excellentMint",
  7: "nearMint",
  8: "nearMintMint",
  9: "mint",
  10: "gemMint",
} as const;
export type NexamonGrade = keyof typeof GRADE_WORDS;
export type GradeWordKey = (typeof GRADE_WORDS)[NexamonGrade];

/** Any number as a valid grade: rounded and held between 1 and 10. */
export function clampGrade(grade: number): NexamonGrade {
  const whole = Number.isFinite(grade) ? Math.round(grade) : 1;
  return Math.min(10, Math.max(1, whole)) as NexamonGrade;
}

export const gradeWordKey = (grade: number): GradeWordKey => GRADE_WORDS[clampGrade(grade)];

/** Serial number on the label of a slab: eight digits, zero-padded. */
export function formatSerial(serial: number | string): string {
  const digits = String(serial).replace(/\D/g, "");
  return digits.slice(-8).padStart(8, "0");
}

/** Position of a rarity in the order common … legendary. */
export const rarityRank = (rarity: NexamonRarity): number => NEXAMON_RARITIES.indexOf(rarity);

/** Rare or better: these get the glow and the sound when a pack reveals them. */
export const isHit = (rarity: NexamonRarity): boolean => rarityRank(rarity) >= rarityRank("rare");

/** Foil cards: everything but the commons. */
export const hasFoil = isHit;

const NARROW = new Set([..."Iil1.,:;!'| "]);
const WIDE = new Set([..."MWmw"]);

/**
 * Rough width of a line in the pixel font (Silkscreen), in the unit of `fontSize`. Good enough to decide how far
 * a long name has to be squeezed; the box still clips what does not fit.
 */
export function estimatePixelTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) em += NARROW.has(ch) ? 0.5 : WIDE.has(ch) ? 0.88 : 0.76;
  return em * fontSize;
}

/**
 * Horizontal squeeze for a text that should fit a box: 1 while it fits, smaller for long names, never below
 * `min` (below that the text is cut off instead, like on a printed card with a very long name).
 */
export function fitTextScale(text: string, fontSize: number, boxWidth: number, min = 0.62): number {
  const width = estimatePixelTextWidth(text, fontSize);
  if (width <= boxWidth || width === 0) return 1;
  return Math.max(min, boxWidth / width);
}

export interface SwipeInput {
  /** Distance the card was dragged, in CSS pixels. */
  dx: number;
  dy: number;
  /** Speed at release, in CSS pixels per second. */
  vx: number;
  vy: number;
  /** Width of the card in CSS pixels. */
  width: number;
}

export interface SwipeOutcome {
  /** True when the card leaves the stack. */
  away: boolean;
  /** Unit vector of the direction it leaves in (zero while it stays). */
  dirX: number;
  dirY: number;
}

/** Dragged further than this share of the card width, the card leaves the stack. */
export const SWIPE_DISTANCE = 0.45;
/** Released faster than this (px/s), it leaves no matter how short the drag was: a flick. */
export const SWIPE_VELOCITY = 650;

/**
 * Decides what happens when a dragged card is let go: a long drag or a quick flick throws it away along its
 * motion, anything else lets it fall back onto the stack (the player only peeked).
 */
export function swipeOutcome({ dx, dy, vx, vy, width }: SwipeInput): SwipeOutcome {
  const distance = Math.hypot(dx, dy);
  const speed = Math.hypot(vx, vy);
  const flick = speed >= SWIPE_VELOCITY && distance > 6;
  if (distance < width * SWIPE_DISTANCE && !flick) return { away: false, dirX: 0, dirY: 0 };
  // A flick follows its velocity, a slow drag the direction it was pulled in.
  const [x, y] = flick && speed > 0 ? [vx / speed, vy / speed] : [dx / distance, dy / distance];
  return { away: true, dirX: x, dirY: y };
}

/** Integer scale for pixel art: at least 1, never fractional. */
export const pixelScale = (scale: number): number => Math.max(1, Math.round(scale));
