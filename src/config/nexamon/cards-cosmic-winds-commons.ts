import type { CosmicCardDraft } from "./cosmic-draft";
import type { NexamonArt } from "./types";

/*
 * PLACEHOLDER (ADR-174): stand-in for the real Cosmic Winds cards 1-50 and their art, so the set can be wired
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
  { n: 1, rarity: "common", kind: "monster", type: "water", price: 2250 },
  { n: 2, rarity: "common", kind: "monster", type: "grass", price: 2663 },
  { n: 3, rarity: "common", kind: "event", type: "cosmic", price: 3077 },
  { n: 4, rarity: "common", kind: "monster", type: "psychic", price: 3490 },
  { n: 5, rarity: "common", kind: "monster", type: "rock", price: 3903 },
  { n: 6, rarity: "common", kind: "monster", type: "dark", price: 4316 },
  { n: 7, rarity: "common", kind: "monster", type: "steel", price: 4730 },
  { n: 8, rarity: "common", kind: "monster", type: "fairy", price: 5143 },
  { n: 9, rarity: "common", kind: "event", type: "cosmic", price: 5556 },
  { n: 10, rarity: "common", kind: "monster", type: "cosmic", price: 5969 },
  { n: 11, rarity: "common", kind: "monster", type: "fire", price: 6383 },
  { n: 12, rarity: "common", kind: "monster", type: "water", price: 6796 },
  { n: 13, rarity: "common", kind: "monster", type: "grass", price: 7209 },
  { n: 14, rarity: "common", kind: "monster", type: "electric", price: 7622 },
  { n: 15, rarity: "common", kind: "monster", type: "psychic", price: 8036 },
  { n: 16, rarity: "common", kind: "monster", type: "rock", price: 8449 },
  { n: 17, rarity: "common", kind: "event", type: "cosmic", price: 8862 },
  { n: 18, rarity: "common", kind: "monster", type: "steel", price: 9276 },
  { n: 19, rarity: "common", kind: "monster", type: "fairy", price: 9689 },
  { n: 20, rarity: "common", kind: "monster", type: "dragon", price: 10102 },
  { n: 21, rarity: "common", kind: "monster", type: "cosmic", price: 10515 },
  { n: 22, rarity: "common", kind: "monster", type: "fire", price: 10929 },
  { n: 23, rarity: "common", kind: "monster", type: "water", price: 11342 },
  { n: 24, rarity: "common", kind: "event", type: "cosmic", price: 11755 },
  { n: 25, rarity: "common", kind: "monster", type: "electric", price: 12168 },
  { n: 26, rarity: "common", kind: "monster", type: "psychic", price: 12582 },
  { n: 27, rarity: "common", kind: "monster", type: "rock", price: 12995 },
  { n: 28, rarity: "common", kind: "monster", type: "dark", price: 13408 },
  { n: 29, rarity: "common", kind: "monster", type: "steel", price: 13821 },
  { n: 30, rarity: "common", kind: "monster", type: "fairy", price: 14235 },
  { n: 31, rarity: "common", kind: "monster", type: "dragon", price: 14648 },
  { n: 32, rarity: "common", kind: "monster", type: "cosmic", price: 15061 },
  { n: 33, rarity: "common", kind: "event", type: "cosmic", price: 15474 },
  { n: 34, rarity: "common", kind: "monster", type: "water", price: 15888 },
  { n: 35, rarity: "common", kind: "monster", type: "grass", price: 16301 },
  { n: 36, rarity: "common", kind: "monster", type: "electric", price: 16714 },
  { n: 37, rarity: "common", kind: "monster", type: "psychic", price: 17128 },
  { n: 38, rarity: "common", kind: "monster", type: "rock", price: 17541 },
  { n: 39, rarity: "common", kind: "monster", type: "dark", price: 17954 },
  { n: 40, rarity: "common", kind: "monster", type: "steel", price: 18367 },
  { n: 41, rarity: "common", kind: "event", type: "cosmic", price: 18781 },
  { n: 42, rarity: "common", kind: "monster", type: "dragon", price: 19194 },
  { n: 43, rarity: "common", kind: "monster", type: "cosmic", price: 19607 },
  { n: 44, rarity: "common", kind: "monster", type: "fire", price: 20020 },
  { n: 45, rarity: "common", kind: "monster", type: "water", price: 20434 },
  { n: 46, rarity: "common", kind: "monster", type: "grass", price: 20847 },
  { n: 47, rarity: "common", kind: "monster", type: "electric", price: 21260 },
  { n: 48, rarity: "common", kind: "event", type: "cosmic", price: 21673 },
  { n: 49, rarity: "common", kind: "monster", type: "rock", price: 22087 },
  { n: 50, rarity: "common", kind: "monster", type: "dark", price: 22500 },
];

const key = (n: number) => `cw-${String(n).padStart(3, "0")}`;

export const COSMIC_WINDS_COMMONS_CARDS: readonly CosmicCardDraft[] = ROWS.map((r) => ({
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

export const COSMIC_WINDS_COMMONS_ART: Readonly<Record<string, NexamonArt>> = Object.fromEntries(
  ROWS.map((r) => [key(r.n), art(r.n, r.rarity)]),
);
