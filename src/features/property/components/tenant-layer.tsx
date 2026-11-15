"use client";

import { motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { FIGURE_HEIGHT, FIGURE_WIDTH } from "@/components/pixel/player-figure";
import { PlayerFigure } from "@/components/ui/player-figure";
import { TILE } from "@/config/furniture";
import type { Property, Tenant } from "@/features/game/types";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { WALL } from "../room";
import { freeTiles, idleMs, tenantLook, walkTile } from "../tenants";

/** Figures are a little smaller than the room's pixel scale, so they fit a tile (whole numbers only). */
export const figureScale = (roomScale: number) => Math.max(1, Math.floor((roomScale * 3) / 4));

/**
 * The tenants of a home (ADR-158) walking around in the room: from free tile to free tile with a pause in between,
 * players as their dressed figure, AI tenants with a look from their name. Only transform moves; with reduced
 * motion everyone stands still on a fixed tile.
 */
export function TenantLayer({
  property,
  tenants,
  scale,
}: {
  property: Pick<Property, "width" | "height" | "placed">;
  tenants: readonly Tenant[];
  scale: number;
}) {
  const tiles = useMemo(() => freeTiles(property), [property]);
  if (tenants.length === 0 || tiles.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="tenants">
      {tenants.map((t, i) => (
        <WalkingTenant key={t.id} tenant={t} tiles={tiles} scale={scale} index={i} />
      ))}
    </div>
  );
}

function WalkingTenant({
  tenant,
  tiles,
  scale,
  index,
}: {
  tenant: Tenant;
  tiles: readonly { x: number; y: number }[];
  scale: number;
  index: number;
}) {
  const t = useTranslations("rentals");
  const reduced = useReducedMotionConfig() ?? false;
  // the first tile depends on the place in the list, so two tenants do not start on the same spot
  const [step, setStep] = useState(index);
  const [walking, setWalking] = useState(false);
  const [facing, setFacing] = useState<1 | -1>(1);
  const tile = walkTile(tiles, tenant.name, reduced ? index : step) ?? tiles[0]!;
  const [from, setFrom] = useState(tile);
  const look = tenantLook(tenant);
  const fs = figureScale(scale);
  const w = FIGURE_WIDTH * fs;
  const h = FIGURE_HEIGHT * fs;
  const px = (tile.x * TILE + TILE / 2) * scale - w / 2;
  const py = (WALL + (tile.y + 1) * TILE) * scale - h - 2 * scale;
  const distance = Math.abs(tile.x - from.x) + Math.abs(tile.y - from.y);

  // after a pause the next walk starts
  useEffect(() => {
    if (reduced || walking) return;
    const id = window.setTimeout(
      () => {
        const next = walkTile(tiles, tenant.name, step + 1);
        if (next) {
          setFrom(tile);
          if (next.x !== tile.x) setFacing(next.x < tile.x ? -1 : 1);
          setWalking(next.x !== tile.x || next.y !== tile.y);
        }
        setStep((s) => s + 1);
      },
      idleMs(tenant.name, step),
    );
    return () => window.clearTimeout(id);
  }, [reduced, walking, step, tiles, tenant.name, tile]);

  return (
    <motion.div
      className="absolute top-0 left-0"
      style={{ zIndex: 20 + tile.y }}
      initial={false}
      animate={{ x: px, y: py }}
      transition={{ duration: reduced ? 0 : Math.max(1, distance) * DURATION.slower, ease: "linear" }}
      onAnimationComplete={() => setWalking(false)}
      data-testid="tenant"
      data-name={tenant.name}
      data-ai={tenant.isAi ? "true" : "false"}
      data-walking={walking ? "true" : "false"}
    >
      <span
        className={cn(
          "absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 rounded-xs px-1 py-px text-2xs leading-tight whitespace-nowrap shadow-1",
          tenant.isAi ? "bg-surface-1/90 text-fg-2" : "bg-accent text-on-accent",
        )}
      >
        {tenant.isAi ? tenant.name : t("playerTag", { name: tenant.name })}
      </span>
      <motion.span
        className="block"
        animate={walking && !reduced ? { y: [0, -fs, 0] } : { y: 0 }}
        transition={
          walking && !reduced
            ? { duration: DURATION.slower, repeat: Infinity, ease: EASE.inOut }
            : { duration: DURATION.fast }
        }
      >
        <motion.span
          className="block"
          initial={false}
          animate={{ scaleX: facing }}
          transition={{ duration: reduced ? 0 : DURATION.fast }}
        >
          <PlayerFigure avatarKey={look.avatarKey} accessories={look.accessories} scale={fs} title={tenant.name} />
        </motion.span>
      </motion.span>
      <span
        aria-hidden
        className="absolute -bottom-0.5 left-1/2 h-1 w-2/3 -translate-x-1/2 rounded-pill bg-shade opacity-50"
      />
    </motion.div>
  );
}
