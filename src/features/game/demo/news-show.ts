import { BALANCE } from "@/config/balance";
import type { NewsShowTextKey } from "@/config/news-show";
import { formatMoney } from "@/lib/format";
import {
  fillScript,
  movePercent,
  pickScript,
  pickTopics,
  showDurationMs,
  showSlot,
  usedKeys,
} from "@/lib/sim/news-show";
import {
  GameError,
  type GameEngine,
  type NewsShowChatMessage,
  type NewsShowFigure,
  type NewsShowMood,
  type NewsShowSegment,
  type NewsShowState,
} from "../types";
import { buildGagSegment, gagChatLines, matchesNamePattern } from "@/lib/sim/running-gag";
import { demoTopicCandidates } from "./news-topics";
import type { NexamonSetKey } from "@/config/nexamon/types";

/*
 * NEXA Nachrichten in the offline demo (ADR-150): the same rules as the server. The show of an hour starts when the
 * player has the stream open (there is nobody else), its effects hit the demo market, the player's own company and
 * the open tasks. A few made-up viewers write in the chat while it runs. `startNow` (demo button, tests) airs a
 * show right away.
 */
const cfg = BALANCE.newsShow;
const HOUR = 3_600_000;

interface DemoShow {
  slot: number;
  startedAt: number;
  segments: NewsShowSegment[];
}

export interface DemoNewsShowState {
  used: string[];
  show: DemoShow | null;
  /** Slots that are over (aired or missed), so a show never airs twice. */
  doneSlot: number;
  /** A show asked for with the demo button: starts at this time. */
  forcedAt: number | null;
  /** `bot` is missing in states saved before ADR-157: then every line that is not mine was a made-up viewer's. */
  chat: (Omit<NewsShowChatMessage, "at" | "bot"> & { at: number; bot?: boolean })[];
  seq: number;
  botUntil: number;
  /** Topics of the last show (ADR-169): they do not come twice in a row. Missing in older saved states. */
  lastTopics?: string[];
  /** Running gags (ADR-179): aired episodes and the last host line per gag and company. Missing in older states. */
  gags?: Record<string, { company: string; episodes: number; lastLine: number | null }>;
}

export interface NewsShowHost {
  state(): DemoNewsShowState | undefined;
  setState(s: DemoNewsShowState): void;
  nickname(): string;
  /** The player's look right now (ADR-157): portrait and worn accessories. */
  figure?(): Omit<NewsShowFigure, "nickname">;
  /** Friends who are online: they watch along while a show runs and now and then write a line. */
  friendsOnline?(): NewsShowFigure[];
  stocks(): { ticker: string; name: string; sector: string }[];
  sectorName(key: string): string;
  shock(ticker: string, moveBps: number): void;
  company(): { name: string; idea: string; awareness: number; taskMomentum?: number } | null;
  /** Personal facts about the player for the gossip ("Level 7 erreicht"); good ones praise, bad ones roast. */
  facts?(): { good: boolean; what: string }[];
  /** The player's net worth change of the day, if known. */
  dayChange(): { cents: number; bps: number } | null;
  addCash(cents: number): void;
  /** ADR-173: the segments of the CEO interview for this show (marked aired), empty without one. */
  interviewSegments?(): NewsShowSegment[];
  /** Multiplies the value of open company tasks. */
  scaleOpenTasks(factorBps: number): void;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
  random(): number;
}

const bots = cfg.chat.bots;
/** Stories about a person: in the demo always the player, shown on the TV in their current look (ADR-157). */
const PLAYER_KINDS = new Set(["loser", "winner", "gossip", "scandal", "hype", "nft", "interview"]);

const MOODS = ["neutral", "shocked", "crying", "laughing", "angry", "smug", "confused", "proud"];
const berlinTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

/**
 * The segments of the new-set announcements (ADR-182) for the show of the hour starting at `slot` (ms): only the
 * one show whose hour starts at an announcement's `at`, like news_show_announcements() on the server.
 */
