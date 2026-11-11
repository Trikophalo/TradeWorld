"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, type ButtonState } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import { GameError, type GameErrorKey } from "@/features/game/types";
import { useClock } from "@/lib/use-now";

const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" });

/**
 * Change the player name. Allowed once every 60 days; the name is checked
 * while typing (the server checks again when saving).
 */
export function NicknameSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("nickname");
  const te = useTranslations("errors");
  const errorText = useGameErrorText();
  const current = useGame((state) => state.portfolio?.nickname ?? "");
  const availableAt = useGame((state) => state.portfolio?.nicknameChangeAvailableAt ?? null);
  const change = useGame((state) => state.changeNickname);
  const [name, setName] = useState("");
  const [check, setCheck] = useState<{ name: string; reason: GameErrorKey | null } | null>(null);
  const [state, setState] = useState<ButtonState>("idle");
  const now = useClock();
  const locked = availableAt !== null && now !== null && Date.parse(availableAt) > now;

  // Fresh form every time the sheet opens (state adjusted during render, no effect needed).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(current);
      setCheck(null);
      setState("idle");
    }
  }

  // Debounced pre-check while typing.
  useEffect(() => {
    const value = name.trim();
    if (!value || value === current) return;
    const timer = window.setTimeout(() => {
      void engine
        .checkNickname(value)
        .then((result) =>
          setCheck({ name: value, reason: result.allowed ? null : (result.reason ?? "name_profanity") }),
        )
        .catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [name, current]);

  const value = name.trim();
  const reason = check?.name === value ? check.reason : null;
  const canSave = !locked && value !== current && value.length > 0 && check?.name === value && reason === null;

  const save = async () => {
    setState("loading");
    try {
      await change(value);
      setState("success");
      toast.success(t("saved"), t("savedText", { name: value }));
      window.setTimeout(() => onOpenChange(false), 600);
    } catch (error) {
      setState("idle");
      toast.error(t("failed"), errorText(error));
      if (error instanceof GameError) setCheck({ name: value, reason: error.key });
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description", { days: BALANCE.names.nicknameChangeDays })}
      footer={
        <Button block size="lg" state={state} disabled={!canSave} onClick={() => void save()}>
          {t("save")}
        </Button>
      }
    >
      {locked ? (
        <p className="rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">
          {t("locked", { date: date.format(new Date(availableAt!)) })}
        </p>
      ) : (
        <Field
          label={t("label")}
          value={name}
          maxLength={BALANCE.names.maxLength}
          autoComplete="off"
          autoCapitalize="none"
          onChange={(event) => setName(event.target.value)}
          error={reason ? te(reason as Parameters<typeof te>[0]) : undefined}
          hint={check?.name === value && reason === null && value !== current ? t("free") : t("hint")}
        />
      )}
    </Sheet>
  );
}
