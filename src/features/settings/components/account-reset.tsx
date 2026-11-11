"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import { useTutorial } from "@/features/tutorial/store";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/supabase/env";
import { playSound } from "@/lib/sound";

type Mode = "reset" | "delete";

/** Start over or delete the account (ADR-070). Both ask for the player name and a long press. */
export function AccountReset() {
  const t = useTranslations("account");
  const [mode, setMode] = useState<Mode | null>(null);
  return (
    <Card padding="lg" data-testid="account-reset">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <p className="text-sm text-pretty text-fg-3">{t("intro")}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => setMode("reset")}>
          {t("reset")}
        </Button>
        {!isDemoMode && (
          <Button variant="danger" onClick={() => setMode("delete")}>
            {t("delete")}
          </Button>
        )}
      </div>
      <ConfirmSheet mode={mode} onClose={() => setMode(null)} />
    </Card>
  );
}

function ConfirmSheet({ mode, onClose }: { mode: Mode | null; onClose: () => void }) {
  const t = useTranslations("account");
  const errorText = useGameErrorText();
  const router = useRouter();
  const client = useQueryClient();
  const nickname = useGame((state) => state.portfolio?.nickname ?? "");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(mode);
  if (mode !== shown) {
    setShown(mode);
    setTyped("");
    setBusy(false);
  }
  const matches = nickname.length > 0 && typed.trim().toLowerCase() === nickname.toLowerCase();

  const confirm = async () => {
    if (!mode) return;
    setBusy(true);
    try {
      if (mode === "reset") await engine.resetAccount(crypto.randomUUID(), typed);
      else await engine.deleteAccount(typed);
      // Forget everything kept in memory about the old player; Finn starts again.
      useTutorial.getState().forget();
      const game = useGame.getState();
      game.resetPlayer();
      client.clear();
      if (mode === "reset") void Promise.all([game.refreshPortfolio(), game.refreshMissions()]);
      void playSound("success");
      onClose();
      if (mode === "delete") {
        await getSupabaseBrowserClient()?.auth.signOut();
        toast.info(t("deleted"));
        router.replace("/login");
      } else {
        toast.success(t("resetDone"), undefined, { silent: true });
        router.replace("/");
      }
    } catch (error) {
      setBusy(false);
      toast.error(mode === "reset" ? t("reset") : t("delete"), errorText(error));
    }
  };

  return (
    <Sheet
      open={mode !== null}
      onOpenChange={(open) => !open && onClose()}
      title={shown === "delete" ? t("deleteTitle") : t("resetTitle")}
      footer={
        <HoldButton tone="loss" onConfirm={() => void confirm()} disabled={!matches || busy} className="w-full">
          {shown === "delete" ? t("deleteConfirm") : t("resetConfirm")}
        </HoldButton>
      }
    >
      <div className="space-y-4">
        <p className="text-pretty text-fg-2">{shown === "delete" ? t("deleteText") : t("resetText")}</p>
        <ul className="list-disc space-y-1 pl-4 text-sm text-fg-3">
          <li>{t("lostMoney")}</li>
          <li>{t("lostCareer")}</li>
          <li>{t("lostCompany")}</li>
          <li>{shown === "delete" ? t("lostName") : t("keptName")}</li>
        </ul>
        <Field
          label={t("typeName", { name: nickname })}
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>
    </Sheet>
  );
}
