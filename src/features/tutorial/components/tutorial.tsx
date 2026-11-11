"use client";

import { motion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { burstConfetti } from "@/components/ui/effects";
import { BALANCE } from "@/config/balance";
import { useGame } from "@/features/game/store";
import { formatInteger, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { scaledXp } from "@/lib/sim/progression";
import { playSound } from "@/lib/sound";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { TUTORIAL_STEPS, stepIndex, type TutorialStep } from "../steps";
import { TOURS } from "../tours";
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
  const mainStep = useTutorial((state) => state.step);
  const tour = useTutorial((state) => state.tour);
  // The first-session tutorial, or a short unlock tour (ADR-046).
  const steps: readonly TutorialStep[] | null = tour
    ? (TOURS[tour.key] ?? null)
    : status === "active"
      ? TUTORIAL_STEPS
      : null;
  const index = tour ? tour.step : mainStep;
  const step = steps?.[index];
  const goTo = (to: number) => {
    const { setStep, setTourStep } = useTutorial.getState();
    if (useTutorial.getState().tour) setTourStep(to);
    else setStep(to);
  };
  const rect = useTargetRect(step?.target);
  const layer = useRef<HTMLDivElement>(null);

  // Load progress for this account once the portfolio is known. The server
  // decides whether the tutorial is done; the browser only remembers the step.
  const portfolioLoaded = useGame((state) => state.portfolio !== null);
  const serverCompleted = useGame((state) => state.portfolio?.tutorialCompleted ?? false);
  useEffect(() => {
    // Only on the first load: completing the tutorial later must not cut off its final step.
    if (!portfolioLoaded || useTutorial.getState().status !== "loading") return;
    const { load, finish } = useTutorial.getState();
    const apply = (accountId: string) => {
      load(accountId);
      if (serverCompleted) finish();
    };
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      apply("demo");
      return;
    }
    void supabase.auth.getUser().then(({ data }) => apply(data.user?.id ?? "demo"));
  }, [portfolioLoaded, serverCompleted]);

  // Keep the player on the page the step belongs to, and advance route steps.
  useEffect(() => {
    if (!step || !steps) return;
    if (step.advance.on === "route" && step.advance.path.test(pathname)) {
      goTo(index + 1);
      return;
    }
    if (step.path && !step.path.test(pathname) && step.recover) {
      if ("to" in step.recover) router.replace(step.recover.to);
      else goTo(stepIndex(step.recover.step, steps));
    }
    // goTo only reads the store
  }, [step, steps, index, pathname, router]);

  // Advance on actions reported by the game.
  useEffect(() => {
    if (!step || !steps) return;
    return onTutorialEvent((event) => {
      if (step.advance.on === "event" && step.advance.event === event) goTo(index + 1);
      else if (step.fallback?.event === event) goTo(stepIndex(step.fallback.step, steps));
    });
  }, [step, steps, index]);

  // Escape must not close anything behind the tutorial, except the order sheet step.
  useEffect(() => {
    if (!step || step.inDialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step]);

  if (!step || !steps) return null;

  const last = index === steps.length - 1;
  const hero = !step.target;
  const hole = rect && {
    top: rect.top - PADDING,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
  };

  const next = () => {
    const { setStep, finish, endTour } = useTutorial.getState();
    haptic("tap");
    if (tour) {
      if (last) endTour();
      else goTo(index + 1);
      return;
    }
    if (last) {
      finish();
      return;
    }
    // Entering the final step pays the reward.
    if (steps[index + 1]?.id === "done") {
      void useGame
        .getState()
        .completeTutorial()
        .catch(() => undefined);
      void playSound("levelUp");
      haptic("success");
      if (layer.current) burstConfetti(layer.current, 40);
    }
    setStep(index + 1);
  };

  const vars = {
    capital: formatMoney(BALANCE.economy.startingCapitalCents, { whole: true }),
    rate: formatMoney(BALANCE.economy.basicIncomeCentsPerHour, { whole: true }),
    xp: formatInteger(TUTORIAL_XP),
  };
  const text = tour
    ? t(`tours.${tour.key}.${step.id}` as Parameters<typeof t>[0])
    : t(`steps.${step.id}` as Parameters<typeof t>[0], vars);

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
                  total={steps.length}
                  label={t("progress", { current: index + 1, total: steps.length })}
                />
                {step.advance.on === "next" ? (
                  <Button size={hero ? "lg" : "sm"} block={hero} onClick={next} data-tour-next>
                    {t(index === 0 && !tour ? "start" : last ? (tour ? "tourDone" : "finish") : "next")}
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
