import { BALANCE } from "@/config/balance";
import { GameError, type CompanyPitch, type CompanyPitches, type GameEngine } from "../types";

/*
 * Own strategies in the offline demo (ADR-132): the Mini-KI judges at once (no Claude in the demo), the roll comes
 * when the pitch is read after its end. Same numbers as the server.
 */
export interface DemoPitch extends Omit<CompanyPitch, "createdAt" | "endsAt" | "resolvedAt"> {
  createdAt: number;
  endsAt: number | null;
  resolvedAt: number | null;
  topic: string;
}

export interface PitchesHost {
  company(): {
    name: string;
    tier: string;
    cashCents: number;
    awareness: number;
    quality: number;
    events?: {
      events: { id: string; archetype: string; status: string; mitigation: number; resolvedAt: number | null }[];
    };
  } | null;
  addCompanyCash(cents: number): void;
  news(kind: string, payload: Record<string, unknown>): void;
  pitches(): DemoPitch[];
  setPitches(p: DemoPitch[]): void;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
  random(): number;
}

const cfg = BALANCE.pitches;

/** Mini-KI: fit and backfire from keywords (same rules as pitch_mini_judge in the database). */
export function miniJudge(text: string, topic: string): { fit: number; backfire: number; risky: number } {
  const t = text.toLowerCase();
  const m = cfg.mini;
  const hits = (m.good[topic] ?? []).filter((w) => t.includes(w)).length;
  const risky = m.risky.filter((w) => t.includes(w)).length;
  const fit = Math.min(
    m.maxFit,
    m.fitBase + Math.min(hits, m.maxHits) * m.fitPerHit + (t.length >= m.longTextChars ? m.longTextBonus : 0),
  );
  const backfire = Math.min(m.maxBackfire, m.backfireBase + risky * m.backfirePerRisky);
  return { fit, backfire, risky };
}

export const pitchChanceBps = (fit: number) =>
  Math.min(cfg.maxChanceBps, cfg.chanceBaseBps + Math.max(0, Math.min(100, fit)) * cfg.chancePerFitBps);

