/*
 * Talente (ADR-199): named, game-generated specialists for the 15 Stellen of a player company. Not real players and
 * not AI workers: each talent is unique, has a personality (two traits), a quality tier and demands. A filled Stelle
 * adds a capped term to the hourly close; the wage and the benefits are a real hourly cost.
 *
 * The pool is generated deterministically here (no Math.random, a fixed LCG seed) and goes to game_config "talents"
 * with `pnpm db:config`; SQL reads the same pool (talents_ensure). Keys never change once shipped: append only.
 * Names and texts of roles, traits and benefits live in messages/de.json under "talents".
 * Pure data and pure functions, no imports (runs in Deno).
 */

export const TALENT_EFFECTS = [
  "demand",
  "capacity",
  "cogs",
  "fixed",
  "quality",
  "awareness",
  "reputation",
  "morale",
] as const;
export type TalentEffect = (typeof TALENT_EFFECTS)[number];

export interface TalentRoleConfig {
  readonly key: string;
  readonly effect: TalentEffect;
  /** Effect of a Junior with neutral traits, in bps (quality: points x 10 000; awareness: share x 10 000 per hour;
   * reputation: points x 100 per hour; morale: satisfaction bps per hour for every other talent). */
  readonly baseBps: number;
  /** Wage factor of the role in percent (100 = tier wage). */
  readonly wagePct: number;
  /** Portrait keys (src/components/pixel/avatars.ts) a talent of this role may get. */
  readonly avatars: readonly string[];
}

/** The 15 Stellen, in display order. Every company has one seat per Stelle from the founding on. */
export const TALENT_ROLES: readonly TalentRoleConfig[] = [
  { key: "sales", effect: "demand", baseBps: 300, wagePct: 110, avatars: ["seller", "trader", "founder"] },
  { key: "marketing", effect: "awareness", baseBps: 12, wagePct: 100, avatars: ["seller", "gamer", "punk"] },
  { key: "customer_service", effect: "demand", baseBps: 200, wagePct: 80, avatars: ["rookie", "seller", "chef"] },
  { key: "strategy", effect: "demand", baseBps: 220, wagePct: 130, avatars: ["magnate", "banker", "founder"] },
  { key: "production", effect: "capacity", baseBps: 300, wagePct: 90, avatars: ["builder", "trucker", "chef"] },
  { key: "logistics", effect: "capacity", baseBps: 200, wagePct: 85, avatars: ["trucker", "pilot", "builder"] },
  { key: "it", effect: "capacity", baseBps: 220, wagePct: 115, avatars: ["coder", "gamer", "analyst"] },
  { key: "company_doctor", effect: "capacity", baseBps: 150, wagePct: 120, avatars: ["scientist", "rookie", "pilot"] },
  { key: "purchasing", effect: "cogs", baseBps: 120, wagePct: 95, avatars: ["trader", "trucker", "analyst"] },
  { key: "controlling", effect: "fixed", baseBps: 220, wagePct: 115, avatars: ["analyst", "banker", "coder"] },
  { key: "accounting", effect: "fixed", baseBps: 150, wagePct: 90, avatars: ["banker", "analyst", "rookie"] },
  { key: "science", effect: "quality", baseBps: 70, wagePct: 125, avatars: ["scientist", "astronaut", "coder"] },
  { key: "quality", effect: "quality", baseBps: 50, wagePct: 95, avatars: ["builder", "scientist", "analyst"] },
  { key: "legal", effect: "reputation", baseBps: 4, wagePct: 130, avatars: ["lawyer", "banker", "royal"] },
  { key: "hr", effect: "morale", baseBps: 60, wagePct: 90, avatars: ["rookie", "lawyer", "seller"] },
];

export const TALENT_TIERS = ["junior", "professional", "senior", "expert", "legend"] as const;
export type TalentTier = (typeof TALENT_TIERS)[number];

export const TALENT_BENEFITS = [
  "homeoffice",
  "company_car",
  "bonus",
  "training",
  "say",
  "office",
  "gym",
  "flextime",
] as const;
export type TalentBenefit = (typeof TALENT_BENEFITS)[number];

