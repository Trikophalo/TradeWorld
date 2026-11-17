"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "@/components/ui/toast";
import { isDisclosed } from "@/config/disclosure";
import { usePlayerLevel } from "@/features/game/store";
import { NEWS_PROMO_HREF, useNewsPromo } from "./hooks";
import { usePromoSummary } from "./promo-card";

const SEEN_KEY = "nexa.newsPromo.seen";

function seen(id: number): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === String(id);
  } catch {
    return false;
  }
}
function markSeen(id: number) {
  try {
    window.localStorage.setItem(SEEN_KEY, String(id));
  } catch {
    // private window: the toast may come once more after a reload
  }
}

/**
 * News-Aktionen (ADR-193): whoever is online when a promotion starts gets one toast with the way to it, once per
 * promotion and browser. No sound pressure, no repeat.
 */
export function NewsPromoWatcher() {
  const level = usePlayerLevel();
  return isDisclosed("newsPromo", level) ? <Watch /> : null;
}

function Watch() {
  const t = useTranslations("newsPromo");
  const summary = usePromoSummary();
  const { promo } = useNewsPromo();
  useEffect(() => {
    if (!promo || seen(promo.id)) return;
    markSeen(promo.id);
    toast.info(
      t("toastTitle", { kind: t(`kinds.${promo.kind}`) }),
      <>
        {summary(promo)}{" "}
        <Link href={NEWS_PROMO_HREF[promo.kind]} className="font-medium text-accent underline focus-ring">
          {t(`go.${promo.kind}`)}
        </Link>
      </>,
    );
  }, [promo, summary, t]);
  return null;
}
