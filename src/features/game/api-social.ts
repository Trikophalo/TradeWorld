import { z } from "zod";
import type { FeedItem, GameEngine, GameEvent, League } from "./types";
import { rpc } from "./rpc";

/*
 * Friends feed, notifications, weekly league (ADR-088, ADR-089) and announced events (ADR-090) against the server.
 */
const num = z.number();
const actor = z.object({
  nickname: z.string(),
  tag: z.string().nullable().default(null),
  avatar_key: z.string(),
  level: num,
});
const feedItem = z.object({
  id: num,
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string(),
  is_me: z.boolean(),
  actor,
  reactions: num.default(0),
  reacted: z.boolean().default(false),
});
const feedSchema = z.object({ items: z.array(feedItem), next_before: num.nullable().default(null) });
const notificationsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      type_key: z.string(),
      title: z.string(),
      body: z.string().nullable().default(null),
      link: z.string().nullable().default(null),
      created_at: z.string(),
      read_at: z.string().nullable().default(null),
    }),
  ),
  unread: num,
});
const leagueSchema = z.object({
  season: z.object({ week_start: z.string(), starts_at: z.string(), ends_at: z.string(), status: z.string() }),
  entries: z.array(
    z.object({
      rank: num,
      nickname: z.string(),
      tag: z.string().nullable().default(null),
      avatar_key: z.string(),
      level: num,
      growth_bps: num,
      is_me: z.boolean(),
    }),
  ),
  me: z.object({ rank: num, growth_bps: num }).nullable(),
  last_winner: z
    .object({
      nickname: z.string(),
      tag: z.string().nullable().default(null),
      avatar_key: z.string(),
      growth_bps: num,
      week_start: z.string(),
    })
    .nullable()
    .default(null),
});
const eventSchema = z.object({
  id: z.string(),
  kind: z.string(),
  importance: num.default(1),
  scheduled_at: z.string(),
  announced_at: z.string(),
  status: z.string(),
  ticker: z.string().nullable().default(null),
  company_name: z.string().nullable().default(null),
  sector: z.string().nullable().default(null),
  outcome: z.record(z.string(), z.unknown()).nullable().default(null),
});
const eventsSchema = z.object({
  server_time: z.string(),
  upcoming: z.array(eventSchema),
  recent: z.array(eventSchema),
});

export const SOCIAL_RPC_SCHEMAS = {
  get_feed: feedSchema,
  react_feed: z.object({ item: feedItem }),
  get_notifications: notificationsSchema,
  mark_notifications_read: z.object({ unread: num }),
  get_league: leagueSchema,
  get_events: eventsSchema,
} as const;

const toItem = (i: z.infer<typeof feedItem>): FeedItem => ({
  id: i.id,
  kind: i.kind,
  payload: i.payload,
  createdAt: i.created_at,
  isMe: i.is_me,
  actor: { nickname: i.actor.nickname, tag: i.actor.tag, avatarKey: i.actor.avatar_key, level: i.actor.level },
  reactions: i.reactions,
  reacted: i.reacted,
});

const toEvent = (e: z.infer<typeof eventSchema>): GameEvent => ({
  id: e.id,
  kind: e.kind,
  importance: e.importance,
  scheduledAt: e.scheduled_at,
  announcedAt: e.announced_at,
  status: e.status,
  ticker: e.ticker,
  companyName: e.company_name,
  sector: e.sector,
  outcome: e.outcome,
});

export const liveSocialEngine: Pick<
  GameEngine,
  "feed" | "reactFeed" | "notifications" | "markNotificationsRead" | "league" | "events"
> = {
  async feed(before) {
    const r = await rpc("get_feed", { p_before: before ?? null }, feedSchema);
    return { items: r.items.map(toItem), nextBefore: r.next_before };
  },
  async reactFeed(requestId, itemId) {
    const r = await rpc("react_feed", { p_request_id: requestId, p_item_id: itemId }, SOCIAL_RPC_SCHEMAS.react_feed);
    return toItem(r.item);
  },
  async notifications() {
    const r = await rpc("get_notifications", {}, notificationsSchema);
    return {
      unread: r.unread,
      items: r.items.map((n) => ({
        id: n.id,
        typeKey: n.type_key,
        title: n.title,
        body: n.body,
        link: n.link,
        createdAt: n.created_at,
        readAt: n.read_at,
      })),
    };
  },
  async markNotificationsRead(ids) {
    const r = await rpc("mark_notifications_read", { p_ids: ids ?? null }, SOCIAL_RPC_SCHEMAS.mark_notifications_read);
    return r.unread;
  },
  async league(scope, week) {
    const r = await rpc("get_league", { p_scope: scope, p_week: week }, leagueSchema);
    const result: League = {
      season: {
        weekStart: r.season.week_start,
        startsAt: r.season.starts_at,
        endsAt: r.season.ends_at,
        status: r.season.status,
      },
      entries: r.entries.map((e) => ({
        rank: e.rank,
        nickname: e.nickname,
        tag: e.tag,
        avatarKey: e.avatar_key,
        level: e.level,
        growthBps: e.growth_bps,
        isMe: e.is_me,
      })),
      me: r.me ? { rank: r.me.rank, growthBps: r.me.growth_bps } : null,
      lastWinner: r.last_winner
        ? {
            nickname: r.last_winner.nickname,
            tag: r.last_winner.tag,
            avatarKey: r.last_winner.avatar_key,
            growthBps: r.last_winner.growth_bps,
            weekStart: r.last_winner.week_start,
          }
        : null,
    };
    return result;
  },
  async events() {
    const r = await rpc("get_events", {}, eventsSchema);
    return { serverTime: r.server_time, upcoming: r.upcoming.map(toEvent), recent: r.recent.map(toEvent) };
  },
};
