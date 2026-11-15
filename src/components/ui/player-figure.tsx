"use client";

import { useMemo } from "react";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { dressedFigure } from "@/components/pixel/player-figure";

export interface PlayerFigureProps {
  avatarKey: string | null | undefined;
  /** Worn accessory keys; order does not matter (one per slot, drawn back to front). */
  accessories?: readonly string[];
  /** Whole-number scale of the 24×32 figure. */
  scale?: number;
  title?: string;
  className?: string;
}

/** A player's full-body pixel figure wearing their accessories (ADR-154). */
export function PlayerFigure({ avatarKey, accessories, scale = 4, title, className }: PlayerFigureProps) {
  const key = accessories?.join(",") ?? "";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the joined keys stand for the array
  const art = useMemo(() => dressedFigure(avatarKey, accessories ?? []), [avatarKey, key]);
  return <PixelIcon {...art} scale={scale} title={title} className={className} />;
}
