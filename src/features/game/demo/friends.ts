import { BALANCE } from "@/config/balance";
import { SKILL_BRANCHES } from "@/config/skills";
import { friendCodeOf, nameKey, parseFriendCode, parseTag } from "@/lib/player-tag";
import { GameError, type FriendCode, type Friends, type GameEngine, type PlayerCard } from "../types";

/*
 * Friends and player search in the offline demo (ADR-084, ADR-085). The demo has no other players: the list is
 * empty unless the saved demo state brings made-up friends (ADR-155), the search finds only oneself, and every
 * request explains why it cannot work here. The friend code
 * (ADR-111) can be tried with the code of one made-up friend.
 */
export const DEMO_FRIEND = { nickname: "Finn", tag: "F7NN" } as const;

/**
 * A made-up friend of the demo (ADR-155): the demo starts without friends; a test or a saved demo state can bring
 * some, so the friends plaza and poking can be tried offline.
 */
export interface DemoFriend {
  nickname: string;
  tag: string;
  level: number;
  avatarKey: string;
  accessories: string[];
  online: boolean;
  since: string;
}

export interface DemoFriendCode {
  from: { nickname: string; tag: string };
  at: string;
}

export interface FriendHost {
  nickname(): string;
  tag(): string;
  level(): number;
  avatarKey(): string;
  idempotent<T>(requestId: string, run: () => T): T;
  friendCode(): DemoFriendCode | null;
  setFriendCode(value: DemoFriendCode): void;
  addCash(cents: number): void;
  now(): Date;
  /** Made-up friends (ADR-155). */
  friendList(): DemoFriend[];
  /** When the demo player last poked whom (ms), for the pause and the daily cap. */
  pokes(): { nickname: string; at: number }[];
  setPokes(value: { nickname: string; at: number }[]): void;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The business card of a made-up friend (ADR-155), so the plaza can open a profile. */
export function demoFriendCard(friend: DemoFriend): PlayerCard {
  return {
    nickname: friend.nickname,
    cloneJob: null,
    tag: friend.tag,
    trophies: { gold: 0, silver: 0, bronze: 0 },
    avatarKey: friend.avatarKey,
    level: friend.level,
    rank: null,
    netWorthCents: BALANCE.economy.startingCapitalCents * friend.level,
    streakDays: friend.level,
    skillsLearned: 0,
    branchScores: Object.fromEntries(SKILL_BRANCHES.map((b) => [b, 0])) as PlayerCard["branchScores"],
    topSkills: [],
    job: null,
    company: null,
    memberSince: friend.since,
    trust: null,
    accessories: friend.accessories,
  };
}

export function createFriendEngine(
  host: FriendHost,
): Pick<
  GameEngine,
  | "friends"
  | "sendFriendRequest"
  | "respondFriendRequest"
  | "removeFriend"
  | "searchPlayers"
  | "friendCode"
  | "redeemFriendCode"
  | "pokeFriend"
> {
  const find = (nickname: string) =>
    host.friendList().find((f) => f.nickname.toLowerCase() === nickname.trim().toLowerCase());
  const codeState = (): FriendCode => {
    const used = host.friendCode();
    return {
      code: friendCodeOf(host.tag()),
      bonusCents: BALANCE.social.friendCode.bonusCents,
      redeemed: used !== null,
      redeemedFrom: used?.from ?? null,
      redeemedAt: used?.at ?? null,
      invited: 0,
    };
  };
  const isMe = (input: string) =>
    input.trim().toLowerCase() === host.nickname().toLowerCase() || parseTag(input) === host.tag();
  return {
    async friends() {
      const friends = [...host.friendList()]
        .sort((a, b) => Number(b.online) - Number(a.online) || a.nickname.localeCompare(b.nickname, "de"))
        .map((f) => ({
          nickname: f.nickname,
          tag: f.tag,
          level: f.level,
          at: f.since,
          online: f.online,
          avatarKey: f.avatarKey,
          accessories: f.accessories,
        }));
      return { friends, incoming: [], outgoing: [] } satisfies Friends;
    },
    pokeFriend: (requestId, nickname) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          if (isMe(nickname)) throw new GameError("invalid_argument");
          const friend = find(nickname);
          if (!friend) throw new GameError("not_friends");
          const now = host.now().getTime();
          const { cooldownMinutes, dailyCap } = BALANCE.social.poke;
          const recent = host.pokes().filter((x) => x.at > now - DAY);
          const last = recent.filter((x) => x.nickname === friend.nickname).reduce((m, x) => Math.max(m, x.at), 0);
          if (last > now - cooldownMinutes * MINUTE) throw new GameError("poke_too_soon");
          if (recent.length >= dailyCap) throw new GameError("poke_daily_limit");
          host.setPokes([...recent, { nickname: friend.nickname, at: now }]);
          return {
            nickname: friend.nickname,
            pokedAt: new Date(now).toISOString(),
            nextAt: new Date(now + cooldownMinutes * MINUTE).toISOString(),
            leftToday: dailyCap - recent.length - 1,
          };
        }),
      ),
    async friendCode() {
      return codeState();
    },
    redeemFriendCode: (requestId, code) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          const tag = parseFriendCode(code);
          if (!tag) throw new GameError("friend_code_unknown");
          if (host.friendCode()) throw new GameError("friend_code_used");
          if (tag === host.tag()) throw new GameError("friend_code_self");
          if (tag !== DEMO_FRIEND.tag) throw new GameError("friend_code_unknown");
          const paidCents = BALANCE.social.friendCode.bonusCents;
          host.setFriendCode({ from: { ...DEMO_FRIEND }, at: host.now().toISOString() });
          host.addCash(paidCents);
          return { ...codeState(), paidCents };
        }),
      ),
    sendFriendRequest: (requestId, nickname) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          if (isMe(nickname)) throw new GameError("invalid_argument");
          throw new GameError("player_not_found");
        }),
      ),
    respondFriendRequest: () => Promise.reject(new GameError("invalid_argument")),
    removeFriend: () => Promise.reject(new GameError("invalid_argument")),
    async searchPlayers(query) {
      const q = query.trim();
      if (q.length < 2) return [];
      const byTag = parseTag(q) === host.tag();
      const byName =
        nameKey(host.nickname()).includes(nameKey(q)) || host.nickname().toLowerCase().includes(q.toLowerCase());
      return byTag || byName
        ? [{ nickname: host.nickname(), tag: host.tag(), level: host.level(), avatarKey: host.avatarKey() }]
        : [];
    },
  };
}
