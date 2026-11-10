import { useSettings } from "@/stores/settings";

const PATTERNS = {
  tap: [8],
  success: [12, 40, 18],
  warning: [30, 60, 30],
  error: [40, 40, 40, 40, 60],
} satisfies Record<string, number[]>;

export type HapticPattern = keyof typeof PATTERNS;

/** Vibrate where the platform supports it and the player has not opted out. */
export function haptic(pattern: HapticPattern = "tap"): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  if (!useSettings.getState().haptics) return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Some browsers throw when the page has not been interacted with yet.
  }
}
