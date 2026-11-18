import { BALANCE } from "@/config/balance";
import { vaultDepositCapCents, vaultDepositCheck, vaultDepositInterestCents, vaultDepositTerm } from "@/lib/sim/vault";
import { GameError, type GameEngine, type VaultDeposits } from "../types";

/*
 * Festgeld in the vault in the offline demo (ADR-201): same rules as the server. The principal moves from cash to the
 * reserved money and back; interest comes at maturity (the demo has no treasury, so the factor is 1).
 */
export interface DemoVaultDeposit {
  id: number;
  amountCents: number;
  termDays: number;
  rateBps: number;
  createdAt: number;
  maturesAt: number;
}

export interface DemoVaultDepositsState {
  nextId: number;
  open: DemoVaultDeposit[];
  earnedCents: number;
}

export interface VaultDepositsHost {
  level(): number;
  cashCents(): number;
  /** Moves money between cash and the reserved money (positive: into the reserve). */
  reserve(cents: number): void;
  /** Interest as private income (forced loan withholding); returns what the player received. */
  income(cents: number): number;
  state(): DemoVaultDepositsState;
  setState(next: DemoVaultDepositsState): void;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
}

const cfg = BALANCE.vault;
const DAY_MS = 86_400_000;

export const initialVaultDeposits = (): DemoVaultDepositsState => ({ nextId: 1, open: [], earnedCents: 0 });

export function createVaultDepositsEngine(
  host: VaultDepositsHost,
): Pick<GameEngine, "vaultDeposits" | "openVaultDeposit" | "closeVaultDeposit"> {
  const view = (): VaultDeposits => {
    const st = host.state();
    const now = host.now();
    const level = host.level();
    return {
      level,
      minLevel: cfg.deposits.minLevel,
      minCents: cfg.deposits.minCents,
      capCents: vaultDepositCapCents(level),
      maxOpen: cfg.deposits.maxOpen,
      factorBps: 10_000,
      serverTime: new Date(now).toISOString(),
      terms: cfg.deposits.terms.map((t) => ({ days: t.days, rateBps: t.rateBps })),
      openCents: st.open.reduce((sum, d) => sum + d.amountCents, 0),
      earnedCents: st.earnedCents,
      deposits: [...st.open]
        .sort((a, b) => a.maturesAt - b.maturesAt || a.id - b.id)
        .map((d) => ({
          id: d.id,
          amountCents: d.amountCents,
          termDays: d.termDays,
          rateBps: d.rateBps,
          createdAt: new Date(d.createdAt).toISOString(),
          maturesAt: new Date(d.maturesAt).toISOString(),
          matured: d.maturesAt <= now,
          interestCents: Number(vaultDepositInterestCents(BigInt(d.amountCents), d.rateBps)),
        })),
    };
  };

  return {
    vaultDeposits: async () => view(),
    openVaultDeposit: async (requestId, amountCents, termDays) =>
      host.idempotent(requestId, () => {
        const st = host.state();
        const amount = Math.floor(amountCents);
        const check = vaultDepositCheck({
          level: host.level(),
          amountCents: amount,
          days: termDays,
          cashCents: host.cashCents(),
          openCents: st.open.reduce((sum, d) => sum + d.amountCents, 0),
          openCount: st.open.length,
        });
        if (check === "level") throw new GameError("locked");
        if (check === "term") throw new GameError("invalid_argument");
        if (check === "too_small") throw new GameError("deposit_too_small");
        if (check === "cap" || check === "max_open") throw new GameError("deposit_limit");
        if (check === "cash") throw new GameError("insufficient_funds");
        const now = host.now();
        const term = vaultDepositTerm(termDays)!;
        host.reserve(amount);
        host.setState({
          ...st,
          nextId: st.nextId + 1,
          open: [
            ...st.open,
            {
              id: st.nextId,
              amountCents: amount,
              termDays,
              rateBps: term.rateBps,
              createdAt: now,
              maturesAt: now + termDays * DAY_MS,
            },
          ],
        });
        return view();
      }),
    closeVaultDeposit: async (requestId, depositId) =>
      host.idempotent(requestId, () => {
        const st = host.state();
        const deposit = st.open.find((d) => d.id === depositId);
        if (!deposit) throw new GameError("deposit_not_found");
        const matured = deposit.maturesAt <= host.now();
        host.reserve(-deposit.amountCents);
        const interest = matured
          ? host.income(Number(vaultDepositInterestCents(BigInt(deposit.amountCents), deposit.rateBps)))
          : 0;
        host.setState({
          ...st,
          open: st.open.filter((d) => d.id !== depositId),
          earnedCents: st.earnedCents + interest,
        });
        return {
          ...view(),
          closed: { id: deposit.id, amountCents: deposit.amountCents, interestCents: interest, matured },
        };
      }),
  };
}
