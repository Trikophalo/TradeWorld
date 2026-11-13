"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_CURRENCY, SETTINGS_STORAGE_KEY, type CurrencyKey } from "@/config/app";

export const THEMES = ["dark", "light"] as const;
export const ACCENTS = ["violet", "blue", "pink", "orange", "cyan"] as const;
export const MOTION_MODES = ["system", "full", "reduced"] as const;
export const CHART_STYLES = ["candles", "line", "area"] as const;

export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];
export type MotionMode = (typeof MOTION_MODES)[number];
export type ChartStyle = (typeof CHART_STYLES)[number];

export interface SettingsState {
  theme: Theme;
  accent: Accent;
  motion: MotionMode;
  sound: boolean;
  haptics: boolean;
  chartStyle: ChartStyle;
  /** Sign shown behind amounts (ADR-113); display only. */
  currency: CurrencyKey;
  set: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void;
}

type SettingsValues = Omit<SettingsState, "set">;

export const DEFAULT_SETTINGS: SettingsValues = {
  theme: "dark",
  accent: "violet",
  motion: "system",
  sound: true,
  haptics: true,
  chartStyle: "area",
  currency: DEFAULT_CURRENCY,
};

/**
 * UI preferences, kept in localStorage. Hydration is started manually in
 * <Providers> so that server and first client render agree.
 * The same storage key is read by the inline script in the root layout,
 * which applies theme and accent before the first paint.
 */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
    }),
    { name: SETTINGS_STORAGE_KEY, version: 1, skipHydration: true },
  ),
);

/** Reflect settings on <html> so that CSS tokens react to them. */
export function applySettingsToDocument(state: SettingsValues): void {
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  if (state.accent === "violet") delete root.dataset.accent;
  else root.dataset.accent = state.accent;
  if (state.motion === "system") delete root.dataset.motion;
  else root.dataset.motion = state.motion;
}

/** True when animations should be skipped (setting or system preference). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  const mode = useSettings.getState().motion;
  if (mode === "reduced") return true;
  if (mode === "full") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
