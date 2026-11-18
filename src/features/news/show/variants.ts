/*
 * NEXA Nachrichten, season three (ADR-210): every show opens with another tagline and ends with another goodbye.
 * The variant follows from the hour the show airs in, so every viewer sees the same one and consecutive shows never
 * repeat until the pool has gone round. Pure: no clock.
 */

const HOUR_MS = 3_600_000;

/** The show's number: the full hour it started in (ms epoch / 1 h); null without a valid time. */
export function showEpisode(startedAt: string | number | null | undefined): number | null {
  if (startedAt == null) return null;
  const ms = typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
  return Number.isFinite(ms) ? Math.floor(ms / HOUR_MS) : null;
}

/** The entry of `list` for show `episode`: one after the other, so `list.length` shows in a row all differ. */
export function episodeVariant<T>(list: readonly T[], episode: number | null | undefined): T | undefined {
  if (list.length === 0 || episode == null || !Number.isFinite(episode)) return undefined;
  const n = list.length;
  return list[((Math.trunc(episode) % n) + n) % n];
}
