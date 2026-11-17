import { BALANCE } from "@/config/balance";
import { NEXAMON_CARDS, NEXAMON_SETS, nexamonCard, type NexamonRarity, type NexamonSetKey } from "@/config/nexamon";
import type { NexamonCondition } from "@/config/nexamon-rules";
import {
  nexamonAiAskCents,
  nexamonAiBuyChanceBps,
  nexamonAiBuyCounts,
  nexamonCentsFromE4,
  nexamonClampValue,
  nexamonCopyFactorBps,
  nexamonCopyValueCents,
  nexamonE4FromCents,
  nexamonGradingFeeCents,
  nexamonMarketFeeCents,
  nexamonOpenPack,
  nexamonPackRule,
  nexamonPopularityBps,
  nexamonPriceIsPlausible,
  nexamonPricePerCardE4,
  nexamonQuickSellCents,
  nexamonRollCondition,
  nexamonIsBlackLabel,
  nexamonRollGrade,
  nexamonSaleCounts,
  nexamonSeedCopies,
  nexamonValueAfterAiBuy,
  nexamonValueAfterPressure,
  nexamonValueAfterQuickSell,
  nexamonValueAfterSale,
  nexamonValueBounds,
  nexamonSetReleased,
} from "@/lib/sim/nexamon";
import { divRoundHalfEven } from "@/lib/sim/money";
import {
  nexamonBonusCatalogue,
  nexamonBonusSummary,
  nexamonBoostedBps,
  nexamonCollectionReward,
  nexamonHypeBaseBps,
  nexamonHypeChanceBps,
  nexamonHypeStep,
  type NexamonBonusKind,
} from "@/lib/sim/nexamon-bonuses";
import { createRng } from "@/lib/sim/rng";
import { unlockLevel } from "@/lib/sim/progression";
import type {
  NexamonBonuses,
  NexamonCardStats,
  NexamonCopy,
  NexamonEngine,
  NexamonListing,
  NexamonPackResult,
  NexamonPull,
  NexamonSale,
  NexamonSaleKind,
  PlayerNexamon,
  PlayerNexamonCard,
} from "../nexamon-types";
import { GameError } from "../types";

/*
 * Nexamon cards in the offline demo (ADR-165): the same rules as the server (src/lib/sim/nexamon.ts), with one
 * player and the AI sellers. Time passes when the demo is used: due gradings, the AI's packs, AI purchases and the
 * hourly supply and demand step are caught up on every call. The AI's stock is kept short (a few copies per card);
 * the populations still count every pull. The AI never offers a legendary here.
 */
const cfg = BALANCE.nexamon;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Copies of a card the demo keeps in the AI's stock; more only count for the population. */
const AI_STOCK_CAP = 12;
const MAX_SALES = 400;
const MAX_POINTS = 240;
/** Catch-up limits after a long pause. */
const MAX_PRESSURE_STEPS = 24;
const MAX_AI_PACKS = 40;

interface DemoCard {
  valueE4: number;
  population: number;
  trades: number;
  dayRefE4: number;
  dayRefOn: string;
  moved: boolean;
  firstPulledAt: number | null;
  /** The AI's copies; the first ai.listedPerCard are on offer. */
  ai: { serial: number; condition: NexamonCondition }[];
}

interface DemoCopy {
  id: string;
  cardKey: string;
  serial: number;
  condition: NexamonCondition;
  grade: number | null;
  gradingUntil: number | null;
  gradedAt: number | null;
  acquiredAt: number;
  listing: { id: string; priceCents: number; listedAt: number } | null;
}

interface DemoSale {
  cardKey: string;
  at: number;
  priceCents: number;
  condition: NexamonCondition;
  grade: number | null;
  kind: NexamonSaleKind;
  seller: string;
  buyer: string;
  counted: boolean;
}

export interface DemoNexamonState {
  cards: Record<string, DemoCard>;
  copies: DemoCopy[];
  sales: DemoSale[];
  /** Value history per card: [time, value]. */
  points: Record<string, [number, number][]>;
  packs: Partial<Record<NexamonSetKey, number>>;
  packTimes: number[];
  aiPacksAt: Partial<Record<NexamonSetKey, number>>;
  pressureAt: number;
  tickAt: number;
  createdAt: number;
  nextId: number;
  /** ADR-171: active bonus source ids, effective bps per kind, first completions (id -> time). */
  bonusActive?: string[];
  bonusEffective?: Partial<Record<NexamonBonusKind, number>>;
  completions?: Record<string, number>;
  /** ADR-171: Black Label hype per card: factor, last hour handled, last jump, history [time, factor, jump]. */
  hype?: Record<string, { bps: number; at: number; jumpAt: number | null; points: [number, number, number][] }>;
  /** ADR-174: the One of Ones pulled in this demo (card key -> time); each exists once. */
  oneOfOnes?: Record<string, number>;
}

/** The effective card bonus of a kind in the demo (ADR-171), for the XP and money paths of the demo engine. */
export function demoNexamonBonusBps(state: DemoNexamonState | undefined, kind: NexamonBonusKind): number {
  return state?.bonusEffective?.[kind] ?? 0;
}

const BONUS_CARDS = NEXAMON_CARDS.map(({ key, set, number, rarity, type }) => ({ key, set, number, rarity, type }));
const BONUS_DEFS = new Map(Object.entries(nexamonBonusCatalogue(BONUS_CARDS)));
const MAX_HYPE_POINTS = 60;
const collectionId = (c: { set: string; kind: string; type: string | null }) =>
  `col:${c.set}:${c.kind}${c.type ? `:${c.type}` : ""}`;

export interface NexamonHost {
  state(): DemoNexamonState | undefined;
  setState(value: DemoNexamonState): void;
  level(): number;
  nickname(): string;
  cashCents(): number;
  /** Money leaves the player. */
  pay(cents: number): void;
  /** Money reaches the player (income: an open forced loan keeps its share). */
  earn(cents: number): void;
  feed(kind: string, payload: Record<string, unknown>): void;
  notify(typeKey: string, title: string, body: string | null, link: string | null): void;
  track(
    metric:
      | "nexamon_packs"
      | "nexamon_rares"
      | "nexamon_ultras"
      | "nexamon_sold"
      | "nexamon_tens"
      | "nexamon_black_labels"
      | "nexamon_bonus_cards"
      | "nexamon_type_sets"
      | "nexamon_full_sets",
    by?: number,
  ): void;
  /** XP for a first collection completion (ADR-171); optional in tests. */
  xp?(amount: number): void;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
  random(): number;
  /** Level of another player the demo knows (a made-up friend or colleague); null = nobody of that name. */
  playerLevel?(nickname: string): number | null;
}

/** Packs a made-up player has opened, by level: nothing below the unlock, more with every level. */
const OTHER_PACKS_PER_LEVEL = 6;
const OTHER_PACKS_MAX = 90;

/**
 * The cards of a made-up player (a demo friend), always the same for a name and level: packs opened with a
 * seeded generator, some of the better cards graded. They only exist on the profile: the demo's populations and
 * market do not know them.
 */
