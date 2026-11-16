import { BALANCE } from "@/config/balance";
import { FRIEND_CHAT_DEMO } from "@/config/friend-chat";
import { GameError, type FriendChatMessage, type FriendChatSummary, type FriendChats, type GameEngine } from "../types";
import type { DemoFriend } from "./friends";

/*
 * Chats with friends in the offline demo (ADR-164): the made-up friends (ADR-155) can be written to, alone or in
 * groups, and answer now and then with a short, silly line. The rules follow the server: only friends, groups of
 * social.chat.groupMinMembers to groupMaxMembers, the creator is admin, messages up to maxMessageLength.
 */

/** The demo player in authors and admins (the nickname may change). */
export const ME = "@me";

export interface DemoChatMessage {
  id: number;
  kind: "player" | "system";
  /** ME, a friend's nickname, or null for system lines. */
  author: string | null;
  body: string;
  at: number;
}

export interface DemoChat {
  id: number;
  kind: "direct" | "group";
  /** Groups only. */
  name: string | null;
  /** The friends in the chat (nicknames), never the demo player. */
  members: string[];
  /** ME or a friend's nickname. */
  admin: string | null;
  messages: DemoChatMessage[];
  lastRead: number;
  createdAt: number;
  /** Answers of the friends that arrive later. */
  pending: { at: number; author: string; body: string }[];
}

export interface FriendChatHost {
  nickname(): string;
  avatarKey(): string;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): Date;
  random(): number;
  friendList(): DemoFriend[];
  chats(): DemoChat[];
  setChats(value: DemoChat[]): void;
  persist(): void;
}

type ChatEngine = Pick<
  GameEngine,
  | "friendChats"
  | "friendChat"
  | "markFriendChatRead"
  | "openDirectChat"
  | "createGroupChat"
  | "postFriendChatMessage"
  | "addGroupMember"
  | "removeGroupMember"
  | "leaveGroup"
  | "renameGroup"
>;

const cfg = BALANCE.social.chat;

/** A group name as the server tidies it: trimmed, single spaces. */
export function tidyGroupName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Unread lines of a chat: other people's messages after the read mark. */
export function demoUnread(chat: DemoChat): number {
  return chat.messages.filter((m) => m.id > chat.lastRead && m.kind === "player" && m.author !== ME).length;
}

