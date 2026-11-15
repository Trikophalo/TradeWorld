import type { BattleKind } from "@/config/battles";

/*
 * News battles (ADR-160): what the client sees of the lobby, a running battle and its result.
 */

export type BattleStatus = "open" | "running" | "finished" | "cancelled";

export interface BattlePlayer {
  /** Fixed from the start on; null while the lobby is open. */
  slot: number | null;
  nickname: string;
  avatarKey: string;
  accessories: string[];
  me: boolean;
  left: boolean;
  /** 1 = winner; set when the battle is over. */
  rank: number | null;
}

export interface BattleArtwork {
  id: string;
  title: string;
  serial: number;
  rarity: string | null;
  pixels: { palette: string[]; grid: string[] };
}

export type BattlePrize =
  | { kind: "xp"; xp: number }
  | { kind: "money"; cents: number; fallback?: boolean }
  | { kind: "skin"; accessories?: string[]; key?: string; name?: string }
  | { kind: "nft"; artwork: BattleArtwork }
  | { kind: "none" };

/** The rules of a running battle, copied by the server at the start (battles.params). */
export interface BattleParams {
  w: number;
  h: number;
  stepTicks: number;
  spawns: [number, number][];
  disconnectTicks: number;
  tps: number;
  tickMs: number;
  graceMs: number;
  aheadTicks: number;
  checkEveryMs: number;
  game: Record<string, unknown>;
}

export interface BattleRoundAnswer {
  slot: number;
  choice?: number | null;
  value?: number | null;
  ms: number;
  points: number;
  right: boolean;
}

export interface BattleRound {
  round: number;
  opensAt: string;
  /** Quiz/estimate: end of the answer time. Bell: end of the press window (once it rang). */
  closesAt: string | null;
  endsAt: string;
  /** Bell: when it rang, once it did. */
  bellAt: string | null;
  question: string | null;
  options: string[] | null;
  unit: string | null;
  decimals: number | null;
  /** After the round closed. */
  correct: number | null;
  value: number | null;
  results: BattleRoundAnswer[] | null;
  lost: number[] | null;
  mine: { pressed: boolean; choice: number | null; value: number | null };
}

export interface BattleRounds {
  list: BattleRound[];
  hearts: number[];
  points: number[];
  out: number[];
  done: boolean;
}

export interface BattleResult {
  ranking: number[];
  winnerSlot: number;
  endTick: number | null;
  paid: boolean;
  capped: boolean;
  prize: BattlePrize;
  score: number[] | null;
  out: number[] | null;
}

export interface Battle {
  id: number;
  status: BattleStatus;
  kind: BattleKind | null;
  seed: number | null;
  openedAt: string;
  countdownEndsAt: string | null;
  startedAt: string | null;
  endsAt: string | null;
  finishedAt: string | null;
  minPlayers: number;
  maxPlayers: number;
  params: BattleParams | null;
  prize: BattlePrize;
  players: BattlePlayer[];
  joined: boolean;
  prizeWinsLeft: number;
  rounds: BattleRounds | null;
  result: BattleResult | null;
}

export interface BattleState {
  now: string;
  viewers: number;
  /** The open lobby or the running battle. */
  battle: Battle | null;
  /** The last finished battle, for a while (podium). */
  recent: Battle | null;
  /** Battles of this hour that started, of perHour; after that the next round begins at nextRoundAt. */
  playedThisHour: number;
  perHour: number;
  nextRoundAt: string;
}

export interface BattleSync {
  now: string;
  status: BattleStatus;
  /** Ticks before this one are final. */
  finalTick: number;
  /** Every player's stream from the tick asked for. */
  streams: { slot: number; data: string }[];
}

export interface BattleEngine {
  battle(): Promise<BattleState>;
  joinBattle(requestId: string): Promise<BattleState>;
  leaveBattle(requestId: string): Promise<BattleState>;
  syncBattle(
    battleId: number,
    from: number,
    inputs: string,
    since: number,
    endTick: number | null,
  ): Promise<BattleSync>;
  answerBattle(
    requestId: string,
    battleId: number,
    round: number,
    choice: number | null,
    value: number | null,
  ): Promise<BattleState>;
}
