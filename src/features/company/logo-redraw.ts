import type { LogoRedrawInfo } from "@/features/game/types";

export const logoRedrawKey = (companyId: string) => ["company", "logo-redraw", companyId] as const;

/** Why the "Logo neu zeichnen" button is off (ADR-200), or null when it can be used. */
export function logoRedrawBlock(
  info: LogoRedrawInfo,
  freeCashCents: number,
  now: number | null,
): "cooldown" | "cash" | null {
  if (info.availableAt !== null && (now === null || Date.parse(info.availableAt) > now)) return "cooldown";
  if (freeCashCents < info.costCents) return "cash";
  return null;
}
