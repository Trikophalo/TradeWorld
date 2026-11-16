import { BALANCE } from "@/config/balance";
import { NEXAMON_CARDS, NEXAMON_SETS, type NexamonSetKey } from "@/config/nexamon";
import { nexamonOpenPack, nexamonCopyValueCents, nexamonE4FromCents } from "@/lib/sim/nexamon";
import { battleKnownSlots, battleTimeline, decideBattle } from "@/lib/sim/nexamon-battle";
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
const LIVE_MS = 26_000;
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
  rollPacks(
    set: NexamonSetKey,
    iWin: (mine: NexamonPull[], theirs: NexamonPull[]) => boolean,
  ): { mine: NexamonPull[]; theirs: NexamonPull[]; won: boolean };
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

interface DemoBattle {
  id: string;
  set: NexamonSetKey;
  opponent: NexamonFigure;
  status: "pending" | "declined" | "expired" | "cancelled" | "aborted" | "accepted";
  priceCents: number;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  mine: NexamonShownPull[];
  theirs: NexamonShownPull[];
  won: boolean | null;
  tieBreak: "value" | "rarest" | "coin" | null;
  seed: number;
  abortReason: string | null;
}

interface OwnLive {
  id: string;
  packId: string;
  set: NexamonSetKey;
  startedAt: number;
  progress: number;
}

