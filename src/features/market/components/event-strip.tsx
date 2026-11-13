"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { COIN, FLASK, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { GameEvent } from "@/features/game/types";
import { useGameEvents } from "@/features/social/hooks";
import { formatBps } from "@/lib/format";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const ICON: Record<string, PixelArt> = {
  opening_bell: UI_ICONS.bell,
  closing_bell: UI_ICONS.bell,
  earnings: UI_ICONS.markets,
  pharma_trial: FLASK,
  rate_decision: COIN,
};
const TONE: Record<string, string> = {
  opening_bell: "border-l-info",
  closing_bell: "border-l-warn",
  earnings: "border-l-accent",
  pharma_trial: "border-l-loss",
  rate_decision: "border-l-gold",
};

const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const dayKey = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(ms));
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

/** Title of an event, from kind and company (ADR-090). */
function useEventText() {
  const t = useTranslations("events.kinds");
  return (e: GameEvent) => {
    const company = e.companyName ?? e.ticker ?? "";
    switch (e.kind) {
      case "opening_bell":
      case "closing_bell":
      case "rate_decision":
        return t(e.kind);
      case "earnings":
      case "pharma_trial":
        return t(e.kind, { company });
      default:
        return t("other");
    }
  };
}

/** The result in one short line, coloured good or bad; null when there is nothing to tell. */
function useOutcome() {
  const t = useTranslations("events.outcome");
  return (e: GameEvent): { text: string; tone: "gain" | "loss" | "neutral" } | null => {
    const o = e.outcome;
    if (!o) return null;
    if (e.kind === "pharma_trial") {
      const success = o.success === true;
      return {
        text: t(success ? "trialSuccess" : "trialFailure", { move: formatBps(num(o.move_bps)) }),
        tone: success ? "gain" : "loss",
      };
    }
    if (e.kind === "earnings") {
      const surprise = num(o.surprise_bps ?? o.profit_change_bps ?? o.revenue_change_bps);
      return {
        text: t(surprise >= 0 ? "earningsBeat" : "earningsMiss", { change: formatBps(surprise) }),
        tone: surprise >= 0 ? "gain" : "loss",
      };
    }
    if (e.kind === "rate_decision") {
      const before = num(o.old_bps);
      const after = num(o.new_bps);
      return {
        text: t("rate", {
          before: (before / 100).toLocaleString("de-DE"),
          after: (after / 100).toLocaleString("de-DE"),
        }),
        tone: after > before ? "loss" : after < before ? "gain" : "neutral",
      };
    }
    return null;
  };
}

/** "Heute 18:00", "Morgen 08:00" or the date. */
function useWhen() {
  const t = useTranslations("events");
  const now = useClock();
  return (iso: string) => {
    const at = Date.parse(iso);
    if (now === null) return time.format(at);
    const today = dayKey(now);
    const d = dayKey(at);
    const label =
      d === today
        ? t("today")
        : d === dayKey(now + 86_400_000)
          ? t("tomorrow")
          : d === dayKey(now - 86_400_000)
            ? t("yesterday")
            : d;
    return `${label} ${time.format(at)}`;
  };
}

/** Events of the same kind at the same moment (e.g. several earnings at a quarter end) share one row. */
interface EventGroup {
  key: string;
  kind: string;
  scheduledAt: string;
  status: string;
  importance: number;
  events: GameEvent[];
}

export function groupEvents(events: readonly GameEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  for (const e of events) {
    const last = groups.at(-1);
    if (last && last.kind === e.kind && last.scheduledAt === e.scheduledAt && e.kind === "earnings") {
      last.events.push(e);
      last.importance = Math.max(last.importance, e.importance);
    } else {
      groups.push({
        key: e.id,
        kind: e.kind,
        scheduledAt: e.scheduledAt,
        status: e.status,
        importance: e.importance,
        events: [e],
      });
    }
  }
  return groups;
}

