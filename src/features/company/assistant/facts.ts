/*
 * The company facts (ADR-185): one typed snapshot of everything the company page shows, built from the same queries
 * the page uses. Mira's briefings, suggestions and answers read only this, so she never says what the page does not
 * show. Pure: the state and the clock come in. Money in cents, rates in bps, awareness, quality and reputation in
 * points (0..100), all per hour unless the name says otherwise.
 */
import { BALANCE, type BalanceConfig } from "@/config/balance";
import type { CampaignKind, PriceLevel } from "@/features/game/types";
import type { HealthFactorKey, HealthStatus } from "@/lib/sim/company-health";
import { aiWageDueCents, priceEffect } from "@/lib/sim/startup";
import { awarenessCap, halfSaturationMarketingCents, marketingRate } from "@/lib/sim/awareness";
import type { MiraState } from "./brain";

const round1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export interface CompanyFacts {
  founder: boolean;
  now: number;
  name: string;
  /** Stock exchange: listed with the listed state loaded. */
  isListed: boolean;
  /** No company data (employee view or loading): only tasks, moves and orders are known. */
  known: boolean;
  cash: {
    cashCents: number;
    /** What may be spent: cash less open bills (listed: less what the board earmarked). */
    freeCents: number;
    unpaidCents: number;
    distress: boolean;
    /** Hours the free cash lasts at the last hour's loss; null without a loss. */
    runwayHours: number | null;
  };
  /** The last closed hour; null before the first one. */
  hour: {
    revenueCents: number;
    ownRevenueCents: number;
    contractRevenueCents: number;
    costsCents: number;
    profitCents: number;
    goodsAndWagesCents: number;
    aiWagesCents: number;
    fixedCents: number;
    marketingCents: number;
    payFactorBps: number;
  } | null;
  /** The last up to 24 closed hours. */
  day: { hours: number; revenueCents: number; profitCents: number; lossHours: number };
  /** Demand and capacity of the last hour, in revenue at the normal price. */
  demand: {
    demandCents: number;
    capacityCents: number;
    soldCents: number;
    freeCapacityCents: number;
    /** Demand against capacity (bps, 10 000 = exactly full). */
    utilizationBps: number;
    soldOut: boolean;
  } | null;
  ai: {
    workers: number;
    wageCentsPerHour: number;
    /** Share of the AI workers' capacity the last hour used (bps); null without data. */
    utilizationBps: number | null;
    idle: number;
    /** What dismissing the idle ones saves per hour (they cost the standby share). */
    idleSavingCents: number;
  };
  awareness: {
    points: number;
    capPoints: number;
    atCap: boolean;
    /** Change of the last hour and its levers in points; null without data. */
    change: { total: number; marketing: number; wordOfMouth: number; decay: number; extra: number } | null;
    marketingPerQuarterCents: number;
    /** The budget that buys half the possible gain ("Marketing auf X €"). */
    suggestedMarketingCents: number;
    /** Points per hour marketing adds now and at the suggested budget (the hourly formula, calibrated). */
    marketingGainNow: number;
    marketingGainSuggested: number;
  };
  quality: { points: number; premiumMinPoints: number };
  price: { level: PriceLevel; contractWork: boolean; lockedTo: PriceLevel | null; priceFactor: number };
  reputation: {
    value: number;
    target: number;
    /** Demand effect of the value now (bps, + or −). */
    demandEffectBps: number;
    drivers: Record<string, number>;
    /** The driver that takes the most points, if it takes enough to matter. */
    worst: { key: string; points: number } | null;
  } | null;
  strengths: {
    scores: Record<string, number>;
    overall: number;
    rewardBps: number;
    next: { at: number; bps: number } | null;
    weakest: string;
  } | null;
  health: {
    score: number;
    weakest: HealthFactorKey;
    estimated: boolean;
    factors: { key: HealthFactorKey; score: number; status: HealthStatus; impactCents: number }[];
  } | null;
  team: {
    headcount: number;
    maxEmployees: number;
    freeSlots: number;
    players: number;
    applications: number;
    trainingOpen: boolean;
    missingSkills: string[];
  };
  growth: {
    canExpand: boolean;
    expansionCostCents: number | null;
    canAffordExpansion: boolean;
    canUpgrade: boolean;
    upgradeCostCents: number | null;
    canGoPublic: boolean;
    subscription: boolean;
  };
  campaign: {
    running: CampaignKind | null;
    endsAt: string | null;
    /** The cheapest campaign the free cash can pay, while none runs. */
    cheapest: { kind: CampaignKind; costCents: number } | null;
  };
  tasks: { open: number; actionable: number; urgent: number; openValueCents: number; momentumBps: number };
  autopilot: { on: boolean; canToggle: boolean; chanceBps: number; rewardBps: number; doneToday: number } | null;
  moves: { slots: number; free: number; ready: number } | null;
  /** The free order (ADR-139): null for employees. */
  order: { costCents: number; waitMinutes: number | null; affordable: boolean } | null;
  event: { polarity: "crisis" | "chance"; pitched: boolean } | null;
  interview: { expiresAt: string } | null;
  /**
   * Fertigkeiten (ADR-194): learned levels and the cheapest next level that can be learned now (skill held, not in
   * training, affordable), or null.
   */
  skills: { levels: number; learnable: { key: string; costCents: number } | null } | null;
  /** ADR-199: empty Stellen and unhappy talents. */
  talents: { vacant: number; unhappy: number; firstVacant: string | null } | null;
  listed: {
    satisfaction: number;
    zone: "green" | "yellow" | "red";
    capacityLossPct: number;
    taxDueCents: number;
    taxLate: boolean;
    booksOpen: boolean;
    booksLate: boolean;
    advisor: boolean;
    boardToVote: number;
    payoutRatioBps: number;
  } | null;
  /** The hourly close fails or skipped a step (the dashboard shows why). */
  closeProblem: boolean;
}

