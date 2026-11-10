"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { EffectsLayer } from "@/components/ui/effects";
import { Toaster } from "@/components/ui/toast";
import { useDemo } from "@/lib/demo/store";
import { isDemoMode } from "@/lib/supabase/env";
import { applySettingsToDocument, useSettings } from "@/stores/settings";

const DEMO_TICK_MS = 3000;

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
      }),
  );
  const motionMode = useSettings((state) => state.motion);

  // Load saved settings after hydration and keep <html> in sync with them.
  useEffect(() => {
    void useSettings.persist.rehydrate();
    return useSettings.subscribe((state) => applySettingsToDocument(state));
  }, []);

  // Demo mode: wiggle prices while the tab is visible.
  useEffect(() => {
    useDemo.getState().mount();
    if (!isDemoMode) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") useDemo.getState().tick();
    }, DEMO_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion={motionMode === "reduced" ? "always" : motionMode === "full" ? "never" : "user"}>
        {children}
        <Toaster />
        <EffectsLayer />
      </MotionConfig>
    </QueryClientProvider>
  );
}
