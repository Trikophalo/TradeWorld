import { PixelIcon } from "@/components/pixel/pixel-icon";
import type { Artwork } from "@/features/game/types";
import { logoArt } from "@/lib/sim/logo";
import { cn } from "@/lib/utils";

const FRAMES = {
  legendary: "bg-gold/25 ring-2 ring-gold shadow-[0_0_24px_-6px_var(--gold)]",
  rare: "bg-fg-2/15 ring-2 ring-fg-2",
  common: "bg-surface-3 ring-1 ring-line-2",
  player: "bg-accent-soft ring-1 ring-accent/60",
} as const;

/** An artwork in its frame: gold for legendary, silver for rare, accent for players' works (ADR-080). */
export function ArtworkImage({
  artwork,
  scale,
  className,
}: {
  artwork: Pick<Artwork, "pixels" | "rarity" | "origin" | "title">;
  scale: number;
  className?: string;
}) {
  const frame = artwork.origin === "player" ? "player" : (artwork.rarity ?? "common");
  return (
    <span className={cn("inline-block rounded-sm p-1.5", FRAMES[frame], className)}>
      <PixelIcon {...logoArt(artwork.pixels)} scale={scale} title={artwork.title} />
    </span>
  );
}
