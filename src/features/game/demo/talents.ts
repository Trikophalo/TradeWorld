import { BALANCE } from "@/config/balance";
import { TALENT_POOL, type TalentSeed } from "@/config/talents";
import {
  talentCoCeoEligible,
  talentOfferAccepted,
  talentOfferChecks,
  talentOfferCost,
  talentWageFloor,
  talentsEffectBps,
} from "@/lib/sim/talents";
import {
  GameError,
  type CompanyTalentsState,
  type GameEngine,
  type OrgTalent,
  type OwnTalent,
  type Talent,
  type TalentFacts,
} from "../types";

/*
 * Talente in the offline demo (ADR-199): the same pool, checks and prices as the server. The demo is single-player,
 * so nobody poaches; a few talents are shown as employed at fictional companies. Wages, satisfaction, quitting and
 * the Mit-GF decisions run on the server only.
 */
export interface DemoTalentContract {
  wageCents: number;
  benefits: string[];
  hiredAt: number;
  coCeo?: { autonomy: "advise" | "decide"; budgetCents: number };
}
export type DemoTalents = Record<string, DemoTalentContract>;

export interface TalentsHost {
  company(): {
    cashCents: number;
    reputation?: number;
    awareness: number;
    tier: string;
    expansionLevel?: number;
  } | null;
  state(): DemoTalents;
  setState(next: DemoTalents): void;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
}

const cfg = BALANCE.talents;
const FORMS = ["garage", "small_business", "gmbh", "ag"];
const RIVALS = ["Nordlicht Werke", "Kranich & Söhne", "Brückner Labs"];

/** A fixed demo rotation: every seventh talent works elsewhere, every fifth free one is not on the market today. */
function demoStatus(index: number, mine: boolean): Talent["status"] {
  if (mine) return "mine";
  if (index % 7 === 3) return "employed";
  return index % 5 === 1 ? "off_market" : "available";
}

function toTalent(seed: TalentSeed, index: number, mine: boolean): Talent {
  const status = demoStatus(index, mine);
  const employed = status === "employed";
  return {
    key: seed.key,
    role: seed.role,
    tier: seed.tier,
    firstName: seed.firstName,
    lastName: seed.lastName,
    avatar: seed.avatar,
    traits: [...seed.traits],
    wageDemandCents: seed.wageCents,
    benefitDemands: [...seed.benefits],
    minReputation: seed.minReputation,
    minAwarenessBps: seed.minAwarenessBps,
    minForm: seed.minForm,
    effectBps: seed.effectBps,
    status,
    employer: employed ? { companyId: `demo-${index % 3}`, name: RIVALS[index % 3]! } : null,
    poachMinCostCents: employed ? Math.ceil((seed.wageCents * (10_000 + cfg.poach.marginBps)) / 10_000) : null,
    offerPending: false,
    restingUntil: null,
    isCoCeo: false,
  };
}

export function createTalentsEngine(
  host: TalentsHost,
): Pick<
  GameEngine,
  | "talentMarket"
  | "companyTalents"
  | "offerTalent"
  | "counterTalentOffer"
  | "dismissTalent"
  | "raiseTalent"
  | "appointCoCeo"
  | "setCoCeo"
  | "undoTalentDecision"
