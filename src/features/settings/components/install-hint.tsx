"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { SPRING } from "@/lib/motion";

const KEY = "nexa-install-hint-dismissed";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Mode = "hidden" | "prompt" | "ios";

/**
 * On phones the game runs best as an installed app: no browser toolbars that swallow taps at the bottom. Android
 * offers the install dialog, iPhones get the two steps via "Teilen". Only in the mobile browser, once dismissible.
 */
export function InstallHint() {
  const t = useTranslations("install");
  const [mode, setMode] = useState<Mode>("hidden");
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const phone = window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 1024;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(KEY) === "1";
    } catch {
      // Without storage the hint simply shows again next time.
    }
    if (standalone || !phone || dismissed) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
      setMode("prompt");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // iOS has no install event; show the steps there right away.
    const timer = ios ? window.setTimeout(() => setMode("ios"), 0) : undefined;
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      // ignore
    }
    setMode("hidden");
  };

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") dismiss();
  };

  return (
    <AnimatePresence>
      {mode !== "hidden" && (
        <motion.aside
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={SPRING.smooth}
          className="flex items-start gap-3 rounded-xs border-2 border-accent/50 bg-accent-soft p-3 [box-shadow:0_4px_0_0_var(--accent-strong)]"
          data-testid="install-hint"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xs bg-surface-1 text-accent">
            <PixelIcon {...UI_ICONS.home} scale={2} />
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-semibold text-fg-1">{t("title")}</p>
            <p className="text-xs text-pretty text-fg-2">{mode === "ios" ? t("ios") : t("android")}</p>
            <div className="flex flex-wrap gap-2">
              {mode === "prompt" && (
                <Button size="sm" onClick={() => void install()}>
                  {t("install")}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={dismiss}>
                {t("later")}
              </Button>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
