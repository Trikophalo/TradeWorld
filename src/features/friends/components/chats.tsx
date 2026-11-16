"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SPEECH } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { PlayerFigure } from "@/components/ui/player-figure";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { FriendChatMessage, FriendChatSummary, FriendEntry } from "@/features/game/types";
import { useDisclosed } from "@/features/progression/components/reveal";
import { SOCIAL_KEYS } from "@/features/social/hooks";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { useMountTime } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { openChatChannel } from "../chat-channel";
import { addableFriends, appendEmoji, chatDay, groupDraftValid, mergeMessages, previewAuthor } from "../chat-helpers";
import {
  chatHref,
  FRIEND_CHATS_KEY,
  friendChatKey,
  useFriendChat,
  useFriendChats,
  useOpenDirectChat,
  useSetUnreadChats,
} from "../chat-hooks";
import { useFriends } from "../hooks";

/*
 * Chats with friends (ADR-164): the list of conversations, one conversation, a new group and the group settings.
 * Phone first: the list or the open conversation; from lg both side by side.
 */
const cfg = BALANCE.social.chat;
const clock = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const shortDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });

function useTimeLabel() {
  const t = useTranslations("friendChat");
  const now = useMountTime();
  return (iso: string, withClock = false) => {
    const at = new Date(iso);
    const day = now === null ? "today" : chatDay(iso, new Date(now));
    if (day === "today") return clock.format(at);
    const date = day === "yesterday" ? t("yesterday") : shortDate.format(at);
    return withClock ? `${date} ${clock.format(at)}` : date;
  };
}

/** The "Chats" tab of the friends page: list, conversation, new group. */
export function ChatsView() {
  const params = useSearchParams();
  const router = useRouter();
  const raw = Number(params.get("chat"));
  const chatId = Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  const back = () => router.replace("/friends?tab=chats", { scroll: false });

  return (
    <div
      className="grid gap-5 *:min-w-0 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-6"
      data-testid="friend-chats"
    >
      <div className={cn("space-y-5", chatId !== null && "hidden lg:block")}>
        <ChatList activeId={chatId} />
        <StartChat />
      </div>
      <div className={cn(chatId === null && "hidden lg:block")}>
        {chatId !== null ? <ChatConversation key={chatId} chatId={chatId} onBack={back} /> : <PickHint />}
      </div>
    </div>
  );
}

function PickHint() {
  const t = useTranslations("friendChat");
  return (
    <Card padding="lg" className="grid h-[min(72dvh,600px)] place-items-center">
      <EmptyState art={<PixelIcon {...SPEECH} scale={4} />} title={t("pick")} description={t("pickText")} />
    </Card>
  );
}

/** Portrait of a chat: the friend, or two members of a group on top of each other. */
function ChatPortrait({ chat }: { chat: FriendChatSummary }) {
  if (chat.kind === "direct") {
    const friend = chat.members[0];
    return (
      <span className="relative shrink-0">
        <Avatar avatarKey={friend?.avatarKey} size="sm" />
        {friend?.online && (
          <span
            className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-gain ring-2 ring-surface-1"
            aria-hidden
          />
        )}
      </span>
    );
  }
  const [a, b] = chat.members;
  return (
    <span className="relative size-12 shrink-0" aria-hidden>
      <Avatar avatarKey={a?.avatarKey} size="xs" className="absolute top-0 left-0" />
      <Avatar
        avatarKey={b?.avatarKey ?? a?.avatarKey}
        size="xs"
        className="absolute right-0 bottom-0 ring-2 ring-surface-1"
      />
    </span>
  );
}

