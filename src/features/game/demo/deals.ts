import { BALANCE } from "@/config/balance";
import { parseTag } from "@/lib/player-tag";
import {
  loanCollect,
  loanDueCents,
  loanTermsError,
  stakePayoutCents,
  stakeTermsError,
  supplyFeeSplit,
  supplyFreeCapacityCents,
  supplyHour,
  supplyKept,
  supplyPrepayCents,
  supplyTermsError,
  trustBand,
  trustOnEnd,
  trustScore,
  unmetDemandCents,
  type TrustReason,
} from "@/lib/sim/deals";
import { priceEffect } from "@/lib/sim/startup";
import {
  GameError,
  type Deal,
  type DealKind,
  type DealParty,
  type DealRole,
  type DealStatus,
  type DealTerms,
  type DealsOverview,
  type GameEngine,
  type ProposeDealInput,
  type TrustInfo,
} from "../types";
import type { DemoCompanyState, DemoHourView } from "./company";

/*
 * Deals and trust in the offline demo (ADR-098). The demo has no other players, so three invented trading partners
 * stand in: a reliable one, a solid one and a shaky one. They put offers on the board, answer proposals at once by
 * simple rules, and behave like their trust says: the shaky one pays late and breaks a contract with prepayment.
 * Money, fees and payouts follow the same formulas as the server (src/lib/sim/deals.ts).
 */

const HOUR = 3_600_000;
const { deals: cfg } = BALANCE;

interface Bot {
  id: string;
  nickname: string;
  tag: string;
  avatarKey: string;
  level: number;
  trust: number;
  company: { id: string; name: string; sector: "tech" | "retail" | "energy" | "pharma" | "logistics" };
  /** Profit per hour of the bot's company, for stakes in it. */
  profitPerHourCents: number;
}

export const DEAL_BOTS: readonly Bot[] = [
  {
    id: "bot-lina",
    nickname: "Lina_Kontor",
    tag: "L1NA",
    avatarKey: "analyst",
    level: 18,
    trust: 84,
    company: { id: "bot-co-lina", name: "Kontorhaus Lina", sector: "retail" },
    profitPerHourCents: 90_000,
  },
  {
    id: "bot-ole",
    nickname: "Werkbank_Ole",
    tag: "0LEW",
    avatarKey: "builder",
    level: 11,
    trust: 63,
    company: { id: "bot-co-ole", name: "Werkbank Nord", sector: "logistics" },
    profitPerHourCents: 50_000,
  },
  {
    id: "bot-ritter",
    nickname: "Gluecksritter",
    tag: "R1TR",
    avatarKey: "punk",
    level: 9,
    trust: 36,
    company: { id: "bot-co-ritter", name: "Ritter & Funke", sector: "energy" },
    profitPerHourCents: 30_000,
  },
];

const OTHER: Record<DealRole, DealRole> = {
  lender: "borrower",
  borrower: "lender",
  supplier: "buyer",
  buyer: "supplier",
  investor: "company",
  company: "investor",
};

type Who = "me" | string;

interface DemoDeal {
  id: string;
  kind: DealKind;
  status: DealStatus;
  proposer: Who;
  proposerRole: DealRole;
  counterparty: Who | null;
  terms: DealTerms;
  message: string | null;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  endsAt: number | null;
  closedAt: number | null;
  brokenBy: Who | null;
  dueCents: number;
  repaidCents: number;
  deliveredCents: number;
  neededCents: number;
  feesPaidCents: number;
  prepayCents: number;
  prepayLeftCents: number;
  payoutsCents: number;
  /** Stakes in a bot company: hours paid so far. */
  paidHours: number;
  /** Loans to a shaky bot: it pays a day late. */
  lateUntil?: number | null;
}

export interface DemoDealsState {
  deals: DemoDeal[];
  trust: { delta: number; reason: TrustReason; at: number }[];
  boardDay: string | null;
  seq: number;
}

export interface DealHost {
  state(): DemoDealsState;
  nickname(): string;
  tag(): string;
  avatarKey(): string;
  level(): number;
  cashCents(): number;
  addCash(cents: number): void;
  company(): DemoCompanyState | null;
  day(at?: number): string;
  idempotent<T>(requestId: string, run: () => T): T;
  persist(): void;
  feedPost?(kind: string, payload: Record<string, unknown>): void;
}

