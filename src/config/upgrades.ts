/**
 * Upgrades (ADR-093, ADR-134): permanent improvements a player buys with game money. Every upgrade has levels; each
 * level costs `baseCostCents × costGrowth^level` (rounded to whole euros) and adds `perLevel` to its effect. The money
 * goes back to the treasury that pays the basic income (closed money system, ADR-041). Bonus money of an upgrade
 * (vault interest, wage bonus, daily reward, company tasks, business moves) comes from the treasury or the
 * households, never from nowhere.
 *
 * Plain data, no imports: runs unchanged in Deno and is mirrored in Postgres (game_config.upgrades).
 */
export type UpgradeKey =
  | "vault"
  | "income"
  | "study"
  | "overtime"
  | "rhetoric"
  | "mentor"
  | "artist"
  | "efficiency"
  | "makler"
  | "crypto_wallet"
  // ADR-134
  | "vault_xl"
  | "vault_interest"
  | "daily_bonus"
  | "wage_bonus"
  | "wage_shield"
  | "trader"
  | "early_bird"
  | "mission_hunter"
  | "teamplayer"
  | "balance_sheet"
  | "ambition"
  | "task_pay"
  | "task_safety"
  | "crisis_manager"
  | "move_luck"
  | "ad_agency"
  | "dealmaker"
  | "ai_turbo"
  | "ai_precision"
  | "strategist"
  | "move_tempo"
  | "activist";

/** Sources of XP (public.xp_source) an XP upgrade can raise; "*" = every source. */
export type UpgradeXpSource =
  "*" | "trade" | "mission" | "daily_login" | "streak_bonus" | "work_task" | "company_quarter_profit" | "ipo_success";

export interface UpgradeConfig {
  readonly maxLevel: number;
  /** Player level needed for the first purchase. */
  readonly minLevel: number;
  /** Every further stage needs this many more levels (ADR-100): stage n needs minLevel + (n − 1) · levelStep. */
  readonly levelStep: number;
  readonly baseCostCents: number;
  readonly costGrowth: number;
  /**
   * Effect per level:
   * - vault: hours of income the vault holds
   * - income: basic income in bps
   * - study: work hours less per branch skill point
   * - overtime: paid work hours more per day
   * - rhetoric: promotion chance in bps (AI bosses)
   * - mentor: XP from work hours in bps
   * - artist: discount on painting an artwork in bps
   * - efficiency: less fixed costs of the own company in bps
   * - makler: discount on homes, furniture, floors and cars in bps
   * - crypto_wallet: less pool fees on crypto trades in bps
   * ADR-134:
   * - vault_xl: hours of income the vault holds (on top of vault)
   * - vault_interest: extra money on every vault claim in bps of the claim (treasury)
   * - daily_bonus: more cash from the daily reward in bps
   * - wage_bonus: wage bonus in bps of every wage payment (treasury)
   * - wage_shield: bps less of the wage cut by crises and falling share prices (ADR-131)
   * - trader, early_bird, mission_hunter, teamplayer, balance_sheet, ambition: XP in bps from `xpSources`
   * - task_pay: more money for company tasks done right in bps (households, founder's company)
   * - task_safety: less penalty for botched or missed company tasks in bps
   * - crisis_manager: discount on the steps of crises and chances and on own strategies for them in bps
   * - move_luck: success chance of business moves in bps
   * - ad_agency: discount on marketing campaigns in bps
   * - dealmaker: more payout of successful cash moves in bps (households)
   * - ai_turbo: less time the AI workers need for a company task in bps
   * - ai_precision: success chance of the AI workers on company tasks in bps
   * - strategist: success chance of own strategies in bps (ADR-132)
   * - move_tempo: shorter rest between two runs of the same business move in bps
   * - activist: effect chance of campaigns the player starts against companies in bps (ADR-133)
   */
  readonly perLevel: number;
  /** XP upgrades only: the XP sources whose XP the upgrade raises by perLevel bps per level. */
  readonly xpSources?: readonly UpgradeXpSource[];
}

