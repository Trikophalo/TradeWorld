/**
 * The action games of the news battles (ADR-160) behind one interface, and the rules for the input streams the
 * server keeps (public.battle_input). Pure: no clock, no randomness; everything comes from the seed and the inputs.
 */
import { BATTLE_RULES, type TickKind } from "../../../config/battles.ts";
import { bearClone, bearInit, bearRanking, bearStep, type BearState } from "./bear.ts";
import { bullsClone, bullsInit, bullsRanking, bullsStep, type BullsState } from "./bulls.ts";
import { coinsClone, coinsInit, coinsRanking, coinsStep, type CoinsState } from "./coins.ts";
import type { SimParams } from "./core.ts";
import { dashClone, dashInit, dashRanking, dashStep, type DashState } from "./dash.ts";
import { elevatorClone, elevatorInit, elevatorRanking, elevatorStep, type ElevatorState } from "./elevator.ts";
import { floorClone, floorInit, floorRanking, floorStep, type FloorState } from "./floor.ts";
import { laserClone, laserInit, laserRanking, laserStep, type LaserState } from "./laser.ts";
import { marginClone, marginInit, marginRanking, marginStep, type MarginState } from "./margin.ts";
import { potatoClone, potatoInit, potatoRanking, potatoStep, type PotatoState } from "./potato.ts";
import { pumpClone, pumpInit, pumpRanking, pumpStep, type PumpState } from "./pump.ts";
import { rodeoClone, rodeoInit, rodeoRanking, rodeoStep, type RodeoState } from "./rodeo.ts";
import { sumoClone, sumoInit, sumoRanking, sumoStep, type SumoState } from "./sumo.ts";
import { zoneClone, zoneInit, zoneRanking, zoneStep, type ZoneState } from "./zone.ts";
import { tagClone, tagInit, tagRanking, tagStep, type TagState } from "./tag.ts";
import { tilesClone, tilesInit, tilesRanking, tilesStep, type TilesState } from "./tiles.ts";
import { paintClone, paintInit, paintRanking, paintStep, type PaintState } from "./paint.ts";
import { crashClone, crashInit, crashRanking, crashStep, type CrashState } from "./crash.ts";

export type { SimParams } from "./core.ts";

export interface StateOf {
  floor: FloorState;
  bulls: BullsState;
  coins: CoinsState;
  sumo: SumoState;
  potato: PotatoState;
  pump: PumpState;
  bear: BearState;
  dash: DashState;
  margin: MarginState;
  elevator: ElevatorState;
  laser: LaserState;
  rodeo: RodeoState;
  zone: ZoneState;
  tag: TagState;
  tiles: TilesState;
  paint: PaintState;
  crash: CrashState;
}
export type AnyBattleState = StateOf[TickKind];

type GameParams = (typeof BATTLE_RULES.games)[TickKind];

interface Game<S, G> {
  init(seed: number, n: number, params: SimParams<G>): S;
  step(state: S, inputs: string, params: SimParams<G>): void;
  clone(state: S): S;
  ranking(state: S): number[];
  /** The longest the game can run, in ticks. */
  maxTicks(params: SimParams<G>): number;
}

const GAMES: { [K in TickKind]: Game<StateOf[K], (typeof BATTLE_RULES.games)[K]> } = {
  floor: {
    init: floorInit,
    step: floorStep,
    clone: floorClone,
    ranking: floorRanking,
    maxTicks: (p) => p.game.maxTicks,
  },
  bulls: {
    init: bullsInit,
    step: bullsStep,
    clone: bullsClone,
    ranking: bullsRanking,
    maxTicks: (p) => p.game.maxTicks,
  },
  coins: {
    init: coinsInit,
    step: coinsStep,
    clone: coinsClone,
    ranking: coinsRanking,
    maxTicks: (p) => p.game.durationTicks,
  },
  sumo: { init: sumoInit, step: sumoStep, clone: sumoClone, ranking: sumoRanking, maxTicks: (p) => p.game.maxTicks },
  potato: {
    init: potatoInit,
    step: potatoStep,
    clone: potatoClone,
    ranking: potatoRanking,
    maxTicks: (p) => p.game.maxTicks,
  },
  pump: {
    init: pumpInit,
    step: pumpStep,
    clone: pumpClone,
    ranking: pumpRanking,
    maxTicks: (p) => p.game.durationTicks,
  },
  bear: { init: bearInit, step: bearStep, clone: bearClone, ranking: bearRanking, maxTicks: (p) => p.game.maxTicks },
  dash: { init: dashInit, step: dashStep, clone: dashClone, ranking: dashRanking, maxTicks: (p) => p.game.maxTicks },
  margin: {
    init: marginInit,
    step: marginStep,
    clone: marginClone,
    ranking: marginRanking,
    maxTicks: (p) => p.game.maxTicks,
  },
  elevator: {
    init: elevatorInit,
    step: elevatorStep,
    clone: elevatorClone,
    ranking: elevatorRanking,
    maxTicks: (p) => p.game.maxTicks,
  },
  laser: {
    init: laserInit,
    step: laserStep,
    clone: laserClone,
    ranking: laserRanking,
    maxTicks: (p) => p.game.maxTicks,
  },
  rodeo: {
    init: rodeoInit,
    step: rodeoStep,
    clone: rodeoClone,
    ranking: rodeoRanking,
    maxTicks: (p) => p.game.maxTicks,
  },
  zone: { init: zoneInit, step: zoneStep, clone: zoneClone, ranking: zoneRanking, maxTicks: (p) => p.game.maxTicks },
  tag: { init: tagInit, step: tagStep, clone: tagClone, ranking: tagRanking, maxTicks: (p) => p.game.maxTicks },
  tiles: {
    init: tilesInit,
    step: tilesStep,
    clone: tilesClone,
    ranking: tilesRanking,
    maxTicks: (p) => p.game.maxTicks,
  },
  paint: {
    init: paintInit,
    step: paintStep,
    clone: paintClone,
    ranking: paintRanking,
    maxTicks: (p) => p.game.durationTicks,
  },
  crash: {
    init: crashInit,
    step: crashStep,
    clone: crashClone,
    ranking: crashRanking,
    maxTicks: (p) => p.game.maxTicks,
  },
};

