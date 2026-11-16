import { z } from "zod";
import type { FriendChatMessage, FriendChatSummary, GameEngine } from "./types";
import { rpc } from "./rpc";

/*
 * Chats with friends: direct chats and groups (ADR-164) against the server.
 */
const num = z.number();
const messageSchema = z.object({
  id: num,
  kind: z.enum(["player", "system"]),
  author: z.string().nullable(),
  avatar_key: z.string().nullable(),
  is_me: z.boolean(),
  body: z.string(),
  created_at: z.string(),
});
const memberSchema = z.object({
  nickname: z.string(),
  tag: z.string().nullable().default(null),
  level: num,
  avatar_key: z.string(),
  accessories: z.array(z.string()).default([]),
  is_admin: z.boolean(),
  online: z.boolean(),
});
const chatSchema = z.object({
  id: num,
  kind: z.enum(["direct", "group"]),
  name: z.string(),
  is_admin: z.boolean(),
  can_write: z.boolean(),
  unread: num,
  member_count: num,
  members: z.array(memberSchema),
  last: messageSchema.nullable(),
  last_at: z.string(),
});
const chatResult = z.object({ chat: chatSchema });

export const FRIEND_CHAT_RPC_SCHEMAS = {
  get_chats: z.object({ chats: z.array(chatSchema), unread: num }),
  get_chat: z.object({ chat: chatSchema, messages: z.array(messageSchema), has_more: z.boolean() }),
  mark_chat_read: z.object({ unread: num }),
  open_direct_chat: chatResult,
  create_group_chat: chatResult,
  post_chat_message: z.object({ message: messageSchema }),
  add_group_member: chatResult,
  remove_group_member: chatResult,
  leave_group: z.object({ chat_id: num, left: z.boolean() }),
  rename_group: chatResult,
} as const;

const S = FRIEND_CHAT_RPC_SCHEMAS;

const toMessage = (m: z.infer<typeof messageSchema>): FriendChatMessage => ({
  id: m.id,
  kind: m.kind,
  author: m.author,
  avatarKey: m.avatar_key,
  isMe: m.is_me,
  body: m.body,
  createdAt: m.created_at,
});

const toChat = (c: z.infer<typeof chatSchema>): FriendChatSummary => ({
  id: c.id,
  kind: c.kind,
  name: c.name,
  isAdmin: c.is_admin,
  canWrite: c.can_write,
  unread: c.unread,
  memberCount: c.member_count,
  members: c.members.map((m) => ({
    nickname: m.nickname,
    tag: m.tag,
    level: m.level,
    avatarKey: m.avatar_key,
    accessories: m.accessories,
    isAdmin: m.is_admin,
    online: m.online,
  })),
  last: c.last ? toMessage(c.last) : null,
  lastAt: c.last_at,
});

export const liveFriendChatEngine: Pick<
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
> = {
  async friendChats() {
    const r = await rpc("get_chats", {}, S.get_chats);
    return { chats: r.chats.map(toChat), unread: r.unread };
  },
  async friendChat(chatId, beforeId) {
    const r = await rpc("get_chat", { p_chat_id: chatId, p_before_id: beforeId ?? null }, S.get_chat);
    return { chat: toChat(r.chat), messages: r.messages.map(toMessage), hasMore: r.has_more };
  },
  async markFriendChatRead(chatId) {
    return (await rpc("mark_chat_read", { p_chat_id: chatId }, S.mark_chat_read)).unread;
  },
  async openDirectChat(requestId, nickname) {
    return toChat(
      (await rpc("open_direct_chat", { p_request_id: requestId, p_nickname: nickname }, S.open_direct_chat)).chat,
    );
  },
  async createGroupChat(requestId, name, nicknames) {
    const r = await rpc(
      "create_group_chat",
      { p_request_id: requestId, p_name: name, p_nicknames: nicknames },
      S.create_group_chat,
    );
    return toChat(r.chat);
  },
  async postFriendChatMessage(requestId, chatId, body) {
    const r = await rpc(
      "post_chat_message",
      { p_request_id: requestId, p_chat_id: chatId, p_body: body },
      S.post_chat_message,
    );
    return toMessage(r.message);
  },
  async addGroupMember(requestId, chatId, nickname) {
    const r = await rpc(
      "add_group_member",
      { p_request_id: requestId, p_chat_id: chatId, p_nickname: nickname },
      S.add_group_member,
    );
    return toChat(r.chat);
  },
  async removeGroupMember(requestId, chatId, nickname) {
    const r = await rpc(
      "remove_group_member",
      { p_request_id: requestId, p_chat_id: chatId, p_nickname: nickname },
      S.remove_group_member,
    );
    return toChat(r.chat);
  },
  async leaveGroup(requestId, chatId) {
    await rpc("leave_group", { p_request_id: requestId, p_chat_id: chatId }, S.leave_group);
  },
  async renameGroup(requestId, chatId, name) {
    const r = await rpc("rename_group", { p_request_id: requestId, p_chat_id: chatId, p_name: name }, S.rename_group);
    return toChat(r.chat);
  },
};
