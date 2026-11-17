import { awarenessCap, awarenessOfCap } from "@/lib/sim/awareness";
import type { MyCompany } from "@/features/game/types";

/**
 * The one way the company page shows its awareness (ADR-188). Dashboard (status bar) and Controlling (market card)
 * both call this, so they can never show different numbers: the value is player_companies.awareness as sent by
 * get_my_company (awareness_bps), the cap is awarenessCap (= SQL company_awareness_cap, tested in c6_awareness.sql).
 */
export interface AwarenessView {
  /** Awareness in percent, one decimal. */
  readonly pct: number;
  /** Cap in percent, whole. */
  readonly capPct: number;
  /** Share of the cap, 0..1 (what the strength "Bekanntheit" follows). */
  readonly ofCap: number;
  readonly atCap: boolean;
}

export function awarenessView(
  company: Pick<MyCompany, "awarenessBps" | "tier" | "stage" | "expansionLevel">,
): AwarenessView {
  const a = company.awarenessBps / 10_000;
  const cap = awarenessCap(company.tier, company.stage, company.expansionLevel ?? 0);
  return {
    pct: Math.round(a * 1_000) / 10,
    capPct: Math.round(cap * 100),
    ofCap: awarenessOfCap(a, cap),
    atCap: a >= cap - 0.005,
  };
}
