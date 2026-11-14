"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { demoStartNewsShow } from "@/features/game/demo-engine";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { NewsShowChatMessage, NewsShowState } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE } from "@/lib/motion";
import { showDurationMs, showPhase } from "@/lib/sim/news-show";
import { playSound } from "@/lib/sound";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/supabase/env";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { NewsStudio, type NewsStudioProps } from "./studio";

const cfg = BALANCE.newsShow;
export const NEWS_SHOW_KEY = ["news-show"] as const;
const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

/** A clock that ticks several times a second while `fast`, once a second otherwise (after hydration). */
function useTicker(fast: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, fast ? 100 : 1000);
    return () => window.clearInterval(id);
  }, [fast]);
  return now;
}

/** A show is running or starts within a minute and a half (by the server's clock). */
function showIsNear(data: NewsShowState | undefined, updatedAt: number, clientNow: number): boolean {
  if (!data) return false;
  const serverNow = clientNow + Date.parse(data.now) - updatedAt;
  if (Date.parse(data.nextAirsAt) - serverNow < 90_000) return true;
  return (
    !!data.show && showPhase(serverNow, Date.parse(data.show.startedAt), data.show.segments.length).mode !== "over"
  );
}

/** Claude polishes the draft of the next show once (live only); without a key the Mini-KI's script airs. */
const asked = new Set<number>();
function askAnchor(showId: number) {
  if (asked.has(showId)) return;
  asked.add(showId);
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;
  void supabase.functions.invoke("news-anchor", { body: { show_id: showId } }).catch(() => undefined);
}

/**
 * NEXA Nachrichten (ADR-150): the TV with Mr. Doodle Dangle and the live chat beside it. Before the full hour the
 * TV counts down; the show starts when a viewer is there and everyone sees the same moment of it (the phase comes
 * from the server's start time). Afterwards it can be watched again for a while.
 */
export function NewsShow() {
  const t = useTranslations("newsShow");
  const client = useQueryClient();
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const query = useQuery({
    queryKey: NEWS_SHOW_KEY,
    queryFn: () => engine.newsShow(),
    // Poll fast around and during a show, slowly otherwise.
    refetchInterval: (q) => (showIsNear(q.state.data, q.state.dataUpdatedAt, Date.now()) ? 2_500 : 12_000),
  });
  const data = query.data;
  // The server's clock minus ours, so every viewer is at the same point of the show.
  const offset = data ? Date.parse(data.now) - query.dataUpdatedAt : 0;
  const second = useClock();
  const replaying =
    replayAt !== null &&
    second !== null &&
    !!data?.show &&
    second - replayAt <= showDurationMs(data.show.segments.length) + 1_000;
  // Several ticks a second only while something moves on the TV.
  const now = useTicker(replaying || (second !== null && showIsNear(data, query.dataUpdatedAt, second)));
  const serverNow = now === null ? null : now + offset;

  const view = useMemo((): (NewsStudioProps & { live: boolean; over: boolean }) | null => {
    if (!data || serverNow === null) return null;
    const show = data.show;
    const count = show?.segments.length ?? 0;
    if (show && replaying && replayAt !== null && now !== null) {
      const phase = showPhase(now, replayAt, count);
      if (phase.mode !== "over")
        return { ...studioProps(phase, show.segments), replay: true, live: false, over: false };
    }
    if (show) {
      const phase = showPhase(serverNow, Date.parse(show.startedAt), count);
      if (phase.mode !== "over") return { ...studioProps(phase, show.segments), live: true, over: false };
    }
    // before the show: the countdown, in our own clock
    return { mode: "standby", startsAt: Date.parse(data.nextAirsAt) - offset, live: false, over: show !== null };
  }, [data, serverNow, now, replayAt, replaying, offset]);

  useEffect(() => {
    if (data?.upcoming?.needsScript) askAnchor(data.upcoming.id);
  }, [data?.upcoming]);

  if (!data || !view) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" aria-hidden>
        <Skeleton className="aspect-[4/3] w-full rounded-lg" />
        <Skeleton className="h-80 w-full rounded-lg lg:h-auto" />
      </div>
    );
  }

  return (
    <section className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" data-testid="news-show">
      <Card padding="none" className="overflow-hidden" data-show-mode={view.mode} data-show-live={view.live}>
        <NewsStudio {...view} viewers={data.viewers} charsPerSecond={cfg.charsPerSecond} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-1 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-fg-1">{t("title")}</p>
            <p className="text-xs text-pretty text-fg-3">
              {view.live ? t("liveHint") : view.replay ? t("replayHint") : t("standbyHint")}
            </p>
          </div>
          {!view.live && !view.replay && view.over && data.show && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                haptic("tap");
                setReplayAt(Date.now());
              }}
              data-testid="news-show-replay"
            >
              {t("replay")}
            </Button>
          )}
          {view.replay && (
            <Button size="sm" variant="ghost" onClick={() => setReplayAt(null)}>
              {t("replayStop")}
            </Button>
          )}
          {isDemoMode && !view.live && (
            <button
              type="button"
              className="text-xs text-accent underline-offset-2 focus-ring hover:underline"
              onClick={() => {
                demoStartNewsShow();
                setReplayAt(null);
                void client.invalidateQueries({ queryKey: NEWS_SHOW_KEY });
              }}
              data-testid="demo-start-show"
            >
              {t("demoStart")}
            </button>
          )}
        </div>
      </Card>
      <ShowChat chat={data.chat} viewers={data.viewers} live={view.live} />
    </section>
  );
}

