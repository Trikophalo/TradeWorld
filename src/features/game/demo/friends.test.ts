import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { GameError } from "../types";
import { DEMO_FRIEND, createFriendEngine, type DemoFriendCode } from "./friends";

function setup() {
  const state = { cash: 100_000, code: null as DemoFriendCode | null };
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
    now: () => new Date("2026-11-13T10:00:00Z"),
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