export const initialDeals = (): DemoDealsState => ({ deals: [], trust: [], boardDay: null, seq: 0 });

export function createDealEngine(host: DealHost) {
  const st = () => host.state();
  const bot = (id: string) => DEAL_BOTS.find((b) => b.id === id);
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

  const myTrust = (): TrustInfo => {
    const s = st();
    const score = trustScore(s.trust.map((t) => t.delta));
    const mine = s.deals.filter((d) => d.proposer === "me" || d.counterparty === "me");
    const kept = mine.filter(
      (d) => d.status === "completed" && roleOf(d, "me") !== "lender" && roleOf(d, "me") !== "investor",
    ).length;
    const broken = mine.filter(
      (d) => d.brokenBy === "me" || (d.status === "defaulted" && roleOf(d, "me") === "borrower"),
    ).length;
    return { score, band: trustBand(score), kept, broken };
  };

  const addTrust = (who: Who, delta: number, reason: TrustReason) => {
    if (who !== "me" || delta === 0) return;
    st().trust.push({ delta, reason, at: Date.now() });
  };

  function party(who: Who): DealParty {
    if (who === "me") {
      const t = myTrust();
      return {
        nickname: host.nickname(),
        tag: host.tag(),
        avatarKey: host.avatarKey(),
        level: host.level(),
        trust: { score: t.score, band: t.band },
      };
    }
    const b = bot(who)!;
    return {
      nickname: b.nickname,
      tag: b.tag,
      avatarKey: b.avatarKey,
      level: b.level,
      trust: { score: b.trust, band: trustBand(b.trust) },
    };
  }

  function roleOf(d: DemoDeal, who: Who): DealRole | null {
    if (d.proposer === who) return d.proposerRole;
    if (d.counterparty === who) return OTHER[d.proposerRole];
    return null;
  }

  /** The other side of the deal as seen by `who`. */
  const otherOf = (d: DemoDeal, who: Who): Who | null => (d.proposer === who ? d.counterparty : d.proposer);

  function companyOf(who: Who | null) {
    if (who === null) return null;
    if (who === "me") {
      const c = host.company();
      return c ? { id: c.id, name: c.name } : null;
    }
    const b = bot(who);
    return b ? { id: b.company.id, name: b.company.name } : null;
  }

  function sideWith(d: DemoDeal, role: DealRole): Who | null {
    if (d.proposerRole === role) return d.proposer;
    return OTHER[d.proposerRole] === role ? d.counterparty : null;
  }

  function toDeal(d: DemoDeal): Deal {
    const other = otherOf(d, "me");
    const left = Math.max(0, d.dueCents - d.repaidCents);
    return {
      id: d.id,
      kind: d.kind,
      status: d.status,
      myRole: roleOf(d, "me"),
      proposerRole: d.proposerRole,
      isProposer: d.proposer === "me",
      proposer: party(d.proposer),
      counterparty: d.proposer === "me" ? (d.counterparty ? party(d.counterparty) : null) : other ? party("me") : null,
      supplierCompany: d.kind === "supply" ? companyOf(sideWith(d, "supplier")) : null,
      buyerCompany: d.kind === "supply" ? companyOf(sideWith(d, "buyer")) : null,
      company: d.kind === "stake" ? companyOf(sideWith(d, "company")) : null,
      terms: { ...d.terms },
      message: d.message,
      createdAt: iso(d.createdAt)!,
      expiresAt: iso(d.expiresAt),
      acceptedAt: iso(d.acceptedAt),
      endsAt: iso(d.endsAt),
      closedAt: iso(d.closedAt),
      progress:
        d.kind === "loan"
          ? { dueCents: d.dueCents, repaidCents: d.repaidCents, leftCents: left }
          : d.kind === "supply"
            ? {
                deliveredCents: d.deliveredCents,
                neededCents: d.neededCents,
                feesPaidCents: d.feesPaidCents,
                prepayCents: d.prepayCents,
                prepayLeftCents: d.prepayLeftCents,
              }
            : { payoutsCents: d.payoutsCents },
      brokenByMe: d.brokenBy === "me",
    };
  }

  // ---------------------------------------------------------------- the board

  /** Three or four bot offers a day, so the board is never empty in the demo. */
  function refreshBoard(now: number) {
    const s = st();
    const day = host.day(now);
    if (s.boardDay === day) return;
    s.boardDay = day;
    s.deals = s.deals.filter((d) => !(d.status === "open" && d.proposer !== "me"));
    const offer = (proposer: string, kind: DealKind, role: DealRole, terms: DealTerms, message: string) =>
      s.deals.push(blank(proposer, kind, role, null, terms, message, now));
    offer(
      "bot-lina",
      "loan",
      "lender",
      { principalCents: 2_000_000, interestBps: 600, hours: 72 },
      "Fairer Kredit, pünktlich zurück und gut ist.",
    );
    offer(
      "bot-ole",
      "stake",
      "company",
      { amountCents: 1_500_000, shareBps: 1_200, hours: 72 },
      "Werkbank Nord sucht Teilhaber für neue Maschinen.",
    );
    offer(
      "bot-ritter",
      "supply",
      "supplier",
      { volumeCentsPerHour: 150_000, feeBps: 5_500, prepayBps: 3_000, hours: 48 },
      "Freie Kapazität, günstig. Anzahlung vorab, dann läuft das.",
    );
    offer(
      "bot-ritter",
      "loan",
      "borrower",
      { principalCents: 1_000_000, interestBps: 1_500, hours: 48 },
      "Brauche kurz Geld, zahle gut zurück!",
    );
  }

  function blank(
    proposer: Who,
    kind: DealKind,
    role: DealRole,
    counterparty: Who | null,
    terms: DealTerms,
    message: string | null,
    now: number,
  ): DemoDeal {
    return {
      id: `deal-${++st().seq}`,
      kind,
      status: "open",
      proposer,
      proposerRole: role,
      counterparty,
      terms,
      message,
      createdAt: now,
      expiresAt: now + cfg.offerValidHours * HOUR,
      acceptedAt: null,
      endsAt: null,
      closedAt: null,
      brokenBy: null,
      dueCents: 0,
      repaidCents: 0,
      deliveredCents: 0,
      neededCents: 0,
      feesPaidCents: 0,
      prepayCents: 0,
      prepayLeftCents: 0,
      payoutsCents: 0,
      paidHours: 0,
    };
  }

  // ---------------------------------------------------------------- accept

  function needsCompany(role: DealRole) {
    return role === "supplier" || role === "buyer" || role === "company";
  }

  /** Fixes the parties and moves the money at acceptance, like the server. */
  function activate(d: DemoDeal, acceptor: Who, now: number) {
    if (d.counterparty === null) d.counterparty = acceptor;
    const me = roleOf(d, "me");
    if (me && needsCompany(me) && !host.company()) throw new GameError("deal_needs_company");
    const t = d.terms;
    if (d.kind === "loan") {
      const principal = t.principalCents ?? 0;
      if (me === "lender") {
        if (host.cashCents() < principal) throw new GameError("insufficient_funds");
        host.addCash(-principal);
      } else host.addCash(principal);
      d.dueCents = Number(loanDueCents(BigInt(principal), t.interestBps ?? 0));
      // The shaky partner pays a day late (ADR-098: trust shows how people behave).
      const lender = sideWith(d, "lender");
      const borrower = sideWith(d, "borrower");
      if (lender === "me" && borrower && bot(borrower)!.trust < 45) d.lateUntil = now + (t.hours + 24) * HOUR;
    } else if (d.kind === "supply") {
      d.prepayCents = Number(
        supplyPrepayCents({
          volumeCentsPerHour: t.volumeCentsPerHour ?? 0,
          feeBps: t.feeBps ?? 0,
          prepayBps: t.prepayBps ?? 0,
          hours: t.hours,
        }),
      );
      d.prepayLeftCents = d.prepayCents;
      const company = host.company()!;
      if (me === "buyer") {
        if (company.cashCents - company.unpaidCents < d.prepayCents) throw new GameError("insufficient_funds");
        company.cashCents -= d.prepayCents;
      } else company.cashCents += d.prepayCents;
    } else {
      const amount = t.amountCents ?? 0;
      if (me === "investor") {
        if (host.cashCents() < amount) throw new GameError("insufficient_funds");
        host.addCash(-amount);
      } else host.company()!.cashCents += amount;
    }
    d.status = "active";
    d.acceptedAt = now;
    d.endsAt = now + t.hours * HOUR;
    host.feedPost?.("deal_signed", { kind: d.kind, with: party(otherOf(d, "me")!).nickname });
  }

  /** A bot's answer to a proposal: simple, readable rules. */
  function botAccepts(b: Bot, d: DemoDeal): boolean {
    const t = d.terms;
    const myTrustScore = myTrust().score;
    switch (OTHER[d.proposerRole]) {
      case "borrower":
        return (t.interestBps ?? 0) <= 1_500;
      case "lender":
        return myTrustScore >= 30 && (t.interestBps ?? 0) >= 500;
      case "buyer":
        return (t.feeBps ?? 0) <= 7_000;
      case "supplier":
        return (t.feeBps ?? 0) >= 5_000;
      case "investor":
        return myTrustScore >= 45 && (t.shareBps ?? 0) >= 1_000 && b.trust >= 0;
      case "company":
        return true;
    }
  }

  // ---------------------------------------------------------------- settlement

  function close(d: DemoDeal, status: DealStatus, now: number) {
    d.status = status;
    d.closedAt = now;
  }

  /** Loans, stakes in bot companies and contract ends: everything time does. */
  function settle(now = Date.now()) {
    const s = st();
    refreshBoard(now);
    for (const d of s.deals) {
      if (d.status === "open" && now >= d.expiresAt) close(d, "expired", d.expiresAt);
      // The player's open offers find a bot taker after two minutes.
      if (d.status === "open" && d.proposer === "me" && d.counterparty === null && now - d.createdAt >= 120_000) {
        const taker = DEAL_BOTS.find((b) => botAccepts(b, d));
        if (taker) {
          try {
            activate(d, taker.id, now);
          } catch {
            /* the player cannot pay the deal any more: it stays open */
          }
        }
      }
      if (d.kind === "loan") settleLoan(d, now);
      if (d.kind === "stake") settleBotStake(d, now);
      if (
        (d.kind === "supply" || d.kind === "stake") &&
        d.status === "active" &&
        d.endsAt !== null &&
        now >= d.endsAt
      ) {
        endContract(d, d.endsAt);
      }
      // The shaky supplier breaks a contract with prepayment halfway and keeps the rest.
      if (
        d.kind === "supply" &&
        d.status === "active" &&
        d.prepayLeftCents > 0 &&
        sideWith(d, "supplier") === "bot-ritter" &&
        d.acceptedAt !== null &&
        d.endsAt !== null &&
        now >= d.acceptedAt + (d.endsAt - d.acceptedAt) / 2
      ) {
        d.brokenBy = "bot-ritter";
        close(d, "broken", now);
      }
    }
  }

  function settleLoan(d: DemoDeal, now: number) {
    if (!["active", "overdue", "defaulted"].includes(d.status) || d.endsAt === null) return;
    const me = roleOf(d, "me");
    const left = d.dueCents - d.repaidCents;
    if (me === "borrower") {
      if (d.status === "active" && now >= d.endsAt) {
        const paid = Number(loanCollect(BigInt(left), BigInt(Math.max(0, host.cashCents()))).paidCents);
        host.addCash(-paid);
        d.repaidCents += paid;
        if (d.repaidCents >= d.dueCents) {
          addTrust("me", trustOnEnd("loan", "kept").obligor, "loanRepaidOnTime");
          close(d, "completed", d.endsAt);
        } else {
          addTrust("me", BALANCE.trust.deltas.loanOverdue, "loanOverdue");
          d.status = "overdue";
        }
      }
      if (d.status === "overdue" && now >= d.endsAt + cfg.loan.defaultAfterHours * HOUR) {
        addTrust("me", BALANCE.trust.deltas.loanDefaulted, "loanDefaulted");
        d.status = "defaulted";
      }
      return;
    }
    // A bot borrows from the player: reliable bots pay at the due date, the shaky one a day later.
    const due = d.lateUntil ?? d.endsAt;
    if (now >= d.endsAt && d.status === "active" && d.lateUntil) d.status = "overdue";
    if (now >= due) {
      host.addCash(left);
      d.repaidCents = d.dueCents;
      addTrust("me", BALANCE.trust.deltas.loanLent, "loanLent");
      close(d, "completed", due);
    }
  }

  /** The player holds a stake in a bot company: a share of its profit every full hour. */
  function settleBotStake(d: DemoDeal, now: number) {
    if (d.status !== "active" || roleOf(d, "me") !== "investor" || d.acceptedAt === null || d.endsAt === null) return;
    const b = bot(sideWith(d, "company")!);
    if (!b) return;
    const hours = Math.floor((Math.min(now, d.endsAt) - d.acceptedAt) / HOUR);
    for (; d.paidHours < hours; d.paidHours++) {
      const pay = Number(
        stakePayoutCents(BigInt(b.profitPerHourCents), d.terms.shareBps ?? 0, BigInt(b.profitPerHourCents)),
      );
      host.addCash(pay);
      d.payoutsCents += pay;
    }
  }

  function endContract(d: DemoDeal, at: number) {
    if (d.kind === "supply") {
      const kept = supplyKept(BigInt(d.deliveredCents), BigInt(d.neededCents));
      const t = trustOnEnd("supply", kept ? "kept" : "short");
      const me = roleOf(d, "me");
      addTrust("me", me === "supplier" ? t.obligor : t.other, kept || me === "buyer" ? "supplyKept" : "supplyShort");
      // The rest of the prepayment goes back to the buyer.
      const company = host.company();
      if (company && d.prepayLeftCents > 0)
        company.cashCents += me === "buyer" ? d.prepayLeftCents : -d.prepayLeftCents;
      d.prepayLeftCents = 0;
    } else if (roleOf(d, "me") === "company") {
      addTrust("me", trustOnEnd("stake", "kept").obligor, "stakeKept");
    }
    close(d, "completed", at);
  }

  // ---------------------------------------------------------------- hooks for the company hour

  /** Bots holding a stake in the player's company get their share first (ADR-098). */
  function stakePayout(company: DemoCompanyState, profitCents: number, freeCashCents: number): number {
    let free = freeCashCents;
    let paid = 0;
    for (const d of st().deals) {
      if (d.kind !== "stake" || d.status !== "active" || roleOf(d, "me") !== "company") continue;
      const pay = Number(stakePayoutCents(BigInt(profitCents), d.terms.shareBps ?? 0, BigInt(Math.max(0, free))));
      free -= pay;
      paid += pay;
      d.payoutsCents += pay;
    }
    void company;
    return paid;
  }

  /** Supply contracts of the player's company for one closed hour. */
  function afterHour(company: DemoCompanyState, hour: DemoHourView) {
    const lines = { supplyRevenueCents: 0, supplyFeePaidCents: 0, supplyFeeIncomeCents: 0, supplyGoodsCents: 0 };
    for (const d of st().deals) {
      if (d.kind !== "supply" || d.status !== "active" || d.acceptedAt === null || hour.at < d.acceptedAt) continue;
      const me = roleOf(d, "me");
      const other = bot(otherOf(d, "me")!);
      if (!other) continue;
      const volume = d.terms.volumeCentsPerHour ?? 0;
      const feeBps = d.terms.feeBps ?? 0;
      if (me === "buyer") {
        const r = supplyHour({
          volumeCentsPerHour: volume,
          feeBps,
          buyerUnmetCents: unmetDemandCents(hour.capacityCents, hour.demandCents),
          supplierFreeCents: volume,
          buyerPrice: priceEffect(company.priceLevel, company.quality).price,
          supplierGrossMargin: BALANCE.startups.grossMargin[other.company.sector],
        });
        const fee = Number(r.feeCents);
        const split = supplyFeeSplit(r.feeCents, BigInt(d.prepayLeftCents));
        d.prepayLeftCents -= Number(split.fromPrepay);
        company.cashCents += Number(r.buyerRevenueCents) - Number(split.fromCash);
        lines.supplyRevenueCents += Number(r.buyerRevenueCents);
        lines.supplyFeePaidCents += Number(split.fromCash);
        d.deliveredCents += Number(r.deliveredCents);
        d.neededCents += Number(r.neededCents);
        d.feesPaidCents += fee;
      } else if (me === "supplier") {
        const r = supplyHour({
          volumeCentsPerHour: volume,
          feeBps,
          // A bot buyer can always use most of the volume.
          buyerUnmetCents: Math.round(volume * 0.8),
          supplierFreeCents: supplyFreeCapacityCents(
            hour.capacityCents,
            hour.demandCents,
            company.contractWork ?? true,
          ),
          buyerPrice: 1,
          supplierGrossMargin: BALANCE.startups.grossMargin[company.sector],
        });
        const split = supplyFeeSplit(r.feeCents, BigInt(d.prepayLeftCents));
        d.prepayLeftCents -= Number(split.fromPrepay);
        company.cashCents += Number(split.fromCash) - Number(r.supplierGoodsCents);
        lines.supplyFeeIncomeCents += Number(split.fromCash);
        lines.supplyGoodsCents += Number(r.supplierGoodsCents);
        d.deliveredCents += Number(r.deliveredCents);
        d.neededCents += Number(r.neededCents);
        d.feesPaidCents += Number(r.feeCents);
      }
    }
    return lines;
  }

  // ---------------------------------------------------------------- engine

  const find = (id: string) => {
    const d = st().deals.find((x) => x.id === id);
    if (!d) throw new GameError("deal_not_found");
    return d;
  };

  const run = <T>(requestId: string, fn: () => T) =>
    Promise.resolve().then(() =>
      host.idempotent(requestId, () => {
        settle();
        const result = fn();
        host.persist();
        return result;
      }),
    );

  function resolveCounterparty(input: string): string {
    const q = input.trim().replace(/^#/, "");
    if (q.toLowerCase() === host.nickname().toLowerCase() || parseTag(q) === host.tag()) {
      throw new GameError("deal_self");
    }
    const b = DEAL_BOTS.find((x) => x.nickname.toLowerCase() === q.toLowerCase() || x.tag === parseTag(q));
    if (!b) throw new GameError("player_not_found");
    return b.id;
  }

  function checkTerms(kind: DealKind, terms: DealTerms, lenderLevel: number) {
    const error =
      kind === "loan"
        ? loanTermsError(
            { principalCents: terms.principalCents ?? 0, interestBps: terms.interestBps ?? 0, hours: terms.hours },
            lenderLevel,
          )
        : kind === "supply"
          ? supplyTermsError({
              volumeCentsPerHour: terms.volumeCentsPerHour ?? 0,
              feeBps: terms.feeBps ?? 0,
              prepayBps: terms.prepayBps ?? 0,
              hours: terms.hours,
            })
          : stakeTermsError({ amountCents: terms.amountCents ?? 0, shareBps: terms.shareBps ?? 0, hours: terms.hours });
    if (error) throw new GameError("deal_terms");
  }

  const engine: Pick<
    GameEngine,
    "deals" | "dealBoard" | "proposeDeal" | "respondDeal" | "cancelDeal" | "breakDeal" | "repayLoan" | "forgiveLoan"
  > = {
    async deals(): Promise<DealsOverview> {
      settle();
      host.persist();
      const mine = st().deals.filter((d) => d.proposer === "me" || d.counterparty === "me");
      const byNew = (a: DemoDeal, b: DemoDeal) => b.createdAt - a.createdAt;
      return {
        incoming: mine
          .filter((d) => d.status === "open" && d.counterparty === "me")
          .sort(byNew)
          .map(toDeal),
        outgoing: mine
          .filter((d) => d.status === "open" && d.proposer === "me")
          .sort(byNew)
          .map(toDeal),
        running: mine
          .filter((d) => ["active", "overdue", "defaulted"].includes(d.status))
          .sort(byNew)
          .map(toDeal),
        history: mine
          .filter((d) => !["open", "active", "overdue", "defaulted"].includes(d.status))
          .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
          .slice(0, 20)
          .map(toDeal),
        trust: myTrust(),
      };
    },

    async dealBoard() {
      settle();
      host.persist();
      return st()
        .deals.filter((d) => d.status === "open" && d.counterparty === null && d.proposer !== "me")
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(toDeal);
    },

    proposeDeal: (input: ProposeDealInput) =>
      run(input.requestId, () => {
        if (host.level() < cfg.minLevel) throw new GameError("locked");
        if (st().deals.filter((d) => d.status === "open" && d.proposer === "me").length >= cfg.maxOpenOffers) {
          throw new GameError("deal_limit");
        }
        if (needsCompany(input.role) && !host.company()) throw new GameError("deal_needs_company");
        checkTerms(input.kind, input.terms, input.role === "lender" ? host.level() : 99);
        const counterparty = input.counterparty?.trim() ? resolveCounterparty(input.counterparty) : null;
        const now = Date.now();
        const d = blank(
          "me",
          input.kind,
          input.role,
          counterparty,
          { ...input.terms },
          input.message.trim() || null,
          now,
        );
        st().deals.push(d);
        // Bots answer at once.
        if (counterparty) {
          const b = bot(counterparty)!;
          if (botAccepts(b, d)) activate(d, counterparty, now);
          else close(d, "declined", now);
        }
        return toDeal(d);
      }),

    respondDeal: (requestId, dealId, accept) =>
      run(requestId, () => {
        const d = find(dealId);
        if (d.status !== "open") throw new GameError("deal_closed");
        if (d.proposer === "me") throw new GameError("invalid_argument");
        if (!accept) {
          if (d.counterparty !== "me") throw new GameError("invalid_argument");
          close(d, "declined", Date.now());
          return toDeal(d);
        }
        if (host.level() < cfg.minLevel) throw new GameError("locked");
        if (d.kind === "loan" && OTHER[d.proposerRole] === "lender") {
          checkTerms("loan", d.terms, host.level());
        }
        activate(d, "me", Date.now());
        return toDeal(d);
      }),

    cancelDeal: (requestId, dealId) =>
      run(requestId, () => {
        const d = find(dealId);
        if (d.proposer !== "me") throw new GameError("deal_not_found");
        if (d.status !== "open") throw new GameError("deal_closed");
        close(d, "cancelled", Date.now());
        return toDeal(d);
      }),

    breakDeal: (requestId, dealId) =>
      run(requestId, () => {
        const d = find(dealId);
        const me = roleOf(d, "me");
        if (d.status !== "active") throw new GameError("deal_closed");
        if (d.kind === "loan" || me === "investor" || me === null) throw new GameError("invalid_argument");
        d.brokenBy = "me";
        addTrust("me", BALANCE.trust.deltas.dealBroken, "dealBroken");
        // The rest of the prepayment stays with the supplier.
        d.prepayLeftCents = 0;
        close(d, "broken", Date.now());
        host.feedPost?.("deal_broken", { kind: d.kind, with: party(otherOf(d, "me")!).nickname });
        return toDeal(d);
      }),

    repayLoan: (requestId, dealId, amountCents) =>
      run(requestId, () => {
        const d = find(dealId);
        if (d.kind !== "loan" || roleOf(d, "me") !== "borrower") throw new GameError("invalid_argument");
        if (!["active", "overdue", "defaulted"].includes(d.status)) throw new GameError("deal_closed");
        if (!Number.isInteger(amountCents) || amountCents <= 0) throw new GameError("invalid_argument");
        if (host.cashCents() < amountCents) throw new GameError("insufficient_funds");
        const pay = Math.min(amountCents, d.dueCents - d.repaidCents);
        host.addCash(-pay);
        d.repaidCents += pay;
        if (d.repaidCents >= d.dueCents) {
          const onTime = d.endsAt !== null && Date.now() <= d.endsAt;
          addTrust(
            "me",
            trustOnEnd("loan", onTime ? "kept" : "late").obligor,
            onTime ? "loanRepaidOnTime" : "loanRepaidLate",
          );
          close(d, "completed", Date.now());
        }
        return toDeal(d);
      }),

    forgiveLoan: (requestId, dealId) =>
      run(requestId, () => {
        const d = find(dealId);
        if (d.kind !== "loan" || roleOf(d, "me") !== "lender") throw new GameError("invalid_argument");
        if (!["active", "overdue", "defaulted"].includes(d.status)) throw new GameError("deal_closed");
        addTrust("me", trustOnEnd("loan", "forgiven").other, "loanForgiven");
        close(d, "forgiven", Date.now());
        return toDeal(d);
      }),
  };

  return { engine, trust: myTrust, stakePayout, afterHour, settle };
}