export function announcementSegments(slot: number, force = false): NewsShowSegment[] {
  const out: NewsShowSegment[] = [];
  for (const a of BALANCE.newsShow.announcements) {
    if (!force && Date.parse(a.at) !== slot) continue;
    const time = berlinTime.format(Date.parse(a.releaseAt));
    for (const s of a.sets)
      out.push({
        kind: "release",
        mood: (MOODS.includes(s.mood) ? s.mood : "proud") as NewsShowSegment["mood"],
        headline: s.headline,
        text: s.text.replaceAll("{time}", time),
        effects: [],
        nexamon: { set: s.set as NexamonSetKey, cardKey: s.cardKey },
      });
  }
  return out;
}

export function createNewsShowEngine(host: NewsShowHost): Pick<GameEngine, "newsShow" | "postNewsShowMessage"> & {
  startNow(inMs?: number): void;
} {
  const load = (): DemoNewsShowState =>
    host.state() ?? { used: [], show: null, doneSlot: 0, forcedAt: null, chat: [], seq: 0, botUntil: 0 };
  const between = (lo: number, hi: number) => lo + Math.floor(host.random() * (hi - lo + 1));

  function script(s: DemoNewsShowState, kind: NewsShowTextKey, values: Record<string, string | number>) {
    const pick = pickScript(kind, s.used, () => host.random());
    s.used = [...s.used, ...usedKeys(pick)].slice(-2_000);
    const moods = cfg.moods[kind] as readonly NewsShowMood[];
    return {
      mood: moods[between(0, moods.length - 1)] ?? ("neutral" as const),
      headline: fillScript(pick.headline, values),
      text: fillScript(pick.text, values),
    };
  }

  /** Writes the show and applies its effects, like news_show_build() and news_show_start(). */
  function air(s: DemoNewsShowState, slot: number, startedAt: number): DemoShow {
    // every story carries its place in the running order, like the server's "ord"
    const stories: { ord: number; segment: NewsShowSegment }[] = [];
    const segments = { push: (segment: NewsShowSegment, ord: number) => stories.push({ ord, segment }) };
    // ADR-182: the announcement of new sets opens the one show of its hour
    for (const segment of announcementSegments(slot)) segments.push(segment, 1);
    const sign = (up: boolean) => (up ? "+" : "−");

    const change = host.dayChange();
    if (change && change.bps <= -cfg.loser.minLossBps) {
      host.addCash(cfg.loser.consolationCents);
      segments.push(
        {
          kind: "loser",
          ...script(s, "loser", {
            name: host.nickname(),
            amount: formatMoney(Math.abs(change.cents), { whole: true }),
            pct: movePercent(change.bps),
          }),
          effects: [
            { label: `+${formatMoney(cfg.loser.consolationCents, { whole: true })} Trostpflaster`, tone: "gain" },
          ],
        },
        10,
      );
    }

    // personal news: one fact about the player, each only once
    const fact = (host.facts?.() ?? []).find((f) => !s.used.includes(`fact:${f.what}`));
    if (fact) {
      s.used = [...s.used, `fact:${fact.what}`];
      if (!fact.good) host.addCash(cfg.gossip.hushMoneyCents);
      segments.push(
        {
          kind: "gossip",
          ...script(s, fact.good ? "gossipGood" : "gossipBad", { name: host.nickname(), what: fact.what }),
          effects: fact.good
            ? []
            : [{ label: `+${formatMoney(cfg.gossip.hushMoneyCents, { whole: true })} Schmerzensgeld`, tone: "gain" }],
        },
        20,
      );
    }

    const company = host.company();
    if (company) {
      const scandal = host.random() * 10_000 < cfg.company.scandalShareBps;
      const aw = between(cfg.company.awarenessMinBps, cfg.company.awarenessMaxBps);
      company.awareness = Math.min(1, Math.max(0.05, (company.awareness * (10_000 + (scandal ? -aw : aw))) / 10_000));
      if (scandal)
        company.taskMomentum = Math.max(
          1,
          1 + ((company.taskMomentum ?? 1) - 1) * (1 - cfg.company.momentumLossBps / 10_000),
        );
      segments.push(
        {
          kind: scandal ? "scandal" : "hype",
          ...script(s, scandal ? "scandal" : "hype", {
            company: company.name,
            idea: company.idea.slice(0, 90) || "irgendwas mit Zukunft",
            founder: host.nickname(),
          }),
          effects: [{ label: `Bekanntheit ${sign(!scandal)}${movePercent(aw)}`, tone: scandal ? "loss" : "gain" }],
        },
        30,
      );
    }

    const stocks = [...host.stocks()].sort(() => host.random() - 0.5);
    for (const stock of stocks.slice(0, cfg.stock.count)) {
      const up = host.random() < 0.5;
      const bps = between(cfg.stock.minBps, cfg.stock.maxBps);
      host.shock(stock.ticker, up ? bps : -bps);
      segments.push(
        {
          kind: "stock",
          ...script(s, up ? "stockUp" : "stockDown", { stock: stock.name, move: movePercent(bps) }),
          effects: [{ label: `${stock.ticker} ${sign(up)}${movePercent(bps)}`, tone: up ? "gain" : "loss" }],
        },
        100,
      );
    }

    const up = host.random() < 0.5;
    if (host.random() < 0.5 && stocks.length > 0) {
      const sector = stocks[stocks.length - 1]!.sector;
      const bps = between(cfg.sector.minBps, cfg.sector.maxBps);
      for (const stock of stocks.filter((x) => x.sector === sector)) host.shock(stock.ticker, up ? bps : -bps);
      const name = host.sectorName(sector);
      segments.push(
        {
          kind: "sector",
          ...script(s, up ? "sectorUp" : "sectorDown", { sector: name, move: movePercent(bps) }),
          effects: [{ label: `${name} ${sign(up)}${movePercent(bps)}`, tone: up ? "gain" : "loss" }],
        },
        90,
      );
    } else {
      const bps = between(cfg.tasks.minBps, cfg.tasks.maxBps);
      host.scaleOpenTasks(up ? bps : -bps);
      segments.push(
        {
          kind: "tasks",
          ...script(s, up ? "tasksUp" : "tasksDown", { move: movePercent(bps) }),
          effects: [{ label: `Aufgaben ${sign(up)}${movePercent(bps)}`, tone: up ? "gain" : "loss" }],
        },
        90,
      );
    }

    // he digresses: a rumour about a public figure and a stock, or pure nonsense
    if (host.random() * 10_000 < cfg.ramble.chanceBps) {
      const target = stocks[0];
      if (target && host.random() * 10_000 < cfg.ramble.investShareBps) {
        const bps = between(cfg.ramble.minBps, cfg.ramble.maxBps);
        host.shock(target.ticker, bps);
        segments.push(
          {
            kind: "ramble",
            ...script(s, "rambleInvest", {
              person: cfg.ramble.people[between(0, cfg.ramble.people.length - 1)]!,
              stock: target.name,
              move: movePercent(bps),
            }),
            effects: [{ label: `${target.ticker} +${movePercent(bps)}`, tone: "gain" }],
          },
          80,
        );
      } else segments.push({ kind: "ramble", ...script(s, "ramble", {}), effects: [] }, 80);
    }

    if (change && change.bps >= cfg.winner.minGainBps) {
      segments.push(
        {
          kind: "winner",
          ...script(s, "winner", {
            name: host.nickname(),
            amount: formatMoney(change.cents, { whole: true }),
            pct: movePercent(change.bps),
          }),
          effects: [],
        },
        50,
      );
    }

    // a CEO interview (ADR-173): the questions, the answers and his reactions
    (host.interviewSegments?.() ?? []).forEach((segment, i) => segments.push(segment, BALANCE.interviews.ord + i));

    // running gags (ADR-179): the player's company with the name, or (preview switch) a made-up one
    const gagSegments: { key: string; segment: NewsShowSegment; values: Record<string, string | number> }[] = [];
    for (const [key, gag] of Object.entries(cfg.runningGags)) {
      if (!gag.enabled || host.random() * 10_000 >= gag.chanceBps) continue;
      const own = company && matchesNamePattern(company.name, gag.namePattern) ? company.name : null;
      if (!own && !gag.demo.preview) continue;
      const name = own ?? gag.demo.company;
      const before = s.gags?.[key]?.company === name ? s.gags[key] : undefined;
      const episode = (before?.episodes ?? 0) + 1;
      const built = buildGagSegment(
        gag,
        {
          company: name,
          founder: own ? host.nickname() : gag.demo.founder,
          days: gag.demo.ageDays,
          episode,
          lastLine: before?.lastLine ?? null,
        },
        () => host.random(),
      );
      s.gags = { ...s.gags, [key]: { company: name, episodes: episode, lastLine: built.line } };
      const segment: NewsShowSegment = {
        kind: "gag",
        mood: built.mood,
        headline: built.headline,
        text: built.text,
        effects: [],
      };
      gagSegments.push({ key, segment, values: built.values });
      segments.push(segment, gag.ord);
    }

    // more topics (ADR-169): about fellow players, drawn like the server does; not the ones of the last show
    const friends = host.friendsOnline?.() ?? [];
    const candidates = demoTopicCandidates({
      players: friends.map((f) => f.nickname),
      stocks: stocks.map((x) => x.name),
      random: () => host.random(),
    });
    const topics = pickTopics(candidates, s.lastTopics ?? [], () => host.random());
    topics.forEach((pick, i) => {
      const meta = cfg.topics.list[pick.topic];
      const paid = meta.tone === "bad" && (meta.group === "person" || meta.group === "cards") && pick.player != null;
      const friend = friends.find((f) => f.nickname === pick.player);
      segments.push(
        {
          kind: meta.kind,
          ...script(s, pick.topic, pick.values),
          effects: paid
            ? [{ label: `+${formatMoney(cfg.topics.hushMoneyCents, { whole: true })} Schmerzensgeld`, tone: "gain" }]
            : [],
          ...(pick.player != null
            ? { figure: friend ?? { nickname: pick.player, avatarKey: null, accessories: [] } }
            : {}),
        },
        cfg.topics.ords[i] ?? 85 + i,
      );
    });
    s.lastTopics = topics.map((pick) => pick.topic);

    const ordered = stories
      .map((story, i) => ({ ...story, i }))
      .sort((a, b) => a.ord - b.ord || a.i - b.i)
      .map((story) => story.segment);
    const tipStock = stocks[Math.min(stocks.length - 1, cfg.stock.count)];
    const kept = ordered.slice(0, cfg.maxSegments - (tipStock ? 1 : 0));
    if (tipStock) {
      const tipUp = host.random() < 0.5;
      kept.push({
        kind: "tip",
        ...script(s, "tip", { stock: tipStock.name, move: tipUp ? cfg.tipWords.up : cfg.tipWords.down }),
        effects: [{ label: `${tipStock.ticker} ${tipUp ? "↑" : "↓"} Tipp`, tone: "neutral" }],
      });
    }
    // the viewers react around the gag: annoyed ones and the die-hard fans
    for (const gag of gagSegments) {
      const index = kept.indexOf(gag.segment);
      if (index < 0) continue;
      const rules = cfg.runningGags[gag.key as keyof typeof cfg.runningGags];
      const startsAt = startedAt + (cfg.introSeconds + index * cfg.segmentSeconds) * 1000;
      for (const line of gagChatLines(rules, gag.values, bots.names, cfg.segmentSeconds, () => host.random())) {
        s.seq += 1;
        s.chat.push({
          id: s.seq,
          nickname: line.name,
          body: line.body,
          at: startsAt + line.atSeconds * 1000,
          mine: false,
          bot: true,
        });
      }
    }
    return { slot, startedAt, segments: kept };
  }

  /** The made-up audience writes now and then while a show runs: furious, worshipping, or about the player. */
  function botsWrite(s: DemoNewsShowState, now: number) {
    const show = s.show;
    if (!show || now > show.startedAt + showDurationMs(show.segments.length)) return;
    const pick = (lines: readonly string[]) => lines[between(0, lines.length - 1)]!;
    const end = show.startedAt + showDurationMs(show.segments.length);
    // the next line is written ahead (the chat shows it once its time has come), like the server does
    while (s.botUntil < now) {
      s.botUntil = Math.max(s.botUntil, show.startedAt) + between(bots.everySecondsMin, bots.everySecondsMax) * 1000;
      if (s.botUntil > end) break;
      const u = host.random() * 10_000;
      const body =
        u < bots.aboutShareBps
          ? pick(bots.lines.about).replaceAll("{name}", host.nickname())
          : u < bots.aboutShareBps + bots.angryShareBps
            ? pick(bots.lines.angry)
            : pick(bots.lines.glaze);
      s.seq += 1;
      // now and then a friend who watches along says something instead of a made-up viewer
      const friends = host.friendsOnline?.() ?? [];
      const friend = friends.length > 0 && host.random() < 0.25 ? pick(friends.map((f) => f.nickname)) : null;
      s.chat.push({
        id: s.seq,
        nickname: friend ?? pick(bots.names),
        body,
        at: s.botUntil,
        mine: false,
        bot: friend === null,
      });
    }
    s.chat = s.chat.slice(-cfg.chat.history);
  }

  function tick(): DemoNewsShowState {
    const s = load();
    const now = host.now();
    const hour = Math.floor(now / HOUR) * HOUR;
    if (s.forcedAt !== null && now >= s.forcedAt) {
      s.show = air(s, hour, s.forcedAt);
      s.botUntil = s.forcedAt;
      s.forcedAt = null;
      s.doneSlot = Math.max(s.doneSlot, hour);
    } else if (hour > s.doneSlot && now - hour < cfg.waitMinutes * 60_000 && s.forcedAt === null) {
      // the player is the viewer: this hour's show starts now
      s.show = air(s, hour, now);
      s.botUntil = now;
      s.doneSlot = hour;
    }
    if (s.show && now - s.show.startedAt > cfg.replayMinutes * 60_000) s.show = null;
    botsWrite(s, now);
    host.setState(s);
    return s;
  }

  const chatOf = (s: DemoNewsShowState): NewsShowChatMessage[] =>
    s.chat
      .filter((m) => m.at <= host.now())
      .sort((a, b) => a.at - b.at)
      .map((m) => ({ ...m, at: new Date(m.at).toISOString(), bot: m.bot ?? !m.mine }));

  /** The player's current look; in the demo every story about a person is about the player. */
  const myFigure = (): NewsShowFigure => ({
    nickname: host.nickname(),
    avatarKey: host.figure?.().avatarKey ?? null,
    accessories: host.figure?.().accessories ?? [],
  });

  return {
    async newsShow(): Promise<NewsShowState> {
      const s = tick();
      const now = host.now();
      const next = s.forcedAt ?? Math.max(showSlot(now), s.doneSlot + HOUR);
      const running = s.show !== null && now < s.show.startedAt + showDurationMs(s.show.segments.length);
      // friends watch along while the show runs (the made-up viewers stand in the audience while they write)
      const friends = running ? (host.friendsOnline?.() ?? []) : [];
      const me = myFigure();
      return {
        now: new Date(now).toISOString(),
        nextAirsAt: new Date(next).toISOString(),
        viewers: 1 + friends.length,
        audience: [
          { ...me, friend: false, me: true },
          ...[...friends]
            .sort((a, b) => a.nickname.localeCompare(b.nickname))
            .map((f) => ({ ...f, friend: true, me: false })),
        ],
        upcoming: null,
        show: s.show && {
          id: s.show.slot,
          airsAt: new Date(s.show.slot).toISOString(),
          startedAt: new Date(s.show.startedAt).toISOString(),
          writer: "mini",
          segments: s.show.segments.map((segment) =>
            segment.figure || !PLAYER_KINDS.has(segment.kind) ? segment : { ...segment, figure: me },
          ),
        },
        chat: chatOf(s),
      };
    },
    postNewsShowMessage: (requestId, body) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          const text = body.trim();
          if (text.length < 1 || text.length > cfg.chat.maxLength) throw new GameError("chat_text_invalid");
          const s = tick();
          const now = host.now();
          if (s.chat.filter((m) => m.mine && m.at > now - 60_000).length >= cfg.chat.perMinute)
            throw new GameError("rate_limited");
          s.seq += 1;
          s.chat = [...s.chat, { id: s.seq, nickname: host.nickname(), body: text, at: now, mine: true }].slice(
            -cfg.chat.history,
          );
          host.setState(s);
          return chatOf(s);
        }),
      ),
    startNow(inMs = 4_000) {
      const s = load();
      s.forcedAt = host.now() + inMs;
      s.show = null;
      host.setState(s);
    },
  };
}
