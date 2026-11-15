"use client";

import { useEffect, useRef, useState } from "react";
import { isTickKind } from "@/config/battles";
import type { Battle } from "@/features/game/battle-types";
import { engine } from "@/features/game/store";
import { GameError } from "@/features/game/types";
import { openBattleChannel } from "./channel";
import { Lockstep } from "./lockstep";

/*
 * Runs the lockstep of a battle (ADR-160): sends the own inputs to battle_sync every sendEveryMs, merges everyone's
 * streams, broadcasts the own inputs over Realtime and takes the others'. Ends when the server says the battle is
 * over (then `finished` turns true and the page loads the result).
 */
export function useLockstep(battle: Battle, offsetMs: number): { lockstep: Lockstep | null; finished: boolean } {
  const [finished, setFinished] = useState(false);
  const me = battle.players.find((p) => p.me && !p.left)?.slot ?? null;
  // One lockstep per battle: the caller keys its component by the battle id.
  const [lockstep] = useState(() =>
    battle.kind && isTickKind(battle.kind) && battle.params && battle.seed !== null && battle.startedAt
      ? new Lockstep({
          kind: battle.kind,
          seed: battle.seed,
          n: battle.players.filter((p) => p.slot !== null).length,
          mySlot: me,
          params: battle.params,
          startedAtMs: Date.parse(battle.startedAt),
          offsetMs,
        })
      : null,
  );

  useEffect(() => {
    if (!lockstep || battle.status !== "running") return;
    let stopped = false;
    let busy = false;
    const sendEvery = 250;
    const channel =
      me === null ? null : openBattleChannel(battle.id, (slot, from, data) => lockstep.applyPeer(slot, from, data));
    const sync = async () => {
      if (busy || stopped) return;
      busy = true;
      lockstep.record(Date.now());
      const { from, data } = lockstep.chunk();
      const since = lockstep.since;
      const sentAt = Date.now();
      try {
        const r = await engine.syncBattle(battle.id, from, data, since, lockstep.endClaim());
        if (stopped) return;
        lockstep.applySync(r, since, sentAt, Date.now());
        if (r.status !== "running") {
          stopped = true;
          setFinished(true);
        }
      } catch (error) {
        if (error instanceof GameError && error.key === "battle_unknown") {
          stopped = true;
          setFinished(true);
        }
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(() => void sync(), sendEvery);
    const cast = channel
      ? window.setInterval(() => {
          lockstep.record(Date.now());
          const { from, data } = lockstep.recent();
          if (me !== null) channel.send(me, from, data);
        }, 100)
      : null;
    void sync();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      if (cast) window.clearInterval(cast);
      channel?.close();
    };
  }, [lockstep, battle.id, battle.status, me]);

  return { lockstep, finished };
}

const KEYS: Record<string, number> = {
  KeyW: 1,
  ArrowUp: 1,
  KeyD: 2,
  ArrowRight: 2,
  KeyS: 3,
  ArrowDown: 3,
  KeyA: 4,
  ArrowLeft: 4,
};
const ACTION = new Set(["Space", "Enter", "KeyJ", "KeyK", "ShiftLeft", "ShiftRight"]);

/**
 * WASD, arrows and the action key for the lockstep, plus the touch controls (setTouch). The last pressed direction
 * that is still held wins, like on a game pad. While the battle is open, these keys do not scroll the page.
 */
export function useBattleKeys(lockstep: Lockstep | null, onTap?: () => void) {
  const held = useRef<number[]>([]);
  const action = useRef(false);
  const touch = useRef<{ dir: number; action: boolean }>({ dir: 0, action: false });
  const apply = () => {
    const dir = touch.current.dir || held.current.at(-1) || 0;
    lockstep?.setHeld(dir, action.current || touch.current.action);
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const dir = KEYS[e.code];
      if (dir) {
        e.preventDefault();
        if (!held.current.includes(dir)) held.current = [...held.current, dir];
      } else if (ACTION.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) {
          lockstep?.tap();
          onTap?.();
        }
        action.current = true;
      } else return;
      apply();
    };
    const up = (e: KeyboardEvent) => {
      const dir = KEYS[e.code];
      if (dir) held.current = held.current.filter((d) => d !== dir);
      else if (ACTION.has(e.code)) action.current = false;
      else return;
      apply();
    };
    const blur = () => {
      held.current = [];
      action.current = false;
      apply();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply reads refs only
  }, [lockstep, onTap]);
  return {
    setTouch(dir: number, act: boolean) {
      // a press of the touch action counts even when it is shorter than a tick (Laserschranke)
      if (act && !touch.current.action) lockstep?.tap();
      touch.current = { dir, action: act };
      apply();
    },
    tap() {
      lockstep?.tap();
      onTap?.();
    },
  };
}
