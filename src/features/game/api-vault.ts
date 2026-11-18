import { z } from "zod";
import type { GameEngine, VaultDepositClosed, VaultDeposits } from "./types";
import { rpc } from "./rpc";

/*
 * Festgeld in the vault (ADR-201), against the server.
 */
const num = z.number();
const depositsSchema = z.object({
  level: num,
  min_level: num,
  min_cents: num,
  cap_cents: num,
  max_open: num,
  factor_bps: num,
  server_time: z.string(),
  terms: z.array(z.object({ days: num, rate_bps: num })),
  open_cents: num,
  earned_cents: num,
  deposits: z.array(
    z.object({
      id: num,
      amount_cents: num,
      term_days: num,
      rate_bps: num,
      created_at: z.string(),
      matures_at: z.string(),
      matured: z.boolean(),
      interest_cents: num,
    }),
  ),
});
const closedSchema = depositsSchema.extend({
  closed: z.object({ id: num, amount_cents: num, interest_cents: num, matured: z.boolean() }),
});

export const VAULT_RPC_SCHEMAS = {
  get_vault_deposits: depositsSchema,
  open_vault_deposit: depositsSchema,
  close_vault_deposit: closedSchema,
} as const;

export function toVaultDeposits(r: z.infer<typeof depositsSchema>): VaultDeposits {
  return {
    level: r.level,
    minLevel: r.min_level,
    minCents: r.min_cents,
    capCents: r.cap_cents,
    maxOpen: r.max_open,
    factorBps: r.factor_bps,
    serverTime: r.server_time,
    terms: r.terms.map((t) => ({ days: t.days, rateBps: t.rate_bps })),
    openCents: r.open_cents,
    earnedCents: r.earned_cents,
    deposits: r.deposits.map((d) => ({
      id: d.id,
      amountCents: d.amount_cents,
      termDays: d.term_days,
      rateBps: d.rate_bps,
      createdAt: d.created_at,
      maturesAt: d.matures_at,
      matured: d.matured,
      interestCents: d.interest_cents,
    })),
  };
}

export const liveVaultEngine: Pick<GameEngine, "vaultDeposits" | "openVaultDeposit" | "closeVaultDeposit"> = {
  async vaultDeposits() {
    return toVaultDeposits(await rpc("get_vault_deposits", {}, depositsSchema));
  },
  async openVaultDeposit(requestId, amountCents, termDays) {
    return toVaultDeposits(
      await rpc(
        "open_vault_deposit",
        { p_request_id: requestId, p_amount_cents: amountCents, p_term_days: termDays },
        depositsSchema,
      ),
    );
  },
  async closeVaultDeposit(requestId, depositId): Promise<VaultDepositClosed> {
    const r = await rpc("close_vault_deposit", { p_request_id: requestId, p_deposit_id: depositId }, closedSchema);
    return {
      ...toVaultDeposits(r),
      closed: {
        id: r.closed.id,
        amountCents: r.closed.amount_cents,
        interestCents: r.closed.interest_cents,
        matured: r.closed.matured,
      },
    };
  },
};