export function createFriendChatEngine(host: FriendChatHost): ChatEngine {
  const friendBy = (nickname: string) =>
    host.friendList().find((f) => f.nickname.toLowerCase() === nickname.trim().toLowerCase());
  const nextId = () => host.chats().reduce((max, c) => Math.max(max, c.id, ...c.messages.map((m) => m.id)), 0) + 1;
  const pick = (lines: readonly string[]) => lines[Math.floor(host.random() * lines.length)] ?? lines[0]!;
  const between = (lo: number, hi: number) => lo + Math.floor(host.random() * (hi - lo + 1));

  /** Answers whose time has come become messages. */
  const deliver = () => {
    const now = host.now().getTime();
    let changed = false;
    for (const chat of host.chats()) {
      const due = chat.pending.filter((x) => x.at <= now).sort((a, b) => a.at - b.at);
      if (due.length === 0) continue;
      chat.pending = chat.pending.filter((x) => x.at > now);
      for (const x of due) {
        if (!chat.members.includes(x.author)) continue;
        chat.messages.push({ id: nextId(), kind: "player", author: x.author, body: x.body, at: x.at });
      }
      changed = true;
    }
    if (changed) host.persist();
  };

  const find = (chatId: number) => {
    const chat = host.chats().find((c) => c.id === chatId);
    if (!chat) throw new GameError("chat_unknown");
    return chat;
  };

  const system = (chat: DemoChat, body: string) => {
    const id = nextId();
    chat.messages.push({ id, kind: "system", author: null, body, at: host.now().getTime() });
    return id;
  };

  const later = (chat: DemoChat, author: string, lines: readonly string[]) => {
    const at =
      host.now().getTime() +
      between(FRIEND_CHAT_DEMO.replyDelaySecondsMin, FRIEND_CHAT_DEMO.replyDelaySecondsMax) * 1000;
    chat.pending.push({ at, author, body: pick(lines).replaceAll("{name}", host.nickname()) });
  };

  const toMessage = (m: DemoChatMessage): FriendChatMessage => ({
    id: m.id,
    kind: m.kind,
    author: m.author === ME ? host.nickname() : m.author,
    avatarKey: m.author === ME ? host.avatarKey() : m.author ? (friendBy(m.author)?.avatarKey ?? null) : null,
    isMe: m.author === ME && m.kind === "player",
    body: m.body,
    createdAt: new Date(m.at).toISOString(),
  });

  const toSummary = (chat: DemoChat): FriendChatSummary => {
    const last = chat.messages[chat.messages.length - 1];
    return {
      id: chat.id,
      kind: chat.kind,
      name: chat.kind === "group" ? (chat.name ?? "") : (chat.members[0] ?? "?"),
      isAdmin: chat.admin === ME,
      canWrite: chat.kind === "group" || chat.members.every((n) => friendBy(n) !== undefined),
      unread: demoUnread(chat),
      memberCount: chat.members.length + 1,
      members: chat.members.map((nickname) => {
        const f = friendBy(nickname);
        return {
          nickname,
          tag: f?.tag ?? null,
          level: f?.level ?? 1,
          avatarKey: f?.avatarKey ?? "seller",
          accessories: f?.accessories ?? [],
          isAdmin: chat.admin === nickname,
          online: f?.online ?? false,
        };
      }),
      last: last ? toMessage(last) : null,
      lastAt: new Date(last?.at ?? chat.createdAt).toISOString(),
    };
  };

  const checkName = (raw: string) => {
    const name = tidyGroupName(raw);
    if (name.length < cfg.groupNameMinLength) throw new GameError("name_too_short");
    if (name.length > cfg.groupNameMaxLength) throw new GameError("name_too_long");
    return name;
  };

  const friendOrThrow = (nickname: string) => {
    if (nickname.trim().toLowerCase() === host.nickname().toLowerCase()) throw new GameError("invalid_argument");
    const friend = friendBy(nickname);
    if (!friend) throw new GameError("not_friends");
    return friend;
  };

  const write = <T>(requestId: string, run: () => T) =>
    Promise.resolve().then(() => {
      deliver();
      return host.idempotent(requestId, run);
    });

  return {
    async friendChats(): Promise<FriendChats> {
      deliver();
      const chats = host
        .chats()
        .map(toSummary)
        .sort((a, b) => b.lastAt.localeCompare(a.lastAt) || b.id - a.id);
      return { chats, unread: chats.reduce((sum, c) => sum + c.unread, 0) };
    },
    async friendChat(chatId, beforeId) {
      deliver();
      const chat = find(chatId);
      const older = chat.messages.filter((m) => beforeId == null || m.id < beforeId);
      const page = older.slice(-cfg.pageSize);
      return { chat: toSummary(chat), messages: page.map(toMessage), hasMore: older.length > page.length };
    },
    async markFriendChatRead(chatId) {
      deliver();
      const chat = find(chatId);
      chat.lastRead = chat.messages.reduce((max, m) => Math.max(max, m.id), chat.lastRead);
      host.persist();
      return host.chats().reduce((sum, c) => sum + demoUnread(c), 0);
    },
    openDirectChat: (requestId, nickname) =>
      write(requestId, () => {
        const friend = friendOrThrow(nickname);
        const existing = host.chats().find((c) => c.kind === "direct" && c.members[0] === friend.nickname);
        if (existing) return toSummary(existing);
        const chat: DemoChat = {
          id: nextId(),
          kind: "direct",
          name: null,
          members: [friend.nickname],
          admin: null,
          messages: [],
          lastRead: 0,
          createdAt: host.now().getTime(),
          pending: [],
        };
        host.setChats([...host.chats(), chat]);
        return toSummary(chat);
      }),
    createGroupChat: (requestId, rawName, nicknames) =>
      write(requestId, () => {
        const name = checkName(rawName);
        const members = [...new Set(nicknames.map((n) => friendOrThrow(n).nickname))];
        if (members.length + 1 < Math.max(2, cfg.groupMinMembers)) throw new GameError("chat_group_too_small");
        if (members.length + 1 > cfg.groupMaxMembers) throw new GameError("chat_group_full");
        const chat: DemoChat = {
          id: nextId(),
          kind: "group",
          name,
          members,
          admin: ME,
          messages: [],
          lastRead: 0,
          createdAt: host.now().getTime(),
          pending: [],
        };
        host.setChats([...host.chats(), chat]);
        chat.lastRead = system(chat, `${host.nickname()} hat die Gruppe „${name}“ gegründet.`);
        later(chat, members[Math.floor(host.random() * members.length)]!, FRIEND_CHAT_DEMO.lines.group);
        return toSummary(chat);
      }),
    postFriendChatMessage: (requestId, chatId, raw) =>
      write(requestId, () => {
        const chat = find(chatId);
        if (!toSummary(chat).canWrite) throw new GameError("chat_read_only");
        const body = raw.trim();
        if (!body || body.length > cfg.maxMessageLength) throw new GameError("invalid_argument");
        const message: DemoChatMessage = { id: nextId(), kind: "player", author: ME, body, at: host.now().getTime() };
        chat.messages.push(message);
        chat.lastRead = message.id;
        const question = body.includes("?");
        if (chat.members.length > 0 && (question || host.random() * 10_000 < FRIEND_CHAT_DEMO.replyChanceBps)) {
          const author = chat.members[Math.floor(host.random() * chat.members.length)]!;
          later(chat, author, question ? FRIEND_CHAT_DEMO.lines.question : FRIEND_CHAT_DEMO.lines.reply);
        }
        return toMessage(message);
      }),
    addGroupMember: (requestId, chatId, nickname) =>
      write(requestId, () => {
        const chat = find(chatId);
        if (chat.kind !== "group") throw new GameError("invalid_argument");
        const friend = friendOrThrow(nickname);
        if (chat.members.includes(friend.nickname)) throw new GameError("chat_already_member");
        if (chat.members.length + 1 >= cfg.groupMaxMembers) throw new GameError("chat_group_full");
        chat.members.push(friend.nickname);
        system(chat, `${host.nickname()} hat ${friend.nickname} hinzugefügt.`);
        later(chat, friend.nickname, FRIEND_CHAT_DEMO.lines.group);
        return toSummary(chat);
      }),
    removeGroupMember: (requestId, chatId, nickname) =>
      write(requestId, () => {
        const chat = find(chatId);
        if (chat.kind !== "group") throw new GameError("invalid_argument");
        if (chat.admin !== ME) throw new GameError("chat_not_admin");
        const member = chat.members.find((n) => n.toLowerCase() === nickname.trim().toLowerCase());
        if (!member) throw new GameError("player_not_found");
        chat.members = chat.members.filter((n) => n !== member);
        chat.pending = chat.pending.filter((x) => x.author !== member);
        system(chat, `${host.nickname()} hat ${member} aus der Gruppe genommen.`);
        return toSummary(chat);
      }),
    leaveGroup: (requestId, chatId) =>
      write(requestId, () => {
        const chat = find(chatId);
        if (chat.kind !== "group") throw new GameError("invalid_argument");
        // The friends are made up: without the demo player nobody is left to read the group.
        host.setChats(host.chats().filter((c) => c.id !== chat.id));
      }),
    renameGroup: (requestId, chatId, rawName) =>
      write(requestId, () => {
        const chat = find(chatId);
        if (chat.kind !== "group") throw new GameError("invalid_argument");
        if (chat.admin !== ME) throw new GameError("chat_not_admin");
        const name = checkName(rawName);
        if (name !== chat.name) {
          chat.name = name;
          system(chat, `${host.nickname()} hat die Gruppe in „${name}“ umbenannt.`);
        }
        return toSummary(chat);
      }),
  };
}
