import { z } from "zod";
import { NEXAMON_CONDITIONS } from "@/config/nexamon-rules";
import { NEXAMON_RARITIES, NEXAMON_SETS } from "@/config/nexamon/types";
import type {
  NexamonBattle,
  NexamonFigure,
  NexamonLiveReaction,
  NexamonLiveSession,
  NexamonShownPull,
  PackBattleEngine,
} from "./pack-battle-types";
import { rpc } from "./rpc";

/*
 * Pack Battles and live openings (ADR-172) against the server.
 */
const num = z.number();
const iso = z.string();
const side = z.enum(["challenger", "opponent"]);

const figureSchema = z.object({
  nickname: z.string(),
  level: num,
  avatar_key: z.string().nullable(),
  accessories: z.array(z.string()).nullable(),
});
const pullSchema = z.object({
  slot: num,
  card_key: z.string(),
  rarity: z.enum(NEXAMON_RARITIES),
  condition: z.enum(NEXAMON_CONDITIONS),
  serial: num,
  value_cents: num,
  pack: num.optional(),
  idx: num.optional(),
});
const seatSchema = z.object({
  seat: num,
  player: figureSchema,
  is_me: z.boolean(),
  cards: z.array(pullSchema),
  cents: num,
});
const packSchema = z.object({ set: z.enum(NEXAMON_SETS), price_cents: num });
const reactionSchema = z.object({ id: num, emoji: z.string(), at: iso });
const battleSchema = z.object({
  id: z.string(),
  set: z.enum(NEXAMON_SETS),
  status: z.enum(["pending", "declined", "expired", "cancelled", "aborted", "running", "done"]),
  price_cents: num,
  mode: z.enum(["duel", "multi"]).default("duel"),
  size: num.default(2),
  packs: z.array(packSchema).nullish(),
  seats: z.array(seatSchema).nullish(),
  my_seat: num.nullish(),
  winner_seat: num.nullish(),
  challenger: figureSchema,
  opponent: figureSchema.nullable(),
  me: side.nullable(),
  created_at: iso,
  expires_at: iso,
  accepted_at: iso.nullable(),
  starts_at: iso.nullable(),
  decide_at: iso.nullable(),
  ends_at: iso.nullable(),
  tear_ms: num,
  slot_ms: num,
  challenger_cards: z.array(pullSchema),
  opponent_cards: z.array(pullSchema),
  challenger_cents: num,
  opponent_cents: num,
  winner: side.nullable(),
  tie_break: z.enum(["value", "rarest", "coin"]).nullable(),
  coin_seed: num.nullable(),
  abort_reason: z.string().nullable(),
  live_id: z.string().nullable(),
  viewers: num,
  reactions: z.array(reactionSchema),
  server_time: iso,
});
const liveSchema = z.object({
  id: z.string(),
  kind: z.enum(["pack", "battle"]),
  set: z.enum(NEXAMON_SETS),
  battle_id: z.string().nullable(),
  player: figureSchema,
  opponent: figureSchema.nullable(),
  players: z.array(figureSchema).nullish(),
  is_me: z.boolean(),
  started_at: iso,
  ends_at: iso,
  viewers: num,
});
const lobbySchema = z.object({
  players: z.array(figureSchema.extend({ is_friend: z.boolean(), opening: z.boolean(), battling: z.boolean() })),
  live: z.array(liveSchema),
  battles: z.array(battleSchema),
  open_battles: z.array(battleSchema.extend({ invited: z.boolean() })).default([]),
  limits: z.object({ per_hour: num, used: num, cooldown_until: iso.nullable() }),
  allow_watch: z.boolean(),
  server_time: iso,
});
const liveViewSchema = liveSchema.extend({
  pack_no: num.default(1),
  progress: num,
  cards: z.array(pullSchema),
  done: z.boolean(),
  reactions: z.array(reactionSchema),
  server_time: iso,
});
const battleResultSchema = z.object({ battle: battleSchema });
const reportSchema = z.object({ live_id: z.string().nullable(), viewers: num, reactions: z.array(reactionSchema) });
const reactedSchema = z.object({ reactions: z.array(reactionSchema) });

export const PACK_BATTLE_RPC_SCHEMAS = {
  nexamon_lobby: lobbySchema,
  challenge_nexamon_battle: battleResultSchema,
  create_nexamon_pack_battle: battleResultSchema,
  join_nexamon_pack_battle: battleResultSchema,
  respond_nexamon_battle: battleResultSchema,
  cancel_nexamon_battle: battleResultSchema,
  get_nexamon_battle: battleResultSchema,
  get_nexamon_live: liveViewSchema,
  nexamon_live_progress: reportSchema,
  nexamon_live_react: reactedSchema,
} as const;

