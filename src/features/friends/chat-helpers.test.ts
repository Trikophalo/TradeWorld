import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import type { FriendChatMessage, FriendEntry } from "@/features/game/types";
import {
  addableFriends,
  appendEmoji,
  chatDay,
  groupDraftValid,
  mergeMessages,
  previewAuthor,
  totalUnread,
} from "./chat-helpers";

const line = (id: number, over: Partial<FriendChatMessage> = {}): FriendChatMessage => ({
  id,
  kind: "player",
  author: "Anna",
  avatarKey: "seller",
  isMe: false,
  body: `Zeile ${id}`,
  createdAt: "2026-11-16T10:00:00Z",
  ...over,
});
const friend = (nickname: string, online = false): FriendEntry => ({
  nickname,
  tag: null,
  level: 3,
  at: "2026-11-01T00:00:00Z",
  online,
});

describe("chat helpers (ADR-164)", () => {
  it("appendEmoji adds at the end but never beyond the limit", () => {
    expect(appendEmoji("Hallo", "🚀", 10)).toBe("Hallo🚀");
    // an emoji is two UTF-16 units: it does not fit into one free place
    expect(appendEmoji("123456789", "🚀", 10)).toBe("123456789");
    expect(appendEmoji("", "👍", BALANCE.social.chat.maxMessageLength)).toBe("👍");
  });

  it("mergeMessages keeps every message once, oldest first", () => {
    const merged = mergeMessages([line(3), line(1)], [line(2), line(3, { body: "neu" })]);
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(merged[2]!.body).toBe("neu");
    expect(mergeMessages()).toEqual([]);
  });

  it("chatDay tells today, yesterday and older apart by calendar day", () => {
    const now = new Date(2026, 10, 16, 0, 30);
    expect(chatDay(new Date(2026, 10, 16, 0, 5).toISOString(), now)).toBe("today");
    expect(chatDay(new Date(2026, 10, 15, 23, 50).toISOString(), now)).toBe("yesterday");
    expect(chatDay(new Date(2026, 10, 13, 12, 0).toISOString(), now)).toBe("older");
    // a clock slightly ahead is still today
    expect(chatDay(new Date(2026, 10, 16, 0, 31).toISOString(), now)).toBe("today");
  });

  it("previewAuthor names me, the author in groups, nobody in direct chats and system lines", () => {
    expect(previewAuthor({ kind: "direct", last: line(1, { isMe: true }) })).toBe("me");
    expect(previewAuthor({ kind: "direct", last: line(1) })).toBeNull();
    expect(previewAuthor({ kind: "group", last: line(1) })).toBe("Anna");
    expect(previewAuthor({ kind: "group", last: line(1, { kind: "system", author: null }) })).toBeNull();
    expect(previewAuthor({ kind: "group", last: null })).toBeNull();
  });

  it("totalUnread sums the chats and ignores nonsense", () => {
    expect(totalUnread([{ unread: 2 }, { unread: 0 }, { unread: 5 }])).toBe(7);
    expect(totalUnread([{ unread: -1 }])).toBe(0);
    expect(totalUnread(undefined)).toBe(0);
  });

  it("addableFriends leaves out members (any case), online ones first", () => {
    const list = addableFriends(
      [friend("Zora"), friend("bruno", true), friend("Anna"), friend("Carl", true)],
      [{ nickname: "ANNA" }],
    );
    expect(list.map((f) => f.nickname)).toEqual(["bruno", "Carl", "Zora"]);
  });

  it("groupDraftValid follows the name and size rules from the config", () => {
    const rules = BALANCE.social.chat;
    expect(groupDraftValid("Börsenclub", 2, rules)).toBe(true);
    expect(groupDraftValid("  Bö  ", 1, rules)).toBe(false);
    expect(groupDraftValid("Börsenclub", 0, rules)).toBe(false);
    expect(groupDraftValid("x".repeat(rules.groupNameMaxLength + 1), 2, rules)).toBe(false);
    expect(groupDraftValid("Börsenclub", rules.groupMaxMembers, rules)).toBe(false);
    expect(groupDraftValid("Börsenclub", rules.groupMaxMembers - 1, rules)).toBe(true);
  });
});
