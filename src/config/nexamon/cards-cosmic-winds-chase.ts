import type { CosmicCardDraft } from "./cosmic-draft";
import type { NexamonArt } from "./types";

/*
 * PLACEHOLDER (ADR-174): stand-in for the real Cosmic Winds cards 81-90 and their art, so the set can be wired
 * and tested. The real catalogue file of the same name replaces this one; nothing else imports from here.
 */
const SIZE = {
  common: [60, 40],
  rare: [60, 40],
  ultra: [68, 48],
  prisma: [72, 100],
  legendary: [72, 100],
  one_of_one: [72, 100],
} as const;

type Row = {
  n: number;
  rarity: CosmicCardDraft["rarity"];
  kind: CosmicCardDraft["kind"];
  type: CosmicCardDraft["type"];
  price: number;
};
// prettier-ignore
const ROWS: readonly Row[] = [
  { n: 81, rarity: "prisma", kind: "monster", type: "psychic", price: 11250000 },
  { n: 82, rarity: "prisma", kind: "monster", type: "rock", price: 22500000 },
  { n: 83, rarity: "prisma", kind: "monster", type: "dark", price: 33750000 },
  { n: 84, rarity: "prisma", kind: "event", type: "cosmic", price: 45000000 },
  { n: 85, rarity: "prisma", kind: "monster", type: "fairy", price: 56250000 },
  { n: 86, rarity: "legendary", kind: "monster", type: "dragon", price: 202500000 },
  { n: 87, rarity: "legendary", kind: "monster", type: "cosmic", price: 405000000 },
  { n: 88, rarity: "one_of_one", kind: "event", type: "cosmic", price: 1600000000 },
  { n: 89, rarity: "one_of_one", kind: "monster", type: "water", price: 2450000000 },
  { n: 90, rarity: "one_of_one", kind: "monster", type: "grass", price: 3300000000 },
];

const key = (n: number) => `cw-${String(n).padStart(3, "0")}`;

export const COSMIC_WINDS_CHASE_CARDS: readonly CosmicCardDraft[] = ROWS.map((r) => ({
  key: key(r.n),
  number: r.n,
  rarity: r.rarity,
  kind: r.kind,
  name: r.kind === "event" ? `Komet ${r.n}` : `Kosmo ${r.n}`,
  type: r.type,
  hp: r.kind === "event" ? 0 : 50 + (r.n % 8) * 10,
  stage: 0,
  evolvesFrom: null,
  attack:
    r.kind === "event"
      ? { name: "Sternenwind", damage: 0, text: "Platzhalter: Ein kosmisches Ereignis." }
      : { name: "Sternstoß", damage: 10 + (r.n % 6) * 10, text: "" },
  flavor: "Platzhalter.",
  startPriceCents: r.price,
}));

/** Placeholder art: a starfield with a round body in the middle. */
function art(n: number, rarity: CosmicCardDraft["rarity"]): NexamonArt {
  const [width, height] = SIZE[rarity];
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 4;
  const grid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const d = Math.hypot(x - cx, y - cy);
      if (d < radius - 2) return "b";
      if (d < radius) return "c";
      return (x * 7 + y * 13 + n) % 29 === 0 ? "s" : "a";
    }).join(""),
  );
  return { width, height, palette: { a: "#0b0b2a", b: "#5b3fd0", c: "#c9b8ff", s: "#ffffff" }, grid };
}

export const COSMIC_WINDS_CHASE_ART: Readonly<Record<string, NexamonArt>> = Object.fromEntries(
  ROWS.map((r) => [key(r.n), art(r.n, r.rarity)]),
);
