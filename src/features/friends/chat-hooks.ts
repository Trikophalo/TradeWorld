"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ButtonState } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { FriendChats } from "@/features/game/types";

/** Chats with friends (ADR-164). */
export const FRIEND_CHATS_KEY = ["friend-chats"] as const;
export const friendChatKey = (chatId: number) => ["friend-chats", "chat", chatId] as const;

const { pollIdleSeconds, pollOpenSeconds } = BALANCE.social.chat;

/** The list of chats with last lines and unread counts; also feeds the badges. */
export function useFriendChats() {
  return useQuery({
    queryKey: FRIEND_CHATS_KEY,
    queryFn: () => engine.friendChats(),
    refetchInterval: pollIdleSeconds * 1000,
    staleTime: 2_000,
  });
}

/** One open conversation: polled fast while it is on screen. */
export function useFriendChat(chatId: number) {
  return useQuery({
    queryKey: friendChatKey(chatId),
    queryFn: () => engine.friendChat(chatId),
    refetchInterval: pollOpenSeconds * 1000,
    staleTime: 1_000,
  });
}

export function useUnreadChats(): number {
  return useFriendChats().data?.unread ?? 0;
}

/** Sets the unread total right away after reading a chat, so the badges do not wait for the next poll. */
export function useSetUnreadChats() {
  const client = useQueryClient();
  return (chatId: number, unread: number) =>
    client.setQueryData<FriendChats>(FRIEND_CHATS_KEY, (data) =>
      data ? { unread, chats: data.chats.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)) } : data,
    );
}

/** The link to a conversation (also used by the notification). */
export const chatHref = (chatId: number) => `/friends?tab=chats&chat=${chatId}`;

/** Opens the direct chat with a friend (created on first use) and goes there. */
export function useOpenDirectChat(nickname: string) {
  const t = useTranslations("friendChat");
  const errorText = useGameErrorText();
  const router = useRouter();
  const client = useQueryClient();
  const [state, setState] = useState<ButtonState>("idle");
  const open = async () => {
    setState("loading");
    try {
      const chat = await engine.openDirectChat(crypto.randomUUID(), nickname);
      void client.invalidateQueries({ queryKey: FRIEND_CHATS_KEY });
      router.push(chatHref(chat.id), { scroll: false });
    } catch (error) {
      toast.error(t("title"), errorText(error));
    } finally {
      setState("idle");
    }
  };
  return { open, state };
}