const iso = (ms: number) => new Date(ms).toISOString();
const shown = (p: NexamonPull): NexamonShownPull => ({
  slot: p.slot,
  cardKey: p.cardKey,
  rarity: p.rarity,
  condition: p.condition,
  serial: p.serial,
  valueCents: p.valueCents,
});

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
    const cards = nexamonOpenPack(
      NEXAMON_CARDS.filter((c) => c.set === set),
      rng.next,
    ).map((pull): NexamonShownPull => ({
      slot: pull.slot,
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
    return { id: `live-friend-${window}`, friend, set, startedAt, endsAt: startedAt + LIVE_MS, cards };
  }

  function settle(b: DemoBattle, now: number) {
    if (b.status === "pending" && now >= b.createdAt + ACCEPT_MS && now < b.expiresAt)
      accept(b, b.createdAt + ACCEPT_MS);
    if (b.status === "pending" && now >= b.expiresAt) b.status = "expired";
  }

  function accept(b: DemoBattle, at: number) {
    if (host.cashCents() < b.priceCents) {
      b.status = "aborted";
      b.abortReason = "challenger_funds";
      host.notify(
        "nexamon_battle",
        "Pack Battle abgebrochen",
        "Für das Pack Battle hat dein Geld nicht mehr gereicht.",
        "/nexamon",
      );
      return;
    }
    host.pay(b.priceCents);
    b.seed = Math.floor(host.random() * 2_147_483_647);
    const rolled = host.rollPacks(b.set, (mine, theirs) => {
      const d = decideBattle(mine, theirs, b.seed);
      b.tieBreak = d.tieBreak;
      return d.winner === "challenger";
    });
    b.mine = rolled.mine.map(shown);
    b.theirs = rolled.theirs.map(shown);
    b.won = rolled.won;
    b.status = "accepted";
    b.acceptedAt = at;
    if (rolled.won) {
      host.feed("nexamon_battle_won", {
        set: b.set,
        other: b.opponent.nickname,
        total_cents: [...b.mine, ...b.theirs].reduce((s, p) => s + p.valueCents, 0),
        cards: 10,
      });
    }
  }

  function battleJson(b: DemoBattle, now: number): NexamonBattle {
    settle(b, now);
    const t = b.acceptedAt !== null ? battleTimeline(b.acceptedAt) : null;
    const known = t ? battleKnownSlots(t.startsAt, now) : 0;
    const decided = t !== null && now >= t.decideAt - cfg.battles.leadMs;
    const mine = b.mine.filter((p) => p.slot <= known);
    const theirs = b.theirs.filter((p) => p.slot <= known);
    const status = b.status === "accepted" ? (t && now >= t.endsAt ? "done" : "running") : b.status;
    return {
      id: b.id,
      set: b.set,
      status,
      priceCents: b.priceCents,
      challenger: host.me(),
      opponent: b.opponent,
      me: "challenger",
      createdAt: iso(b.createdAt),
      expiresAt: iso(b.expiresAt),
      acceptedAt: b.acceptedAt !== null ? iso(b.acceptedAt) : null,
      startsAt: t ? iso(t.startsAt) : null,
      decideAt: t ? iso(t.decideAt) : null,
      endsAt: t ? iso(t.endsAt) : null,
      tearMs: cfg.battles.tearMs,
      slotMs: cfg.battles.slotMs,
      challengerCards: mine,
      opponentCards: theirs,
      challengerCents: mine.reduce((s, p) => s + p.valueCents, 0),
      opponentCents: theirs.reduce((s, p) => s + p.valueCents, 0),
      winner: decided ? (b.won ? "challenger" : "opponent") : null,
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
        (b.status === "accepted" && b.acceptedAt !== null && battleTimeline(b.acceptedAt).endsAt > now),
    );

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
      own.push({ id: `live-own-${nextId++}`, packId, set, startedAt: host.now(), progress: 0 });
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
          isMe: false,
          startedAt: iso(live.startedAt),
          endsAt: iso(live.endsAt),
          viewers: 1 + (Math.floor(now / 7000) % 3),
        });
      for (const b of running.filter((x) => x.status === "accepted"))
        sessions.push({
          id: `live-${b.id}`,
          kind: "battle",
          set: b.set,
          battleId: b.id,
          player: host.me(),
          opponent: b.opponent,
          isMe: true,
          startedAt: iso(b.acceptedAt!),
          endsAt: iso(battleTimeline(b.acceptedAt!).endsAt),
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
          battling: running.some((b) => b.opponent.nickname === f.nickname),
        })),
        live: sessions,
        battles: running.map((b) => battleJson(b, now)),
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
      requireUnlock();
      if (!requestId || !nickname) throw new GameError("invalid_argument");
      return host.idempotent(requestId, () => {
        const now = host.now();
        if (!(NEXAMON_SETS as readonly string[]).includes(set)) throw new GameError("nexamon_unknown");
        if (nickname.toLowerCase() === host.me().nickname.toLowerCase()) throw new GameError("nexamon_battle_self");
        const friend = lobbyFriends().find((f) => f.nickname.toLowerCase() === nickname.toLowerCase());
        if (!friend) throw new GameError("nexamon_battle_not_here");
        battles.forEach((b) => settle(b, now));
        if (open(now).length > 0) throw new GameError("nexamon_battle_busy");
        if (lastChallengeAt + cfg.battles.cooldownSeconds * 1000 > now) throw new GameError("nexamon_battle_cooldown");
        if (
          battles.filter((b) => b.acceptedAt !== null && b.acceptedAt > now - 3_600_000).length >= cfg.battles.perHour
        )
          throw new GameError("nexamon_battle_limit");
        const price = cfg.sets[set].packPriceCents;
        if (host.cashCents() < price) throw new GameError("insufficient_funds");
        lastChallengeAt = now;
        const b: DemoBattle = {
          id: `battle-${nextId++}`,
          set,
          opponent: {
            nickname: friend.nickname,
            level: friend.level,
            avatarKey: friend.avatarKey,
            accessories: friend.accessories,
          },
          status: "pending",
          priceCents: price,
          createdAt: now,
          expiresAt: now + cfg.battles.challengeSeconds * 1000,
          acceptedAt: null,
          mine: [],
          theirs: [],
          won: null,
          tieBreak: null,
          seed: 0,
          abortReason: null,
        };
        battles.push(b);
        return battleJson(b, now);
      });
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
          Math.min(cfg.packSize, Math.floor((now - live.startedAt - LIVE_FIRST_MS) / cfg.live.fallbackSlotMs) + 1),
        );
        return {
          id: live.id,
          kind: "pack",
          set: live.set,
          battleId: null,
          player: live.friend,
          opponent: null,
          isMe: false,
          startedAt: iso(live.startedAt),
          endsAt: iso(live.endsAt),
          viewers: 2 + (Math.floor(now / 7000) % 3),
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
        isMe: true,
        startedAt: iso(mine.startedAt),
        endsAt: iso(mine.startedAt + OWN_LIVE_MS),
        viewers: 2,
        progress: mine.progress,
        cards: [],
        done: mine.startedAt + OWN_LIVE_MS <= now,
        reactions: ownReactions(mine, now),
        serverTime: iso(now),
      };
    },

    async reportNexamonLive(packId, revealed) {
      const live = own.find((o) => o.packId === packId);
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
