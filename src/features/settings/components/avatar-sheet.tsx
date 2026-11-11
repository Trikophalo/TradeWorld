"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, type ButtonState } from "@/components/ui/button";
import { LockBadge } from "@/components/ui/lock-badge";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame, usePlayerLevel } from "@/features/game/store";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";

type AvatarName = Parameters<ReturnType<typeof useTranslations<"avatars.names">>>[0];

/** Gallery of pixel portraits; locked ones are visible with their level (ADR-054). */
export function AvatarSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("avatars");
  const errorText = useGameErrorText();
  const level = usePlayerLevel();
  const current = useGame((state) => state.portfolio?.avatarKey ?? BALANCE.avatars.defaultKey);
  const [picked, setPicked] = useState(current);
  const [state, setState] = useState<ButtonState>("idle");

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPicked(current);
      setState("idle");
    }
  }

  const save = async () => {
    setState("loading");
    try {
      await engine.setAvatar(crypto.randomUUID(), picked);
      await useGame.getState().refreshPortfolio();
      setState("success");
      void playSound("success");
      haptic("success");
      toast.success(t("saved"), undefined, { silent: true });
      window.setTimeout(() => onOpenChange(false), 500);
    } catch (error) {
      setState("idle");
      toast.error(t("title"), errorText(error));
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("pick")}
      description={t("intro")}
      footer={
        <Button block size="lg" state={state} disabled={picked === current} onClick={() => void save()}>
          {t("change")}
        </Button>
      }
    >
      <div role="radiogroup" aria-label={t("pick")} className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {BALANCE.avatars.portraits.map((portrait) => {
          const locked = level < portrait.level;
          const selected = picked === portrait.key;
          const name = t(`names.${portrait.key as AvatarName}`);
          return (
            <button
              key={portrait.key}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={locked ? `${name}, ${t("unlockAt", { level: portrait.level })}` : name}
              disabled={locked}
              onClick={() => {
                setPicked(portrait.key);
                void playSound("tap");
                haptic("tap");
              }}
              className={cn(
                "group relative flex flex-col items-center gap-1.5 rounded-md p-2 focus-ring",
                "transition duration-fast ease-standard",
                selected ? "bg-accent-soft ring-2 ring-accent" : "hover:bg-surface-2",
                locked && "cursor-not-allowed",
              )}
            >
              <motion.span
                animate={{ scale: selected ? 1.06 : 1 }}
                transition={SPRING.snappy}
                className={cn("relative", locked && "opacity-35 grayscale")}
              >
                <Avatar avatarKey={portrait.key} size="md" />
              </motion.span>
              <span className={cn("max-w-full truncate text-xs", selected ? "text-fg-1" : "text-fg-2")}>{name}</span>
              {locked && <LockBadge level={portrait.level} className="absolute top-1 right-1" />}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
