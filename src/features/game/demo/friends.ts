import { nameKey, parseTag } from "@/lib/player-tag";
import { GameError, type Friends, type GameEngine } from "../types";

/*
 * Friends and player search in the offline demo (ADR-084, ADR-085). The demo has no other players: the list stays
 * empty, the search finds only oneself, and every request explains why it cannot work here.
 */
export interface FriendHost {
  nickname(): string;
  tag(): string;
  level(): number;
  avatarKey(): string;
  idempotent<T>(requestId: string, run: () => T): T;
}

const empty = (): Friends => ({ friends: [], incoming: [], outgoing: [] });

export function createFriendEngine(
  host: FriendHost,
): Pick<GameEngine, "friends" | "sendFriendRequest" | "respondFriendRequest" | "removeFriend" | "searchPlayers"> {
  const isMe = (input: string) =>
    input.trim().toLowerCase() === host.nickname().toLowerCase() || parseTag(input) === host.tag();
  return {
    async friends() {
      return empty();
    },
    sendFriendRequest: (requestId, nickname) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          if (isMe(nickname)) throw new GameError("invalid_argument");
          throw new GameError("player_not_found");
        }),
      ),
    respondFriendRequest: () => Promise.reject(new GameError("invalid_argument")),
    removeFriend: () => Promise.reject(new GameError("invalid_argument")),
    async searchPlayers(query) {
      const q = query.trim();
      if (q.length < 2) return [];
      const byTag = parseTag(q) === host.tag();
      const byName =
        nameKey(host.nickname()).includes(nameKey(q)) || host.nickname().toLowerCase().includes(q.toLowerCase());
      return byTag || byName
        ? [{ nickname: host.nickname(), tag: host.tag(), level: host.level(), avatarKey: host.avatarKey() }]
        : [];
    },
  };
}
