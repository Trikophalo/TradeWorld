import { BALANCE } from "@/config/balance";
import type { AppNotification, FeedItem, GameEngine, GameEvent, GameEvents, League, MarketSnapshot } from "../types";
import { GameError } from "../types";

/*
 * Friends feed, notifications, weekly league and announced events in the offline demo (ADR-088 to ADR-090).
 * The demo has no other players: the feed shows the own news, the league has one entry, the events are planned
 * from the clock and the demo market (bells, earnings of the largest companies, a pharma trial) without effect.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface DemoSocialState {
  seq: number;
  feed: Omit<FeedItem, "actor" | "isMe">[];
  notifications: AppNotification[];
  league?: { weekStart: string; startNetWorthCents: number; inflowCents: number };
  trophies?: { gold: number; silver: number; bronze: number };
}

export interface SocialHost {
  state(): DemoSocialState;
  nickname(): string;
  tag(): string;
  level(): number;
  avatarKey(): string;
  netWorthCents(): number;
  snapshot(): MarketSnapshot | null;
  idempotent<T>(requestId: string, run: () => T): T;
  persist(): void;
}

/** Monday 00:00 Europe/Berlin of the week containing `at`, as an ISO date and a timestamp. */
export function berlinWeek(at: number): { weekStart: string; startsAt: number; endsAt: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  const sinceMidnight = (Number(get("hour")) * 60 + Number(get("minute"))) * 60_000;
  const startsAt = at - weekday * DAY - sinceMidnight - (at % 60_000);
  const local = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")) - weekday));
  return { weekStart: local.toISOString().slice(0, 10), startsAt, endsAt: startsAt + 7 * DAY };
}

