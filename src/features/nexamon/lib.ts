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

/**
 * Advance widths of the pixel font (Silkscreen) in em. It has five widths and no kerning, and lower case letters
 * are drawn like capitals; measured in the browser. Characters that are not listed count as a regular letter.
 */
const ADVANCE: readonly (readonly [number, string])[] = [
  [0.375, "Ii.,:;!'|"],
  [0.5, " "],
  [0.625, "EFLTZefltz-"],
  [0.875, "MNVWXYmnvwxy"],
];
const ADVANCE_OF = new Map<string, number>(ADVANCE.flatMap(([em, chars]) => [...chars].map((ch) => [ch, em] as const)));
const REGULAR_ADVANCE = 0.75;
/** Width of one tabular digit of the bold number font (Inter, extra bold) in em. */
const DIGIT_ADVANCE = 0.65;

/** Width of a line in the pixel font (Silkscreen), in the unit of `fontSize`. */
export function estimatePixelTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) em += ADVANCE_OF.get(ch) ?? REGULAR_ADVANCE;
  return em * fontSize;
}

/** Width of a whole number in the bold number font, in the unit of `fontSize`. */
export function estimateNumberWidth(value: number, fontSize: number): number {
  return String(Math.trunc(Math.abs(value))).length * DIGIT_ADVANCE * fontSize;
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

/** Narrowest a text is squeezed before its letters shrink as well. */
export const MIN_SQUEEZE = 0.68;

export interface TextFit {
  /** Horizontal squeeze (scaleX), 1 or less. */
  squeeze: number;
  /** Factor on the font size, 1 or less: only for texts that would not fit squeezed alone. */
  size: number;
}

/**
 * Makes a text fit a box without cutting it: first it is squeezed (down to `minSqueeze`), and what is still too
 * long gets smaller letters. The fitted width is `width x squeeze x size` and never exceeds `boxWidth`.
 */
export function fitText(text: string, fontSize: number, boxWidth: number, minSqueeze = MIN_SQUEEZE): TextFit {
  const width = estimatePixelTextWidth(text, fontSize);
  if (width <= boxWidth || width === 0 || boxWidth <= 0) return { squeeze: 1, size: 1 };
  const fit = boxWidth / width;
  if (fit >= minSqueeze) return { squeeze: fit, size: 1 };
  return { squeeze: minSqueeze, size: fit / minSqueeze };
}

/** Font sizes of the card texts in art pixels, shared by the renderer and its checks. */
export const FACE_TEXT = {
  name: 6,
  attack: 5,
  /** The stage line above the name ("Phase 2 · aus Schlummerfalter"). */
  stage: 2.7,
  number: 6.2,
  hpLabel: 2.7,
  /** Space between the "KP" label and the number. */
  hpGap: 0.8,
  /** Air between a text and the number to its right. */
  gap: 1.5,
} as const;

/** Width of the KP block ("KP 120"; small cards show the number alone, `label` empty), in art pixels. */
export function hpBlockWidth(hp: number, label: string): number {
  const number = estimateNumberWidth(hp, FACE_TEXT.number);
  return label ? estimatePixelTextWidth(label, FACE_TEXT.hpLabel) + FACE_TEXT.hpGap + number : number;
}

/**
 * Room for a text that ends before a right-aligned number: from the text's left edge to the number, minus the gap.
 * `numberWidth` 0 means there is no number (an attack without damage) and the text may use the whole line.
 */
export function roomBeforeNumber(textX: number, numberRight: number, numberWidth: number): number {
  return Math.max(0, numberRight - numberWidth - (numberWidth > 0 ? FACE_TEXT.gap : 0) - textX);
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

/** Share of the pack's width a finger has to travel along the seal until the strip is off. */
export const TEAR_DISTANCE = 0.7;

/** How far a tear is (0..1) after pulling `distance` pixels along a pack `width` pixels wide; backwards is 0. */
export function tearProgress(distance: number, width: number): number {
  if (!(width > 0) || !(distance > 0)) return 0;
  return Math.min(1, distance / (width * TEAR_DISTANCE));
}

/** Integer scale for pixel art: at least 1, never fractional. */
export const pixelScale = (scale: number): number => Math.max(1, Math.round(scale));
