/**
 * Level pace (ADR-202): how many days an active player needs from one level to another.
 *
 * A measuring tool, not game logic: the XP an active player collects per day is estimated from the XP sources of
 * `progression` (missions with their level scale, login streak, trades, work, tasks, NFT mints, battles, home and
 * company) and integrated over the level curve. The assumptions about the player (how many trades, missions,
 * battles ...) are the `ActivePlayer` profile below; the game values all come from the config.
 * Used by the tests and docs/BALANCING.md (section 3.2) to compare curves before and after a change.
 */
import { BALANCE } from "../../config/balance.ts";
import type { ProgressionConfig } from "../../config/balance.ts";
import { dailyLoginXp, missionXpScale, scaledXp, unlockLevel, xpForNextLevel } from "./progression.ts";

/** What an active player does on an ordinary day (assumptions, not game values). */
export interface ActivePlayer {
  readonly loginStreakDays: number;
  readonly tradesPerDay: number;
  /** Base XP from closing trades with a profit. */
  readonly profitXpPerDay: number;
  /** Work hours with XP once the first job is unlocked. */
  readonly workHoursPerDay: number;
  readonly workTasksPerDay: number;
  readonly quickMissionsPerDay: number;
  /** Share of the daily and weekly missions the player finishes. */
  readonly dailyMissionShare: number;
  readonly weeklyMissionShare: number;
  /** Base XP of milestones per day (before the level scale). */
  readonly milestoneXpPerDay: number;
  /** NFT mints per day once NFTs are unlocked, base XP each. */
  readonly nftMintsPerDay: number;
  readonly nftMintXp: number;
  /** Battle wins with a prize per day and the prize XP of one (base). */
  readonly battleWinsPerDay: number;
  readonly battleWinXp: number;
  /** Home XP per day once property is unlocked (base, a small flat). */
  readonly homeXpPerDay: number;
  /** Profitable company quarters per day, from this many levels after founding is unlocked. */
  readonly profitableQuartersPerDay: number;
  readonly companyDelayLevels: number;
}

/** The active player of docs/BALANCING.md, section 3.2: plays every day, a few sessions. */
export const ACTIVE_PLAYER: ActivePlayer = {
  loginStreakDays: 14,
  tradesPerDay: 20,
  profitXpPerDay: 100,
  workHoursPerDay: 8,
  workTasksPerDay: 4,
  quickMissionsPerDay: 6,
  dailyMissionShare: 1,
  weeklyMissionShare: 1,
  milestoneXpPerDay: 300,
  nftMintsPerDay: 1,
  nftMintXp: 100,
  battleWinsPerDay: 0.25,
  battleWinXp: 1_600,
  homeXpPerDay: 72,
  profitableQuartersPerDay: 1,
  companyDelayLevels: 4,
};

const avg = (range: { readonly minXp: number; readonly maxXp: number }): number => (range.minXp + range.maxXp) / 2;

/** XP (credited, multiplier applied) an active player collects per day at `level`. */
export function activeDailyXp(
  level: number,
  cfg: ProgressionConfig = BALANCE.progression,
  player: ActivePlayer = ACTIVE_PLAYER,
): number {
  const src = cfg.xpSources;
  const has = (key: string): boolean => level >= (unlockLevel(key, cfg) ?? Infinity);
  const scale = missionXpScale(level, cfg);
  let base = dailyLoginXp(player.loginStreakDays, cfg);
  base += Math.min(player.tradesPerDay, src.trade.maxTradesPerDay) * src.trade.xp;
  base += player.profitXpPerDay;
  if (has("first_job")) {
    base += Math.min(player.workHoursPerDay, src.workHour.maxHoursPerDay) * src.workHour.xp;
    base += player.workTasksPerDay * avg(src.workTask);
  }
  base +=
    scale *
    (player.quickMissionsPerDay * avg(src.quickMission) +
      player.dailyMissionShare * src.dailyMission.perDay * avg(src.dailyMission) +
      (player.weeklyMissionShare * src.weeklyMission.perWeek * avg(src.weeklyMission)) / 7 +
      player.milestoneXpPerDay);
  if (has("artworks")) base += player.nftMintsPerDay * player.nftMintXp;
  if (has("first_job")) base += player.battleWinsPerDay * player.battleWinXp;
  if (has("property")) base += player.homeXpPerDay;
  const founded = unlockLevel("found_garage", cfg);
  if (founded !== null && level >= founded + player.companyDelayLevels) {
    base += player.profitableQuartersPerDay * src.profitableCompanyQuarter.xp;
  }
  return scaledXp(base, cfg);
}

/** Days an active player needs from level `from` to level `to` (fractional). */
export function daysBetweenLevels(
  from: number,
  to: number,
  cfg: ProgressionConfig = BALANCE.progression,
  player: ActivePlayer = ACTIVE_PLAYER,
): number {
  let days = 0;
  for (let level = from; level < to; level++) days += xpForNextLevel(level, cfg) / activeDailyXp(level, cfg, player);
  return days;
}

/** The bands of docs/BALANCING.md, section 3.2. */
export const PACE_BANDS: readonly (readonly [number, number])[] = [
  [1, 5],
  [5, 10],
  [10, 20],
  [20, 30],
  [30, 40],
];

/** Days per band and in total (1 → 40). */
export function levelPace(
  cfg: ProgressionConfig = BALANCE.progression,
  player: ActivePlayer = ACTIVE_PLAYER,
): {
  readonly bands: readonly { readonly from: number; readonly to: number; readonly days: number }[];
  readonly total: number;
} {
  const bands = PACE_BANDS.map(([from, to]) => ({ from, to, days: daysBetweenLevels(from, to, cfg, player) }));
  return { bands, total: bands.reduce((sum, b) => sum + b.days, 0) };
}
