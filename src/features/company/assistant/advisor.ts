/*
 * Mira's advice (ADR-185): rules over the company facts, each with the money or progress it brings by the game's own
 * formulas, ranked, and only with buttons that work right now. Pure; texts are message keys under "mira.".
 */
import { BALANCE } from "@/config/balance";
import { isCompanySection, sectionAvailable, type CompanySection } from "../tabs";
import {
  describeAction,
  healthSteps,
  planTasks,
  suggestMoves,
  orderBlock,
  type MiraAction,
  type MiraLine,
  type MiraNames,
  type MiraOption,
  type MiraState,
  type MiraTurn,
} from "./brain";
import { companyFacts, grossPerSoldCent, type CompanyFacts } from "./facts";

const cfg = BALANCE.companyAssistant;
const adv = cfg.advice;
const sc = BALANCE.startups;
const repCfg = BALANCE.companyHealth.reputation;

/** Every rule Mira knows (the audit table in ADR-185 lists them). */
export const ADVICE_RULES = [
  "distress",
  "runway",
  "loss",
  "aiIdle",
  "marketing",
  "marketingWasted",
  "contractWork",
  "price",
  "premiumLow",
  "soldOut",
  "campaign",
  "expand",
  "upgrade",
  "autopilot",
  "reputation",
  "strengths",
  "skill",
  "interview",
  "companySkills",
  "ipo",
] as const;
export type AdviceRule = (typeof ADVICE_RULES)[number];

export interface Advice {
  rule: AdviceRule;
  /** Stable while the situation stays the same, so a briefing is posted once. */
  id: string;
  /** Alarms (bills, cash running out) come first, whatever they are worth. */
  urgent: boolean;
  /** Estimated extra profit per hour (cents), by the game's formulas. */
  impactCents: number;
  lines: MiraLine[];
  options: MiraOption[];
}

// ---- What can be done right now -------------------------------------------------------------------------------------

/** Whether a section is on the company page now. */
export function sectionOpen(section: string, facts: CompanyFacts): boolean {
  if (!isCompanySection(section)) return false;
  if (!facts.founder) return section === "tasks";
  return sectionAvailable(section, { listed: facts.isListed, trainingOpen: facts.team.trainingOpen });
}

/**
 * Whether an action is possible right now: the button it stands for is enabled, the server would accept it. Mira
 * shows no option that fails.
 */
export function actionEnabled(
  action: MiraAction,
  state: MiraState,
  facts: CompanyFacts = companyFacts(state),
): boolean {
  const founder = facts.founder;
  const known = facts.known;
  switch (action.type) {
    case "delegate": {
      const t = state.tasks.tasks.find((x) => x.id === action.taskId);
      if (!t || !t.canDelegate || t.status !== "open") return false;
      if (action.to === "ai") return state.tasks.canUseAi;
      return state.tasks.people.some((p) => !p.isMe && p.nickname === action.to);
    }
    case "play": {
      const t = state.tasks.tasks.find((x) => x.id === action.taskId);
      return !!t && Date.parse(t.dueAt) > state.now && (t.status === "open" || (t.mine && t.status === "assigned"));
    }
    case "move": {
      const m = state.moves;
      const move = m?.moves.find((x) => x.key === action.key);
      return (
        founder &&
        !!m &&
        !!move &&
        m.used < m.slots &&
        move.costCents <= m.cashCents &&
        (move.availableAt === null || Date.parse(move.availableAt) <= state.now)
      );
    }
    case "pitch":
      return action.kind === "move" ? orderBlock(state) === null : state.event !== null && !state.eventPitched;
    case "compose":
      return action.kind === "move" ? orderBlock(state) === null : state.event !== null && !state.eventPitched;
    case "autoAi":
      return founder && state.tasks.autoAi !== action.on && (!action.on || state.tasks.canUseAi);
    case "autopilot":
      return founder && !!state.autopilot?.canToggle && state.autopilot.on !== action.on;
    case "plan":
      return (
        action.actions.length > 0 &&
        action.actions.every((a) => actionEnabled({ type: "delegate", ...a }, state, facts))
      );
    case "open":
      return sectionOpen(action.section, facts);
    case "suggest":
      return true;
    case "marketing":
      return (
        founder &&
        Number.isInteger(action.cents) &&
        action.cents >= 0 &&
        (!known || action.cents !== facts.awareness.marketingPerQuarterCents)
      );
    case "strategy":
      if (!founder) return false;
      if (facts.price.lockedTo !== null && facts.price.lockedTo !== action.priceLevel) return false;
      return !known || action.priceLevel !== facts.price.level || action.contractWork !== facts.price.contractWork;
    case "campaign": {
      if (!founder) return false;
      if (!known) return true;
      const cost = state.company?.campaignCosts?.[action.kind];
      return facts.campaign.running === null && cost !== undefined && cost <= facts.cash.freeCents;
    }
    case "hireAi":
      if (!founder || !Number.isInteger(action.count) || action.count < 1) return false;
      if (!known) return true;
      if (action.skill && (action.count !== 1 || (state.company?.aiWorkerSkills ?? []).includes(action.skill)))
        return false;
      return action.count <= facts.team.freeSlots;
    case "dismissAi":
      return (
        founder && Number.isInteger(action.count) && action.count > 0 && (!known || action.count <= facts.ai.workers)
      );
    case "expand":
      return founder && facts.growth.canAffordExpansion;
    case "invest": {
      const item = state.listed?.items.find((i) => i.key === action.key);
      return (
        founder &&
        !!item &&
        item.missing.length === 0 &&
        item.readyAt === null &&
        item.cooldownUntil === null &&
        item.costCents <= (state.listed?.freeCashCents ?? 0)
      );
    }
    case "payTax": {
      const l = state.listed;
      return founder && !!l && l.taxes.dueCents > 0 && l.cashCents >= l.taxes.dueCents;
    }
    case "advisor":
      return founder && !!state.listed && state.listed.taxes.advisor !== action.hire;
  }
}

