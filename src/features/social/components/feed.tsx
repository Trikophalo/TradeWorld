"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { BULL, TROPHIES, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PlayerTag } from "@/components/ui/player-tag";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { CARS } from "@/config/furniture";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { FeedItem } from "@/features/game/types";
import { formatBps, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { useClock } from "@/lib/use-now";
import { logoArt } from "@/lib/sim/logo";
import { cn } from "@/lib/utils";
import { useFeed, useUpdateFeedItem } from "../hooks";

const ICONS: Record<string, PixelArt> = {
  level_up: UI_ICONS.star,
  big_trade: BULL,
  company_founded: UI_ICONS.company,
  company_upgraded: UI_ICONS.company,
  company_ipo: UI_ICONS.markets,
  company_expanded: UI_ICONS.company,
  art_won: UI_ICONS.art,
  art_created: UI_ICONS.art,
  home_bought: UI_ICONS.home,
  car_bought: logoArt(CARS[0]!.sprite),
  job_started: UI_ICONS.briefcase,
  streak: UI_ICONS.flame,
  league_won: TROPHIES.gold,
  friends_now: UI_ICONS.heart,
  promoted: UI_ICONS.upgrade,
};

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

/** The sentence after the name, from kind and payload (the server sends data, the client the words). */
function useFeedText() {
  const t = useTranslations("social.feed.kinds");
  const tf = useTranslations("firm.tiers");
  const te = useTranslations("estate.tierNames");
  const tc = useTranslations("careerTiers");
  return (item: FeedItem): string => {
    const p = item.payload;
    switch (item.kind) {
      case "level_up":
        return t("level_up", { level: n(p.level) });
      case "big_trade":
        return t("big_trade", {
          security: str(p.security_name) || str(p.ticker),
          profit: formatMoney(n(p.profit_cents), { whole: true }),
          pct: formatBps(n(p.profit_bps)),
        });
      case "company_founded":
        return t("company_founded", { company: str(p.name), tier: tierName(tf, str(p.tier)) });
      case "company_upgraded":
        return t("company_upgraded", { company: str(p.name), tier: tierName(tf, str(p.tier)) });
      case "company_ipo":
        return t("company_ipo", { company: str(p.name), ticker: str(p.ticker) });
      case "company_expanded":
        return t("company_expanded", { company: str(p.name), level: n(p.level) });
      case "art_won":
        return t("art_won", { title: str(p.title), price: formatMoney(n(p.price_cents), { whole: true }) });
      case "art_created":
        return t("art_created", { title: str(p.title) });
      case "home_bought": {
        const tier = str(p.tier);
        const known = ["flat", "apartment", "house", "villa", "luxury_villa"].includes(tier);
        return t("home_bought", { home: known ? te(tier as "flat") : tier });
      }
      case "car_bought": {
        const car = CARS.find((c) => c.key === str(p.car_key));
        return t("car_bought", { car: car ? `${car.brand} ${car.name}` : str(p.car_key) });
      }
      case "job_started":
        return t("job_started", { company: str(p.company_name), title: str(p.title) });
      case "streak":
        return t("streak", { days: n(p.days) });
      case "league_won":
        return t("league_won", { growth: formatBps(n(p.growth_bps)) });
      case "friends_now":
        return t("friends_now", { other: str(p.other_nickname) });
      case "promoted": {
        const tier = str(p.tier);
        const known = ["intern", "junior", "senior", "team_lead", "c_level"].includes(tier);
        return t("promoted", { tier: known ? tc(tier as "junior") : tier, company: str(p.company) });
      }
      default:
        return t("other");
    }
  };
}

function tierName(t: ReturnType<typeof useTranslations<"firm.tiers">>, tier: string) {
  return ["garage", "small_business", "gmbh", "ag"].includes(tier) ? t(tier as "garage") : tier;
}

/** "vor 5 Min." style age, after hydration only. */
export function useAgo() {
  const t = useTranslations("social");
  const now = useClock();
  return (iso: string) => {
    if (now === null) return "";
    const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
    if (minutes < 1) return t("ago.now");
    if (minutes < 60) return t("ago.minutes", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("ago.hours", { count: hours });
    return t("ago.days", { count: Math.floor(hours / 24) });
  };
}

/** One feed entry: avatar with the event's pixel icon, the sentence, the age and the applause button. */
export function FeedRow({ item, compact }: { item: FeedItem; compact?: boolean }) {
  const t = useTranslations("social");
  const text = useFeedText();
  const ago = useAgo();
  const update = useUpdateFeedItem();
  const errorText = useGameErrorText();
  const [busy, setBusy] = useState(false);
  const [pop, setPop] = useState(0);

  const react = async () => {
    setBusy(true);
    haptic("tap");
    try {
      const next = await engine.reactFeed(crypto.randomUUID(), item.id);
      update(next);
      if (next.reacted) {
        setPop((p) => p + 1);
        void playSound("tap", 0.6);
      }
    } catch (error) {
      toast.error(t("title"), errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING.smooth}
      className={cn(
        "flex items-start gap-3 rounded-xs border-2 border-line-1 bg-surface-1 p-3",
        compact && "border-0 bg-transparent p-1",
      )}
      data-kind={item.kind}
      data-testid="feed-item"
    >
      <Link
        href={`/players/${encodeURIComponent(item.actor.nickname)}`}
        className="relative shrink-0 rounded-sm focus-ring"
        aria-label={t("openProfile", { name: item.actor.nickname })}
      >
        <Avatar avatarKey={item.actor.avatarKey} size="sm" />
        <span className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-xs border-2 border-bg bg-surface-2">
          <PixelIcon {...(ICONS[item.kind] ?? UI_ICONS.bell)} scale={1} />
        </span>
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-pretty text-fg-2">
          <Link
            href={`/players/${encodeURIComponent(item.actor.nickname)}`}
            className="font-semibold text-fg-1 focus-ring hover:underline"
          >
            {item.actor.nickname}
          </Link>{" "}
          {item.isMe && <span className="label-pixel text-accent">{t("you")} </span>}
          {text(item)}
        </p>
        <p className="mt-1 flex items-center gap-2 text-xs text-fg-3">
          <PlayerTag tag={item.actor.tag} />
          <span>{ago(item.createdAt)}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => void react()}
        disabled={busy}
        aria-pressed={item.reacted}
        aria-label={item.reacted ? t("unreact") : t("react")}
        data-testid="feed-react"
        className={cn(
          "relative flex shrink-0 items-center gap-1 rounded-xs border-2 px-2 py-1 font-pixel text-2xs focus-ring transition duration-fast active:scale-90",
          item.reacted
            ? "border-loss/60 bg-loss-soft text-loss"
            : "border-line-2 text-fg-3 hover:border-loss/50 hover:text-loss",
        )}
      >
        <PixelIcon {...UI_ICONS.heart} scale={1} />
        <span className="nums">{item.reactions}</span>
        <AnimatePresence>
          {pop > 0 && (
            <motion.span
              key={pop}
              aria-hidden
              className="pointer-events-none absolute -top-1 left-1/2 -ml-2 text-loss"
              initial={{ y: 0, opacity: 1, scale: 0.8 }}
              animate={{ y: -18, opacity: 0, scale: 1.3 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION.slower }}
            >
              <PixelIcon {...UI_ICONS.heart} scale={1} />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </motion.li>
  );
}

/** The whole feed with "load more" (friends hub, ADR-088). */
export function FeedList() {
  const t = useTranslations("social");
  const feed = useFeed();
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  if (feed.isPending) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xs" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        art={<PixelIcon {...UI_ICONS.bell} scale={4} />}
        title={t("emptyTitle")}
        description={t("emptyText")}
        action={
          <Link href="/friends?tab=friends" className="text-sm font-medium text-accent focus-ring hover:underline">
            {t("findFriends")}
          </Link>
        }
      />
    );
  }
  return (
    <div className="space-y-3">
      <ul className="space-y-2" data-testid="feed">
        {items.map((item) => (
          <FeedRow key={item.id} item={item} />
        ))}
      </ul>
      {feed.hasNextPage && (
        <Button
          variant="secondary"
          block
          state={feed.isFetchingNextPage ? "loading" : "idle"}
          onClick={() => void feed.fetchNextPage()}
        >
          {t("more")}
        </Button>
      )}
    </div>
  );
}

/** Start page: the latest three things your friends did. */
export function FeedPreview() {
  const t = useTranslations("social");
  const feed = useFeed();
  const items = (feed.data?.pages[0]?.items ?? []).slice(0, 3);
  return (
    <Card padding="lg" className="space-y-3" data-testid="feed-preview">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="label-pixel text-fg-2">{t("previewTitle")}</h2>
        <Link href="/friends" className="text-sm text-accent focus-ring hover:underline">
          {t("all")}
        </Link>
      </div>
      {feed.isPending ? (
        <Skeleton className="h-24 w-full rounded-xs" />
      ) : items.length === 0 ? (
        <p className="text-sm text-pretty text-fg-3">{t("previewEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <FeedRow key={item.id} item={item} compact />
          ))}
        </ul>
      )}
    </Card>
  );
}
