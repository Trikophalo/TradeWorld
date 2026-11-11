"use client";

import { COMPANY_LOGOS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { useGame } from "@/features/game/store";
import { logoArt, type CompanyLogoData } from "@/lib/sim/logo";
import { cn } from "@/lib/utils";

export interface CompanyLogoProps {
  ticker: string;
  /** Brand colour for companies without drawn pixel art yet. */
  color: string;
  /** Pixel scale: 2 = 32px, 3 = 48px, 4 = 64px. */
  scale?: 2 | 3 | 4;
  className?: string;
  /** Pixel logo of a player company (ADR-065); replaces the colour tile. */
  logo?: CompanyLogoData | null;
}

const TEXT_SIZE = { 2: "text-2xs", 3: "text-sm", 4: "text-lg" } as const;

/**
 * 16×16 pixel logo. Companies without art get a tile in their brand colour
 * with the ticker, until every logo is drawn (player companies: logo editor, M4).
 */
export function CompanyLogo({ ticker, color, scale = 2, className, logo }: CompanyLogoProps) {
  // Listed player companies carry their logo in the market snapshot.
  const listed = useGame((state) => state.byTicker[ticker]?.logo ?? null);
  const pixels = logo ?? listed;
  if (pixels) return <PixelIcon {...logoArt(pixels)} scale={scale} className={className} />;
  const art = COMPANY_LOGOS[ticker as keyof typeof COMPANY_LOGOS];
  const size = 16 * scale;
  if (art) return <PixelIcon {...art} scale={scale} className={className} />;
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, backgroundColor: color }}
      className={cn(
        "grid shrink-0 place-items-center font-pixel font-bold text-on-accent",
        TEXT_SIZE[scale],
        className,
      )}
    >
      {ticker.slice(0, scale === 2 ? 2 : 3)}
    </span>
  );
}