/** Only the options that work now; the first one left becomes the tip. */
export function enabledOptions(options: MiraOption[], state: MiraState, facts: CompanyFacts): MiraOption[] {
  const out = options.filter((o) => actionEnabled(o.action, state, facts));
  if (out[0] && out[0].tone !== "warn" && !out.some((o) => o.tone === "best")) out[0] = { ...out[0], tone: "best" };
  return out;
}

// ---- Helpers --------------------------------------------------------------------------------------------------------

const open = (section: CompanySection, names: MiraNames, hint?: MiraLine): MiraOption => ({
  ...describeAction({ type: "open", section }, {} as MiraState, names),
  hint,
});

const sector = (state: MiraState) => state.company?.sector ?? "tech";

/** Extra gross profit per hour from more demand (cents of normal-price revenue), capped by the free capacity. */
function extraGross(demandCents: number, facts: CompanyFacts, state: MiraState): number {
  if (!facts.demand) return 0;
  return Math.min(Math.max(0, demandCents), facts.demand.freeCapacityCents) * grossPerSoldCent(facts, sector(state));
}

const pct = (bps: number) => Math.round(bps / 100);

// ---- The rules ------------------------------------------------------------------------------------------------------

/** Every piece of advice that applies now, with its options already checked. Unranked. */
export function adviceList(state: MiraState, names: MiraNames, facts: CompanyFacts = companyFacts(state)): Advice[] {
  if (!facts.founder || !facts.known) return [];
  const f = facts;
  const out: Advice[] = [];
  const money = names.money;
  const push = (a: Advice) => {
    const options = enabledOptions(a.options, state, facts);
    if (options.length > 0) out.push({ ...a, options });
  };
  const qh = BALANCE.time.quarterHours;
  const health = state.health?.result ?? null;
  const factor = (key: string) => health?.factors.find((x) => x.key === key) ?? null;

  // 1. Open bills: the company is in distress; money first.
  if (f.cash.distress || f.cash.unpaidCents > 0) {
    push({
      rule: "distress",
      id: `advice:distress:${f.cash.distress}`,
      urgent: true,
      impactCents: f.cash.unpaidCents,
      lines: [{ key: "advice.distress", values: { unpaid: money(f.cash.unpaidCents) } }],
      options: [open("money", names, { key: "advice.why.deposit" })],
    });
  } else if (f.hour && f.hour.profitCents < 0 && f.cash.runwayHours !== null && f.cash.runwayHours < adv.runwayHours) {
    // 2. The cash runs out soon at this loss.
    push({
      rule: "runway",
      id: `advice:runway:${f.cash.runwayHours}`,
      urgent: true,
      impactCents: -f.hour.profitCents,
      lines: [{ key: "advice.runway", values: { hours: f.cash.runwayHours, loss: money(-f.hour.profitCents) } }],
      options: [open("money", names, { key: "advice.why.deposit" })],
    });
  }

  // 3. AI workers without work: they cost the standby share of their wage.
  if (
    f.ai.workers > 0 &&
    f.ai.utilizationBps !== null &&
    f.ai.utilizationBps < adv.aiIdleBelowBps &&
    f.ai.idle > 0 &&
    !f.demand?.soldOut
  ) {
    push({
      rule: "aiIdle",
      id: `advice:aiIdle:${f.ai.idle}`,
      urgent: false,
      impactCents: f.ai.idleSavingCents,
      lines: [
        {
          key: "advice.aiIdle",
          values: {
            idle: f.ai.idle,
            workers: f.ai.workers,
            util: pct(f.ai.utilizationBps),
            saving: money(f.ai.idleSavingCents),
          },
        },
      ],
      options: [
        {
          ...describeAction({ type: "dismissAi", count: f.ai.idle }, state, names),
          hint: { key: "advice.why.dismiss", values: { saving: money(f.ai.idleSavingCents) } },
        },
        open("marketing", names, { key: "advice.why.moreDemand" }),
      ],
    });
  }

  // 4. Marketing: what the hourly formula says a budget buys; nothing more at the stage's cap.
  const a = f.awareness;
  if (a.atCap && a.marketingPerQuarterCents > 0) {
    const saved = f.hour?.marketingCents ?? Math.round(a.marketingPerQuarterCents / qh);
    push({
      rule: "marketingWasted",
      id: `advice:marketingWasted:${a.capPoints}`,
      urgent: false,
      impactCents: saved,
      lines: [{ key: "advice.marketingWasted", values: { cap: a.capPoints, amount: money(saved) } }],
      options: [
        {
          ...describeAction({ type: "marketing", cents: 0 }, state, names),
          hint: { key: "advice.why.save", values: { amount: money(saved) } },
        },
        ...(f.team.missingSkills[0]
          ? [
              {
                ...describeAction({ type: "hireAi", count: 1, skill: f.team.missingSkills[0] }, state, names),
                hint: { key: "advice.why.nextStage" },
              },
            ]
          : []),
      ],
    });
  } else if (
    !a.atCap &&
    f.demand &&
    !f.demand.soldOut &&
    a.marketingPerQuarterCents < a.suggestedMarketingCents &&
    a.marketingGainSuggested > a.marketingGainNow
  ) {
    // Six hours of the extra points, as demand: demand grows in proportion to the awareness.
    const extraPoints = (a.marketingGainSuggested - a.marketingGainNow) * 6;
    const extraDemand = a.points > 0 ? (f.demand.demandCents * extraPoints) / a.points : 0;
    const cost = (a.suggestedMarketingCents - a.marketingPerQuarterCents) / qh;
    push({
      rule: "marketing",
      id: `advice:marketing:${a.marketingPerQuarterCents}`,
      urgent: false,
      impactCents: Math.round(extraGross(extraDemand, f, state) - cost),
      lines: [
        {
          key: a.marketingPerQuarterCents > 0 ? "advice.marketingMore" : "advice.marketing",
          values: {
            amount: money(a.suggestedMarketingCents),
            gain: a.marketingGainSuggested,
            now: a.marketingGainNow,
            perHour: money(Math.round(a.suggestedMarketingCents / qh)),
            awareness: a.points,
            cap: a.capPoints,
          },
        },
      ],
      options: [
        {
          ...describeAction({ type: "marketing", cents: a.suggestedMarketingCents }, state, names),
          hint: { key: "advice.why.marketing", values: { gain: a.marketingGainSuggested } },
        },
      ],
    });
  }

  // 5. Contract work turns free capacity into money.
  if (
    f.demand &&
    !f.price.contractWork &&
    f.demand.freeCapacityCents * 10_000 >= f.demand.capacityCents * adv.freeCapacityBps
  ) {
    const gain = Math.round(
      f.demand.freeCapacityCents * sc.contractWork.shareOfFreeCapacity * sc.contractWork.grossMargin,
    );
    push({
      rule: "contractWork",
      id: "advice:contractWork",
      urgent: false,
      impactCents: gain,
      lines: [
        {
          key: "advice.contract",
          values: { free: money(f.demand.freeCapacityCents), gain: money(gain), util: pct(f.demand.utilizationBps) },
        },
      ],
      options: [describeAction({ type: "strategy", priceLevel: f.price.level, contractWork: true }, state, names)],
    });
  }

  // 6. Price: premium below the quality customers expect costs demand and reputation; else the best level.
  if (f.price.level === "premium" && f.quality.points < f.quality.premiumMinPoints) {
    push({
      rule: "premiumLow",
      id: "advice:premiumLow",
      urgent: false,
      impactCents: Math.max(factor("price")?.impactCents ?? 0, adv.minImpactCents),
      lines: [
        {
          key: "advice.premiumLow",
          values: {
            quality: f.quality.points,
            needed: f.quality.premiumMinPoints,
            points: repCfg.premiumLowQualityLoss,
          },
        },
      ],
      options: [
        describeAction({ type: "strategy", priceLevel: "normal", contractWork: f.price.contractWork }, state, names),
      ],
    });
  } else {
    const p = factor("price");
    const lever = p?.levers.find((l) => l.kind === "price");
    if (p && lever?.kind === "price" && lever.level !== f.price.level && p.impactCents >= adv.minImpactCents) {
      push({
        rule: "price",
        id: `advice:price:${lever.level}`,
        urgent: false,
        impactCents: p.impactCents,
        lines: [{ key: "advice.price", values: { level: lever.level, gain: money(p.impactCents) } }],
        options: [
          describeAction(
            { type: "strategy", priceLevel: lever.level, contractWork: f.price.contractWork },
            state,
            names,
          ),
        ],
      });
    }
  }

  // 7. Sold out: more hands (AI workers, as many as there are places), else grow.
  if (f.demand?.soldOut) {
    const cap = factor("capacity");
    const hire = cap?.levers.find((l) => l.kind === "hireAi");
    const missing = f.demand.demandCents - f.demand.capacityCents;
    push({
      rule: "soldOut",
      id: `advice:soldOut:${f.team.freeSlots > 0}`,
      urgent: false,
      impactCents: cap?.impactCents ?? Math.round(missing * grossPerSoldCent(f, sector(state))),
      lines: [
        {
          key: f.team.freeSlots > 0 ? "advice.soldOut" : "advice.soldOutFull",
          values: { missing: money(missing), util: pct(f.demand.utilizationBps), wage: money(f.ai.wageCentsPerHour) },
        },
      ],
      options: [
        ...(hire?.kind === "hireAi"
          ? [
              describeAction(
                { type: "hireAi", count: Math.min(hire.count, f.team.freeSlots), skill: null },
                state,
                names,
              ),
            ]
          : []),
        ...(f.team.freeSlots > 0 && hire?.kind !== "hireAi"
          ? [describeAction({ type: "hireAi", count: 1, skill: null }, state, names)]
          : []),
        ...(f.growth.canAffordExpansion
          ? [
              {
                ...describeAction({ type: "expand" }, state, names),
                hint: { key: "advice.why.expand", values: { cost: money(f.growth.expansionCostCents ?? 0) } },
              },
            ]
          : []),
        ...(f.growth.canUpgrade ? [open("expansion", names, { key: "health.why.upgrade" })] : []),
      ],
    });
  }

  // 8. Campaign: more demand for a few hours while capacity is free; only when it pays.
  if (
    f.demand &&
    f.campaign.cheapest &&
    f.demand.freeCapacityCents * 10_000 >= f.demand.capacityCents * adv.freeCapacityBps
  ) {
    const kind = f.campaign.cheapest.kind;
    const spec = sc.campaigns.kinds[kind];
    const perHour = extraGross((f.demand.demandCents * spec.demandBps) / 10_000, f, state);
    const net = perHour * spec.hours - f.campaign.cheapest.costCents;
    if (net > 0)
      push({
        rule: "campaign",
        id: `advice:campaign:${kind}`,
        urgent: false,
        impactCents: Math.round(net / spec.hours),
        lines: [
          {
            key: "advice.campaign",
            values: {
              kind,
              cost: money(f.campaign.cheapest.costCents),
              hours: spec.hours,
              demand: pct(spec.demandBps),
              gain: money(Math.round(perHour)),
              points: Math.round(spec.awareness * 100),
            },
          },
        ],
        options: [describeAction({ type: "campaign", kind }, state, names)],
      });
  }

  // 9. Grow: expansion when the places or the capacity run out and the cash allows.
  if (f.growth.canAffordExpansion && f.hour && f.hour.profitCents > 0 && f.demand && f.demand.utilizationBps >= 9_000) {
    const extraCap = f.demand.capacityCents * sc.expansion.capacityBonusPerLevel;
    const gain =
      Math.min(extraCap, Math.max(0, f.demand.demandCents - f.demand.capacityCents)) *
      grossPerSoldCent(f, sector(state));
    push({
      rule: "expand",
      id: `advice:expand:${state.company?.expansionLevel ?? 0}`,
      urgent: false,
      impactCents: Math.round(gain),
      lines: [
        {
          key: "advice.expand",
          values: { cost: money(f.growth.expansionCostCents ?? 0), util: pct(f.demand.utilizationBps) },
        },
      ],
      options: [describeAction({ type: "expand" }, state, names)],
    });
  }
  if (f.growth.canUpgrade && f.hour && f.hour.profitCents > 0) {
    push({
      rule: "upgrade",
      id: "advice:upgrade",
      urgent: false,
      impactCents: 0,
      lines: [{ key: "advice.upgrade", values: { cost: money(f.growth.upgradeCostCents ?? 0) } }],
      options: [open("expansion", names, { key: "health.why.upgrade" })],
    });
  }

  // 10. Autopilot: open tasks get done even while nobody plays (ADR-180).
  if (f.autopilot && !f.autopilot.on && f.autopilot.canToggle && f.tasks.open > 0) {
    const value = (f.tasks.openValueCents * Math.min(10_000, f.autopilot.chanceBps) * f.autopilot.rewardBps) / 1e8;
    push({
      rule: "autopilot",
      id: `advice:autopilot:${f.tasks.open}`,
      urgent: false,
      impactCents: Math.round(value),
      lines: [
        {
          key: "advice.autopilot",
          values: {
            open: f.tasks.open,
            chance: pct(f.autopilot.chanceBps),
            reward: pct(f.autopilot.rewardBps),
            value: money(Math.round(value)),
          },
        },
      ],
      options: [describeAction({ type: "autopilot", on: true }, state, names)],
    });
  }

  // 11. Reputation: the driver that takes the most, and what fixes it.
  const r = f.reputation;
  if (r && r.worst && (r.value < adv.reputationLow || r.target < r.value - 1)) {
    const lost = (f.demand?.demandCents ?? 0) * repCfg.demandMaxEffect * (-r.worst.points / 50);
    push({
      rule: "reputation",
      id: `advice:reputation:${r.worst.key}`,
      urgent: false,
      impactCents: Math.round(extraGross(lost, f, state)),
      lines: [
        {
          key: "advice.reputation",
          values: {
            value: r.value,
            target: r.target,
            driver: r.worst.key,
            points: Math.abs(r.worst.points),
            demand: pct(Math.abs(r.demandEffectBps)),
            sign: r.demandEffectBps >= 0 ? "plus" : "minus",
          },
        },
      ],
      options: reputationFix(r.worst.key, state, names, f),
    });
  }

  // 12. Strengths: the next reward step when it is close.
  const s = f.strengths;
  if (s && s.next && s.next.at - s.overall <= adv.strengthsNearPoints && f.hour) {
    const gain = Math.round((f.hour.revenueCents * (s.next.bps - s.rewardBps)) / 10_000);
    push({
      rule: "strengths",
      id: `advice:strengths:${s.next.at}`,
      urgent: false,
      impactCents: gain,
      lines: [
        {
          key: "advice.strengths",
          values: {
            overall: Math.floor(s.overall),
            at: s.next.at,
            bonus: pct(s.next.bps),
            gain: money(gain),
            weakest: s.weakest,
          },
        },
      ],
      options: strengthFix(s.weakest, state, names, f),
    });
  }

  // 13. The next stage needs a skill nobody covers.
  const skill = f.team.missingSkills[0];
  const team = factor("team");
  if (skill && f.team.freeSlots > 0 && (team?.impactCents ?? 0) >= adv.minImpactCents) {
    push({
      rule: "skill",
      id: `advice:skill:${skill}`,
      urgent: false,
      impactCents: team?.impactCents ?? 0,
      lines: [
        {
          key: "advice.skill",
          values: {
            skill: names.health?.skill(skill) ?? skill,
            count: f.team.missingSkills.length,
            gain: money(team?.impactCents ?? 0),
          },
        },
      ],
      options: [
        describeAction({ type: "hireAi", count: 1, skill }, state, names),
        open("training", names, { key: "health.why.train" }),
      ],
    });
  }

  // 14. A CEO interview waits (ADR-173): awareness and reputation, if it goes well.
  if (f.interview) {
    push({
      rule: "interview",
      id: `advice:interview:${f.interview.expiresAt}`,
      urgent: false,
      impactCents: adv.minImpactCents,
      lines: [
        {
          key: "advice.interview",
          values: { minutes: Math.max(1, Math.round((Date.parse(f.interview.expiresAt) - f.now) / 60_000)) },
        },
      ],
      options: [open("interview", names)],
    });
  }

  // 14b. A Fertigkeit can be learned now (ADR-194): the skill is held and the cash is there.
  if (f.founder && f.skills?.learnable) {
    push({
      rule: "companySkills",
      id: `advice:companySkills:${f.skills.learnable.key}:${f.skills.levels}`,
      urgent: false,
      impactCents: 0,
      lines: [
        {
          key: "advice.companySkills",
          values: {
            skill: names.companySkill?.(f.skills.learnable.key) ?? f.skills.learnable.key,
            amount: money(f.skills.learnable.costCents),
          },
        },
      ],
      options: [open("skills", names)],
    });
  }

  // 15. Going public, once possible.
  if (f.growth.canGoPublic || f.growth.subscription) {
    push({
      rule: "ipo",
      id: `advice:ipo:${f.growth.subscription}`,
      urgent: false,
      impactCents: 0,
      lines: [{ key: f.growth.subscription ? "advice.subscription" : "advice.ipo" }],
      options: [open("capital", names)],
    });
  }

  // 16. A loss: what it consists of, with the best fixes found above.
  if (f.hour && f.hour.profitCents < 0) {
    const biggest = biggestCost(f);
    push({
      rule: "loss",
      id: `advice:loss:${biggest.item}`,
      urgent: false,
      impactCents: -f.hour.profitCents,
      lines: [
        {
          key: "advice.loss",
          values: { loss: money(-f.hour.profitCents), item: biggest.item, amount: money(biggest.cents) },
        },
      ],
      options: out
        .filter((x) => !x.urgent && x.impactCents > 0)
        .sort((x, y) => y.impactCents - x.impactCents)
        .slice(0, 2)
        .map((x) => x.options[0]!),
    });
  }
  return out;
}

