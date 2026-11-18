import { BALANCE } from "@/config/balance";
import type { BoardMotionKind, LedgerCategory, ListedItemKind, ListedPurpose } from "@/config/listed";
import {
  advisorWageCents,
  aiFloatVote,
  aiWorkerQuits,
  boardDecided,
  boardOutcome,
  booksDiscountBps,
  booksStage,
  booksTax,
  canConvene,
  dividendSplit,
  estimateTax,
  gradeReceipts,
  isOperating,
  itemByKey,
  itemCostCents,
  itemUpkeepCents,
  lateFeeCents,
  latePaymentCents,
  layoffHeatNext,
  listedHourEffect,
  maxDividendCents,
  missingRequirements,
  payoutRatioBps,
  pickReceipts,
  avgProfitCents,
  refProfitCents,
  refRevenueCents,
  researchCostCents,
  researchHours,
  reputationEffect,
  reputationTarget,
  satisfactionEffect,
  satisfactionTarget,
  satisfactionZone,
  stepToward,
  sumEffects,
  taxRateBps,
  type ListedItemStatus as OwnedStatus,
  type OwnedItem,
} from "@/lib/sim/listed";
import type { PriceLevel, StartupHourInput } from "@/lib/sim/startup";
import { reputationTargetAll, type ReputationDrivers } from "@/lib/sim/company-reputation";
import type {
  AccountingEntry,
  BoardMotion,
  BoardMotionInput,
  CompanyAccounting,
  CompanyBoard,
  ListedBooks,
  ListedCompany,
  ListedDividend,
  ListedEngine,
  ListedHistoryPoint,
  ListedRestrictions,
  TaxPeriod,
} from "../listed-types";
import { GameError } from "../types";
import type { DemoCompanyState } from "./company";

/*
 * Listed companies in the offline demo (ADR-167): the rules of the listed_* functions on the server with the pure
 * formulas of src/lib/sim/listed.ts. The demo has no other players: the founder holds the shares that were not sold,
 * a made-up big shareholder (Ingrid Invest) holds up to 22 % and the rest is AI float. Ingrid votes for dividends
 * and budgets and brings a payout cap when the founder gets greedy.
 */
const cfg = BALANCE.listed;
const HOUR = 3_600_000;
const E6 = 1_000_000;
const INGRID = "Ingrid Invest";
const berlinDay = (at: number) => new Intl.DateTimeFormat("en-CA", { timeZone: BALANCE.time.timezone }).format(at);
const iso = (at: number | null | undefined) => (at ? new Date(at).toISOString() : null);

interface DemoItem {
  status: OwnedStatus;
  level: number;
  readyAt: number | null;
  lastUsedAt: number | null;
}

interface DemoMotion {
  id: number;
  kind: BoardMotionKind;
  params: BoardMotion["params"];
  status: BoardMotion["status"];
  proposer: string;
  createdAt: number;
  closesAt: number;
  closedAt: number | null;
  /** Votes by name: the founder, Ingrid. */
  votes: Record<string, boolean>;
  yesE6: number;
  noE6: number;
  aiE6: number;
  result: Record<string, unknown>;
}

interface DemoWindowHour {
  at: number;
  profitCents: number;
  revenueCents: number;
  payoutCents: number;
}

export interface DemoListedState {
  reputation: number;
  satisfaction: number;
  priceFactor: number;
  items: Record<string, DemoItem>;
  layoffHeat: number;
  aiSeen: number;
  redHours: number;
  booksUntil: number;
  booksDay: string | null;
  booksStreak: number;
  booksStage: number;
  lossCarryCents: number;
  advisor: boolean;
  restrictions: {
    payoutCapBps: number | null;
    payoutCapUntil: number | null;
    withdrawBlockUntil: number | null;
    priceLock: PriceLevel | null;
    priceLockUntil: number | null;
  };
  dividendDay: string | null;
  dividendStreak: number;
  budgets: Partial<Record<ListedPurpose, number>>;
  dividends: ListedDividend[];
  periods: TaxPeriod[];
  motions: DemoMotion[];
  ledger: AccountingEntry[];
  history: ListedHistoryPoint[];
  window: DemoWindowHour[];
  /** Manual withdrawals and one-off investments with their time, for the reputation window. */
  withdrawals: { at: number; cents: number }[];
  investments: { at: number; cents: number }[];
  lastUpkeep: Partial<Record<LedgerCategory, number>>;
  drivers: { satisfaction: Record<string, number>; reputation: Record<string, number>; payoutRatioBps: number };
  targets: { satisfaction: number; reputation: number };
  seq: number;
}

export type ListedMetric =
  "listed_invests" | "listed_research" | "listed_benefits" | "listed_books" | "listed_dividends" | "board_votes";

export interface ListedHost {
  company(): (DemoCompanyState & { listed?: DemoListedState }) | null;
  nickname(): string;
  /** Private cash of the player (dividends on the founder's shares). */
  addCash(cents: number): void;
  notify(typeKey: string, title: string, body: string | null, link: string | null): void;
  feed(kind: string, payload: Record<string, unknown>): void;
  track(metric: ListedMetric, by?: number): void;
  /** Lets the company close its due hours first. */
  catchUp(): void;
  idempotent<T>(requestId: string, run: () => T): T;
  persist(): void;
  now(): number;
  /** Uniform number in [0, 1). */
  random(): number;
}

/** One closed hour as the listed part needs it. */
export interface ListedHourFacts {
  at: number;
  /** ADR-183: operational reputation drivers of the hour (every company). */
  reputationDrivers?: ReputationDrivers;
  demandCents: number;
  capacityCents: number;
  revenueCents: number;
  cogsCents: number;
  aiWagesCents: number;
  fixedCents: number;
  listedCostsCents: number;
  marketingCents: number;
  profitCents: number;
  payoutCents: number;
  payFactorBps: number;
}

const kindCategory = (kind: ListedItemKind): LedgerCategory =>
  kind === "research"
    ? "research"
    : kind === "product"
      ? "product"
      : kind === "benefit" || kind === "action"
        ? "benefit"
        : "expansion";

