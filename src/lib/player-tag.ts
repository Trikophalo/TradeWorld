/*
 * Player tags and name keys (ADR-085). Pure functions, mirrored in Postgres (migration M4d).
 */

/** No 0/O and 1/I: a tag can be read aloud and typed without mix-ups. */
export const TAG_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const TAG_LENGTH = 4;

const TAG_RE = new RegExp(`^[${TAG_ALPHABET}]{${TAG_LENGTH}}$`);

/** "#k7q2", " K7Q2 " → "K7Q2"; anything that is not a valid tag → null. */
export function parseTag(input: string): string | null {
  const value = input.trim().replace(/^#/, "").toUpperCase();
  return TAG_RE.test(value) ? value : null;
}

export function formatTag(tag: string): string {
  return `#${tag}`;
}

/** The friend code a player hands out (ADR-111): "NEXA-" plus the tag. */
export const FRIEND_CODE_PREFIX = "NEXA";

export function friendCodeOf(tag: string): string {
  return `${FRIEND_CODE_PREFIX}-${tag}`;
}

/** "NEXA-K7Q2", "nexa k7q2", "#K7Q2", "K7Q2" → "K7Q2"; anything else → null. Same as redeem_friend_code(). */
export function parseFriendCode(input: string): string | null {
  let value = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (value.length === FRIEND_CODE_PREFIX.length + TAG_LENGTH && value.startsWith(FRIEND_CODE_PREFIX)) {
    value = value.slice(FRIEND_CODE_PREFIX.length);
  }
  return TAG_RE.test(value) ? value : null;
}

/** A tag from uniform numbers in [0, 1) (randomness is passed in). */
export function tagFromUniform(u: readonly number[]): string {
  return Array.from({ length: TAG_LENGTH }, (_, i) => {
    const x = Math.min(0.999_999, Math.max(0, u[i] ?? 0));
    return TAG_ALPHABET[Math.floor(x * TAG_ALPHABET.length)]!;
  }).join("");
}

const FOLD: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" };

/**
 * Two nicknames with the same key look alike ("Mira", "M1ra", "Mi_ra") and cannot both exist (ADR-085).
 * Same as the server's replace(name_normalize(nick, true), '_', ''); repeated letters stay ("Matthias" ≠ "Mathias").
 */
export function nameKey(nickname: string): string {
  return nickname
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => FOLD[c]!)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[0134578]/g, (c) => LEET[c]!)
    .replace(/_/g, "");
}
