import { z } from "zod";
import type { Friends, GameEngine } from "./types";
import { rpc } from "./rpc";

/*
 * Friends against the server (ADR-084).
 */
const entry = z.object({
  nickname: z.string(),
  level: z.number(),
  since: z.string().optional(),
  at: z.string().optional(),
});
const friendsSchema = z.object({
  friends: z.array(entry),
  incoming: z.array(entry),
  outgoing: z.array(entry),
});

export const FRIEND_RPC_SCHEMAS = {
  get_friends: friendsSchema,
  send_friend_request: friendsSchema,
  respond_friend_request: friendsSchema,
  remove_friend: friendsSchema,
} as const;

const toEntry = (e: z.infer<typeof entry>) => ({ nickname: e.nickname, level: e.level, at: e.since ?? e.at ?? "" });
const toFriends = (r: z.infer<typeof friendsSchema>): Friends => ({
  friends: r.friends.map(toEntry),
  incoming: r.incoming.map(toEntry),
  outgoing: r.outgoing.map(toEntry),
});

export const liveFriendEngine: Pick<
  GameEngine,
  "friends" | "sendFriendRequest" | "respondFriendRequest" | "removeFriend"
> = {
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
