"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/features/social/hooks";
import type { AppNotification } from "@/features/game/types";
import { haptic } from "@/lib/haptics";
import { DURATION, SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";

/*
 * A big popup when a task is delegated to you (ADR-143). The server notifies the assignee (type_key company_task);
 * this watches the notifications and shows the newest unseen one full screen, so an employee cannot miss it. Dismissed
 * ids are kept in localStorage (read after hydration), so the popup does not return after a reload.
 */
const STORAGE_KEY = "nexa-seen-delegated";

function readSeen(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function DelegatedTaskOverlay() {
  const t = useTranslations("companyTasks.delegatedPopup");
  const router = useRouter();
  const query = useNotifications();
  const [current, setCurrent] = useState<AppNotification | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const anchor = useRef<HTMLDivElement>(null);

  // Only the newest unread delegation that has not been dismissed before.
  const items = query.data?.items;
  useEffect(() => {
    seen.current ??= new Set(readSeen());
    if (!items || current) return;
    const fresh = items.find((n) => n.typeKey === "company_task" && n.readAt === null && !seen.current!.has(n.id));
    if (fresh) setCurrent(fresh);
  }, [items, current]);

  useEffect(() => {
    if (!current) return;
    void playSound("notify");
    haptic("success");
  }, [current]);

  const dismiss = (go: boolean) => {
    const item = current;
    setCurrent(null);
    if (item) {
      seen.current?.add(item.id);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...(seen.current ?? [])].slice(-200)));
      } catch {
        // private mode: it may show once more, no harm
      }
    }
    if (go) router.push(item?.link ?? "/job");
  };

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={t("title")}
          className="fixed inset-0 z-celebration grid place-items-center bg-scrim px-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.base }}
          onClick={() => dismiss(false)}
        >
          <motion.div
            className="w-full max-w-sm rounded-xl border-2 border-accent bg-surface-1 p-6 text-center shadow-3"
            initial={{ scale: 0.8, y: 24 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={SPRING.bouncy}
            onClick={(event) => event.stopPropagation()}
            data-testid="delegated-task-popup"
          >
            <motion.div
              ref={anchor}
              className="mx-auto grid size-16 place-items-center rounded-xl bg-accent-soft text-accent"
              initial={{ rotate: -12, scale: 0.6 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ ...SPRING.bouncy, delay: 0.1 }}
            >
              <PixelIcon {...UI_ICONS.briefcase} scale={4} />
            </motion.div>
            <p className="mt-4 label-pixel text-accent">{t("kicker")}</p>
            <p className="mt-1 text-xl font-semibold text-pretty text-fg-1">{current.title}</p>
            {current.body && <p className="mt-2 text-sm text-pretty text-fg-2">{current.body}</p>}
            <div className="mt-6 grid gap-2">
              <Button block size="lg" onClick={() => dismiss(true)}>
                {t("go")}
              </Button>
              <Button block variant="ghost" onClick={() => dismiss(false)}>
                {t("later")}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
