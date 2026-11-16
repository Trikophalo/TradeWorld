"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { useGame } from "@/features/game/store";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";

const SUCCESS_MS = 500;

/**
 * "Missionen neu würfeln" (ADR-166): once per real day the open quick, daily and weekly missions can be swapped
 * for new ones. Finished missions and the story stay. Asks before it throws progress away.
 */
export function MissionReset() {
  const t = useTranslations("missions.reset");
  const errorText = useGameErrorText();
  const reset = useGame((state) => state.missionReset);
  const groups = useGame((state) => state.missions);
  const resetMissions = useGame((state) => state.resetMissions);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ButtonState>("idle");

  // Not loaded yet, or a server that does not know the reset.
  if (!reset || !groups || (!reset.available && !reset.nextAt)) return null;

  const swappable = groups.some((g) => g.kind !== "milestone" && g.missions.some((m) => m.status === "active"));

  const onConfirm = async () => {
    setState("loading");
    try {
      await resetMissions();
      setState("success");
      haptic("success");
      void playSound("success");
      toast.success(t("doneTitle"), t("doneText"), { silent: true });
      // the check mark shows for a moment, then the sheet closes
      window.setTimeout(() => {
        setOpen(false);
        setState("idle");
      }, SUCCESS_MS);
    } catch (error) {
      setState("idle");
      toast.error(t("failed"), errorText(error));
    }
  };

  return (
    <Card padding="lg" className="mb-5 lg:mb-6" data-testid="missions-reset">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-fg-1">{t("title")}</p>
          <p className="mt-1 text-sm text-pretty text-fg-3" data-testid="missions-reset-hint">
            {reset.available ? (
              swappable ? (
                t("hint")
              ) : (
                t("nothing")
              )
            ) : (
              <>
                {t("used")} <Countdown target={Date.parse(reset.nextAt!)} className="text-fg-2" />
              </>
            )}
          </p>
        </div>
        <Button
          variant="secondary"
          className="shrink-0"
          disabled={!reset.available || !swappable}
          onClick={() => {
            void playSound("tap");
            setOpen(true);
          }}
          data-testid="missions-reset-button"
        >
          {t("button")}
        </Button>
      </div>
      <Sheet open={open} onOpenChange={(next) => state === "idle" && setOpen(next)} title={t("confirmTitle")}>
        <div className="space-y-4">
          <p className="text-sm text-pretty text-fg-2">{t("confirmText")}</p>
          <p className="text-sm text-pretty text-fg-3">{t("confirmKeep")}</p>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button block state={state} onClick={() => void onConfirm()} data-testid="missions-reset-confirm">
              {t("confirm")}
            </Button>
            <Button block variant="ghost" disabled={state !== "idle"} onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      </Sheet>
    </Card>
  );
}