/** The largest cost of the last hour. */
export function biggestCost(f: CompanyFacts): { item: "goods" | "ai" | "fixed" | "marketing"; cents: number } {
  const h = f.hour!;
  const items = [
    { item: "goods" as const, cents: h.goodsAndWagesCents },
    { item: "ai" as const, cents: h.aiWagesCents },
    { item: "fixed" as const, cents: h.fixedCents },
    { item: "marketing" as const, cents: h.marketingCents },
  ];
  return items.sort((a, b) => b.cents - a.cents)[0]!;
}

/** What lifts a reputation driver. */
function reputationFix(driver: string, state: MiraState, names: MiraNames, f: CompanyFacts): MiraOption[] {
  switch (driver) {
    case "quality":
      return [
        ...(f.team.missingSkills[0]
          ? [describeAction({ type: "hireAi", count: 1, skill: f.team.missingSkills[0] }, state, names)]
          : []),
        open("training", names, { key: "health.why.train" }),
        ...healthSteps("quality", state, names),
      ];
    case "delivery":
      return [
        describeAction({ type: "hireAi", count: 1, skill: null }, state, names),
        ...(f.growth.canAffordExpansion ? [describeAction({ type: "expand" }, state, names)] : []),
      ];
    case "price":
      return [
        describeAction({ type: "strategy", priceLevel: "normal", contractWork: f.price.contractWork }, state, names),
      ];
    case "wages":
    case "bills":
      return [open("money", names, { key: "advice.why.deposit" })];
    case "crisis":
    case "scandal":
      return [
        { action: { type: "compose", kind: "event" }, label: { key: "options.writeStrategy" } },
        open("situation", names),
      ];
    case "greed":
    case "dividends":
      return [open("dividends", names)];
    default:
      return f.campaign.cheapest
        ? [describeAction({ type: "campaign", kind: f.campaign.cheapest.kind }, state, names)]
        : [];
  }
}