export function createPitchesEngine(host: PitchesHost): Pick<GameEngine, "companyPitches" | "submitCompanyPitch"> {
  const activeEvent = () =>
    host.company()?.events?.events.find((e) => e.status === "open" || e.status === "in_force") ?? null;
  const base = () => {
    const c = host.company();
    if (!c) throw new GameError("company_not_found");
    const tier = c.tier as keyof typeof BALANCE.companyMoves.costCentsByTier;
    return {
      c,
      eventCost: BALANCE.companyEvents.costUnit.minUnitCents * cfg.eventCostUnits,
      moveCost: Math.round((BALANCE.companyMoves.costCentsByTier[tier] ?? 100_000) * cfg.moveCostFactor),
    };
  };

  function resolve() {
    const now = host.now();
    const list = host.pitches().map((p) => ({ ...p }));
    for (const p of list) {
      if (p.status !== "running" || p.endsAt === null || p.endsAt > now) continue;
      const c = host.company();
      const out =
        host.random() * 10_000 < (p.chanceBps ?? 0)
          ? "success"
          : host.random() * 100 < (p.backfire ?? 0)
            ? "backfire"
            : "failure";
      let amount = 0;
      if (out === "success" && p.kind === "move" && p.moveKind === "cash") {
        amount = Math.round(p.costCents * (cfg.movePayoutBase + (p.fit ?? 0) * cfg.movePayoutPerFit));
      } else if (out === "success" && p.kind === "move" && c) {
        const gain = cfg.moveGainBase + (p.fit ?? 0) * cfg.moveGainPerFit;
        if (p.moveKind === "awareness") c.awareness = Math.min(1, c.awareness + gain);
        else c.quality = Math.min(1, c.quality + gain);
      } else if (out === "success" && p.kind === "event" && c?.events) {
        const e = c.events.events.find((x) => x.id === p.eventId);
        if (e && (e.status === "open" || e.status === "in_force")) {
          e.status = "solved";
          e.resolvedAt = now;
          e.mitigation = Math.min(cfg.maxMitigation, cfg.mitigationBase + (p.fit ?? 0) * cfg.mitigationPerFit);
        }
      } else if (out === "backfire" && c) {
        c.awareness = Math.max(0, c.awareness - cfg.backfireAwareness);
        if (p.kind === "event") amount = -Math.min(p.costCents, c.cashCents);
      } else if (out === "failure" && p.kind === "move") {
        amount = Math.trunc((p.costCents * cfg.moveRefundBps) / 10_000);
      }
      if (amount !== 0) host.addCompanyCash(amount);
      p.status = out;
      p.resultCents = amount;
      p.resolvedAt = now;
      host.news(`pitch_${out}`, {
        outcome: out === "success" ? p.successText : out === "backfire" ? p.backfireText : p.failureText,
        pitch: p.text.slice(0, 120),
        kind: p.kind,
        amount_cents: amount,
      });
    }
    host.setPitches(list.slice(-20));
  }

  function state(): CompanyPitches {
    const { eventCost, moveCost } = base();
    return {
      eventId: activeEvent()?.id ?? null,
      eventCostCents: eventCost,
      moveCostCents: moveCost,
      pitches: [...host.pitches()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 8)
        .map((p) => ({
          ...p,
          createdAt: new Date(p.createdAt).toISOString(),
          endsAt: p.endsAt === null ? null : new Date(p.endsAt).toISOString(),
          resolvedAt: p.resolvedAt === null ? null : new Date(p.resolvedAt).toISOString(),
        })),
    };
  }

  return {
    async companyPitches() {
      resolve();
      return state();
    },
    submitCompanyPitch: (requestId, kind, text, moveKind) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          const clean = text.trim();
          if (clean.length < cfg.minChars || clean.length > cfg.maxChars) throw new GameError("pitch_text_invalid");
          resolve();
          const { c, eventCost, moveCost } = base();
          const list = host.pitches();
          const event = activeEvent();
          if (kind === "event" && !event) throw new GameError("event_closed");
          if (
            kind === "event" &&
            list.some((p) => p.eventId === event?.id && (p.status === "judging" || p.status === "running"))
          )
            throw new GameError("pitch_busy");
          if (kind === "move" && list.some((p) => p.kind === "move" && p.status === "running"))
            throw new GameError("pitch_busy");
          const cost = kind === "event" ? eventCost : moveCost;
          if (c.cashCents < cost) throw new GameError("insufficient_funds");
          host.addCompanyCash(-cost);
          const topic = kind === "event" ? (event?.archetype ?? "") : (moveKind ?? "cash");
          const j = miniJudge(clean, topic);
          const now = host.now();
          const pitch: DemoPitch = {
            id: (list.at(-1)?.id ?? 0) + 1,
            kind,
            moveKind: kind === "move" ? moveKind : null,
            eventId: kind === "event" ? (event?.id ?? null) : null,
            text: clean,
            status: "running",
            judge: "mini",
            fit: j.fit,
            backfire: j.backfire,
            chanceBps: pitchChanceBps(j.fit),
            verdict:
              (j.fit >= 60
                ? "Klingt durchdacht und passt zur Lage."
                : j.fit >= 40
                  ? "Kann klappen, ist aber kein Selbstläufer."
                  : "Passt kaum zur Lage. Das wird schwierig.") +
              (j.risky > 0 ? " Vorsicht: Das könnte als Schönfärberei rüberkommen." : ""),
            successText: `${c.name}: Die eigene Strategie geht auf.`,
            failureText: `${c.name}: Die eigene Strategie verpufft ohne Wirkung.`,
            backfireText: `${c.name}: Die eigene Strategie geht nach hinten los, Kunden fühlen sich veräppelt.`,
            costCents: cost,
            resultCents: 0,
            createdAt: now,
            endsAt: now + (kind === "event" ? cfg.eventMinutes : cfg.moveMinutes) * 60_000,
            resolvedAt: null,
            topic,
          };
          host.setPitches([...list, pitch]);
          return state();
        }),
      ),
  };
}
