"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { TickKind } from "@/config/battles";
import type { Battle } from "@/features/game/battle-types";
import type { BullsState } from "@/lib/sim/battle/bulls";
import type { CoinsState } from "@/lib/sim/battle/coins";
import type { PotatoState } from "@/lib/sim/battle/potato";
import type { SumoState } from "@/lib/sim/battle/sumo";
import { aliveCount } from "@/lib/sim/battle/core";
import { formatCountdown } from "@/lib/format";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/stores/settings";
import { Hearts } from "./parts";
import { createArenaRenderer, type ArenaRenderer } from "./render/arena";
import { TouchPad } from "./touch-pad";
import { useBattleKeys, useLockstep } from "./use-lockstep";
import type { Lockstep } from "./lockstep";

/*
 * An action game of a news battle (ADR-160): the arena canvas at 60 fps from the predicted lockstep state, a HUD
 * (time, who is left, own hearts, coins or shoves) and the touch controls on phones.
 */

interface Hud {
  alive: number;
  leftMs: number;
  out: boolean;
  hearts: number;
  score: number;
  board: { slot: number; score: number }[];
  holder: number;
  idle: boolean;
}

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(pointer: coarse)");
    const set = () => setCoarse(q.matches);
    set();
    q.addEventListener("change", set);
    return () => q.removeEventListener("change", set);
  }, []);
  return coarse;
}