export type UpgradeGroup = "vault" | "work" | "xp" | "company" | "life";

export interface UpgradeGroupConfig {
  readonly key: UpgradeGroup;
  readonly keys: readonly UpgradeKey[];
}

export type UpgradesConfig = Readonly<Record<UpgradeKey, UpgradeConfig>> & {
  /** Display order, also the order on the upgrades page (the groups in a row). */
  readonly order: readonly UpgradeKey[];
  /** Sections of the upgrades page; together exactly the keys of `order`, in the same order. */
  readonly groups: readonly UpgradeGroupConfig[];
  /** Branch points never take fewer work hours than this, whatever the study level. */
  readonly minWorkHoursPerBranchPoint: number;
};

const GROUPS: readonly UpgradeGroupConfig[] = [
  { key: "vault", keys: ["vault", "vault_xl", "vault_interest", "income", "daily_bonus"] },
  { key: "work", keys: ["study", "mentor", "overtime", "rhetoric", "wage_bonus", "wage_shield"] },
  { key: "xp", keys: ["trader", "early_bird", "mission_hunter", "teamplayer", "balance_sheet", "ambition"] },
  {
    key: "company",
    keys: [
      "efficiency",
      "task_pay",
      "task_safety",
      "crisis_manager",
      "move_luck",
      "ad_agency",
      "dealmaker",
      "ai_turbo",
      "ai_precision",
      "strategist",
      "move_tempo",
    ],
  },
  { key: "life", keys: ["artist", "activist", "makler", "crypto_wallet"] },
];