/** What lifts a strength (ADR-176). */
function strengthFix(key: string, state: MiraState, names: MiraNames, f: CompanyFacts): MiraOption[] {
  switch (key) {
    case "awareness":
      return [
        describeAction({ type: "marketing", cents: f.awareness.suggestedMarketingCents }, state, names),
        ...(f.campaign.cheapest
          ? [describeAction({ type: "campaign", kind: f.campaign.cheapest.kind }, state, names)]
          : []),
      ];
    case "quality":
      return reputationFix("quality", state, names, f);
    case "delivery":
      return reputationFix("delivery", state, names, f);
    // Margin is profit per revenue; the team score is the share of the wages the hour could pay: both need costs
    // down or gross up.
    case "margin":
    case "team":
      return [
        ...(f.ai.idle > 0 ? [describeAction({ type: "dismissAi", count: f.ai.idle }, state, names)] : []),
        ...(f.awareness.atCap && f.awareness.marketingPerQuarterCents > 0
          ? [describeAction({ type: "marketing", cents: 0 }, state, names)]
          : []),
        open("profit", names),
      ];
    // Finance: cash for a day of costs, no open bills.
    default:
      return [open("money", names)];
  }
}

/** Urgent first, then by money per hour. */
export function rankAdvice(list: Advice[]): Advice[] {
  return [...list].sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.impactCents - a.impactCents);
}

