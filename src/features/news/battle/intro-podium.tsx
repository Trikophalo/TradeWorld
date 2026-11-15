"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { burstConfetti } from "@/components/ui/effects";
import { PlayerFigure } from "@/components/ui/player-figure";
import { BATTLE_RULES, isTickKind, type BattleKind } from "@/config/battles";
import type { Battle } from "@/features/game/battle-types";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING, STAGGER } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { DoodleSays, GameIcon, PopNumber, PrizeView, fill } from "./parts";

/*
 * The dramatic start of a battle (ADR-160): the game's card with its rules and controls, Mr. Doodle Dangle's line,
 * then 3-2-1-LOS! And the end: the podium with confetti, the fanfare and the prize.
 */

export function IntroCard({ battle, msToStart }: { battle: Battle; msToStart: number }) {
  const t = useTranslations("battle");
  const kind = battle.kind as BattleKind;
  const count = Math.ceil(msToStart / 1000);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (count === last.current) return;
    last.current = count;
    if (count >= 1 && count <= 3) {
      void playSound("battleCountdown");
      haptic("tap");
    }
    if (count <= 0) void playSound("battleGo");
  }, [count]);
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const controls = isTickKind(kind)
    ? kind === "pump"
      ? t("controls.tapKeys")
      : touch
        ? t("controls.touch")
        : `${t("controls.keys")}${kind === "sumo" ? ` · ${t("controls.action")}` : ""}`
    : kind === "quiz"
      ? t("controls.clickAnswer")
      : kind === "estimate"
        ? t("controls.typeNumber")
        : t("controls.bellKey");
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: DURATION.slow } }}
      className="absolute inset-0 z-10 grid place-items-center bg-scrim/80 p-4 backdrop-blur-sm"
      data-testid="battle-intro"
    >
      <AnimatePresence mode="wait">
        {count > 3 ? (
          <motion.div
            key="card"
            initial={{ scale: 0.7, opacity: 0, rotate: -3 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 1.2, opacity: 0 }}
            transition={{ ...SPRING.bouncy }}
            className="w-full max-w-md space-y-4 rounded-xl border-2 border-gold bg-surface-1 p-5 text-center shadow-3"
          >
            <p className="label-pixel text-gold">{t("intro.battle", { id: battle.id })}</p>
            <motion.div
              className="mx-auto w-fit"
              initial={{ y: -20 }}
              animate={{ y: 0 }}
              transition={{ ...SPRING.bouncy, delay: 0.15 }}
            >
              <GameIcon kind={kind} scale={6} />
            </motion.div>
            <h2 className="font-pixel text-2xl text-fg-1 lg:text-3xl" data-testid="battle-intro-title">
              {t(`games.${kind}.name`)}!
            </h2>
            <p className="text-sm font-semibold text-accent">{t(`games.${kind}.tagline`)}</p>
            <p className="text-sm text-pretty text-fg-2">{t(`games.${kind}.rules`)}</p>
            <p className="rounded-sm bg-surface-2 px-2 py-1.5 text-xs text-fg-2">{controls}</p>
            <DoodleSays text={BATTLE_RULES.doodle.intro[kind]} mood="laughing" compact className="text-left" />
          </motion.div>
        ) : (
          <motion.div key="count" className="grid place-items-center">
            <AnimatePresence mode="popLayout">
              <PopNumber
                value={count > 0 ? String(count) : t("intro.go")}
                className={cn("text-[7rem] leading-none drop-shadow", count > 0 ? "text-fg-1" : "text-gain")}
              />
            </AnimatePresence>
            <p className="mt-2 font-pixel text-lg text-fg-2">{t(`games.${kind}.name`)}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const PODIUM = [
  { place: 2, height: "h-16", tone: "bg-surface-3", order: "order-1" },
  { place: 1, height: "h-24", tone: "bg-gold", order: "order-2" },
  { place: 3, height: "h-12", tone: "bg-warn-soft", order: "order-3" },
];

export function Podium({ battle, onClose }: { battle: Battle; onClose: () => void }) {
  const t = useTranslations("battle");
  const stage = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const result = battle.result;
  const ranked = (result?.ranking ?? [])
    .map((slot) => battle.players.find((p) => p.slot === slot))
    .filter((p) => p !== undefined);
  const winner = ranked[0];
  const me = battle.players.find((p) => p.me);
  const iWon = !!winner?.me;
  const line = fill(BATTLE_RULES.doodle.win[battle.id % BATTLE_RULES.doodle.win.length]!, {
    name: winner?.nickname ?? "?",
  });

  useEffect(() => {
    void playSound("battleFanfare");
    if (iWon) haptic("success");
    const confetti = window.setTimeout(() => {
      if (stage.current) burstConfetti(stage.current, iWon ? 60 : 30);
    }, 350);
    const prize = window.setTimeout(() => {
      setRevealed(true);
      void playSound(iWon ? "win" : "success");
    }, 1100);
    return () => {
      window.clearTimeout(confetti);
      window.clearTimeout(prize);
    };
  }, [iWon]);

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-5 py-4" data-testid="battle-podium">
      <motion.h2
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...SPRING.bouncy }}
        className={cn("text-center font-pixel text-3xl lg:text-4xl", iWon ? "text-gold" : "text-fg-1")}
        data-testid="battle-winner"
      >
        {iWon ? t("podium.youWon") : t("podium.winner", { name: winner?.nickname ?? "?" })}
      </motion.h2>
      <div ref={stage} className="flex items-end justify-center gap-2 sm:gap-4">
        {PODIUM.map(({ place, height, tone, order }) => {
          const p = ranked[place - 1];
          if (!p) return <span key={place} className={cn("w-20", order)} />;
          return (
            <motion.div
              key={place}
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ ...SPRING.smooth, delay: (3 - place) * STAGGER * 4 }}
              className={cn("flex w-20 flex-col items-center sm:w-28", order)}
            >
              <motion.div
                animate={place === 1 ? { y: [0, -8, 0] } : undefined}
                transition={place === 1 ? { duration: 0.9, repeat: Infinity, ease: EASE.inOut } : undefined}
              >
                <PlayerFigure avatarKey={p.avatarKey} accessories={p.accessories} scale={place === 1 ? 4 : 3} />
              </motion.div>
              <span
                className={cn("mt-1 max-w-full truncate text-xs", p.me ? "font-semibold text-accent" : "text-fg-2")}
              >
                {p.me ? t("you") : p.nickname}
              </span>
              <div className={cn("mt-1 grid w-full place-items-center rounded-t-sm", height, tone)}>
                <span className={cn("font-pixel text-2xl", place === 1 ? "text-fg-inverse" : "text-fg-1")}>
                  {place}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
      {ranked.length > 3 && (
        <ol className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-fg-3">
          {ranked.slice(3).map((p, i) => (
            <li key={p.slot} className={cn(p.me && "font-semibold text-accent")}>
              {t("podium.place", { place: i + 4 })} {p.me ? t("you") : p.nickname}
            </li>
          ))}
        </ol>
      )}
      {me && !iWon && me.rank && (
        <p className="text-sm text-fg-2">{t("podium.yourPlace", { place: me.rank, count: ranked.length })}</p>
      )}
      <AnimatePresence>
        {revealed && result && (
          <motion.div
            initial={{ rotateX: 90, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            transition={{ duration: DURATION.slower, ease: EASE.out }}
            className="w-full max-w-sm rounded-lg border-2 border-gold bg-surface-1 p-4 text-center shadow-3"
            data-testid="battle-prize"
          >
            <p className="label-pixel text-gold">{t("podium.prize")}</p>
            <div className="mt-2 flex justify-center">
              {result.capped ? (
                <p className="text-sm text-pretty text-fg-2">{t("podium.capped")}</p>
              ) : (
                <PrizeView prize={result.prize} size="lg" />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <DoodleSays text={line} mood={iWon ? "proud" : "laughing"} className="w-full max-w-md" />
      <Button onClick={onClose} data-testid="battle-podium-close">
        {t("podium.again")}
      </Button>
    </div>
  );
}
