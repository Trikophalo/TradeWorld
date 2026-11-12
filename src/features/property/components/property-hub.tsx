"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HoldButton } from "@/components/ui/hold-button";
import { ShortMoney } from "@/components/ui/live-money";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE, type PropertyTier } from "@/config/balance";
import { CARS, TILE } from "@/config/furniture";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame, usePlayerLevel } from "@/features/game/store";
import type { Property } from "@/features/game/types";
import { useVisitTour } from "@/features/tutorial/use-visit-tour";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { logoArt } from "@/lib/sim/logo";
import { tierIndex, upgradeCostCents } from "@/lib/sim/property";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useFitScale, useProperty, usePropertyRefresh } from "../hooks";
import { RoomEditor } from "./room-editor";
import { RoomView } from "./room-view";
import { CarDealer, FurnitureShop } from "./shops";

const UNLOCK = BALANCE.progression.unlocks.find((u) => u.key === "property")?.level ?? 4;

/** The "Grundstück" tab (ADR-082): the home ladder, the furnished room, the garage. */
export function PropertyHub() {
  const t = useTranslations("estate");
  const level = usePlayerLevel();
  const state = useProperty(null);
  const [editing, setEditing] = useState(false);
  const [shopping, setShopping] = useState(false);
  const [dealer, setDealer] = useState(false);
  const [moving, setMoving] = useState(false);
  useVisitTour("visit_property", level >= UNLOCK && Boolean(state.data));

  if (level < UNLOCK) {
    return (
      <EmptyState
        art={<PixelIcon {...UI_ICONS.lock} scale={4} />}
        title={t("lockedTitle", { level: UNLOCK })}
        description={t("lockedText")}
      />
    );
  }
  if (!state.data) return <Skeleton className="h-96 w-full rounded-lg" />;
  const { property, inventory } = state.data;

  if (!property.tier) {
    return (
      <div className="space-y-5">
        <p className="text-pretty text-fg-2">{t("intro")}</p>
        <TierLadder property={property} />
        <Button variant="secondary" onClick={() => setShopping(true)}>
          {t("shopTitle")}
        </Button>
        <FurnitureShop open={shopping} onClose={() => setShopping(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HomeHeader property={property} onMove={() => setMoving(true)} />
      <Card padding="md" className="space-y-4" data-tour="home-room">
        <FittedRoom property={property} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing(true)} data-testid="furnish">
            ✎ {t("furnish")}
          </Button>
          <Button variant="secondary" onClick={() => setShopping(true)} data-tour="home-shop">
            {t("shopTitle")}
          </Button>
          {inventory && inventory.furniture.length > 0 && (
            <span className="self-center text-sm text-fg-3">
              {t("inInventory", { count: inventory.furniture.length })}
            </span>
          )}
        </div>
      </Card>
      <Garage property={property} onDealer={() => setDealer(true)} />

      {inventory && (
        <RoomEditor open={editing} property={property} inventory={inventory} onClose={() => setEditing(false)} />
      )}
      <FurnitureShop open={shopping} onClose={() => setShopping(false)} />
      <CarDealer open={dealer} property={property} onClose={() => setDealer(false)} />
      <Modal
        open={moving}
        onOpenChange={(o) => !o && setMoving(false)}
        title={t("moveTitle")}
        description={t("moveIntro")}
      >
        <TierLadder property={property} onDone={() => setMoving(false)} />
      </Modal>
    </div>
  );
}

function FittedRoom({ property }: { property: Property }) {
  const { ref, scale } = useFitScale(property.width * TILE, 4);
  return (
    <div ref={ref} className="w-full overflow-x-auto">
      <RoomView property={property} scale={scale} />
    </div>
  );
}

function HomeHeader({ property, onMove }: { property: Property; onMove: () => void }) {
  const t = useTranslations("estate");
  const canMove = tierIndex(property.tier) < BALANCE.property.tiers.length - 1;
  return (
    <Card padding="lg" className="flex flex-wrap items-center gap-4" data-testid="home-header">
      <span className="grid size-14 place-items-center rounded-lg bg-accent-soft text-accent">
        <PixelIcon {...UI_ICONS.home} scale={3} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="label-pixel text-fg-3">{t("yourHome")}</p>
        <p className="text-xl font-semibold text-fg-1">{t(`tierNames.${property.tier!}`)}</p>
        <p className="text-xs text-fg-3">
          {t("size", { w: property.width, h: property.height })}
          {property.garageSlots > 0 && ` · ${t("garageSlots", { count: property.garageSlots })}`}
        </p>
      </div>
      <div className="text-right">
        <p className="label-pixel text-fg-3">{t("value")}</p>
        <ShortMoney cents={property.valueCents} className="text-lg font-semibold text-fg-1" />
      </div>
      {canMove && (
        <Button variant="secondary" onClick={onMove}>
          {t("moveUp")}
        </Button>
      )}
    </Card>
  );
}

/** The ladder from flat to luxury villa, with prices after the trade-in. */
function TierLadder({ property, onDone }: { property: Property; onDone?: () => void }) {
  const t = useTranslations("estate");
  const errorText = useGameErrorText();
  const refresh = usePropertyRefresh();
  const level = usePlayerLevel();
  const cash = useGame((state) => state.portfolio?.cashCents ?? 0);
  const [busy, setBusy] = useState(false);
  const current = tierIndex(property.tier);

  const buy = async (tier: PropertyTier) => {
    setBusy(true);
    try {
      const r = await engine.buyHome(crypto.randomUUID(), tier);
      haptic("success");
      void playSound("levelUp", 0.8);
      toast.success(t("movedIn", { tier: t(`tierNames.${tier}`) }), formatMoney(r.costCents, { whole: true }));
      await refresh();
      onDone?.();
    } catch (error) {
      toast.error(t("moveTitle"), errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="tier-ladder">
      {BALANCE.property.tiers.map((tier, i) => {
        const owned = i <= current;
        const cost = owned ? 0 : upgradeCostCents(property.tier, tier.key);
        const locked = level < tier.minLevel;
        return (
          <motion.li
            key={tier.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-4",
              i === current ? "border-accent bg-accent-soft" : "border-line-1 bg-surface-1",
              owned && i !== current && "opacity-60",
            )}
            data-tier={tier.key}
          >
            <p className="font-semibold text-fg-1">{t(`tierNames.${tier.key}`)}</p>
            <p className="text-xs text-fg-3">
              {t("size", { w: tier.width, h: tier.height })}
              <br />
              {tier.garageSlots > 0 ? t("garageSlots", { count: tier.garageSlots }) : t("noGarage")}
            </p>
            <p className="nums text-sm font-semibold text-fg-1">{formatMoney(tier.priceCents, { whole: true })}</p>
            {i === current ? (
              <Badge tone="accent">{t("current")}</Badge>
            ) : owned ? null : locked ? (
              <Badge>{t("fromLevel", { level: tier.minLevel })}</Badge>
            ) : (
              <HoldButton
                tone="accent"
                onConfirm={() => void buy(tier.key)}
                disabled={busy || cash < cost}
                className="mt-auto w-full"
              >
                {property.tier
                  ? t("moveFor", { amount: formatMoney(cost, { whole: true }) })
                  : t("buyFor", { amount: formatMoney(cost, { whole: true }) })}
              </HoldButton>
            )}
          </motion.li>
        );
      })}
    </ol>
  );
}

/** The garage (from the house): cars side by side, empty bays invite to the dealer. */
export function Garage({ property, onDealer }: { property: Property; onDealer?: () => void }) {
  const t = useTranslations("estate");
  if (property.garageSlots === 0) return null;
  const bySlot = new Map(property.garage.map((g) => [g.slot, g]));
  return (
    <Card padding="md" className="space-y-3" data-testid="garage">
      <div className="flex items-baseline justify-between gap-3">
        <p className="label-pixel text-fg-2">{t("garage")}</p>
        {onDealer && (
          <Button size="sm" onClick={onDealer}>
            {t("dealerTitle")}
          </Button>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-2 rounded-lg bg-surface-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: property.garageSlots }, (_, slot) => {
          const g = bySlot.get(slot);
          const car = g ? CARS.find((c) => c.key === g.carKey) : undefined;
          return (
            <li
              key={slot}
              className={cn(
                "flex h-28 flex-col items-center justify-end gap-1 rounded-md border-b-4 border-line-2 px-2 pb-1",
                car ? "bg-surface-1" : "border-dashed bg-surface-1/40",
              )}
            >
              {car ? (
                <>
                  <PixelIcon {...logoArt(car.sprite)} scale={3} title={`${car.brand} ${car.name}`} />
                  <span className="max-w-full truncate text-2xs text-fg-2">
                    {car.brand} {car.name}
                  </span>
                </>
              ) : (
                <span className="pb-6 text-xs text-fg-3">{t("emptyBay")}</span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Someone else's home on their profile: the flex (ADR-082). */
export function PropertyShowcase({ nickname }: { nickname: string }) {
  const t = useTranslations("estate");
  const state = useProperty(nickname);
  const property = state.data?.property;
  if (!property?.tier) return null;
  return (
    <Card padding="lg" className="space-y-3" data-testid="property-showcase">
      <div className="flex items-baseline justify-between gap-3">
        <p className="label-pixel text-fg-2">{t(`tierNames.${property.tier}`)}</p>
        <ShortMoney cents={property.valueCents} className="text-sm font-semibold text-fg-1" />
      </div>
      <FittedRoom property={property} />
      <Garage property={property} />
    </Card>
  );
}