/** The advice Mira posts on her own: every alarm and the best few worth a briefing. */
export function adviceTurns(state: MiraState, names: MiraNames, facts: CompanyFacts = companyFacts(state)): MiraTurn[] {
  const ranked = rankAdvice(adviceList(state, names, facts));
  const urgent = ranked.filter((a) => a.urgent);
  const rest = ranked
    .filter((a) => !a.urgent && a.rule !== "loss" && a.impactCents >= adv.minImpactCents)
    .slice(0, adv.briefings);
  return [...urgent, ...rest].map((a) => ({ id: a.id, lines: a.lines, options: a.options }));
}

// ---- Answers --------------------------------------------------------------------------------------------------------

const turnId = (kind: string, state: MiraState) => `${kind}:${state.now}`;

/** "Was soll ich tun?": the best steps now, each with what it brings. */
export function nextTurn(state: MiraState, names: MiraNames): MiraTurn {
  const facts = companyFacts(state);
  const id = turnId("next", state);
  if (!facts.founder) return { id, lines: [{ key: "next.employee" }], options: taskOptions(state, names, facts) };
  const ranked = rankAdvice(adviceList(state, names, facts))
    .filter((a) => a.rule !== "loss")
    .slice(0, adv.nextSteps);
  const tasks = taskOptions(state, names, facts);
  const moves = state.moves ? suggestMoves(state.moves, state.now) : [];
  if (ranked.length === 0 && tasks.length === 0 && moves.length === 0)
    return { id, lines: [{ key: "next.none" }], options: [] };
  const lines: MiraLine[] = [{ key: "next.intro" }];
  ranked.forEach((a, i) => lines.push({ key: "next.item", values: { n: i + 1 } }, a.lines[0]!));
  const options = ranked.map((a) => ({ ...a.options[0]!, tone: undefined }) as MiraOption);
  if (tasks[0]) {
    lines.push({ key: "next.tasks", values: { count: facts.tasks.actionable } });
    options.push(tasks[0]);
  }
  if (moves[0] && options.length < adv.nextSteps + 1)
    options.push(describeAction({ type: "move", key: moves[0].key }, state, names));
  return { id, lines, options: enabledOptions(options, state, facts) };
}