export function createListedEngine(host: ListedHost) {
  const isListed = (c: DemoCompanyState | null): c is DemoCompanyState => !!c && c.listing?.status === "listed";

  /** The listed state, created on first use; null for private companies. */
  function ensure(company: DemoCompanyState & { listed?: DemoListedState }): DemoListedState {
    company.listed ??= {
      reputation: cfg.reputation.start,
      satisfaction: cfg.satisfaction.start,
      priceFactor: 1,
      items: {},
      layoffHeat: 0,
      aiSeen: company.aiWorkers,
      redHours: 0,
      booksUntil: host.now(),
      booksDay: null,
      booksStreak: 0,
      booksStage: 0,
      lossCarryCents: 0,
      advisor: false,
      restrictions: {
        payoutCapBps: null,
        payoutCapUntil: null,
        withdrawBlockUntil: null,
        priceLock: null,
        priceLockUntil: null,
      },
      dividendDay: null,
      dividendStreak: 0,
      budgets: {},
      dividends: [],
      periods: [],
      motions: [],
      ledger: [],
      history: [],
      window: [],
      withdrawals: [],
      investments: [],
      lastUpkeep: {},
      drivers: { satisfaction: {}, reputation: {}, payoutRatioBps: 0 },
      targets: { satisfaction: cfg.satisfaction.start, reputation: cfg.reputation.start },
      seq: 0,
    };
    return company.listed;
  }

  function own(): { company: DemoCompanyState; l: DemoListedState } {
    host.catchUp();
    const company = host.company();
    if (!company) throw new GameError("company_not_found");
    if (!isListed(company)) throw new GameError("not_listed");
    const l = ensure(company);
    finishDue(company, l, host.now());
    closeDueMotions(company, l);
    return { company, l };
  }

  const owned = (l: DemoListedState): OwnedItem[] =>
    Object.entries(l.items).map(([key, i]) => ({ key, status: i.status, level: i.level }));
  const reserved = (l: DemoListedState) => Object.values(l.budgets).reduce((s, v) => s + (v ?? 0), 0);
  const freeCash = (company: DemoCompanyState, l: DemoListedState) =>
    company.cashCents - company.unpaidCents - reserved(l);
  const ref = (l: DemoListedState) => refRevenueCents(l.window.map((h) => h.revenueCents));
  // ADR-215: research from the earnings. The demo keeps the hours of the reputation window (24 h), not 48.
  const profits = (l: DemoListedState) => l.window.map((h) => h.profitCents);
  const researchStarted = (l: DemoListedState) =>
    Object.entries(l.items).filter(
      ([key, i]) =>
        itemByKey(key)?.kind === "research" &&
        (((i.status === "active" || i.status === "paused") && i.level > 0) || i.status === "running"),
    ).length;
  const heads = (company: DemoCompanyState) => company.aiWorkers;

  function book(
    company: DemoCompanyState,
    l: DemoListedState,
    amountCents: number,
    category: LedgerCategory,
    description: string,
    item: string | null = null,
    at = host.now(),
  ) {
    if (amountCents === 0) return;
    l.seq += 1;
    l.ledger.push({
      id: l.seq,
      at: new Date(at).toISOString(),
      amountCents,
      balanceAfterCents: company.cashCents,
      description,
      category,
      item,
    });
    if (l.ledger.length > 600) l.ledger = l.ledger.slice(-600);
  }

  function finishDue(company: DemoCompanyState, l: DemoListedState, now: number) {
    for (const [key, i] of Object.entries(l.items)) {
      if (i.readyAt === null || i.readyAt > now || i.status === "retired") continue;
      i.level += 1;
      i.status = "active";
      i.readyAt = null;
      const kind = itemByKey(key)?.kind;
      if (kind === "research") host.track("listed_research");
      host.notify(
        "company_project",
        `Fertig bei ${company.name}`,
        kind === "research"
          ? "Eine Forschung ist abgeschlossen."
          : kind === "product"
            ? "Ein neues Produkt ist am Markt."
            : kind === "region"
              ? "Ein neuer Markt ist eröffnet."
              : "Ein Ausbau ist fertig.",
        "/company",
      );
    }
  }

  // ---------------------------------------------------------------- the hour (hooks of the company engine)

  /** Terms and running costs of the hour: what the cash cannot pay pauses. */
  function hourTerms(company: DemoCompanyState, at: number): StartupHourInput["listed"] | undefined {
    if (!isListed(company)) return undefined;
    const l = ensure(company);
    finishDue(company, l, at + HOUR);
    const r = ref(l);
    let left = Math.max(0, company.cashCents);
    const sums: Partial<Record<LedgerCategory, number>> = {};
    for (const [key, i] of Object.entries(l.items)) {
      const item = itemByKey(key);
      if (!item || item.kind === "action" || i.level <= 0 || (i.status !== "active" && i.status !== "paused")) continue;
      const up = itemUpkeepCents(item, i.level, r, heads(company));
      if (up <= left) {
        left -= up;
        if (up > 0) sums[kindCategory(item.kind)] = (sums[kindCategory(item.kind)] ?? 0) + up;
        i.status = "active";
      } else i.status = "paused";
    }
    if (l.advisor) {
      const wage = advisorWageCents(r);
      if (wage <= left) sums.advisor = wage;
      else {
        l.advisor = false;
        host.notify(
          "tax_office",
          "Steuerberater hat gekündigt",
          "Die Kasse reichte nicht für das Honorar.",
          "/company",
        );
      }
    }
    l.lastUpkeep = sums;
    if (sums.benefit && l.budgets.benefits) l.budgets.benefits = Math.max(0, l.budgets.benefits - sums.benefit);
    return {
      ...listedHourEffect(sumEffects(owned(l)), l.satisfaction, l.reputation),
      costsCents: Object.values(sums).reduce((s, v) => s + (v ?? 0), 0),
    };
  }

  function payoutCapBps(company: DemoCompanyState, at: number): number {
    const r = company.listed?.restrictions;
    return isListed(company) && r && r.payoutCapBps !== null && (r.payoutCapUntil ?? 0) > at ? r.payoutCapBps : 10_000;
  }

  function afterHour(company: DemoCompanyState, hour: ListedHourFacts) {
    if (!isListed(company)) return;
    const l = ensure(company);
    const end = hour.at + HOUR;
    // the books: the hour's bookings
    book(company, l, hour.revenueCents, "revenue", "Umsatz", null, end);
    book(company, l, -(hour.cogsCents + hour.aiWagesCents), "goods", "Wareneinsatz und KI-Kräfte", null, end);
    book(
      company,
      l,
      -(hour.fixedCents - hour.listedCostsCents + hour.marketingCents),
      "fixed",
      "Fixkosten und Marketing",
      null,
      end,
    );
    for (const [cat, cents] of Object.entries(l.lastUpkeep))
      book(company, l, -(cents ?? 0), cat as LedgerCategory, "Laufende Kosten", null, end);
    book(company, l, -hour.payoutCents, "payout", "CEO-Auszahlung", null, end);

    const windowMs = cfg.reputation.windowHours * HOUR;
    l.window = [
      ...l.window,
      { at: hour.at, profitCents: hour.profitCents, revenueCents: hour.revenueCents, payoutCents: hour.payoutCents },
    ]
      .filter((h) => h.at > end - windowMs)
      .slice(-48);
    l.withdrawals = l.withdrawals.filter((w) => w.at > end - windowMs);
    l.investments = l.investments.filter((w) => w.at > end - windowMs);
    const sum = (pick: (h: DemoWindowHour) => number) => l.window.reduce((s, h) => s + pick(h), 0);
    const profit = sum((h) => h.profitCents);
    const revenue = sum((h) => h.revenueCents);
    const payouts = sum((h) => h.payoutCents) + l.withdrawals.reduce((s, w) => s + w.cents, 0);
    const invested = l.investments.reduce((s, w) => s + w.cents, 0);
    const dividends = l.dividends
      .filter((d) => Date.parse(d.paidAt) > end - windowMs)
      .reduce((s, d) => s + d.totalCents, 0);
    const ratio = payoutRatioBps(payouts, profit, revenue);
    const fx = sumEffects(owned(l));
    const event = company.events?.events.find(
      (e) => e.polarity === "crisis" && (e.status === "open" || e.status === "in_force"),
    );
    const crisis = event ? event.severity : 0;

    // mood
    const dismissed = Math.max(0, l.aiSeen - company.aiWorkers);
    l.layoffHeat = layoffHeatNext(l.layoffHeat, dismissed);
    const st = satisfactionTarget({
      benefitPoints: fx.satisfaction,
      payFactorBps: hour.payFactorBps,
      payMoodBps: 10_000,
      utilization: hour.capacityCents > 0 ? hour.demandCents / hour.capacityCents : 1,
      crisisSeverity: crisis,
      scandal: !!event && (cfg.satisfaction.crisis.scandals as readonly string[]).includes(event.archetype),
      layoffHeat: l.layoffHeat,
      payoutRatioBps: ratio,
      profitCents: hour.profitCents,
    });
    l.satisfaction = stepToward(l.satisfaction, st.target, cfg.satisfaction.adjustPerHour);
    l.redHours = satisfactionZone(l.satisfaction) === "red" ? l.redHours + 1 : 0;
    if (aiWorkerQuits(l.redHours, company.aiWorkers)) {
      company.aiWorkers -= 1;
      company.aiWorkerSkills = (company.aiWorkerSkills ?? []).slice(0, company.aiWorkers);
      host.notify(
        "team_mood",
        `Kündigung bei ${company.name}`,
        "Eine KI-Kraft hat hingeschmissen: Die Stimmung ist im Keller.",
        "/company",
      );
    }
    l.aiSeen = company.aiWorkers;

    // reputation
    const today = berlinDay(end);
    const yesterday = berlinDay(end - 24 * HOUR);
    if (l.dividendDay !== today && l.dividendDay !== yesterday) l.dividendStreak = 0;
    const rt = reputationTarget({
      itemPoints: fx.reputation,
      payoutCents: payouts,
      profitCents: profit,
      revenueCents: revenue,
      investedCents: invested,
      dividendCents: dividends,
      dividendStreak: l.dividendStreak,
      scandal: false,
    });
    // ADR-183: the operational drivers of every company come on top of the shareholder target
    const op = hour.reputationDrivers ?? null;
    const target = op ? reputationTargetAll(op, rt.target) : rt.target;
    l.reputation = stepToward(l.reputation, target, cfg.reputation.adjustPerHour);
    company.reputation = l.reputation;
    const own = company.hours?.at(-1);
    if (own && own.at === hour.at) {
      own.reputation = l.reputation;
      own.reputationTarget = target;
      own.reputationDrivers = { ...rt.drivers, ...(op ?? {}) };
    }
    const pf = reputationEffect(l.reputation).priceFactor;
    if (company.listing?.lastPriceCents)
      company.listing.lastPriceCents = Math.max(1, Math.round((company.listing.lastPriceCents / l.priceFactor) * pf));
    l.priceFactor = pf;
    if (l.reputation < cfg.reputation.greed.feedBelow && ratio >= cfg.reputation.greed.fullRatioBps * 0.8)
      host.feed("greedy_founder", { company: company.name, ratio_bps: ratio });

    l.drivers = {
      satisfaction: { ...st.drivers },
      reputation: { ...rt.drivers, ...(op ?? {}) },
      payoutRatioBps: ratio,
    };
    l.targets = { satisfaction: st.target, reputation: target };
    const eff = listedHourEffect(fx, l.satisfaction, l.reputation);
    l.history = [
      ...l.history,
      {
        at: new Date(hour.at).toISOString(),
        satisfaction: Math.round(l.satisfaction * 100) / 100,
        reputation: Math.round(l.reputation * 100) / 100,
        demandFactor: eff.demandFactor,
        capacityFactor: eff.capacityFactor,
        upkeepCents: hour.listedCostsCents,
      },
    ].slice(-cfg.historyHours);

    taxOffice(company, l, end);
    ingrid(company, l, end);
    closeDueMotions(company, l, end);
  }

  // ---------------------------------------------------------------- books and taxes

  function periodSums(l: DemoListedState, from: number, to: number) {
    const byCategory: Partial<Record<LedgerCategory, number>> = {};
    for (const e of l.ledger) {
      const at = Date.parse(e.at);
      if (at <= from || at > to) continue;
      byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amountCents;
    }
    let costs = 0;
    for (const [cat, v] of Object.entries(byCategory))
      if (cat !== "revenue" && isOperating(cat as LedgerCategory)) costs -= v ?? 0;
    return { revenueCents: byCategory.revenue ?? 0, costsCents: costs, byCategory };
  }

  /** The receipts of the open period: the same ones until the books are closed. */
  function receipts(l: DemoListedState) {
    const seed = l.booksUntil;
    const uniforms = [1, 2, 3].map((i) => ((seed / 1000) * (i * 7919) * 0.618033988749) % 1);
    return pickReceipts(uniforms).map((index, i) => {
      const r = cfg.taxes.receipts[index]!;
      return { id: i + 1, key: r.key, category: r.category, amountCents: 1_000 + Math.floor(uniforms[i]! * 49_000) };
    });
  }

  const rateOf = (l: DemoListedState) => taxRateBps(sumEffects(owned(l)).taxRateBps);
  const dueCents = (l: DemoListedState) =>
    l.periods.filter((p) => p.status === "due").reduce((s, p) => s + p.taxCents + p.penaltyCents - p.paidCents, 0);

  function closeBooks(l: DemoListedState, by: TaxPeriod["closedBy"], correct: number, now: number): TaxPeriod {
    const s = periodSums(l, l.booksUntil, now);
    const rate = rateOf(l);
    const base = {
      id: (l.seq += 1),
      kind: "books" as const,
      periodStart: new Date(l.booksUntil).toISOString(),
      periodEnd: new Date(now).toISOString(),
      revenueCents: s.revenueCents,
      costsCents: s.costsCents,
      profitCents: s.revenueCents - s.costsCents,
      rateBps: rate,
      paidCents: 0,
      closedBy: by,
      checkCorrect: correct,
      stage: 0,
      dueAt: new Date(now + cfg.taxes.payWithinHours * HOUR).toISOString(),
    };
    let period: TaxPeriod;
    if (by === "finanzamt") {
      const e = estimateTax(s.revenueCents, s.costsCents, rate, cfg, (now - l.booksUntil) / HOUR);
      period = {
        ...base,
        lossUsedCents: 0,
        taxableCents: e.taxableCents,
        discountCents: 0,
        taxCents: e.taxCents,
        penaltyCents: e.surchargeCents,
        status: "due",
        paidAt: null,
      };
    } else {
      const b = booksTax(
        s.revenueCents,
        s.costsCents,
        l.lossCarryCents,
        rate,
        booksDiscountBps(correct, by === "advisor"),
        (now - l.booksUntil) / HOUR,
      );
      l.lossCarryCents = b.lossCarryCents;
      period = {
        ...base,
        lossUsedCents: b.lossUsedCents,
        taxableCents: b.taxableCents,
        discountCents: b.discountCents,
        taxCents: b.taxCents,
        penaltyCents: 0,
        status: "due",
        paidAt: null,
      };
    }
    if (period.taxCents + period.penaltyCents === 0) {
      period.status = "paid";
      period.paidAt = period.periodEnd;
    }
    const today = berlinDay(now);
    l.booksStreak =
      by === "finanzamt"
        ? 0
        : l.booksDay === berlinDay(now - 24 * HOUR)
          ? l.booksStreak + 1
          : l.booksDay === today
            ? Math.max(1, l.booksStreak)
            : 1;
    l.booksUntil = now;
    l.booksDay = today;
    l.booksStage = 0;
    l.periods = [period, ...l.periods].slice(0, cfg.taxes.historyLimit);
    if (by !== "finanzamt") host.track("listed_books");
    return period;
  }

  /** Pays due periods, oldest first; voluntary payments only whole periods. */
  function collect(
    company: DemoCompanyState,
    l: DemoListedState,
    limit: number | null,
    force: boolean,
    now: number,
  ): number {
    let avail = Math.min(Math.max(0, company.cashCents), limit ?? Infinity);
    let done = 0;
    for (const p of [...l.periods].reverse()) {
      if (p.status !== "due") continue;
      const rest = p.taxCents + p.penaltyCents - p.paidCents;
      const pay = Math.min(rest, avail);
      if (pay <= 0 || (!force && pay < rest)) break;
      const taxPart = Math.min(pay, Math.max(0, p.taxCents - p.paidCents));
      company.cashCents -= pay;
      book(company, l, -taxPart, "tax", "Körperschaftsteuer", null, now);
      book(company, l, -(pay - taxPart), "penalty", "Zuschläge des Finanzamts", null, now);
      p.paidCents += pay;
      if (pay === rest) {
        p.status = "paid";
        p.paidAt = new Date(now).toISOString();
      }
      avail -= pay;
      done += pay;
    }
    return done;
  }

  function taxOffice(company: DemoCompanyState, l: DemoListedState, now: number) {
    const s = periodSums(l, l.booksUntil, now);
    const hoursOpen = (now - l.booksUntil) / HOUR;
    const today = berlinDay(now);
    if (l.advisor) {
      if (s.revenueCents > 0 && l.booksDay !== today) closeBooks(l, "advisor", 0, now);
      collect(company, l, Math.max(0, freeCash(company, l)), false, now);
    } else {
      const stage = booksStage(hoursOpen, s.revenueCents);
      if (stage === "estimate") {
        closeBooks(l, "finanzamt", 0, now);
        l.reputation = Math.max(0, l.reputation - cfg.reputation.penalty.estimate);
        host.notify(
          "tax_office",
          "Finanzamt: Steuer geschätzt",
          "Du hast die Bücher nicht gemacht. Das Finanzamt hat geschätzt und schlägt einen Zuschlag auf.",
          "/company",
        );
        host.feed("tax_penalty", { company: company.name, reason: "estimate" });
      } else if (stage === "late" && l.booksStage < 2) {
        const fee = lateFeeCents(s.revenueCents);
        l.periods = [
          {
            id: (l.seq += 1),
            kind: "late_fee",
            periodStart: new Date(l.booksUntil).toISOString(),
            periodEnd: new Date(now).toISOString(),
            revenueCents: 0,
            costsCents: 0,
            profitCents: 0,
            lossUsedCents: 0,
            taxableCents: 0,
            rateBps: 0,
            discountCents: 0,
            taxCents: 0,
            penaltyCents: fee,
            paidCents: 0,
            status: "due",
            closedBy: "finanzamt",
            checkCorrect: null,
            stage: 0,
            dueAt: new Date(now + cfg.taxes.payWithinHours * HOUR).toISOString(),
            paidAt: null,
          },
          ...l.periods,
        ];
        l.booksStage = 2;
        l.reputation = Math.max(0, l.reputation - cfg.reputation.penalty.lateFee);
        host.notify(
          "tax_office",
          "Finanzamt: Verspätungszuschlag",
          "Die Bücher sind überfällig. Mach sie jetzt, sonst schätzt das Finanzamt.",
          "/company",
        );
        host.feed("tax_penalty", { company: company.name, reason: "late_fee", amount_cents: fee });
      } else if (stage === "reminder" && l.booksStage < 1) {
        l.booksStage = 1;
        host.notify(
          "tax_office",
          "Finanzamt: Bücher fällig",
          "Mach die Bücher. Sonst kommt ein Verspätungszuschlag.",
          "/company",
        );
      }
    }
    let force = false;
    for (const p of l.periods) {
      if (p.status !== "due") continue;
      const due = Date.parse(p.dueAt);
      const open = Math.max(0, p.taxCents - p.paidCents);
      if (p.stage === 0 && now > due) {
        p.stage = 1;
        p.penaltyCents += latePaymentCents(open, false);
        host.notify(
          "tax_office",
          "Finanzamt: Steuer überfällig",
          "Die Steuer ist nicht bezahlt. Es gibt einen Säumniszuschlag.",
          "/company",
        );
      } else if (p.stage === 1 && now > due + cfg.taxes.enforceAfterHours * HOUR) {
        p.stage = 2;
        p.penaltyCents += latePaymentCents(open, true);
        l.reputation = Math.max(0, l.reputation - cfg.reputation.penalty.enforcement);
        host.feed("tax_audit", { company: company.name });
        force = true;
      } else if (p.stage >= 2) force = true;
    }
    if (force) collect(company, l, null, true, now);
  }

  function booksView(company: DemoCompanyState, l: DemoListedState, now: number): ListedBooks {
    const s = periodSums(l, l.booksUntil, now);
    const hoursOpen = (now - l.booksUntil) / HOUR;
    const done = l.booksDay === berlinDay(now);
    const rate = rateOf(l);
    return {
      periodStart: new Date(l.booksUntil).toISOString(),
      revenueCents: s.revenueCents,
      costsCents: s.costsCents,
      profitCents: s.revenueCents - s.costsCents,
      byCategory: s.byCategory,
      lossCarryCents: l.lossCarryCents,
      rateBps: rate,
      estimatedTaxCents: Math.floor((Math.max(0, s.revenueCents - s.costsCents - l.lossCarryCents) * rate) / 10_000),
      receipts: receipts(l).map(({ id, key, amountCents }) => ({ id, key, amountCents })),
      receiptCategories: [...cfg.taxes.receiptCategories],
      canClose: s.revenueCents > 0 && !done,
      doneToday: done,
      hoursOpen: Math.round(hoursOpen * 100) / 100,
      stage: booksStage(hoursOpen, s.revenueCents),
      reminderAt: new Date(l.booksUntil + cfg.taxes.reminderAfterHours * HOUR).toISOString(),
      lateFeeAt: new Date(l.booksUntil + cfg.taxes.lateFeeAfterHours * HOUR).toISOString(),
      estimateAt: new Date(l.booksUntil + cfg.taxes.estimateAfterHours * HOUR).toISOString(),
      streak: l.booksStreak,
      lastDay: l.booksDay,
    };
  }

  // ---------------------------------------------------------------- shareholders, dividends, board

  /** Shares (e6): the founder, Ingrid (up to 22 %, from what was sold), the AI float. */
  function shares(company: DemoCompanyState) {
    const total = (company.listing?.sharesTotal ?? 1) * E6;
    const founder = (company.listing?.founderShares ?? 0) * E6;
    const ingridE6 = Math.min(Math.floor(total * 0.22), total - founder);
    return { total, founder, ingrid: ingridE6, float: total - founder - ingridE6 };
  }

  function payDividend(
    company: DemoCompanyState,
    l: DemoListedState,
    totalCents: number,
    source: "founder" | "board",
    now: number,
  ) {
    const sh = shares(company);
    const split = dividendSplit(totalCents, sh.total, [sh.founder, sh.ingrid]);
    company.cashCents -= totalCents;
    book(company, l, -totalCents, "dividend", `Dividende ${company.name}`, null, now);
    host.addCash(split.players[0]!);
    const dividend: ListedDividend = {
      id: (l.seq += 1),
      source,
      totalCents,
      playersCents: split.players[0]! + split.players[1]!,
      floatCents: split.floatCents,
      holders: sh.ingrid > 0 ? 2 : 1,
      paidAt: new Date(now).toISOString(),
    };
    if (l.dividends.every((d) => d.totalCents < totalCents))
      host.feed("record_dividend", { company: company.name, amount_cents: totalCents });
    const today = berlinDay(now);
    l.dividendStreak =
      l.dividendDay === today
        ? l.dividendStreak
        : l.dividendDay === berlinDay(now - 24 * HOUR)
          ? l.dividendStreak + 1
          : 1;
    l.dividendDay = today;
    l.dividends = [dividend, ...l.dividends].slice(0, cfg.dividends.historyLimit);
    host.notify("company_dividend", `Dividende von ${company.name}`, "Dein Anteil ist auf deinem Konto.", "/portfolio");
    return dividend;
  }

  const active = (until: number | null, now: number) => (until !== null && until > now ? until : null);
  function restrictionsView(l: DemoListedState, now: number): ListedRestrictions {
    const r = l.restrictions;
    return {
      payoutCapBps: active(r.payoutCapUntil, now) ? r.payoutCapBps : null,
      payoutCapUntil: iso(active(r.payoutCapUntil, now)),
      withdrawBlockUntil: iso(active(r.withdrawBlockUntil, now)),
      priceLock: active(r.priceLockUntil, now) ? r.priceLock : null,
      priceLockUntil: iso(active(r.priceLockUntil, now)),
    };
  }

  const PURPOSE: Record<ListedPurpose, string> = {
    research: "Forschung",
    products: "Produkte",
    expansion: "Ausbau",
    benefits: "Benefits",
    marketing: "Marketing",
  };
  const euros = (cents: number) => `${Math.round(cents / 100).toLocaleString("de-DE")} €`;
  function motionLabel(kind: BoardMotionKind, p: BoardMotion["params"]): string {
    switch (kind) {
      case "earmark":
        return `${euros(p.amountCents ?? 0)} reservieren für ${PURPOSE[p.purpose ?? "research"]}`;
      case "release":
        return `Budget freigeben: ${PURPOSE[p.purpose ?? "research"]}`;
      case "dividend":
        return `Dividende von ${euros(p.amountCents ?? 0)}`;
      case "payout_cap":
        return `CEO-Auszahlung höchstens ${(p.bps ?? 0) / 100} % für ${p.days} Tage`;
      case "withdraw_ban":
        return `Keine Entnahmen für ${p.days} Tage`;
      case "price_level":
        return `Preisstrategie ${p.priceLevel === "budget" ? "günstig" : p.priceLevel === "premium" ? "Premium" : "normal"} für ${p.days} Tage`;
      case "debt":
        return `Schulden tilgen bis ${euros(p.amountCents ?? 0)}`;
    }
  }

  function execute(company: DemoCompanyState, l: DemoListedState, m: DemoMotion, now: number): Record<string, unknown> {
    const until = now + (m.params.days ?? 1) * 24 * HOUR;
    const free = Math.max(0, freeCash(company, l));
    switch (m.kind) {
      case "earmark": {
        const amount = Math.min(m.params.amountCents ?? 0, free);
        const purpose = m.params.purpose ?? "research";
        l.budgets[purpose] = (l.budgets[purpose] ?? 0) + amount;
        return { amount_cents: amount };
      }
      case "release": {
        const amount = l.budgets[m.params.purpose ?? "research"] ?? 0;
        delete l.budgets[m.params.purpose ?? "research"];
        return { amount_cents: amount };
      }
      case "dividend": {
        const amount = Math.min(m.params.amountCents ?? 0, free);
        return amount > 0
          ? { total_cents: payDividend(company, l, amount, "board", now).totalCents }
          : { total_cents: 0 };
      }
      case "payout_cap":
        l.restrictions.payoutCapBps = m.params.bps ?? 0;
        l.restrictions.payoutCapUntil = until;
        company.founderPayoutBps = Math.min(company.founderPayoutBps ?? 0, m.params.bps ?? 0);
        return { until: iso(until) };
      case "withdraw_ban":
        l.restrictions.withdrawBlockUntil = until;
        return { until: iso(until) };
      case "price_level":
        l.restrictions.priceLock = m.params.priceLevel ?? "normal";
        l.restrictions.priceLockUntil = until;
        company.priceLevel = m.params.priceLevel ?? "normal";
        return { until: iso(until) };
      case "debt": {
        let paid = collect(company, l, m.params.amountCents ?? 0, true, now);
        const bills = Math.min((m.params.amountCents ?? 0) - paid, Math.max(0, company.cashCents), company.unpaidCents);
        if (bills > 0) {
          company.cashCents -= bills;
          company.unpaidCents -= bills;
          book(company, l, -bills, "fixed", "Offene Rechnungen (Geschäftsrat)", null, now);
          paid += bills;
        }
        return { amount_cents: paid };
      }
    }
  }

  /** Counts a motion by shares; ends it when the time is up or one side holds more than half. */
  function tally(company: DemoCompanyState, l: DemoListedState, m: DemoMotion, final: boolean, now: number) {
    if (m.status !== "open") return;
    const sh = shares(company);
    const weight = (name: string) => (name === INGRID ? sh.ingrid : sh.founder);
    let yes = 0;
    let no = 0;
    for (const [name, vote] of Object.entries(m.votes)) {
      if (vote) yes += weight(name);
      else no += weight(name);
    }
    const ai = aiFloatVote(m.kind, l.reputation) === "yes" ? sh.float : 0;
    m.yesE6 = yes;
    m.noE6 = no;
    m.aiE6 = ai;
    if (!final && !boardDecided(yes + ai, no, sh.total)) return;
    m.status = boardOutcome(yes + ai, no, sh.total);
    m.closedAt = now;
    if (m.status === "passed") {
      m.result = execute(company, l, m, now);
      if (m.proposer !== host.nickname() && m.votes[host.nickname()] !== true)
        host.feed("board_revolt", { company: company.name, kind: m.kind });
    }
    host.notify(
      "board",
      `Geschäftsrat ${company.name}: ${m.status === "passed" ? "Antrag angenommen" : m.status === "rejected" ? "Antrag abgelehnt" : "Antrag ohne Mehrheit"}`,
      motionLabel(m.kind, m.params),
      "/company",
    );
  }

  function closeDueMotions(company: DemoCompanyState, l: DemoListedState, now = host.now()) {
    for (const m of l.motions) if (m.status === "open") tally(company, l, m, m.closesAt <= now, now);
  }

  /** Ingrid Invest: brings a payout cap when the founder is greedy, at most once a day. */
  function ingrid(company: DemoCompanyState, l: DemoListedState, now: number) {
    const sh = shares(company);
    if (!canConvene(sh.ingrid, sh.total) || l.reputation >= cfg.board.aiVote.reputationBelow) return;
    if (l.motions.some((m) => m.proposer === INGRID && m.createdAt > now - 24 * HOUR)) return;
    if (l.motions.filter((m) => m.status === "open").length >= cfg.board.maxOpen) return;
    const motion: DemoMotion = {
      id: (l.seq += 1),
      kind: "payout_cap",
      params: { bps: 2_000, days: 3 },
      status: "open",
      proposer: INGRID,
      createdAt: now,
      closesAt: now + cfg.board.voteHours * HOUR,
      closedAt: null,
      votes: { [INGRID]: true },
      yesE6: 0,
      noE6: 0,
      aiE6: 0,
      result: {},
    };
    l.motions = [motion, ...l.motions].slice(0, 40);
    host.notify(
      "board",
      `Geschäftsrat ${company.name}: neuer Antrag`,
      `${motionLabel(motion.kind, motion.params)}. Stimme mit deinen Aktien ab.`,
      "/company",
    );
    tally(company, l, motion, false, now);
  }

  function motionView(company: DemoCompanyState, m: DemoMotion): BoardMotion {
    const me = host.nickname();
    return {
      id: m.id,
      kind: m.kind,
      params: m.params,
      status: m.status,
      label: motionLabel(m.kind, m.params),
      proposer: m.proposer,
      mine: m.proposer === me,
      createdAt: new Date(m.createdAt).toISOString(),
      closesAt: new Date(m.closesAt).toISOString(),
      closedAt: iso(m.closedAt),
      yesE6: m.yesE6,
      noE6: m.noE6,
      aiE6: m.aiE6,
      totalE6: shares(company).total,
      myVote: me in m.votes ? (m.votes[me] ? "yes" : "no") : null,
      votes: Object.entries(m.votes).map(([nickname, yes]) => ({ nickname, yes })),
      result: m.result,
    };
  }

  function boardView(company: DemoCompanyState, l: DemoListedState): CompanyBoard {
    const now = host.now();
    const sh = shares(company);
    const me = host.nickname();
    const open = l.motions.filter((m) => m.status === "open");
    return {
      company: { id: company.id, name: company.name, ticker: company.listing?.ticker ?? null, color: company.color },
      isFounder: true,
      totalE6: sh.total,
      myE6: sh.founder,
      myShareBps: Math.floor((sh.founder * 10_000) / sh.total),
      floatE6: sh.float,
      minShareBps: cfg.board.minShareBps,
      canConvene:
        canConvene(sh.founder, sh.total) &&
        open.length < cfg.board.maxOpen &&
        !l.motions.some((m) => m.proposer === me && m.createdAt > now - cfg.board.cooldownHours * HOUR),
      canVote: sh.founder > 0,
      reputation: Math.round(l.reputation * 10) / 10,
      aiVotes: l.reputation < cfg.board.aiVote.reputationBelow,
      cashCents: company.cashCents,
      freeCashCents: freeCash(company, l),
      holders: [
        { nickname: me, shareBps: Math.floor((sh.founder * 10_000) / sh.total), isFounder: true, me: true },
        ...(sh.ingrid > 0
          ? [{ nickname: INGRID, shareBps: Math.floor((sh.ingrid * 10_000) / sh.total), isFounder: false, me: false }]
          : []),
      ],
      budgets: budgetsView(l),
      restrictions: restrictionsView(l, now),
      founderPayoutBps: company.founderPayoutBps ?? 0,
      motions: open.map((m) => motionView(company, m)),
      history: l.motions
        .filter((m) => m.status !== "open")
        .slice(0, cfg.board.historyLimit)
        .map((m) => motionView(company, m)),
    };
  }

  const budgetsView = (l: DemoListedState) =>
    (Object.entries(l.budgets) as [ListedPurpose, number][])
      .filter(([, v]) => v > 0)
      .map(([purpose, amountCents]) => ({ purpose, amountCents }));

  // ---------------------------------------------------------------- the state

  function view(company: DemoCompanyState, l: DemoListedState): ListedCompany {
    const now = host.now();
    const fx = sumEffects(owned(l));
    const r = ref(l);
    const rp = refProfitCents(profits(l));
    const started = researchStarted(l);
    const sat = satisfactionEffect(l.satisfaction);
    const rep = reputationEffect(l.reputation);
    const sh = shares(company);
    const list = owned(l);
    const free = freeCash(company, l);
    const open = l.motions.filter((m) => m.status === "open");
    return {
      companyId: company.id,
      name: company.name,
      ticker: company.listing?.ticker ?? null,
      cashCents: company.cashCents,
      unpaidCents: company.unpaidCents,
      reservedCents: reserved(l),
      freeCashCents: free,
      refRevenueCents: r,
      refProfitCents: rp,
      avgProfitCents: avgProfitCents(profits(l)),
      researchStarted: started,
      headcount: heads(company),
      founderPayoutBps: company.founderPayoutBps ?? 0,
      reputation: {
        value: Math.round(l.reputation * 100) / 100,
        target: Math.round(l.targets.reputation * 100) / 100,
        demandFactor: rep.demandFactor,
        priceFactor: l.priceFactor,
        payoutRatioBps: l.drivers.payoutRatioBps,
        drivers: l.drivers.reputation,
      },
      satisfaction: {
        value: Math.round(l.satisfaction * 100) / 100,
        target: Math.round(l.targets.satisfaction * 100) / 100,
        zone: satisfactionZone(l.satisfaction),
        green: cfg.satisfaction.green,
        red: cfg.satisfaction.red,
        capacityFactor: sat.capacityFactor,
        qualityAddBps: Math.round(sat.qualityAdd * 10_000),
        redHours: l.redHours,
        drivers: l.drivers.satisfaction,
      },
      effects: fx,
      hour: listedHourEffect(fx, l.satisfaction, l.reputation),
      upkeep: l.lastUpkeep,
      upkeepPerHourCents:
        list.reduce((s, o) => {
          const item = itemByKey(o.key);
          return item && item.kind !== "action" && o.status === "active" && o.level > 0
            ? s + itemUpkeepCents(item, o.level, r, heads(company))
            : s;
        }, 0) + (l.advisor ? advisorWageCents(r) : 0),
      items: cfg.items.map((item) => {
        const mine = l.items[item.key];
        const has = mine && mine.status !== "retired";
        const cooldown =
          item.kind === "action" && mine?.lastUsedAt ? mine.lastUsedAt + (item.cooldownHours ?? 0) * HOUR : null;
        return {
          key: item.key,
          kind: item.kind,
          status: !has || item.kind === "action" ? "none" : (mine.status as "running" | "active" | "paused"),
          level: has ? mine.level : 0,
          maxLevel: item.maxLevel ?? 1,
          readyAt: has ? iso(mine.readyAt) : null,
          cooldownUntil: cooldown !== null && cooldown > now ? iso(cooldown) : null,
          costCents:
            item.kind === "research"
              ? researchCostCents(item, rp, started)
              : itemCostCents(item, has && item.kind !== "action" ? mine.level : 0, r, heads(company)),
          slowCostCents: item.kind === "research" ? researchCostCents(item, rp, started, true) : null,
          slowHours: item.kind === "research" ? researchHours(item, true) : null,
          upkeepCents: itemUpkeepCents(item, Math.max(1, has ? mine.level : 1), r, heads(company)),
          missing: missingRequirements(item, list),
        };
      }),
      budgets: budgetsView(l),
      restrictions: restrictionsView(l, now),
      dividends: {
        maxCents: maxDividendCents(free),
        minCents: cfg.dividends.minTotalCents,
        canDeclare:
          l.dividends.filter((d) => d.source === "founder" && berlinDay(Date.parse(d.paidAt)) === berlinDay(now))
            .length < cfg.dividends.perDay,
        streak: l.dividendDay === berlinDay(now) || l.dividendDay === berlinDay(now - 24 * HOUR) ? l.dividendStreak : 0,
        totalE6: sh.total,
        founderShareBps: Math.floor((sh.founder * 10_000) / sh.total),
        last: l.dividends,
      },
      books: booksView(company, l, now),
      taxes: {
        dueCents: dueCents(l),
        rateBps: rateOf(l),
        lossCarryCents: l.lossCarryCents,
        advisor: l.advisor,
        advisorWageCents: advisorWageCents(r),
        advisorDiscountBps: cfg.taxes.advisor.discountBps,
        periods: l.periods,
      },
      history: l.history,
      board: {
        openMotions: open.length,
        toVote: open.filter((m) => !(host.nickname() in m.votes)).length,
        myShareBps: Math.floor((sh.founder * 10_000) / sh.total),
        canConvene: canConvene(sh.founder, sh.total),
      },
    };
  }

  const mutate = <T>(requestId: string, run: (company: DemoCompanyState, l: DemoListedState) => T): Promise<T> =>
    Promise.resolve().then(() =>
      host.idempotent(requestId, () => {
        const { company, l } = own();
        const result = run(company, l);
        host.persist();
        return result;
      }),
    );

  const engine: ListedEngine = {
    async listedCompany() {
      host.catchUp();
      const company = host.company();
      if (!company) throw new GameError("company_not_found");
      if (!isListed(company)) return null;
      const { l } = own();
      return view(company, l);
    },

    companyInvest: (requestId, key, slow = false) =>
      mutate(requestId, (company, l) => {
        const item = itemByKey(key);
        if (!item) throw new GameError("item_unknown");
        if (slow && item.kind !== "research") throw new GameError("invalid_argument");
        const now = host.now();
        const mine = l.items[key];
        const has = !!mine && (mine.status === "active" || mine.status === "paused") && mine.level > 0;
        if (missingRequirements(item, owned(l)).length > 0) throw new GameError("item_locked");
        if (item.kind === "action") {
          if (mine?.lastUsedAt && mine.lastUsedAt + (item.cooldownHours ?? 0) * HOUR > now)
            throw new GameError("item_running");
        } else if (mine?.readyAt || (has && mine.level >= (item.maxLevel ?? 1))) throw new GameError("item_running");
        const level = has && item.kind !== "action" ? mine.level : 0;
        const cost =
          item.kind === "research"
            ? researchCostCents(item, refProfitCents(profits(l)), researchStarted(l), slow)
            : itemCostCents(item, level, ref(l), heads(company));
        const budget = l.budgets[item.purpose] ?? 0;
        const plain = company.cashCents - company.unpaidCents;
        if (cost > plain - (reserved(l) - budget))
          throw new GameError(cost <= plain ? "budget_reserved" : "insufficient_funds");
        company.cashCents -= cost;
        if (budget > 0) l.budgets[item.purpose] = budget - Math.min(budget, cost);
        book(company, l, -cost, kindCategory(item.kind), item.key, item.key, now);
        if (cost > 0) l.investments.push({ at: now, cents: cost });
        if (item.kind === "action") {
          l.items[key] = { status: "active", level: 0, readyAt: null, lastUsedAt: now };
          l.satisfaction = Math.min(100, l.satisfaction + (item.boost ?? 0));
        } else if (item.hours > 0) {
          l.items[key] = {
            status: has ? mine.status : "running",
            level,
            readyAt: now + (item.kind === "research" ? researchHours(item, slow) : item.hours) * HOUR,
            lastUsedAt: null,
          };
        } else {
          l.items[key] = { status: "active", level: level + 1, readyAt: null, lastUsedAt: null };
          if (item.kind === "benefit") host.track("listed_benefits");
        }
        host.track("listed_invests");
        return view(company, l);
      }),

    companyInvestStop: (requestId, key) =>
      mutate(requestId, (company, l) => {
        const item = itemByKey(key);
        const mine = l.items[key];
        if (
          !item ||
          !mine ||
          mine.status === "retired" ||
          !["product", "region", "licence", "benefit"].includes(item.kind)
        )
          throw new GameError("item_unknown");
        const needed = Object.entries(l.items).some(
          ([k, i]) => k !== key && i.status !== "retired" && (itemByKey(k)?.requires ?? []).includes(key),
        );
        if (needed) throw new GameError("item_locked");
        if (item.kind === "benefit" && mine.status === "active")
          l.satisfaction = Math.max(0, l.satisfaction - (item.effects.satisfaction ?? 0));
        l.items[key] = { status: "retired", level: 0, readyAt: null, lastUsedAt: null };
        return view(company, l);
      }),

    declareDividend: (requestId, totalCents) =>
      mutate(requestId, (company, l) => {
        if (!Number.isInteger(totalCents) || totalCents < cfg.dividends.minTotalCents)
          throw new GameError("invalid_argument");
        const now = host.now();
        const today = berlinDay(now);
        if (
          l.dividends.filter((d) => d.source === "founder" && berlinDay(Date.parse(d.paidAt)) === today).length >=
          cfg.dividends.perDay
        )
          throw new GameError("dividend_limit");
        const free = Math.max(0, freeCash(company, l));
        if (totalCents > free) throw new GameError("insufficient_funds");
        if (totalCents > maxDividendCents(free)) throw new GameError("dividend_limit");
        const d = payDividend(company, l, totalCents, "founder", now);
        host.track("listed_dividends");
        return {
          listed: view(company, l),
          dividend: { totalCents: d.totalCents, playersCents: d.playersCents, floatCents: d.floatCents },
        };
      }),

    closeCompanyBooks: (requestId, answers, pay) =>
      mutate(requestId, (company, l) => {
        const now = host.now();
        if (!booksView(company, l, now).canClose) throw new GameError("books_nothing");
        const correct = gradeReceipts(
          receipts(l).map((r) => r.category),
          answers,
        );
        const period = closeBooks(l, "founder", correct, now);
        const paidCents = pay && dueCents(l) > 0 ? collect(company, l, null, false, now) : 0;
        return { listed: view(company, l), period: l.periods.find((p) => p.id === period.id) ?? period, paidCents };
      }),

    payCompanyTax: (requestId) =>
      mutate(requestId, (company, l) => {
        const due = dueCents(l);
        if (due <= 0) throw new GameError("tax_nothing_due");
        if (company.cashCents < due) throw new GameError("insufficient_funds");
        const paidCents = collect(company, l, null, false, host.now());
        return { listed: view(company, l), paidCents };
      }),

    setTaxAdvisor: (requestId, hire) =>
      mutate(requestId, (company, l) => {
        l.advisor = hire;
        return view(company, l);
      }),

    async companyAccounting(days = 7, before = null) {
      const { company, l } = own();
      const now = host.now();
      const span = Math.min(30, Math.max(1, Math.floor(days)));
      const from = now - span * 24 * HOUR;
      const perDay = new Map<string, CompanyAccounting["days"][number]>();
      const totals: Partial<Record<LedgerCategory, number>> = {};
      for (const e of l.ledger) {
        const at = Date.parse(e.at);
        if (at < from) continue;
        const day = berlinDay(at);
        const d = perDay.get(day) ?? { day, inCents: 0, outCents: 0, operatingCents: 0, byCategory: {} };
        if (e.amountCents > 0) d.inCents += e.amountCents;
        else d.outCents -= e.amountCents;
        if (isOperating(e.category)) d.operatingCents += e.amountCents;
        d.byCategory[e.category] = (d.byCategory[e.category] ?? 0) + e.amountCents;
        totals[e.category] = (totals[e.category] ?? 0) + e.amountCents;
        perDay.set(day, d);
      }
      const page = [...l.ledger]
        .reverse()
        .filter((e) => before === null || e.id < before)
        .slice(0, cfg.accountingPageSize);
      return {
        cashCents: company.cashCents,
        from: new Date(from).toISOString(),
        days: [...perDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
        totals,
        entries: page,
        nextBefore: page.length >= cfg.accountingPageSize ? page[page.length - 1]!.id : null,
      };
    },

    async companyBoard() {
      const { company, l } = own();
      return boardView(company, l);
    },

    proposeBoardMotion: (requestId, _companyId, motion: BoardMotionInput) =>
      mutate(requestId, (company, l) => {
        const now = host.now();
        const sh = shares(company);
        const me = host.nickname();
        if (!canConvene(sh.founder, sh.total)) throw new GameError("board_no_right");
        if (
          l.motions.filter((m) => m.status === "open").length >= cfg.board.maxOpen ||
          l.motions.some((m) => m.proposer === me && m.createdAt > now - cfg.board.cooldownHours * HOUR)
        )
          throw new GameError("board_limit");
        const days = "days" in motion ? motion.days : null;
        if (days !== null && (!Number.isInteger(days) || days < 1 || days > cfg.board.maxDays))
          throw new GameError("invalid_argument");
        if ("amountCents" in motion && (!Number.isInteger(motion.amountCents) || motion.amountCents < 1))
          throw new GameError("invalid_argument");
        if (
          motion.kind === "earmark" &&
          motion.amountCents > (Math.max(0, company.cashCents) * cfg.board.earmarkMaxShareOfCashBps) / 10_000
        )
          throw new GameError("insufficient_funds");
        if (motion.kind === "dividend" && motion.amountCents < cfg.dividends.minTotalCents)
          throw new GameError("invalid_argument");
        if (
          motion.kind === "payout_cap" &&
          (!Number.isInteger(motion.bps) ||
            motion.bps < 0 ||
            motion.bps > 10_000 ||
            motion.bps % cfg.board.payoutCapStepBps !== 0)
        )
          throw new GameError("invalid_argument");
        const { kind, ...params } = motion;
        const m: DemoMotion = {
          id: (l.seq += 1),
          kind,
          params,
          status: "open",
          proposer: me,
          createdAt: now,
          closesAt: now + cfg.board.voteHours * HOUR,
          closedAt: null,
          // Ingrid likes dividends, budgets and discipline; she does not give budgets back.
          votes: sh.ingrid > 0 ? { [me]: true, [INGRID]: kind !== "release" } : { [me]: true },
          yesE6: 0,
          noE6: 0,
          aiE6: 0,
          result: {},
        };
        l.motions = [m, ...l.motions].slice(0, 40);
        tally(company, l, m, false, now);
        return boardView(company, l);
      }),

    voteBoardMotion: (requestId, motionId, yes) =>
      mutate(requestId, (company, l) => {
        const m = l.motions.find((x) => x.id === motionId);
        if (!m || m.status !== "open") throw new GameError("board_motion_unknown");
        m.votes[host.nickname()] = yes;
        host.track("board_votes");
        tally(company, l, m, false, host.now());
        return boardView(company, l);
      }),
  };

  return {
    engine,
    hourTerms,
    afterHour,
    payoutCapBps,
    /** Money earmarked by the board: not free cash. */
    reservedCents: (company: DemoCompanyState) => (isListed(company) && company.listed ? reserved(company.listed) : 0),
    /** A withdrawal: forbidden while the board's ban holds or when it would touch a budget; it is booked. */
    withdraw(company: DemoCompanyState, amountCents: number) {
      if (!isListed(company)) return;
      const l = ensure(company);
      const now = host.now();
      if ((l.restrictions.withdrawBlockUntil ?? 0) > now) throw new GameError("withdraw_blocked");
      if (amountCents <= company.cashCents - company.unpaidCents && amountCents > freeCash(company, l))
        throw new GameError("budget_reserved");
    },
    withdrawn(company: DemoCompanyState, amountCents: number) {
      if (!isListed(company)) return;
      const l = ensure(company);
      l.withdrawals.push({ at: host.now(), cents: amountCents });
      book(company, l, -amountCents, "payout", "Entnahme");
    },
    payoutCheck(company: DemoCompanyState, bps: number) {
      if (bps > payoutCapBps(company, host.now())) throw new GameError("payout_capped");
    },
    strategyCheck(company: DemoCompanyState, priceLevel: PriceLevel) {
      const r = company.listed?.restrictions;
      if (isListed(company) && r?.priceLock && (r.priceLockUntil ?? 0) > host.now() && r.priceLock !== priceLevel)
        throw new GameError("strategy_locked");
    },
  };
}
