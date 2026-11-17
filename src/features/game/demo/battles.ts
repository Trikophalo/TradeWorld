import { BATTLE_KINDS, BATTLE_RULES, isTickKind, type BattleKind, type TickKind } from "@/config/battles";
import {
  acceptChunk,
  battleMaxTicks,
  battleRanking,
  currentTick,
  finalTick,
  initBattle,
  quitStream,
  stepBattle,
  tickInputs,
  type AnyBattleState,
  type SimParams,
} from "@/lib/sim/battle";
import {
  bellEval,
  bellRanking,
  bellRoundMs,
  bellTimes,
  estimateEval,
  estimateRanking,
  estimateTimes,
  quizEval,
  quizRanking,
  quizTimes,
  type RoundAnswer,
  type RoundsState,
} from "@/lib/sim/battle/rounds";
import {
  auctionEval,
  auctionRanking,
  higherEval,
  higherRanking,
  higherSeries,
  pointsRanking,
  roundTimes,
  tickerEval,
  vaultEval,
  vaultFeedback,
  vaultValid,
  type AuctionState,
  type VaultTry,
} from "@/lib/sim/battle/rounds-more";
import type {
  Battle,
  BattleArtwork,
  BattleEngine,
  BattleParams,
  BattlePrize,
  BattleRound,
  BattleState,
} from "../battle-types";
import { GameError } from "../types";
import { scaledXp } from "@/lib/sim/progression";
import { pickPackPrize, pickWeighted, type PackPrize, type PackSet } from "@/lib/sim/battle/prizes";
import { ACCESSORIES } from "@/config/accessories";
import { botInput, newBotMemory, type BotMemory } from "./battle-bots";

/*
 * News battles in the offline demo (ADR-160): the same rules as the server (supabase/migrations/
 * 20261204004720_news_battles.sql), with made-up opponents that join a few seconds after the player and play with
 * simple bots. The battle lives in memory only; prizes go to the demo player through the host.
 */

const cfg = BATTLE_RULES;

export interface BattleHost {
  me(): { nickname: string; avatarKey: string; accessories: string[] };
  level(): number;
  /** Grants base XP (with the XP factor) and returns what was granted. */
  addXp(base: number): number;
  addCash(cents: number): void;
  ownedAccessories(): string[];
  giveAccessory(key: string): void;
  /** A gallery NFT nobody owns, or null. */
  freeArtwork(): BattleArtwork | null;
  /** Hands that NFT to the player; false when it is gone. */
  giveArtwork(id: string): boolean;
  /** Nexamon sets with their pack price and name (ADR-177); optional in tests. */
  packSets?(): (PackSet & { name: string })[];
  /** Puts sealed booster packs into the player's inventory (ADR-177). */
  grantSealedPacks?(set: string, count: number, source: string): void;
  stockQuote(): { ticker: string; name: string; priceE4: number } | null;
  bump(metric: "battle_joins" | "battle_wins"): void;
  prizeWinsToday(): number;
  countPrizeWin(): void;
  feed(kind: string, payload: Record<string, unknown>): void;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
  random(): number;
}

interface DemoBattlePlayer {
  nickname: string;
  avatarKey: string;
  accessories: string[];
  bot: boolean;
  /** When a bot steps into the lobby (ms). */
  joinAt: number;
  slot: number | null;
  left: boolean;
  leftAt: number | null;
  rank: number | null;
  memory: BotMemory;
}

interface MyAnswer {
  choice?: number;
  value?: number;
  at: number | null;
  revealedAt: number | null;
}

/** The round games of the addendum to ADR-160 (they all follow the quiz timing). */
const MORE_ROUNDS = ["vault", "ticker", "higher", "auction"] as const;
type MoreRound = (typeof MORE_ROUNDS)[number];
const isMoreRound = (kind: string | null): kind is MoreRound => (MORE_ROUNDS as readonly string[]).includes(kind ?? "");

interface DemoBattle {
  id: number;
  status: Battle["status"];
  kind: BattleKind | null;
  seed: number;
  openedAt: number;
  countdownEndsAt: number | null;
  startedAt: number | null;
  endsAt: number | null;
  finishedAt: number | null;
  params: BattleParams | null;
  prizeKind: keyof typeof cfg.prizes.weights;
  /** accessory: the tier drawn at the opening (ADR-177). */
  accessoryTier: string | null;
  /** packs: the sealed booster packs drawn at the opening (ADR-177). */
  packs: PackPrize[];
  artwork: BattleArtwork | null;
  players: DemoBattlePlayer[];
  // action games
  sim: AnyBattleState | null;
  streams: string[];
  // round games
  questions: {
    q: string;
    options?: string[];
    correct?: number;
    value?: number;
    unit?: string;
    decimals?: number;
    code?: string;
    points?: number;
    icon?: string;
  }[];
  /** Mehr oder Weniger: the chart (cents). */
  series: number[];
  /** Tresorknacker: every try of the round (bots planned, mine as they come), with ms after the round opened. */
  tries: Map<number, VaultTry[]>;
  waits: number[];
  botAnswers: Map<number, RoundAnswer[]>;
  mine: Map<number, MyAnswer>;
  result: Battle["result"];
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

function weighted<K extends string>(weights: Readonly<Record<K, number>>, random: () => number, skip?: string): K {
  const keys = (Object.keys(weights) as K[]).filter((k) => k !== skip).sort();
  const total = keys.reduce((sum, k) => sum + weights[k], 0);
  let roll = random() * total;
  for (const k of keys) {
    roll -= weights[k];
    if (roll < 0) return k;
  }
  return keys[keys.length - 1]!;
}

function shuffle<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function gaussian(random: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random());
}

