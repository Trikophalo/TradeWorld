"use client";

import { ARENA, BEAR, COIN_SPRITE, DEN, EMITTER, GOLD_BAR, HEART, PILLAR } from "@/components/pixel/battle-art";
import type { PixelArt } from "@/components/pixel/pixel-icon";
import type { BattleParams } from "@/features/game/battle-types";
import type { AnyBattleState } from "@/lib/sim/battle";
import { bearStepTicks, type BearState } from "@/lib/sim/battle/bear";
import { dashValue, type DashState } from "@/lib/sim/battle/dash";
import type { ElevatorState } from "@/lib/sim/battle/elevator";
import { battleHash } from "@/lib/sim/battle/hash";
import { laserAt, laserLength, type LaserState } from "@/lib/sim/battle/laser";
import { marginShowTicks, type MarginState } from "@/lib/sim/battle/margin";
import type { SoundName } from "@/lib/sound";
import { createFiveKinds, FIVE_KINDS, isFiveKind } from "./arena-five";
import { sprite, type Sprite } from "./sprites";

/*
 * The arenas of the games of the addendum to ADR-160 (Bärenjagd, Dividenden-Dash, Margin Call, Fahrstuhl zum Mond,
 * Laserschranke), drawn by the arena renderer through this small drawing interface: floors, things on them, the
 * effects of state changes, and where a player stands (jumping, the climbing screen).
 */

export const MORE_KINDS = ["bear", "dash", "margin", "elevator", "laser", ...FIVE_KINDS] as const;
export type MoreKind = (typeof MORE_KINDS)[number];
export const isMoreKind = (kind: string): kind is MoreKind => (MORE_KINDS as readonly string[]).includes(kind);

export interface DrawApi {
  W: number;
  H: number;
  tile: number;
  head: number;
  params: BattleParams;
  reducedMotion: boolean;
  rect(x: number, y: number, w: number, h: number, color: string, alpha?: number): void;
  px(s: Sprite, x: number, y: number, alpha?: number): void;
  pxScaled(s: Sprite, x: number, y: number, scale: number, alpha?: number): void;
  burst(x: number, y: number, count: number, colors: readonly string[], speed?: number, gravity?: number): void;
  say(text: string, x: number, y: number, color: string, now: number): void;
  shake(strength: number): void;
  sound(name: SoundName): void;
  flash(until: number): void;
  tileBase(x: number, y: number, a: string, c: string, edge: string, shine: string, dx?: number, dy?: number): void;
  /** Feet centre of a player on the buffer. */
  posOf(s: AnyBattleState, i: number, alpha: number): { x: number; y: number; moving: boolean };
}

const rot = (grid: readonly string[]): string[] => {
  const h = grid.length;
  const w = grid[0]!.length;
  return Array.from({ length: w }, (_, x) => Array.from({ length: h }, (_, y) => grid[h - 1 - y]![x]).join(""));
};
const EMITTER_DOWN: PixelArt = { palette: EMITTER.palette, grid: rot(EMITTER.grid) };
const BEAR_EAT: PixelArt = {
  palette: BEAR.palette,
  grid: BEAR.grid.map((row, y) => (y === 4 ? row.replace(/rk/g, "kk") : row)),
};