/** Gross profit of one more unit of normal-price revenue sold. */
export function grossPerSoldCent(facts: CompanyFacts, sector: string, cfg: BalanceConfig = BALANCE): number {
  const margin = (cfg.startups.grossMargin as Record<string, number>)[sector] ?? 0.5;
  return Math.max(0, facts.price.priceFactor - (1 - margin));
}

/** Builds the snapshot. Without `state.company` only what the tasks and moves say is known. */
export function companyFacts(state: MiraState, cfg: BalanceConfig = BALANCE): CompanyFacts {
  const c = state.company ?? null;
  const l = c?.listing?.status === "listed" ? (state.listed ?? null) : null;
  const sc = cfg.startups;
  const founder = state.tasks.role === "founder";
  const now = state.now;

  // ---- money and the last hour
  const unpaid = c?.unpaidCents ?? 0;
  const free = l ? l.freeCashCents : Math.max(0, (c?.cashCents ?? 0) - unpaid);
  const live = c?.live ?? null;
  const hour = live
    ? (() => {
        const goodsAndWages = Math.max(
          0,
          live.revenuePerHourCents -
            live.profitPerHourCents -
            live.fixedPerHourCents -
            live.marketingPerHourCents -
            live.aiWagesPerHourCents,
        );
        return {
          revenueCents: live.revenuePerHourCents,
          ownRevenueCents: Math.max(0, live.revenuePerHourCents - live.contractRevenuePerHourCents),
          contractRevenueCents: live.contractRevenuePerHourCents,
          costsCents: Math.max(0, live.revenuePerHourCents - live.profitPerHourCents),
          profitCents: live.profitPerHourCents,
          goodsAndWagesCents: goodsAndWages,
          aiWagesCents: live.aiWagesPerHourCents,
          fixedCents: live.fixedPerHourCents,
          marketingCents: live.marketingPerHourCents,
          payFactorBps: live.payFactorBps,
        };
      })()
    : null;
  const hours = (c?.hours ?? []).slice(-24);
  const day = {
    hours: hours.length,
    revenueCents: hours.reduce((s, h) => s + h.revenueCents, 0),
    profitCents: hours.reduce((s, h) => s + h.profitCents, 0),
    lossHours: hours.filter((h) => h.profitCents < 0).length,
  };
  const runwayHours = hour && hour.profitCents < 0 ? Math.floor(free / -hour.profitCents) : null;

  // ---- demand, capacity and the AI workers
  const lastAuto = state.autopilot?.lastHour ?? null;
  const demand = live
    ? (() => {
        const sold = Math.min(live.demandPerHourCents, live.capacityPerHourCents);
        return {
          demandCents: live.demandPerHourCents,
          capacityCents: live.capacityPerHourCents,
          soldCents: sold,
          freeCapacityCents: Math.max(0, live.capacityPerHourCents - sold),
          utilizationBps:
            live.capacityPerHourCents > 0
              ? Math.round((live.demandPerHourCents * 10_000) / live.capacityPerHourCents)
              : 0,
          soldOut: live.demandPerHourCents > live.capacityPerHourCents,
        };
      })()
    : null;
  const workers = c?.aiWorkers ?? state.tasks.aiWorkers ?? 0;
  const wage = c?.aiWageCentsPerHour ?? sc.aiWorkerWageCentsPerHour;
  const lastHourUtil = c?.hours.at(-1)?.aiUtilizationBps ?? null;
  const utilization = workers > 0 ? (lastAuto?.aiUtilizationBps ?? lastHourUtil ?? null) : null;
  const idle =
    utilization !== null && workers > 0 ? Math.floor((workers * (10_000 - Math.min(10_000, utilization))) / 10_000) : 0;
  const wageCfg = { ...cfg, startups: { ...sc, aiWorkerWageCentsPerHour: wage } };
  const idleSaving =
    idle > 0 && utilization !== null
      ? aiWageDueCents(workers, utilization, wageCfg) -
        aiWageDueCents(workers - idle, Math.min(10_000, (utilization * workers) / (workers - idle)), wageCfg)
      : 0;

  // ---- awareness and marketing: the hourly formula of the close (awarenessHour), on the owner's market estimate
  // ADR-188: the same cap as the hourly close (legal form, stage, expansion)
  const cap = awarenessCap(c?.tier ?? "garage", c?.stage ?? 0, c?.expansionLevel ?? 0, sc.awareness);
  const awareness = (c?.awarenessBps ?? 0) / 10_000;
  const market = Math.sqrt(Math.max(1, c?.estimateLowCents ?? 1) * Math.max(1, c?.estimateHighCents ?? 1));
  const qh = Math.max(1, cfg.time.quarterHours);
  // points one hour of this quarterly budget adds now: rate x gap to the cap (ADR-188)
  const perHour = (budget: number) =>
    marketingRate(budget / qh, market, sc.awareness, qh) * Math.max(0, cap - awareness) * 100;
  const parts = lastAuto?.awarenessParts ?? null;
  const before = lastAuto?.awarenessBefore ?? null;
  const after = lastAuto?.awarenessAfter ?? null;
  const change =
    parts && before !== null && after !== null
      ? {
          total: round1((after - before) * 100),
          marketing: round1(parts.marketing * 100),
          wordOfMouth: round1(parts.wordOfMouth * 100),
          decay: round1(parts.decay * 100),
          extra: round1(parts.extra * 100),
        }
      : null;
  const marketingNow = c?.marketingCentsPerQuarter ?? 0;
  // The page's slider ends at a fifth of the quarter's upper market estimate (MarketingBudgetCard).
  const maxMarketing = Math.max(100_000, Math.round((c?.estimateHighCents ?? 0) / 4 / 5 / 1_000) * 1_000);
  const half = halfSaturationMarketingCents(market, sc.awareness);
  const suggested = Math.min(maxMarketing, Math.round(half / 1_000) * 1_000);
  // Calibrate the estimate with what marketing really brought in the last hour (the market size is hidden).
  const estimateNow = perHour(marketingNow);
  const scale =
    change && estimateNow > 0.05 && change.marketing > 0 ? clamp(change.marketing / estimateNow, 0.25, 4) : 1;
  const atCap = awareness >= cap - 0.005;

  // ---- price and reputation
  const quality = clamp((c?.qualityBps ?? 0) / 10_000, 0, 1);
  const priceLevel = c?.priceLevel ?? "normal";
  const rep = l
    ? {
        value: l.reputation.value,
        target: l.reputation.target,
        demandFactor: l.reputation.demandFactor,
        drivers: { ...l.reputation.drivers, ...(c?.reputation?.drivers ?? {}) },
      }
    : c?.reputation
      ? {
          value: c.reputation.value,
          target: c.reputation.target,
          demandFactor: c.reputation.demandFactor,
          drivers: c.reputation.drivers,
        }
      : null;
  const worstDriver = rep
    ? Object.entries(rep.drivers)
        .filter(([key]) => key !== "base")
        .sort((a, b) => a[1] - b[1])[0]
    : undefined;

  // ---- strengths and health
  const st = c?.strengths ?? null;
  const strengths = st
    ? {
        scores: st.scores,
        overall: st.overall,
        rewardBps: st.rewardBps,
        next: st.next,
        weakest: Object.entries(st.scores).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "awareness",
      }
    : null;
  const h = state.health?.result ?? null;

  // ---- team and growth
  const nextStage = c?.stages.find((s) => !s.reached && s.stage > (c?.stage ?? 0)) ?? null;
  const headcount = c?.headcount ?? 0;
  const maxEmployees = c?.maxEmployees ?? 0;
  const players = c?.employees ?? 0;

  // ---- campaign
  const running = c?.campaign && Date.parse(c.campaign.endsAt) > now ? c.campaign : null;
  const costs = c?.campaignCosts ?? null;
  const cheapest =
    !running && costs
      ? ((Object.keys(costs) as CampaignKind[])
          .filter((k) => costs[k] <= free)
          .sort((a, b) => costs[a] - costs[b])
          .map((kind) => ({ kind, costCents: costs[kind] }))[0] ?? null)
      : null;

  // ---- tasks, autopilot, moves, orders
  const t = state.tasks;
  const openTasks = t.tasks.filter((x) => x.status === "open");
  const actionable = t.tasks.filter(
    (x) => (x.status === "open" && x.canDelegate) || (x.mine && x.status === "assigned"),
  );
  const urgent = openTasks.filter((x) => {
    const left = (Date.parse(x.dueAt) - now) / 60_000;
    return left > 0 && left <= cfg.companyAssistant.urgentMinutes;
  });
  const ap = state.autopilot ?? null;
  const moves = state.moves ?? null;
  const ready = moves
    ? moves.moves.filter(
        (m) => m.costCents <= moves.cashCents && (m.availableAt === null || Date.parse(m.availableAt) <= now),
      ).length
    : 0;
  const o = state.orders ?? null;
  const wait =
    o && o.nextOrderAt !== null && o.nextOrderAt > now ? Math.max(1, Math.ceil((o.nextOrderAt - now) / 60_000)) : null;

  return {
    founder,
    now,
    name: c?.name ?? t.company.name,
    isListed: l !== null,
    known: c !== null,
    cash: {
      cashCents: c?.cashCents ?? moves?.cashCents ?? 0,
      freeCents: c ? free : (moves?.cashCents ?? 0),
      unpaidCents: unpaid,
      distress: c?.distress ?? false,
      runwayHours,
    },
    hour,
    day,
    demand,
    ai: {
      workers,
      wageCentsPerHour: wage,
      utilizationBps: utilization,
      idle,
      idleSavingCents: Math.max(0, idleSaving),
    },
    awareness: {
      points: round1(awareness * 100),
      capPoints: round1(cap * 100),
      atCap,
      change,
      marketingPerQuarterCents: marketingNow,
      suggestedMarketingCents: suggested,
      marketingGainNow: atCap ? 0 : round1(estimateNow * scale),
      marketingGainSuggested: atCap ? 0 : round1(perHour(suggested) * scale),
    },
    quality: { points: Math.round(quality * 100), premiumMinPoints: Math.round(sc.pricing.premiumMinQuality * 100) },
    price: {
      level: priceLevel,
      contractWork: c?.contractWork ?? false,
      lockedTo:
        l?.restrictions.priceLock && l.restrictions.priceLockUntil && Date.parse(l.restrictions.priceLockUntil) > now
          ? l.restrictions.priceLock
          : null,
      priceFactor: priceEffect(priceLevel, quality, sc).price,
    },
    reputation: rep
      ? {
          value: Math.round(rep.value),
          target: Math.round(rep.target),
          demandEffectBps: Math.round((rep.demandFactor - 1) * 10_000),
          drivers: rep.drivers,
          worst:
            worstDriver && worstDriver[1] <= -cfg.companyAssistant.advice.reputationDriverPoints
              ? { key: worstDriver[0], points: round1(worstDriver[1]) }
              : null,
        }
      : null,
    strengths,
    health: h
      ? {
          score: h.score,
          weakest: h.weakest,
          estimated: h.estimated,
          factors: h.factors.map((f) => ({ key: f.key, score: f.score, status: f.status, impactCents: f.impactCents })),
        }
      : null,
    team: {
      headcount,
      maxEmployees,
      freeSlots: Math.max(0, maxEmployees - headcount),
      players,
      applications: state.applications,
      trainingOpen: c !== null && players > 0 && players + (c.aiWorkers ?? 0) >= c.trainingFrom,
      missingSkills: nextStage ? nextStage.skills.filter((s) => !s.coveredBy && !s.coveredByAi).map((s) => s.key) : [],
    },
    growth: {
      canExpand: c?.canExpand ?? false,
      expansionCostCents: c?.expansionCostCents ?? null,
      canAffordExpansion: !!c?.canExpand && c.expansionCostCents !== null && free >= c.expansionCostCents,
      canUpgrade: c?.canUpgrade ?? false,
      upgradeCostCents: c?.upgradeCostCents ?? null,
      canGoPublic: !!c && !c.listing && c.canGoPublic,
      subscription: c?.listing?.status === "subscription",
    },
    campaign: { running: running?.kind ?? null, endsAt: running?.endsAt ?? null, cheapest },
    tasks: {
      open: openTasks.length,
      actionable: actionable.length,
      urgent: urgent.length,
      openValueCents: openTasks.reduce((s, x) => s + x.valueCents, 0),
      momentumBps: Math.round(((t.momentum ?? 1) - 1) * 10_000),
    },
    autopilot: ap
      ? {
          on: ap.on,
          canToggle: ap.canToggle,
          chanceBps: ap.chanceBps,
          rewardBps: ap.rewardBps,
          doneToday: ap.today.done,
        }
      : null,
    moves: moves && founder ? { slots: moves.slots, free: Math.max(0, moves.slots - moves.used), ready } : null,
    order:
      o && founder
        ? { costCents: o.costCents, waitMinutes: wait, affordable: !moves || moves.cashCents >= o.costCents }
        : null,
    event: state.event ? { polarity: state.event.polarity, pitched: state.eventPitched } : null,
    interview:
      state.interview && state.interview.status === "requested" && Date.parse(state.interview.expiresAt) > now
        ? { expiresAt: state.interview.expiresAt }
        : null,
    talents: state.talents
      ? {
          vacant: state.talents.seats.filter((s) => !s.talent).length,
          unhappy: state.talents.seats.filter((s) => s.talent?.warned).length,
          firstVacant: state.talents.seats.find((s) => !s.talent)?.role ?? null,
        }
      : null,
    skills: state.skills
      ? {
          levels: state.skills.skills.reduce((a, s) => a + s.level, 0),
          learnable:
            state.skills.skills
              .filter(
                (s) =>
                  s.nextCostCents !== null &&
                  s.missing === null &&
                  s.trainingUntil === null &&
                  s.nextCostCents <= state.skills!.freeCashCents,
              )
              .map((s) => ({ key: s.key, costCents: s.nextCostCents! }))
              .sort((a, b) => a.costCents - b.costCents)[0] ?? null,
        }
      : null,
    listed: l
      ? {
          satisfaction: Math.round(l.satisfaction.value),
          zone: l.satisfaction.zone,
          capacityLossPct: Math.max(0, Math.round((1 - l.satisfaction.capacityFactor) * 100)),
          taxDueCents: l.taxes.dueCents,
          taxLate: l.taxes.periods.some((p) => p.status === "due" && p.stage > 0),
          booksOpen: l.books.canClose && !l.taxes.advisor,
          booksLate: l.books.stage === "late" || l.books.stage === "estimate" || l.books.stage === "reminder",
          advisor: l.taxes.advisor,
          boardToVote: l.board.toVote,
          payoutRatioBps: l.reputation.payoutRatioBps,
        }
      : null,
    closeProblem: !!c?.strengths?.closeError || (c?.closeWarnings.length ?? 0) > 0,
  };
}

