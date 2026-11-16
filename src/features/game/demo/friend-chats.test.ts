import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { GameError } from "../types";
import { createFriendChatEngine, demoUnread, tidyGroupName, type DemoChat } from "./friend-chats";
import type { DemoFriend } from "./friends";

const friend = (nickname: string): DemoFriend => ({
  nickname,
  tag: nickname.slice(0, 4).toUpperCase().padEnd(4, "X"),
  level: 5,
  avatarKey: "punk",
  accessories: [],
  online: true,
  since: "2026-11-01T00:00:00Z",
});

function setup(random = 0) {
  let now = Date.UTC(2026, 10, 16, 12);
  let chats: DemoChat[] = [];
  const friends = [friend("Anna"), friend("Bruno"), friend("Clara")];
  const requests = new Map<string, unknown>();
  const engine = createFriendChatEngine({
    nickname: () => "Demo",
    avatarKey: () => "rookie",
    idempotent: <T>(id: string, run: () => T): T => {
      if (!requests.has(id)) requests.set(id, run());
      return requests.get(id) as T;
    },
    now: () => new Date(now),
    random: () => random,
    friendList: () => friends,
    chats: () => chats,
    setChats: (value) => {
      chats = value;
    },
    persist: () => undefined,
  });
  return {
    engine,
    friends,
    later: (ms: number) => {
      now += ms;
    },
  };
}

const err = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof GameError ? e.key : "other";
  }
  return "none";
};

describe("demo chats with friends (ADR-164)", () => {
  it("a direct chat per friend; a made-up friend answers a question after a moment", async () => {
    const { engine, later } = setup(0);
    const a = await engine.openDirectChat("r1", "anna");
    const again = await engine.openDirectChat("r2", "Anna");
    expect(again.id).toBe(a.id);
    expect(a.name).toBe("Anna");
    expect(await err(engine.openDirectChat("r3", "Niemand"))).toBe("not_friends");
    expect(await err(engine.openDirectChat("r4", "demo"))).toBe("invalid_argument");

    const sent = await engine.postFriendChatMessage("m1", a.id, "  Kaufst du auch?  ");
    expect(sent.body).toBe("Kaufst du auch?");
    expect(sent.isMe).toBe(true);
    expect((await engine.friendChats()).unread).toBe(0);

    later((BALANCE.social.chat.pollOpenSeconds + 10) * 1000);
    const list = await engine.friendChats();
    expect(list.unread).toBe(1);
    const thread = await engine.friendChat(a.id);
    expect(thread.messages.map((m) => m.isMe)).toEqual([true, false]);
    expect(thread.messages[1]!.author).toBe("Anna");
    expect(await engine.markFriendChatRead(a.id)).toBe(0);
  });

  it("messages: not empty, not too long", async () => {
    const { engine } = setup();
    const a = await engine.openDirectChat("r1", "Bruno");
    expect(await err(engine.postFriendChatMessage("m1", a.id, "   "))).toBe("invalid_argument");
    expect(
      await err(engine.postFriendChatMessage("m2", a.id, "x".repeat(BALANCE.social.chat.maxMessageLength + 1))),
    ).toBe("invalid_argument");
    expect(await err(engine.postFriendChatMessage("m3", 999, "Hallo"))).toBe("chat_unknown");
  });

  it("groups: friends only, size and name rules, admin rights, leave", async () => {
    const { engine, friends } = setup(0.99);
    expect(await err(engine.createGroupChat("g0", "Club", []))).toBe("chat_group_too_small");
    expect(await err(engine.createGroupChat("g1", "Club", ["Emil"]))).toBe("not_friends");
    expect(await err(engine.createGroupChat("g2", "C", ["Anna"]))).toBe("name_too_short");
    const g = await engine.createGroupChat("g3", "  Börsen   Club ", ["Anna", "bruno", "Anna"]);
    expect(g.name).toBe("Börsen Club");
    expect(g.memberCount).toBe(3);
    expect(g.isAdmin).toBe(true);
    expect((await engine.friendChat(g.id)).messages[0]!.kind).toBe("system");

    const added = await engine.addGroupMember("a1", g.id, "Clara");
    expect(added.memberCount).toBe(4);
    expect(await err(engine.addGroupMember("a2", g.id, "Clara"))).toBe("chat_already_member");
    const renamed = await engine.renameGroup("n1", g.id, "Die Bullen");
    expect(renamed.name).toBe("Die Bullen");
    const removed = await engine.removeGroupMember("x1", g.id, "Bruno");
    expect(removed.members.map((m) => m.nickname)).toEqual(["Anna", "Clara"]);

    // a friendship that ended makes a direct chat read-only
    const d = await engine.openDirectChat("d1", "Clara");
    friends.splice(2, 1);
    expect((await engine.friendChat(d.id)).chat.canWrite).toBe(false);
    expect(await err(engine.postFriendChatMessage("m9", d.id, "Hallo?"))).toBe("chat_read_only");

    await engine.leaveGroup("l1", g.id);
    expect(await err(engine.friendChat(g.id))).toBe("chat_unknown");
  });

  it("tidyGroupName and demoUnread", () => {
    expect(tidyGroupName("  a   b ")).toBe("a b");
    const chat: DemoChat = {
      id: 1,
      kind: "direct",
      name: null,
      members: ["Anna"],
      admin: null,
      lastRead: 2,
      createdAt: 0,
      pending: [],
      messages: [
        { id: 1, kind: "player", author: "Anna", body: "a", at: 0 },
        { id: 3, kind: "player", author: "Anna", body: "b", at: 0 },
        { id: 4, kind: "player", author: "@me", body: "c", at: 0 },
        { id: 5, kind: "system", author: null, body: "d", at: 0 },
      ],
    };
    expect(demoUnread(chat)).toBe(1);
  });
});