function taskOptions(state: MiraState, names: MiraNames, facts: CompanyFacts): MiraOption[] {
  const plan = planTasks(state);
  const mine =
    state.tasks.tasks.find((t) => t.mine && t.status === "assigned") ??
    state.tasks.tasks.find((t) => t.status === "open");
  return enabledOptions(
    [
      ...(plan.length > 0 ? [describeAction({ type: "plan", actions: plan }, state, names)] : []),
      ...(mine ? [describeAction({ type: "play", taskId: mine.id }, state, names)] : []),
    ],
    state,
    facts,
  );
}

/** "Warum mache ich Verlust?": the hour in numbers, the biggest cost, the reasons and the best fixes. */
export function profitTurn(state: MiraState, names: MiraNames): MiraTurn {
  const f = companyFacts(state);
  const id = turnId("profit", state);
  if (!f.founder) return { id, lines: [{ key: "health.founderOnly" }], options: [] };
  if (!f.hour) return { id, lines: [{ key: "profit.noHour" }], options: [] };
  const money = names.money;
  const h = f.hour;
  const lines: MiraLine[] = [
    {
      key: h.profitCents < 0 ? "profit.loss" : "profit.gain",
      values: { revenue: money(h.revenueCents), costs: money(h.costsCents), profit: money(Math.abs(h.profitCents)) },
    },
    {
      key: "profit.costs",
      values: {
        goods: money(h.goodsAndWagesCents),
        ai: money(h.aiWagesCents),
        fixed: money(h.fixedCents),
        marketing: money(h.marketingCents),
      },
    },
  ];
  const biggest = biggestCost(f);
  lines.push({ key: "profit.biggest", values: { item: biggest.item, amount: money(biggest.cents) } });
  // The reasons, from the same numbers the page shows.
  if (f.demand && f.demand.utilizationBps < 5_000)
    lines.push({
      key: "profit.lowDemand",
      values: {
        util: pct(f.demand.utilizationBps),
        demand: money(f.demand.demandCents),
        capacity: money(f.demand.capacityCents),
      },
    });
  if (f.demand?.soldOut)
    lines.push({ key: "profit.soldOut", values: { missing: money(f.demand.demandCents - f.demand.capacityCents) } });
  if (f.ai.idle > 0 && f.ai.utilizationBps !== null)
    lines.push({
      key: "profit.aiIdle",
      values: { idle: f.ai.idle, util: pct(f.ai.utilizationBps), saving: money(f.ai.idleSavingCents) },
    });
  if (f.awareness.atCap && h.marketingCents > 0)
    lines.push({ key: "profit.marketingWasted", values: { amount: money(h.marketingCents) } });
  if (h.payFactorBps < 10_000) lines.push({ key: "profit.unpaid", values: { paid: pct(h.payFactorBps) } });
  if (f.hour.fixedCents > Math.max(0, h.revenueCents - h.goodsAndWagesCents))
    lines.push({ key: "profit.fixedHigh", values: { fixed: money(h.fixedCents) } });
  if (f.day.hours > 1)
    lines.push({
      key: "profit.day",
      values: {
        hours: f.day.hours,
        revenue: money(f.day.revenueCents),
        profit: money(f.day.profitCents),
        loss: f.day.lossHours,
      },
    });
  const fixes = rankAdvice(adviceList(state, names, f))
    .filter((a) => a.rule !== "loss" && (a.urgent || a.impactCents > 0))
    .slice(0, 3);
  lines.push({ key: fixes.length > 0 ? "profit.fixes" : "profit.noFixes" });
  return { id, lines, options: fixes.map((a) => ({ ...a.options[0]!, hint: a.options[0]!.hint ?? a.lines[0] })) };
}

