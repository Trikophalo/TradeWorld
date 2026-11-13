import { PixelIcon } from "@/components/pixel/pixel-icon";
import type { CoinRow } from "@/features/game/types";
import { logoArt } from "@/lib/sim/logo";
import { coinArt } from "../coin-art";

/** A coin's pixel logo: the creator's own logo for player coins, a shaded pixel coin for the others (ADR-101). */
export function CoinLogo({
  coin,
  scale = 2,
  className,
}: {
  coin: Pick<CoinRow, "color" | "category" | "logo" | "name">;
  scale?: 2 | 3 | 4;
  className?: string;
}) {
  const art = coin.logo ? logoArt(coin.logo) : coinArt(coin.color, coin.category);
  return <PixelIcon {...art} scale={scale} className={className} />;
}