/** The facts as plain lines for Claude (ADR-185): numbers in euros and points, nothing invented on the way. */
export function factsForClaude(f: CompanyFacts): Record<string, string | number | boolean | null> {
  const euro = (cents: number) => Math.round(cents / 100);
  return {
    rolle: f.founder ? "gruender" : "mitarbeiter",
    boersennotiert: f.isListed,
    kasse_eur: euro(f.cash.cashCents),
    frei_verfuegbar_eur: euro(f.cash.freeCents),
    offene_rechnungen_eur: euro(f.cash.unpaidCents),
    reicht_noch_stunden: f.cash.runwayHours,
    letzte_stunde_umsatz_eur: f.hour ? euro(f.hour.revenueCents) : null,
    letzte_stunde_kosten_eur: f.hour ? euro(f.hour.costsCents) : null,
    letzte_stunde_gewinn_eur: f.hour ? euro(f.hour.profitCents) : null,
    letzte_stunde_ware_und_loehne_eur: f.hour ? euro(f.hour.goodsAndWagesCents) : null,
    letzte_stunde_ki_loehne_eur: f.hour ? euro(f.hour.aiWagesCents) : null,
    letzte_stunde_fixkosten_eur: f.hour ? euro(f.hour.fixedCents) : null,
    letzte_stunde_marketing_eur: f.hour ? euro(f.hour.marketingCents) : null,
    letzte_stunde_auftragsarbeit_eur: f.hour ? euro(f.hour.contractRevenueCents) : null,
    stunden_im_verlauf: f.day.hours,
    umsatz_24h_eur: euro(f.day.revenueCents),
    gewinn_24h_eur: euro(f.day.profitCents),
    nachfrage_eur_h: f.demand ? euro(f.demand.demandCents) : null,
    kapazitaet_eur_h: f.demand ? euro(f.demand.capacityCents) : null,
    auslastung_prozent: f.demand ? Math.round(f.demand.utilizationBps / 100) : null,
    ki_kraefte: f.ai.workers,
    ki_lohn_eur_h: euro(f.ai.wageCentsPerHour),
    ki_auslastung_prozent: f.ai.utilizationBps === null ? null : Math.round(f.ai.utilizationBps / 100),
    ki_kraefte_ohne_arbeit: f.ai.idle,
    bekanntheit_punkte: f.awareness.points,
    bekanntheit_deckel_punkte: f.awareness.capPoints,
    bekanntheit_letzte_stunde: f.awareness.change?.total ?? null,
    bekanntheit_durch_marketing: f.awareness.change?.marketing ?? null,
    bekanntheit_durch_mundpropaganda: f.awareness.change?.wordOfMouth ?? null,
    bekanntheit_vergessen: f.awareness.change?.decay ?? null,
    marketing_je_quartal_eur: euro(f.awareness.marketingPerQuarterCents),
    marketing_vorschlag_eur: euro(f.awareness.suggestedMarketingCents),
    marketing_bringt_punkte_h: f.awareness.marketingGainNow,
    qualitaet_punkte: f.quality.points,
    preis: f.price.level,
    preis_gesperrt_auf: f.price.lockedTo,
    auftragsarbeit: f.price.contractWork,
    ruf: f.reputation?.value ?? null,
    ruf_ziel: f.reputation?.target ?? null,
    ruf_nachfrage_prozent: f.reputation ? Math.round(f.reputation.demandEffectBps / 100) : null,
    ruf_groesster_bremser: f.reputation?.worst ? `${f.reputation.worst.key} ${f.reputation.worst.points}` : null,
    staerken_gesamt: f.strengths?.overall ?? null,
    staerken_bonus_prozent: f.strengths ? f.strengths.rewardBps / 100 : null,
    staerken_schwaechste: f.strengths?.weakest ?? null,
    diagnose_gesamt: f.health?.score ?? null,
    diagnose_groesster_hebel: f.health?.weakest ?? null,
    plaetze_frei: f.team.freeSlots,
    bewerbungen: f.team.applications,
    kampagne_laeuft: f.campaign.running,
    offene_aufgaben: f.tasks.open,
    autopilot: f.autopilot ? f.autopilot.on : null,
    autopilot_chance_prozent: f.autopilot ? Math.round(f.autopilot.chanceBps / 100) : null,
    freie_zug_plaetze: f.moves?.free ?? null,
    freier_auftrag_in_min: f.order?.waitMinutes ?? null,
    krise_oder_chance: f.event?.polarity ?? null,
    interview_wartet: f.interview !== null,
    fertigkeiten_stufen: f.skills?.levels ?? null,
    fertigkeit_lernbar: f.skills?.learnable?.key ?? null,
    stellen_unbesetzt: f.talents?.vacant ?? null,
    talente_unzufrieden: f.talents?.unhappy ?? null,
    zufriedenheit: f.listed?.satisfaction ?? null,
    steuer_faellig_eur: f.listed ? euro(f.listed.taxDueCents) : null,
    buecher_offen: f.listed?.booksOpen ?? null,
    antraege_zur_abstimmung: f.listed?.boardToVote ?? null,
  };
}