export function battleParamsFor(kind: BattleKind): BattleParams {
  return {
    w: cfg.arena.w,
    h: cfg.arena.h,
    stepTicks: cfg.arena.stepTicks,
    spawns: cfg.arena.spawns.map(([x, y]) => [x, y] as [number, number]),
    disconnectTicks: cfg.net.disconnectTicks,
    tps: Math.round(1000 / cfg.net.tickMs),
    tickMs: cfg.net.tickMs,
    graceMs: cfg.net.graceMs,
    aheadTicks: cfg.net.aheadTicks,
    checkEveryMs: cfg.net.checkEveryMs,
    game: { ...(cfg.games[kind] as Record<string, unknown>) },
  };
}

const simParams = (p: BattleParams) => p as unknown as SimParams<never>;

export function createBattleEngine(host: BattleHost): BattleEngine & {
  forceKind(kind: BattleKind | null): void;
  forcedKind(): BattleKind | null;
} {
  let current: DemoBattle | null = null;
  let recent: DemoBattle | null = null;
  let lastKind: BattleKind | null = null;
  let forced: BattleKind | null = null;
  /** Start times of the battles (for the hourly limit). */
  let startedAt: number[] = [];
  let nextId = 1;

  const meIndex = (b: DemoBattle) => b.players.findIndex((p) => !p.bot);
  const present = (b: DemoBattle, now: number) => b.players.filter((p) => !p.bot || p.joinAt <= now);

  function open(now: number): DemoBattle {
    let prizeKind = weighted(cfg.prizes.weights, host.random);
    if (prizeKind === "skin" && cfg.accessories.every((a) => host.ownedAccessories().includes(a.key)))
      prizeKind = "money";
    const artwork = prizeKind === "nft" ? host.freeArtwork() : null;
    if (prizeKind === "nft" && !artwork) prizeKind = "money";
    const accessoryTier = prizeKind === "accessory" ? pickWeighted(cfg.prizes.accessoryTiers, host.random()) : null;
    if (prizeKind === "accessory" && !accessoryTier) prizeKind = "money";
    const packs =
      prizeKind === "packs"
        ? pickPackPrize(
            host.packSets?.() ?? [],
            cfg.prizes.packsCapCents,
            cfg.prizes.packsMax,
            host.random(),
            host.random(),
            host.random(),
            host.random(),
          )
        : [];
    if (prizeKind === "packs" && packs.length === 0) prizeKind = "money";
    return {
      id: nextId++,
      status: "open",
      kind: null,
      seed: Math.floor(host.random() * 4_294_967_296),
      openedAt: now,
      countdownEndsAt: null,
      startedAt: null,
      endsAt: null,
      finishedAt: null,
      params: null,
      prizeKind,
      accessoryTier,
      packs,
      artwork,
      players: [],
      sim: null,
      streams: [],
      questions: [],
      series: [],
      tries: new Map(),
      waits: [],
      botAnswers: new Map(),
      mine: new Map(),
      result: null,
    };
  }

  function prizeOf(b: DemoBattle, n: number): BattlePrize {
    const players = Math.max(n, cfg.lobby.minPlayers);
    switch (b.prizeKind) {
      case "xp":
        return { kind: "xp", xp: scaledXp(cfg.prizes.xpBase + cfg.prizes.xpPerPlayer * players) };
      case "skin":
        return { kind: "skin", accessories: cfg.accessories.map((a) => a.key) };
      case "accessory":
        return { kind: "accessory", tier: b.accessoryTier ?? "rare" };
      case "packs": {
        const sets = host.packSets?.() ?? [];
        return {
          kind: "packs",
          packs: b.packs.map((x) => ({ ...x, name: sets.find((s) => s.key === x.set)?.name ?? x.set })),
          cents: b.packs.reduce((sum, x) => sum + x.count * (sets.find((s) => s.key === x.set)?.priceCents ?? 0), 0),
        };
      }
      case "nft":
        if (b.artwork) return { kind: "nft", artwork: b.artwork };
        return { kind: "money", cents: cfg.prizes.moneyBaseCents + cfg.prizes.moneyPerPlayerCents * players };
      default:
        return { kind: "money", cents: cfg.prizes.moneyBaseCents + cfg.prizes.moneyPerPlayerCents * players };
    }
  }

  function plan(b: DemoBattle, kind: BattleKind): void {
    const random = host.random;
    const g = cfg.games;
    const bots = b.players.flatMap((p, i) => (p.bot ? [i] : []));
    if (kind === "quiz") {
      b.questions = shuffle(cfg.quiz, random)
        .slice(0, g.quiz.rounds)
        .map((q) => {
          const options = shuffle([q.a, ...q.wrong], random);
          return { q: q.q, options, correct: options.indexOf(q.a) };
        });
      b.questions.forEach((q, r) =>
        b.botAnswers.set(
          r,
          bots.flatMap((slot) => {
            const m = b.players[slot]!.memory;
            if (random() < 0.08) return [];
            const right = random() < 0.4 + m.skill * 0.45;
            const wrong = [0, 1, 2, 3].filter((k) => k !== q.correct);
            return [
              {
                slot,
                choice: right ? q.correct : wrong[Math.floor(random() * wrong.length)],
                ms: Math.round(1_200 + random() * (g.quiz.answerMs - 2_500) * (1.3 - m.skill)),
              },
            ];
          }),
        ),
      );
    } else if (kind === "estimate") {
      const stockAt = g.estimate.stockRounds > 0 ? Math.floor(random() * g.estimate.rounds) : -1;
      const quote = host.stockQuote();
      b.questions = shuffle(cfg.estimate, random)
        .slice(0, g.estimate.rounds)
        .map((q, r) =>
          r === stockAt && quote
            ? {
                q: `Was kostet eine Aktie von ${quote.name} (${quote.ticker}) gerade?`,
                value: Math.round(quote.priceE4 / 100) / 100,
                unit: "€",
                decimals: 2,
              }
            : { q: q.q, value: q.value, unit: q.unit, decimals: 0 },
        );
      b.questions.forEach((q, r) =>
        b.botAnswers.set(
          r,
          bots.map((slot) => {
            const m = b.players[slot]!.memory;
            const off = gaussian(random) * (0.45 - m.skill * 0.35);
            const factor = 10 ** (q.decimals ?? 0);
            return {
              slot,
              value: Math.max(0, Math.round(q.value! * (1 + off) * factor) / factor),
              ms: Math.round(2_000 + random() * 8_000),
            };
          }),
        ),
      );
    } else if (kind === "vault") {
      const gv = g.vault;
      b.questions = Array.from({ length: gv.rounds }, (_, r) => ({
        q: `Tresor ${r + 1}`,
        code: shuffle(
          Array.from({ length: gv.symbols }, (_, i) => String(i + 1)),
          random,
        )
          .slice(0, gv.digits)
          .join(""),
      }));
      // the made-up opponents crack it like a person: a try that fits all answers so far, a few seconds apart
      const all: string[] = [];
      const build = (prefix: string) => {
        if (prefix.length === gv.digits) return void all.push(prefix);
        for (let d = 1; d <= gv.symbols; d++) if (!prefix.includes(String(d))) build(prefix + d);
      };
      build("");
      b.questions.forEach((q, r) => {
        const list: VaultTry[] = [];
        for (const slot of bots) {
          const m = b.players[slot]!.memory;
          let left = all;
          let ms = 1_500 + random() * 2_000;
          for (let k = 0; k < gv.maxTries && ms < gv.answerMs; k++) {
            const sloppy = random() < (1 - m.skill) * 0.35;
            const guess = (sloppy ? all : left)[Math.floor(random() * (sloppy ? all : left).length)]!;
            list.push({ slot, code: guess, ms: Math.round(ms) });
            if (guess === q.code) break;
            const fb = vaultFeedback(q.code!, guess);
            left = left.filter((c) => {
              const x = vaultFeedback(c, guess);
              return x.hits === fb.hits && x.near === fb.near;
            });
            ms += 1_800 + random() * 2_600 * (1.4 - m.skill);
          }
        }
        b.tries.set(
          r,
          list.sort((a, c) => a.ms - c.ms),
        );
      });
    } else if (kind === "ticker") {
      const gt = g.ticker;
      const pool = shuffle(cfg.tickers, random);
      b.questions = Array.from({ length: gt.rounds }, (_, r) => {
        const target = pool[r % pool.length]!;
        const others = shuffle(
          pool.filter((x) => x.ticker !== target.ticker),
          random,
        ).slice(0, gt.options - 1);
        const options = shuffle([target, ...others], random).map((x) => x.ticker);
        return { q: target.name, options, correct: options.indexOf(target.ticker) };
      });
      b.questions.forEach((q, r) =>
        b.botAnswers.set(
          r,
          bots.flatMap((slot) => {
            const m = b.players[slot]!.memory;
            if (random() < 0.06) return [];
            const right = random() < 0.55 + m.skill * 0.4;
            const wrong = [0, 1, 2, 3, 4, 5].filter((k) => k !== q.correct && k < gt.options);
            return [
              {
                slot,
                choice: right ? q.correct : wrong[Math.floor(random() * wrong.length)],
                ms: Math.round(900 + random() * (gt.answerMs - 2_000) * (1.25 - m.skill)),
              },
            ];
          }),
        ),
      );
    } else if (kind === "higher") {
      const gh = g.higher;
      b.series = higherSeries(gh.history + gh.rounds + 1, gh, random);
      const quote = host.stockQuote();
      b.questions = Array.from({ length: gh.rounds }, (_, r) => {
        const now = b.series[gh.history + r]!;
        const next = b.series[gh.history + r + 1]!;
        return {
          q: quote?.name ?? "NEXA-Index",
          correct: next > now ? 0 : 1,
          value: next / 100,
          unit: "€",
          decimals: 2,
        };
      });
      b.questions.forEach((_, r) =>
        b.botAnswers.set(
          r,
          bots.flatMap((slot) => {
            const m = b.players[slot]!.memory;
            if (random() < 0.05) return [];
            // follow the trend, the better ones more often
            const a = b.series[gh.history + r - 1]!;
            const c = b.series[gh.history + r]!;
            const trend = c >= a ? 0 : 1;
            const choice = random() < 0.5 + m.skill * 0.35 ? trend : 1 - trend;
            return [{ slot, choice, ms: Math.round(700 + random() * (gh.answerMs - 1_500) * (1.2 - m.skill)) }];
          }),
        ),
      );
    } else if (kind === "auction") {
      b.questions = shuffle(cfg.auctionItems, random)
        .slice(0, g.auction.rounds)
        .map((x) => ({ q: x.name, points: x.points, icon: x.icon }));
    } else if (kind === "bell") {
      b.waits = Array.from(
        { length: g.bell.maxRounds },
        () => g.bell.waitMinMs + Math.floor(random() * (g.bell.waitMaxMs - g.bell.waitMinMs + 1)),
      );
      b.waits.forEach((_, r) =>
        b.botAnswers.set(
          r,
          bots.flatMap((slot) => {
            const m = b.players[slot]!.memory;
            const roll = random();
            if (roll < 0.03) return [];
            if (roll < 0.03 + 0.1 * (1 - m.skill)) return [{ slot, ms: -Math.round(100 + random() * 700) }];
            return [{ slot, ms: Math.round(210 + random() * 260 + (1 - m.skill) * 260) }];
          }),
        ),
      );
    }
  }

  function start(b: DemoBattle, now: number): void {
    startedAt = [...startedAt.filter((t) => t > now - 7_200_000), now];
    const players = present(b, now);
    b.players = players;
    players.forEach((p, i) => {
      p.slot = i;
    });
    const kind = forced ?? weighted(cfg.weights, host.random, lastKind ?? undefined);
    b.kind = kind;
    b.params = battleParamsFor(kind);
    b.startedAt = now + cfg.lobby.introMs;
    b.status = "running";
    b.countdownEndsAt = null;
    if (isTickKind(kind)) {
      b.sim = initBattle(kind, b.seed, players.length, simParams(b.params));
      b.streams = players.map(() => "");
      b.endsAt = b.startedAt + battleMaxTicks(kind, simParams(b.params)) * cfg.net.tickMs + cfg.net.graceMs + 500;
    } else {
      plan(b, kind);
      const rounds = kind === "bell" ? cfg.games.bell.maxRounds : b.questions.length;
      const timing = isMoreRound(kind) ? cfg.games[kind] : null;
      const roundMs =
        kind === "bell"
          ? bellRoundMs(cfg.games.bell)
          : timing
            ? timing.answerMs + timing.revealMs
            : kind === "quiz"
              ? cfg.games.quiz.answerMs + cfg.games.quiz.revealMs
              : cfg.games.estimate.answerMs + cfg.games.estimate.revealMs;
      b.endsAt = b.startedAt + rounds * roundMs;
    }
    host.bump("battle_joins");
  }

  function roundsState(b: DemoBattle, now: number): { state: RoundsState; closed: number; finishAt: number } {
    const start0 = b.startedAt!;
    const n = b.players.length;
    const me = meIndex(b);
    const left = b.players.map((p) => {
      if (p.leftAt === null) return -1;
      let r = 0;
      const rounds = b.kind === "bell" ? cfg.games.bell.maxRounds : b.questions.length;
      while (r < rounds - 1 && p.leftAt >= endOf(b, r)) r++;
      return r;
    });
    if (b.kind === "auction") auctionBids(b, now);
    const answers = (r: number): RoundAnswer[] => {
      const list = [...(b.botAnswers.get(r) ?? [])];
      const mine = b.mine.get(r);
      if (me >= 0 && mine && mine.at !== null) {
        if (b.kind === "bell") {
          const bell = bellTimes(start0, r, b.waits[r] ?? 0, cfg.games.bell).bell;
          const ms = mine.at < bell ? mine.at - bell : mine.at - (mine.revealedAt ?? bell);
          list.push({ slot: me, ms });
        } else {
          list.push({ slot: me, choice: mine.choice, value: mine.value, ms: mine.at - opensOf(b, r) });
        }
      }
      return list;
    };
    let closed = 0;
    const total = b.kind === "bell" ? cfg.games.bell.maxRounds : b.questions.length;
    while (closed < total && now >= closesOf(b, closed)) closed++;
    const all = Array.from({ length: total }, (_, r) => answers(r));
    const more = isMoreRound(b.kind) ? b.kind : null;
    const state =
      more === "vault"
        ? vaultEval(
            n,
            b.questions.map((q) => q.code ?? ""),
            Array.from({ length: total }, (_, r) => vaultTries(b, r)),
            left,
            closed,
            cfg.games.vault,
          )
        : more === "ticker"
          ? tickerEval(
              n,
              b.questions.map((q) => q.correct ?? 0),
              all,
              left,
              closed,
              cfg.games.ticker,
            )
          : more === "higher"
            ? higherEval(
                n,
                b.questions.map((q) => q.correct ?? 0),
                all,
                left,
                closed,
                cfg.games.higher,
              )
            : more === "auction"
              ? auctionEval(
                  b.seed,
                  n,
                  b.questions.map((q) => q.points ?? 0),
                  all,
                  left,
                  closed,
                  cfg.games.auction,
                )
              : b.kind === "quiz"
                ? quizEval(
                    n,
                    b.questions.map((q) => q.correct ?? 0),
                    all,
                    left,
                    closed,
                    cfg.games.quiz,
                  )
                : b.kind === "estimate"
                  ? estimateEval(
                      n,
                      b.questions.map((q) => q.value ?? 0),
                      all,
                      left,
                      closed,
                      cfg.games.estimate,
                    )
                  : bellEval(b.seed, n, all, left, closed, cfg.games.bell);
    const last = state.results.length - 1;
    return { state, closed, finishAt: last >= 0 ? endOf(b, last) : start0 };
  }

  /** Tresorknacker: the tries of round r, the bots' and mine, with ms after the round opened. */
  function vaultTries(b: DemoBattle, r: number): VaultTry[] {
    const me = meIndex(b);
    const opens = opensOf(b, r);
    const now = host.now();
    const bots = (b.tries.get(r) ?? []).filter((x) => x.slot !== me && opens + x.ms <= now);
    const mine = (b.tries.get(r) ?? []).filter((x) => x.slot === me);
    return [...bots, ...mine].sort((a, c) => a.ms - c.ms);
  }

  /**
   * Wer bietet mehr?: the made-up opponents bid when a round opens, by what the item is worth to them and what
   * they have left (their budgets come from the rounds before).
   */
  function auctionBids(b: DemoBattle, now: number): void {
    const g = cfg.games.auction;
    for (let r = 0; r < b.questions.length; r++) {
      if (now < opensOf(b, r) || b.botAnswers.has(r)) continue;
      const before = auctionEval(
        b.seed,
        b.players.length,
        b.questions.map((q) => q.points ?? 0),
        Array.from({ length: r }, (_, k) => [...(b.botAnswers.get(k) ?? []), ...myAnswer(b, k)]),
        b.players.map(() => -1),
        r,
        g,
      );
      const points = b.questions[r]!.points ?? 0;
      const roundsLeft = b.questions.length - r;
      b.botAnswers.set(
        r,
        b.players.flatMap((p, slot) => {
          if (!p.bot) return [];
          const m = p.memory;
          const budget = before.budget[slot]!;
          if (host.random() < 0.12) return [{ slot, value: 0, ms: Math.round(2_000 + host.random() * 5_000) }];
          const fair = (budget / Math.max(1, roundsLeft)) * (points / 160);
          const value = Math.max(
            0,
            Math.min(budget, Math.round((fair * (0.6 + host.random() * 0.9 * m.skill)) / 10) * 10),
          );
          return [{ slot, value, ms: Math.round(1_500 + host.random() * (g.answerMs - 3_000)) }];
        }),
      );
    }
  }

  function myAnswer(b: DemoBattle, r: number): RoundAnswer[] {
    const me = meIndex(b);
    const mine = b.mine.get(r);
    if (me < 0 || !mine || mine.at === null) return [];
    return [{ slot: me, choice: mine.choice, value: mine.value, ms: mine.at - opensOf(b, r) }];
  }

  function opensOf(b: DemoBattle, r: number): number {
    const s = b.startedAt!;
    if (isMoreRound(b.kind)) return roundTimes(s, r, cfg.games[b.kind]).opens;
    if (b.kind === "quiz") return quizTimes(s, r, cfg.games.quiz).opens;
    if (b.kind === "estimate") return estimateTimes(s, r, cfg.games.estimate).opens;
    return bellTimes(s, r, b.waits[r] ?? 0, cfg.games.bell).slot;
  }

  function closesOf(b: DemoBattle, r: number): number {
    const s = b.startedAt!;
    if (isMoreRound(b.kind)) return roundTimes(s, r, cfg.games[b.kind]).closes;
    if (b.kind === "quiz") return quizTimes(s, r, cfg.games.quiz).closes;
    if (b.kind === "estimate") return estimateTimes(s, r, cfg.games.estimate).closes;
    return bellTimes(s, r, b.waits[r] ?? 0, cfg.games.bell).closes;
  }

  function endOf(b: DemoBattle, r: number): number {
    const s = b.startedAt!;
    if (isMoreRound(b.kind)) return roundTimes(s, r, cfg.games[b.kind]).ends;
    if (b.kind === "quiz") return quizTimes(s, r, cfg.games.quiz).ends;
    if (b.kind === "estimate") return estimateTimes(s, r, cfg.games.estimate).ends;
    return bellTimes(s, r, b.waits[r] ?? 0, cfg.games.bell).ends;
  }

  /** Runs the action game up to the final tick, with the bots deciding tick by tick. */
  function advance(b: DemoBattle, now: number): void {
    if (!b.sim || !b.params || b.startedAt === null || !b.kind || !isTickKind(b.kind)) return;
    const kind: TickKind = b.kind;
    const params = simParams(b.params);
    const until = Math.min(finalTick(now - b.startedAt, cfg.net.tickMs, cfg.net.graceMs), battleMaxTicks(kind, params));
    while (!b.sim.done && b.sim.tick < until) {
      const t = b.sim.tick;
      b.players.forEach((p, slot) => {
        if (!p.bot) {
          // what the player did not send in time counts as nothing
          if (b.streams[slot]!.length <= t) b.streams[slot] = b.streams[slot]!.padEnd(t + 1, "x");
          return;
        }
        if (b.streams[slot]!.length === t)
          b.streams[slot] += botInput(kind, b.sim!, slot, p.memory, b.params as never, host.random);
      });
      stepBattle(kind, b.sim, tickInputs(b.streams, t), params);
    }
  }

  function finish(
    b: DemoBattle,
    now: number,
    ranking: number[],
    endTick: number | null,
    extra: Partial<NonNullable<Battle["result"]>>,
  ) {
    b.status = "finished";
    b.finishedAt = now;
    ranking.forEach((slot, place) => {
      const p = b.players[slot];
      if (p) p.rank = place + 1;
    });
    const winner = b.players[ranking[0] ?? -1];
    const iWon = !!winner && !winner.bot;
    let prize: BattlePrize = { kind: "none" };
    let paid = false;
    let capped = false;
    if (winner) {
      if (iWon && host.prizeWinsToday() >= cfg.prizes.dailyPrizeCap) capped = true;
      else {
        prize = prizeOf(b, b.players.length);
        if (iWon) {
          if (prize.kind === "skin") {
            const free = cfg.accessories.filter((a) => !host.ownedAccessories().includes(a.key));
            const pick = free[Math.floor(host.random() * free.length)];
            if (pick) {
              host.giveAccessory(pick.key);
              prize = { kind: "skin", key: pick.key, name: pick.name };
            } else
              prize = { ...prizeOf({ ...b, prizeKind: "money" }, b.players.length), fallback: true } as BattlePrize;
          } else if (prize.kind === "accessory") {
            const tier = prize.tier;
            const free = ACCESSORIES.filter((a) => a.rarity === tier && !host.ownedAccessories().includes(a.key));
            const pick = free[Math.floor(host.random() * free.length)];
            if (pick) {
              host.giveAccessory(pick.key);
              prize = { kind: "accessory", tier, key: pick.key, name: pick.name };
            } else
              prize = { ...prizeOf({ ...b, prizeKind: "money" }, b.players.length), fallback: true } as BattlePrize;
          } else if (prize.kind === "packs") {
            for (const x of prize.packs) host.grantSealedPacks?.(x.set, x.count, "battle");
          } else if (prize.kind === "nft") {
            if (!host.giveArtwork(prize.artwork.id))
              prize = { ...prizeOf({ ...b, prizeKind: "money" }, b.players.length), fallback: true } as BattlePrize;
          }
          if (prize.kind === "xp")
            prize = {
              kind: "xp",
              xp: host.addXp(
                cfg.prizes.xpBase + cfg.prizes.xpPerPlayer * Math.max(b.players.length, cfg.lobby.minPlayers),
              ),
            };
          if (prize.kind === "money") host.addCash(prize.cents);
          host.countPrizeWin();
          host.bump("battle_wins");
          host.feed("battle_won", { kind: b.kind, game: cfg.names[b.kind!], players: b.players.length });
        }
        paid = true;
      }
    }
    b.result = {
      ranking,
      winnerSlot: ranking[0] ?? 0,
      endTick,
      paid,
      capped,
      prize,
      score: extra.score ?? null,
      out: extra.out ?? null,
    };
    lastKind = b.kind;
    recent = b;
    current = null;
  }

  /** Battles of the hour `now` lies in that started (three per hour, like the server). */
  const startedThisHour = (now: number) => {
    const hour = Math.floor(now / 3_600_000) * 3_600_000;
    return startedAt.filter((t) => t >= hour).length;
  };

  function maintain(now: number): void {
    if (current === null) {
      // in the demo the made-up opponents are always there: the limit holds unless a game was picked by hand
      if (startedThisHour(now) >= cfg.lobby.perHour && forced === null) return;
      current = open(now);
    }
    const b = current;
    if (b.status === "open") {
      const count = present(b, now).length;
      if (count >= cfg.lobby.minPlayers && b.countdownEndsAt === null)
        b.countdownEndsAt = now + cfg.demo.countdownSeconds * 1000;
      if (count < cfg.lobby.minPlayers) b.countdownEndsAt = null;
      if (count >= cfg.lobby.maxPlayers || (b.countdownEndsAt !== null && now >= b.countdownEndsAt)) start(b, now);
      return;
    }
    if (b.status !== "running" || b.startedAt === null || now < b.startedAt) return;
    if (b.kind && isTickKind(b.kind)) {
      advance(b, now);
      if (b.sim?.done || (b.endsAt !== null && now >= b.endsAt)) {
        if (!b.sim!.done) advance(b, b.endsAt! + 10_000);
        const extra = b.sim as unknown as Record<string, number[] | undefined>;
        finish(b, now, battleRanking(b.kind, b.sim!), b.sim!.endTick, {
          score: extra.score ?? extra.hearts ?? extra.pushes ?? extra.held ?? b.sim!.p.steps,
          out: b.sim!.p.out,
        });
      }
      return;
    }
    const { state, finishAt } = roundsState(b, now);
    if ((state.done && now >= finishAt) || (b.endsAt !== null && now >= b.endsAt)) {
      const ranking =
        b.kind === "quiz"
          ? quizRanking(b.seed, state)
          : b.kind === "estimate"
            ? estimateRanking(b.seed, state)
            : b.kind === "vault" || b.kind === "ticker"
              ? pointsRanking(b.seed, state)
              : b.kind === "higher"
                ? higherRanking(b.seed, state)
                : b.kind === "auction"
                  ? auctionRanking(b.seed, state as AuctionState)
                  : bellRanking(b.seed, state);
      finish(b, now, ranking, null, { score: state.points, out: state.out });
    }
  }

  function roundsView(b: DemoBattle, now: number): Battle["rounds"] {
    if (b.startedAt === null || !b.kind || isTickKind(b.kind)) return null;
    const { state } = roundsState(b, now);
    const total = b.kind === "bell" ? cfg.games.bell.maxRounds : b.questions.length;
    const lastRound = state.done ? state.results.length - 1 : total - 1;
    const list: BattleRound[] = [];
    const me = meIndex(b);
    for (let r = 0; r <= lastRound; r++) {
      const s = b.startedAt;
      const mine = b.mine.get(r);
      if (b.kind === "bell") {
        const times = bellTimes(s, r, b.waits[r] ?? 0, cfg.games.bell);
        if (now < times.slot) break;
        if (now >= times.bell && me >= 0 && b.status === "running") {
          const m = b.mine.get(r) ?? { at: null, revealedAt: null };
          if (m.revealedAt === null && m.at === null) b.mine.set(r, { ...m, revealedAt: now });
        }
        list.push({
          round: r,
          opensAt: iso(times.slot)!,
          closesAt: now >= times.bell ? iso(times.closes) : null,
          endsAt: iso(times.ends)!,
          bellAt: now >= times.bell ? iso(times.bell) : null,
          question: null,
          options: null,
          unit: null,
          decimals: null,
          correct: null,
          value: null,
          results: state.results[r]?.answers ?? null,
          lost: state.results[r]?.lost ?? null,
          mine: { pressed: mine?.at != null, choice: null, value: null },
        });
        continue;
      }
      const times = isMoreRound(b.kind)
        ? roundTimes(s, r, cfg.games[b.kind])
        : b.kind === "quiz"
          ? quizTimes(s, r, cfg.games.quiz)
          : estimateTimes(s, r, cfg.games.estimate);
      if (now < times.opens) break;
      const q = b.questions[r]!;
      const closed = now >= times.closes;
      const extra: Partial<BattleRound> = {};
      if (b.kind === "vault") {
        const gv = cfg.games.vault;
        const tries = vaultTries(b, r);
        extra.vault = {
          digits: gv.digits,
          symbols: gv.symbols,
          guesses: tries.filter((x) => x.slot === me).map((x) => ({ code: x.code, ...vaultFeedback(q.code!, x.code) })),
          progress: b.players.map((_, slot) => {
            const list = tries.filter((x) => x.slot === slot).slice(0, gv.maxTries);
            return { slot, tries: list.length, cracked: list.some((x) => x.code === q.code) };
          }),
          code: closed ? q.code! : null,
        };
      } else if (b.kind === "higher") {
        extra.chart = b.series.slice(0, cfg.games.higher.history + r + 1).map((c) => c / 100);
      } else if (b.kind === "auction") {
        const budgets = (state as AuctionState).budget ?? [];
        extra.auction = {
          points: q.points ?? 0,
          icon: q.icon ?? "gift",
          budget: me >= 0 ? budgets[me]! : null,
          budgets,
        };
      }
      list.push({
        round: r,
        opensAt: iso(times.opens)!,
        closesAt: iso(times.closes),
        endsAt: iso(times.ends)!,
        bellAt: null,
        question: q.q,
        options: q.options ?? null,
        unit: q.unit ?? null,
        decimals: q.decimals ?? null,
        correct: closed ? (q.correct ?? null) : null,
        value: closed ? (q.value ?? null) : null,
        results: state.results[r]?.answers ?? null,
        lost: state.results[r]?.lost ?? null,
        mine: {
          pressed:
            b.kind === "vault"
              ? (extra.vault?.guesses.some((x) => x.hits === cfg.games.vault.digits) ?? false)
              : mine?.at != null,
          choice: mine?.choice ?? null,
          value: mine?.value ?? null,
        },
        ...extra,
      });
    }
    return { list, hearts: state.hearts, points: state.points, out: state.out, done: state.done };
  }

  function view(b: DemoBattle | null, now: number): Battle | null {
    if (!b) return null;
    const players = b.status === "open" ? present(b, now) : b.players;
    const opened = b.status !== "open";
    return {
      id: b.id,
      status: b.status,
      kind: opened ? b.kind : null,
      seed: opened ? b.seed : null,
      openedAt: iso(b.openedAt)!,
      countdownEndsAt: iso(b.countdownEndsAt),
      startedAt: iso(b.startedAt),
      endsAt: iso(b.endsAt),
      finishedAt: iso(b.finishedAt),
      minPlayers: cfg.lobby.minPlayers,
      maxPlayers: cfg.lobby.maxPlayers,
      params: opened ? b.params : null,
      prize: b.result?.prize.kind && b.result.prize.kind !== "none" ? b.result.prize : prizeOf(b, players.length),
      players: players.map((p) => ({
        slot: p.slot,
        nickname: p.nickname,
        avatarKey: p.avatarKey,
        accessories: p.accessories,
        me: !p.bot,
        left: p.left,
        rank: p.rank,
      })),
      joined: players.some((p) => !p.bot),
      prizeWinsLeft: Math.max(0, cfg.prizes.dailyPrizeCap - host.prizeWinsToday()),
      rounds: roundsView(b, now),
      result: b.result,
    };
  }

  function state(now: number): BattleState {
    maintain(now);
    if (recent && recent.finishedAt !== null && now - recent.finishedAt > cfg.lobby.recentSeconds * 1000) recent = null;
    return {
      now: iso(now)!,
      viewers: 1 + (current?.players.filter((p) => p.bot && p.joinAt <= now).length ?? 0),
      battle: view(current, now),
      recent: view(recent, now),
      playedThisHour: startedThisHour(now),
      perHour: cfg.lobby.perHour,
      nextRoundAt: iso(Math.floor(now / 3_600_000) * 3_600_000 + 3_600_000)!,
    };
  }

  return {
    forceKind(kind) {
      forced = kind && (BATTLE_KINDS as readonly string[]).includes(kind) ? kind : null;
    },
    forcedKind: () => forced,
    async battle() {
      return state(host.now());
    },
    joinBattle: (requestId) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          const now = host.now();
          if (host.level() < cfg.lobby.minLevel) throw new GameError("locked");
          maintain(now);
          const b = current!;
          if (b.status !== "open") throw new GameError("battle_closed");
          if (meIndex(b) < 0) {
            if (present(b, now).length >= cfg.lobby.maxPlayers) throw new GameError("battle_full");
            const me = host.me();
            b.players.push({
              ...me,
              bot: false,
              joinAt: now,
              slot: null,
              left: false,
              leftAt: null,
              rank: null,
              memory: newBotMemory(host.random),
            });
            // made-up opponents join one after another
            const taken = new Set(b.players.map((p) => p.nickname));
            const pool = shuffle(cfg.demoBots, host.random).filter((x) => !taken.has(x.nickname));
            const count = cfg.demo.botsMin + Math.floor(host.random() * (cfg.demo.botsMax - cfg.demo.botsMin + 1));
            pool.slice(0, count).forEach((bot, k) =>
              b.players.push({
                nickname: bot.nickname,
                avatarKey: bot.avatarKey,
                accessories: [...bot.accessories],
                bot: true,
                joinAt: now + 700 + k * 650 + Math.floor(host.random() * 400),
                slot: null,
                left: false,
                leftAt: null,
                rank: null,
                memory: newBotMemory(host.random),
              }),
            );
          }
          return state(now);
        }),
      ),
    leaveBattle: (requestId) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          const now = host.now();
          const b = current;
          if (b) {
            const i = meIndex(b);
            // the made-up opponents only wait for the player
            if (i >= 0 && b.status === "open") b.players = [];
            else if (i >= 0 && b.status === "running") {
              const p = b.players[i]!;
              p.left = true;
              p.leftAt = now;
              if (b.sim && b.startedAt !== null)
                b.streams[i] = quitStream(b.streams[i]!, Math.max(0, currentTick(now - b.startedAt, cfg.net.tickMs)));
            }
          }
          return state(now);
        }),
      ),
    async syncBattle(battleId, from, inputs, since) {
      const now = host.now();
      const b = current?.id === battleId ? current : recent?.id === battleId ? recent : null;
      if (!b || !b.sim || b.startedAt === null || !b.kind || !isTickKind(b.kind)) throw new GameError("battle_unknown");
      const max = battleMaxTicks(b.kind, simParams(b.params!));
      const ms = now - b.startedAt;
      const final = Math.min(max, finalTick(ms, cfg.net.tickMs, cfg.net.graceMs));
      const me = meIndex(b);
      if (b.status === "running" && me >= 0 && !b.players[me]!.left && inputs)
        b.streams[me] = acceptChunk(
          b.streams[me]!,
          from,
          inputs,
          final,
          Math.min(currentTick(ms, cfg.net.tickMs), max - 1),
          cfg.net.aheadTicks,
        );
      if (b.status === "running") maintain(now);
      return {
        now: iso(now)!,
        status: b.status,
        finalTick: b.sim.done ? Math.max(final, b.sim.tick) : Math.min(final, b.sim.tick),
        streams: b.streams.map((s, slot) => ({ slot, data: s.slice(Math.max(0, since)) })),
      };
    },
    answerBattle: (requestId, battleId, round, choice, value) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          const now = host.now();
          const b = current;
          if (!b || b.id !== battleId || !b.kind || isTickKind(b.kind) || b.startedAt === null)
            throw new GameError("battle_unknown");
          const me = meIndex(b);
          if (me < 0 || b.players[me]!.left) throw new GameError("battle_not_joined");
          const total = b.kind === "bell" ? cfg.games.bell.maxRounds : b.questions.length;
          const opens = opensOf(b, round);
          if (b.status !== "running" || round >= total || now < opens || now >= closesOf(b, round))
            throw new GameError("battle_round_closed");
          if (b.kind === "vault") {
            // like battle_answer_more: a valid try, not after cracking, at most maxTries
            const gv = cfg.games.vault;
            const code = String(choice ?? "");
            if (!vaultValid(code, gv)) throw new GameError("invalid_argument");
            const list = b.tries.get(round) ?? [];
            const mineTries = list.filter((x) => x.slot === me);
            if (mineTries.length >= gv.maxTries || mineTries.some((x) => x.code === b.questions[round]!.code))
              throw new GameError("battle_round_closed");
            list.push({ slot: me, code, ms: now - opens });
            b.tries.set(round, list);
            return state(now);
          }
          if (b.kind === "ticker" && (choice === null || choice < 0 || choice >= cfg.games.ticker.options))
            throw new GameError("invalid_argument");
          if (b.kind === "higher" && choice !== 0 && choice !== 1) throw new GameError("invalid_argument");
          if (b.kind === "auction") {
            const left = (roundsState(b, now).state as AuctionState).budget[me] ?? 0;
            if (value === null || value < 0 || !Number.isInteger(value) || value > left)
              throw new GameError("invalid_argument");
          }
          const m = b.mine.get(round) ?? { at: null, revealedAt: null };
          if (m.at === null)
            b.mine.set(round, {
              ...m,
              at: now,
              choice:
                b.kind === "quiz" || b.kind === "ticker" || b.kind === "higher" ? (choice ?? undefined) : undefined,
              value: b.kind === "estimate" || b.kind === "auction" ? (value ?? undefined) : undefined,
            });
          return state(now);
        }),
      ),
  };
}
