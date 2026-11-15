import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { GameError } from "../types";
import { DEMO_FRIEND, createFriendEngine, demoFriendCard, type DemoFriend, type DemoFriendCode } from "./friends";

const ANNA: DemoFriend = {
  nickname: "Anna",
  tag: "A1B2",
  level: 7,
  avatarKey: "seller",
  accessories: ["cowboy_hat"],
  online: false,
  since: "2026-11-01T10:00:00Z",
};
const BEN: DemoFriend = { ...ANNA, nickname: "Ben", tag: "B3C4", online: true, accessories: [] };

function setup() {
  const state = {
    cash: 100_000,
    code: null as DemoFriendCode | null,
    now: Date.parse("2026-11-13T10:00:00Z"),
    pokes: [] as { nickname: string; at: number }[],
  };
  const requests = new Map<string, unknown>();
  const engine = createFriendEngine({
    nickname: () => "Mira",
    tag: () => "K7Q2",
    level: () => 3,
    avatarKey: () => "avatar_1",
    idempotent: <T>(id: string, run: () => T): T => {
      if (requests.has(id)) return requests.get(id) as T;
      const result = run();
      requests.set(id, result);
      return result;
    },
    friendCode: () => state.code,
    setFriendCode: (value) => {
      state.code = value;
    },
    addCash: (cents) => {
      state.cash += cents;
    },
    now: () => new Date(state.now),
    friendList: () => [ANNA, BEN],
    pokes: () => state.pokes,
    setPokes: (value) => {
      state.pokes = value;
    },
  });
  return { state, engine };
}

const key = (run: Promise<unknown>) =>
  run.then(
    () => "ok",
    (error: unknown) => (error instanceof GameError ? error.key : "other"),
  );

describe("friend code in the demo (ADR-111)", () => {
  const bonus = BALANCE.social.friendCode.bonusCents;

  it("shows the own code and nothing redeemed", async () => {
    const { engine } = setup();
    expect(await engine.friendCode()).toEqual({
      code: "NEXA-K7Q2",
      bonusCents: bonus,
      redeemed: false,
      redeemedFrom: null,
      redeemedAt: null,
      invited: 0,
    });
  });

  it("pays the bonus once for the demo friend's code; the same request replays", async () => {
    const { engine, state } = setup();
    const first = await engine.redeemFriendCode("r1", ` nexa ${DEMO_FRIEND.tag.toLowerCase()} `);
    expect(first.paidCents).toBe(bonus);
    expect(first.redeemed).toBe(true);
    expect(first.redeemedFrom).toEqual(DEMO_FRIEND);
    expect(state.cash).toBe(100_000 + bonus);
    expect(await engine.redeemFriendCode("r1", "whatever")).toEqual(first);
    expect(state.cash).toBe(100_000 + bonus);
    expect(await key(engine.redeemFriendCode("r2", `NEXA-${DEMO_FRIEND.tag}`))).toBe("friend_code_used");
    expect(state.cash).toBe(100_000 + bonus);
    expect((await engine.friendCode()).redeemed).toBe(true);
  });

  it("rejects the own code, unknown codes and nonsense", async () => {
    const { engine, state } = setup();
    expect(await key(engine.redeemFriendCode("a", "NEXA-K7Q2"))).toBe("friend_code_self");
    expect(await key(engine.redeemFriendCode("b", "NEXA-ABCD"))).toBe("friend_code_unknown");
    expect(await key(engine.redeemFriendCode("c", "hallo"))).toBe("friend_code_unknown");
    expect(state.cash).toBe(100_000);
  });
});

describe("made-up friends and poking in the demo (ADR-154)", () => {
  it("lists the friends online first with portrait and accessories; each has a card", async () => {
    const { engine } = setup();
    const list = await engine.friends();
    expect(list.friends.map((f) => f.nickname)).toEqual(["Ben", "Anna"]);
    expect(list.friends[1]).toMatchObject({ avatarKey: "seller", accessories: ["cowboy_hat"], online: false });
    expect(demoFriendCard(ANNA)).toMatchObject({ nickname: "Anna", accessories: ["cowboy_hat"], level: 7 });
  });

  it("pokes a friend once per pause, only friends, at most dailyCap a day", async () => {
    const { engine, state } = setup();
    const { cooldownMinutes, dailyCap } = BALANCE.social.poke;
    const first = await engine.pokeFriend("p1", "anna");
    expect(first).toMatchObject({ nickname: "Anna", leftToday: dailyCap - 1 });
    expect(await engine.pokeFriend("p1", "anna")).toEqual(first);
    expect(await key(engine.pokeFriend("p2", "Anna"))).toBe("poke_too_soon");
    expect(await key(engine.pokeFriend("p3", "Carla"))).toBe("not_friends");
    expect(await key(engine.pokeFriend("p4", "Mira"))).toBe("invalid_argument");
    expect(await key(engine.pokeFriend("p5", "Ben"))).toBe("ok");
    state.now += cooldownMinutes * 60_000 + 1;
    expect(await key(engine.pokeFriend("p6", "Anna"))).toBe("ok");
    state.pokes = Array.from({ length: dailyCap }, (_, i) => ({ nickname: "Ben", at: state.now - 3_600_000 - i }));
    expect(await key(engine.pokeFriend("p7", "Anna"))).toBe("poke_daily_limit");
  });
});