const toFigure = (f: z.infer<typeof figureSchema>): NexamonFigure => ({
  nickname: f.nickname,
  level: f.level,
  avatarKey: f.avatar_key,
  accessories: f.accessories ?? [],
});
const toPull = (p: z.infer<typeof pullSchema>): NexamonShownPull => ({
  slot: p.slot,
  cardKey: p.card_key,
  rarity: p.rarity,
  condition: p.condition,
  serial: p.serial,
  valueCents: p.value_cents,
  pack: p.pack ?? 1,
  idx: p.idx ?? p.slot,
});
const toReaction = (r: z.infer<typeof reactionSchema>): NexamonLiveReaction => ({ id: r.id, emoji: r.emoji, at: r.at });
const toLive = (l: z.infer<typeof liveSchema>): NexamonLiveSession => ({
  id: l.id,
  kind: l.kind,
  set: l.set,
  battleId: l.battle_id,
  player: toFigure(l.player),
  opponent: l.opponent ? toFigure(l.opponent) : null,
  players: l.players ? l.players.map(toFigure) : null,
  isMe: l.is_me,
  startedAt: l.started_at,
  endsAt: l.ends_at,
  viewers: l.viewers,
});
export const toNexamonBattle = (b: z.infer<typeof battleSchema>): NexamonBattle => ({
  id: b.id,
  set: b.set,
  status: b.status,
  priceCents: b.price_cents,
  mode: b.mode,
  size: b.size,
  packs: (b.packs ?? [{ set: b.set, price_cents: b.price_cents }]).map((p) => ({
    set: p.set,
    priceCents: p.price_cents,
  })),
  seats: (
    b.seats ?? [
      {
        seat: 0,
        player: b.challenger,
        is_me: b.me === "challenger",
        cards: b.challenger_cards,
        cents: b.challenger_cents,
      },
      ...(b.opponent
        ? [
            {
              seat: 1,
              player: b.opponent,
              is_me: b.me === "opponent",
              cards: b.opponent_cards,
              cents: b.opponent_cents,
            },
          ]
        : []),
    ]
  ).map((s) => ({
    seat: s.seat,
    player: toFigure(s.player),
    isMe: s.is_me,
    cards: s.cards.map(toPull),
    cents: s.cents,
  })),
  mySeat: b.my_seat ?? (b.me === "challenger" ? 0 : b.me === "opponent" ? 1 : null),
  winnerSeat: b.winner_seat ?? (b.winner === "challenger" ? 0 : b.winner === "opponent" ? 1 : null),
  challenger: toFigure(b.challenger),
  opponent: b.opponent ? toFigure(b.opponent) : null,
  me: b.me,
  createdAt: b.created_at,
  expiresAt: b.expires_at,
  acceptedAt: b.accepted_at,
  startsAt: b.starts_at,
  decideAt: b.decide_at,
  endsAt: b.ends_at,
  tearMs: b.tear_ms,
  slotMs: b.slot_ms,
  challengerCards: b.challenger_cards.map(toPull),
  opponentCards: b.opponent_cards.map(toPull),
  challengerCents: b.challenger_cents,
  opponentCents: b.opponent_cents,
  winner: b.winner,
  tieBreak: b.tie_break,
  coinSeed: b.coin_seed,
  abortReason: b.abort_reason,
  liveId: b.live_id,
  viewers: b.viewers,
  reactions: b.reactions.map(toReaction),
  serverTime: b.server_time,
});

export const livePackBattleEngine: PackBattleEngine = {
  async nexamonLobby(allowWatch) {
    const r = await rpc("nexamon_lobby", { p_allow_watch: allowWatch }, lobbySchema);
    return {
      players: r.players.map((p) => ({
        ...toFigure(p),
        isFriend: p.is_friend,
        opening: p.opening,
        battling: p.battling,
      })),
      live: r.live.map(toLive),
      battles: r.battles.map(toNexamonBattle),
      openBattles: r.open_battles.map((b) => ({ ...toNexamonBattle(b), invited: b.invited })),
      limits: { perHour: r.limits.per_hour, used: r.limits.used, cooldownUntil: r.limits.cooldown_until },
      allowWatch: r.allow_watch,
      serverTime: r.server_time,
    };
  },
  async challengeNexamonBattle(requestId, nickname, set) {
    const r = await rpc(
      "challenge_nexamon_battle",
      { p_request_id: requestId, p_nickname: nickname, p_set: set },
      battleResultSchema,
    );
    return toNexamonBattle(r.battle);
  },
  async createNexamonPackBattle(requestId, sets, size, invite) {
    const r = await rpc(
      "create_nexamon_pack_battle",
      { p_request_id: requestId, p_sets: sets, p_size: size, p_invite: invite },
      battleResultSchema,
    );
    return toNexamonBattle(r.battle);
  },
  async joinNexamonPackBattle(requestId, battleId) {
    const r = await rpc(
      "join_nexamon_pack_battle",
      { p_request_id: requestId, p_battle_id: battleId },
      battleResultSchema,
    );
    return toNexamonBattle(r.battle);
  },
  async respondNexamonBattle(requestId, battleId, accept) {
    const r = await rpc(
      "respond_nexamon_battle",
      { p_request_id: requestId, p_battle_id: battleId, p_accept: accept },
      battleResultSchema,
    );
    return toNexamonBattle(r.battle);
  },
  async cancelNexamonBattle(requestId, battleId) {
    const r = await rpc(
      "cancel_nexamon_battle",
      { p_request_id: requestId, p_battle_id: battleId },
      battleResultSchema,
    );
    return toNexamonBattle(r.battle);
  },
  async nexamonBattle(battleId) {
    const r = await rpc("get_nexamon_battle", { p_battle_id: battleId }, battleResultSchema);
    return toNexamonBattle(r.battle);
  },
  async nexamonLive(liveId) {
    const r = await rpc("get_nexamon_live", { p_live_id: liveId }, liveViewSchema);
    return {
      ...toLive(r),
      packNo: r.pack_no,
      progress: r.progress,
      cards: r.cards.map(toPull),
      done: r.done,
      reactions: r.reactions.map(toReaction),
      serverTime: r.server_time,
    };
  },
  async reportNexamonLive(packId, revealed) {
    const r = await rpc("nexamon_live_progress", { p_pack_id: packId, p_revealed: revealed }, reportSchema);
    return { liveId: r.live_id, viewers: r.viewers, reactions: r.reactions.map(toReaction) };
  },
  async reactNexamonLive(requestId, liveId, emoji) {
    const r = await rpc(
      "nexamon_live_react",
      { p_request_id: requestId, p_live_id: liveId, p_emoji: emoji },
      reactedSchema,
    );
    return r.reactions.map(toReaction);
  },
};
