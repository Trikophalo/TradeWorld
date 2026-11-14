import { BALANCE } from "@/config/balance";
import { GameError, type CompanyMoves, type GameEngine } from "../types";

/*
 * Business moves in the offline demo (ADR-127): same numbers as the server, without team skills. The result comes
 * when the moves are asked for after the move's end.
 */
export interface DemoMoveRun {
  id: number;
  key: string;
  startedAt: number;
  endsAt: number;
  costCents: number;
  chanceBps: number;
  status: "running" | "success" | "failure";
  payoutCents: number;
  gain: number;
  resolvedAt: number | null;
}

export interface CompanyMovesHost {
  company(): { tier: string; productKey?: string; cashCents: number; awareness: number; quality: number } | null;
  addCompanyCash(cents: number): void;
  improve(kind: "awareness" | "quality", by: number): void;
  runs(): DemoMoveRun[];
  setRuns(runs: DemoMoveRun[]): void;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
  random(): number;
}

const cfg = BALANCE.companyMoves;
type TierKey = keyof typeof cfg.costCentsByTier;
const tierOf = (tier: string): TierKey => (tier in cfg.costCentsByTier ? (tier as TierKey) : "ag");

export function createCompanyMovesEngine(
  host: CompanyMovesHost,
): Pick<GameEngine, "companyMoves" | "startCompanyMove"> {
  const resolve = () => {
    const now = host.now();
    const runs = host.runs().map((r) => ({ ...r }));
    for (const r of runs) {
      if (r.status !== "running" || r.endsAt > now) continue;
      const move = cfg.moves.find((m) => m.key === r.key);
      const risk = cfg.risk[move?.risk ?? "normal"];
      const ok = host.random() * 10_000 < r.chanceBps;
      r.status = ok ? "success" : "failure";
      r.resolvedAt = r.endsAt;
      if (ok && move?.kind !== "cash" && move) {
        r.gain = risk.gain;
        host.improve(move.kind, risk.gain);
      } else {
        r.payoutCents = Math.round((r.costCents * (ok ? risk.payoutBps : risk.refundBps)) / 10_000);
        host.addCompanyCash(r.payoutCents);
      }
    }
    host.setRuns(runs.slice(-40));
  };

  const state = (): CompanyMoves => {
    const c = host.company();
    if (!c) throw new GameError("company_not_found");
    const tier = tierOf(c.tier);
    const base = cfg.costCentsByTier[tier];
    const now = host.now();
    const runs = host.runs();
    const product = c.productKey ?? null;
    return {
      slots: cfg.slotsByTier[tier],
      used: runs.filter((r) => r.status === "running").length,
      cashCents: c.cashCents,
      tier,
      product,
      moves: cfg.moves
        .filter((m) => m.product === "*" || m.product === product)
        .map((m) => {
          const risk = cfg.risk[m.risk];
          const cost = Math.round(base * m.costFactor);
          const rest = m.minutes * (1 + cfg.cooldownFactor) * 60_000;
          const last = runs.filter((r) => r.key === m.key).at(-1);
          const availableAt =
            last && last.startedAt + rest > now ? new Date(last.startedAt + rest).toISOString() : null;
          return {
            key: m.key,
            kind: m.kind,
            risk: m.risk,
            branch: m.branch,
            minutes: m.minutes,
            costCents: cost,
            chanceBps: risk.chanceBps,
            skillBonusBps: 0,
            payoutCents: m.kind === "cash" ? Math.round((cost * risk.payoutBps) / 10_000) : 0,
            refundCents: Math.round((cost * risk.refundBps) / 10_000),
            gain: m.kind === "cash" ? 0 : risk.gain,
            availableAt,
          };
        }),
      running: runs
        .filter((r) => r.status === "running")
        .map((r) => ({
          id: r.id,
          key: r.key,
          startedAt: new Date(r.startedAt).toISOString(),
          endsAt: new Date(r.endsAt).toISOString(),
          costCents: r.costCents,
          chanceBps: r.chanceBps,
        })),
      history: runs
        .filter((r) => r.status !== "running")
        .slice(-cfg.historyLimit)
        .reverse()
        .map((r) => ({
          id: r.id,
          key: r.key,
          status: r.status as "success" | "failure",
          costCents: r.costCents,
          payoutCents: r.payoutCents,
          gain: r.gain,
          resolvedAt: new Date(r.resolvedAt ?? r.endsAt).toISOString(),
        })),
    };
  };

  return {
    async companyMoves() {
      resolve();
      return state();
    },
    startCompanyMove: (requestId, key) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          resolve();
          const s = state();
          const move = s.moves.find((m) => m.key === key);
          if (!move) throw new GameError("move_unknown");
          if (s.used >= s.slots) throw new GameError("move_busy");
          if (move.availableAt) throw new GameError("move_resting");
          if (s.cashCents < move.costCents) throw new GameError("insufficient_funds");
          host.addCompanyCash(-move.costCents);
          const now = host.now();
          const runs = host.runs();
          host.setRuns([
            ...runs,
            {
              id: (runs.at(-1)?.id ?? 0) + 1,
              key,
              startedAt: now,
              endsAt: now + move.minutes * 60_000,
              costCents: move.costCents,
              chanceBps: move.chanceBps,
              status: "running",
              payoutCents: 0,
              gain: 0,
              resolvedAt: null,
            },
          ]);
          return state();
        }),
      ),
  };
}
