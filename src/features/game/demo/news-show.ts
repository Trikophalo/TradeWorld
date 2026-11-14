import { BALANCE } from "@/config/balance";
import type { NewsShowTextKey } from "@/config/news-show";
import { formatMoney } from "@/lib/format";
import { fillScript, movePercent, pickScript, showDurationMs, showSlot, usedKeys } from "@/lib/sim/news-show";
import {
  GameError,
  type GameEngine,
  type NewsShowChatMessage,
  type NewsShowSegment,
  type NewsShowState,
} from "../types";

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
  chat: (Omit<NewsShowChatMessage, "at"> & { at: number })[];
  seq: number;
  botUntil: number;
}

export interface NewsShowHost {
  state(): DemoNewsShowState | undefined;
  setState(s: DemoNewsShowState): void;
  nickname(): string;
  stocks(): { ticker: string; name: string; sector: string }[];
  sectorName(key: string): string;
  shock(ticker: string, moveBps: number): void;
  company(): { name: string; idea: string; awareness: number; taskMomentum?: number } | null;
  /** The player's net worth change of the day, if known. */
  dayChange(): { cents: number; bps: number } | null;
  addCash(cents: number): void;
  /** Multiplies the value of open company tasks. */
  scaleOpenTasks(factorBps: number): void;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
  random(): number;
}

const BOTS = ["Börsen-Bernd", "Dividenden-Doris", "Kurs-Kalle", "Hebel-Hanna", "Zocker-Zoe"] as const;
const BOT_LINES = [
  "💀💀💀",
  "Der Mann ist eine Legende 😂",
  "Ich hab's gewusst 📉",
  "Hahaha, ausgerechnet die!",
  "Mr. Doodle Dangle for President 👏",
  "Mein Depot weint 😭",
  "Kaufen, kaufen, kaufen 🚀",
  "🍿 Beste Sendung des Tages",
  "Wer hat das Skript geschrieben? 🤡",
  "Autsch 💸",
] as const;

