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
  /** ADR-192: battles: every player in seat order. */
  players: NexamonFigure[] | null;
  /** ADR-205: battle modes (battles only). */
  reverse?: boolean;
  twist?: boolean;
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
  /** ADR-192: which pack of the lineup (1 = the first) and the position over the whole lineup (1-based). */
  pack: number;
  idx: number;
}

/** ADR-205: the modes of a Pack Battle (both may be on). */
export interface NexamonBattleModes {
  reverse: boolean;
  twist: boolean;
}

/** ADR-192: one pack of a battle's lineup. */
export interface NexamonBattlePack {
  set: NexamonSetKey;
  priceCents: number;
}

/** ADR-192: one seat of a battle (0 = the creator). */
export interface NexamonBattleSeat {
  seat: number;
  player: NexamonFigure;
  isMe: boolean;
  /** Only the cards the shared clock has reached. */
  cards: NexamonShownPull[];
  cents: number;
  /** ADR-205: what the seat holds for the decision so far (its pile after the twists known); = cents without Twist. */
  scoreCents: number;
}

export type NexamonBattleStatus = "pending" | "declined" | "expired" | "cancelled" | "aborted" | "running" | "done";

export interface NexamonBattle {
  id: string;
  set: NexamonSetKey;
  status: NexamonBattleStatus;
  /** The stake per player (ADR-192: the sum of the lineup). */
  priceCents: number;
  /** ADR-192: duel = the classic challenge, multi = a lobby with a lineup and 2-4 seats. */
  mode: "duel" | "multi";
  size: number;
  /** ADR-205 "Umgekehrt": the lowest total wins. */
  reverse: boolean;
  /** ADR-205 "Twist": the piles are permuted after every pack. */
  twist: boolean;
  /** ADR-205: the twists the shared clock has reached, one per pack: seat i takes the pile of seat perm[i]. */
  twists: number[][];
  /** ADR-205: how long each twist plays (0 without Twist). */
  twistMs: number;
  /** ADR-205: the seed of the twists, known from the decision moment on. */
  twistSeed: number | null;
  packs: NexamonBattlePack[];
  seats: NexamonBattleSeat[];
  mySeat: number | null;
  /** Known from the decision moment on. */
  winnerSeat: number | null;
  challenger: NexamonFigure;
  /** Null while a lobby waits for its second player. */
  opponent: NexamonFigure | null;
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
  /** ADR-192: friends' open lobbies with a free seat. */
  openBattles: (NexamonBattle & { invited: boolean })[];
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
  /**
   * ADR-192: a lobby with a pack lineup (sets in order) for `size` players; invites friends by nickname.
   * ADR-205: `modes` picks "Umgekehrt" (reverse) and/or "Twist".
   */
  createNexamonPackBattle(
    requestId: string,
    sets: NexamonSetKey[],
    size: number,
    invite: string[],
    modes?: NexamonBattleModes,
  ): Promise<NexamonBattle>;
  joinNexamonPackBattle(requestId: string, battleId: string): Promise<NexamonBattle>;
  respondNexamonBattle(requestId: string, battleId: string, accept: boolean): Promise<NexamonBattle>;
  cancelNexamonBattle(requestId: string, battleId: string): Promise<NexamonBattle>;
  nexamonBattle(battleId: string): Promise<NexamonBattle>;
  /** A live opening as a spectator sees it (counts as watching). */
  nexamonLive(liveId: string): Promise<NexamonLiveView>;
  /** The opener's page: `revealed` cards of the bought pack are showing. */
  reportNexamonLive(packId: string, revealed: number): Promise<NexamonLiveReport>;
  reactNexamonLive(requestId: string, liveId: string, emoji: string): Promise<NexamonLiveReaction[]>;
}
