import { BALANCE } from "@/config/balance";
import { GameError, type GameEngine, type Protest, type ProtestKind, type Protests } from "../types";

/*
 * Protest campaigns in the offline demo (ADR-133): the demo player alone plus AI supporters, same rules as the
 * server. AI supporters join by elapsed minutes when the list is read; there are no other players, so in the demo a
 * campaign usually stalls before its goal, just like a live one without enough players.
 */
export interface DemoProtest extends Omit<Protest, "createdAt" | "endsAt" | "resolvedAt" | "players" | "joined"> {
  createdAt: number;
  endsAt: number;
  resolvedAt: number | null;
  lastGrowth: number;
}

export interface ProtestsHost {
  companies(): { id: string; name: string; ticker: string }[];
  nickname(): string;
  level(): number;
  cashCents(): number;
  pay(cents: number): void;
  shock(ticker: string, moveBps: number): void;
  protests(): DemoProtest[];
  setProtests(p: DemoProtest[]): void;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
  random(): number;
}

const cfg = BALANCE.protests;

export function createProtestsEngine(
  host: ProtestsHost,
): Pick<GameEngine, "protests" | "startProtest" | "joinProtest"> {
  function tick() {
    const now = host.now();
    const list = host.protests().map((p) => ({ ...p }));
    for (const p of list) {
      if (p.status !== "open") continue;
      if (p.endsAt <= now) {
        p.status = "expired";
        p.resolvedAt = now;
        continue;
      }
      // one roll per elapsed minute since the last growth
      const minutes = Math.min(120, Math.floor((now - p.lastGrowth) / 60_000));
      for (let i = 0; i < minutes && p.aiSupporters < cfg.aiMax; i++) {
        if (host.random() * 10_000 < cfg.aiJoinChanceBps)
          p.aiSupporters = Math.min(cfg.aiMax, p.aiSupporters + 1 + Math.floor(host.random() * cfg.aiPerMinuteMax));
      }
      if (minutes > 0) p.lastGrowth = now;
      check(p, now);
    }
    host.setProtests(list.slice(-20));
    return list;
  }

  function check(p: DemoProtest, now: number) {
    if (p.status !== "open" || 1 + p.aiSupporters < p.goal) return;
    const chance = Math.min(cfg.effectChanceMaxBps, cfg.effectChanceBaseBps + cfg.effectChancePerPlayerBps);
    if (host.random() * 10_000 < chance) {
      const bps = cfg.priceHitMinBps + Math.floor(host.random() * (cfg.priceHitMaxBps - cfg.priceHitMinBps + 1));
      if (p.ticker) host.shock(p.ticker, -bps);
      p.status = "hit";
      p.effectBps = bps;
    } else p.status = "fizzled";
    p.resolvedAt = now;
  }

  const state = (list: DemoProtest[]): Protests => ({
    startCostCents: cfg.startCostCents,
    minLevel: cfg.minLevel,
    protests: [...list]
      .sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || b.createdAt - a.createdAt)
      .map((p) => ({
        ...p,
        players: 1,
        joined: true,
        createdAt: new Date(p.createdAt).toISOString(),
        endsAt: new Date(p.endsAt).toISOString(),
        resolvedAt: p.resolvedAt === null ? null : new Date(p.resolvedAt).toISOString(),
      })),
  });

  return {
    async protests() {
      return state(tick());
    },
    startProtest: (requestId, companyId, kind: ProtestKind) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          if (host.level() < cfg.minLevel) throw new GameError("locked");
          if (!(cfg.kinds as readonly string[]).includes(kind)) throw new GameError("invalid_argument");
          const list = tick();
          const target = host.companies().find((c) => c.id === companyId);
          if (!target) throw new GameError("company_not_found");
          const now = host.now();
          if (
            list.some((p) => p.companyId === companyId && p.status === "open") ||
            list.some((p) => p.createdAt > now - cfg.starterCooldownHours * 3_600_000)
          )
            throw new GameError("protest_busy");
          if (host.cashCents() < cfg.startCostCents) throw new GameError("insufficient_funds");
          host.pay(cfg.startCostCents);
          const next: DemoProtest = {
            id: (list.at(-1)?.id ?? 0) + 1,
            kind,
            companyId,
            company: target.name,
            ticker: target.ticker,
            status: "open",
            goal: cfg.goal,
            aiSupporters: 0,
            startedBy: host.nickname(),
            mine: true,
            againstMe: false,
            effectBps: null,
            createdAt: now,
            endsAt: now + cfg.durationHours * 3_600_000,
            resolvedAt: null,
            lastGrowth: now,
          };
          host.setProtests([...list, next]);
          return state([...list, next]);
        }),
      ),
    joinProtest: () => Promise.reject(new GameError("protest_joined")),
  };
}
