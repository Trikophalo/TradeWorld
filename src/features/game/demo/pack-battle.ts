import { BALANCE } from "@/config/balance";
import { NEXAMON_CARDS, NEXAMON_SETS, type NexamonSetKey } from "@/config/nexamon";
import { nexamonOpenPack, nexamonCopyValueCents, nexamonE4FromCents, nexamonSetReleased } from "@/lib/sim/nexamon";
import {
  decideMultiBattle,
  multiBattleTimeline,
  multiKnownCards,
  packBattleCostCents,
  packBattleLineupOk,
} from "@/lib/sim/nexamon-battle";
import { createRng } from "@/lib/sim/rng";
import type { NexamonPull } from "../nexamon-types";
import type {
  NexamonBattle,
  NexamonFigure,
  NexamonLiveReaction,
  NexamonLiveSession,
  NexamonLiveView,
  NexamonLobby,
  NexamonShownPull,
  PackBattleEngine,
} from "../pack-battle-types";
import { GameError } from "../types";

/*
 * Pack Battles and live openings in the offline demo (ADR-172): the made-up friends (or, without any, three demo
 * collectors) stand on the Collectibles tab, accept a challenge after a moment and now and then open a pack live.
 * The demo player's own packs are live too; a few made-up viewers watch and react.
 */
const cfg = BALANCE.nexamon;
const ACCEPT_MS = 2_500;
/** A made-up friend opens a pack live in every window of this length (for `LIVE_MS`). */
const LIVE_WINDOW_MS = 45_000;
const LIVE_MS = 34_000;
/** ADR-182: the made-up friend opens two packs in one session, the second this long after the first. */
const LIVE_PACK_MS = 16_000;
const LIVE_FIRST_MS = 2_000;
const OWN_LIVE_MS = 30_000;

export interface DemoLobbyFriend extends NexamonFigure {
  online?: boolean;
}

export interface PackBattleHost {
  me(): NexamonFigure;
  level(): number;
  unlockLevel(): number;
  friends(): DemoLobbyFriend[];
  cashCents(): number;
  pay(cents: number): void;
  /** ADR-192: every seat opens the lineup; seat 0 is the demo player; `decide` picks the winning seat. */
  rollPacks(
    sets: readonly NexamonSetKey[],
    seats: number,
    decide: (pulls: NexamonPull[][]) => number,
  ): { pulls: NexamonPull[][]; winner: number };
  feed(kind: string, payload: Record<string, unknown>): void;
  notify(typeKey: string, title: string, body: string | null, link: string | null): void;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
  random(): number;
}

/** Without made-up friends the tab still has company. */
export const DEMO_COLLECTORS: readonly DemoLobbyFriend[] = [
  { nickname: "Mila", level: 16, avatarKey: "gamer", accessories: [] },
  { nickname: "Jonas", level: 12, avatarKey: "punk", accessories: [] },
  { nickname: "Ayla", level: 21, avatarKey: "scientist", accessories: [] },
];

/** A made-up friend takes the next free seat this long after the one before (ADR-192). */
const JOIN_MS = ACCEPT_MS;

interface DemoBattle {
  id: string;
  mode: "duel" | "multi";
  packs: NexamonSetKey[];
  size: number;
  /** Seat 1.. in order: who will join (invited friends first). */
  joiners: NexamonFigure[];
  status: "pending" | "declined" | "expired" | "cancelled" | "aborted" | "accepted";
  priceCents: number;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  cards: NexamonShownPull[][];
  winnerSeat: number | null;
  tieBreak: "value" | "rarest" | "coin" | null;
  seed: number;
  abortReason: string | null;
  refunded: boolean;
}

interface OwnLive {
  id: string;
  packId: string;
  set: NexamonSetKey;
  startedAt: number;
  progress: number;
  /** ADR-182: which pack of the session is shown, and the packs waiting after it. */
  packNo: number;
  queue: { packId: string; set: NexamonSetKey }[];
}

const iso = (ms: number) => new Date(ms).toISOString();
const shown = (p: NexamonPull): NexamonShownPull => {
  const pack = Math.floor((p.slot - 1) / cfg.packSize) + 1;
  return {
    slot: p.slot - (pack - 1) * cfg.packSize,
    cardKey: p.cardKey,
    rarity: p.rarity,
    condition: p.condition,
    serial: p.serial,
    valueCents: p.valueCents,
    pack,
    idx: p.slot,
  };
};

