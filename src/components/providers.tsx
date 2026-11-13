"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { NextIntlClientProvider, useLocale, useMessages, useTimeZone } from "next-intl";
import { Fragment, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { EffectsLayer } from "@/components/ui/effects";
import { Toaster } from "@/components/ui/toast";
import { SessionWatcher } from "@/features/auth/components/session-watcher";
import { localizeMoneyDeep, setDisplayCurrency } from "@/lib/format";
import { preloadSounds } from "@/lib/sound";
import { applySettingsToDocument, useSettings } from "@/stores/settings";

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
    const stop = useSettings.subscribe((state) => applySettingsToDocument(state));
    void useSettings.persist.rehydrate();
    return stop;
  }, []);

  // Load the sound effects after the first tap, so the first play has no delay.
  useEffect(() => preloadSounds(), []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionWatcher />
      <MotionConfig reducedMotion={motionMode === "reduced" ? "always" : motionMode === "full" ? "never" : "user"}>
        <CurrencyBoundary>{children}</CurrencyBoundary>
        <Toaster />
        <EffectsLayer />
      </MotionConfig>
    </QueryClientProvider>
  );
}

let scrollBeforeSwitch: { shell: number; page: number } | null = null;

/** Call right before changing the display currency: the rebuilt page is scrolled back to where it was. */
export function keepScrollOnCurrencySwitch(): void {
  scrollBeforeSwitch = {
    shell: document.querySelector("[data-scroll-root]")?.scrollTop ?? 0,
    page: window.scrollY,
  };
}

/**
 * The chosen display currency (ADR-113). Server and first client render use the default; once the saved settings are
 * loaded, amounts, message texts and everything below are drawn again with the chosen sign.
 */
function CurrencyBoundary({ children }: { children: ReactNode }) {
  const currency = useSettings((state) => state.currency);
  const locale = useLocale();
  const timeZone = useTimeZone();
  const messages = useMessages();
  // The formatters read the sign while the children render, so it is set before them.
  setDisplayCurrency(currency);
  const localized = useMemo(() => {
    setDisplayCurrency(currency);
    return localizeMoneyDeep(messages);
  }, [messages, currency]);
  // Everything below is built again when the currency changes; the page stays where the player was.
  useLayoutEffect(() => {
    const at = scrollBeforeSwitch;
    if (!at) return;
    scrollBeforeSwitch = null;
    const restore = () => {
      document.querySelector("[data-scroll-root]")?.scrollTo(0, at.shell);
      window.scrollTo(0, at.page);
    };
    restore();
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [currency]);
  return (
    <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={localized}>
      <Fragment key={currency}>{children}</Fragment>
    </NextIntlClientProvider>
  );
}