export function demoOtherCopies(
  nickname: string,
  level: number,
  unlockAt: number,
): { cardKey: string; serial: number; condition: NexamonCondition; grade: number | null }[] {
  if (level < unlockAt) return [];
  const rng = createRng(165).derive("profile", nickname.toLowerCase());
  const packs = Math.min(OTHER_PACKS_MAX, (level - unlockAt + 1) * OTHER_PACKS_PER_LEVEL);
  const copies: { cardKey: string; serial: number; condition: NexamonCondition; grade: number | null }[] = [];
  for (let i = 0; i < packs; i++) {
    // mostly the cheap set, now and then a better pack
    const roll = rng.next();
    const set = roll < 0.7 ? NEXAMON_SETS[0] : roll < 0.95 ? NEXAMON_SETS[1]! : NEXAMON_SETS[2]!;
    const cards = NEXAMON_CARDS.filter((c) => c.set === set);
    for (const pull of nexamonOpenPack(cards, rng.next)) {
      const graded = pull.rarity !== "common" && rng.next() < 0.4;
      copies.push({
        cardKey: pull.key,
        serial: 1 + Math.floor(rng.next() * 40),
        condition: pull.condition,
        grade: graded ? nexamonRollGrade(pull.condition, rng.next()) : null,
      });
    }
  }
  return copies;
}

const berlinDay = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
const iso = (ms: number) => new Date(ms).toISOString();
const SELLERS = cfg.ai.sellers;
const sellerOf = (n: number) => SELLERS[Math.abs(n) % SELLERS.length]!;
const aiListingId = (cardKey: string, serial: number) => `ai:${cardKey}:${serial}`;

/** 0-based rank of every card by start price among the cards of its rarity and set. */
const PRICE_RANK = new Map<string, number>();
for (const set of NEXAMON_SETS) {
  const bySet = NEXAMON_CARDS.filter((c) => c.set === set);
  for (const rarity of new Set(bySet.map((c) => c.rarity))) {
    bySet
      .filter((c) => c.rarity === rarity)
      .sort((a, b) => a.startPriceCents - b.startPriceCents || a.number - b.number)
      .forEach((c, i) => PRICE_RANK.set(c.key, i));
  }
}

function seedCard(key: string, now: number): DemoCard {
  const card = nexamonCard(key)!;
  const rng = createRng(165).derive("seed", key);
  const copies = nexamonSeedCopies(card.rarity, PRICE_RANK.get(key) ?? 0);
  const startE4 = nexamonE4FromCents(card.startPriceCents);
  return {
    valueE4: startE4,
    population: copies,
    trades: 0,
    dayRefE4: startE4,
    dayRefOn: berlinDay(now),
    moved: false,
    firstPulledAt: copies > 0 ? now : null,
    ai: Array.from({ length: copies }, (_, i) => ({ serial: i + 1, condition: nexamonRollCondition(rng.next()) })),
  };
}

/** Demo Pack Battles (ADR-172): both packs of a battle, rolled at once; `iWin` decides who keeps all copies. */
export interface DemoBattlePacks {
  /**
   * ADR-177: opens a sealed pack (won or bought earlier) with the pull of a bought pack, nothing to pay; `priceCents`
   * is what was paid back then (0 for a prize).
   */
  demoOpenSealedPack(requestId: string, set: NexamonSetKey, priceCents: number): Promise<NexamonPackResult>;
  demoBattlePacks(
    set: NexamonSetKey,
    iWin: (mine: NexamonPull[], theirs: NexamonPull[]) => boolean,
  ): {
    mine: NexamonPull[];
    theirs: NexamonPull[];
    won: boolean;
  };
}