export function createPackBattleEngine(host: PackBattleHost): PackBattleEngine & {
  /** The demo's own pack purchase: becomes a live opening. */
  demoPackOpened(packId: string, set: NexamonSetKey): void;
} {
  const battles: DemoBattle[] = [];
  const own: OwnLive[] = [];
  const reactions: (NexamonLiveReaction & { liveId: string })[] = [];
  let nextId = 1;
  let lastChallengeAt = 0;

  const requireUnlock = () => {
    if (host.level() < host.unlockLevel()) throw new GameError("nexamon_locked");
  };
  const lobbyFriends = (): DemoLobbyFriend[] => {
    const list = host.friends().filter((f) => f.online !== false && f.level >= host.unlockLevel());
    return list.length > 0 ? list : [...DEMO_COLLECTORS];
  };

  /** The made-up friend who opens live in the window of `now`, with the window's start. */
  function friendLive(now: number) {
    const friends = lobbyFriends();
    const window = Math.floor(now / LIVE_WINDOW_MS);
    const startedAt = window * LIVE_WINDOW_MS;
    if (now >= startedAt + LIVE_MS || friends.length === 0) return null;
    const rng = createRng(172).derive("live", String(window));
    const friend = friends[Math.floor(rng.next() * friends.length)]!;
    const set = NEXAMON_SETS[Math.floor(rng.next() * 2)]!;
    const pack = () =>
      nexamonOpenPack(
        NEXAMON_CARDS.filter((c) => c.set === set),
        rng.next,
      ).map((pull): NexamonShownPull => ({
        slot: pull.slot,
        pack: 1,
        idx: pull.slot,
        cardKey: pull.key,
        rarity: pull.rarity,
        condition: pull.condition,
        serial: 1 + Math.floor(rng.next() * 400),
        valueCents: nexamonCopyValueCents(
          nexamonE4FromCents(NEXAMON_CARDS.find((c) => c.key === pull.key)!.startPriceCents),
          pull.condition,
          null,
        ),
      }));
    const packs = [pack(), pack()];
    // ADR-182: the second pack follows in the same session
    const packNo = now >= startedAt + LIVE_PACK_MS ? 2 : 1;
    const packStart = startedAt + (packNo - 1) * LIVE_PACK_MS;
    return {
      id: `live-friend-${window}`,
      friend,
      set,
      startedAt,
      endsAt: startedAt + LIVE_MS,
      packNo,
      packStart,
      cards: packs[packNo - 1]!,
    };
  }

  /** How many seats are taken at `now` (the creator plus made-up friends joining one by one). */
  const taken = (b: DemoBattle, now: number) =>
    Math.min(b.size, 1 + Math.max(0, Math.floor((now - b.createdAt) / JOIN_MS)));
  const fullAt = (b: DemoBattle) => b.createdAt + (b.size - 1) * JOIN_MS;
  const timeline = (b: DemoBattle) =>
    b.acceptedAt !== null ? multiBattleTimeline(b.acceptedAt, b.packs.length) : null;

  function refund(b: DemoBattle) {
    if (b.refunded) return;
    b.refunded = true;
    host.pay(-b.priceCents);
  }

  function settle(b: DemoBattle, now: number) {
    if (b.status === "pending" && now >= fullAt(b) && fullAt(b) < b.expiresAt) accept(b, fullAt(b));
    if (b.status === "pending" && now >= b.expiresAt) {
      b.status = "expired";
      refund(b);
    }
  }

  function accept(b: DemoBattle, at: number) {
    b.seed = Math.floor(host.random() * 2_147_483_647);
    const rolled = host.rollPacks(b.packs, b.size, (pulls) => {
      const d = decideMultiBattle(pulls, b.seed);
      b.tieBreak = d.tieBreak;
      return d.winner;
    });
    b.cards = rolled.pulls.map((seat) => seat.map(shown));
    b.winnerSeat = rolled.winner;
    b.status = "accepted";
    b.acceptedAt = at;
    if (rolled.winner === 0) {
      host.feed("nexamon_battle_won", {
        set: b.packs[0],
        other: b.joiners.map((j) => j.nickname).join(", "),
        total_cents: b.cards.flat().reduce((s, p) => s + p.valueCents, 0),
        cards: b.cards.flat().length,
        packs: b.packs.length,
        players: b.size,
      });
    }
  }

  function battleJson(b: DemoBattle, now: number): NexamonBattle {
    settle(b, now);
    const t = timeline(b);
    const known = t ? multiKnownCards(t.startsAt, now, b.packs.length) : 0;
    const decided = t !== null && now >= t.decideAt - cfg.battles.leadMs;
    const seatCount = b.status === "accepted" ? b.size : b.status === "pending" ? taken(b, now) : 1;
    const figures = [host.me(), ...b.joiners].slice(0, seatCount);
    const seats = figures.map((player, seat) => {
      const cards = (b.cards[seat] ?? []).filter((p) => p.idx <= known);
      return { seat, player, isMe: seat === 0, cards, cents: cards.reduce((s, p) => s + p.valueCents, 0) };
    });
    const status = b.status === "accepted" ? (t && now >= t.endsAt ? "done" : "running") : b.status;
    const winnerSeat = decided ? b.winnerSeat : null;
    return {
      id: b.id,
      set: b.packs[0]!,
      status,
      priceCents: b.priceCents,
      mode: b.mode,
      size: b.size,
      packs: b.packs.map((set) => ({ set, priceCents: cfg.sets[set].packPriceCents })),
      seats,
      mySeat: 0,
      winnerSeat,
      challenger: host.me(),
      opponent: figures[1] ?? null,
      me: "challenger",
      createdAt: iso(b.createdAt),
      expiresAt: iso(b.expiresAt),
      acceptedAt: b.acceptedAt !== null ? iso(b.acceptedAt) : null,
      startsAt: t ? iso(t.startsAt) : null,
      decideAt: t ? iso(t.decideAt) : null,
      endsAt: t ? iso(t.endsAt) : null,
      tearMs: cfg.battles.tearMs,
      slotMs: cfg.battles.slotMs,
      challengerCards: seats[0]?.cards ?? [],
      opponentCards: seats[1]?.cards ?? [],
      challengerCents: seats[0]?.cents ?? 0,
      opponentCents: seats[1]?.cents ?? 0,
      winner: winnerSeat === 0 ? "challenger" : winnerSeat === 1 ? "opponent" : null,
      tieBreak: decided ? b.tieBreak : null,
      coinSeed: decided ? b.seed : null,
      abortReason: b.abortReason,
      liveId: b.acceptedAt !== null ? `live-${b.id}` : null,
      viewers: b.acceptedAt !== null ? 2 : 0,
      reactions: reactions.filter((r) => r.liveId === `live-${b.id}`),
      serverTime: iso(now),
    };
  }

  const open = (now: number) =>
    battles.filter(
      (b) =>
        (b.status === "pending" && b.expiresAt > now) ||
        (b.status === "accepted" && b.acceptedAt !== null && timeline(b)!.endsAt > now),
    );

  /** ADR-192: the demo player's lobby; made-up friends (invited first) take the seats one by one. */
  function create(
    requestId: string,
    sets: NexamonSetKey[],
    size: number,
    invite: string[],
    mode: "duel" | "multi",
  ): NexamonBattle {
    requireUnlock();
    if (!requestId || !packBattleLineupOk(sets, size) || invite.length > size - 1)
      throw new GameError("invalid_argument");
    return host.idempotent(requestId, () => {
      const now = host.now();
      if (sets.some((set) => !(NEXAMON_SETS as readonly string[]).includes(set)))
        throw new GameError("nexamon_unknown");
      if (sets.some((set) => !nexamonSetReleased(set, now))) throw new GameError("nexamon_set_not_released");
      const friends = lobbyFriends();
      const invited = invite.map((nick) => {
        if (nick.toLowerCase() === host.me().nickname.toLowerCase()) throw new GameError("nexamon_battle_self");
        const f = friends.find((x) => x.nickname.toLowerCase() === nick.toLowerCase());
        if (!f) throw new GameError("nexamon_battle_not_here");
        return f;
      });
      battles.forEach((b) => settle(b, now));
      if (open(now).length > 0) throw new GameError("nexamon_battle_busy");
      if (lastChallengeAt + cfg.battles.cooldownSeconds * 1000 > now) throw new GameError("nexamon_battle_cooldown");
      if (battles.filter((b) => b.acceptedAt !== null && b.acceptedAt > now - 3_600_000).length >= cfg.battles.perHour)
        throw new GameError("nexamon_battle_limit");
      const price = packBattleCostCents(sets);
      if (host.cashCents() < price) throw new GameError("insufficient_funds");
      host.pay(price);
      lastChallengeAt = now;
      const rest = friends.filter((f) => !invited.includes(f));
      const joiners = [...invited, ...rest, ...DEMO_COLLECTORS.filter((c) => !friends.includes(c))]
        .slice(0, size - 1)
        .map((f) => ({ nickname: f.nickname, level: f.level, avatarKey: f.avatarKey, accessories: f.accessories }));
      const b: DemoBattle = {
        id: `battle-${nextId++}`,
        mode,
        packs: [...sets],
        size: Math.min(size, joiners.length + 1),
        joiners,
        status: "pending",
        priceCents: price,
        createdAt: now,
        expiresAt: now + (mode === "duel" ? cfg.battles.challengeSeconds : cfg.packBattle.lobbySeconds) * 1000,
        acceptedAt: null,
        cards: [],
        winnerSeat: null,
        tieBreak: null,
        seed: 0,
        abortReason: null,
        refunded: false,
      };
      battles.push(b);
      return battleJson(b, now);
    });
  }

  /** Made-up viewers react to the own pack now and then. */
  function ownReactions(live: OwnLive, now: number): NexamonLiveReaction[] {
    const emojis = cfg.live.reactions;
    const out: NexamonLiveReaction[] = [];
    for (let i = 1; i <= live.progress; i++) {
      const at = live.startedAt + i * 1500;
      if (at <= now && now - at < 12_000) out.push({ id: i, emoji: emojis[(i * 7) % emojis.length]!, at: iso(at) });
    }
    return out;
  }

  return {
    demoPackOpened(packId, set) {
      const now = host.now();
      const last = own.at(-1);
      // ADR-182: a pack within live.continueSeconds after the last session ended continues it
      if (last && now <= last.startedAt + OWN_LIVE_MS + cfg.live.continueSeconds * 1_000) {
        if (last.queue.length === 0 && (last.progress >= cfg.packSize || now >= last.startedAt + OWN_LIVE_MS))
          Object.assign(last, { packId, set, startedAt: now, progress: 0, packNo: last.packNo + 1 });
        else last.queue.push({ packId, set });
        return;
      }
      own.push({ id: `live-own-${nextId++}`, packId, set, startedAt: now, progress: 0, packNo: 1, queue: [] });
      if (own.length > 10) own.shift();
    },

    async nexamonLobby(allowWatch) {
      requireUnlock();
      const now = host.now();
      battles.forEach((b) => settle(b, now));
      const live = friendLive(now);
      const running = open(now);
      const sessions: NexamonLiveSession[] = [];
      if (live)
        sessions.push({
          id: live.id,
          kind: "pack",
          set: live.set,
          battleId: null,
          player: live.friend,
          opponent: null,
          players: null,
          isMe: false,
          startedAt: iso(live.startedAt),
          endsAt: iso(live.endsAt),
          viewers: 1 + (Math.floor(now / 7000) % 3),
        });
      for (const b of running.filter((x) => x.status === "accepted"))
        sessions.push({
          id: `live-${b.id}`,
          kind: "battle",
          set: b.packs[0]!,
          battleId: b.id,
          player: host.me(),
          opponent: b.joiners[0] ?? null,
          players: [host.me(), ...b.joiners],
          isMe: true,
          startedAt: iso(b.acceptedAt!),
          endsAt: iso(timeline(b)!.endsAt),
          viewers: 2,
        });
      for (const o of own.filter((x) => allowWatch && x.startedAt + OWN_LIVE_MS > now))
        sessions.push({
          id: o.id,
          kind: "pack",
          set: o.set,
          battleId: null,
          player: host.me(),
          opponent: null,
          players: null,
          isMe: true,
          startedAt: iso(o.startedAt),
          endsAt: iso(o.startedAt + OWN_LIVE_MS),
          viewers: 2,
        });
      return {
        players: lobbyFriends().map((f) => ({
          nickname: f.nickname,
          level: f.level,
          avatarKey: f.avatarKey,
          accessories: f.accessories,
          isFriend: true,
          opening: live?.friend.nickname === f.nickname,
          battling: running.some((b) => b.joiners.some((j) => j.nickname === f.nickname)),
        })),
        live: sessions,
        battles: running.map((b) => battleJson(b, now)),
        openBattles: [],
        limits: {
          perHour: cfg.battles.perHour,
          used: battles.filter((b) => b.acceptedAt !== null && b.acceptedAt > now - 3_600_000).length,
          cooldownUntil:
            lastChallengeAt + cfg.battles.cooldownSeconds * 1000 > now
              ? iso(lastChallengeAt + cfg.battles.cooldownSeconds * 1000)
              : null,
        },
        allowWatch,
        serverTime: iso(now),
      } satisfies NexamonLobby;
    },

    async challengeNexamonBattle(requestId, nickname, set) {
      if (!nickname) throw new GameError("invalid_argument");
      return create(requestId, [set], 2, [nickname], "duel");
    },

    async createNexamonPackBattle(requestId, sets, size, invite) {
      return create(requestId, sets, size, invite, "multi");
    },

    async joinNexamonPackBattle() {
      // the made-up friends never open lobbies of their own
      throw new GameError("nexamon_battle_unknown");
    },

    async respondNexamonBattle() {
      // the made-up friends never challenge the demo player
      throw new GameError("nexamon_battle_unknown");
    },

    async cancelNexamonBattle(requestId, battleId) {
      return host.idempotent(requestId, () => {
        const now = host.now();
        const b = battles.find((x) => x.id === battleId);
        if (!b) throw new GameError("nexamon_battle_unknown");
        settle(b, now);
        if (b.status !== "pending") throw new GameError("nexamon_battle_closed");
        b.status = "cancelled";
        refund(b);
        return battleJson(b, now);
      });
    },

    async nexamonBattle(battleId) {
      requireUnlock();
      const b = battles.find((x) => x.id === battleId);
      if (!b) throw new GameError("nexamon_battle_unknown");
      return battleJson(b, host.now());
    },

    async nexamonLive(liveId) {
      requireUnlock();
      const now = host.now();
      const live = friendLive(now);
      if (live && live.id === liveId) {
        const visible = Math.max(
          0,
          Math.min(cfg.packSize, Math.floor((now - live.packStart - LIVE_FIRST_MS) / cfg.live.fallbackSlotMs) + 1),
        );
        return {
          id: live.id,
          kind: "pack",
          set: live.set,
          battleId: null,
          player: live.friend,
          opponent: null,
          players: null,
          isMe: false,
          startedAt: iso(live.startedAt),
          endsAt: iso(live.endsAt),
          viewers: 2 + (Math.floor(now / 7000) % 3),
          packNo: live.packNo,
          progress: visible,
          cards: live.cards.slice(0, visible),
          done: false,
          reactions: reactions.filter((r) => r.liveId === liveId),
          serverTime: iso(now),
        } satisfies NexamonLiveView;
      }
      const mine = own.find((o) => o.id === liveId);
      if (!mine) throw new GameError("nexamon_live_unknown");
      return {
        id: mine.id,
        kind: "pack",
        set: mine.set,
        battleId: null,
        player: host.me(),
        opponent: null,
        players: null,
        isMe: true,
        startedAt: iso(mine.startedAt),
        endsAt: iso(mine.startedAt + OWN_LIVE_MS),
        viewers: 2,
        packNo: mine.packNo,
        progress: mine.progress,
        cards: [],
        done: mine.startedAt + OWN_LIVE_MS <= now,
        reactions: ownReactions(mine, now),
        serverTime: iso(now),
      };
    },

    async reportNexamonLive(packId, revealed) {
      let live = own.find((o) => o.packId === packId);
      // ADR-182: the opener moved on to a waiting pack of the session: it is shown now
      const waiting = own.find((o) => o.queue.some((q) => q.packId === packId));
      if (!live && waiting) {
        const at = waiting.queue.findIndex((q) => q.packId === packId);
        const next = waiting.queue[at]!;
        Object.assign(waiting, {
          packId,
          set: next.set,
          startedAt: host.now(),
          progress: 0,
          packNo: waiting.packNo + at + 1,
          queue: waiting.queue.slice(at + 1),
        });
        live = waiting;
      }
      if (!live) return { liveId: null, viewers: 0, reactions: [] };
      live.progress = Math.max(live.progress, Math.min(cfg.packSize, revealed));
      return { liveId: live.id, viewers: 2, reactions: ownReactions(live, host.now()) };
    },

    async reactNexamonLive(requestId, liveId, emoji) {
      requireUnlock();
      if (!(cfg.live.reactions as readonly string[]).includes(emoji)) throw new GameError("invalid_argument");
      return host.idempotent(requestId, () => {
        const now = host.now();
        reactions.push({ id: nextId++, emoji, at: iso(now), liveId });
        while (reactions.length > 60) reactions.shift();
        return reactions
          .filter((r) => r.liveId === liveId && now - Date.parse(r.at) < 12_000)
          .map(({ id, emoji: e, at }) => ({ id, emoji: e, at }));
      });
    },
  };
}
