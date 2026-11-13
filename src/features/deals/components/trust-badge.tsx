"use client";

import { useTranslations } from "next-intl";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import type { TrustBand, TrustInfo } from "@/features/game/types";
import { cn } from "@/lib/utils";

/** Colour of each trust band, as a token. */
const TONE: Record<TrustBand, { color: string; text: string; soft: string }> = {
  risky: { color: "var(--loss)", text: "text-loss", soft: "bg-loss-soft" },
  shaky: { color: "var(--warn)", text: "text-warn", soft: "bg-warn-soft" },
  blank: { color: "var(--fg-3)", text: "text-fg-2", soft: "bg-surface-2" },
  reliable: { color: "var(--gain)", text: "text-gain", soft: "bg-gain-soft" },
  rock: { color: "var(--gold)", text: "text-gold", soft: "bg-gain-soft" },
};

const SHIELD_GRID = ["kkkkkkkk", "kbbhbbbk", "kbhbbbbk", "kbbbbbbk", ".kbbbbk.", "..kbbk..", "...kk..."];

export function TrustShield({ band, scale = 2 }: { band: TrustBand; scale?: number }) {
  return (
    <PixelIcon
      grid={SHIELD_GRID}
      palette={{ k: "var(--fg-1)", b: TONE[band].color, h: "var(--fg-inverse)" }}
      scale={scale}
    />
  );
}

/**
 * Trust of a player (ADR-098): a shield in the colour of the band, the score and the band's name. `size="lg"` adds
 * kept and broken deals.
 */
export function TrustBadge({
  trust,
  size = "sm",
  className,
}: {
  trust: Pick<TrustInfo, "score" | "band"> & Partial<Pick<TrustInfo, "kept" | "broken">>;
  size?: "sm" | "lg";
  className?: string;
}) {
  const t = useTranslations("trust");
  const tone = TONE[trust.band];
  if (size === "sm") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-xs font-medium",
          tone.soft,
          tone.text,
          className,
        )}
        title={`${t("label")}: ${t(`bands.${trust.band}`)}`}
        data-testid="trust-badge"
        data-band={trust.band}
      >
        <TrustShield band={trust.band} scale={1} />
        <span className="nums">{trust.score}</span>
        <span className="sr-only">{t(`bands.${trust.band}`)}</span>
      </span>
    );
  }
  return (
    <div className={cn("flex items-center gap-3", className)} data-testid="trust-badge" data-band={trust.band}>
      <span className={cn("grid size-14 shrink-0 place-items-center rounded-xs border-2 border-line-2", tone.soft)}>
        <TrustShield band={trust.band} scale={5} />
      </span>
      <div className="min-w-0">
        <p className="label-pixel text-fg-3">{t("label")}</p>
        <p className="text-lg font-semibold">
          <span className="nums text-fg-1">{trust.score}</span>{" "}
          <span className={tone.text}>{t(`bands.${trust.band}`)}</span>
        </p>
        {trust.kept !== null && trust.kept !== undefined && (
          <p className="nums text-xs text-fg-3">{t("record", { kept: trust.kept, broken: trust.broken ?? 0 })}</p>
        )}
      </div>
    </div>
  );
}