export function ArenaGame({
  battle,
  offsetMs,
  onFinished,
  onLockstep,
}: {
  battle: Battle;
  offsetMs: number;
  onFinished: () => void;
  onLockstep?: (lockstep: Lockstep | null) => void;
}) {
  const t = useTranslations("battle");
  const kind = battle.kind as Exclude<TickKind, "pump">;
  const { lockstep, finished } = useLockstep(battle, offsetMs);
  const keys = useBattleKeys(lockstep);
  const coarse = useCoarsePointer();
  const wrap = useRef<HTMLDivElement>(null);
  const shake = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const me = lockstep?.mySlot ?? null;
  const names = new Map(battle.players.map((p) => [p.slot, p.me ? t("you") : p.nickname]));

  useEffect(() => onLockstep?.(lockstep), [lockstep, onLockstep]);
  useEffect(() => {
    if (finished) onFinished();
  }, [finished, onFinished]);

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box || !lockstep || !battle.params) return;
    const reduced = prefersReducedMotion();
    let shakeUntil = 0;
    let strength = 0;
    const renderer: ArenaRenderer = createArenaRenderer(el, {
      kind,
      params: battle.params,
      players: battle.players
        .filter((p) => p.slot !== null)
        .map((p) => ({
          slot: p.slot!,
          nickname: p.nickname,
          avatarKey: p.avatarKey,
          accessories: p.accessories,
          me: p.me,
        })),
      reducedMotion: reduced,
      onShake: (s) => {
        if (reduced) return;
        strength = Math.max(strength, s);
        shakeUntil = performance.now() + 260;
      },
      onSound: (name) => void playSound(name),
    });
    const fit = () => {
      const width = box.clientWidth;
      const height = Math.max(200, window.innerHeight - (coarse ? 330 : 200));
      renderer.resize(width, height);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    let frame = 0;
    let lastHud = 0;
    const loop = () => {
      const now = Date.now();
      lockstep.record(now);
      const view = lockstep.view(now);
      renderer.draw(view, performance.now());
      const s = shake.current;
      if (s) {
        const left = shakeUntil - performance.now();
        if (left > 0) {
          const a = (strength * left) / 260;
          s.style.transform = `translate(${Math.round((Math.random() - 0.5) * a)}px, ${Math.round((Math.random() - 0.5) * a)}px)`;
        } else if (s.style.transform) {
          s.style.transform = "";
          strength = 0;
        }
      }
      if (now - lastHud > 120) {
        lastHud = now;
        const st = view.state;
        const total = lockstep.maxTicks * lockstep.params.tickMs;
        const elapsed = Math.max(0, now + lockstep.offsetMs - Date.parse(battle.startedAt!));
        const board =
          kind === "coins"
            ? (st as CoinsState).score.map((score, slot) => ({ slot, score })).sort((a, b) => b.score - a.score)
            : [];
        setHud({
          alive: aliveCount(st.p),
          leftMs: Math.max(0, total - elapsed),
          out: me !== null && st.p.out[me]! >= 0,
          hearts: kind === "bulls" && me !== null ? (st as BullsState).hearts[me]! : 0,
          score:
            me === null
              ? 0
              : kind === "coins"
                ? (st as CoinsState).score[me]!
                : kind === "sumo"
                  ? (st as SumoState).pushes[me]!
                  : 0,
          board,
          holder: kind === "potato" ? (st as PotatoState).holder : -1,
          idle: kind === "floor" && me !== null && st.p.out[me]! < 0 && st.p.idle[me]! > 30,
        });
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [lockstep, battle.params, battle.players, battle.startedAt, kind, me, coarse]);

  const actionLabel = kind === "sumo" ? t("controls.actionButton") : null;
  const heartsMax = Number(battle.params?.game.hearts ?? 3);

  return (
    <div className="flex h-full w-full flex-col items-center gap-2" data-testid="battle-arena" data-kind={kind}>
      <div className="flex w-full max-w-3xl items-center justify-between gap-3 px-1 text-sm" data-testid="battle-hud">
        <span className="font-pixel nums text-fg-1">{hud ? formatCountdown(hud.leftMs / 1000) : "--:--"}</span>
        <span className="min-w-0 flex-1 truncate text-center text-xs text-fg-2">
          {hud?.out
            ? t("hud.eliminated")
            : me === null
              ? t("hud.spectating")
              : kind === "potato" && hud && hud.holder >= 0
                ? hud.holder === me
                  ? t("hud.pass")
                  : t("hud.holder", { name: names.get(hud.holder) ?? "?" })
                : hud?.idle
                  ? t("hud.warn")
                  : t(`games.${kind}.tagline`)}
        </span>
        <span className="flex items-center gap-2 text-xs text-fg-2">
          {kind === "bulls" && me !== null && hud && <Hearts count={hud.hearts} max={heartsMax} />}
          {kind === "coins" && me !== null && hud && (
            <span className="font-pixel nums text-gold">{t("hud.coins", { count: hud.score })}</span>
          )}
          {kind === "sumo" && me !== null && hud && (
            <span className="nums">{t("hud.pushes", { count: hud.score })}</span>
          )}
          <span className="font-pixel nums text-fg-1">
            {t("hud.alive", { count: hud?.alive ?? battle.players.length })}
          </span>
        </span>
      </div>
      {kind === "coins" && hud && (
        <ol
          className="flex w-full max-w-3xl flex-wrap justify-center gap-x-3 gap-y-1 text-2xs text-fg-3"
          aria-label={t("hud.coins", { count: "" })}
        >
          {hud.board.slice(0, 5).map((r, i) => (
            <li key={r.slot} className={cn("nums", r.slot === me && "font-semibold text-gold")}>
              {i + 1}. {names.get(r.slot)} {r.score}
            </li>
          ))}
        </ol>
      )}
      <div ref={wrap} className="grid w-full flex-1 content-start justify-items-center lg:content-center">
        <div ref={shake} className="rounded-sm shadow-3 ring-2 ring-line-2">
          <canvas ref={canvas} className="block pixelated" aria-label={t(`games.${kind}.name`)} role="img" />
        </div>
      </div>
      {me !== null && !hud?.out && (
        <>
          {coarse ? (
            <TouchPad className="w-full max-w-sm px-4 pb-2" onChange={keys.setTouch} action={actionLabel} />
          ) : (
            <p className="text-2xs text-fg-3">
              {t("controls.keys")}
              {kind === "sumo" ? ` · ${t("controls.action")}` : ""}
            </p>
          )}
        </>
      )}
    </div>
  );
}
