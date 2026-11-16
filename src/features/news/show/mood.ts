import { ANCHOR_MOODS, type AnchorMood } from "@/components/pixel/news-art";

/*
 * Mr. Doodle Dangle's moods: which face a story gets when the server does not say, and how long he reacts before he
 * starts to read. Pure, so the show and its tests can use it without the studio.
 */

/** The part of a segment the mood depends on. */
export interface MoodSource {
  kind: string;
  effects: readonly { tone: "gain" | "loss" | "neutral" }[];
  /** Set by the server; anything that is not a known mood counts as missing. */
  mood?: string | null;
}

/** What the effect chips of a story add up to. */
type Verdict = "none" | "gain" | "loss" | "mixed";

function verdictOf(effects: MoodSource["effects"]): Verdict {
  const gain = effects.some((effect) => effect.tone === "gain");
  const loss = effects.some((effect) => effect.tone === "loss");
  return gain && loss ? "mixed" : gain ? "gain" : loss ? "loss" : "none";
}

const same = (mood: AnchorMood): Record<Verdict, AnchorMood> => ({ none: mood, gain: mood, loss: mood, mixed: mood });

/** The face per kind of story, by what its effects add up to. */
const KIND_MOODS: Record<string, Record<Verdict, AnchorMood>> = {
  intro: same("neutral"),
  outro: same("neutral"),
  // He enjoys roasting a player who lost money, is proud of the winner and scandalised by a scandal.
  loser: same("smug"),
  winner: same("proud"),
  scandal: same("shocked"),
  hype: same("laughing"),
  stock: { none: "neutral", gain: "proud", loss: "shocked", mixed: "confused" },
  sector: { none: "neutral", gain: "proud", loss: "angry", mixed: "confused" },
  world: { none: "neutral", gain: "laughing", loss: "shocked", mixed: "confused" },
  tasks: { none: "neutral", gain: "proud", loss: "angry", mixed: "confused" },
  // His own coins are in there.
  crypto: { none: "confused", gain: "laughing", loss: "crying", mixed: "confused" },
  // He does not understand NFTs, but he likes it when they pay.
  nft: { none: "confused", gain: "smug", loss: "crying", mixed: "confused" },
  gossip: { none: "smug", gain: "smug", loss: "laughing", mixed: "smug" },
  ramble: same("confused"),
  // Collectibles puzzle him, the Finanzamt delights him (as long as it visits others), listed companies are drama.
  cards: { none: "confused", gain: "laughing", loss: "crying", mixed: "confused" },
  tax: same("smug"),
  corp: { none: "shocked", gain: "proud", loss: "shocked", mixed: "confused" },
};

/** Kinds the studio does not know: judged by their effects alone. */
const OTHER_MOODS: Record<Verdict, AnchorMood> = { none: "neutral", gain: "proud", loss: "shocked", mixed: "confused" };

export function isAnchorMood(value: unknown): value is AnchorMood {
  return typeof value === "string" && (ANCHOR_MOODS as readonly string[]).includes(value);
}

/** The mood of a segment that does not bring one: from its kind and the tones of its effects. Ignores `mood`. */
export function defaultMood(segment: Pick<MoodSource, "kind" | "effects">): AnchorMood {
  const table = Object.hasOwn(KIND_MOODS, segment.kind) ? KIND_MOODS[segment.kind]! : OTHER_MOODS;
  return table[verdictOf(segment.effects)];
}

/** The mood the studio shows: the segment's own if it is a known one, else `defaultMood`. */
export function segmentMood(segment: MoodSource): AnchorMood {
  return isAnchorMood(segment.mood) ? segment.mood : defaultMood(segment);
}

/**
 * How a mood begins, in ms since its segment started: until `startMs` he squares his pages as always, then the pose
 * and its sound hit, and from `endMs` on he reads in that mood. A neutral segment has no reaction.
 */
export const MOOD_REACTION = { startMs: 300, endMs: 1200 } as const;

/** How long after the start of a segment the typewriter begins: the reaction comes first. */
export function speechDelayMs(mood: AnchorMood): number {
  return mood === "neutral" ? 0 : MOOD_REACTION.endMs;
}
