/*
 * The company at a glance (ADR-180): what the last closed hour says in plain words. Pure, so it can be tested; the
 * dashboard turns the keys into German texts (messages/de.json, hq.pulse).
 */
import type { CompanyAutopilot } from "@/features/game/types";

type LastHour = NonNullable<CompanyAutopilot["lastHour"]>;

export type AiState = "none" | "busy" | "partly" | "idle";

export interface Pulse {
  /** How the AI workers did: all busy, partly, idle ("zu wenig Nachfrage") or there are none. */
  ai: AiState;
  /** AI workers without work this hour (rounded down). */
  idleAi: number;
  /** Awareness in percent points: total change of the hour and each lever (one decimal). */
  awareness: { total: number; marketing: number; wordOfMouth: number; decay: number; extra: number; atCap: boolean };
  /** Demand above capacity: more hands would sell more. */
  soldOut: boolean;
}

const points = (share: number | null | undefined) => Math.round((share ?? 0) * 1000) / 10;

/** Reads the last hour. Without one (a fresh company) everything is neutral. */
export function companyPulse(h: LastHour | null): Pulse {
  const parts = h?.awarenessParts ?? null;
  const util = h?.aiUtilizationBps ?? 0;
  const ai: AiState = !h || h.aiWorkers <= 0 ? "none" : util >= 9_500 ? "busy" : util > 0 ? "partly" : "idle";
  const idleAi = h && h.aiWorkers > 0 ? Math.floor((h.aiWorkers * (10_000 - Math.min(10_000, util))) / 10_000) : 0;
  const before = h?.awarenessBefore ?? null;
  const after = h?.awarenessAfter ?? null;
  return {
    ai,
    idleAi,
    awareness: {
      total: before !== null && after !== null ? points(after - before) : 0,
      marketing: points(parts?.marketing),
      wordOfMouth: points(parts?.wordOfMouth),
      decay: points(parts?.decay),
      extra: points(parts?.extra),
      atCap: parts !== null && after !== null && after >= parts.cap - 0.0005,
    },
    soldOut: !!h && h.demandCents > h.capacityCents,
  };
}
