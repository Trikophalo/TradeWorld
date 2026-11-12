import { z } from "zod";
import type { Friends, GameEngine } from "./types";
import { rpc } from "./rpc";

/*
 * Friends against the server (ADR-084).
 */
const entry = z.object({
  nickname: z.string(),
  tag: z.string().nullable().default(null),
  level: z.number(),
  since: z.string().optional(),
  at: z.string().optional(),
});
const friendsSchema = z.object({
  friends: z.array(entry),
  incoming: z.array(entry),
  outgoing: z.array(entry),
});

const searchSchema = z.object({
  players: z.array(
    z.object({
      nickname: z.string(),
      tag: z.string().nullable().default(null),
      level: z.number(),
      avatar_key: z.string(),
    }),
  ),
});

export const FRIEND_RPC_SCHEMAS = {
  search_players: searchSchema,
  get_friends: friendsSchema,
  send_friend_request: friendsSchema,
  respond_friend_request: friendsSchema,
  remove_friend: friendsSchema,
} as const;

const toEntry = (e: z.infer<typeof entry>) => ({
  nickname: e.nickname,
  tag: e.tag,
  level: e.level,
  at: e.since ?? e.at ?? "",
});
const toFriends = (r: z.infer<typeof friendsSchema>): Friends => ({
  friends: r.friends.map(toEntry),
  incoming: r.incoming.map(toEntry),
  outgoing: r.outgoing.map(toEntry),
});

export const liveFriendEngine: Pick<
  GameEngine,
  "friends" | "sendFriendRequest" | "respondFriendRequest" | "removeFriend" | "searchPlayers"
> = {
  async searchPlayers(query) {
    if (query.trim().length < 2) return [];
    const r = await rpc("search_players", { p_query: query.trim() }, searchSchema);
    return r.players.map((p) => ({ nickname: p.nickname, tag: p.tag, level: p.level, avatarKey: p.avatar_key }));
  },
  async friends() {
    return toFriends(await rpc("get_friends", {}, friendsSchema));
  },
  async sendFriendRequest(requestId, nickname) {
    return toFriends(
      await rpc("send_friend_request", { p_request_id: requestId, p_nickname: nickname }, friendsSchema),
    );
  },
  async respondFriendRequest(requestId, nickname, accept) {
    return toFriends(
      await rpc(
        "respond_friend_request",
        { p_request_id: requestId, p_nickname: nickname, p_accept: accept },
        friendsSchema,
      ),
    );
  },
  async removeFriend(requestId, nickname) {
    return toFriends(await rpc("remove_friend", { p_request_id: requestId, p_nickname: nickname }, friendsSchema));
  },
};
