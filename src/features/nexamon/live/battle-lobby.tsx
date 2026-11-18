"use client";

import { motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Countdown } from "@/components/ui/countdown";
import { PlayerFigure } from "@/components/ui/player-figure";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import type { NexamonBattle } from "@/features/game/pack-battle-types";
import { engine, useGame } from "@/features/game/store";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { NexamonPack } from "../components/pack";
import { useNexamonRefresh } from "../hooks";
import { useLobbyRefresh } from "./hooks";

/** Runs a battle action with button state and an error toast. */
export function useBattleAction() {
  const errorText = useGameErrorText();
  const refreshLobby = useLobbyRefresh();
  const refreshCards = useNexamonRefresh();
  const [state, setState] = useState<ButtonState>("idle");
  const run = async (action: (requestId: string) => Promise<NexamonBattle>, errorTitle: string) => {
    setState("loading");
    try {
      const battle = await action(crypto.randomUUID());
      setState("success");
      haptic("success");
      window.setTimeout(() => setState("idle"), 900);
      return battle;
    } catch (error) {
      setState("idle");
      toast.error(errorTitle, errorText(error));
      return null;
    } finally {
      void refreshLobby();
      void refreshCards();
    }
  };
  return { state, run };
}

/** ADR-205: the modes of a battle as badges ("Twist", "Umgekehrt"); nothing for the classic mode. */
export function BattleModeBadges({
  reverse,
  twist,
  className,
}: {
  reverse?: boolean;
  twist?: boolean;
  className?: string;
}) {
  const t = useTranslations("nexamonLive.modes");
  if (!reverse && !twist) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)} data-testid="battle-modes">
      {twist && (
        <Badge tone="accent" data-testid="battle-mode-twist">
          {t("twist")}
        </Badge>
      )}
      {reverse && (
        <Badge tone="warn" data-testid="battle-mode-reverse">
          {t("reverse")}
        </Badge>
      )}
    </span>
  );
}

/** The lineup of a battle as small packs in order. */
export function LineupStrip({ battle: b, className }: { battle: NexamonBattle; className?: string }) {
  const t = useTranslations("nexamonLive");
  return (
    <ol className={cn("flex flex-wrap items-end gap-1", className)} aria-label={t("lobbyView.lineup")}>
      {b.packs.map((p, i) => (
        <li key={i} className="flex flex-col items-center" title={t(`sets.${p.set}`)}>
          <NexamonPack set={p.set} scale={1} sheen={false} />
          <span className="nums text-2xs text-fg-3">{i + 1}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * An open Pack Battle lobby (ADR-192): up to four seats, the lineup and the stake. Friends of the creator take a
 * seat (and pay the stake into escrow); the creator can cancel until it is full, everyone gets the stake back.
 */
export function BattleLobby({ battle: b, onClose }: { battle: NexamonBattle; onClose: () => void }) {
  const t = useTranslations("nexamonLive");
  const reduced = useReducedMotionConfig();
  const cash = useGame((s) => s.portfolio?.cashCents ?? 0);
  const join = useBattleAction();
  const cancel = useBattleAction();
  const seated = b.mySeat !== null;
  const creator = b.mySeat === 0;
  const short = !seated && cash < b.priceCents;
  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-4 p-4 lg:p-6" data-testid="battle-lobby">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-2">
          {t("lobbyView.waiting", { taken: b.seats.length, size: b.size })}{" "}
          <Countdown target={Date.parse(b.expiresAt)} className="text-xs text-fg-3" />
        </p>
        <span className="flex flex-wrap items-center gap-1">
          <BattleModeBadges reverse={b.reverse} twist={b.twist} />
          <Badge tone="accent" className="nums">
            {t("lobbyView.stake", { price: formatMoney(b.priceCents, { whole: true }) })}
          </Badge>
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label={t("lobbyView.seats")}>
        {Array.from({ length: b.size }, (_, i) => {
          const seat = b.seats.find((s) => s.seat === i);
          return (
            <motion.li
              key={i}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DURATION.slow, ease: EASE.out, delay: i * 0.05 }}
              className={cn(
                "flex min-h-32 flex-col items-center justify-center gap-1 rounded-lg border-2 p-3 text-center",
                seat
                  ? seat.isMe
                    ? "border-accent bg-accent-soft"
                    : "border-line-2 bg-surface-1"
                  : "border-dashed border-line-1 bg-surface-2",
              )}
              data-testid="lobby-seat"
              data-taken={seat ? "true" : "false"}
            >
              {seat ? (
                <>
                  <PlayerFigure avatarKey={seat.player.avatarKey} accessories={seat.player.accessories} scale={2} />
                  <span className="w-full truncate text-sm font-semibold text-fg-1">
                    {seat.player.nickname}
                    {seat.isMe && <span className="ml-1 text-xs text-fg-3">{t("you")}</span>}
                  </span>
                  {seat.seat === 0 && <Badge tone="neutral">{t("lobbyView.host")}</Badge>}
                </>
              ) : (
                <span className="text-xs text-fg-3">{t("lobbyView.free")}</span>
              )}
            </motion.li>
          );
        })}
      </ul>
      <section className="space-y-2">
        <h3 className="label-pixel text-fg-3">{t("lobbyView.lineup")}</h3>
        <LineupStrip battle={b} />
        <p className="text-xs text-pretty text-fg-3">{t("lobbyView.rules")}</p>
        {(b.twist || b.reverse) && (
          <p className="text-xs text-pretty text-fg-2" data-testid="lobby-mode-rules">
            {[b.twist && t("modes.twistText"), b.reverse && t("modes.reverseText")].filter(Boolean).join(" ")}
          </p>
        )}
      </section>
      <div className="mt-auto flex flex-col gap-2 sm:flex-row sm:justify-end">
        {!seated && (
          <Button
            variant="gain"
            state={join.state}
            disabled={short}
            data-testid="lobby-join"
            onClick={() => void join.run((id) => engine.joinNexamonPackBattle(id, b.id), t("lobbyView.joinError"))}
          >
            {t("lobbyView.join", { price: formatMoney(b.priceCents, { whole: true }) })}
          </Button>
        )}
        {short && <p className="text-xs text-warn">{t("challenge.short")}</p>}
        {creator && (
          <Button
            variant="danger"
            state={cancel.state}
            data-testid="lobby-cancel"
            onClick={() => void cancel.run((id) => engine.cancelNexamonBattle(id, b.id), t("pending.error"))}
          >
            {t("lobbyView.cancel")}
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
    </div>
  );
}