function studioProps(
  phase: Exclude<ReturnType<typeof showPhase>, { mode: "over" }>,
  segments: NonNullable<NewsShowState["show"]>["segments"],
): NewsStudioProps {
  if (phase.mode === "live")
    return {
      mode: "live",
      segment: segments[phase.segmentIndex] ?? null,
      segmentIndex: phase.segmentIndex,
      segmentCount: segments.length,
      elapsedMs: phase.elapsedMs,
    };
  return { mode: phase.mode, elapsedMs: phase.elapsedMs, segmentCount: segments.length };
}

/** The chat beside the TV: everyone watching writes here, emojis welcome. */
function ShowChat({ chat, viewers, live }: { chat: NewsShowChatMessage[]; viewers: number; live: boolean }) {
  const t = useTranslations("newsShow");
  const client = useQueryClient();
  const errorText = useGameErrorText();
  const [text, setText] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  const list = useRef<HTMLOListElement>(null);
  const last = chat.at(-1)?.id ?? 0;

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [last]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || state === "loading") return;
    setState("loading");
    try {
      const next = await engine.postNewsShowMessage(crypto.randomUUID(), body);
      client.setQueryData<NewsShowState>(NEWS_SHOW_KEY, (d) => (d ? { ...d, chat: next } : d));
      setText("");
      void playSound("tap");
    } catch (error) {
      toast.error(t("chatTitle"), errorText(error));
    } finally {
      setState("idle");
    }
  };

  return (
    <Card padding="none" className="flex h-96 min-h-0 flex-col overflow-hidden lg:h-auto" data-testid="news-show-chat">
      <header className="flex items-center gap-2 border-b border-line-1 px-4 py-3">
        <p className="min-w-0 flex-1 truncate font-semibold text-fg-1">{t("chatTitle")}</p>
        {live && <Badge tone="loss">{t("badgeLive")}</Badge>}
        <span className="nums text-xs text-fg-3">{t("viewers", { count: viewers })}</span>
      </header>
      <ol ref={list} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" aria-live="polite">
        {chat.length === 0 && <li className="py-6 text-center text-sm text-pretty text-fg-3">{t("chatEmpty")}</li>}
        {chat.map((m) => (
          <motion.li
            key={m.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.base, ease: EASE.out }}
            className={cn("flex", m.mine && "justify-end")}
          >
            <div className={cn("max-w-[88%] rounded-lg px-3 py-1.5", m.mine ? "bg-accent-soft" : "bg-surface-2")}>
              <p className="flex items-baseline gap-2 text-2xs text-fg-3">
                <span className="truncate font-medium text-fg-2">{m.nickname}</span>
                <span className="nums">{time.format(new Date(m.at))}</span>
              </p>
              <p className="text-sm text-pretty break-words text-fg-1">{m.body}</p>
            </div>
          </motion.li>
        ))}
      </ol>
      <form onSubmit={(event) => void send(event)} className="space-y-2 border-t border-line-1 p-3">
        <div className="flex gap-1 overflow-x-auto" role="group" aria-label={t("emojis")}>
          {cfg.chat.emojis.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setText((v) => (v + emoji).slice(0, cfg.chat.maxLength))}
              className="grid size-8 shrink-0 place-items-center rounded-md text-lg focus-ring transition duration-fast hover:bg-surface-2 active:scale-90"
              aria-label={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t("chatPlaceholder")}</span>
            <input
              value={text}
              maxLength={cfg.chat.maxLength}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("chatPlaceholder")}
              className="h-11 w-full rounded-md border border-line-2 bg-surface-2 px-3 text-fg-1 focus-ring placeholder:text-fg-3"
              data-testid="news-show-input"
            />
          </label>
          <Button type="submit" state={state} disabled={!text.trim()} data-testid="news-show-send">
            {t("chatSend")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
