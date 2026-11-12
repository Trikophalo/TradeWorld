"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { FriendEntry, Friends } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { friendStatus, useFriends, useSetFriends } from "../hooks";

const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" });

function useFriendAction() {
  const t = useTranslations("friends");
  const errorText = useGameErrorText();
  const setFriends = useSetFriends();
  return async (run: () => Promise<Friends>, done: string) => {
    try {
      setFriends(await run());
      haptic("success");
      void playSound("success");
      toast.success(done, undefined, { silent: true });
      return true;
    } catch (error) {
      toast.error(t("title"), errorText(error));
      return false;
    }
  };
}

/** The button on a player's profile: add, cancel, accept or remove (ADR-084). */
export function FriendButton({ nickname }: { nickname: string }) {
  const t = useTranslations("friends");
  const me = useGame((state) => state.portfolio?.nickname ?? "");
  const friends = useFriends();
  const act = useFriendAction();
  const [state, setState] = useState<ButtonState>("idle");
  const status = friendStatus(friends.data, nickname, me);
  if (status === "self" || !me) return null;

  const run = async (call: () => Promise<Friends>, done: string) => {
    setState("loading");
    const ok = await act(call, done);
    setState(ok ? "success" : "idle");
    if (ok) window.setTimeout(() => setState("idle"), 800);
  };
  const id = () => crypto.randomUUID();

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="friend-button" data-status={status}>
      {status === "none" && (
        <Button state={state} onClick={() => void run(() => engine.sendFriendRequest(id(), nickname), t("sent"))}>
          <PixelIcon {...UI_ICONS.heart} scale={1} /> {t("add")}
        </Button>
      )}
      {status === "outgoing" && (
        <>
          <Badge tone="accent">{t("pending")}</Badge>
          <Button
            size="sm"
            variant="ghost"
            state={state}
            onClick={() => void run(() => engine.removeFriend(id(), nickname), t("cancelled"))}
          >
            {t("cancel")}
          </Button>
        </>
      )}
      {status === "incoming" && (
        <>
          <Button
            state={state}
            onClick={() => void run(() => engine.respondFriendRequest(id(), nickname, true), t("accepted"))}
          >
            {t("accept")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => void run(() => engine.respondFriendRequest(id(), nickname, false), t("declined"))}
          >
            {t("decline")}
          </Button>
        </>
      )}
      {status === "friends" && (
        <>
          <Badge tone="gain">♥ {t("isFriend")}</Badge>
          <Button
            size="sm"
            variant="ghost"
            state={state}
            onClick={() => void run(() => engine.removeFriend(id(), nickname), t("removed"))}
          >
            {t("remove")}
          </Button>
        </>
      )}
    </div>
  );
}

/** The friends page: add by name, open requests, the list with profile links (ADR-084). */
export function FriendsView() {
  const t = useTranslations("friends");
  const me = useGame((state) => state.portfolio?.nickname ?? "");
  const friends = useFriends();
  const act = useFriendAction();
  const [name, setName] = useState("");
  const [state, setState] = useState<ButtonState>("idle");

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (value.length < 3) return;
    if (value.toLowerCase() === me.toLowerCase()) {
      toast.error(t("title"), t("notYourself"));
      return;
    }
    setState("loading");
    const ok = await act(() => engine.sendFriendRequest(crypto.randomUUID(), value), t("sent"));
    setState(ok ? "success" : "idle");
    if (ok) {
      setName("");
      window.setTimeout(() => setState("idle"), 800);
    }
  };

  return (
    <div className="grid gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
      <div className="space-y-5">
        {!friends.data ? (
          <Skeleton className="h-48 w-full rounded-lg" />
        ) : friends.data.friends.length === 0 ? (
          <EmptyState
            art={<PixelIcon {...UI_ICONS.heart} scale={4} />}
            title={t("emptyTitle")}
            description={t("emptyText")}
          />
        ) : (
          <Card padding="lg" className="space-y-3" data-testid="friend-list">
            <p className="label-pixel text-fg-2">{t("listTitle", { count: friends.data.friends.length })}</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              <AnimatePresence initial={false}>
                {friends.data.friends.map((f) => (
                  <PersonRow key={f.nickname} entry={f} hint={t("since", { date: date.format(new Date(f.at)) })} />
                ))}
              </AnimatePresence>
            </ul>
          </Card>
        )}
        {friends.data && friends.data.incoming.length > 0 && (
          <Card padding="lg" className="space-y-3" data-testid="friend-incoming">
            <p className="label-pixel text-fg-2">{t("incomingTitle")}</p>
            <ul className="space-y-2">
              {friends.data.incoming.map((f) => (
                <PersonRow key={f.nickname} entry={f} hint={t("wantsToBeFriends")}>
                  <FriendButton nickname={f.nickname} />
                </PersonRow>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <div className="space-y-5">
        <Card padding="lg" className="space-y-3">
          <p className="label-pixel text-fg-2">{t("addTitle")}</p>
          <form onSubmit={(e) => void add(e)} className="space-y-3">
            <Field
              label={t("nameLabel")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              autoComplete="off"
              data-testid="friend-name"
            />
            <Button type="submit" block state={state} disabled={name.trim().length < 3}>
              {t("send")}
            </Button>
          </form>
          <p className="text-xs text-pretty text-fg-3">{t("addHint")}</p>
        </Card>
        {friends.data && friends.data.outgoing.length > 0 && (
          <Card padding="lg" className="space-y-3" data-testid="friend-outgoing">
            <p className="label-pixel text-fg-2">{t("outgoingTitle")}</p>
            <ul className="space-y-2">
              {friends.data.outgoing.map((f) => (
                <PersonRow key={f.nickname} entry={f} hint={t("pending")}>
                  <FriendButton nickname={f.nickname} />
                </PersonRow>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function PersonRow({ entry, hint, children }: { entry: FriendEntry; hint: string; children?: ReactNode }) {
  const t = useTranslations("friends");
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex flex-wrap items-center gap-3 rounded-md border border-line-1 bg-surface-1 px-3 py-2.5"
    >
      <Link
        href={`/players/${encodeURIComponent(entry.nickname)}`}
        className="group flex min-w-0 flex-1 items-center gap-3 rounded-sm focus-ring"
        aria-label={t("openProfile", { name: entry.nickname })}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent-soft font-pixel text-xs text-accent">
          {entry.nickname.slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-fg-1 group-hover:underline">{entry.nickname}</span>
          <span className="block text-xs text-fg-3">
            Level {entry.level} · {hint}
          </span>
        </span>
      </Link>
      {children}
    </motion.li>
  );
}