export function createNexamonEngine(host: NexamonHost): NexamonEngine & DemoBattlePacks {
  /** The state, with every card of the catalogue present; a card that never moved follows the catalogue. */
  function st(): DemoNexamonState {
    const now = host.now();
    let s = host.state();
    if (!s) {
      s = {
        cards: {},
        copies: [],
        sales: [],
        points: {},
        packs: {},
        packTimes: [],
        aiPacksAt: {},
        pressureAt: now,
        tickAt: now,
        createdAt: now,
        nextId: 1,
      };
      host.setState(s);
    }
    for (const card of NEXAMON_CARDS) {
      const c = (s.cards[card.key] ??= seedCard(card.key, now));
      if (!c.moved) c.valueE4 = c.dayRefE4 = nexamonE4FromCents(card.startPriceCents);
    }
    return s;
  }

  const unlockAt = unlockLevel("nexamon") ?? 10;
  const requireUnlock = () => {
    if (host.level() < unlockAt) throw new GameError("nexamon_locked");
  };
  const info = (key: string) => {
    const card = nexamonCard(key);
    if (!card) throw new GameError("nexamon_unknown");
    return card;
  };
  const popOf = (s: DemoNexamonState, key: string) => nexamonPopularityBps(info(key).rarity, s.cards[key]!.population);
  const blBps = (s: DemoNexamonState, key: string) => s.hype?.[key]?.bps ?? nexamonHypeBaseBps();
  const copyValue = (s: DemoNexamonState, c: { cardKey: string; condition: NexamonCondition; grade: number | null }) =>
    nexamonIsBlackLabel(c.grade)
      ? Number(divRoundHalfEven(BigInt(s.cards[c.cardKey]!.valueE4) * BigInt(blBps(s, c.cardKey)), BigInt(1_000_000)))
      : nexamonCopyValueCents(s.cards[c.cardKey]!.valueE4, c.condition, c.grade, cfg, popOf(s, c.cardKey));

  const ownedCopies = (s: DemoNexamonState) =>
    s.copies.map((c) => ({ cardKey: c.cardKey, grade: c.grade, listed: c.listing !== null }));

  /** ADR-171: recomputes the card bonuses (the server's nexamon_bonus_recompute) and rewards first completions. */
  function bonusRefresh(s: DemoNexamonState) {
    const summary = nexamonBonusSummary(BONUS_CARDS, ownedCopies(s));
    const active = [
      ...new Set(summary.sources.map((x) => (x.cardKey ? `card:${x.cardKey}` : collectionId(x.collection!)))),
    ];
    const before = s.bonusActive;
    s.bonusActive = active;
    s.bonusEffective = Object.fromEntries(summary.totals.map((t) => [t.kind, t.effectiveBps]));
    const cardsOf = (list: string[]) => list.filter((id) => id.startsWith("card:"));
    const names = (list: string[]) => list.map((id) => nexamonCard(id.slice(5))?.name ?? id.slice(5)).join(", ");
    const on = cardsOf(active).filter((id) => !before?.includes(id));
    const off = cardsOf(before ?? []).filter((id) => !active.includes(id));
    if (on.length > 0) {
      if (before)
        host.notify("nexamon_bonus", "Karten-Bonus aktiv", `Jetzt aktiv: ${names(on)}.`, "/nexamon?tab=bonuses");
      host.track("nexamon_bonus_cards", on.length);
    }
    if (off.length > 0)
      host.notify("nexamon_bonus", "Karten-Bonus weg", `Kein Bonus mehr von: ${names(off)}.`, "/nexamon?tab=bonuses");
    const done = (s.completions ??= {});
    for (const c of summary.collections) {
      const id = collectionId(c);
      if (!c.complete || done[id] !== undefined) continue;
      done[id] = host.now();
      const reward = nexamonCollectionReward(c.kind, c.set);
      if (reward.cents > 0) host.earn(reward.cents);
      host.xp?.(reward.xp);
      const title =
        c.kind === "master" ? "Master-Set!" : c.kind === "complete" ? "Set komplett!" : "Typ-Sammlung komplett";
      host.notify(
        "nexamon_set",
        title,
        `${cfg.sets[c.set].name}: Belohnung ${reward.cents / 100} € und ${reward.xp} XP.`,
        "/nexamon?tab=bonuses",
      );
      if (c.kind === "type") host.track("nexamon_type_sets");
      if (c.kind === "complete") host.track("nexamon_full_sets");
      if (c.kind === "master") host.feed("nexamon_master_set", { set: c.set, name: cfg.sets[c.set].name });
    }
  }

  /** ADR-171: Black Label hype of the cards the player holds Black Labels of, once per hour (nexamon_hype_run_due). */
  function hypeTick(s: DemoNexamonState, now: number) {
    const hour = Math.floor(now / HOUR) * HOUR;
    const keys = new Set([
      ...s.copies.filter((c) => nexamonIsBlackLabel(c.grade)).map((c) => c.cardKey),
      ...Object.keys(s.hype ?? {}),
    ]);
    for (const key of keys) {
      const h = ((s.hype ??= {})[key] ??= { bps: nexamonHypeBaseBps(), at: hour, jumpAt: null, points: [] });
      const steps = Math.min(48, Math.floor((hour - h.at) / HOUR));
      if (steps < 1) continue;
      const card = info(key);
      const bls = s.copies.filter((c) => c.cardKey === key && nexamonIsBlackLabel(c.grade)).length;
      const chance = nexamonHypeChanceBps(
        card.rarity,
        nexamonPopularityBps(card.rarity, s.cards[key]!.population),
        bls,
      );
      let jump = 0;
      const start = h.bps;
      for (let i = 0; i < steps; i++) {
        const step = nexamonHypeStep(h.bps, chance, host.random(), host.random());
        h.bps = step.factorBps;
        jump = Math.max(jump, step.jumpBps);
      }
      h.at = hour;
      if (h.bps !== start) {
        h.points.push([hour, h.bps, jump]);
        if (h.points.length > MAX_HYPE_POINTS) h.points.splice(0, h.points.length - MAX_HYPE_POINTS);
      }
      if (jump > 0) {
        h.jumpAt = now;
        host.notify(
          "nexamon_hype",
          "Black-Label-Hype!",
          `Die Black Labels von ${card.name} sind um ${jump / 100} % gestiegen.`,
          `/nexamon/${key}`,
        );
        if (jump >= cfg.blackLabelHype.bigJumpBps)
          host.feed("nexamon_hype", { card_key: key, name: card.name, jump_bps: jump, factor_bps: h.bps });
      }
      if (h.bps <= nexamonHypeBaseBps() && bls === 0) delete s.hype![key];
    }
  }
  const aiListed = (card: DemoCard, rarity: NexamonRarity) => card.ai.slice(0, cfg.ai.listedPerCard[rarity]);

  function bounds(s: DemoNexamonState, key: string, now: number, extraTrades = 0) {
    const c = s.cards[key]!;
    const today = berlinDay(now);
    return {
      startE4: nexamonE4FromCents(info(key).startPriceCents),
      ageDays: c.firstPulledAt === null ? 0 : Math.floor((now - c.firstPulledAt) / DAY),
      countedTrades: c.trades + extraTrades,
      dayRefE4: c.dayRefOn === today ? c.dayRefE4 : c.valueE4,
    };
  }

  /** Sets a card's value inside its bounds (the server's nexamon_set_value). */
  function setValue(s: DemoNexamonState, key: string, targetE4: number, now: number, counted = false): number {
    const c = s.cards[key]!;
    const b = bounds(s, key, now, counted ? 1 : 0);
    const next = Math.max(1, nexamonClampValue(targetE4, b));
    c.dayRefE4 = b.dayRefE4;
    c.dayRefOn = berlinDay(now);
    c.trades = b.countedTrades;
    if (next !== c.valueE4) {
      c.valueE4 = next;
      c.moved = true;
      const points = (s.points[key] ??= []);
      const hour = Math.floor(now / HOUR) * HOUR;
      if (points.length > 0 && points[points.length - 1]![0] === hour) points[points.length - 1]![1] = next;
      else points.push([hour, next]);
      if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
    }
    return c.valueE4;
  }

  function mint(s: DemoNexamonState, key: string, now: number): number {
    const c = s.cards[key]!;
    c.population += 1;
    c.firstPulledAt ??= now;
    return c.population;
  }

  /** A player's pack (ADR-174): the set's own pack rule and the One of Ones nobody has pulled yet. */
  function openPlayerPack(s: DemoNexamonState, set: NexamonSetKey) {
    const cards = NEXAMON_CARDS.filter((c) => c.set === set);
    const freeOneOfOnes = cards
      .filter((c) => c.rarity === "one_of_one" && s.oneOfOnes?.[c.key] === undefined)
      .map((c) => c.key);
    return nexamonOpenPack(cards, host.random, cfg, { freeOneOfOnes, rule: nexamonPackRule(set), set });
  }

  function record(s: DemoNexamonState, sale: DemoSale) {
    s.sales.push(sale);
    if (s.sales.length > MAX_SALES) s.sales.splice(0, s.sales.length - MAX_SALES);
  }

  /** The player's listings a buyer would call offered: priced at most the value plus the band. */
  const plausibleOwn = (s: DemoNexamonState, key: string) =>
    s.copies.filter(
      (c) =>
        c.cardKey === key &&
        c.listing &&
        nexamonPriceIsPlausible(
          Math.min(
            nexamonPricePerCardE4(
              c.listing.priceCents,
              nexamonCopyFactorBps(c.condition, c.grade, cfg, popOf(s, c.cardKey)),
            ),
            s.cards[key]!.valueE4,
          ),
          s.cards[key]!.valueE4,
        ),
    ).length;

  /** Catches up on everything the server's job does (nexamon_run_due). */
  function tick(): DemoNexamonState {
    const s = st();
    const now = host.now();
    // 1. gradings
    for (const c of s.copies) {
      if (c.gradingUntil !== null && c.gradingUntil <= now) {
        c.grade = nexamonRollGrade(c.condition, host.random());
        c.gradedAt = now;
        c.gradingUntil = null;
        // The grade stays a surprise until the package is opened; no feed item before the reveal.
        host.notify(
          "nexamon_graded",
          "Paket von ASP",
          "Deine Nexamon-Karte ist zurück von ASP. Das versiegelte Paket wartet darauf, dass du es öffnest.",
          "/nexamon",
        );
        if (nexamonIsBlackLabel(c.grade)) host.track("nexamon_black_labels");
        if (c.grade >= 10) host.track("nexamon_tens");
      }
    }
    // 2. the AI's packs
    let opened = 0;
    for (const set of NEXAMON_SETS) {
      // ADR-182: no AI packs of a set before its release
      if (!nexamonSetReleased(set, now)) continue;
      const perHour = cfg.ai.packsPerHour[set];
      const since = (s.aiPacksAt[set] ??= now);
      let due = Math.floor(((now - since) / HOUR) * perHour);
      if (due < 1) continue;
      s.aiPacksAt[set] = now;
      due = Math.min(due, MAX_AI_PACKS - opened);
      const cards = NEXAMON_CARDS.filter((c) => c.set === set);
      for (let i = 0; i < due; i++) {
        const opts = { rule: nexamonPackRule(set), set, skipRarities: cfg.ai.excludedRarities };
        for (const pull of nexamonOpenPack(cards, host.random, cfg, opts)) {
          const serial = mint(s, pull.key, now);
          const stock = s.cards[pull.key]!.ai;
          if (stock.length < AI_STOCK_CAP) stock.push({ serial, condition: pull.condition });
        }
      }
      opened += due;
    }
    // 3. AI collectors buy the player's listings up to value x (1 + premium), better copies first
    const minutes = Math.min(600, Math.floor((now - s.tickAt) / 60_000));
    if (minutes >= 1) {
      s.tickAt = now;
      const today = berlinDay(now);
      const listed = s.copies
        .filter((c) => c.listing)
        .sort((a, b) => nexamonCopyFactorBps(b.condition, b.grade) - nexamonCopyFactorBps(a.condition, a.grade));
      let bought = 0;
      for (const copy of listed) {
        if (bought >= cfg.ai.maxBuysPerRun) break;
        const card = info(copy.cardKey);
        const state = s.cards[copy.cardKey]!;
        const price = copy.listing!.priceCents;
        const chanceBps = nexamonAiBuyChanceBps({
          priceCents: price,
          copyValueCents: copyValue(s, copy),
          condition: copy.condition,
          grade: copy.grade,
          rarity: card.rarity,
          population: state.population,
        });
        if (chanceBps <= 0) continue;
        const aiBuys = s.sales.filter((x) => x.kind === "ai_buy");
        const spent = aiBuys
          .filter((x) => berlinDay(x.at) === today && nexamonCard(x.cardKey)?.set === card.set)
          .reduce((sum, x) => sum + x.priceCents, 0);
        if (spent + price > cfg.ai.dailyBudgetPacks * cfg.sets[card.set].packPriceCents) continue;
        // at or below the value the AI always buys; above it the chance is per minute
        const perMinute = chanceBps / 10_000;
        if (chanceBps < 10_000 && host.random() >= 1 - Math.pow(1 - perMinute, minutes)) continue;
        bought++;
        const buyer = sellerOf(Math.floor(host.random() * SELLERS.length));
        const fee = nexamonMarketFeeCents(price);
        host.earn(price - fee);
        // the value moves only for a plausible price and a few AI buys per card and window (anti-manipulation)
        const counted = nexamonAiBuyCounts({
          priceCents: price,
          factorBps: nexamonCopyFactorBps(copy.condition, copy.grade, cfg, popOf(s, copy.cardKey)),
          valueE4: state.valueE4,
          rarity: card.rarity,
          countedInWindow: aiBuys.filter(
            (x) => x.counted && x.cardKey === copy.cardKey && x.at >= now - cfg.ai.buyWindowDays * DAY,
          ).length,
        });
        if (counted)
          setValue(s, copy.cardKey, nexamonValueAfterAiBuy(state.valueE4, card.rarity, state.population), now, true);
        record(s, {
          cardKey: copy.cardKey,
          at: now,
          priceCents: price,
          condition: copy.condition,
          grade: copy.grade,
          kind: "ai_buy",
          seller: host.nickname(),
          buyer,
          counted,
        });
        s.copies = s.copies.filter((c) => c.id !== copy.id);
        if (copy.grade === null && state.ai.length < AI_STOCK_CAP)
          state.ai.push({ serial: copy.serial, condition: copy.condition });
        host.notify("nexamon_sale", "Nexamon-Karte verkauft", `${buyer} hat deine Karte gekauft.`, "/nexamon");
        host.track("nexamon_sold");
      }
    }
    // 4. supply against demand, once per hour
    const every = cfg.value.pressure.everyMinutes * 60_000;
    let steps = Math.min(MAX_PRESSURE_STEPS, Math.floor((now - s.pressureAt) / every));
    if (steps >= 1) s.pressureAt = now;
    for (; steps >= 1; steps--) {
      const at = now - (steps - 1) * every;
      for (const card of NEXAMON_CARDS) {
        const state = s.cards[card.key]!;
        const next = nexamonValueAfterPressure(state.valueE4, {
          rarity: card.rarity,
          population: state.population,
          supply: aiListed(state, card.rarity).length + plausibleOwn(s, card.key),
          recentBuys: s.sales.filter(
            (x) =>
              x.cardKey === card.key &&
              x.counted &&
              x.kind !== "quick" &&
              x.at >= at - cfg.value.pressure.buyDays * DAY,
          ).length,
        });
        if (next !== state.valueE4) setValue(s, card.key, next, at);
      }
    }
    // 5. Black Label hype, and the bonuses after AI purchases and gradings (ADR-171)
    hypeTick(s, now);
    bonusRefresh(s);
    return s;
  }

  const toCopy = (s: DemoNexamonState, c: DemoCopy): NexamonCopy => ({
    id: c.id,
    cardKey: c.cardKey,
    serial: c.serial,
    condition: c.condition,
    grade: c.grade,
    state: c.gradingUntil !== null ? "grading" : c.grade !== null ? "graded" : "raw",
    gradingUntil: c.gradingUntil === null ? null : iso(c.gradingUntil),
    gradedAt: c.gradedAt === null ? null : iso(c.gradedAt),
    valueCents: copyValue(s, c),
    listing: c.listing
      ? { id: c.listing.id, priceCents: c.listing.priceCents, listedAt: iso(c.listing.listedAt) }
      : null,
    acquiredAt: iso(c.acquiredAt),
  });

  function toCard(s: DemoNexamonState, key: string, now: number): NexamonCardStats {
    const card = info(key);
    const state = s.cards[key]!;
    const b = bounds(s, key, now);
    const limits = nexamonValueBounds(b);
    return {
      cardKey: key,
      set: card.set,
      number: card.number,
      rarity: card.rarity,
      valueCents: nexamonCentsFromE4(state.valueE4),
      startCents: card.startPriceCents,
      changeBps:
        state.dayRefOn === berlinDay(now)
          ? Math.round(((state.valueE4 - state.dayRefE4) * 10_000) / state.dayRefE4)
          : 0,
      population: state.population,
      listed:
        aiListed(state, card.rarity).length + s.copies.filter((c) => c.cardKey === key && c.listing !== null).length,
      owned: s.copies.filter((c) => c.cardKey === key).length,
      popularityBps: nexamonPopularityBps(card.rarity, state.population),
      floorCents: nexamonCentsFromE4(limits.floorE4),
      capCents: nexamonCentsFromE4(limits.capE4),
      bonus: cardBonus(s, key),
      blackLabelBps: blBps(s, key),
      hypeAt: hypeAt(s, key),
    };
  }

  function hypeAt(s: DemoNexamonState, key: string): string | null {
    const h = s.hype?.[key];
    return h && h.bps > nexamonHypeBaseBps() && h.jumpAt !== null ? iso(h.jumpAt) : null;
  }

  function cardBonus(s: DemoNexamonState, key: string) {
    const base = BONUS_DEFS.get(key);
    if (!base) return null;
    const own = s.copies.filter((c) => c.cardKey === key && c.listing === null);
    const grades = own.map((c) => c.grade).filter((g): g is number => g !== null);
    const bestGrade = grades.length > 0 ? Math.max(...grades) : null;
    return {
      kind: base.kind,
      bps: base.bps,
      boostedBps: nexamonBoostedBps(base.bps, bestGrade),
      active: own.length > 0,
      bestGrade,
    };
  }

  /** All open listings: the AI's (priced 10 % above value, following it) and the player's own. */
  function listings(s: DemoNexamonState): NexamonListing[] {
    const out: NexamonListing[] = [];
    for (const card of NEXAMON_CARDS) {
      const state = s.cards[card.key]!;
      for (const stock of aiListed(state, card.rarity)) {
        const value = nexamonCopyValueCents(state.valueE4, stock.condition, null);
        out.push({
          id: aiListingId(card.key, stock.serial),
          copyId: aiListingId(card.key, stock.serial),
          cardKey: card.key,
          set: card.set,
          rarity: card.rarity,
          serial: stock.serial,
          condition: stock.condition,
          grade: null,
          priceCents: nexamonAiAskCents(value),
          valueCents: value,
          seller: sellerOf(card.number + stock.serial),
          sellerAi: true,
          mine: false,
          listedAt: iso(state.firstPulledAt ?? 0),
        });
      }
    }
    for (const c of s.copies) {
      if (!c.listing) continue;
      const card = info(c.cardKey);
      out.push({
        id: c.listing.id,
        copyId: c.id,
        cardKey: c.cardKey,
        set: card.set,
        rarity: card.rarity,
        serial: c.serial,
        condition: c.condition,
        grade: c.grade,
        priceCents: c.listing.priceCents,
        valueCents: copyValue(s, c),
        seller: host.nickname(),
        sellerAi: false,
        mine: true,
        listedAt: iso(c.listing.listedAt),
      });
    }
    return out;
  }

  function ownCopy(s: DemoNexamonState, copyId: string): DemoCopy {
    const c = s.copies.find((x) => x.id === copyId);
    if (!c) throw new GameError(copyId.startsWith("ai:") ? "nexamon_not_owner" : "nexamon_unknown");
    return c;
  }

  /** One bought pack: pays, pulls, mints (buy_nexamon_pack). */
  function buyPackIn(s: DemoNexamonState, set: NexamonSetKey, now: number): NexamonPackResult {
    if (!nexamonSetReleased(set, now)) throw new GameError("nexamon_set_not_released");
    if (!(NEXAMON_SETS as readonly string[]).includes(set)) throw new GameError("nexamon_unknown");
    const price = cfg.sets[set].packPriceCents;
    s.packTimes = s.packTimes.filter((t) => t > now - 60_000);
    if (s.packTimes.length >= cfg.packs.perMinute) throw new GameError("rate_limited");
    if (host.cashCents() < price) throw new GameError("insufficient_funds");
    host.pay(price);
    s.packTimes.push(now);
    const packId = `pack-${s.nextId++}`;
    const pulls = openPlayerPack(s, set);
    const cards = pulls.map((pull) => {
      const isNew = !s.copies.some((c) => c.cardKey === pull.key);
      const serial = mint(s, pull.key, now);
      const copy: DemoCopy = {
        id: `nx-${s.nextId++}`,
        cardKey: pull.key,
        serial,
        condition: pull.condition,
        grade: null,
        gradingUntil: null,
        gradedAt: null,
        acquiredAt: now,
        listing: null,
      };
      s.copies.push(copy);
      if (pull.rarity === "one_of_one") {
        (s.oneOfOnes ??= {})[pull.key] = now;
        host.feed("nexamon_one_of_one", {
          card_key: pull.key,
          set,
          rarity: pull.rarity,
          serial,
          name: info(pull.key).name,
        });
      }
      if ((cfg.feedRarities as readonly string[]).includes(pull.rarity))
        host.feed("nexamon_pull", {
          card_key: pull.key,
          set,
          rarity: pull.rarity,
          serial,
          condition: pull.condition,
        });
      if (pull.rarity !== "common") host.track("nexamon_rares");
      if (pull.rarity !== "common" && pull.rarity !== "rare") host.track("nexamon_ultras");
      return {
        slot: pull.slot,
        copyId: copy.id,
        cardKey: pull.key,
        rarity: pull.rarity,
        condition: pull.condition,
        isNew,
        serial,
        population: serial,
        valueCents: copyValue(s, copy),
      };
    });
    s.packs[set] = (s.packs[set] ?? 0) + 1;
    host.track("nexamon_packs");
    return { packId, set, priceCents: price, cards, packsOpened: s.packs[set]! };
  }

  const write = <T>(requestId: string, run: (s: DemoNexamonState, now: number) => T): Promise<T> =>
    Promise.resolve().then(() => {
      requireUnlock();
      if (!requestId) throw new GameError("invalid_argument");
      return host.idempotent(requestId, () => {
        const s = tick();
        const result = run(s, host.now());
        bonusRefresh(s);
        return result;
      });
    });

  return {
    async nexamon() {
      const s = tick();
      const sets = NEXAMON_SETS.map((key) => {
        const mine = s.copies.filter((c) => info(c.cardKey).set === key);
        const cards = NEXAMON_CARDS.filter((c) => c.set === key);
        return {
          key,
          name: cfg.sets[key].name,
          packPriceCents: cfg.sets[key].packPriceCents,
          cards: cards.length,
          ownedDistinct: new Set(mine.map((c) => c.cardKey)).size,
          ownedCopies: mine.length,
          packsOpened: s.packs[key] ?? 0,
          population: cards.reduce((sum, c) => sum + s.cards[c.key]!.population, 0),
        };
      });
      // cheapest pack first, like the server
      sets.sort((a, b) => a.packPriceCents - b.packPriceCents);
      return {
        unlocked: host.level() >= unlockAt,
        unlockLevel: unlockAt,
        packSize: cfg.packSize,
        sets,
        collection: {
          copies: s.copies.length,
          distinct: new Set(s.copies.map((c) => c.cardKey)).size,
          valueCents: s.copies.reduce((sum, c) => sum + copyValue(s, c), 0),
          listed: s.copies.filter((c) => c.listing).length,
          grading: s.copies.filter((c) => c.gradingUntil !== null).length,
          graded: s.copies.filter((c) => c.grade !== null).length,
        },
        limits: {
          maxListings: cfg.market.maxListings,
          maxGrading: cfg.grading.maxOpen,
          packsPerMinute: cfg.packs.perMinute,
        },
        serverTime: iso(host.now()),
        oneOfOnes: NEXAMON_CARDS.filter((c) => c.rarity === "one_of_one").map((c) => {
          const at = s.oneOfOnes?.[c.key];
          return {
            cardKey: c.key,
            set: c.set,
            pulled: at !== undefined,
            pulledBy: at !== undefined ? host.nickname() : null,
            pulledAt: at !== undefined ? iso(at) : null,
          };
        }),
      };
    },

    buyNexamonPack: (requestId, set) => write(requestId, (s, now) => buyPackIn(s, set, now)),

    /** Several packs at once (ADR-182): all or nothing, every pack counts for the rate limit. */
    buyNexamonPacks: (requestId, set, count) =>
      write(requestId, (s, now) => {
        if (!(NEXAMON_SETS as readonly string[]).includes(set)) throw new GameError("nexamon_unknown");
        if (!Number.isInteger(count) || count < 1 || count > cfg.packs.maxPerBuy)
          throw new GameError("invalid_argument");
        const price = cfg.sets[set].packPriceCents;
        const recent = s.packTimes.filter((t) => t > now - 60_000).length;
        if (recent + count > cfg.packs.perMinute) throw new GameError("rate_limited");
        if (host.cashCents() < price * count) throw new GameError("insufficient_funds");
        const packs = Array.from({ length: count }, () => buyPackIn(s, set, now));
        return { set, count, priceCents: price * count, packs };
      }),

    async nexamonCollection(set = null) {
      requireUnlock();
      const s = tick();
      const now = host.now();
      if (set !== null && !(NEXAMON_SETS as readonly string[]).includes(set)) throw new GameError("nexamon_unknown");
      const number = (c: DemoCopy) => NEXAMON_SETS.indexOf(info(c.cardKey).set) * 1_000 + info(c.cardKey).number;
      return {
        cards: NEXAMON_CARDS.filter((c) => set === null || c.set === set).map((c) => toCard(s, c.key, now)),
        copies: s.copies
          .filter((c) => set === null || info(c.cardKey).set === set)
          .sort((a, b) => number(a) - number(b) || a.serial - b.serial)
          .map((c) => toCopy(s, c)),
        serverTime: iso(now),
      };
    },

    async nexamonCard(cardKey) {
      requireUnlock();
      const s = tick();
      const now = host.now();
      info(cardKey);
      const state = s.cards[cardKey]!;
      const mine = s.copies.filter((c) => c.cardKey === cardKey);
      return {
        card: toCard(s, cardKey, now),
        history: [
          // the start, so a chart has a first point
          ...(s.createdAt >= now - cfg.market.historyDays * DAY
            ? [{ at: iso(Math.floor(s.createdAt / HOUR) * HOUR), valueCents: info(cardKey).startPriceCents }]
            : []),
          ...(s.points[cardKey] ?? [])
            .filter(
              ([at]) =>
                at >= now - cfg.market.historyDays * DAY && at < now && at > Math.floor(s.createdAt / HOUR) * HOUR,
            )
            .map(([at, value]) => ({ at: iso(at), valueCents: nexamonCentsFromE4(value) })),
          { at: iso(now), valueCents: nexamonCentsFromE4(state.valueE4) },
        ],
        graded: cfg.grading.grades.map((g) => mine.filter((c) => c.grade === g).length),
        blackLabels: mine.filter((c) => nexamonIsBlackLabel(c.grade)).length,
        hype: (s.hype?.[cardKey]?.points ?? [])
          .slice(-cfg.blackLabelHype.historyPoints)
          .map(([at, factorBps, jumpBps]) => ({ at: iso(at), factorBps, jumpBps })),
        listings: listings(s)
          .filter((l) => l.cardKey === cardKey)
          .sort((a, b) => a.priceCents - b.priceCents)
          .slice(0, 30),
        copies: mine.sort((a, b) => a.serial - b.serial).map((c) => toCopy(s, c)),
        sales: s.sales
          .filter((x) => x.cardKey === cardKey)
          .slice(-cfg.market.recentSales)
          .reverse()
          .map((x): NexamonSale => ({
            at: iso(x.at),
            priceCents: x.priceCents,
            condition: x.condition,
            grade: x.grade,
            kind: x.kind,
            seller: x.seller,
            buyer: x.buyer,
          })),
        serverTime: iso(now),
      };
    },

    async nexamonMarket(query = {}) {
      requireUnlock();
      const s = tick();
      const sort = query.sort ?? "new";
      const seller = query.seller ?? "all";
      const page = Math.max(1, Math.floor(query.page ?? 1));
      const size = cfg.market.pageSize;
      const all = listings(s).filter(
        (l) =>
          (query.set == null || l.set === query.set) &&
          (query.rarity == null || l.rarity === query.rarity) &&
          (query.cardKey == null || l.cardKey === query.cardKey) &&
          (query.graded == null || (l.grade !== null) === query.graded) &&
          (query.blackLabel == null || nexamonIsBlackLabel(l.grade) === query.blackLabel) &&
          (seller === "all" || (seller === "ai" ? l.sellerAi : !l.sellerAi)),
      );
      const value = (l: NexamonListing) => s.cards[l.cardKey]!.valueE4;
      const order = (l: NexamonListing) => NEXAMON_SETS.indexOf(l.set) * 1_000 + info(l.cardKey).number;
      const newest = (a: NexamonListing, b: NexamonListing) =>
        b.listedAt.localeCompare(a.listedAt) || a.id.localeCompare(b.id);
      all.sort((a, b) => {
        const first =
          sort === "price_asc"
            ? a.priceCents - b.priceCents
            : sort === "price_desc"
              ? b.priceCents - a.priceCents
              : sort === "deal"
                ? a.priceCents / Math.max(1, a.valueCents) - b.priceCents / Math.max(1, b.valueCents)
                : sort === "value"
                  ? value(b) - value(a)
                  : sort === "number"
                    ? order(a) - order(b)
                    : 0;
        return first || newest(a, b);
      });
      return {
        listings: all.slice((page - 1) * size, page * size),
        total: all.length,
        page,
        pageSize: size,
        pages: Math.max(1, Math.ceil(all.length / size)),
        serverTime: iso(host.now()),
      };
    },

    async playerNexamon(nickname, limit = null) {
      const s = tick();
      const me = host.nickname();
      const own = nickname === null || nickname.trim().toLowerCase() === me.toLowerCase();
      const level = own ? host.level() : (host.playerLevel?.(nickname.trim()) ?? null);
      if (level === null) throw new GameError("player_not_found");
      const unlocked = level >= unlockAt;
      const copies = !unlocked ? [] : own ? s.copies : demoOtherCopies(nickname.trim(), level, unlockAt);
      const byCard = new Map<string, PlayerNexamonCard>();
      for (const c of copies) {
        const card = info(c.cardKey);
        const value = copyValue(s, c);
        const entry = byCard.get(c.cardKey);
        if (!entry) {
          byCard.set(c.cardKey, {
            cardKey: c.cardKey,
            set: card.set,
            number: card.number,
            rarity: card.rarity,
            copies: 1,
            serial: c.serial,
            condition: c.condition,
            grade: c.grade,
            valueCents: value,
            totalCents: value,
          });
          continue;
        }
        entry.copies += 1;
        entry.totalCents += value;
        // the best copy: the most valuable, then the higher grade, then the lower serial
        const better = value - entry.valueCents || (c.grade ?? 0) - (entry.grade ?? 0) || entry.serial - c.serial;
        if (better > 0)
          Object.assign(entry, { serial: c.serial, condition: c.condition, grade: c.grade, valueCents: value });
      }
      const order = (c: { set: NexamonSetKey; number: number }) => NEXAMON_SETS.indexOf(c.set) * 1_000 + c.number;
      const cards = [...byCard.values()].sort((a, b) => b.valueCents - a.valueCents || order(a) - order(b));
      const cap = Math.min(500, Math.max(1, Math.floor(limit ?? 500)));
      const result: PlayerNexamon = {
        nickname: own ? me : nickname.trim(),
        isMe: own,
        unlocked,
        summary: {
          copies: copies.length,
          distinct: cards.length,
          total: NEXAMON_CARDS.length,
          valueCents: cards.reduce((sum, c) => sum + c.totalCents, 0),
          graded: copies.filter((c) => c.grade !== null).length,
          tens: copies.filter((c) => (c.grade ?? 0) >= 10).length,
          blackLabels: copies.filter((c) => nexamonIsBlackLabel(c.grade)).length,
        },
        sets: [...NEXAMON_SETS]
          .sort((a, b) => cfg.sets[a].packPriceCents - cfg.sets[b].packPriceCents)
          .map((set) => ({
            key: set,
            cards: NEXAMON_CARDS.filter((c) => c.set === set).length,
            distinct: cards.filter((c) => c.set === set).length,
            copies: cards.filter((c) => c.set === set).reduce((sum, c) => sum + c.copies, 0),
          })),
        cards: cards.slice(0, cap),
        slabs: copies
          .filter((c): c is typeof c & { grade: number } => c.grade !== null)
          .map((c) => {
            const card = info(c.cardKey);
            return {
              cardKey: c.cardKey,
              set: card.set,
              number: card.number,
              rarity: card.rarity,
              serial: c.serial,
              condition: c.condition,
              grade: c.grade,
              valueCents: copyValue(s, c),
            };
          })
          .sort(
            (a, b) => b.grade - a.grade || b.valueCents - a.valueCents || order(a) - order(b) || a.serial - b.serial,
          )
          .slice(0, 500),
        badges: own
          ? Object.entries(s.completions ?? {})
              .sort((a, b) => a[1] - b[1])
              .map(([id, at]) => {
                const [, set, kind, type] = id.split(":");
                return {
                  set: set as NexamonSetKey,
                  kind: kind as "type" | "complete" | "master",
                  type: type ?? null,
                  at: iso(at),
                };
              })
          : [],
        serverTime: iso(host.now()),
      };
      return result;
    },

    listNexamonCard: (requestId, copyId, priceCents) =>
      write(requestId, (s, now) => {
        if (
          !Number.isInteger(priceCents) ||
          priceCents < cfg.market.minPriceCents ||
          priceCents > cfg.market.maxPriceCents
        )
          throw new GameError("invalid_argument");
        const copy = ownCopy(s, copyId);
        if (copy.gradingUntil !== null) throw new GameError("nexamon_grading");
        if (copy.listing) throw new GameError("nexamon_listed");
        if (s.copies.filter((c) => c.listing).length >= cfg.market.maxListings)
          throw new GameError("nexamon_listing_limit");
        copy.listing = { id: `l-${copy.id}-${s.nextId++}`, priceCents, listedAt: now };
        return { listing: listings(s).find((l) => l.id === copy.listing!.id)!, copy: toCopy(s, copy) };
      }),

    unlistNexamonCard: (requestId, listingId) =>
      write(requestId, (s) => {
        const copy = s.copies.find((c) => c.listing?.id === listingId);
        if (!copy) throw new GameError(listingId.startsWith("ai:") ? "nexamon_not_owner" : "nexamon_not_listed");
        copy.listing = null;
        return { copy: toCopy(s, copy) };
      }),

    listNexamonCards: (requestId, cardKey, condition, grade, count, priceCents) =>
      write(requestId, (s, now) => {
        if (
          !Number.isInteger(count) ||
          count < 1 ||
          !Number.isInteger(priceCents) ||
          priceCents < cfg.market.minPriceCents ||
          priceCents > cfg.market.maxPriceCents
        )
          throw new GameError("invalid_argument");
        if (s.copies.filter((c) => c.listing).length + count > cfg.market.maxListings)
          throw new GameError("nexamon_listing_limit");
        const pick = s.copies
          .filter(
            (c) =>
              c.cardKey === cardKey &&
              !c.listing &&
              c.gradingUntil === null &&
              (grade === null ? c.grade === null && c.condition === condition : c.grade === grade),
          )
          .sort((a, b) => a.acquiredAt - b.acquiredAt || a.serial - b.serial)
          .slice(0, count);
        if (pick.length < count) throw new GameError("nexamon_not_enough");
        for (const copy of pick) copy.listing = { id: `l-${copy.id}-${s.nextId++}`, priceCents, listedAt: now };
        const all = listings(s);
        return {
          listings: pick.map((c) => all.find((l) => l.id === c.listing!.id)!),
          copies: pick.map((c) => toCopy(s, c)),
        };
      }),

    unlistNexamonCards: (requestId, listingIds) =>
      write(requestId, (s) => {
        const copies = listingIds.map((id) => {
          const copy = s.copies.find((c) => c.listing?.id === id);
          if (!copy) throw new GameError(id.startsWith("ai:") ? "nexamon_not_owner" : "nexamon_not_listed");
          return copy;
        });
        for (const copy of copies) copy.listing = null;
        return { copies: copies.map((c) => toCopy(s, c)) };
      }),

    buyNexamonListing: (requestId, listingId, priceCents) =>
      write(requestId, (s, now) => {
        if (s.copies.some((c) => c.listing?.id === listingId)) throw new GameError("nexamon_own_listing");
        const listing = listings(s).find((l) => l.id === listingId);
        if (!listing) throw new GameError("nexamon_not_listed");
        if (listing.priceCents !== priceCents) throw new GameError("nexamon_price_changed");
        if (host.cashCents() < listing.priceCents) throw new GameError("insufficient_funds");
        host.pay(listing.priceCents);
        const state = s.cards[listing.cardKey]!;
        const today = berlinDay(now);
        const input = {
          valueE4: state.valueE4,
          priceCents: listing.priceCents,
          factorBps: nexamonCopyFactorBps(listing.condition, listing.grade, cfg, popOf(s, listing.cardKey)),
          rarity: listing.rarity,
          population: state.population,
          pairSales: 0,
          buyerSalesToday: s.sales.filter(
            (x) => x.cardKey === listing.cardKey && x.counted && x.kind === "market" && berlinDay(x.at) === today,
          ).length,
        };
        const counted = nexamonSaleCounts(input);
        state.ai = state.ai.filter((x) => x.serial !== listing.serial);
        if (counted) setValue(s, listing.cardKey, nexamonValueAfterSale(input), now, true);
        const copy: DemoCopy = {
          id: `nx-${s.nextId++}`,
          cardKey: listing.cardKey,
          serial: listing.serial,
          condition: listing.condition,
          grade: null,
          gradingUntil: null,
          gradedAt: null,
          acquiredAt: now,
          listing: null,
        };
        s.copies.push(copy);
        record(s, {
          cardKey: listing.cardKey,
          at: now,
          priceCents: listing.priceCents,
          condition: listing.condition,
          grade: null,
          kind: "market",
          seller: listing.seller,
          buyer: host.nickname(),
          counted,
        });
        return {
          copy: toCopy(s, copy),
          card: toCard(s, listing.cardKey, now),
          priceCents: listing.priceCents,
          // an AI seller's whole proceeds go to the households
          feeCents: listing.priceCents,
          counted,
        };
      }),

    sellNexamonToAi: (requestId, copyIds) =>
      write(requestId, (s, now) => {
        const ids = [...new Set(copyIds)];
        if (ids.length < 1 || ids.length > cfg.quickSell.maxPerCall) throw new GameError("invalid_argument");
        const copies = ids.map((id) => ownCopy(s, id));
        for (const copy of copies) {
          if (copy.gradingUntil !== null) throw new GameError("nexamon_grading");
          if (copy.listing) throw new GameError("nexamon_listed");
          if (nexamonQuickSellCents(0, info(copy.cardKey).rarity, copy.grade, cfg, info(copy.cardKey).set) === null)
            throw new GameError("nexamon_not_sellable");
        }
        const sold = copies.map((copy) => {
          const card = info(copy.cardKey);
          const state = s.cards[copy.cardKey]!;
          const price = nexamonQuickSellCents(copyValue(s, copy), card.rarity, null, cfg, card.set)!;
          setValue(s, copy.cardKey, nexamonValueAfterQuickSell(state.valueE4), now);
          if (state.ai.length < AI_STOCK_CAP) state.ai.push({ serial: copy.serial, condition: copy.condition });
          record(s, {
            cardKey: copy.cardKey,
            at: now,
            priceCents: price,
            condition: copy.condition,
            grade: null,
            kind: "quick",
            seller: host.nickname(),
            buyer: sellerOf(card.number + copy.serial),
            counted: false,
          });
          return { copyId: copy.id, cardKey: copy.cardKey, priceCents: price };
        });
        s.copies = s.copies.filter((c) => !ids.includes(c.id));
        const totalCents = sold.reduce((sum, x) => sum + x.priceCents, 0);
        if (totalCents > 0) host.earn(totalCents);
        return { sold, count: sold.length, totalCents };
      }),

    // ADR-174: the bulk mode sells by the same rules (the demo's AI stock is capped, its offers follow the stock)
    bulkSellNexamon(requestId, copyIds) {
      return this.sellNexamonToAi(requestId, copyIds);
    },

    gradeNexamonCard: (requestId, copyId) =>
      write(requestId, (s, now) => {
        const copy = ownCopy(s, copyId);
        if (copy.gradingUntil !== null) throw new GameError("nexamon_grading");
        if (copy.grade !== null) throw new GameError("nexamon_not_raw");
        if (copy.listing) throw new GameError("nexamon_listed");
        if (s.copies.filter((c) => c.gradingUntil !== null).length >= cfg.grading.maxOpen)
          throw new GameError("nexamon_grading_limit");
        const feeCents = nexamonGradingFeeCents(copyValue(s, copy));
        if (host.cashCents() < feeCents) throw new GameError("insufficient_funds");
        host.pay(feeCents);
        copy.gradingUntil = now + cfg.grading.minutes * 60_000;
        return { copy: toCopy(s, copy), feeCents, readyAt: iso(copy.gradingUntil) };
      }),

    crackNexamonSlab: (requestId, copyId) =>
      write(requestId, (s) => {
        const copy = ownCopy(s, copyId);
        if (copy.gradingUntil !== null) throw new GameError("nexamon_grading");
        if (copy.grade === null) throw new GameError("nexamon_not_graded");
        if (copy.listing) throw new GameError("nexamon_listed");
        const oldGrade = copy.grade;
        copy.grade = null;
        copy.gradedAt = null;
        return { copy: toCopy(s, copy), oldGrade };
      }),

    demoOpenSealedPack: (requestId, set, priceCents) =>
      write(requestId, (s, now) => {
        if (!(NEXAMON_SETS as readonly string[]).includes(set)) throw new GameError("nexamon_unknown");
        s.packTimes = s.packTimes.filter((t) => t > now - 60_000);
        if (s.packTimes.length >= cfg.packs.perMinute) throw new GameError("rate_limited");
        s.packTimes.push(now);
        const packId = `pack-${s.nextId++}`;
        const cards = nexamonOpenPack(
          NEXAMON_CARDS.filter((c) => c.set === set),
          host.random,
          cfg,
          {
            rule: nexamonPackRule(set as NexamonSetKey),
            set,
          },
        ).map((pull): NexamonPull => {
          const isNew = !s.copies.some((c) => c.cardKey === pull.key);
          const serial = mint(s, pull.key, now);
          const copy: DemoCopy = {
            id: `nx-${s.nextId++}`,
            cardKey: pull.key,
            serial,
            condition: pull.condition,
            grade: null,
            gradingUntil: null,
            gradedAt: null,
            acquiredAt: now,
            listing: null,
          };
          s.copies.push(copy);
          if ((cfg.feedRarities as readonly string[]).includes(pull.rarity))
            host.feed("nexamon_pull", {
              card_key: pull.key,
              set,
              rarity: pull.rarity,
              serial,
              condition: pull.condition,
            });
          if (pull.rarity !== "common") host.track("nexamon_rares");
          if (pull.rarity !== "common" && pull.rarity !== "rare") host.track("nexamon_ultras");
          return {
            slot: pull.slot,
            copyId: copy.id,
            cardKey: pull.key,
            rarity: pull.rarity,
            condition: pull.condition,
            isNew,
            serial,
            population: serial,
            valueCents: copyValue(s, copy),
          };
        });
        s.packs[set] = (s.packs[set] ?? 0) + 1;
        host.track("nexamon_packs");
        return { packId, set, priceCents, cards, packsOpened: s.packs[set]! };
      }),

    demoBattlePacks(set, iWin) {
      requireUnlock();
      const s = tick();
      const now = host.now();
      const roll = (mine: boolean) => {
        const copies: DemoCopy[] = [];
        const pulls = openPlayerPack(s, set).map((pull): NexamonPull => {
          if (pull.rarity === "one_of_one") (s.oneOfOnes ??= {})[pull.key] = now;
          const serial = mint(s, pull.key, now);
          const copy: DemoCopy = {
            id: `nx-${s.nextId++}`,
            cardKey: pull.key,
            serial,
            condition: pull.condition,
            grade: null,
            gradingUntil: null,
            gradedAt: null,
            acquiredAt: now,
            listing: null,
          };
          copies.push(copy);
          if (mine && pull.rarity !== "common") host.track("nexamon_rares");
          return {
            slot: pull.slot,
            copyId: copy.id,
            cardKey: pull.key,
            rarity: pull.rarity,
            condition: pull.condition,
            isNew: mine && !s.copies.some((c) => c.cardKey === pull.key),
            serial,
            population: serial,
            valueCents: copyValue(s, copy),
          };
        });
        return { pulls, copies };
      };
      const mine = roll(true);
      const theirs = roll(false);
      const won = iWin(mine.pulls, theirs.pulls);
      if (won) s.copies.push(...mine.copies, ...theirs.copies);
      host.track("nexamon_packs");
      host.setState(s);
      return { mine: mine.pulls, theirs: theirs.pulls, won };
    },

    async nexamonBonuses(): Promise<NexamonBonuses> {
      requireUnlock();
      const s = tick();
      const summary = nexamonBonusSummary(BONUS_CARDS, ownedCopies(s));
      return {
        totals: summary.totals.map((t) => ({ ...t })),
        cards: BONUS_CARDS.filter((c) => BONUS_DEFS.has(c.key)).map((c) => ({
          cardKey: c.key,
          ...cardBonus(s, c.key)!,
        })),
        collections: summary.collections.map((c) => {
          const id = collectionId(c);
          const at = s.completions?.[id];
          return {
            id,
            set: c.set,
            kind: c.kind,
            type: c.type,
            have: c.have,
            need: c.need,
            complete: c.complete,
            missing: [...c.missing],
            bonusKind: c.bonusKind,
            bonusBps: c.bonusBps,
            completedAt: at === undefined ? null : iso(at),
          };
        }),
        serverTime: iso(host.now()),
      };
    },
  };
}
