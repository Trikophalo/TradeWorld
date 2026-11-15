import { describe, expect, it } from "vitest";
import { BATTLE_RULES } from "@/config/battles";
import { createBattleEngine, type BattleHost } from "./battles";

/** A demo host with a hand-driven clock. */
function host(overrides: Partial<BattleHost> = {}) {
  let now = 1_000_000;
  const log = { xp: 0, cash: 0, accessories: [] as string[], bumps: [] as string[], wins: 0 };
  const requests = new Map<string, unknown>();
  let seed = 1;
  const h: BattleHost = {
    me: () => ({ nickname: "Ich", avatarKey: "rookie", accessories: [] }),
    level: () => 5,
    addXp: (base) => (log.xp += base * 2),
    addCash: (cents) => {
      log.cash += cents;
    },
    ownedAccessories: () => log.accessories,
    giveAccessory: (key) => log.accessories.push(key),
    freeArtwork: () => null,
    giveArtwork: () => false,
    stockQuote: () => ({ ticker: "NXA", name: "Nexa AG", priceE4: 1_234_500 }),
    bump: (metric) => log.bumps.push(metric),
    prizeWinsToday: () => log.wins,
    countPrizeWin: () => {
      log.wins++;
    },
    feed: () => {},
    idempotent: (id, run) => {
      if (!requests.has(id)) requests.set(id, run());
      return requests.get(id) as never;
    },
    now: () => now,
    random: () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    },
    ...overrides,
  };
  return { h, log, advance: (ms: number) => (now += ms), time: () => now };
}

describe("demo battles (ADR-160)", () => {
  it("made-up opponents join after the player, the countdown starts at 3, the game starts", async () => {
    const { h, advance } = host();
    const engine = createBattleEngine(h);
    engine.forceKind("pump");
    expect((await engine.battle()).battle?.status).toBe("open");
    const joined = await engine.joinBattle("r1");
    expect(joined.battle?.joined).toBe(true);
    expect(await engine.joinBattle("r1")).toBe(joined);
    advance(4_000);
    const lobby = (await engine.battle()).battle!;
    expect(lobby.players.length).toBeGreaterThanOrEqual(BATTLE_RULES.lobby.minPlayers);
    expect(lobby.countdownEndsAt).not.toBeNull();
    advance(BATTLE_RULES.demo.countdownSeconds * 1000 + 100);
    const running = (await engine.battle()).battle!;
    expect(running.status).toBe("running");
    expect(running.kind).toBe("pump");
    expect(running.players.every((p) => p.slot !== null)).toBe(true);
  });

  it("an action game runs on the player's inputs and the bots; the winner gets the prize", async () => {
    const { h, log, advance, time } = host();
    const engine = createBattleEngine(h);
    engine.forceKind("pump");
    await engine.joinBattle("r1");
    advance(4_000);
    await engine.battle();
    advance(BATTLE_RULES.demo.countdownSeconds * 1000 + 100);
    const b = (await engine.battle()).battle!;
    const start = Date.parse(b.startedAt!);
    let sent = 0;
    let status = "running";
    while (status === "running" && time() < start + 40_000) {
      advance(250);
      const tick = Math.floor((time() - start) / 50);
      const data = tick > sent ? "1".repeat(tick - sent) : "";
      const r = await engine.syncBattle(b.id, sent, data, 0, null);
      sent = Math.max(sent, tick);
      status = r.status;
    }
    expect(status).toBe("finished");
    const done = (await engine.battle()).recent!;
    expect(done.result?.ranking.length).toBe(b.players.length);
    expect(log.bumps).toContain("battle_joins");
    if (done.players.find((p) => p.me)?.rank === 1)
      expect(log.xp + log.cash + log.accessories.length).toBeGreaterThan(0);
  });

  it("only the right round is open in a quiz", async () => {
    const { h, advance } = host();
    const engine = createBattleEngine(h);
    engine.forceKind("quiz");
    await engine.joinBattle("r1");
    advance(4_000);
    await engine.battle();
    advance(BATTLE_RULES.demo.countdownSeconds * 1000 + 100);
    const b = (await engine.battle()).battle!;
    advance(BATTLE_RULES.lobby.introMs + 500);
    await expect(engine.answerBattle("a1", b.id, 1, 0, null)).rejects.toMatchObject({ key: "battle_round_closed" });
    const after = await engine.answerBattle("a2", b.id, 0, 2, null);
    expect(after.battle?.rounds?.list[0]?.mine.choice).toBe(2);
    expect(after.battle?.rounds?.list[0]?.correct).toBeNull();
  });
});
