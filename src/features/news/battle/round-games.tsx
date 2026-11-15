"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { BELL } from "@/components/pixel/battle-art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { PlayerFigure } from "@/components/ui/player-figure";
import { toast } from "@/components/ui/toast";
import type { Battle, BattleRound, BattleState } from "@/features/game/battle-types";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { Hearts } from "./parts";

/*
 * The round games of a news battle (ADR-160): Börsenquiz, Schätz den Kurs and Die Glocke. The server keeps the
 * answers and the bell time secret and judges with its own clock; this only shows the rounds and sends answers.
 */

/** The server's clock, ticking 10 times a second (client only). */
export function useServerNow(offsetMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now() + offsetMs);
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [offsetMs]);
  return now;
}

/** The round on screen: the last one that opened. */
function currentRound(battle: Battle, now: number): BattleRound | null {
  const list = battle.rounds?.list ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (Date.parse(list[i]!.opensAt) <= now) return list[i]!;
  return null;
}

interface RoundProps {
  battle: Battle;
  offsetMs: number;
  onState: (state: BattleState) => void;
}

function useAnswer(battle: Battle, onState: (s: BattleState) => void) {
  const errorText = useGameErrorText();
  const [state, setState] = useState<ButtonState>("idle");
  return {
    state,
    async send(round: number, choice: number | null, value: number | null) {
      if (state === "loading") return;
      setState("loading");
      try {
        onState(await engine.answerBattle(crypto.randomUUID(), battle.id, round, choice, value));
      } catch (error) {
        toast.error(errorText(error));
      } finally {
        setState("idle");
      }
    },
  };
}