function ChatList({ activeId }: { activeId: number | null }) {
  const t = useTranslations("friendChat");
  const chats = useFriendChats();
  const time = useTimeLabel();
  const [creating, setCreating] = useState(false);

  return (
    <Card padding="none" className="overflow-hidden" data-testid="chat-list">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <p className="label-pixel text-fg-2">{t("listTitle")}</p>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)} data-testid="chat-new-group">
          + {t("newGroup")}
        </Button>
      </div>
      {!chats.data ? (
        <div className="space-y-2 px-4 pb-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      ) : chats.data.chats.length === 0 ? (
        <EmptyState
          className="py-6"
          art={<PixelIcon {...SPEECH} scale={4} />}
          title={t("emptyTitle")}
          description={t("emptyText")}
        />
      ) : (
        <ul className="max-h-[min(60dvh,520px)] overflow-y-auto overscroll-contain border-t border-line-1">
          {chats.data.chats.map((chat) => {
            const who = previewAuthor(chat);
            const last = chat.last;
            return (
              <li key={chat.id} className="border-b border-line-1 last:border-b-0">
                <Link
                  href={chatHref(chat.id)}
                  scroll={false}
                  aria-current={chat.id === activeId ? "true" : undefined}
                  className={cn(
                    "flex min-w-0 items-center gap-3 px-4 py-3 focus-ring transition-colors duration-fast hover:bg-surface-2 active:bg-surface-3",
                    chat.id === activeId && "bg-accent-soft hover:bg-accent-soft",
                  )}
                  data-testid="chat-row"
                  data-kind={chat.kind}
                  data-name={chat.name}
                >
                  <ChatPortrait chat={chat} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-fg-1",
                          chat.unread > 0 ? "font-semibold" : "font-medium",
                        )}
                      >
                        {chat.name}
                      </span>
                      <span className="shrink-0 nums text-2xs text-fg-3">{time(chat.lastAt)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className={cn("min-w-0 flex-1 truncate text-xs", chat.unread > 0 ? "text-fg-1" : "text-fg-3")}
                      >
                        {last ? (
                          <>
                            {who === "me" ? t("youPrefix") : who ? `${who}: ` : ""}
                            {last.body}
                          </>
                        ) : chat.kind === "group" ? (
                          t("members", { count: chat.memberCount })
                        ) : (
                          t("noLines")
                        )}
                      </span>
                      {chat.unread > 0 && (
                        <span
                          className="grid h-5 min-w-5 shrink-0 place-items-center rounded-pill bg-accent px-1.5 nums text-2xs font-semibold text-on-accent"
                          aria-label={t("unread", { count: chat.unread })}
                          data-testid="chat-unread"
                        >
                          {chat.unread > 99 ? "99+" : chat.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <NewGroupSheet open={creating} onOpenChange={setCreating} />
    </Card>
  );
}

/** Friends to write to: one tap opens the direct chat. */
function StartChat() {
  const t = useTranslations("friendChat");
  const friends = useFriends();
  if (!friends.data) return <Skeleton className="h-28 w-full rounded-lg" />;
  const list = addableFriends(friends.data.friends, []);
  return (
    <Card padding="lg" className="space-y-3" data-testid="chat-start">
      <p className="label-pixel text-fg-2">{t("startTitle")}</p>
      {list.length === 0 ? (
        <p className="text-sm text-pretty text-fg-3">{t("noFriendsText")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {list.map((f) => (
            <li key={f.nickname}>
              <StartChip friend={f} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StartChip({ friend }: { friend: FriendEntry }) {
  const t = useTranslations("friendChat");
  const { open, state } = useOpenDirectChat(friend.nickname);
  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={state !== "idle"}
      aria-label={t("messageLabel", { name: friend.nickname })}
      className="flex max-w-44 items-center gap-2 rounded-pill border border-line-2 bg-surface-2 py-1 pr-3 pl-1 text-sm text-fg-1 focus-ring transition duration-fast ease-standard hover:bg-surface-3 active:scale-95 disabled:opacity-60"
      data-testid="chat-start-friend"
      data-nickname={friend.nickname}
    >
      <span className="relative">
        <Avatar avatarKey={friend.avatarKey} size="xs" />
        {friend.online && (
          <span
            className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-gain ring-2 ring-surface-2"
            aria-hidden
          />
        )}
      </span>
      <span className={cn("truncate", state === "loading" && "animate-pulse")}>{friend.nickname}</span>
    </button>
  );
}

/** One conversation: header, lines (own ones on the right), emojis and input. Escape and the button go back. */
export function ChatConversation({ chatId, onBack }: { chatId: number; onBack: () => void }) {
  const t = useTranslations("friendChat");
  const errorText = useGameErrorText();
  const client = useQueryClient();
  const setUnread = useSetUnreadChats();
  const thread = useFriendChat(chatId);
  const time = useTimeLabel();
  const [older, setOlder] = useState<FriendChatMessage[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  const [managing, setManaging] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const channel = useRef<ReturnType<typeof openChatChannel>>(null);

  const messages = mergeMessages(older, thread.data?.messages ?? []);
  const newest = messages[messages.length - 1]?.id ?? 0;
  const hasMore = olderMore ?? thread.data?.hasMore ?? false;
  const chat = thread.data?.chat;

  // Keep the newest line in view.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [newest]);

  // Read what arrived while the conversation is open.
  useEffect(() => {
    if (!newest) return;
    let gone = false;
    void engine
      .markFriendChatRead(chatId)
      .then((unread) => {
        if (gone) return;
        setUnread(chatId, unread);
        void client.invalidateQueries({ queryKey: SOCIAL_KEYS.notifications });
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per new line
  }, [chatId, newest]);

  // Live: another member's client says "new line" (Realtime broadcast); polling stays the fallback.
  useEffect(() => {
    channel.current = openChatChannel(chatId, () => void thread.refetch());
    return () => {
      channel.current?.close();
      channel.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one channel per chat
  }, [chatId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  if (thread.isPending) return <Skeleton className="h-[min(72dvh,600px)] w-full rounded-lg" />;
  if (!chat) {
    return (
      <Card padding="lg">
        <EmptyState
          art={<PixelIcon {...SPEECH} scale={4} />}
          title={t("title")}
          description={errorText(thread.error)}
          action={
            <Button variant="secondary" onClick={onBack}>
              {t("back")}
            </Button>
          }
        />
      </Card>
    );
  }

  const loadOlder = async () => {
    const first = messages[0];
    if (!first) return;
    setLoadingOlder(true);
    const box = list.current;
    const before = box?.scrollHeight ?? 0;
    try {
      const page = await engine.friendChat(chatId, first.id);
      setOlder((o) => mergeMessages(page.messages, o));
      setOlderMore(page.hasMore);
      requestAnimationFrame(() => {
        if (box) box.scrollTop = box.scrollHeight - before;
      });
    } catch (error) {
      toast.error(t("title"), errorText(error));
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || state !== "idle") return;
    setState("loading");
    try {
      await engine.postFriendChatMessage(crypto.randomUUID(), chatId, body);
      setText("");
      void playSound("tap");
      haptic("tap");
      channel.current?.ping();
      await thread.refetch();
      void client.invalidateQueries({ queryKey: FRIEND_CHATS_KEY });
    } catch (error) {
      toast.error(t("title"), errorText(error));
    } finally {
      setState("idle");
      input.current?.focus();
    }
  };

  const friend = chat.kind === "direct" ? chat.members[0] : undefined;
  const online = chat.members.filter((m) => m.online).length;

  return (
    <Card
      padding="none"
      className="flex h-[min(72dvh,600px)] flex-col overflow-hidden"
      data-testid="chat-conversation"
      data-kind={chat.kind}
    >
      <header className="flex items-center gap-2 border-b border-line-1 px-2 py-2 sm:gap-3 sm:px-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={onBack}
          aria-keyshortcuts="Escape"
          aria-label={t("backLabel")}
          className="px-2 sm:px-3"
          data-testid="chat-back"
        >
          <span aria-hidden>←</span>
          <span className="hidden sm:inline">{t("backLabel")}</span>
        </Button>
        {friend ? (
          <Link
            href={`/players/${encodeURIComponent(friend.nickname)}`}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-sm focus-ring"
            aria-label={t("openProfile", { name: friend.nickname })}
          >
            <span
              className="relative h-12 w-12 shrink-0 overflow-hidden rounded-sm bg-surface-2 ring-1 ring-line-2"
              aria-hidden
            >
              <PlayerFigure
                avatarKey={friend.avatarKey}
                accessories={friend.accessories}
                scale={2}
                className="absolute -top-1 left-0"
              />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-fg-1" data-testid="chat-title">
                {chat.name}
              </span>
              <span className={cn("block text-xs", friend.online ? "text-gain" : "text-fg-3")}>
                {friend.online ? t("online") : t("offline")}
              </span>
            </span>
          </Link>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ChatPortrait chat={chat} />
            <span className="min-w-0">
              <span className="block truncate font-semibold text-fg-1" data-testid="chat-title">
                {chat.name}
              </span>
              <span className="block truncate text-xs text-fg-3">
                {t("members", { count: chat.memberCount })}
                {online > 0 && <span className="text-gain"> · {t("onlineCount", { count: online })}</span>}
              </span>
            </span>
          </div>
        )}
        {chat.kind === "group" && (
          <Button size="sm" variant="secondary" onClick={() => setManaging(true)} data-testid="chat-manage">
            {t("manage")}
          </Button>
        )}
      </header>
      <ol
        ref={list}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4"
        aria-live="polite"
        data-testid="chat-messages"
      >
        {hasMore && (
          <li className="flex justify-center">
            <Button
              size="sm"
              variant="ghost"
              state={loadingOlder ? "loading" : "idle"}
              onClick={() => void loadOlder()}
            >
              {t("older")}
            </Button>
          </li>
        )}
        {messages.length === 0 && <li className="py-8 text-center text-sm text-pretty text-fg-3">{t("empty")}</li>}
        {messages.map((m) => (
          <Line key={m.id} message={m} group={chat.kind === "group"} time={time(m.createdAt, true)} />
        ))}
      </ol>
      {chat.canWrite ? (
        <form onSubmit={(event) => void send(event)} className="space-y-2 border-t border-line-1 p-3">
          <div className="no-scrollbar flex gap-1 overflow-x-auto" role="group" aria-label={t("emojis")}>
            {cfg.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setText((v) => appendEmoji(v, emoji, cfg.maxMessageLength))}
                className="grid size-8 shrink-0 place-items-center rounded-md text-lg focus-ring transition duration-fast ease-standard hover:bg-surface-2 active:scale-90"
                aria-label={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t("placeholder")}</span>
              <input
                ref={input}
                value={text}
                maxLength={cfg.maxMessageLength}
                onChange={(event) => setText(event.target.value)}
                placeholder={t("placeholder")}
                enterKeyHint="send"
                className="h-11 w-full rounded-md border border-line-2 bg-surface-2 px-3 text-fg-1 focus-ring placeholder:text-fg-3"
                data-testid="chat-input"
              />
            </label>
            <Button type="submit" state={state} disabled={!text.trim()} data-testid="chat-send">
              {t("send")}
            </Button>
          </div>
        </form>
      ) : (
        <p
          className="border-t border-line-1 bg-surface-2 px-4 py-3 text-sm text-pretty text-fg-2"
          data-testid="chat-read-only"
        >
          {t("readOnly")}
        </p>
      )}
      {chat.kind === "group" && (
        <ManageGroupSheet chat={chat} open={managing} onOpenChange={setManaging} onLeft={onBack} />
      )}
    </Card>
  );
}

function Line({ message, group, time }: { message: FriendChatMessage; group: boolean; time: string }) {
  const reduced = useReducedMotionConfig();
  if (message.kind === "system") {
    return (
      <li className="flex justify-center" data-testid="chat-line" data-kind="system">
        <span className="max-w-[90%] rounded-pill bg-surface-2 px-3 py-1 text-center text-xs text-pretty text-fg-2">
          {message.body}
        </span>
      </li>
    );
  }
  return (
    <motion.li
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.base, ease: EASE.out }}
      className={cn("flex items-end gap-2", message.isMe && "flex-row-reverse")}
      data-testid="chat-line"
      data-kind="player"
      data-me={message.isMe ? "true" : "false"}
    >
      {!message.isMe && <Avatar avatarKey={message.avatarKey} size="xs" />}
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2",
          message.isMe ? "rounded-br-xs bg-accent-soft" : "rounded-bl-xs bg-surface-2",
        )}
      >
        {group && !message.isMe && <p className="truncate text-xs font-medium text-fg-2">{message.author}</p>}
        <p className="text-sm text-pretty break-words whitespace-pre-wrap text-fg-1">{message.body}</p>
        <p className={cn("mt-0.5 nums text-2xs text-fg-3", message.isMe && "text-right")}>{time}</p>
      </div>
    </motion.li>
  );
}

/** Picks friends and a name for a new group. */
function NewGroupSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("friendChat");
  const errorText = useGameErrorText();
  const router = useRouter();
  const client = useQueryClient();
  const friends = useFriends();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [state, setState] = useState<ButtonState>("idle");
  const list = addableFriends(friends.data?.friends ?? [], []);
  const valid = groupDraftValid(name, picked.length, cfg);
  const full = picked.length + 1 >= cfg.groupMaxMembers;

  const toggle = (nickname: string) =>
    setPicked((p) => (p.includes(nickname) ? p.filter((n) => n !== nickname) : full ? p : [...p, nickname]));

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setState("loading");
    try {
      const chat = await engine.createGroupChat(crypto.randomUUID(), name, picked);
      haptic("success");
      void playSound("success");
      toast.success(t("created"), chat.name, { silent: true });
      setName("");
      setPicked([]);
      onOpenChange(false);
      void client.invalidateQueries({ queryKey: FRIEND_CHATS_KEY });
      router.push(chatHref(chat.id), { scroll: false });
    } catch (error) {
      toast.error(t("newGroupTitle"), errorText(error));
    } finally {
      setState("idle");
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("newGroupTitle")}
      description={t("newGroupText", { max: cfg.groupMaxMembers })}
    >
      <form onSubmit={(e) => void create(e)} className="space-y-4" data-testid="chat-group-form">
        <Field
          label={t("groupName")}
          hint={t("groupNameHint", { min: cfg.groupNameMinLength, max: cfg.groupNameMaxLength })}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={cfg.groupNameMaxLength}
          autoComplete="off"
          data-testid="chat-group-name"
        />
        <div className="space-y-2">
          <p className="flex items-baseline justify-between gap-2 label-pixel text-fg-2">
            {t("pickFriends")}
            <span className="nums text-fg-3">{t("count", { count: picked.length + 1, max: cfg.groupMaxMembers })}</span>
          </p>
          {list.length === 0 ? (
            <p className="text-sm text-pretty text-fg-3">{t("noFriendsText")}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {list.map((f) => {
                const on = picked.includes(f.nickname);
                return (
                  <li key={f.nickname}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(f.nickname)}
                      disabled={!on && full}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm focus-ring transition duration-fast ease-standard active:scale-[0.98] disabled:opacity-50",
                        on
                          ? "border-accent bg-accent-soft text-fg-1"
                          : "border-line-2 bg-surface-2 text-fg-2 hover:bg-surface-3",
                      )}
                      data-testid="chat-group-pick"
                      data-nickname={f.nickname}
                    >
                      <Avatar avatarKey={f.avatarKey} size="xs" />
                      <span className="min-w-0 flex-1 truncate">{f.nickname}</span>
                      <span aria-hidden className={cn("text-accent", !on && "invisible")}>
                        ✓
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <Button type="submit" block state={state} disabled={!valid} data-testid="chat-group-create">
          {t("create")}
        </Button>
      </form>
    </Sheet>
  );
}

/** Group settings: rename and remove (admin), add own friends, leave. */
function ManageGroupSheet({
  chat,
  open,
  onOpenChange,
  onLeft,
}: {
  chat: FriendChatSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLeft: () => void;
}) {
  const t = useTranslations("friendChat");
  const errorText = useGameErrorText();
  const client = useQueryClient();
  const friends = useFriends();
  const [name, setName] = useState(chat.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const addable = addableFriends(friends.data?.friends ?? [], chat.members);
  const full = chat.memberCount >= cfg.groupMaxMembers;

  const run = async (key: string, call: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await call();
      haptic("success");
      toast.success(done, undefined, { silent: true });
      await Promise.all([
        client.invalidateQueries({ queryKey: friendChatKey(chat.id) }),
        client.invalidateQueries({ queryKey: FRIEND_CHATS_KEY }),
      ]);
      return true;
    } catch (error) {
      toast.error(t("manageTitle"), errorText(error));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const id = () => crypto.randomUUID();

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("manageTitle")} description={chat.name}>
      <div className="space-y-6" data-testid="chat-manage-sheet">
        {chat.isAdmin ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run("rename", () => engine.renameGroup(id(), chat.id, name), t("renamed"));
            }}
          >
            <div className="min-w-0 flex-1">
              <Field
                label={t("groupName")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={cfg.groupNameMaxLength}
                autoComplete="off"
                data-testid="chat-rename-input"
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              state={busy === "rename" ? "loading" : "idle"}
              disabled={name.trim().length < cfg.groupNameMinLength || name.trim() === chat.name}
            >
              {t("rename")}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-pretty text-fg-3">{t("adminOnly")}</p>
        )}

        <section className="space-y-2">
          <p className="label-pixel text-fg-2">{t("members", { count: chat.memberCount })}</p>
          <ul className="space-y-1.5">
            {chat.members.map((m) => (
              <li key={m.nickname} className="flex min-w-0 items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5">
                <Avatar avatarKey={m.avatarKey} size="xs" />
                <span className="min-w-0 flex-1 truncate text-sm text-fg-1">{m.nickname}</span>
                {m.online && <span className="size-2 rounded-full bg-gain" aria-label={t("online")} />}
                {m.isAdmin && <Badge tone="accent">{t("admin")}</Badge>}
                {chat.isAdmin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    state={busy === `rm:${m.nickname}` ? "loading" : "idle"}
                    aria-label={t("removeLabel", { name: m.nickname })}
                    onClick={() =>
                      void run(
                        `rm:${m.nickname}`,
                        () => engine.removeGroupMember(id(), chat.id, m.nickname),
                        t("removed", { name: m.nickname }),
                      )
                    }
                  >
                    {t("remove")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <p className="label-pixel text-fg-2">{t("addMember")}</p>
          {full ? (
            <p className="text-sm text-fg-3">{t("full")}</p>
          ) : addable.length === 0 ? (
            <p className="text-sm text-fg-3">{t("noMoreFriends")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {addable.map((f) => (
                <li key={f.nickname}>
                  <Button
                    size="sm"
                    variant="secondary"
                    state={busy === `add:${f.nickname}` ? "loading" : "idle"}
                    onClick={() =>
                      void run(
                        `add:${f.nickname}`,
                        () => engine.addGroupMember(id(), chat.id, f.nickname),
                        t("added", { name: f.nickname }),
                      )
                    }
                    data-testid="chat-add-member"
                  >
                    + {f.nickname}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <AnimatePresence mode="wait" initial={false}>
          {sure ? (
            <motion.div
              key="sure"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION.fast, ease: EASE.out }}
              className="flex gap-2"
            >
              <Button
                variant="loss"
                block
                state={busy === "leave" ? "loading" : "idle"}
                onClick={() =>
                  void run("leave", () => engine.leaveGroup(id(), chat.id), t("left")).then((ok) => {
                    if (!ok) return;
                    onOpenChange(false);
                    onLeft();
                  })
                }
                data-testid="chat-leave-confirm"
              >
                {t("leaveSure")}
              </Button>
              <Button variant="ghost" onClick={() => setSure(false)}>
                {t("cancel")}
              </Button>
            </motion.div>
          ) : (
            <motion.div key="ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Button variant="danger" block onClick={() => setSure(true)} data-testid="chat-leave">
                {t("leave")}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Sheet>
  );
}

/** Unread chat lines, for the Freunde nav item and the chats tab; nothing when all is read. */
export function ChatUnreadBadge({ className, dotOnly }: { className?: string; dotOnly?: boolean }) {
  const t = useTranslations("friendChat");
  const count = useFriendChats().data?.unread ?? 0;
  const mounted = useMountTime() !== null;
  if (!mounted || count === 0) return null;
  if (dotOnly) {
    return (
      <span
        className={cn("size-2 rounded-pill bg-accent", className)}
        aria-label={t("unread", { count })}
        data-testid="chat-unread-dot"
      />
    );
  }
  return (
    <span
      className={cn(
        "grid h-4 min-w-4 place-items-center rounded-pill bg-accent px-1 nums text-2xs leading-none font-semibold text-on-accent",
        className,
      )}
      aria-label={t("unread", { count })}
      data-testid="chat-unread-badge"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** "Nachricht" for a friend: opens the direct chat (profile, friends list). */
export function MessageFriendButton({ nickname, size = "md" }: { nickname: string; size?: "sm" | "md" }) {
  const t = useTranslations("friendChat");
  const { open, state } = useOpenDirectChat(nickname);
  return (
    <Button
      size={size}
      variant="secondary"
      state={state}
      onClick={() => void open()}
      aria-label={t("messageLabel", { name: nickname })}
      data-testid="chat-message-friend"
    >
      💬 {t("message")}
    </Button>
  );
}

/** 💬 as a small icon button (plaza figure, friends list): opens the direct chat. Hidden before the disclosure. */
export function ChatIconButton({ nickname, compact }: { nickname: string; compact?: boolean }) {
  const t = useTranslations("friendChat");
  const visible = useDisclosed("friendChats");
  const { open, state } = useOpenDirectChat(nickname);
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={state !== "idle"}
      aria-label={t("messageLabel", { name: nickname })}
      title={t("message")}
      className={cn(
        "grid shrink-0 place-items-center rounded-xs focus-ring transition duration-fast ease-standard hover:bg-surface-3 active:scale-90 disabled:opacity-50",
        compact ? "size-7 text-sm" : "size-9 text-base",
      )}
      data-testid="chat-icon"
      data-friend={nickname}
    >
      <span aria-hidden className={cn(state === "loading" && "animate-pulse")}>
        💬
      </span>
    </button>
  );
}