export interface TalentTraitConfig {
  readonly key: string;
  /** Wage demand +/- in percent. */
  readonly wagePct: number;
  /** Effect +/- in percent. */
  readonly effectPct: number;
  /** Satisfaction losses x this percent (loyal people forgive more, divas less). */
  readonly decayPct: number;
  /** Extra margin a poacher must beat, in bps. */
  readonly loyaltyBps: number;
  /** Extra reputation (points) the talent demands. */
  readonly reputationAdd: number;
  /** The benefit this personality always wants, if any. */
  readonly wants?: TalentBenefit;
  /** Mit-Geschäftsführer style: cautious picks the safest response, bold the quickest. */
  readonly style?: "cautious" | "bold";
  /** May become Mit-Geschäftsführer one tier earlier. */
  readonly leader?: boolean;
}

export const TALENT_TRAITS: readonly TalentTraitConfig[] = [
  {
    key: "ambitious",
    wagePct: 15,
    effectPct: 10,
    decayPct: 110,
    loyaltyBps: -500,
    reputationAdd: 5,
    wants: "training",
  },
  { key: "loyal", wagePct: 0, effectPct: 0, decayPct: 60, loyaltyBps: 2500, reputationAdd: 0 },
  {
    key: "diva",
    wagePct: 25,
    effectPct: 15,
    decayPct: 150,
    loyaltyBps: -1000,
    reputationAdd: 10,
    wants: "company_car",
  },
  { key: "team_player", wagePct: 0, effectPct: 5, decayPct: 90, loyaltyBps: 500, reputationAdd: 0 },
  { key: "workaholic", wagePct: 5, effectPct: 12, decayPct: 100, loyaltyBps: 0, reputationAdd: 0, wants: "bonus" },
  { key: "night_owl", wagePct: 0, effectPct: 3, decayPct: 100, loyaltyBps: 0, reputationAdd: 0, wants: "flextime" },
  { key: "family", wagePct: 0, effectPct: 0, decayPct: 80, loyaltyBps: 1000, reputationAdd: 0, wants: "homeoffice" },
  { key: "sporty", wagePct: 0, effectPct: 3, decayPct: 100, loyaltyBps: 0, reputationAdd: 0, wants: "gym" },
  { key: "cautious", wagePct: 0, effectPct: 0, decayPct: 90, loyaltyBps: 500, reputationAdd: 5, style: "cautious" },
  { key: "bold", wagePct: 5, effectPct: 8, decayPct: 120, loyaltyBps: -500, reputationAdd: 0, style: "bold" },
  {
    key: "leader",
    wagePct: 10,
    effectPct: 5,
    decayPct: 100,
    loyaltyBps: 0,
    reputationAdd: 5,
    wants: "say",
    leader: true,
  },
  { key: "perfectionist", wagePct: 5, effectPct: 8, decayPct: 110, loyaltyBps: 0, reputationAdd: 5, wants: "office" },
  { key: "idealist", wagePct: -5, effectPct: 0, decayPct: 100, loyaltyBps: 500, reputationAdd: 15, wants: "say" },
];

