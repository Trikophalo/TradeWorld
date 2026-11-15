import { z } from "zod";
import { BATTLE_KINDS } from "@/config/battles";
import type { Battle, BattleEngine, BattlePrize, BattleState } from "./battle-types";
import { rpc } from "./rpc";

/*
 * News battles (ADR-160) against the server: the lobby, inputs of the action games (battle_sync) and answers of the
 * round games.
 */
const artworkSchema = z.object({
  id: z.string(),
  title: z.string(),
  serial: z.number(),
  rarity: z.string().nullable(),
  pixels: z.object({ palette: z.array(z.string()), grid: z.array(z.string()) }),
});
const prizeSchema = z
  .union([
    z.object({ kind: z.literal("xp"), xp: z.number() }),
    z.object({ kind: z.literal("money"), cents: z.number(), fallback: z.boolean().optional() }),
    z.object({
      kind: z.literal("skin"),
      accessories: z.array(z.string()).optional(),
      key: z.string().optional(),
      name: z.string().optional(),
    }),
    z.object({ kind: z.literal("nft"), artwork: artworkSchema }),
    z.object({ kind: z.literal("none") }),
  ])
  .catch({ kind: "none" });
const answerSchema = z.object({
  slot: z.number(),
  choice: z.number().nullish(),
  value: z.number().nullish(),
  ms: z.number(),
  points: z.number(),
  right: z.boolean(),
});
const roundSchema = z.object({
  round: z.number(),
  opens_at: z.string(),
  closes_at: z.string().nullish(),
  ends_at: z.string(),
  bell_at: z.string().nullish(),
  question: z.string().nullish(),
  options: z.array(z.string()).nullish(),
  unit: z.string().nullish(),
  decimals: z.number().nullish(),
  correct: z.number().nullish(),
  value: z.number().nullish(),
  results: z.array(answerSchema).nullish(),
  lost: z.array(z.number()).nullish(),
  mine: z.object({ pressed: z.boolean(), choice: z.number().nullish(), value: z.number().nullish() }),
});
const battleSchema = z.object({
  id: z.number(),
  status: z.enum(["open", "running", "finished", "cancelled"]),
  kind: z.enum(BATTLE_KINDS).nullable(),
  seed: z.number().nullable(),
  opened_at: z.string(),
  countdown_ends_at: z.string().nullable(),
  started_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  min_players: z.number(),
  max_players: z.number(),
  params: z
    .object({
      w: z.number(),
      h: z.number(),
      stepTicks: z.number(),
      spawns: z.array(z.tuple([z.number(), z.number()])),
      disconnectTicks: z.number(),
      tps: z.number(),
      tickMs: z.number(),
      graceMs: z.number(),
      aheadTicks: z.number(),
      checkEveryMs: z.number(),
      game: z.record(z.string(), z.unknown()),
    })
    .nullable(),
  prize: prizeSchema,
  players: z.array(
    z.object({
      slot: z.number().nullable(),
      nickname: z.string(),
      avatar_key: z.string().nullable(),
      accessories: z.array(z.string()),
      me: z.boolean(),
      left: z.boolean(),
      rank: z.number().nullable(),
    }),
  ),
  joined: z.boolean(),
  prize_wins_left: z.number(),
  rounds: z
    .object({
      list: z.array(roundSchema),
      hearts: z.array(z.number()),
      points: z.array(z.number()),
      out: z.array(z.number()),
      done: z.boolean(),
    })
    .nullable(),
  result: z
    .object({
      ranking: z.array(z.number()),
      winner_slot: z.number(),
      end_tick: z.number().nullable(),
      paid: z.boolean(),
      capped: z.boolean(),
      prize: prizeSchema,
      score: z.array(z.number()).nullable(),
      out: z.array(z.number()).nullable(),
    })
    .nullable(),
});
const stateSchema = z.object({
  now: z.string(),
  viewers: z.number(),
  battle: battleSchema.nullable(),
  recent: battleSchema.nullable(),
});
const syncSchema = z.object({
  now: z.string(),
  status: z.enum(["open", "running", "finished", "cancelled"]),
  final_tick: z.number(),
  streams: z.array(z.object({ slot: z.number(), data: z.string() })),
});

export const BATTLE_RPC_SCHEMAS = {
  get_battle: stateSchema,
  battle_join: stateSchema,
  battle_leave: stateSchema,
  battle_answer: stateSchema,
  battle_sync: syncSchema,
} as const;

function toBattle(b: z.infer<typeof battleSchema> | null): Battle | null {
  if (!b) return null;
  return {
    id: b.id,
    status: b.status,
    kind: b.kind,
    seed: b.seed,
    openedAt: b.opened_at,
    countdownEndsAt: b.countdown_ends_at,
    startedAt: b.started_at,
    endsAt: b.ends_at,
    finishedAt: b.finished_at,
    minPlayers: b.min_players,
    maxPlayers: b.max_players,
    params: b.params,
    prize: b.prize as BattlePrize,
    players: b.players.map((p) => ({
      slot: p.slot,
      nickname: p.nickname,
      avatarKey: p.avatar_key ?? "rookie",
      accessories: p.accessories,
      me: p.me,
      left: p.left,
      rank: p.rank,
    })),
    joined: b.joined,
    prizeWinsLeft: b.prize_wins_left,
    rounds: b.rounds && {
      list: b.rounds.list.map((r) => ({
        round: r.round,
        opensAt: r.opens_at,
        closesAt: r.closes_at ?? null,
        endsAt: r.ends_at,
        bellAt: r.bell_at ?? null,
        question: r.question ?? null,
        options: r.options ?? null,
        unit: r.unit ?? null,
        decimals: r.decimals ?? null,
        correct: r.correct ?? null,
        value: r.value ?? null,
        results: r.results ?? null,
        lost: r.lost ?? null,
        mine: { pressed: r.mine.pressed, choice: r.mine.choice ?? null, value: r.mine.value ?? null },
      })),
      hearts: b.rounds.hearts,
      points: b.rounds.points,
      out: b.rounds.out,
      done: b.rounds.done,
    },
    result: b.result && {
      ranking: b.result.ranking,
      winnerSlot: b.result.winner_slot,
      endTick: b.result.end_tick,
      paid: b.result.paid,
      capped: b.result.capped,
      prize: b.result.prize as BattlePrize,
      score: b.result.score,
      out: b.result.out,
    },
  };
}

const toState = (r: z.infer<typeof stateSchema>): BattleState => ({
  now: r.now,
  viewers: r.viewers,
  battle: toBattle(r.battle),
  recent: toBattle(r.recent),
});

export const liveBattleEngine: BattleEngine = {
  async battle() {
    return toState(await rpc("get_battle", {}, stateSchema));
  },
  async joinBattle(requestId) {
    return toState(await rpc("battle_join", { p_request_id: requestId }, stateSchema));
  },
  async leaveBattle(requestId) {
    return toState(await rpc("battle_leave", { p_request_id: requestId }, stateSchema));
  },
  async syncBattle(battleId, from, inputs, since, endTick) {
    const r = await rpc(
      "battle_sync",
      { p_battle_id: battleId, p_from: from, p_inputs: inputs, p_since: since, p_end_tick: endTick },
      syncSchema,
    );
    return { now: r.now, status: r.status, finalTick: r.final_tick, streams: r.streams };
  },
  async answerBattle(requestId, battleId, round, choice, value) {
    return toState(
      await rpc(
        "battle_answer",
        { p_request_id: requestId, p_battle_id: battleId, p_round: round, p_choice: choice, p_value: value },
        stateSchema,
      ),
    );
  },
};