/** "Wie mache ich mehr Umsatz?": demand or capacity is the limit, and what moves it. */
export function revenueTurn(state: MiraState, names: MiraNames): MiraTurn {
  const f = companyFacts(state);
  const id = turnId("revenue", state);
  if (!f.founder) return { id, lines: [{ key: "health.founderOnly" }], options: [] };
  if (!f.demand) return { id, lines: [{ key: "profit.noHour" }], options: [] };
  const money = names.money;
  const revenueRules: AdviceRule[] = [
    "marketing",
    "campaign",
    "price",
    "premiumLow",
    "contractWork",
    "soldOut",
    "expand",
    "reputation",
    "strengths",
    "autopilot",
  ];
  const picks = rankAdvice(adviceList(state, names, f))
    .filter((a) => revenueRules.includes(a.rule))
    .slice(0, 3);
  const moves = state.moves ? suggestMoves(state.moves, state.now).filter((m) => m.kind === "cash") : [];
  return {
    id,
    lines: [
      {
        key: f.demand.soldOut ? "revenue.capacity" : "revenue.demand",
        values: {
          demand: money(f.demand.demandCents),
          capacity: money(f.demand.capacityCents),
          util: pct(f.demand.utilizationBps),
        },
      },
      ...picks.map((a) => a.lines[0]!),
      { key: picks.length > 0 || moves.length > 0 ? "revenue.steps" : "revenue.none" },
    ],
    options: enabledOptions(
      [
        ...picks.map((a) => a.options[0]!),
        ...moves.slice(0, 1).map((m) => describeAction({ type: "move", key: m.key }, state, names)),
      ],
      state,
      f,
    ),
  };
}

/** "Was bringt der Ruf?": what it does, where it stands and why, what lifts it. */
export function reputationTurn(state: MiraState, names: MiraNames): MiraTurn {
  const f = companyFacts(state);
  const id = turnId("reputation", state);
  const max = Math.round(repCfg.demandMaxEffect * 100);
  const lines: MiraLine[] = [{ key: "rep.what", values: { max, base: repCfg.base } }];
  const r = f.reputation;
  if (!r) return { id, lines: [...lines, { key: "rep.none" }], options: [] };
  lines.push({
    key: "rep.now",
    values: {
      value: r.value,
      target: r.target,
      demand: pct(Math.abs(r.demandEffectBps)),
      sign: r.demandEffectBps >= 0 ? "plus" : "minus",
    },
  });
  const drivers = Object.entries(r.drivers)
    .filter(([k, v]) => k !== "base" && Math.abs(v) >= 0.5)
    .sort((a, b) => a[1] - b[1]);
  for (const [driver, points] of drivers.slice(0, 4))
    lines.push({
      key: points < 0 ? "rep.driverMinus" : "rep.driverPlus",
      values: { driver, points: Math.round(Math.abs(points) * 10) / 10 },
    });
  if (drivers.length === 0) lines.push({ key: "rep.neutral" });
  const options = f.founder && r.worst ? enabledOptions(reputationFix(r.worst.key, state, names, f), state, f) : [];
  lines.push({ key: options.length > 0 ? "rep.fix" : "rep.keep" });
  return { id, lines, options };
}

/** "Was bringen die Stärken?": the reward, the next step and the weakest strength. */
export function strengthsTurn(state: MiraState, names: MiraNames): MiraTurn {
  const f = companyFacts(state);
  const id = turnId("strengths", state);
  const s = f.strengths;
  if (!s) return { id, lines: [{ key: "str.none" }], options: [] };
  const lines: MiraLine[] = [
    { key: "str.now", values: { overall: Math.floor(s.overall), bonus: pct(s.rewardBps) } },
    s.next
      ? {
          key: "str.next",
          values: { at: s.next.at, bonus: pct(s.next.bps), missing: Math.max(1, Math.ceil(s.next.at - s.overall)) },
        }
      : { key: "str.top" },
    { key: "str.weakest", values: { key: s.weakest, score: Math.floor(s.scores[s.weakest] ?? 0) } },
    { key: "str.how" },
  ];
  const options = f.founder ? enabledOptions(strengthFix(s.weakest, state, names, f), state, f) : [];
  return { id, lines, options };
}

/** "Wie läuft der Autopilot?": state, chance, today, one switch. */
export function autopilotTurn(state: MiraState, names: MiraNames): MiraTurn {
  const f = companyFacts(state);
  const id = turnId("autopilot", state);
  const ap = f.autopilot;
  if (!ap) return { id, lines: [{ key: "auto.none" }], options: [] };
  return {
    id,
    lines: [
      {
        key: ap.on ? "auto.on" : "auto.off",
        values: {
          chance: pct(Math.min(10_000, ap.chanceBps)),
          bonus: pct(Math.max(0, ap.chanceBps - 10_000)),
          reward: pct(ap.rewardBps),
          done: ap.doneToday,
        },
      },
      { key: "auto.how" },
    ],
    options: enabledOptions([describeAction({ type: "autopilot", on: !ap.on }, state, names)], state, f),
  };
}

