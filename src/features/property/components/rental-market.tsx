"use client";

import { motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HoldButton } from "@/components/ui/hold-button";
import { PlayerFigure } from "@/components/ui/player-figure";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { TILE } from "@/config/furniture";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame, usePlayerLevel } from "@/features/game/store";
import type { RentalOffer } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE } from "@/lib/motion";
import { scaledXp } from "@/lib/sim/progression";
import { periodHours, tenantXp } from "@/lib/sim/rentals";
import { playSound } from "@/lib/sound";
import { useFitScale, usePropertyRefresh, useRentalMarket, useRentals } from "../hooks";
import { RoomView } from "./room-view";
import { wohnwertTone } from "./wohnwert-meter";

const UNLOCK = BALANCE.progression.unlocks.find((u) => u.key === "property")?.level ?? 8;

/**
 * The rental market (ADR-158): open offers of other players with a free place, best Wohnwert first. Every card shows
 * the room with the people living in it; renting takes a hold, the first period is paid at once.
 */
export function RentalMarket() {
  const t = useTranslations("rentals");
  const level = usePlayerLevel();
  const market = useRentalMarket();
  const mine = useRentals();

  if (level < UNLOCK) {
    return (
      <EmptyState
        art={<PixelIcon {...UI_ICONS.lock} scale={4} />}
        title={t("lockedTitle", { level: UNLOCK })}
        description={t("lockedText")}
      />
    );
  }
  if (!market.data || !mine.data) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80 w-full rounded-lg" />
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    );
  }
  const renting = mine.data.renting;
  return (
    <div className="space-y-4">
      {renting && (
        <Card padding="md" className="flex flex-wrap items-center justify-between gap-3" data-testid="market-renting">
          <p className="text-sm text-pretty text-fg-2">{t("marketRenting", { owner: renting.owner })}</p>
          <Link href="/property" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            {t("toMyPlace")}
          </Link>
        </Card>
      )}
      {market.data.length === 0 ? (
        <EmptyState
          art={<PixelIcon {...UI_ICONS.home} scale={4} />}
          title={t("marketEmptyTitle")}
          description={t("marketEmptyText")}
          action={
            <Link href="/property" className={buttonVariants({ variant: "secondary" })}>
              {t("offerOwn")}
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2" data-testid="rental-offers">
          {market.data.map((o, i) => (
            <OfferCard key={o.owner} offer={o} index={i} renting={Boolean(renting)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OfferCard({ offer, index, renting }: { offer: RentalOffer; index: number; renting: boolean }) {
  const t = useTranslations("rentals");
  const te = useTranslations("estate");
  const errorText = useGameErrorText();
  const refresh = usePropertyRefresh();
  const router = useRouter();
  const reduced = useReducedMotionConfig();
  const cash = useGame((s) => s.portfolio?.cashCents ?? 0);
  const [busy, setBusy] = useState(false);
  const { ref, scale } = useFitScale(offer.property.width * TILE, 3);
  const tone = wohnwertTone(offer.wohnwert);
  const xp = scaledXp(tenantXp(offer.wohnwert, periodHours(offer.period)));

  const rent = async () => {
    setBusy(true);
    try {
      await engine.rentHome(crypto.randomUUID(), offer.owner);
      haptic("success");
      void playSound("levelUp", 0.7);
      toast.success(t("rented", { owner: offer.owner }), formatMoney(offer.priceCents));
      await refresh();
      router.push("/property");
    } catch (error) {
      toast.error(t("rentTitle"), errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.li
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.slow, ease: EASE.out, delay: Math.min(index, 8) * 0.05 }}
      data-testid="rental-offer-card"
      data-owner={offer.owner}
    >
      <Card padding="md" className="flex h-full flex-col gap-4">
        <div className="flex items-center gap-3">
          <PlayerFigure avatarKey={offer.avatarKey} accessories={offer.accessories} scale={2} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-fg-1">{te(`tierNames.${offer.tier}`)}</p>
            <p className="truncate text-xs text-fg-3">
              {t("from")}{" "}
              <Link
                href={`/players/${encodeURIComponent(offer.owner)}`}
                className="rounded-xs text-fg-2 focus-ring hover:underline"
              >
                {offer.owner}
              </Link>
            </p>
          </div>
          <Badge
            tone={tone === "gold" || tone === "gain" ? "gain" : tone === "warn" ? "warn" : "accent"}
            data-testid="offer-wohnwert"
          >
            {t("wohnwertShort", { value: offer.wohnwert })}
          </Badge>
        </div>
        <div ref={ref} className="w-full">
          <RoomView property={offer.property} scale={scale} tenants={offer.tenants} />
        </div>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="nums text-xl font-semibold text-fg-1">
              {formatMoney(offer.priceCents)}{" "}
              <span className="text-sm font-normal text-fg-3">{t(`per.${offer.period}`)}</span>
            </p>
            <p className="text-xs text-fg-3">
              {t("freePlaces", { free: offer.free, places: offer.places })} ·{" "}
              {t("xpPer", { xp, period: t(`per.${offer.period}`) })}
            </p>
          </div>
          <HoldButton
            tone="accent"
            onConfirm={() => void rent()}
            disabled={busy || renting || offer.free <= 0 || cash < offer.priceCents}
            className="min-w-40"
          >
            {renting ? t("alreadyRenting") : t("rentFor", { amount: formatMoney(offer.priceCents) })}
          </HoldButton>
        </div>
      </Card>
    </motion.li>
  );
}
