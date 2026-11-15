"use client";

import { useMemo } from "react";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { TILE } from "@/config/furniture";
import type { Property, Tenant } from "@/features/game/types";
import { logoArt } from "@/lib/sim/logo";
import { drawOrder, furnitureItem, furnitureSprite, roomBackdrop, WALL } from "../room";
import { TenantLayer } from "./tenant-layer";

/** A home as it is furnished, drawn from above at a whole pixel scale (ADR-082), with its tenants (ADR-158). */
export function RoomView({
  property,
  scale,
  tenants = [],
}: {
  property: Property;
  scale: number;
  tenants?: readonly Tenant[];
}) {
  const backdrop = useMemo(
    () => roomBackdrop(property.width, property.height, property.floor, property.wallColor),
    [property.width, property.height, property.floor, property.wallColor],
  );
  const ordered = drawOrder(property.placed, (p) => furnitureItem(p.itemKey)?.layer);
  return (
    <div
      className="relative isolate mx-auto w-fit overflow-hidden rounded-md shadow-2 ring-1 ring-line-2"
      data-testid="room"
    >
      <PixelIcon {...logoArt(backdrop)} scale={scale} />
      {ordered.map((p) => {
        const sprite = furnitureSprite(p.itemKey, p.rot);
        if (!sprite) return null;
        return (
          <span key={p.id} className="absolute" style={{ left: p.x * TILE * scale, top: (WALL + p.y * TILE) * scale }}>
            <PixelIcon {...logoArt(sprite)} scale={scale} title={furnitureItem(p.itemKey)?.name} />
          </span>
        );
      })}
      <TenantLayer property={property} tenants={tenants} scale={scale} />
    </div>
  );
}