function EventRow({ group, next }: { group: EventGroup; next?: boolean }) {
  const text = useEventText();
  const outcome = useOutcome();
  const when = useWhen();
  const t = useTranslations("events");
  const single = group.events.length === 1 ? group.events[0]! : null;
  const title = single
    ? text(single)
    : t("kinds.earningsMany", { companies: group.events.map((e) => e.companyName ?? e.ticker).join(", ") });
  const results = group.events.map((e) => ({ e, r: outcome(e) })).filter((x) => x.r !== null);
  const content = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-xs bg-surface-2">
        <PixelIcon {...(ICON[group.kind] ?? UI_ICONS.bell)} scale={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-pretty text-fg-1">{title}</span>
        <span className="block text-xs text-fg-3">
          {when(group.scheduledAt)}
          {group.importance >= 3 && group.status !== "resolved" && (
            <span className="ml-1.5 font-pixel text-2xs text-loss uppercase">{t("important")}</span>
          )}
        </span>
        {results.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1.5" data-testid="event-outcome">
            {results.map(({ e, r }) => (
              <span
                key={e.id}
                className={cn(
                  "rounded-xs border px-1.5 py-0.5 text-xs font-semibold",
                  r!.tone === "gain"
                    ? "border-gain/40 bg-gain-soft text-gain"
                    : r!.tone === "loss"
                      ? "border-loss/40 bg-loss-soft text-loss"
                      : "border-line-2 text-fg-2",
                )}
              >
                {single ? r!.text : `${e.ticker ?? ""} ${r!.text}`}
              </span>
            ))}
          </span>
        )}
      </span>
      {group.status !== "resolved" && (
        <Countdown
          target={Date.parse(group.scheduledAt)}
          className={cn("shrink-0 text-sm", next ? "font-semibold text-fg-1" : "text-fg-3")}
        />
      )}
    </>
  );
  const className = cn(
    "flex items-center gap-3 rounded-xs border-2 border-l-4 border-line-1 bg-surface-1 px-3 py-2.5",
    TONE[group.kind] ?? "border-l-line-2",
    next && "border-line-2 bg-surface-2",
  );
  return single?.ticker ? (
    <Link
      href={`/markets/${single.ticker}`}
      className={cn(className, "focus-ring transition duration-fast hover:bg-surface-2")}
    >
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** Upcoming announced events and the results of the last day (events page, ADR-090). */
export function EventStrip() {
  const t = useTranslations("events");
  const events = useGameEvents();
  const data = events.data;
  if (events.isPending) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xs" />
        ))}
      </div>
    );
  }
  if (!data || (data.upcoming.length === 0 && data.recent.length === 0)) {
    return (
      <EmptyState
        art={<PixelIcon {...UI_ICONS.bell} scale={4} />}
        title={t("emptyTitle")}
        description={t("emptyText")}
      />
    );
  }
  return (
    <div className="grid gap-5 lg:grid-cols-2" data-testid="events">
      <section aria-label={t("upcoming")} className="space-y-2.5">
        <h2 className="label-pixel text-fg-2">{t("upcoming")}</h2>
        <motion.ul variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
          {groupEvents(data.upcoming).map((g, i) => (
            <motion.li key={g.key} variants={fadeUp} data-kind={g.kind}>
              <EventRow group={g} next={i === 0} />
            </motion.li>
          ))}
        </motion.ul>
      </section>
      <section aria-label={t("recent")} className="space-y-2.5">
        <h2 className="label-pixel text-fg-2">{t("recent")}</h2>
        {data.recent.length === 0 ? (
          <p className="text-sm text-fg-3">{t("recentEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {groupEvents(data.recent).map((g) => (
              <li key={g.key} data-kind={g.kind}>
                <EventRow group={g} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Start page: the next three dates, linking to the events page. */
export function NextEventsCard() {
  const t = useTranslations("events");
  const events = useGameEvents();
  const next = groupEvents(events.data?.upcoming ?? []).slice(0, 3);
  return (
    <Card padding="lg" className="space-y-3" data-testid="next-events">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="label-pixel text-fg-2">{t("nextTitle")}</h2>
        <Link href="/events" className="text-sm text-accent focus-ring hover:underline">
          {t("all")}
        </Link>
      </div>
      {events.isPending ? (
        <Skeleton className="h-28 w-full rounded-xs" />
      ) : next.length === 0 ? (
        <p className="text-sm text-fg-3">{t("emptyText")}</p>
      ) : (
        <ul className="space-y-2">
          {next.map((g, i) => (
            <li key={g.key}>
              <EventRow group={g} next={i === 0} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
