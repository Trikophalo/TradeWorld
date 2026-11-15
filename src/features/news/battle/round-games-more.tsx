"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALARM_CLOCK,
  BEAR,
  BRIEFCASE,
  BULL,
  COIN,
  GEM,
  GIFT,
  GOLD_BAR,
  HEART,
  KEY,
  MOON,
  NEWSPAPER,
  VAULT_DOOR,
} from "@/components/pixel/art";
import { GAVEL } from "@/components/pixel/battle-art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { PlayerFigure } from "@/components/ui/player-figure";
import type { Battle, BattlePlayer, BattleRound } from "@/features/game/battle-types";
import { formatInteger, formatPrice } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/stores/settings";
import { PlayerStrip, Timer, Waiting, currentRound, useAnswer, useServerNow, type RoundProps } from "./round-games";

/*
 * The round games of the addendum to ADR-160: Tresorknacker, Ticker-Tippen, Mehr oder Weniger, Wer bietet mehr?.
 * The server keeps codes, the right ticker, the next candle and the bids secret until a round closes and judges
 * with its own clock; this shows the rounds and sends the answers.
 */

const name = (battle: Battle, slot: number, you: string) => {
  const p = battle.players.find((x) => x.slot === slot);
  return p?.me ? you : (p?.nickname ?? "?");
};
const playerOf = (battle: Battle, slot: number): BattlePlayer | undefined =>
  battle.players.find((x) => x.slot === slot);

/** Plays a sound once per round when it closes, by how it went for me. */
function useRevealSound(round: BattleRound | null, closed: boolean, good: boolean | null) {
  const done = useRef(-1);
  useEffect(() => {
    if (!round || !closed || done.current === round.round || good === null) return;
    done.current = round.round;
    void playSound(good ? "success" : "error");
  }, [round, closed, good]);
}

function RoundCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border-2 border-line-2 bg-surface-1 p-4 shadow-2">
      <p className="label-pixel text-fg-3">{label}</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Tresorknacker

type Answer = ReturnType<typeof useAnswer>;

/** A round game screen: waits for the first round, then one keyed view per round (its inputs start empty). */
function useRound(battle: Battle, offsetMs: number) {
  const now = useServerNow(offsetMs);
  const round = now === null ? null : currentRound(battle, now);
  return { now, round };
}

export function VaultGame({ battle, offsetMs, onState }: RoundProps) {
  const { now, round } = useRound(battle, offsetMs);
  const answer = useAnswer(battle, onState);
  if (!round || now === null) return <Waiting />;
  return <VaultRound key={round.round} battle={battle} round={round} now={now} answer={answer} />;
}

