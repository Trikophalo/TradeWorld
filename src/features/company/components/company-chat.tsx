"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Avatar } from "@/components/ui/avatar";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { ChatMessage } from "@/features/game/types";
import { DURATION, EASE } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";

const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const MAX = BALANCE.startups.chat.maxMessageLength;

export function useCompanyChat() {
  return useQuery({
    queryKey: ["company", "chat"],
    queryFn: () => engine.companyChat(),
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
}

/** Company chat for the founder and all employees of a player company (ADR-060). */
export function CompanyChat({ className }: { className?: string }) {
  const t = useTranslations("chat");
  const errorText = useGameErrorText();
  const chat = useCompanyChat();
  const [text, setText] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  const list = useRef<HTMLOListElement>(null);
  const count = chat.data?.messages.length ?? 0;

  // Keep the newest message in view.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [count]);

  if (chat.isPending) return <Skeleton className="h-96 w-full rounded-lg" />;
  if (!chat.data?.company) {
    return <EmptyState art={<PixelIcon {...UI_ICONS.card} scale={4} />} title={t("title")} description={t("none")} />;
  }

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    setState("loading");
    try {
      await engine.postCompanyMessage(crypto.randomUUID(), body);
      setText("");
      void playSound("tap");
      await chat.refetch();
    } catch (error) {
      toast.error(t("title"), errorText(error));
    } finally {
      setState("idle");
    }
  };

  return (
    <Card padding="none" className={cn("flex h-[min(70dvh,560px)] flex-col overflow-hidden", className)}>
      <header className="flex items-center gap-3 border-b border-line-1 px-4 py-3">
        <span aria-hidden style={{ backgroundColor: chat.data.company.color }} className="size-6 shrink-0" />
        <div className="min-w-0">
          <p className="truncate font-semibold text-fg-1">{chat.data.company.name}</p>
          <p className="text-xs text-fg-3">{t("members", { count: chat.data.members })}</p>
        </div>
      </header>
      <ol
        ref={list}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
        aria-live="polite"
        data-testid="chat-messages"
      >
        {chat.data.messages.length === 0 && <li className="text-center text-sm text-fg-3">{t("empty")}</li>}
        {chat.data.messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
      </ol>
      <form onSubmit={(event) => void send(event)} className="flex items-end gap-2 border-t border-line-1 p-3">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("placeholder")}</span>
          <input
            value={text}
            maxLength={MAX}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("placeholder")}
            className="h-11 w-full rounded-md border border-line-2 bg-surface-2 px-3 text-fg-1 focus-ring placeholder:text-fg-3"
          />
        </label>
        <Button type="submit" state={state} disabled={!text.trim()}>
          {t("send")}
        </Button>
      </form>
    </Card>
  );
}

function Message({ message }: { message: ChatMessage }) {
  const t = useTranslations("chat");
  if (message.kind === "system") {
    return (
      <li className="flex justify-center">
        <span className="max-w-[90%] rounded-pill bg-surface-2 px-3 py-1 text-center text-xs text-pretty text-fg-2">
          <span className="label-pixel text-accent">{t("system")}</span> {message.body}
        </span>
      </li>
    );
  }
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.base, ease: EASE.out }}
      className={cn("flex items-end gap-2", message.isMe && "flex-row-reverse")}
    >
      <Avatar avatarKey={message.avatarKey} size="xs" />
      <div className={cn("max-w-[75%] rounded-lg px-3 py-2", message.isMe ? "bg-accent-soft" : "bg-surface-2")}>
        <p className="flex items-baseline gap-2 text-xs text-fg-3">
          <span className="font-medium text-fg-2">{message.author}</span>
          {message.isFounder && <span className="label-pixel text-gold">{t("founder")}</span>}
          <span className="nums">{time.format(new Date(message.createdAt))}</span>
        </p>
        <p className="mt-0.5 text-sm text-pretty break-words text-fg-1">{message.body}</p>
      </div>
    </motion.li>
  );
}
