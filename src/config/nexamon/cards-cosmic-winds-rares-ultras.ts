import type { CosmicCardDraft } from "./cosmic-draft";
import type { NexamonArt } from "./types";

/*
 * PLACEHOLDER (ADR-174): stand-in for the real Cosmic Winds cards 51-80 and their art, so the set can be wired
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
  { n: 51, rarity: "rare", kind: "monster", type: "steel", price: 15750 },
  { n: 52, rarity: "rare", kind: "monster", type: "fairy", price: 27482 },
  { n: 53, rarity: "rare", kind: "monster", type: "dragon", price: 39214 },
  { n: 54, rarity: "rare", kind: "monster", type: "cosmic", price: 50946 },
  { n: 55, rarity: "rare", kind: "monster", type: "fire", price: 62679 },
  { n: 56, rarity: "rare", kind: "monster", type: "water", price: 74411 },
  { n: 57, rarity: "rare", kind: "monster", type: "grass", price: 86143 },
  { n: 58, rarity: "rare", kind: "event", type: "cosmic", price: 97875 },
  { n: 59, rarity: "rare", kind: "monster", type: "psychic", price: 109607 },
  { n: 60, rarity: "rare", kind: "monster", type: "rock", price: 121339 },
  { n: 61, rarity: "rare", kind: "monster", type: "dark", price: 133071 },
  { n: 62, rarity: "rare", kind: "monster", type: "steel", price: 144804 },
  { n: 63, rarity: "rare", kind: "event", type: "cosmic", price: 156536 },
  { n: 64, rarity: "rare", kind: "monster", type: "dragon", price: 168268 },
  { n: 65, rarity: "rare", kind: "monster", type: "cosmic", price: 180000 },
  { n: 66, rarity: "ultra", kind: "monster", type: "fire", price: 360000 },
  { n: 67, rarity: "ultra", kind: "monster", type: "water", price: 736071 },
  { n: 68, rarity: "ultra", kind: "monster", type: "grass", price: 1112143 },
  { n: 69, rarity: "ultra", kind: "monster", type: "electric", price: 1488214 },
  { n: 70, rarity: "ultra", kind: "monster", type: "psychic", price: 1864286 },
  { n: 71, rarity: "ultra", kind: "monster", type: "rock", price: 2240357 },
  { n: 72, rarity: "ultra", kind: "event", type: "cosmic", price: 2616429 },
  { n: 73, rarity: "ultra", kind: "monster", type: "steel", price: 2992500 },
  { n: 74, rarity: "ultra", kind: "monster", type: "fairy", price: 3368571 },
  { n: 75, rarity: "ultra", kind: "monster", type: "dragon", price: 3744643 },
  { n: 76, rarity: "ultra", kind: "monster", type: "cosmic", price: 4120714 },
  { n: 77, rarity: "ultra", kind: "event", type: "cosmic", price: 4496786 },
  { n: 78, rarity: "ultra", kind: "monster", type: "water", price: 4872857 },
  { n: 79, rarity: "ultra", kind: "monster", type: "grass", price: 5248929 },
  { n: 80, rarity: "ultra", kind: "monster", type: "electric", price: 5625000 },
];

const key = (n: number) => `cw-${String(n).padStart(3, "0")}`;

export const COSMIC_WINDS_RARES_ULTRAS_CARDS: readonly CosmicCardDraft[] = ROWS.map((r) => ({
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

export const COSMIC_WINDS_RARES_ULTRAS_ART: Readonly<Record<string, NexamonArt>> = Object.fromEntries(
  ROWS.map((r) => [key(r.n), art(r.n, r.rarity)]),
);
