import type { FriendChatMessage, FriendChatSummary, FriendEntry } from "@/features/game/types";

/*
 * Pure helpers of the chats with friends (ADR-164), tested in chat-helpers.test.ts.
 */

/** Adds an emoji at the end unless the text would get longer than allowed (never cuts an emoji in half). */
export function appendEmoji(text: string, emoji: string, max: number): string {
  const next = text + emoji;
  return next.length > max ? text : next;
}

/** Older pages and the newest page together: every message once, oldest first. */
export function mergeMessages(...pages: readonly (readonly FriendChatMessage[])[]): FriendChatMessage[] {
  const byId = new Map<number, FriendChatMessage>();
  for (const page of pages) for (const m of page) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export type ChatDay = "today" | "yesterday" | "older";

/** Whether a time lies today, yesterday or before (local calendar days). */
export function chatDay(iso: string, now: Date): ChatDay {
  const at = new Date(iso);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  return diff <= 0 ? "today" : diff === 1 ? "yesterday" : "older";
}

/** Who the preview line of a chat names in front of the text: "me", a nickname (groups) or nobody. */
export function previewAuthor(chat: Pick<FriendChatSummary, "kind" | "last">): "me" | string | null {
  const last = chat.last;
  if (!last || last.kind === "system") return null;
  if (last.isMe) return "me";
  return chat.kind === "group" ? last.author : null;
}

/** Unread lines of all chats, for the badges. */
export function totalUnread(chats: readonly Pick<FriendChatSummary, "unread">[] | undefined): number {
  return (chats ?? []).reduce((sum, c) => sum + Math.max(0, c.unread), 0);
}

/** Friends that are not in the group yet, online ones first, then by name. */
export function addableFriends(
  friends: readonly FriendEntry[],
  members: readonly { nickname: string }[],
): FriendEntry[] {
  const taken = new Set(members.map((m) => m.nickname.toLowerCase()));
  return friends
    .filter((f) => !taken.has(f.nickname.toLowerCase()))
    .sort(
      (a, b) => Number(b.online ?? false) - Number(a.online ?? false) || a.nickname.localeCompare(b.nickname, "de"),
    );
}

/** Whether the group can be created: a tidy name of the right length and enough, but not too many members. */
export function groupDraftValid(
  name: string,
  picked: number,
  rules: { groupNameMinLength: number; groupNameMaxLength: number; groupMinMembers: number; groupMaxMembers: number },
): boolean {
  const tidy = name.trim().replace(/\s+/g, " ");
  const members = picked + 1;
  return (
    tidy.length >= rules.groupNameMinLength &&
    tidy.length <= rules.groupNameMaxLength &&
    picked > 0 &&
    members >= rules.groupMinMembers &&
    members <= rules.groupMaxMembers
  );
}