> {
  const facts = (): TalentFacts => {
    const c = host.company();
    if (!c) throw new GameError("company_not_found");
    return {
      reputation: c.reputation ?? 50,
      awarenessBps: Math.round(c.awareness * 10_000),
      formRank: Math.max(0, FORMS.indexOf(c.tier)),
      expansionLevel: c.expansionLevel ?? 0,
      freeCashCents: Math.max(0, c.cashCents),
    };
  };

  const view = (): CompanyTalentsState => {
    const f = facts();
    const st = host.state();
    const seats = cfg.roles.map((role) => {
      const index = TALENT_POOL.findIndex((t) => t.role === role.key && st[t.key]);
      const seed = index >= 0 ? TALENT_POOL[index]! : null;
      const c = seed ? st[seed.key]! : null;
      const talent: OwnTalent | null =
        seed && c
          ? {
              ...toTalent(seed, index, true),
              isCoCeo: Boolean(c.coCeo),
              wageCents: c.wageCents,
              benefits: c.benefits,
              costCents: talentOfferCost(c.wageCents, c.benefits),
              hiredAt: new Date(c.hiredAt).toISOString(),
              satisfactionBps: cfg.satisfaction.startBps,
              warned: false,
              coCeoAutonomy: c.coCeo?.autonomy ?? "advise",
              coCeoBudgetCents: c.coCeo?.budgetCents ?? 0,
              coCeoSpentCents: 0,
              wageFloorCents: talentWageFloor(seed.wageCents, Boolean(c.coCeo)),
              // the demo has no satisfaction: a risen demand always shows the full grace period
              raiseDueAt:
                c.wageCents < talentWageFloor(seed.wageCents, Boolean(c.coCeo))
                  ? new Date(host.now() + cfg.raiseGraceHours * 3_600_000).toISOString()
                  : null,
            }
          : null;
      return { role: role.key, effect: role.effect, talent };
    });
    const bps = talentsEffectBps(
      seats.flatMap((s) => (s.talent ? [{ role: s.role, effectBps: s.talent.effectBps }] : [])),
    );
    return {
      facts: f,
      seats,
      effectBps: bps,
      capBps: { ...cfg.capBps },
      coCeoMax: cfg.coCeo.max,
      incoming: [],
      outgoing: [],
      events: [],
    };
  };

  const mutate = (requestId: string, run: (st: DemoTalents) => void): Promise<CompanyTalentsState> =>
    Promise.resolve(
      host.idempotent(requestId, () => {
        const st = { ...host.state() };
        run(st);
        host.setState(st);
        return view();
      }),
    );

  return {
    async talentMarket(role) {
      const company = host.company();
      const st = host.state();
      return {
        facts: company ? facts() : null,
        talents: TALENT_POOL.flatMap((t, i) => (role && t.role !== role ? [] : [toTalent(t, i, Boolean(st[t.key]))])),
      };
    },
    async companyTalents() {
      return view();
    },
    offerTalent(requestId, key, wageCents, benefits) {
      return mutate(requestId, (st) => {
        const index = TALENT_POOL.findIndex((t) => t.key === key);
        const seed = TALENT_POOL[index];
        if (!seed || wageCents <= 0 || wageCents % 100 !== 0) throw new GameError("invalid_argument");
        if (st[key]) throw new GameError("already_hired");
        if (TALENT_POOL.some((t) => t.role === seed.role && st[t.key])) throw new GameError("seat_taken");
        const status = demoStatus(index, false);
        if (status === "employed") throw new GameError("offer_too_low");
        if (status !== "available") throw new GameError("not_available");
        if (!talentOfferAccepted(talentOfferChecks(seed, { wageCents, benefits }, facts())))
          throw new GameError("demands_not_met");
        st[key] = { wageCents, benefits: [...new Set(benefits)].sort(), hiredAt: host.now() };
      });
    },
    counterTalentOffer() {
      return Promise.reject(new GameError("offer_closed"));
    },
    dismissTalent(requestId, key) {
      return mutate(requestId, (st) => {
        if (!st[key]) throw new GameError("invalid_argument");
        delete st[key];
      });
    },
    raiseTalent(requestId, key, wageCents, benefits) {
      return mutate(requestId, (st) => {
        const seed = TALENT_POOL.find((t) => t.key === key);
        const c = st[key];
        if (!seed || !c || wageCents <= 0 || wageCents % 100 !== 0) throw new GameError("invalid_argument");
        const next = [...new Set(c.coCeo ? [...benefits, "say"] : benefits)].sort();
        if (wageCents < talentWageFloor(seed.wageCents, Boolean(c.coCeo))) throw new GameError("demands_not_met");
        if (!seed.benefits.every((b) => next.includes(b))) throw new GameError("demands_not_met");
        if (next.includes("office") && !c.benefits.includes("office") && facts().expansionLevel < 1)
          throw new GameError("demands_not_met");
        st[key] = { ...c, wageCents, benefits: next };
      });
    },
    appointCoCeo(requestId, key, wageCents, autonomy, budgetCents) {
      return mutate(requestId, (st) => {
        const seed = TALENT_POOL.find((t) => t.key === key);
        const c = st[key];
        if (!seed || !c || c.coCeo || budgetCents < 0 || budgetCents > cfg.coCeo.maxBudgetCents)
          throw new GameError("invalid_argument");
        if (!talentCoCeoEligible(seed)) throw new GameError("not_eligible");
        if (Object.values(st).filter((x) => x.coCeo).length >= cfg.coCeo.max) throw new GameError("coceo_full");
        const min = Math.ceil((seed.wageCents * (10_000 + cfg.coCeo.wageBonusBps)) / 10_000 / 100) * 100;
        if (wageCents < Math.max(min, c.wageCents)) throw new GameError("offer_too_low");
        st[key] = {
          ...c,
          wageCents,
          benefits: [...new Set([...c.benefits, "say"])].sort(),
          coCeo: { autonomy, budgetCents },
        };
      });
    },
    setCoCeo(requestId, key, autonomy, budgetCents, remove) {
      return mutate(requestId, (st) => {
        const c = st[key];
        if (!c?.coCeo) throw new GameError("invalid_argument");
        st[key] = remove ? { ...c, coCeo: undefined } : { ...c, coCeo: { autonomy, budgetCents } };
      });
    },
    undoTalentDecision() {
      return Promise.reject(new GameError("invalid_argument"));
    },
  };
}

/** The hired demo talents for the org chart (ADR-199): co-CEOs first, then by tier and Stelle like the server. */
export function demoOrgTalents(state: DemoTalents): OrgTalent[] {
  return TALENT_POOL.filter((t) => state[t.key])
    .map((t) => ({
      key: t.key,
      firstName: t.firstName,
      lastName: t.lastName,
      avatarKey: t.avatar,
      role: t.role,
      tier: t.tier,
      isCoCeo: Boolean(state[t.key]!.coCeo),
      since: new Date(state[t.key]!.hiredAt).toISOString(),
    }))
    .sort(
      (a, b) =>
        Number(b.isCoCeo) - Number(a.isCoCeo) ||
        b.tier - a.tier ||
        a.role.localeCompare(b.role) ||
        a.key.localeCompare(b.key),
    );
}