/** Everyone in the battle with hearts and points; who is out is greyed. */
export function PlayerStrip({ battle, points = true }: { battle: Battle; points?: boolean }) {
  const t = useTranslations("battle");
  const rounds = battle.rounds;
  const maxHearts = Math.max(1, ...(rounds?.hearts ?? [1]));
  const players = battle.players.filter((p) => p.slot !== null);
  return (
    <ul className="grid w-full grid-cols-3 gap-1 sm:grid-cols-5" data-testid="battle-players">
      {players.map((p) => {
        const slot = p.slot!;
        const out = (rounds?.out[slot] ?? -1) >= 0 || p.left;
        return (
          <li
            key={slot}
            className={cn(
              "flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-1 transition-opacity duration-base",
              p.me && "bg-accent-soft",
              out && "opacity-35 grayscale",
            )}
          >
            <PlayerFigure avatarKey={p.avatarKey} accessories={p.accessories} scale={1} />
            <span className="min-w-0">
              <span className={cn("block truncate text-2xs", p.me ? "font-semibold text-accent" : "text-fg-2")}>
                {p.me ? t("you") : p.nickname}
              </span>
              <span className="flex items-center gap-1.5">
                {battle.kind !== "estimate" && (
                  <Hearts count={rounds?.hearts[slot] ?? maxHearts} max={maxHearts} scale={1} />
                )}
                {points && <span className="nums text-2xs text-fg-3">{rounds?.points[slot] ?? 0}</span>}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Timer({ from, to, now }: { from: number; to: number; now: number }) {
  const share = Math.max(0, Math.min(1, (to - now) / Math.max(1, to - from)));
  return (
    <div className="h-2 w-full overflow-hidden rounded-pill bg-surface-2" aria-hidden>
      <div
        className={cn(
          "h-full origin-left rounded-pill transition-transform duration-fast ease-linear",
          share < 0.25 ? "bg-loss" : "bg-accent",
        )}
        style={{ transform: `scaleX(${share})` }}
      />
    </div>
  );
}

const LETTERS = ["A", "B", "C", "D"];

export function QuizGame({ battle, offsetMs, onState }: RoundProps) {
  const t = useTranslations("battle");
  const now = useServerNow(offsetMs);
  const answer = useAnswer(battle, onState);
  const round = now === null ? null : currentRound(battle, now);
  const closed = !!round && now !== null && now >= Date.parse(round.closesAt ?? round.endsAt);
  const me = battle.players.find((p) => p.me)?.slot ?? null;
  const out = me === null || (battle.rounds?.out[me] ?? -1) >= 0;
  const total = Number(battle.params?.game.rounds ?? 7);
  const mine = round?.mine.choice ?? null;
  const myResult = round?.results?.find((r) => r.slot === me);

  useEffect(() => {
    if (!round || out) return;
    const key = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 4 && !closed && mine === null) void answer.send(round.round, n - 1, null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [round, closed, mine, out, answer]);

  useEffect(() => {
    if (!closed || !round || me === null) return;
    if (myResult?.right) void playSound("success");
    else void playSound("error");
  }, [closed, round?.round]); // eslint-disable-line react-hooks/exhaustive-deps -- once per reveal

  if (!round || now === null) return <Waiting />;
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4" data-testid="battle-quiz">
      <PlayerStrip battle={battle} />
      <AnimatePresence mode="wait">
        <motion.div
          key={round.round}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: DURATION.slow, ease: EASE.out }}
          className="space-y-4"
        >
          <div className="space-y-2 rounded-lg border-2 border-line-2 bg-surface-1 p-4 shadow-2">
            <p className="label-pixel text-fg-3">{t("quiz.round", { n: round.round + 1, total })}</p>
            <p className="text-lg font-semibold text-pretty text-fg-1 lg:text-xl" data-testid="battle-question">
              {round.question}
            </p>
            {!closed && <Timer from={Date.parse(round.opensAt)} to={Date.parse(round.closesAt!)} now={now} />}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(round.options ?? []).map((option, i) => {
              const chosen = mine === i;
              const correct = closed && round.correct === i;
              const wrong = closed && chosen && round.correct !== i;
              const voters = closed ? (round.results ?? []).filter((r) => r.choice === i) : [];
              return (
                <motion.button
                  key={i}
                  type="button"
                  disabled={out || closed || mine !== null || answer.state === "loading"}
                  onClick={() => {
                    haptic("tap");
                    void playSound("tap");
                    void answer.send(round.round, i, null);
                  }}
                  animate={correct ? { scale: [1, 1.04, 1] } : { scale: 1 }}
                  transition={{ duration: DURATION.slower, ease: EASE.out }}
                  className={cn(
                    "flex min-h-14 items-center gap-3 rounded-md border-2 px-3 py-2 text-left focus-ring",
                    "transition-colors duration-fast enabled:hover:border-accent enabled:active:translate-y-px",
                    correct
                      ? "border-gain bg-gain-soft"
                      : wrong
                        ? "border-loss bg-loss-soft"
                        : chosen
                          ? "border-accent bg-accent-soft"
                          : "border-line-2 bg-surface-1",
                    "disabled:cursor-default",
                  )}
                  data-testid="battle-option"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-sm bg-surface-3 font-pixel text-xs text-fg-2">
                    {LETTERS[i]}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-pretty text-fg-1">{option}</span>
                  {voters.length > 0 && (
                    <span className="flex -space-x-2">
                      {voters.slice(0, 5).map((v) => {
                        const p = battle.players.find((x) => x.slot === v.slot);
                        return p ? (
                          <span key={v.slot} className="rounded-full bg-surface-1 ring-2 ring-surface-1">
                            <PlayerFigure avatarKey={p.avatarKey} accessories={p.accessories} scale={1} />
                          </span>
                        ) : null;
                      })}
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>
          <p className="min-h-5 text-center text-sm text-fg-2" aria-live="polite">
            {closed
              ? myResult
                ? myResult.right
                  ? `${t("quiz.right")} ${t("quiz.points", { points: myResult.points })}`
                  : t("quiz.wrong")
                : me !== null && !out
                  ? t("quiz.none")
                  : ""
              : mine !== null
                ? t("quiz.answered")
                : t("controls.clickAnswer")}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function parseNumber(text: string): number | null {
  const clean = text.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(clean);
  return clean !== "" && Number.isFinite(n) && n >= 0 ? n : null;
}

const fmt = (value: number, decimals: number) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);

export function EstimateGame({ battle, offsetMs, onState }: RoundProps) {
  const t = useTranslations("battle");
  const now = useServerNow(offsetMs);
  const answer = useAnswer(battle, onState);
  const round = now === null ? null : currentRound(battle, now);
  const closed = !!round && now !== null && now >= Date.parse(round.closesAt ?? round.endsAt);
  const me = battle.players.find((p) => p.me)?.slot ?? null;
  const total = Number(battle.params?.game.rounds ?? 4);
  const decimals = round?.decimals ?? 0;

  if (!round || now === null) return <Waiting />;
  const results = [...(round.results ?? [])].sort((a, b) => b.points - a.points);
  const truth = round.value ?? 0;
  const guesses = results.map((r) => r.value ?? 0);
  const lo = Math.min(truth, ...guesses);
  const hi = Math.max(truth, ...guesses);
  const pos = (v: number) => (hi === lo ? 50 : 6 + ((v - lo) / (hi - lo)) * 88);
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4" data-testid="battle-estimate">
      <PlayerStrip battle={battle} />
      <div className="space-y-2 rounded-lg border-2 border-line-2 bg-surface-1 p-4 shadow-2">
        <p className="label-pixel text-fg-3">
          {t("estimate.round", { n: round.round + 1, total })}
          {round.round === total - 1 ? ` · ${t("estimate.doubleRound")}` : ""}
        </p>
        <p className="text-lg font-semibold text-pretty text-fg-1 lg:text-xl" data-testid="battle-question">
          {round.question}
        </p>
        {!closed && <Timer from={Date.parse(round.opensAt)} to={Date.parse(round.closesAt!)} now={now} />}
      </div>
      {!closed ? (
        round.mine.pressed ? (
          <p className="text-center font-pixel text-accent">
            {t("estimate.sent", { value: `${fmt(round.mine.value ?? 0, decimals)} ${round.unit ?? ""}` })}
          </p>
        ) : me !== null ? (
          <EstimateForm
            key={round.round}
            unit={round.unit}
            busy={answer.state}
            onSend={(value) => void answer.send(round.round, null, value)}
          />
        ) : null
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...SPRING.smooth }}
          className="space-y-4 rounded-lg border-2 border-line-2 bg-surface-1 p-4 shadow-2"
        >
          <p className="text-center font-pixel text-xl text-gain">
            {t("estimate.truth", { value: `${fmt(truth, decimals)} ${round.unit ?? ""}` })}
          </p>
          <div className="relative h-20">
            <div className="absolute inset-x-[6%] top-10 h-1 rounded-pill bg-line-2" />
            <div className="absolute top-2 -translate-x-1/2" style={{ left: `${pos(truth)}%` }}>
              <span className="block size-0 border-x-8 border-t-8 border-x-transparent border-t-gain" />
            </div>
            {results.map((r) => {
              const p = battle.players.find((x) => x.slot === r.slot);
              return p ? (
                <motion.span
                  key={r.slot}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute top-11 -translate-x-1/2"
                  style={{ left: `${pos(r.value ?? 0)}%` }}
                >
                  <PlayerFigure avatarKey={p.avatarKey} accessories={p.accessories} scale={1} />
                </motion.span>
              ) : null;
            })}
          </div>
          <ol className="space-y-1">
            {results.map((r, i) => {
              const p = battle.players.find((x) => x.slot === r.slot);
              return (
                <li
                  key={r.slot}
                  className={cn("flex items-center gap-2 text-sm", p?.me && "font-semibold text-accent")}
                >
                  <span className="w-5 nums text-fg-3">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate">{p?.me ? t("you") : p?.nickname}</span>
                  <span className="nums text-fg-2">
                    {fmt(r.value ?? 0, decimals)} {round.unit}
                  </span>
                  {r.right && <span className="text-2xs text-gold">{t("estimate.bullseye")}</span>}
                  <span className="w-10 text-right font-pixel nums text-gain">+{r.points}</span>
                </li>
              );
            })}
          </ol>
        </motion.div>
      )}
    </div>
  );
}

function EstimateForm({
  unit,
  busy,
  onSend,
}: {
  unit: string | null;
  busy: ButtonState;
  onSend: (value: number) => void;
}) {
  const t = useTranslations("battle");
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = parseNumber(text);
    if (value === null) return;
    haptic("tap");
    void playSound("tap");
    onSend(value);
  };
  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <label className="min-w-0 flex-1">
        <span className="sr-only">{t("estimate.placeholder")}</span>
        <span className="flex h-13 items-center rounded-md border-2 border-line-2 bg-surface-2 px-3 focus-within:border-accent">
          <input
            inputMode="decimal"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 16))}
            placeholder={t("estimate.placeholder")}
            className="min-w-0 flex-1 bg-transparent nums text-xl text-fg-1 outline-none placeholder:text-fg-3"
            data-testid="battle-estimate-input"
          />
          <span className="text-sm text-fg-3">{unit}</span>
        </span>
      </label>
      <Button type="submit" size="lg" state={busy} disabled={parseNumber(text) === null}>
        {t("estimate.send")}
      </Button>
    </form>
  );
}

export function BellGame({ battle, offsetMs, onState }: RoundProps) {
  const t = useTranslations("battle");
  const now = useServerNow(offsetMs);
  const answer = useAnswer(battle, onState);
  const round = now === null ? null : currentRound(battle, now);
  const me = battle.players.find((p) => p.me)?.slot ?? null;
  const out = me === null || (battle.rounds?.out[me] ?? -1) >= 0;
  const rang = !!round?.bellAt;
  const open = rang && now !== null && round?.closesAt ? now < Date.parse(round.closesAt) : false;
  const ready =
    !!round && now !== null && now < Date.parse(round.opensAt) + Number(battle.params?.game.readyMs ?? 1000);
  const pressed = round?.mine.pressed ?? false;
  const mine = round?.results?.find((r) => r.slot === me);
  const roundKey = round ? `${round.round}:${rang}` : "";

  useEffect(() => {
    if (rang) {
      void playSound("battleBell");
      haptic("success");
    }
  }, [roundKey]); // eslint-disable-line react-hooks/exhaustive-deps -- once per ring

  const press = () => {
    if (!round || out || pressed || answer.state === "loading") return;
    haptic("tap");
    void answer.send(round.round, null, null);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        if (!e.repeat) press();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!round || now === null) return <Waiting />;
  const results = [...(round.results ?? [])].sort((a, b) => (a.ms < 0 ? 1e9 : a.ms) - (b.ms < 0 ? 1e9 : b.ms));
  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-4" data-testid="battle-bell" data-rang={rang}>
      <PlayerStrip battle={battle} points={false} />
      <p className="label-pixel text-fg-3">{t("bell.round", { n: round.round + 1 })}</p>
      <div className="relative grid h-56 place-items-center">
        <motion.div
          animate={open ? { rotate: [0, -14, 12, -9, 7, 0], scale: [1, 1.12, 1.08, 1] } : { rotate: 0, scale: 1 }}
          transition={open ? { duration: 0.6, ease: EASE.out } : { duration: DURATION.fast }}
          style={{ transformOrigin: "50% 8%" }}
        >
          <PixelIcon {...BELL} scale={7} className="max-sm:hidden" />
          <PixelIcon {...BELL} scale={5} className="sm:hidden" />
        </motion.div>
        <AnimatePresence>
          {open && (
            <motion.p
              key="now"
              initial={{ scale: 2.2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ ...SPRING.bouncy }}
              className="absolute bottom-0 font-pixel text-4xl text-gold drop-shadow"
            >
              {t("bell.now")}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <p className="min-h-6 text-center font-pixel text-lg text-fg-1" aria-live="assertive">
        {round.results
          ? mine
            ? mine.ms < 0
              ? t("bell.early")
              : t("bell.reaction", { ms: mine.ms })
            : ""
          : pressed
            ? t("bell.pressed")
            : rang
              ? t("bell.now")
              : ready
                ? t("bell.ready")
                : t("bell.wait")}
      </p>
      {round.results && (
        <ol className="w-full max-w-sm space-y-1">
          {results.map((r) => {
            const p = battle.players.find((x) => x.slot === r.slot);
            const lost = round.lost?.includes(r.slot);
            return (
              <li key={r.slot} className={cn("flex items-center gap-2 text-sm", lost && "text-loss")}>
                <span className="min-w-0 flex-1 truncate">{p?.me ? t("you") : p?.nickname}</span>
                <span className="font-pixel nums">{r.ms < 0 ? t("bell.early") : t("bell.reaction", { ms: r.ms })}</span>
              </li>
            );
          })}
        </ol>
      )}
      {!out && (
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            press();
          }}
          disabled={pressed}
          data-testid="battle-bell-button"
          className={cn(
            "h-24 w-full max-w-md touch-none rounded-lg border-2 font-pixel text-2xl uppercase shadow-3 focus-ring select-none",
            "transition-transform duration-instant active:scale-95 disabled:opacity-50",
            rang ? "border-gold bg-gold text-fg-inverse" : "border-line-2 bg-surface-2 text-fg-1",
          )}
        >
          {t("bell.press")}
        </button>
      )}
      <p className="text-2xs text-fg-3">
        {t("controls.bellKey")} · {t("bell.network")}
      </p>
    </div>
  );
}

function Waiting() {
  const t = useTranslations("battle");
  return <p className="py-10 text-center font-pixel text-fg-2">{t("intro.ready")}</p>;
}
