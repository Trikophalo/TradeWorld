import type { NexamonCondition } from "@/config/nexamon-rules";
import type { NexamonRarity, NexamonSetKey } from "@/config/nexamon/types";
import type { BattleSide, BattleTieBreak } from "@/lib/sim/nexamon-battle";

/*
 * Pack Battles and live openings on the Collectibles tab (ADR-172).
 */
export interface NexamonFigure {
  nickname: string;
  level: number;
  avatarKey: string | null;
  accessories: string[];
}

/** A friend on the Collectibles tab right now. */
export interface NexamonLobbyPlayer extends NexamonFigure {
  isFriend: boolean;
  /** A live opening of theirs is running. */
  opening: boolean;
  /** In an open or running Pack Battle. */
  battling: boolean;
}

export interface NexamonLiveSession {
  id: string;
  kind: "pack" | "battle";
  set: NexamonSetKey;
  battleId: string | null;
  player: NexamonFigure;
  /** Battles: the challenged friend. */
  opponent: NexamonFigure | null;
  /** The viewer opens this pack or plays this battle. */
  isMe: boolean;
  startedAt: string;
  endsAt: string;
  viewers: number;
}

export interface NexamonLiveReaction {
  id: number;
  emoji: string;
  at: string;
}

/** One pulled card as it shows in a battle or a live opening. */
export interface NexamonShownPull {
  slot: number;
  cardKey: string;
  rarity: NexamonRarity;
  condition: NexamonCondition;
  serial: number;
  valueCents: number;
}

export type NexamonBattleStatus = "pending" | "declined" | "expired" | "cancelled" | "aborted" | "running" | "done";

export interface NexamonBattle {
  id: string;
  set: NexamonSetKey;
  status: NexamonBattleStatus;
  priceCents: number;
  challenger: NexamonFigure;
  opponent: NexamonFigure;
  /** The viewer's side; null for a spectator. */
  me: BattleSide | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  /** Both packs tear (shared clock). */
  startsAt: string | null;
  decideAt: string | null;
  endsAt: string | null;
  tearMs: number;
  slotMs: number;
  /** Only the slots the server's clock has reached (a card arrives shortly before it shows). */
  challengerCards: NexamonShownPull[];
  opponentCards: NexamonShownPull[];
  challengerCents: number;
  opponentCents: number;
  /** Known from the decision moment on. */
  winner: BattleSide | null;
  tieBreak: BattleTieBreak | null;
  coinSeed: number | null;
  abortReason: string | null;
  liveId: string | null;
  viewers: number;
  reactions: NexamonLiveReaction[];
  serverTime: string;
}

export interface NexamonLobby {
  players: NexamonLobbyPlayer[];
  live: NexamonLiveSession[];
  /** The viewer's open and running battles, newest first. */
  battles: NexamonBattle[];
  limits: { perHour: number; used: number; cooldownUntil: string | null };
  allowWatch: boolean;
  serverTime: string;
}

export interface NexamonLiveView extends NexamonLiveSession {
  /** ADR-182: which pack of a continued live opening is shown (1 = the first). */
  packNo: number;
  /** Cards the spectator may see. */
  progress: number;
  cards: NexamonShownPull[];
  done: boolean;
  reactions: NexamonLiveReaction[];
  serverTime: string;
}

export interface NexamonLiveReport {
  liveId: string | null;
  viewers: number;
  reactions: NexamonLiveReaction[];
}

export interface PackBattleEngine {
  /** Marks the player as on the Collectibles tab; friends there, live openings, own battles. */
  nexamonLobby(allowWatch: boolean): Promise<NexamonLobby>;
  challengeNexamonBattle(requestId: string, nickname: string, set: NexamonSetKey): Promise<NexamonBattle>;
  respondNexamonBattle(requestId: string, battleId: string, accept: boolean): Promise<NexamonBattle>;
  cancelNexamonBattle(requestId: string, battleId: string): Promise<NexamonBattle>;
  nexamonBattle(battleId: string): Promise<NexamonBattle>;
  /** A live opening as a spectator sees it (counts as watching). */
  nexamonLive(liveId: string): Promise<NexamonLiveView>;
  /** The opener's page: `revealed` cards of the bought pack are showing. */
  reportNexamonLive(packId: string, revealed: number): Promise<NexamonLiveReport>;
  reactNexamonLive(requestId: string, liveId: string, emoji: string): Promise<NexamonLiveReaction[]>;
}
