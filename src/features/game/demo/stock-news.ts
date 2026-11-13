import { BALANCE } from "@/config/balance";
import type { GameEngine, StockNewsItem } from "../types";

/*
 * Stock news with a lead in the offline demo (ADR-119): the same rhythm as the server. A hint names a stock and a
 * direction; after the lead time the price moves, or the hint fizzles. Kept in memory: a reload starts fresh.
 */
export interface StockNewsHost {
  companies(): readonly { ticker: string; name: string }[];
  /** Moves the demo price of a stock by this many basis points. */
  shock(ticker: string, moveBps: number): void;
  now(): number;
  random(): number;
}

interface Tip extends StockNewsItem {
  comesTrue: boolean;
  plannedBps: number;
}

const UP = [
  "Rekordauftrag für {name}",
  "{name} hebt die Prognose an",
  "Star-Investor steigt bei {name} ein",
  "{name} gewinnt Branchenpreis",
  "Übernahmegerüchte um {name}",
  "{name} startet Aktienrückkauf",
];
const DOWN = [
  "Affäre erschüttert {name}",
  "{name} plant Kapitalerhöhung",
  "Rückruf bei {name}",
  "Datenleck bei {name}",
  "{name}-Chef tritt überraschend zurück",
  "Razzia bei {name}",
];
const WORDS = ["leicht", "spürbar", "deutlich"] as const;

export function createStockNewsEngine(host: StockNewsHost): Pick<GameEngine, "stockNews"> {
  const cfg = BALANCE.stockNews;
  const tips: Tip[] = [];
  let seq = 0;

  const step = () => {
    const now = host.now();
    for (const tip of tips) {
      if (tip.status !== "open" || Date.parse(tip.dueAt) > now) continue;
      if (tip.comesTrue) {
        host.shock(tip.ticker, tip.plannedBps);
        tip.status = "confirmed";
        tip.moveBps = tip.plannedBps;
      } else {
        tip.status = "fizzled";
      }
    }
    const last = tips[0];
    if (last && now - Date.parse(last.publishedAt) < cfg.everyMinutes * 60_000) return;
    const free = host.companies().filter((c) => !tips.some((t) => t.status === "open" && t.ticker === c.ticker));
    const company = free[Math.floor(host.random() * free.length)];
    if (!company) return;
    const up = host.random() < 0.5;
    const size = cfg.minMoveBps + Math.floor(host.random() * (cfg.maxMoveBps - cfg.minMoveBps + 1));
    const strength = Math.min(3, 1 + Math.floor((3 * (size - cfg.minMoveBps)) / (cfg.maxMoveBps - cfg.minMoveBps + 1)));
    const texts = up ? UP : DOWN;
    const lead = cfg.leadMinMinutes + host.random() * (cfg.leadMaxMinutes - cfg.leadMinMinutes);
    tips.unshift({
      id: ++seq,
      ticker: company.ticker,
      name: company.name,
      headline: texts[Math.floor(host.random() * texts.length)]!.replace("{name}", company.name),
      body: `Beobachter rechnen in Kürze mit einem ${WORDS[strength - 1]} ${up ? "steigenden" : "fallenden"} Kurs. Sicher ist das nicht.`,
      direction: up ? "up" : "down",
      strength: strength as 1 | 2 | 3,
      publishedAt: new Date(now).toISOString(),
      dueAt: new Date(now + lead * 60_000).toISOString(),
      status: "open",
      moveBps: null,
      comesTrue: host.random() * 10_000 < cfg.reliabilityBps,
      plannedBps: (up ? 1 : -1) * size,
    });
    tips.splice(30);
  };

  return {
    async stockNews(limit = 20) {
      step();
      return {
        reliabilityBps: cfg.reliabilityBps,
        // The plan (comesTrue, plannedBps) stays inside.
        items: tips.slice(0, limit).map((tip) => ({
          id: tip.id,
          ticker: tip.ticker,
          name: tip.name,
          headline: tip.headline,
          body: tip.body,
          direction: tip.direction,
          strength: tip.strength,
          publishedAt: tip.publishedAt,
          dueAt: tip.dueAt,
          status: tip.status,
          moveBps: tip.moveBps,
        })),
      };
    },
  };
}