export const UPGRADES: UpgradesConfig = {
  order: GROUPS.flatMap((g) => g.keys),
  groups: GROUPS,
  // 8 h → 24 h: 3.000 €, 6.000 €, 12.000 €, 24.000 €, 48.000 €, 96.000 €, 192.000 €, 384.000 €;
  // levels 1, 3, 5, 7, 9, 11, 13, 15 (ADR-134: two more stages)
  vault: { maxLevel: 8, minLevel: 1, levelStep: 2, baseCostCents: 300_000, costGrowth: 2, perLevel: 2 },
  // Only a little (owner): +10 % per level, at most +30 %. 4.000 €, 12.000 €, 36.000 €; levels 3, 7, 11
  income: { maxLevel: 3, minLevel: 3, levelStep: 4, baseCostCents: 400_000, costGrowth: 3, perLevel: 1_000 },
  // 6 → 3 work hours per branch point: 8.000 €, 24.000 €, 72.000 €; levels 2, 6, 10
  study: { maxLevel: 3, minLevel: 2, levelStep: 4, baseCostCents: 800_000, costGrowth: 3, perLevel: 1 },
  // +10 % XP from work per level: 6.000 €, 18.000 €, 54.000 €; levels 4, 8, 12
  mentor: { maxLevel: 3, minLevel: 4, levelStep: 4, baseCostCents: 600_000, costGrowth: 3, perLevel: 1_000 },
  // 8 → 10 paid hours a day: 20.000 €, 60.000 €; levels 5, 11
  overtime: { maxLevel: 2, minLevel: 5, levelStep: 6, baseCostCents: 2_000_000, costGrowth: 3, perLevel: 1 },
  // +5 % promotion chance per level: 10.000 €, 25.000 €, 62.500 €; levels 5, 10, 15
  rhetoric: { maxLevel: 3, minLevel: 5, levelStep: 5, baseCostCents: 1_000_000, costGrowth: 2.5, perLevel: 500 },
  // −10 % on painting an artwork per level: 5.000 €, 12.500 €, 31.250 €; levels 4, 7, 10
  artist: { maxLevel: 3, minLevel: 4, levelStep: 3, baseCostCents: 500_000, costGrowth: 2.5, perLevel: 1_000 },
  // −5 % fixed costs of the own company per level: 12.000 €, 30.000 €, 75.000 €; levels 6, 10, 14
  efficiency: { maxLevel: 3, minLevel: 6, levelStep: 4, baseCostCents: 1_200_000, costGrowth: 2.5, perLevel: 500 },
  // −5 % on homes, furniture, floors and cars per level: 15.000 €, 37.500 €, 93.750 €; levels 8, 12, 16
  makler: { maxLevel: 3, minLevel: 8, levelStep: 4, baseCostCents: 1_500_000, costGrowth: 2.5, perLevel: 500 },
  // −25 % crypto pool fees per level: 20.000 €, 60.000 €; levels 10, 15
  crypto_wallet: { maxLevel: 2, minLevel: 10, levelStep: 5, baseCostCents: 2_000_000, costGrowth: 3, perLevel: 2_500 },

  // ---- ADR-134 ----
  // +4 h vault per level: 100.000 €, 200.000 €, 400.000 €; levels 14, 20, 26
  vault_xl: { maxLevel: 3, minLevel: 14, levelStep: 6, baseCostCents: 10_000_000, costGrowth: 2, perLevel: 4 },
  // +5 % on every vault claim: 5.000 €, 12.500 €, 31.250 €, 78.125 €; levels 3, 6, 9, 12
  vault_interest: { maxLevel: 4, minLevel: 3, levelStep: 3, baseCostCents: 500_000, costGrowth: 2.5, perLevel: 500 },
  // +25 % cash from the daily reward: 2.500 €, 7.500 €, 22.500 €; levels 2, 6, 10
  daily_bonus: { maxLevel: 3, minLevel: 2, levelStep: 4, baseCostCents: 250_000, costGrowth: 3, perLevel: 2_500 },
  // +5 % wage bonus: 6.000 €, 18.000 €, 54.000 €; levels 3, 8, 13
  wage_bonus: { maxLevel: 3, minLevel: 3, levelStep: 5, baseCostCents: 600_000, costGrowth: 3, perLevel: 500 },
  // −25 % of the wage cut in crises: 8.000 €, 20.000 €, 50.000 €; levels 6, 11, 16
  wage_shield: { maxLevel: 3, minLevel: 6, levelStep: 5, baseCostCents: 800_000, costGrowth: 2.5, perLevel: 2_500 },
  // +10 % trade XP: 2.000 €, 5.000 €, 12.500 €; levels 1, 4, 7
  trader: {
    maxLevel: 3,
    minLevel: 1,
    levelStep: 3,
    baseCostCents: 200_000,
    costGrowth: 2.5,
    perLevel: 1_000,
    xpSources: ["trade"],
  },
  // +20 % XP from the daily reward and the check-in: 1.500 €, 4.500 €, 13.500 €; levels 1, 5, 9
  early_bird: {
    maxLevel: 3,
    minLevel: 1,
    levelStep: 4,
    baseCostCents: 150_000,
    costGrowth: 3,
    perLevel: 2_000,
    xpSources: ["daily_login", "streak_bonus"],
  },
  // +10 % mission XP: 3.000 €, 7.500 €, 18.750 €; levels 2, 6, 10
  mission_hunter: {
    maxLevel: 3,
    minLevel: 2,
    levelStep: 4,
    baseCostCents: 300_000,
    costGrowth: 2.5,
    perLevel: 1_000,
    xpSources: ["mission"],
  },
  // +15 % XP from tasks: 8.000 €, 20.000 €, 50.000 €; levels 6, 10, 14
  teamplayer: {
    maxLevel: 3,
    minLevel: 6,
    levelStep: 4,
    baseCostCents: 800_000,
    costGrowth: 2.5,
    perLevel: 1_500,
    xpSources: ["work_task"],
  },
  // +15 % XP from quarter profits and the IPO of the own company: 15.000 €, 37.500 €, 93.750 €; levels 9, 14, 19
  balance_sheet: {
    maxLevel: 3,
    minLevel: 9,
    levelStep: 5,
    baseCostCents: 1_500_000,
    costGrowth: 2.5,
    perLevel: 1_500,
    xpSources: ["company_quarter_profit", "ipo_success"],
  },
  // +5 % on all XP: 100.000 €, 200.000 €, 400.000 €; levels 18, 24, 30
  ambition: {
    maxLevel: 3,
    minLevel: 18,
    levelStep: 6,
    baseCostCents: 10_000_000,
    costGrowth: 2,
    perLevel: 500,
    xpSources: ["*"],
  },
  // +10 % for company tasks: 10.000 €, 25.000 €, 62.500 €; levels 7, 11, 15
  task_pay: { maxLevel: 3, minLevel: 7, levelStep: 4, baseCostCents: 1_000_000, costGrowth: 2.5, perLevel: 1_000 },
  // −25 % penalty for botched tasks: 6.000 €, 15.000 €, 37.500 €; levels 7, 12, 17
  task_safety: { maxLevel: 3, minLevel: 7, levelStep: 5, baseCostCents: 600_000, costGrowth: 2.5, perLevel: 2_500 },
  // −10 % on crisis and chance steps: 10.000 €, 25.000 €, 62.500 €; levels 7, 12, 17
  crisis_manager: {
    maxLevel: 3,
    minLevel: 7,
    levelStep: 5,
    baseCostCents: 1_000_000,
    costGrowth: 2.5,
    perLevel: 1_000,
  },
  // +3 % chance on business moves: 12.000 €, 30.000 €, 75.000 €; levels 8, 12, 16
  move_luck: { maxLevel: 3, minLevel: 8, levelStep: 4, baseCostCents: 1_200_000, costGrowth: 2.5, perLevel: 300 },
  // −10 % on marketing campaigns: 12.000 €, 30.000 €, 75.000 €; levels 9, 13, 17
  ad_agency: { maxLevel: 3, minLevel: 9, levelStep: 4, baseCostCents: 1_200_000, costGrowth: 2.5, perLevel: 1_000 },
  // +10 % payout of cash moves: 20.000 €, 50.000 €, 125.000 €; levels 10, 15, 20
  dealmaker: { maxLevel: 3, minLevel: 10, levelStep: 5, baseCostCents: 2_000_000, costGrowth: 2.5, perLevel: 1_000 },
  // −15 % time of the AI workers on tasks: 15.000 €, 37.500 €, 93.750 €; levels 11, 15, 19
  ai_turbo: { maxLevel: 3, minLevel: 11, levelStep: 4, baseCostCents: 1_500_000, costGrowth: 2.5, perLevel: 1_500 },
  // +5 % chance of the AI workers on tasks: 20.000 €, 50.000 €, 125.000 €; levels 12, 17, 22
  ai_precision: { maxLevel: 3, minLevel: 12, levelStep: 5, baseCostCents: 2_000_000, costGrowth: 2.5, perLevel: 500 },
  // +4 % chance of own strategies: 25.000 €, 62.500 €, 156.250 €; levels 13, 18, 23
  strategist: { maxLevel: 3, minLevel: 13, levelStep: 5, baseCostCents: 2_500_000, costGrowth: 2.5, perLevel: 400 },
  // −15 % rest between business moves: 40.000 €, 100.000 €, 250.000 €; levels 16, 21, 26
  move_tempo: { maxLevel: 3, minLevel: 16, levelStep: 5, baseCostCents: 4_000_000, costGrowth: 2.5, perLevel: 1_500 },
  // +5 % effect chance of own campaigns against companies: 4.000 €, 10.000 €, 25.000 €; levels 4, 10, 16
  activist: { maxLevel: 3, minLevel: 4, levelStep: 6, baseCostCents: 400_000, costGrowth: 2.5, perLevel: 500 },
  minWorkHoursPerBranchPoint: 3,
};