function VaultRound({
  battle,
  round,
  now,
  answer,
}: {
  battle: Battle;
  round: BattleRound;
  now: number;
  answer: Answer;
}) {
  const t = useTranslations("battle");
  const closed = now >= Date.parse(round.closesAt ?? round.endsAt);
  const me = battle.players.find((p) => p.me)?.slot ?? null;
  const total = Number(battle.params?.game.rounds ?? 3);
  const maxTries = Number(battle.params?.game.maxTries ?? 8);
  const v = round.vault;
  const digits = v?.digits ?? 3;
  const symbols = v?.symbols ?? 6;
  const [entry, setEntry] = useState("");
  const guesses = useMemo(() => v?.guesses ?? [], [v]);
  const cracked = guesses.some((x) => x.hits === digits);
  const locked = cracked || guesses.length >= maxTries || closed || me === null;
  const lastWrong = guesses.length > 0 && guesses.at(-1)!.hits !== digits;
  const seen = useRef(guesses.length);

  useEffect(() => {
    if (guesses.length <= seen.current) return;
    seen.current = guesses.length;
    if (guesses.at(-1)!.hits === digits) {
      void playSound("battleUnlock");
      haptic("success");
    } else void playSound("error");
  }, [guesses, digits]);
  const myResult = round.results?.find((r) => r.slot === me);
  useRevealSound(round, closed, me === null ? null : !!myResult?.right);

  const press = (d: number) => {
    if (locked) return;
    if (entry.length >= digits || entry.includes(String(d))) return;
    void playSound("battleClick");
    haptic("tap");
    setEntry((e) => e + String(d));
  };
  const submit = () => {
    if (locked || entry.length !== digits) return;
    void answer.send(round.round, Number(entry), null);
    setEntry("");
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= symbols) press(n);
      else if (e.key === "Backspace") setEntry((x) => x.slice(0, -1));
      else if (e.key === "Enter") submit();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const progress = v?.progress ?? [];
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4" data-testid="battle-vault">
      <PlayerStrip battle={battle} />
      <RoundCard label={t("vault.round", { n: round.round + 1, total })}>
        <div className="flex items-center gap-4">
          <motion.div
            className="shrink-0"
            animate={cracked || closed ? { rotate: [0, -8, 0], scale: [1, 1.08, 1] } : { rotate: 0 }}
            transition={{ duration: DURATION.slower, ease: EASE.out }}
          >
            <PixelIcon {...VAULT_DOOR} scale={3} className="max-sm:hidden" />
            <PixelIcon {...VAULT_DOOR} scale={2} className="sm:hidden" />
          </motion.div>
          <div className="min-w-0 flex-1 space-y-2">
            <motion.div
              key={guesses.length}
              animate={lastWrong && !prefersReducedMotion() ? { x: [0, -6, 6, -4, 3, 0] } : undefined}
              transition={{ duration: DURATION.slow }}
              className="flex gap-2"
              data-testid="vault-entry"
            >
              {Array.from({ length: digits }, (_, i) => {
                const shown = closed && v?.code ? v.code[i] : cracked ? guesses.at(-1)?.code[i] : entry[i];
                return (
                  <span
                    key={i}
                    className={cn(
                      "grid size-12 place-items-center rounded-md border-2 font-pixel nums text-2xl",
                      cracked || (closed && v?.code)
                        ? "border-gain bg-gain-soft text-gain"
                        : shown
                          ? "border-accent bg-accent-soft text-fg-1"
                          : "border-line-2 bg-surface-2 text-fg-3",
                    )}
                  >
                    {shown ?? "·"}
                  </span>
                );
              })}
            </motion.div>
            <p className="text-xs text-fg-2" aria-live="polite">
              {cracked
                ? t("vault.cracked")
                : closed && v?.code
                  ? t("vault.code", { code: v.code })
                  : guesses.length >= maxTries
                    ? t("vault.locked")
                    : t("vault.triesLeft", { count: maxTries - guesses.length, max: maxTries })}
            </p>
          </div>
        </div>
        {!closed && <Timer from={Date.parse(round.opensAt)} to={Date.parse(round.closesAt!)} now={now} />}
      </RoundCard>
      {!locked && (
        <div className="space-y-2" data-testid="vault-keypad">
          <div className="grid grid-cols-6 gap-2">
            {Array.from({ length: symbols }, (_, i) => i + 1).map((d) => (
              <button
                key={d}
                type="button"
                disabled={entry.includes(String(d)) || entry.length >= digits}
                onClick={() => press(d)}
                className={cn(
                  "h-12 rounded-md border-2 border-line-2 bg-surface-2 font-pixel text-xl text-fg-1 shadow-1 focus-ring sm:h-14",
                  "transition-transform duration-instant enabled:hover:border-accent enabled:active:scale-95 disabled:opacity-35",
                )}
                data-testid="vault-key"
              >
                {d}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button variant="secondary" onClick={() => setEntry((x) => x.slice(0, -1))} disabled={!entry} size="lg">
              {t("vault.clear")}
            </Button>
            <Button
              onClick={submit}
              state={answer.state}
              disabled={entry.length !== digits}
              size="lg"
              data-testid="vault-try"
            >
              {t("vault.try")}
            </Button>
          </div>
        </div>
      )}
      {guesses.length > 0 && (
        <ol className="space-y-1.5" data-testid="vault-guesses">
          <AnimatePresence initial={false}>
            {guesses.map((g, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...SPRING.smooth }}
                className="flex items-center gap-3 rounded-sm bg-surface-1 px-3 py-1.5"
              >
                <span className="w-5 nums text-2xs text-fg-3">{i + 1}.</span>
                <span className="flex gap-1">
                  {g.code.split("").map((d, k) => (
                    <span key={k} className="grid size-7 place-items-center rounded-xs bg-surface-3 font-pixel text-sm">
                      {d}
                    </span>
                  ))}
                </span>
                <span className="flex gap-1" aria-hidden>
                  {Array.from({ length: g.hits }, (_, k) => (
                    <span key={`h${k}`} className="size-3 rounded-full bg-gain" />
                  ))}
                  {Array.from({ length: g.near }, (_, k) => (
                    <span key={`n${k}`} className="size-3 rounded-full bg-warn" />
                  ))}
                  {Array.from({ length: digits - g.hits - g.near }, (_, k) => (
                    <span key={`e${k}`} className="size-3 rounded-full border-2 border-line-2" />
                  ))}
                </span>
                <span className="min-w-0 flex-1 text-right text-2xs text-fg-2">
                  {t("vault.hits", { count: g.hits })} · {t("vault.near", { count: g.near })}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
      <p className="text-center text-2xs text-pretty text-fg-3">{t("vault.legend")}</p>
      <ul className="flex flex-wrap justify-center gap-2" data-testid="vault-progress">
        {progress.map((p) => {
          const pl = playerOf(battle, p.slot);
          return pl ? (
            <li
              key={p.slot}
              className={cn(
                "flex items-center gap-1 rounded-pill px-2 py-0.5 text-2xs",
                p.cracked ? "bg-gain-soft text-gain" : "bg-surface-2 text-fg-2",
              )}
            >
              <PlayerFigure avatarKey={pl.avatarKey} accessories={pl.accessories} scale={1} />
              {pl.me ? t("you") : pl.nickname}:{" "}
              {p.cracked ? t("vault.crackedBy") : t("vault.tries", { count: p.tries })}
            </li>
          ) : null;
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Ticker-Tippen

export function TickerGame({ battle, offsetMs, onState }: RoundProps) {
  const { now, round } = useRound(battle, offsetMs);
  const answer = useAnswer(battle, onState);
  if (!round || now === null) return <Waiting />;
  return <TickerRound key={round.round} battle={battle} round={round} now={now} answer={answer} />;
}

function TickerRound({
  battle,
  round,
  now,
  answer,
}: {
  battle: Battle;
  round: BattleRound;
  now: number;
  answer: Answer;
}) {
  const t = useTranslations("battle");
  const closed = now >= Date.parse(round.closesAt ?? round.endsAt);
  const me = battle.players.find((p) => p.me)?.slot ?? null;
  const total = Number(battle.params?.game.rounds ?? 8);
  const options = useMemo(() => round.options ?? [], [round.options]);
  const mine = round.mine.choice ?? null;
  const [typed, setTyped] = useState("");
  const myResult = round.results?.find((r) => r.slot === me);
  const reduced = prefersReducedMotion();
  useRevealSound(round, closed, me === null ? null : !!myResult?.right);

  const pick = (i: number) => {
    if (closed || mine !== null || me === null || answer.state === "loading") return;
    haptic("tap");
    void playSound("tap");
    void answer.send(round.round, i, null);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Backspace") return setTyped((x) => x.slice(0, -1));
      if (!/^[a-zA-ZÄÖÜäöü0-9]$/.test(e.key)) return;
      const next = (typed + e.key).toUpperCase().slice(-6);
      const hit = options.findIndex((o) => o.toUpperCase() === next);
      if (hit >= 0) {
        pick(hit);
        setTyped("");
      } else setTyped(options.some((o) => o.toUpperCase().startsWith(next)) ? next : e.key.toUpperCase());
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const tape = [...options.map((o, i) => ({ o, i })), ...options.map((o, i) => ({ o, i }))];
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4" data-testid="battle-ticker">
      <PlayerStrip battle={battle} />
      <RoundCard label={t("ticker.round", { n: round.round + 1, total })}>
        <p className="text-sm text-fg-2">{t("ticker.find")}</p>
        <p className="font-pixel text-xl text-pretty text-fg-1 lg:text-2xl" data-testid="battle-question">
          {round.question}
        </p>
        {!closed && <Timer from={Date.parse(round.opensAt)} to={Date.parse(round.closesAt!)} now={now} />}
      </RoundCard>
      <div
        className="relative overflow-hidden rounded-md border-2 border-line-2 bg-surface-2 py-3 shadow-2"
        data-testid="ticker-tape"
      >
        <motion.div
          key={round.round}
          className={cn("flex w-max gap-3 px-3", reduced && "w-full flex-wrap justify-center")}
          animate={reduced || closed ? undefined : { x: ["0%", "-50%"] }}
          transition={{ duration: 7, ease: "linear", repeat: Infinity }}
        >
          {(reduced ? tape.slice(0, options.length) : tape).map(({ o, i }, k) => {
            const correct = closed && round.correct === i;
            const wrong = closed && mine === i && round.correct !== i;
            const chosen = mine === i;
            return (
              <button
                key={k}
                type="button"
                onClick={() => pick(i)}
                disabled={closed || mine !== null || me === null}
                className={cn(
                  "min-w-20 rounded-sm border-2 px-3 py-2 font-pixel text-lg tracking-wider focus-ring",
                  "transition-transform duration-instant enabled:active:scale-95",
                  correct
                    ? "border-gain bg-gain text-on-semantic"
                    : wrong
                      ? "border-loss bg-loss text-on-semantic"
                      : chosen
                        ? "border-accent bg-accent text-on-accent"
                        : "border-gain/40 bg-transparent text-gain enabled:hover:border-gain",
                )}
                data-testid="ticker-option"
              >
                {o}
              </button>
            );
          })}
        </motion.div>
      </div>
      <p className="min-h-5 text-center text-sm text-fg-2" aria-live="polite">
        {closed
          ? myResult
            ? myResult.right
              ? `${t("ticker.right")} +${myResult.points}`
              : `${t("ticker.wrong")} ${myResult.points}`
            : me !== null
              ? t("ticker.none")
              : t("ticker.was", { ticker: options[round.correct ?? 0] ?? "" })
          : mine !== null
            ? t("quiz.answered")
            : typed
              ? t("ticker.typed", { text: typed })
              : t("controls.tickerKeys")}
      </p>
      {closed && round.results && round.results.length > 0 && (
        <ol className="flex flex-wrap justify-center gap-2 text-2xs">
          {[...round.results]
            .sort((a, b) => b.points - a.points)
            .map((r) => (
              <li
                key={r.slot}
                className={cn(
                  "rounded-pill px-2 py-0.5 nums",
                  r.right ? "bg-gain-soft text-gain" : "bg-loss-soft text-loss",
                )}
              >
                {name(battle, r.slot, t("you"))} {r.points > 0 ? `+${r.points}` : r.points}
              </li>
            ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Mehr oder Weniger

export function Candles({ chart, next, className }: { chart: number[]; next: number | null; className?: string }) {
  const all = next === null ? chart : [...chart, next];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = Math.max(0.01, hi - lo);
  const w = 8;
  const gap = 3;
  const height = 120;
  const y = (v: number) => 6 + (1 - (v - lo) / span) * (height - 12);
  return (
    <svg
      viewBox={`0 0 ${all.length * (w + gap)} ${height}`}
      preserveAspectRatio="xMaxYMid meet"
      className={className}
      shapeRendering="crispEdges"
      aria-hidden
    >
      {all.map((close, i) => {
        if (i === 0) return null;
        const open = all[i - 1]!;
        const up = close >= open;
        const top = Math.min(y(open), y(close));
        const bottom = Math.max(y(open), y(close));
        const isNext = next !== null && i === all.length - 1;
        return (
          <g key={i} className={cn(up ? "fill-gain" : "fill-loss", isNext && "animate-pulse")}>
            <rect x={i * (w + gap) + w / 2 - 0.5} y={top - 3} width={1} height={bottom - top + 6} />
            <rect x={i * (w + gap)} y={top} width={w} height={Math.max(2, bottom - top)} />
          </g>
        );
      })}
    </svg>
  );
}

export function HigherGame({ battle, offsetMs, onState }: RoundProps) {
  const t = useTranslations("battle");
  const now = useServerNow(offsetMs);
  const answer = useAnswer(battle, onState);
  const round = now === null ? null : currentRound(battle, now);
  const closed = !!round && now !== null && now >= Date.parse(round.closesAt ?? round.endsAt);
  const me = battle.players.find((p) => p.me)?.slot ?? null;
  const out = me === null || (battle.rounds?.out[me] ?? -1) >= 0;
  const total = Number(battle.params?.game.rounds ?? 10);
  const mine = round?.mine.choice ?? null;
  const myResult = round?.results?.find((r) => r.slot === me);
  useRevealSound(round, closed, out ? null : !!myResult?.right);

  const choose = (c: number) => {
    if (!round || closed || out || mine !== null || answer.state === "loading") return;
    haptic("tap");
    void playSound("tap");
    void answer.send(round.round, c, null);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault();
        choose(0);
      } else if (e.code === "ArrowDown" || e.code === "KeyS") {
        e.preventDefault();
        choose(1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!round || now === null) return <Waiting />;
  const chart = round.chart ?? [];
  const price = chart.at(-1) ?? 0;
  const next = closed ? round.value : null;
  const everyoneWrong =
    closed && round.results !== null && (round.lost ?? []).length === 0 && !round.results.some((r) => r.right);
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4" data-testid="battle-higher">
      <PlayerStrip battle={battle} />
      <RoundCard label={t("higher.round", { n: round.round + 1, total })}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate font-semibold text-fg-1">{round.question}</p>
          <p className="font-pixel nums text-sm text-fg-2">
            {t("higher.now", { price: formatPrice(Math.round(price * 10_000)) })}
          </p>
        </div>
        <div className="relative rounded-md bg-surface-2 p-2">
          <Candles chart={chart} next={next} className="h-36 w-full" />
          <AnimatePresence>
            {closed && next !== null && (
              <motion.p
                initial={{ scale: 1.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ ...SPRING.bouncy }}
                className={cn(
                  "absolute top-2 right-3 rounded-sm px-2 py-0.5 font-pixel text-sm",
                  next >= price ? "bg-gain text-on-semantic" : "bg-loss text-on-semantic",
                )}
              >
                {next >= price ? "▲" : "▼"} {t("higher.next", { price: formatPrice(Math.round(next * 10_000)) })}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        {!closed && <Timer from={Date.parse(round.opensAt)} to={Date.parse(round.closesAt!)} now={now} />}
      </RoundCard>
      <p className="text-center text-sm text-fg-2">{t("higher.question")}</p>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((c) => {
          const chosen = mine === c;
          const right = closed && round.correct === c;
          return (
            <motion.button
              key={c}
              type="button"
              onClick={() => choose(c)}
              disabled={closed || out || mine !== null}
              animate={right ? { scale: [1, 1.05, 1] } : { scale: 1 }}
              transition={{ duration: DURATION.slower, ease: EASE.out }}
              className={cn(
                "flex h-20 items-center justify-center gap-2 rounded-lg border-2 font-pixel text-xl shadow-2 focus-ring",
                "transition-colors duration-fast enabled:active:translate-y-px disabled:cursor-default",
                c === 0 ? "text-gain" : "text-loss",
                right
                  ? c === 0
                    ? "border-gain bg-gain-soft"
                    : "border-loss bg-loss-soft"
                  : chosen
                    ? "border-accent bg-accent-soft"
                    : "border-line-2 bg-surface-1 enabled:hover:border-accent",
                closed && !right && "opacity-50",
              )}
              data-testid="higher-choice"
            >
              <span aria-hidden>{c === 0 ? "▲" : "▼"}</span>
              {c === 0 ? t("higher.up") : t("higher.down")}
            </motion.button>
          );
        })}
      </div>
      <p className="min-h-5 text-center text-sm text-fg-2" aria-live="polite">
        {closed
          ? everyoneWrong
            ? t("higher.everyoneWrong")
            : myResult
              ? myResult.right
                ? `${t("higher.right")} +${myResult.points}`
                : t("higher.wrong")
              : !out
                ? t("higher.none")
                : ""
          : mine !== null
            ? t("higher.chosen", { choice: mine === 0 ? t("higher.up") : t("higher.down") })
            : t("controls.higherKeys")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Wer bietet mehr?

const ITEM_ART: Record<string, PixelArt> = {
  gold_bar: GOLD_BAR,
  bull: BULL,
  moon: MOON,
  briefcase: BRIEFCASE,
  coin: COIN,
  gem: GEM,
  key: KEY,
  gift: GIFT,
  bear: BEAR,
  newspaper: NEWSPAPER,
  alarm_clock: ALARM_CLOCK,
  heart: HEART,
};

export function AuctionGame({ battle, offsetMs, onState }: RoundProps) {
  const { now, round } = useRound(battle, offsetMs);
  const answer = useAnswer(battle, onState);
  if (!round || now === null) return <Waiting />;
  return <AuctionRound key={round.round} battle={battle} round={round} now={now} answer={answer} />;
}

function AuctionRound({
  battle,
  round,
  now,
  answer,
}: {
  battle: Battle;
  round: BattleRound;
  now: number;
  answer: Answer;
}) {
  const t = useTranslations("battle");
  const closed = now >= Date.parse(round.closesAt ?? round.endsAt);
  const me = battle.players.find((p) => p.me)?.slot ?? null;
  const total = Number(battle.params?.game.rounds ?? 6);
  const budget = round.auction?.budget ?? Number(battle.params?.game.budget ?? 1000);
  const [bid, setBid] = useState(0);
  const gavelDone = useRef(false);
  useEffect(() => {
    if (!closed || gavelDone.current) return;
    gavelDone.current = true;
    void playSound("battleGavel");
    haptic("success");
  }, [closed]);

  const item = round.auction;
  const art = ITEM_ART[item?.icon ?? ""] ?? GIFT;
  const sent = round.mine.pressed;
  const results = [...(round.results ?? [])].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const winner = results.find((r) => r.right);
  const step = (d: number) => setBid((b) => Math.max(0, Math.min(budget, b + d)));
  const send = (value: number) => {
    haptic("tap");
    void playSound("tap");
    void answer.send(round.round, null, value);
  };
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4" data-testid="battle-auction">
      <PlayerStrip battle={battle} />
      <RoundCard label={t("auction.round", { n: round.round + 1, total })}>
        <div className="flex items-center gap-4">
          <motion.div
            key={round.round}
            initial={{ y: -16, opacity: 0, scale: 0.8 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ ...SPRING.bouncy }}
            className="grid size-24 shrink-0 place-items-center rounded-md bg-surface-2"
          >
            <PixelIcon {...art} scale={4} />
          </motion.div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-pretty text-fg-1" data-testid="battle-question">
              {round.question}
            </p>
            <p className="font-pixel nums text-2xl text-gold">{t("auction.worth", { points: item?.points ?? 0 })}</p>
          </div>
          <motion.div
            className="shrink-0 origin-bottom-left"
            animate={closed ? { rotate: [0, -35, 12, 0] } : { rotate: 0 }}
            transition={{ duration: DURATION.slow, ease: EASE.out }}
          >
            <PixelIcon {...GAVEL} scale={3} />
          </motion.div>
        </div>
        {!closed && <Timer from={Date.parse(round.opensAt)} to={Date.parse(round.closesAt!)} now={now} />}
      </RoundCard>
      {!closed ? (
        me === null ? null : sent ? (
          <p className="text-center font-pixel text-accent">
            {(round.mine.value ?? 0) > 0
              ? t("auction.sent", { amount: formatInteger(round.mine.value ?? 0) })
              : t("auction.passed")}
          </p>
        ) : (
          <div className="space-y-3 rounded-lg border-2 border-line-2 bg-surface-1 p-4" data-testid="auction-bid">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-fg-3">{t("auction.budget", { amount: formatInteger(budget) })}</span>
              <span className="font-pixel nums text-3xl text-fg-1" data-testid="auction-amount">
                {t("auction.taler", { amount: formatInteger(bid) })}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={budget}
              step={10}
              value={bid}
              onChange={(e) => setBid(Number(e.target.value))}
              className="w-full accent-accent"
              aria-label={t("auction.bid")}
            />
            <div className="flex flex-wrap gap-2">
              {[-50, -10, 10, 50, 100].map((d) => (
                <Button key={d} variant="secondary" size="sm" onClick={() => step(d)}>
                  {d > 0 ? `+${d}` : d}
                </Button>
              ))}
              <Button variant="secondary" size="sm" onClick={() => setBid(budget)}>
                {t("auction.max")}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => send(0)} state={answer.state}>
                {t("auction.pass")}
              </Button>
              <Button onClick={() => send(bid)} state={answer.state} disabled={bid <= 0} data-testid="auction-send">
                {t("auction.bid")}
              </Button>
            </div>
          </div>
        )
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...SPRING.smooth }}
          className="space-y-3 rounded-lg border-2 border-gold bg-surface-1 p-4 shadow-2"
        >
          <p className="text-center font-pixel text-xl text-gold">
            {winner
              ? playerOf(battle, winner.slot)?.me
                ? t("auction.soldYou")
                : t("auction.sold", { name: name(battle, winner.slot, t("you")) })
              : t("auction.nobody")}
          </p>
          <ol className="space-y-1">
            {results.map((r) => {
              const p = playerOf(battle, r.slot);
              return (
                <li
                  key={r.slot}
                  className={cn("flex items-center gap-2 text-sm", r.right && "font-semibold text-gold")}
                >
                  {p && <PlayerFigure avatarKey={p.avatarKey} accessories={p.accessories} scale={1} />}
                  <span className="min-w-0 flex-1 truncate">{p?.me ? t("you") : p?.nickname}</span>
                  <span className="nums">{t("auction.taler", { amount: formatInteger(r.value ?? 0) })}</span>
                  {r.right && <span className="font-pixel nums">+{r.points}</span>}
                </li>
              );
            })}
          </ol>
        </motion.div>
      )}
      {round.auction && round.auction.budgets.length > 0 && (
        <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-2xs text-fg-3">
          {round.auction.budgets.map((b, slot) => (
            <li key={slot} className={cn("nums", slot === me && "font-semibold text-accent")}>
              {name(battle, slot, t("you"))}: {t("auction.taler", { amount: formatInteger(b) })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
