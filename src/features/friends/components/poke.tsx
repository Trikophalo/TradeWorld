"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, type ButtonState } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";

/** Poke a friend (ADR-155): returns the poke action, its button state and a counter that rises with every poke. */
export function usePoke(nickname: string) {
  const t = useTranslations("friends");
  const errorText = useGameErrorText();
  const [state, setState] = useState<ButtonState>("idle");
  const [pokes, setPokes] = useState(0);
  const poke = async () => {
    if (state !== "idle") return;
    setState("loading");
    try {
      const result = await engine.pokeFriend(crypto.randomUUID(), nickname);
      setPokes((n) => n + 1);
      setState("success");
      window.setTimeout(() => setState("idle"), 900);
      void playSound("poke");
      haptic("success");
      toast.success(t("pokeDone", { name: result.nickname }), t("pokeDoneText", { name: result.nickname }), {
        silent: true,
      });
    } catch (error) {
      setState("idle");
      toast.error(t("poke"), errorText(error));
    }
  };
  return { poke, state, pokes };
}

/** The poke button on a friend's profile (ADR-155). */
export function PokeButton({ nickname, className }: { nickname: string; className?: string }) {
  const t = useTranslations("friends");
  const { poke, state } = usePoke(nickname);
  return (
    <Button
      size="sm"
      variant="secondary"
      state={state}
      onClick={() => void poke()}
      aria-label={t("pokeLabel", { name: nickname })}
      className={cn(className)}
      data-testid="poke-button"
    >
      <span aria-hidden>👉</span> {t("poke")}
    </Button>
  );
}