/** "Lohnen sich meine KI-Kräfte?": utilisation, idle ones, what dismissing saves or hiring brings. */
export function aiTurn(state: MiraState, names: MiraNames): MiraTurn {
  const f = companyFacts(state);
  const id = turnId("ai", state);
  if (!f.founder) return { id, lines: [{ key: "health.founderOnly" }], options: [] };
  const money = names.money;
  const lines: MiraLine[] = [
    { key: "ai.how", values: { wage: money(f.ai.wageCentsPerHour), standby: pct(sc.aiWorkerStandbyBps) } },
  ];
  if (f.ai.workers === 0) lines.push({ key: "ai.none", values: { free: f.team.freeSlots } });
  else if (f.ai.utilizationBps === null) lines.push({ key: "ai.noData", values: { workers: f.ai.workers } });
  else
    lines.push({
      key: "ai.state",
      values: {
        workers: f.ai.workers,
        util: pct(f.ai.utilizationBps),
        idle: f.ai.idle,
        saving: money(f.ai.idleSavingCents),
      },
    });
  const list = adviceList(state, names, f).filter((a) => a.rule === "aiIdle" || a.rule === "soldOut");
  if (list.length === 0) lines.push({ key: "ai.fits" });
  return { id, lines, options: list.flatMap((a) => a.options.slice(0, 1)) };
}

/** The Lagebericht: the company in a few lines, then the best step. */
export function reportLines(state: MiraState, names: MiraNames, f: CompanyFacts = companyFacts(state)): MiraLine[] {
  if (!f.known) return [];
  const money = names.money;
  const lines: MiraLine[] = [{ key: "report.title", values: { company: f.name } }];
  lines.push({
    key: f.cash.unpaidCents > 0 ? "report.cashUnpaid" : "report.cash",
    values: { cash: money(f.cash.cashCents), free: money(f.cash.freeCents), unpaid: money(f.cash.unpaidCents) },
  });
  if (f.hour)
    lines.push({
      key: f.hour.profitCents < 0 ? "report.hourLoss" : "report.hour",
      values: {
        revenue: money(f.hour.revenueCents),
        costs: money(f.hour.costsCents),
        profit: money(Math.abs(f.hour.profitCents)),
      },
    });
  else lines.push({ key: "report.noHour" });
  if (f.day.hours > 1)
    lines.push({
      key: "report.day",
      values: { hours: f.day.hours, revenue: money(f.day.revenueCents), profit: money(f.day.profitCents) },
    });
  if (f.demand)
    lines.push({
      key: f.demand.soldOut ? "report.soldOut" : "report.demand",
      values: {
        demand: money(f.demand.demandCents),
        capacity: money(f.demand.capacityCents),
        util: pct(f.demand.utilizationBps),
      },
    });
  if (f.ai.workers > 0 && f.ai.utilizationBps !== null)
    lines.push({ key: "report.ai", values: { workers: f.ai.workers, util: pct(f.ai.utilizationBps) } });
  lines.push({
    key: f.awareness.change ? "report.awareness" : "report.awarenessFlat",
    values: {
      points: f.awareness.points,
      cap: f.awareness.capPoints,
      change: Math.abs(f.awareness.change?.total ?? 0),
      sign: (f.awareness.change?.total ?? 0) >= 0 ? "plus" : "minus",
    },
  });
  if (f.reputation)
    lines.push({
      key: "report.reputation",
      values: {
        value: f.reputation.value,
        target: f.reputation.target,
        demand: pct(Math.abs(f.reputation.demandEffectBps)),
        sign: f.reputation.demandEffectBps >= 0 ? "plus" : "minus",
      },
    });
  if (f.strengths)
    lines.push({
      key: "report.strengths",
      values: { overall: Math.floor(f.strengths.overall), bonus: pct(f.strengths.rewardBps) },
    });
  if (f.listed)
    lines.push({
      key: "report.listed",
      values: { mood: f.listed.satisfaction, zone: f.listed.zone, tax: money(f.listed.taxDueCents) },
    });
  if (f.autopilot)
    lines.push({
      key: f.autopilot.on ? "report.autopilotOn" : "report.autopilotOff",
      values: { done: f.autopilot.doneToday },
    });
  if (f.tasks.open > 0 || f.event)
    lines.push({ key: "report.todo", values: { tasks: f.tasks.open, event: f.event ? f.event.polarity : "none" } });
  return lines;
}

export function reportTurn(state: MiraState, names: MiraNames): MiraTurn {
  const f = companyFacts(state);
  const id = turnId("report", state);
  if (!f.founder || !f.known) return { id, lines: [{ key: "health.founderOnly" }], options: [] };
  const top = rankAdvice(adviceList(state, names, f))
    .filter((a) => a.rule !== "loss")
    .slice(0, 2);
  return {
    id,
    lines: [
      ...reportLines(state, names, f),
      ...(top[0] ? [{ key: "report.best" }, top[0].lines[0]!] : [{ key: "report.calm" }]),
    ],
    options: top.map((a) => a.options[0]!),
  };
}