export function createSocialEngine(host: SocialHost) {
  const me = () => ({ nickname: host.nickname(), tag: host.tag(), avatarKey: host.avatarKey(), level: host.level() });

  /** Adds an own feed item (called by the demo engine at the same moments the server posts one). */
  function post(kind: string, payload: Record<string, unknown>) {
    const s = host.state();
    s.seq += 1;
    s.feed = [
      { id: s.seq, kind, payload, createdAt: new Date().toISOString(), reactions: 0, reacted: false },
      ...s.feed,
    ].slice(0, 60);
  }

  function notify(typeKey: string, title: string, body: string | null, link: string | null) {
    const s = host.state();
    s.seq += 1;
    s.notifications = [
      { id: `n-${s.seq}`, typeKey, title, body, link, createdAt: new Date().toISOString(), readAt: null },
      ...s.notifications,
    ].slice(0, 40);
  }

  /** Free money (basic income) does not count as performance in the league (ADR-089). */
  function inflow(cents: number) {
    const league = currentLeague();
    league.inflowCents += Math.max(0, Math.round(cents));
  }

  function currentLeague() {
    const s = host.state();
    const week = berlinWeek(Date.now());
    if (!s.league || s.league.weekStart !== week.weekStart) {
      s.league = { weekStart: week.weekStart, startNetWorthCents: host.netWorthCents(), inflowCents: 0 };
    }
    return s.league;
  }

  function growthBps() {
    const l = currentLeague();
    const base = Math.max(l.startNetWorthCents, BALANCE.social.league.minBaselineCents);
    return Math.round(((host.netWorthCents() - l.startNetWorthCents - l.inflowCents) * 10_000) / base);
  }

  /** Bells, earnings of the largest companies at the quarter ends and one pharma trial, from the clock. */
  function events(): GameEvents {
    const now = Date.now();
    const horizon = now + BALANCE.events.schedule.horizonHours * HOUR;
    const recentFrom = now - BALANCE.events.schedule.recentHours * HOUR;
    const list: GameEvent[] = [];
    const snap = host.snapshot();
    const stocks = (snap?.securities ?? [])
      .filter((s) => s.kind === "stock")
      .sort((a, b) => (b.marketCapCents ?? 0) - (a.marketCapCents ?? 0));
    const top = stocks.slice(0, BALANCE.events.schedule.earningsTopCompanies);
    const pharma = stocks.find((s) => s.sector === "pharma");
    const quarterMs = BALANCE.time.quarterHours * HOUR;
    const day0 = berlinWeek(now).startsAt;

    const add = (e: Omit<GameEvent, "announcedAt" | "status" | "outcome">, outcome: Record<string, unknown> | null) => {
      const at = Date.parse(e.scheduledAt);
      if (at > horizon || at < recentFrom) return;
      const done = at <= now;
      list.push({
        ...e,
        announcedAt: new Date(at - 12 * HOUR).toISOString(),
        status: done ? "resolved" : "scheduled",
        outcome: done ? outcome : null,
      });
    };

    for (let d = Math.floor((recentFrom - day0) / DAY); d * DAY + day0 <= horizon; d++) {
      const dayStart = day0 + d * DAY;
      const open = dayStart + BALANCE.time.marketOpenHour * HOUR;
      const close = dayStart + BALANCE.time.marketCloseHour * HOUR;
      add(
        {
          id: `bell-o-${d}`,
          kind: "opening_bell",
          importance: 1,
          scheduledAt: new Date(open).toISOString(),
          ticker: null,
          companyName: null,
          sector: null,
        },
        {},
      );
      add(
        {
          id: `bell-c-${d}`,
          kind: "closing_bell",
          importance: 1,
          scheduledAt: new Date(close).toISOString(),
          ticker: null,
          companyName: null,
          sector: null,
        },
        {},
      );
    }
    const firstQuarter = Math.floor(recentFrom / quarterMs);
    for (let q = firstQuarter; q * quarterMs <= horizon; q++) {
      const end = (q + 1) * quarterMs;
      top.forEach((s, i) => {
        // A stable pseudo surprise per company and quarter.
        const surprise = (((q * 7 + i * 13) % 21) - 10) * 100;
        add(
          {
            id: `earn-${q}-${s.ticker}`,
            kind: "earnings",
            importance: 2,
            scheduledAt: new Date(end).toISOString(),
            ticker: s.ticker,
            companyName: s.name,
            sector: s.sector,
          },
          { surprise_bps: surprise, revenue_change_bps: surprise + 300 },
        );
      });
      if (pharma && q % 3 === 0) {
        const success = q % 2 === 0;
        add(
          {
            id: `trial-${q}`,
            kind: "pharma_trial",
            importance: 3,
            scheduledAt: new Date(end - 2 * HOUR).toISOString(),
            ticker: pharma.ticker,
            companyName: pharma.name,
            sector: "pharma",
          },
          { success, move_bps: success ? 5_800 : -6_100 },
        );
      }
    }
    const upcoming = list
      .filter((e) => e.status === "scheduled")
      .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
    const recent = list
      .filter((e) => e.status === "resolved")
      .sort((a, b) => Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt));
    return { serverTime: new Date(now).toISOString(), upcoming, recent };
  }

  const engine: Pick<
    GameEngine,
    "feed" | "reactFeed" | "notifications" | "markNotificationsRead" | "league" | "events"
  > = {
    async feed(before) {
      const items = host
        .state()
        .feed.filter((i) => before == null || i.id < before)
        .slice(0, BALANCE.social.feed.pageSize)
        .map((i): FeedItem => ({ ...i, isMe: true, actor: me() }));
      return { items, nextBefore: items.length === BALANCE.social.feed.pageSize ? items.at(-1)!.id : null };
    },
    reactFeed: (requestId, itemId) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          const item = host.state().feed.find((i) => i.id === itemId);
          if (!item) throw new GameError("invalid_argument");
          item.reacted = !item.reacted;
          item.reactions = Math.max(0, item.reactions + (item.reacted ? 1 : -1));
          host.persist();
          return { ...item, isMe: true, actor: me() };
        }),
      ),
    async notifications() {
      const items = host.state().notifications;
      return { items, unread: items.filter((n) => !n.readAt).length };
    },
    async markNotificationsRead(ids) {
      const now = new Date().toISOString();
      for (const n of host.state().notifications) if (!n.readAt && (!ids || ids.includes(n.id))) n.readAt = now;
      host.persist();
      return host.state().notifications.filter((n) => !n.readAt).length;
    },
    async league(_scope, week): Promise<League> {
      const l = currentLeague();
      const w = berlinWeek(Date.now());
      const growth = growthBps();
      const last = week === "last";
      return {
        season: {
          weekStart: last ? berlinWeek(w.startsAt - DAY).weekStart : l.weekStart,
          startsAt: new Date(last ? w.startsAt - 7 * DAY : w.startsAt).toISOString(),
          endsAt: new Date(last ? w.startsAt : w.endsAt).toISOString(),
          status: last ? "closed" : "running",
        },
        entries: last ? [] : [{ rank: 1, ...me(), growthBps: growth, isMe: true }],
        me: last ? null : { rank: 1, growthBps: growth },
        lastWinner: null,
      };
    },
    async events() {
      return events();
    },
  };

  return {
    engine,
    post,
    notify,
    inflow,
    trophies: () => host.state().trophies ?? { gold: 0, silver: 0, bronze: 0 },
  };
}
