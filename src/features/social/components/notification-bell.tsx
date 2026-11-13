"use client";

import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { engine } from "@/features/game/store";
import type { AppNotification, NotificationList } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { SOCIAL_KEYS, useNotifications } from "../hooks";
import { useAgo } from "./feed";

/** The bell in the top bar: unread count, and a sheet with every notification (friends, auctions, league ...). */
export function NotificationBell() {
  const t = useTranslations("social.notifications");
  const list = useNotifications();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const unread = list.data?.unread ?? 0;

  // Opening counts as reading: mark everything read after a moment, so the dots stay visible while opening.
  useEffect(() => {
    if (!open || unread === 0) return;
    const timer = window.setTimeout(() => {
      void engine.markNotificationsRead().then((left) =>
        client.setQueryData<NotificationList>(SOCIAL_KEYS.notifications, (data) =>
          data
            ? {
                unread: left,
                items: data.items.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
              }
            : data,
        ),
      );
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [open, unread, client]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          haptic("tap");
          setOpen(true);
        }}
        aria-label={unread > 0 ? t("labelUnread", { count: unread }) : t("label")}
        data-testid="notification-bell"
        className="relative grid size-8 shrink-0 place-items-center rounded-md text-fg-2 focus-ring transition duration-fast hover:bg-surface-2 hover:text-fg-1 active:scale-95 sm:size-9"
      >
        <motion.span
          key={unread}
          initial={unread > 0 ? { rotate: -18 } : false}
          animate={{ rotate: 0 }}
          transition={SPRING.bouncy}
        >
          <PixelIcon {...UI_ICONS.bell} scale={2} />
        </motion.span>
        {unread > 0 && (
          <span
            className="absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-xs border-2 border-bg bg-loss px-0.5 font-pixel text-2xs leading-none text-on-semantic"
            data-testid="notification-count"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={t("title")} description={t("intro")}>
        {list.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xs" />
            ))}
          </div>
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState
            art={<PixelIcon {...UI_ICONS.bell} scale={4} />}
            title={t("emptyTitle")}
            description={t("emptyText")}
          />
        ) : (
          <ul className="space-y-2" data-testid="notification-list">
            {list.data.items.map((n) => (
              <NotificationRow key={n.id} item={n} onNavigate={() => setOpen(false)} />
            ))}
          </ul>
        )}
      </Sheet>
    </>
  );
}

function NotificationRow({ item, onNavigate }: { item: AppNotification; onNavigate: () => void }) {
  const ago = useAgo();
  const body = (
    <>
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-xs", item.readAt ? "bg-surface-3" : "bg-info")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", item.readAt ? "text-fg-2" : "font-semibold text-fg-1")}>{item.title}</span>
        {item.body && <span className="block text-xs text-pretty text-fg-3">{item.body}</span>}
        <span className="mt-0.5 block text-2xs text-fg-3">{ago(item.createdAt)}</span>
      </span>
    </>
  );
  const className =
    "flex w-full items-start gap-3 rounded-xs border-2 border-line-1 bg-surface-1 p-3 text-left transition duration-fast";
  return (
    <li data-type={item.typeKey}>
      {item.link ? (
        <Link
          href={item.link}
          onClick={onNavigate}
          className={cn(className, "focus-ring hover:border-line-2 hover:bg-surface-2")}
        >
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}