/** The parameters a battle of this kind is simulated with (the server copies the same into battles.params). */
export function defaultSimParams<K extends TickKind>(kind: K): SimParams<(typeof BATTLE_RULES.games)[K]> {
  const a = BATTLE_RULES.arena;
  return {
    w: a.w,
    h: a.h,
    stepTicks: a.stepTicks,
    spawns: a.spawns,
    disconnectTicks: BATTLE_RULES.net.disconnectTicks,
    tps: Math.round(1000 / BATTLE_RULES.net.tickMs),
    game: BATTLE_RULES.games[kind],
  };
}

const game = (kind: TickKind) => GAMES[kind] as unknown as Game<AnyBattleState, GameParams>;

export function initBattle(kind: TickKind, seed: number, n: number, params: SimParams<GameParams>): AnyBattleState {
  return game(kind).init(seed, n, params);
}

export function stepBattle(kind: TickKind, state: AnyBattleState, inputs: string, params: SimParams<GameParams>): void {
  game(kind).step(state, inputs, params);
}

export function cloneBattle(kind: TickKind, state: AnyBattleState): AnyBattleState {
  return game(kind).clone(state);
}

/** Slots from the winner to the last place. */
export function battleRanking(kind: TickKind, state: AnyBattleState): number[] {
  return game(kind).ranking(state);
}

export function battleMaxTicks(kind: TickKind, params: SimParams<GameParams>): number {
  return game(kind).maxTicks(params);
}

/** This tick's inputs of all players: the stream's character, "x" where a stream has none. */
export function tickInputs(streams: readonly string[], tick: number): string {
  let out = "";
  for (const s of streams) out += s[tick] ?? "x";
  return out;
}

/** Runs a battle from the start to `until` (exclusive) or its end. */
export function simulateBattle(
  kind: TickKind,
  seed: number,
  streams: readonly string[],
  until: number,
  params: SimParams<GameParams>,
): AnyBattleState {
  const state = initBattle(kind, seed, streams.length, params);
  while (!state.done && state.tick < until) stepBattle(kind, state, tickInputs(streams, state.tick), params);
  return state;
}

// ---------------------------------------------------------------------------------------------------------------
// The stream rules of public.battle_input
// ---------------------------------------------------------------------------------------------------------------

/** Ticks before this one are final (their deadline passed): what is missing there counts as "x". */
export function finalTick(msSinceStart: number, tickMs: number, graceMs: number): number {
  return Math.max(0, Math.floor((msSinceStart - graceMs) / tickMs));
}

/** The tick the server clock is in (negative before the start). */
export function currentTick(msSinceStart: number, tickMs: number): number {
  return Math.floor(msSinceStart / tickMs);
}

/**
 * A chunk of inputs from tick `from` on, as the server takes it: nothing is rewritten, a gap is filled with "x",
 * characters for final ticks become "x", characters too far in the future are dropped, anything but 0..9 is "0".
 */
export function acceptChunk(
  stream: string,
  from: number,
  data: string,
  final: number,
  nowTick: number,
  aheadTicks: number,
): string {
  if (stream.includes("q") || from < 0) return stream;
  let out = stream;
  while (out.length < from) out += "x";
  for (let k = 0; k < data.length; k++) {
    const t = from + k;
    if (t < out.length) continue;
    if (t > nowTick + aheadTicks) break;
    const ch = data[k]!;
    out += t < final ? "x" : ch >= "0" && ch <= "9" ? ch : "0";
  }
  return out;
}

/** A player leaves at tick `tick`: the stream ends with "q" there (or right after what was already sent). */
export function quitStream(stream: string, tick: number): string {
  if (stream.includes("q")) return stream;
  let out = stream;
  while (out.length < tick) out += "x";
  return out + "q";
}