export function createNewsShowEngine(host: NewsShowHost): Pick<GameEngine, "newsShow" | "postNewsShowMessage"> & {
  startNow(inMs?: number): void;
} {
  const load = (): DemoNewsShowState =>
    host.state() ?? { used: [], show: null, doneSlot: 0, forcedAt: null, chat: [], seq: 0, botUntil: 0 };
  const between = (lo: number, hi: number) => lo + Math.floor(host.random() * (hi - lo + 1));

  function script(s: DemoNewsShowState, kind: NewsShowTextKey, values: Record<string, string | number>) {
    const pick = pickScript(kind, s.used, () => host.random());
    s.used = [...s.used, ...usedKeys(pick)].slice(-2_000);
    return { headline: fillScript(pick.headline, values), text: fillScript(pick.text, values) };
  }

  /** Writes the show and applies its effects, like news_show_build() and news_show_start(). */
  function air(s: DemoNewsShowState, slot: number, startedAt: number): DemoShow {
    const segments: NewsShowSegment[] = [];
    const sign = (up: boolean) => (up ? "+" : "−");

    const change = host.dayChange();
    if (change && change.bps <= -cfg.loser.minLossBps) {
      host.addCash(cfg.loser.consolationCents);
      segments.push({
        kind: "loser",
        ...script(s, "loser", {
          name: host.nickname(),
          amount: formatMoney(Math.abs(change.cents), { whole: true }),
          pct: movePercent(change.bps),
        }),
        effects: [
          { label: `+${formatMoney(cfg.loser.consolationCents, { whole: true })} Trostpflaster`, tone: "gain" },
        ],
      });
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
      segments.push({
        kind: scandal ? "scandal" : "hype",
        ...script(s, scandal ? "scandal" : "hype", {
          company: company.name,
          idea: company.idea.slice(0, 90) || "irgendwas mit Zukunft",
          founder: host.nickname(),
        }),
        effects: [{ label: `Bekanntheit ${sign(!scandal)}${movePercent(aw)}`, tone: scandal ? "loss" : "gain" }],
      });
    }

    const stocks = [...host.stocks()].sort(() => host.random() - 0.5);
    for (const stock of stocks.slice(0, cfg.stock.count)) {
      const up = host.random() < 0.5;
      const bps = between(cfg.stock.minBps, cfg.stock.maxBps);
      host.shock(stock.ticker, up ? bps : -bps);
      segments.push({
        kind: "stock",
        ...script(s, up ? "stockUp" : "stockDown", { stock: stock.name, move: movePercent(bps) }),
        effects: [{ label: `${stock.ticker} ${sign(up)}${movePercent(bps)}`, tone: up ? "gain" : "loss" }],
      });
    }

    const up = host.random() < 0.5;
    if (host.random() < 0.5 && stocks.length > 0) {
      const sector = stocks[stocks.length - 1]!.sector;
      const bps = between(cfg.sector.minBps, cfg.sector.maxBps);
      for (const stock of stocks.filter((x) => x.sector === sector)) host.shock(stock.ticker, up ? bps : -bps);
      const name = host.sectorName(sector);
      segments.push({
        kind: "sector",
        ...script(s, up ? "sectorUp" : "sectorDown", { sector: name, move: movePercent(bps) }),
        effects: [{ label: `${name} ${sign(up)}${movePercent(bps)}`, tone: up ? "gain" : "loss" }],
      });
    } else {
      const bps = between(cfg.tasks.minBps, cfg.tasks.maxBps);
      host.scaleOpenTasks(up ? bps : -bps);
      segments.push({
        kind: "tasks",
        ...script(s, up ? "tasksUp" : "tasksDown", { move: movePercent(bps) }),
        effects: [{ label: `Aufgaben ${sign(up)}${movePercent(bps)}`, tone: up ? "gain" : "loss" }],
      });
    }

    if (change && change.bps >= cfg.winner.minGainBps) {
      segments.push({
        kind: "winner",
        ...script(s, "winner", {
          name: host.nickname(),
          amount: formatMoney(change.cents, { whole: true }),
          pct: movePercent(change.bps),
        }),
        effects: [],
      });
    }

    const tipStock = stocks[Math.min(stocks.length - 1, cfg.stock.count)];
    const kept = segments.slice(0, cfg.maxSegments - (tipStock ? 1 : 0));
    if (tipStock) {
      const tipUp = host.random() < 0.5;
      kept.push({
        kind: "tip",
        ...script(s, "tip", { stock: tipStock.name, move: tipUp ? cfg.tipWords.up : cfg.tipWords.down }),
        effects: [{ label: `${tipStock.ticker} ${tipUp ? "↑" : "↓"} Tipp`, tone: "neutral" }],
      });
    }
    return { slot, startedAt, segments: kept };
  }

  /** The made-up audience writes now and then while a show runs. */
  function bots(s: DemoNewsShowState, now: number) {
    const show = s.show;
    if (!show || now > show.startedAt + showDurationMs(show.segments.length)) return;
    while (s.botUntil < now) {
      s.botUntil = Math.max(s.botUntil, show.startedAt) + between(5, 11) * 1000;
      if (s.botUntil > now) break;
      s.seq += 1;
      s.chat.push({
        id: s.seq,
        nickname: BOTS[between(0, BOTS.length - 1)]!,
        body: BOT_LINES[between(0, BOT_LINES.length - 1)]!,
        at: s.botUntil,
        mine: false,
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
    bots(s, now);
    host.setState(s);
    return s;
  }

  const chatOf = (s: DemoNewsShowState): NewsShowChatMessage[] =>
    s.chat.filter((m) => m.at <= host.now()).map((m) => ({ ...m, at: new Date(m.at).toISOString() }));

  return {
    async newsShow(): Promise<NewsShowState> {
      const s = tick();
      const now = host.now();
      const next = s.forcedAt ?? Math.max(showSlot(now), s.doneSlot + HOUR);
      return {
        now: new Date(now).toISOString(),
        nextAirsAt: new Date(next).toISOString(),
        viewers: 1 + (s.show && now < s.show.startedAt + showDurationMs(s.show.segments.length) ? BOTS.length : 0),
        upcoming: null,
        show: s.show && {
          id: s.show.slot,
          airsAt: new Date(s.show.slot).toISOString(),
          startedAt: new Date(s.show.startedAt).toISOString(),
          writer: "mini",
          segments: s.show.segments,
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