export const TALENT_RULES = {
  /** Talents per Stelle in the pool. */
  perRole: 44,
  /**
   * Wage per hour of a tier (cents), before role and traits. Steep on purpose (Nachtrag ADR-199): about x5 per tier,
   * a Legende pays off only for very large companies (docs/BALANCING.md, scripts/talent-value.ts).
   */
  wageCentsByTier: [6_000, 30_000, 150_000, 800_000, 4_000_000],
  /** Effect multiplier of a tier in percent of the Junior. */
  effectPctByTier: [100, 180, 300, 450, 650],
  /** How many talents of each tier per Stelle (sums to perRole). */
  countByTier: [14, 12, 10, 6, 2],
  /** Demands of a tier: minimum company reputation, awareness (bps), legal form rank, number of benefits. */
  minReputationByTier: [0, 35, 45, 55, 65],
  minAwarenessBpsByTier: [0, 300, 1_000, 2_500, 4_500],
  /** 0 garage, 1 small_business, 2 gmbh, 3 ag, 4 listed. */
  minFormByTier: [0, 0, 1, 2, 3],
  benefitsByTier: [0, 1, 1, 2, 3],
  /** Cost of a benefit per hour, in bps of the wage. office also needs expansion level >= 1. */
  benefitCostBps: {
    homeoffice: 200,
    company_car: 1_500,
    bonus: 1_000,
    training: 800,
    say: 0,
    office: 500,
    gym: 400,
    flextime: 0,
  } as Readonly<Record<TalentBenefit, number>>,
  /** The company must hold this many hours of wage (and benefits) in free cash to hire. */
  cashCoverHours: 12,
  /** When the demand of a hired talent rises above the contract, the owner has this long to raise the wage. */
  raiseGraceHours: 24,
  /** Caps of the summed effects (same units as baseBps). */
  capBps: {
    demand: 3_500,
    capacity: 3_500,
    cogs: 1_500,
    fixed: 2_500,
    quality: 800,
    awareness: 60,
    reputation: 30,
    morale: 600,
  } as Readonly<Record<TalentEffect, number>>,
  satisfaction: {
    startBps: 7_000,
    /** Change per hour when every demand is met. */
    gainBps: 250,
    /** Losses per hour for each unmet demand (x trait decayPct). */
    unpaidBps: 2_500,
    /** The wage demand rose above the contract (new prices) and the grace period is over. */
    underpaidBps: 1_500,
    reputationBps: 800,
    awarenessBps: 400,
    benefitBps: 600,
    /** Warning (notification) below this. */
    warnBps: 3_500,
    /** Quits at or below this. */
    quitBps: 1_000,
    /** A countered poaching attempt lifts satisfaction. */
    counterBonusBps: 1_000,
  },
  poach: {
    /** A poacher's offer must be worth this much more than the current contract (+ loyalty of the traits). */
    marginBps: 1_500,
    /** The current employer may counter within this window. */
    counterMinutes: 15,
  },
  market: {
    /** Share of the free talents on the market on a given Berlin day; the rest is "nicht auf dem Markt". */
    shareBps: 6_500,
    /** After quitting or being dismissed a talent rests this long. */
    restHours: 12,
  },
  coCeo: {
    /** At most this many Mit-Geschäftsführer per company. */
    max: 2,
    /** Minimum tier (0 = Junior); the trait "leader" lowers it by one. */
    minTier: 2,
    /** The wage must be this much higher than the base demand, and "say" (Mitspracherecht) is required. */
    wageBonusBps: 3_000,
    /** Maximum daily budget the owner may set (cents). */
    maxBudgetCents: 10_000_000,
    /** An open event waits this long for the owner before a Mit-GF responds. */
    eventDelayMinutes: 30,
    /** Cautious Mit-GF spend at most this share of the remaining budget at once. */
    cautiousSpendBps: 5_000,
  },
} as const;

const FIRST_NAMES = [
  "Lena",
  "Jonas",
  "Mia",
  "Felix",
  "Hannah",
  "Lukas",
  "Emilia",
  "Paul",
  "Clara",
  "Moritz",
  "Greta",
  "Theo",
  "Ida",
  "Anton",
  "Mathilda",
  "Jakob",
  "Frieda",
  "Elias",
  "Johanna",
  "Leon",
  "Marlene",
  "Henri",
  "Luisa",
  "Oskar",
  "Romy",
  "Karl",
  "Pia",
  "Vincent",
  "Nele",
  "Konstantin",
  "Merle",
  "Fabian",
  "Svenja",
  "Malte",
  "Wiebke",
  "Till",
  "Imke",
  "Jannik",
  "Annika",
  "Bastian",
  "Carla",
  "Dennis",
  "Esra",
  "Florian",
  "Gül",
  "Hendrik",
  "Ilka",
  "Jule",
  "Kian",
  "Lotta",
  "Milan",
  "Nora",
  "Ole",
  "Paula",
  "Quirin",
  "Rieke",
  "Sami",
  "Tilda",
  "Ugur",
  "Vera",
  "Wanda",
  "Yannick",
  "Zoe",
  "Arne",
  "Bente",
  "Cem",
  "Dörte",
  "Emil",
  "Fenja",
  "Gero",
] as const;