export function createMoreKinds(api: DrawApi) {
  const { W, H, tile: T, head: HEAD, params } = api;
  const g = params.game;
  const num = (key: string, fallback: number) => {
    const v = g[key];
    return typeof v === "number" ? v : fallback;
  };

  // ------------------------------------------------------------------ Bärenjagd

  const bearPos = (s: BearState, k: number, alpha: number) => {
    const t = s.tick - 1 + alpha;
    const st = Math.max(1, s.bst[k]!);
    const progress = Math.max(0, Math.min(1, (t - s.bat[k]!) / st));
    const x = s.bfx[k]! + (s.bx[k]! - s.bfx[k]!) * progress;
    const y = s.bfy[k]! + (s.by[k]! - s.bfy[k]!) * progress;
    return { x: x * T + T / 2, y: HEAD + y * T + T - 2, moving: progress < 1 };
  };

  function bearFloor(s: BearState, now: number) {
    api.rect(0, 0, W, H, ARENA.frame);
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        api.tileBase(x, y, ARENA.marble, ARENA.marbleDark, ARENA.tileEdge, ARENA.marbleVein);
        const h = battleHash(5, y * s.w + x, 0);
        if (h % 3 === 0) api.rect(x * T + (h % 9) + 2, HEAD + y * T + ((h >> 5) % 9) + 3, 4, 1, ARENA.marbleVein, 0.7);
      }
    // the den in the middle, with a red glow while a bear is due
    const den = (g.den as number[] | undefined) ?? [5, 4];
    const dx = den[0]! * T;
    const dy = HEAD + den[1]! * T;
    const next = (g.bearTicks as number[] | undefined)?.[s.bears];
    const due = next !== undefined && next - s.tick < 40;
    if (due) api.rect(dx - 2, dy - 2, T + 4, T + 4, ARENA.loss, 0.18 + 0.12 * Math.sin(now / 80));
    api.px(sprite(DEN), dx, dy + 3);
  }

  function bearThings(s: BearState, now: number, alpha: number, order: { y: number; draw: () => void }[]) {
    s.wall.forEach((w, t) => {
      if (!w) return;
      const x = (t % s.w) * T;
      const y = HEAD + Math.floor(t / s.w) * T;
      const pillar = sprite(PILLAR);
      order.push({ y: y + T, draw: () => api.px(pillar, x + (T - pillar.w) / 2, y + T - pillar.h) });
    });
    for (let k = 0; k < s.bears; k++) {
      const pos = bearPos(s, k, alpha);
      const eating = s.tick < s.beat[k]!;
      order.push({
        y: pos.y + 0.5,
        draw: () => {
          // twice the size of its sprite: as big as a player
          const sp = sprite(eating ? BEAR_EAT : BEAR, s.bx[k]! < s.bfx[k]! ? "flip" : "");
          const bob = pos.moving && !api.reducedMotion ? (Math.floor(now / 90) % 2 ? -2 : 0) : 0;
          api.rect(pos.x - 10, pos.y - 2, 20, 4, ARENA.shadow, 0.4);
          api.pxScaled(sp, pos.x - sp.w, pos.y - sp.h * 2 + 2 + bob, 2);
          if (eating && Math.floor(now / 200) % 2 === 0) {
            api.rect(pos.x + 8, pos.y - sp.h * 2 - 4, 2, 2, ARENA.white, 0.9);
            api.rect(pos.x + 11, pos.y - sp.h * 2 - 8, 3, 3, ARENA.white, 0.7);
          }
          if (!eating && !api.reducedMotion && Math.random() < 0.06)
            api.burst(pos.x, pos.y - 2, 1, [ARENA.sandDark, ARENA.smoke], 0.3, 0.01);
        },
      });
    }
  }

  /** A red "!" over everybody a bear is after. */
  function bearMarks(s: BearState, now: number, alpha: number) {
    for (let k = 0; k < s.bears; k++) {
      const i = s.btarget[k]!;
      if (i < 0 || s.p.out[i]! >= 0 || s.tick < s.beat[k]!) continue;
      const pos = api.posOf(s, i, alpha);
      const near = Math.abs(s.p.x[i]! - s.bx[k]!) + Math.abs(s.p.y[i]! - s.by[k]!) <= 3;
      if (!near && Math.floor(now / 300) % 2) continue;
      const y = pos.y - 44 + (api.reducedMotion ? 0 : Math.round(Math.sin(now / 90)));
      api.rect(pos.x - 1, y, 3, 6, ARENA.loss);
      api.rect(pos.x - 1, y + 8, 3, 2, ARENA.loss);
    }
  }

  function bearEvents(a: BearState, c: BearState, now: number) {
    if (c.bears > a.bears) {
      const den = (g.den as number[] | undefined) ?? [5, 4];
      api.burst(den[0]! * T + T / 2, HEAD + den[1]! * T + 8, 18, [ARENA.sandDark, ARENA.smoke, ARENA.loss], 1.4);
      api.say("BRUMM!", den[0]! * T + T / 2, HEAD + den[1]! * T - 10, ARENA.loss, now);
      api.shake(4);
      api.sound("battleRoar");
    }
    if (bearStepTicks(g as never, c.tick) < bearStepTicks(g as never, a.tick)) api.sound("battleRoar");
  }

  // ------------------------------------------------------------------ Dividenden-Dash

  function bankFloor(s: DashState) {
    api.rect(0, 0, W, H, ARENA.frame);
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        api.tileBase(x, y, ARENA.bank, ARENA.bankDark, ARENA.tileEdge, ARENA.bankLine);
        if ((x + y) % 4 === 0) api.rect(x * T + 7, HEAD + y * T + 7, 2, 2, ARENA.bankLine, 0.8);
      }
  }

  function dashCoins(s: DashState, now: number, alpha: number) {
    const t = s.tick - 1 + alpha;
    const delay = num("spawnDelay", 14);
    for (let c = 0; c < s.ct.length; c++) {
      const tile = s.ct[c]!;
      if (tile < 0) continue;
      const x = (tile % s.w) * T;
      const y = HEAD + Math.floor(tile / s.w) * T;
      const gold = dashValue(g as never, s.cn[c]!) > 1;
      if (t < s.ca[c]!) {
        // about to appear: a ring of sparkles closing in
        const left = (s.ca[c]! - t) / Math.max(1, delay);
        const r = 2 + left * 9;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + now / 300;
          api.rect(x + 8 + Math.cos(a) * r, y + 9 + Math.sin(a) * r * 0.6, 1, 1, gold ? ARENA.gold : ARENA.white, 0.9);
        }
        continue;
      }
      const sp = sprite(gold ? GOLD_BAR : COIN_SPRITE);
      const bob = api.reducedMotion ? 0 : Math.round(Math.sin(now / 180 + tile) * 1.5);
      api.rect(x + 4, y + T - 4, 8, 2, ARENA.shadow, 0.35);
      if (gold) api.rect(x + 1, y + 2, T - 2, T - 4, ARENA.gold, 0.12 + 0.08 * Math.sin(now / 120));
      api.px(sp, x + (T - sp.w) / 2, y + T - sp.h - 5 + bob);
      if (!api.reducedMotion && Math.random() < (gold ? 0.2 : 0.06))
        api.burst(x + 8, y + 6, 1, [ARENA.gold, ARENA.white], 0.3, 0.01);
    }
  }

  function dashEvents(a: DashState, c: DashState, now: number, alpha: number) {
    for (let i = 0; i < c.n; i++) {
      if (c.p.out[i]! >= 0) continue;
      const pos = api.posOf(c, i, alpha);
      const gain = c.score[i]! - a.score[i]!;
      if (gain > 0) {
        api.burst(pos.x, pos.y - 14, gain > 1 ? 16 : 8, [ARENA.gold, ARENA.white, ARENA.goldDark, ARENA.gain], 1.1);
        api.say(gain > 1 ? `SONDERDIVIDENDE +${gain}` : `+${gain}`, pos.x, pos.y - 34, ARENA.gold, now);
        api.sound(gain > 1 ? "battleGold" : "battleCoin");
      }
      if (c.tackles[i]! > a.tackles[i]!) {
        api.burst(
          pos.x + (c.p.face[i] === 2 ? 10 : c.p.face[i] === 4 ? -10 : 0),
          pos.y - 12,
          12,
          [ARENA.white, ARENA.warn],
          1.4,
        );
        api.say("TACKLE!", pos.x, pos.y - 34, ARENA.warn, now);
        api.shake(3);
        api.sound("battlePush");
      }
    }
  }

  // ------------------------------------------------------------------ Margin Call

  function marginFloor(s: MarginState, now: number, alpha: number) {
    api.rect(0, 0, W, H, ARENA.frame);
    const t = s.tick - 1 + alpha;
    const open = s.call >= 0;
    const total = open ? Math.max(1, s.call - s.shown) : 1;
    const left = open ? Math.max(0, s.call - t) / total : 0;
    const sinceCall = (t - s.lastCall) * params.tickMs;
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        const tile = y * s.w + x;
        const safe = s.safe[tile] === 1;
        if (safe && (open || sinceCall < 1500)) {
          // a green candle tile, pulsing faster towards the gong
          const pulse = open ? Math.sin(now / (60 + left * 160)) * 0.5 + 0.5 : 0.2;
          api.tileBase(x, y, ARENA.safe, ARENA.safeDark, ARENA.candleUpDark, ARENA.safeGlow);
          api.rect(x * T + 6, HEAD + y * T + 2, 1, 12, ARENA.candleUpDark);
          api.rect(x * T + 4, HEAD + y * T + 4, 5, 7, ARENA.white, 0.35);
          api.rect(x * T, HEAD + y * T, T, T, ARENA.safeGlow, pulse * 0.25);
        } else {
          api.tileBase(x, y, ARENA.lossFloor, ARENA.lossFloorDark, ARENA.tileEdge, ARENA.lossLine);
          const h = battleHash(9, tile, 0);
          if (h % 4 === 0) api.rect(x * T + 4 + (h % 7), HEAD + y * T + 9, 5, 1, ARENA.chartRedDim);
        }
      }
    // the time to the gong in the head strip
    if (open) {
      api.rect(2, 4, W - 4, 6, ARENA.shadow, 0.5);
      api.rect(3, 5, Math.round((W - 6) * left), 4, left < 0.3 ? ARENA.loss : ARENA.safe);
    } else if (sinceCall < 400) api.rect(0, 0, W, H, ARENA.white, 0.4 * (1 - sinceCall / 400));
  }

  function marginEvents(a: MarginState, c: MarginState, now: number) {
    if (c.call >= 0 && a.call < 0) api.sound("battleWhoosh");
    if (c.round > a.round) {
      api.sound("battleGong");
      api.shake(3);
      let out = false;
      for (let i = 0; i < c.n; i++) if (a.p.out[i]! < 0 && c.p.out[i]! >= 0) out = true;
      if (!out) api.say("ALLE IM GRÜNEN!", W / 2, HEAD + 20, ARENA.safe, now);
    }
    // the last ticks before the gong tick like a clock
    if (c.call >= 0 && c.call - c.tick <= 30 && Math.floor((c.call - c.tick) / 10) < Math.floor((a.call - a.tick) / 10))
      api.sound("battleClick");
  }

  // ------------------------------------------------------------------ Fahrstuhl zum Mond

  /** The camera in rows, gliding into each rise. */
  const camOf = (s: ElevatorState, alpha: number) => {
    const t = s.tick - 1 + alpha;
    const glide = Math.max(0, Math.min(1, (t - s.lastRise) / 6));
    return s.cam - 1 + glide;
  };

  function elevatorFloor(s: ElevatorState, now: number, alpha: number) {
    const cam = camOf(s, alpha);
    // the sky turns into space the higher it goes
    const high = Math.min(1, s.cam / 90);
    api.rect(0, 0, W, H, ARENA.sky);
    api.rect(0, 0, W, H, ARENA.skyHigh, high);
    for (let k = 0; k < 40; k++) {
      const h = battleHash(13, k, 0);
      const sy = ((h >> 8) % (H + 40)) + cam * T * 0.3;
      const y = ((sy % (H + 40)) + H + 40) % (H + 40);
      if (Math.floor(now / 400 + k) % 7 === 0) continue;
      api.rect(h % W, y - 20, 1, 1, ARENA.star, 0.3 + high * 0.6);
    }
    const first = Math.floor(-cam) - 1;
    for (let y = first; y < first + s.h + 2; y++) {
      const sy = HEAD + (y + cam) * T;
      if (sy > H || sy < HEAD - T) continue;
      const r = s.h - 1 - y;
      if (r < 0) continue;
      api.rect(0, sy + T - 1, W, 1, ARENA.chartGrid, 0.8);
      const mask = s.masks[r] ?? 0;
      if (mask === 0) continue;
      for (let x = 0; x < s.w; x++) {
        if ((mask & (1 << x)) !== 0) {
          api.rect(x * T + 4, sy + T - 3, 8, 2, ARENA.safe, 0.25);
          continue;
        }
        const up = battleHash(s.seed, r, x) % 3 !== 0;
        const body = up ? ARENA.candleUp : ARENA.candleDown;
        const dark = up ? ARENA.candleUpDark : ARENA.candleDownDark;
        api.rect(x * T + 7, sy, 2, T, dark);
        api.rect(x * T + 2, sy + 3, 12, 10, body);
        api.rect(x * T + 2, sy + 3, 12, 1, ARENA.white, 0.4);
        api.rect(x * T + 12, sy + 3, 2, 10, dark, 0.7);
      }
    }
    // the bear market rising from below
    const glow = 0.5 + 0.2 * Math.sin(now / 150);
    api.rect(0, H - 10, W, 10, ARENA.loss, glow * 0.6);
    api.rect(0, H - 4, W, 4, ARENA.loss, 0.9);
    for (let x = 0; x < W; x += 6) {
      const h = 2 + ((battleHash(17, x, Math.floor(now / 120)) % 5) | 0);
      api.rect(x, H - 4 - h, 3, h, ARENA.spark, 0.8);
    }
  }

  function elevatorEvents(a: ElevatorState, c: ElevatorState, now: number) {
    if (c.rises > a.rises) {
      const every = (r: number) =>
        Math.max(num("riseMin", 9), num("riseStart", 30) - Math.floor(r / num("riseStepEvery", 2)));
      if (every(c.rises) < every(a.rises) && c.rises % 8 === 0) {
        api.say("SCHNELLER!", W / 2, HEAD + 18, ARENA.gold, now);
        api.sound("battleWhoosh");
      }
    }
  }

  // ------------------------------------------------------------------ Laserschranke

  function labFloor(s: LaserState) {
    api.rect(0, 0, W, H, ARENA.frame);
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        api.tileBase(x, y, ARENA.labFloor, ARENA.labFloorDark, ARENA.void, ARENA.labGrid);
        if ((x + y) % 3 === 0) api.rect(x * T + 7, HEAD + y * T + 7, 2, 2, ARENA.labGrid);
      }
  }

  function laserBeams(s: LaserState, now: number, alpha: number, layer: "warn" | "beam") {
    const tpt = num("ticksPerTile", 2);
    const warn = num("warnTicks", 24);
    const t = s.tick - 1 + alpha;
    for (let k = s.first; k < s.lasers.length; k++) {
      const l = s.lasers[k]!;
      const len = laserLength(s, l);
      const startPos = l.dir > 0 ? 0 : len - 1;
      if (layer === "warn") {
        if (t < l.t0 - warn || t >= l.t0) continue;
        const urgency = 1 - (l.t0 - t) / warn;
        const on = Math.floor(now / (150 - urgency * 90)) % 2 === 0;
        // the emitters on both edges blink, a faint line shows where it starts
        if (l.line === 0) {
          const y = HEAD + startPos * T;
          if (on) api.rect(0, y + 7, W, 2, ARENA.beam, 0.15 + urgency * 0.3);
          api.px(sprite(EMITTER), 0, y + 4, on ? 1 : 0.5);
          api.px(sprite(EMITTER, "flip"), W - 8, y + 4, on ? 1 : 0.5);
        } else {
          const x = startPos * T;
          if (on) api.rect(x + 7, HEAD, 2, H - HEAD, ARENA.beam, 0.15 + urgency * 0.3);
          api.px(sprite(EMITTER_DOWN), x + 4, HEAD, on ? 1 : 0.5);
        }
        continue;
      }
      const at = laserAt(s, l, Math.floor(t), tpt);
      if (at < 0) continue;
      const frac = (t - l.t0) / tpt - Math.floor((t - l.t0) / tpt);
      const smooth = (l.dir > 0 ? at + frac : at + 1 - frac) * T;
      const flicker = api.reducedMotion ? 1 : 0.85 + Math.random() * 0.15;
      if (l.line === 0) {
        const cy = Math.round(HEAD + smooth);
        for (let x = 0; x < s.w; x++) {
          if (x === l.gap) continue;
          api.rect(x * T, cy - 3, T, 6, ARENA.beamGlow, 0.35 * flicker);
          api.rect(x * T, cy - 1, T, 3, ARENA.beam, flicker);
          api.rect(x * T, cy, T, 1, ARENA.beamCore);
        }
        if (!api.reducedMotion && Math.random() < 0.7)
          api.burst(Math.random() * W, cy, 1, [ARENA.beamGlow, ARENA.white], 0.6, 0.02);
      } else {
        const cx = Math.round(smooth);
        for (let y = 0; y < s.h; y++) {
          if (y === l.gap) continue;
          api.rect(cx - 3, HEAD + y * T, 6, T, ARENA.beamGlow, 0.35 * flicker);
          api.rect(cx - 1, HEAD + y * T, 3, T, ARENA.beam, flicker);
          api.rect(cx, HEAD + y * T, 1, T, ARENA.beamCore);
        }
        if (!api.reducedMotion && Math.random() < 0.7)
          api.burst(cx, HEAD + Math.random() * (H - HEAD), 1, [ARENA.beamGlow, ARENA.white], 0.6, 0.02);
      }
    }
  }

  function laserEvents(a: LaserState, c: LaserState, now: number, alpha: number) {
    for (let k = c.first; k < c.lasers.length; k++) {
      const l = c.lasers[k]!;
      if (a.tick <= l.t0 && c.tick > l.t0) api.sound("battleLaser");
    }
    for (let i = 0; i < c.n; i++) {
      if (c.p.out[i]! >= 0) continue;
      const pos = api.posOf(c, i, alpha);
      if (c.jumps[i]! > a.jumps[i]!) api.sound("battleJump");
      if (c.hearts[i]! < a.hearts[i]!) {
        api.burst(pos.x, pos.y - 12, 16, [ARENA.beam, ARENA.white, ARENA.spark], 1.5);
        api.say("ZZZAP!", pos.x, pos.y - 34, ARENA.beam, now);
        api.shake(3);
        api.sound("battleZap");
      }
    }
  }

  // ------------------------------------------------------------------ the interface for arena.ts

  /** The five games of ADR-177 (render/arena-five.ts). */
  const five = createFiveKinds(api);

  return {
    /** Floors and things under everyone. */
    floor(kind: MoreKind, s: AnyBattleState, now: number, alpha: number) {
      if (isFiveKind(kind)) five.floor(kind, s, now, alpha);
      else if (kind === "bear") bearFloor(s as BearState, now);
      else if (kind === "dash") {
        bankFloor(s as DashState);
        dashCoins(s as DashState, now, alpha);
      } else if (kind === "margin") marginFloor(s as MarginState, now, alpha);
      else if (kind === "elevator") elevatorFloor(s as ElevatorState, now, alpha);
      else {
        labFloor(s as LaserState);
        laserBeams(s as LaserState, now, alpha, "warn");
      }
    },
    /** Things sorted with the players (pillars, bears). */
    things(kind: MoreKind, s: AnyBattleState, now: number, alpha: number, order: { y: number; draw: () => void }[]) {
      if (kind === "bear") bearThings(s as BearState, now, alpha, order);
    },
    /** Over everyone (beams, marks). */
    overlay(kind: MoreKind, s: AnyBattleState, now: number, alpha: number) {
      if (isFiveKind(kind)) five.overlay(kind, s, now, alpha);
      if (kind === "laser") laserBeams(s as LaserState, now, alpha, "beam");
      if (kind === "bear") bearMarks(s as BearState, now, alpha);
    },
    events(kind: MoreKind, a: AnyBattleState, c: AnyBattleState, now: number, alpha: number) {
      if (isFiveKind(kind)) five.events(kind, a, c, now, alpha);
      else if (kind === "bear") bearEvents(a as BearState, c as BearState, now);
      else if (kind === "dash") dashEvents(a as DashState, c as DashState, now, alpha);
      else if (kind === "margin") marginEvents(a as MarginState, c as MarginState, now);
      else if (kind === "elevator") elevatorEvents(a as ElevatorState, c as ElevatorState, now);
      else laserEvents(a as LaserState, c as LaserState, now, alpha);
    },
    /** Rows the screen has climbed (Fahrstuhl zum Mond), for where a player is drawn. */
    shiftY(kind: MoreKind, s: AnyBattleState, alpha: number): number {
      return kind === "elevator" ? camOf(s as ElevatorState, alpha) : 0;
    },
    /** How high a player jumps (Laserschranke), in art pixels. */
    lift(kind: MoreKind, s: AnyBattleState, i: number, alpha: number): number {
      if (kind !== "laser") return 0;
      const st = s as LaserState;
      const air = st.air[i]!;
      if (air <= 0) return 0;
      const jump = num("jumpTicks", 8);
      const k = Math.max(0, Math.min(1, (jump - air + alpha) / jump));
      return Math.round(Math.sin(k * Math.PI) * 10);
    },
    /** Hearts over the head (Laserschranke). */
    hearts(kind: MoreKind, s: AnyBattleState, i: number): number {
      if (isFiveKind(kind)) return five.hearts(kind, s, i);
      return kind === "laser" ? (s as LaserState).hearts[i]! : -1;
    },
    heart: () => sprite(HEART),
    /** Where the gong round is (for the HUD). */
    marginLeft(s: MarginState): number {
      return s.call >= 0 ? Math.max(0, s.call - s.tick) : -1;
    },
    marginShow: (round: number) => marginShowTicks(g as never, round),
  };
}

export type MoreKinds = ReturnType<typeof createMoreKinds>;
