/**
 * Level system (spec 9): XP curve, level lookup and unlocks.
 * XP is a plain `number` (not money).
 */
import { BALANCE } from "../../config/balance.ts";
import type { ProgressionConfig, UnlockConfig } from "../../config/balance.ts";

/** XP needed to advance from level `level` to `level + 1`: `round(100 x level^1.5)`. */
export function xpForNextLevel(level: number, cfg: ProgressionConfig = BALANCE.progression): number {
  if (!Number.isInteger(level) || level < 1) throw new RangeError(`invalid level: ${level}`);
  return Math.round(cfg.xpBase * Math.pow(level, cfg.xpExponent));
}

/** Total XP needed to reach `level` starting from level 1 with 0 XP. */
export function totalXpForLevel(level: number, cfg: ProgressionConfig = BALANCE.progression): number {
  if (!Number.isInteger(level) || level < 1) throw new RangeError(`invalid level: ${level}`);
  let total = 0;
  for (let n = 1; n < level; n++) total += xpForNextLevel(n, cfg);
  return total;
}

/** Level reached with `totalXp` accumulated XP, capped at `maxLevel`. */
export function levelFromTotalXp(totalXp: number, cfg: ProgressionConfig = BALANCE.progression): number {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (level < cfg.maxLevel) {
    const needed = xpForNextLevel(level, cfg);
    if (remaining < needed) break;
    remaining -= needed;
    level++;
  }
  return level;
}

export interface LevelProgress {
  readonly level: number;
  readonly isMaxLevel: boolean;
  /** XP collected inside the current level. */
  readonly xpIntoLevel: number;
  /** XP needed for the next level, 0 at max level. */
  readonly xpForNext: number;
  /** 0..1, 1 at max level. */
  readonly progress: number;
}

export function levelProgress(totalXp: number, cfg: ProgressionConfig = BALANCE.progression): LevelProgress {
  const level = levelFromTotalXp(totalXp, cfg);
  const isMaxLevel = level >= cfg.maxLevel;
  const xpIntoLevel = Math.max(0, Math.floor(totalXp)) - totalXpForLevel(level, cfg);
  if (isMaxLevel) return { level, isMaxLevel, xpIntoLevel, xpForNext: 0, progress: 1 };
  const xpForNext = xpForNextLevel(level, cfg);
  return { level, isMaxLevel, xpIntoLevel, xpForNext, progress: xpIntoLevel / xpForNext };
}

/** Unlocks granted exactly when reaching `level` (for the level-up overlay). */
export function unlocksAtLevel(level: number, cfg: ProgressionConfig = BALANCE.progression): readonly UnlockConfig[] {
  return cfg.unlocks.filter((u) => u.level === level);
}

/** All unlocks available at `level` (granted at this or any lower level). */
export function unlocksUpToLevel(level: number, cfg: ProgressionConfig = BALANCE.progression): readonly UnlockConfig[] {
  return cfg.unlocks.filter((u) => u.level <= level);
}

export function isUnlocked(key: string, level: number, cfg: ProgressionConfig = BALANCE.progression): boolean {
  return cfg.unlocks.some((u) => u.key === key && u.level <= level);
}

/** Level at which `key` unlocks, `null` for unknown keys. */
export function unlockLevel(key: string, cfg: ProgressionConfig = BALANCE.progression): number | null {
  const unlock = cfg.unlocks.find((u) => u.key === key);
  return unlock ? unlock.level : null;
}

/** The unlocks of the next level above `level` that grants anything, empty at the end. */
export function nextUnlocks(level: number, cfg: ProgressionConfig = BALANCE.progression): readonly UnlockConfig[] {
  let nextLevel = Infinity;
  for (const u of cfg.unlocks) if (u.level > level && u.level < nextLevel) nextLevel = u.level;
  return cfg.unlocks.filter((u) => u.level === nextLevel);
}

/** XP for closing a trade with a profit: +1 XP per 100 EUR, capped (spec 9.2). */
export function profitableCloseXp(profitCents: bigint, cfg: ProgressionConfig = BALANCE.progression): number {
  if (profitCents <= BigInt(0)) return 0;
  const { profitCentsPerXp, maxXpPerTrade } = cfg.xpSources.profitableClose;
  const xp = profitCents / BigInt(profitCentsPerXp);
  return xp > BigInt(maxXpPerTrade) ? maxXpPerTrade : Number(xp);
}

/** Login XP including the streak bonus (streak 1 = first day, no bonus). */
export function dailyLoginXp(streakDays: number, cfg: ProgressionConfig = BALANCE.progression): number {
  const { xp, streakBonusPerDay, streakBonusCap } = cfg.xpSources.dailyLogin;
  const bonus = Math.min(streakBonusCap, Math.max(0, streakDays - 1) * streakBonusPerDay);
  return xp + bonus;
}
