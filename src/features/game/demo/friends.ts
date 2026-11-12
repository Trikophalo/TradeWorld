import { GameError, type Friends, type GameEngine } from "../types";

/*
 * Friends in the offline demo (ADR-084). The demo has no other players, so the list stays empty and every request
 * explains why: oneself is not a friend, anyone else does not exist here.
 */
export interface FriendHost {
  nickname(): string;
  idempotent<T>(requestId: string, run: () => T): T;
}

const empty = (): Friends => ({ friends: [], incoming: [], outgoing: [] });

export function createFriendEngine(
  host: FriendHost,
): Pick<GameEngine, "friends" | "sendFriendRequest" | "respondFriendRequest" | "removeFriend"> {
  return {
    async friends() {
      return empty();
    },
    sendFriendRequest: (requestId, nickname) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          if (nickname.trim().toLowerCase() === host.nickname().toLowerCase()) throw new GameError("invalid_argument");
          throw new GameError("player_not_found");
        }),
      ),
    respondFriendRequest: () => Promise.reject(new GameError("invalid_argument")),
    removeFriend: () => Promise.reject(new GameError("invalid_argument")),
  };
}
