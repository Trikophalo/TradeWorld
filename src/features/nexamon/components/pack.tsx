"use client";

import { useTranslations } from "next-intl";
import { memo } from "react";
import type { NexamonSetKey } from "@/config/nexamon";
import { composePack, PACK_SIZE } from "@/components/pixel/nexamon-pack";
import { cn } from "@/lib/utils";
import { pixelScale } from "../lib";
import { PixelCanvas } from "./pixel-canvas";
import "./nexamon.css";

/** The band of light that runs over the foil of a pack every few seconds. */
export function PackSheen({ scale }: { scale: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute overflow-hidden"
      style={{ inset: scale, mixBlendMode: "overlay" }}
    >
      <div className="nexamon-pack-sheen nexamon-sheen-bar absolute inset-y-0 left-0 w-1/5 opacity-90" />
      <div className="nexamon-pack-sheen nexamon-sheen-bar absolute inset-y-0 left-0 w-1/6 opacity-60 [animation-delay:0.5s]" />
    </div>
  );
}

export interface NexamonPackProps {
  set: NexamonSetKey;
  /** CSS pixels per art pixel. A pack is 76 x 112 art pixels. */
  scale?: number;
  /** The moving band of light on the foil. */
  sheen?: boolean;
  className?: string;
}

/** A sealed booster pack of a set, as pixel art with a foil sheen. */
export const NexamonPack = memo(function NexamonPack({ set, scale = 3, sheen = true, className }: NexamonPackProps) {
  const t = useTranslations("nexamonCards");
  const u = pixelScale(scale);
  return (
    <div
      role="img"
      aria-label={t("pack.label", { set: t(`sets.${set}`) })}
      data-set={set}
      className={cn("relative isolate shrink-0 select-none", className)}
      style={{ width: PACK_SIZE.width * u, height: PACK_SIZE.height * u }}
    >
      <PixelCanvas raster={composePack(set).full} scale={u} />
      {sheen && <PackSheen scale={u} />}
    </div>
  );
});
