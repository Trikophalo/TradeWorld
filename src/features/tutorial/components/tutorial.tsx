"use client";

import { motion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { burstConfetti } from "@/components/ui/effects";
import { BALANCE } from "@/config/balance";
import { useDemo } from "@/lib/demo/store";
import { formatInteger, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { scaledXp } from "@/lib/sim/progression";
import { playSound } from "@/lib/sound";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { TUTORIAL_STEPS, stepIndex } from "../steps";
import { onTutorialEvent, useTutorial } from "../store";
import { useTargetRect, type TargetRect } from "../use-target-rect";
import { SpeechBubble } from "./speech-bubble";

/** Space between the highlighted control and the ring around it. */
const PADDING = 6;
const TUTORIAL_XP = scaledXp(BALANCE.progression.xpSources.tutorial.xp);

/**
 * The guided first session (docs/DECISIONS.md, ADR-034). Mounted once in the
 * app shell. While it runs, a transparent layer blocks everything except the
 * highlighted control, so the tutorial cannot be skipped or left.
 */
export function Tutorial() {
  const t = useTranslations("tutorial");
  const router = useRouter();
  const pathname = usePathname();
  const status = useTutorial((state) => state.status);
  const index = useTutorial((state) => state.step);
  const step = status === "active" ? TUTORIAL_STEPS[index] : undefined;
  const rect = useTargetRect(step?.target);
  const layer = useRef<HTMLDivElement>(null);

  // Load progress for this account (demo mode: one shared slot).
  useEffect(() => {
    const { load } = useTutorial.getState();
    const restoreDemoLevel = () => {
      // Demo data lives in memory only: give a returning visitor the tutorial level back.
      if (useTutorial.getState().status === "done" && useDemo.getState().totalXp === 0) {
        useDemo.getState().addXp(TUTORIAL_XP);
      }
    };
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      load("demo");
      restoreDemoLevel();
      return;
    }
    void supabase.auth.getUser().then(({ data }) => {
      load(data.user?.id ?? "demo");
      restoreDemoLevel();
    });
  }, []);

  // Keep the player on the page the step belongs to, and advance route steps.
  useEffect(() => {
    if (!step) return;
    const { setStep } = useTutorial.getState();
    if (step.advance.on === "route" && step.advance.path.test(pathname)) {
      setStep(index + 1);
      return;
    }
    if (step.path && !step.path.test(pathname) && step.recover) {
      if ("to" in step.recover) router.replace(step.recover.to);
      else setStep(stepIndex(step.recover.step));
    }
  }, [step, index, pathname, router]);

  // Advance on actions reported by the game.
  useEffect(() => {
    if (!step) return;
    return onTutorialEvent((event) => {
      const { setStep } = useTutorial.getState();
      if (step.advance.on === "event" && step.advance.event === event) setStep(index + 1);
      else if (step.fallback?.event === event) setStep(stepIndex(step.fallback.step));
    });
  }, [step, index]);

  // Escape must not close anything behind the tutorial, except the order sheet step.
  useEffect(() => {
    if (!step || step.inDialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step]);

  if (!step) return null;

  const last = index === TUTORIAL_STEPS.length - 1;
  const hero = !step.target;
  const hole = rect && {
    top: rect.top - PADDING,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
  };

  const next = () => {
    const { setStep, finish } = useTutorial.getState();
    haptic("tap");
    if (last) {
      finish();
      return;
    }
    // Entering the final step pays the reward.
    if (TUTORIAL_STEPS[index + 1]?.id === "done") {
      useDemo.getState().addXp(TUTORIAL_XP);
      void playSound("levelUp");
      haptic("success");
      if (layer.current) burstConfetti(layer.current, 40);
    }
    setStep(index + 1);
  };

  const text = t(`steps.${step.id}`, {
    capital: formatMoney(BALANCE.economy.startingCapitalCents, { whole: true }),
    rate: formatMoney(BALANCE.economy.basicIncomeCentsPerHour, { whole: true }),
    xp: formatInteger(TUTORIAL_XP),
  });

  return (
    <div className="pointer-events-none fixed inset-0 z-tutorial" role="region" aria-label={t("label")} data-tutorial>
      <div ref={layer} className="absolute top-1/2 left-1/2 size-px" />

      {/* Dimmed backdrop with a hole around the highlighted control */}
      {/* Keyed elements re-enter on every step. No exit animation: a step must never wait for one. */}
      <>
        {hole ? (
          <motion.div
            key={step.id}
            aria-hidden
            className={cn("absolute rounded-lg", !step.inDialog && "shadow-[0_0_0_200vmax_var(--scrim)]")}
            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
            initial={{ opacity: 0, scale: 1.12 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: DURATION.slow, ease: EASE.out }}
          >
            <span className="absolute inset-0 rounded-lg border-2 border-accent" />
            <span className="absolute inset-0 animate-ping rounded-lg border-2 border-accent opacity-40 [animation-duration:1.6s]" />
          </motion.div>
        ) : (
          !step.inDialog && (
            <motion.div
              key={`${step.id}-scrim`}
              aria-hidden
              className="absolute inset-0 bg-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: DURATION.base }}
            />
          )
        )}
      </>

      {/* Click blockers. Inside a dialog the dialog's own overlay already blocks the page. */}
      {!step.inDialog && <Blockers hole={hole} holeInteractive={step.advance.on !== "next"} />}

      {/* Finn */}
      <motion.div
        key={step.id}
        className={cn("absolute inset-x-0 px-3 lg:left-(--sidebar-width) lg:px-8", placement(hero, rect))}
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={SPRING.smooth}
      >
        <div className={cn("pointer-events-auto mx-auto", hero ? "max-w-sm" : "max-w-xl")}>
          <SpeechBubble
            name={t("name")}
            text={text}
            mood={step.mood}
            hero={hero}
            footer={
              <>
                <Progress
                  current={index}
                  total={TUTORIAL_STEPS.length}
                  label={t("progress", { current: index + 1, total: TUTORIAL_STEPS.length })}
                />
                {step.advance.on === "next" ? (
                  <Button size={hero ? "lg" : "sm"} block={hero} onClick={next} data-tour-next>
                    {t(index === 0 ? "start" : last ? "finish" : "next")}
                  </Button>
                ) : (
                  <span className="label-pixel text-accent">{t("yourTurn")}</span>
                )}
              </>
            }
          />
        </div>
      </motion.div>
    </div>
  );
}

/** Finn sits on the side of the screen with more room, never on top of the highlighted control. */
function placement(hero: boolean, rect: TargetRect | null): string {
  if (hero) return "top-1/2 -translate-y-1/2";
  const top = "top-[calc(var(--safe-top)+12px)]";
  const bottom = "bottom-[calc(var(--tabbar-height)+var(--safe-bottom)+12px)] lg:bottom-8";
  if (!rect || typeof window === "undefined") return bottom;
  const above = rect.top;
  const below = window.innerHeight - (rect.top + rect.height);
  return above > below ? top : bottom;
}

function Progress({ current, total, label }: { current: number; total: number; label: string }) {
  return (
    <span className="flex items-center gap-1" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn("size-1.5 transition-colors duration-base", i <= current ? "bg-accent" : "bg-line-2")}
        />
      ))}
    </span>
  );
}

/** Four transparent panels around the hole swallow every click outside of it. */
function Blockers({ hole, holeInteractive }: { hole: TargetRect | null | false; holeInteractive: boolean }) {
  if (!hole) return <div className="pointer-events-auto absolute inset-0" />;
  const right = hole.left + hole.width;
  const bottom = hole.top + hole.height;
  return (
    <>
      <div className="pointer-events-auto absolute inset-x-0 top-0" style={{ height: Math.max(0, hole.top) }} />
      <div className="pointer-events-auto absolute inset-x-0 bottom-0" style={{ top: bottom }} />
      <div
        className="pointer-events-auto absolute left-0"
        style={{ top: hole.top, height: hole.height, width: Math.max(0, hole.left) }}
      />
      <div
        className="pointer-events-auto absolute right-0"
        style={{ top: hole.top, height: hole.height, left: right }}
      />
      {!holeInteractive && (
        <div
          className="pointer-events-auto absolute"
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
        />
      )}
    </>
  );
}