const LAST_NAMES = [
  "Hartmann",
  "Brandt",
  "Vogel",
  "Kessler",
  "Lindner",
  "Albers",
  "Behrens",
  "Dietz",
  "Engel",
  "Franke",
  "Graf",
  "Haas",
  "Jansen",
  "Kunze",
  "Lorenz",
  "Marx",
  "Nagel",
  "Ostermann",
  "Pohl",
  "Quast",
  "Rausch",
  "Seidel",
  "Thiele",
  "Ulrich",
  "Voss",
  "Winter",
  "Zeller",
  "Arnold",
  "Bock",
  "Claasen",
  "Dreyer",
  "Eckert",
  "Fuchs",
  "Gerlach",
  "Heinze",
  "Iske",
  "Jäger",
  "Kröger",
  "Lehnert",
  "Mertens",
  "Nolte",
  "Oertel",
  "Pfeiffer",
  "Reuter",
  "Sauer",
  "Timm",
  "Uhl",
  "Vierling",
  "Wendt",
  "Yilmaz",
  "Ziegler",
  "Austermann",
  "Brinkmann",
  "Dahlke",
  "Ebert",
  "Feldmann",
  "Grote",
  "Hesse",
  "Ilgner",
  "Kaya",
  "Lück",
  "Möller",
  "Neumeier",
  "Petersen",
  "Rohde",
  "Schulte",
  "Tewes",
  "Vollmer",
  "Wagner-Lutz",
  "Zimmer",
] as const;

export interface TalentSeed {
  /** Unique, stable key, e.g. "t_sales_07". */
  readonly key: string;
  readonly role: string;
  /** 0 Junior .. 4 Legende. */
  readonly tier: number;
  readonly firstName: string;
  readonly lastName: string;
  readonly avatar: string;
  readonly traits: readonly [string, string];
  /** Demanded wage per hour (cents). */
  readonly wageCents: number;
  /** Benefits the talent insists on. */
  readonly benefits: readonly TalentBenefit[];
  readonly minReputation: number;
  readonly minAwarenessBps: number;
  readonly minForm: number;
  /** Effect in the role's units, before caps. */
  readonly effectBps: number;
}

/** Deterministic 32-bit LCG (no Math.random). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s;
  };
}

/** The whole pool: perRole talents per Stelle, unique names, demands and effect derived from tier and traits. */
export function generateTalentPool(): TalentSeed[] {
  const next = lcg(0x7a1e_2026);
  const used = new Set<string>();
  const out: TalentSeed[] = [];
  const traitCount = TALENT_TRAITS.length;
  for (const role of TALENT_ROLES) {
    let index = 0;
    TALENT_RULES.countByTier.forEach((count, tier) => {
      for (let n = 0; n < count; n++) {
        let first = "";
        let last = "";
        do {
          first = FIRST_NAMES[next() % FIRST_NAMES.length]!;
          last = LAST_NAMES[next() % LAST_NAMES.length]!;
        } while (used.has(`${first} ${last}`));
        used.add(`${first} ${last}`);
        const a = next() % traitCount;
        const b = (a + 1 + (next() % (traitCount - 1))) % traitCount;
        const ta = TALENT_TRAITS[a]!;
        const tb = TALENT_TRAITS[b]!;
        const wagePct = 100 + ta.wagePct + tb.wagePct;
        const jitter = 90 + (next() % 21); // 90..110 %
        const wageCents =
          Math.round((TALENT_RULES.wageCentsByTier[tier]! * role.wagePct * wagePct * jitter) / 1_000_000 / 100) * 100;
        const wants: TalentBenefit[] = [];
        for (const t of [ta, tb]) if (t.wants && !wants.includes(t.wants)) wants.push(t.wants);
        while (wants.length < TALENT_RULES.benefitsByTier[tier]!) {
          const pick = TALENT_BENEFITS[next() % TALENT_BENEFITS.length]!;
          if (!wants.includes(pick)) wants.push(pick);
        }
        const effectBps = Math.round(
          (role.baseBps * TALENT_RULES.effectPctByTier[tier]! * (100 + ta.effectPct + tb.effectPct)) / 10_000,
        );
        index += 1;
        out.push({
          key: `t_${role.key}_${String(index).padStart(2, "0")}`,
          role: role.key,
          tier,
          firstName: first,
          lastName: last,
          avatar: role.avatars[next() % role.avatars.length]!,
          traits: [ta.key, tb.key],
          wageCents,
          benefits: wants,
          minReputation: Math.min(
            90,
            TALENT_RULES.minReputationByTier[tier]! + (tier > 0 ? ta.reputationAdd + tb.reputationAdd : 0),
          ),
          minAwarenessBps: TALENT_RULES.minAwarenessBpsByTier[tier]!,
          minForm: TALENT_RULES.minFormByTier[tier]!,
          effectBps,
        });
      }
    });
  }
  return out;
}

export const TALENT_POOL: readonly TalentSeed[] = generateTalentPool();
