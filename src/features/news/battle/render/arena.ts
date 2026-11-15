"use client";

import {
  ARENA,
  BEAR,
  BULL,
  COIN_SPRITE,
  FLAME,
  GOLD_BAR,
  HEART,
  PLANT,
  TOXIC,
  WARN_ARROW,
} from "@/components/pixel/battle-art";
import type { PixelArt } from "@/components/pixel/pixel-icon";
import type { TickKind } from "@/config/battles";
import type { BattleParams } from "@/features/game/battle-types";
import type { AnyBattleState } from "@/lib/sim/battle";
import { bullLength, type BullsState } from "@/lib/sim/battle/bulls";
import { BEAR as BEAR_DROP, GOLD, type CoinsState } from "@/lib/sim/battle/coins";
import type { FloorState } from "@/lib/sim/battle/floor";
import { battleHash } from "@/lib/sim/battle/hash";
import type { PotatoState } from "@/lib/sim/battle/potato";
import type { SumoState } from "@/lib/sim/battle/sumo";
import type { SoundName } from "@/lib/sound";
import type { LockstepView } from "../lockstep";
import { figureArt, sprite, token, type Sprite } from "./sprites";

/*
 * The arena of the action games (ADR-160), drawn on a canvas: everything in whole art pixels into a small buffer
 * (16 px per tile), scaled up by a whole number of device pixels, and the name tags and floating texts sharp on
 * top. Effects (falls, hits, sparkles, shake) come from comparing the predicted state with the one before.
 */

export const TILE = 16;
const HEAD = 16;

export interface RenderPlayer {
  slot: number;
  nickname: string;
  avatarKey: string;
  accessories: string[];
  me: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  gravity: number;
}

interface FloatText {
  text: string;
  x: number;
  y: number;
  born: number;
  color: string;
}

interface Death {
  at: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export interface ArenaRendererOptions {
  kind: Exclude<TickKind, "pump">;
  params: BattleParams;
  players: RenderPlayer[];
  reducedMotion: boolean;
  onShake: (strength: number) => void;
  onSound: (name: SoundName) => void;
}

const rot = (grid: readonly string[], times: number): string[] => {
  let g = [...grid];
  for (let k = 0; k < times; k++) {
    const h = g.length;
    const w = g[0]!.length;
    g = Array.from({ length: w }, (_, x) => Array.from({ length: h }, (_, y) => g[h - 1 - y]![x]).join(""));
  }
  return g;
};
const BULL_DOWN: PixelArt = { palette: BULL.palette, grid: rot(BULL.grid, 1) };
const BULL_UP: PixelArt = { palette: BULL.palette, grid: rot(BULL.grid, 3) };
const ARROW_DOWN: PixelArt = { palette: WARN_ARROW.palette, grid: rot(WARN_ARROW.grid, 1) };
const ARROW_UP: PixelArt = { palette: WARN_ARROW.palette, grid: rot(WARN_ARROW.grid, 3) };
const COIN_THIN: PixelArt = {
  palette: COIN_SPRITE.palette,
  grid: ["...kk...", "..kyyk..", "..kwYk..", "..kwYk..", "..kyYk..", "..kyYk..", "..kYYk..", "...kk..."],
};
const STARS: PixelArt = {
  palette: { y: "#ffd84a", w: "#ffffff" },
  grid: ["y...w...y", ".........", "...y...w."],
};

export function createArenaRenderer(canvas: HTMLCanvasElement, opts: ArenaRendererOptions) {
  const { kind, params } = opts;
  const W = params.w * TILE;
  const H = params.h * TILE + HEAD;
  const buf = document.createElement("canvas");
  buf.width = W;
  buf.height = H;
  const b = buf.getContext("2d")!;
  const out = canvas.getContext("2d")!;
  let k = 2;
  let dpr = 1;
  const particles: Particle[] = [];
  const floats: FloatText[] = [];
  const deaths = new Map<number, Death>();
  let prev: AnyBattleState | null = null;
  let lastFrame = 0;
  let flashUntil = 0;
  const bySlot = new Map(opts.players.map((p) => [p.slot, p]));
  const fontFamily = token("--font-pixel", "monospace") || "monospace";
  const fontSans = token("--font-sans", "sans-serif") || "sans-serif";
  const accent = token("--accent", "#7b5cff");
  const tagBg = "rgba(11, 15, 30, 0.78)";

  const px = (s: Sprite, x: number, y: number, alpha = 1) => {
    if (alpha <= 0) return;
    b.globalAlpha = Math.min(1, alpha);
    b.drawImage(s.canvas, Math.round(x), Math.round(y));
    b.globalAlpha = 1;
  };
  const rect = (x: number, y: number, w: number, h: number, color: string, alpha = 1) => {
    b.globalAlpha = alpha;
    b.fillStyle = color;
    b.fillRect(Math.round(x), Math.round(y), w, h);
    b.globalAlpha = 1;
  };
  const burst = (x: number, y: number, count: number, colors: readonly string[], speed = 1, gravity = 0.06) => {
    const n = opts.reducedMotion ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.4 + Math.random() * 1.4) * speed;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 0.6 * speed,
        life: 0,
        max: 26 + Math.random() * 26,
        color: colors[i % colors.length]!,
        size: Math.random() < 0.3 ? 2 : 1,
        gravity,
      });
    }
  };
  const say = (text: string, x: number, y: number, color: string, now: number) =>
    floats.push({ text, x, y, born: now, color });

  /** Where a player is drawn (feet centre) with the step in between. */
  const posOf = (s: AnyBattleState, i: number, alpha: number) => {
    const p = s.p;
    const st = Math.max(1, p.st[i]!);
    const progress = p.mv[i]! > 0 ? Math.min(1, (st - p.mv[i]! + alpha) / st) : 1;
    const x = p.fx[i]! + (p.x[i]! - p.fx[i]!) * progress;
    const y = p.fy[i]! + (p.y[i]! - p.fy[i]!) * progress;
    return { x: x * TILE + TILE / 2, y: HEAD + y * TILE + TILE - 2, moving: progress < 1 };
  };

  // ------------------------------------------------------------------ floors

  function tileBase(x: number, y: number, a: string, c: string, edge: string, shine: string, dx = 0, dy = 0) {
    const X = x * TILE + dx;
    const Y = HEAD + y * TILE + dy;
    rect(X, Y, TILE, TILE, (x + y) % 2 === 0 ? a : c);
    rect(X, Y, TILE, 1, shine, 0.8);
    rect(X, Y, 1, TILE, shine, 0.4);
    rect(X, Y + TILE - 1, TILE, 1, edge);
    rect(X + TILE - 1, Y, 1, TILE, edge);
  }

  function candle(x: number, y: number, up: boolean, dx = 0, dy = 0) {
    const X = x * TILE + 6 + dx;
    const Y = HEAD + y * TILE + 3 + dy;
    const body = up ? ARENA.candleUp : ARENA.candleDown;
    const dark = up ? ARENA.candleUpDark : ARENA.candleDownDark;
    rect(X + 2, Y, 1, 10, dark);
    rect(X, Y + 2, 5, 6, body);
    rect(X + 4, Y + 2, 1, 6, dark);
  }

  function chartVoid(now: number) {
    rect(0, 0, W, H, ARENA.void);
    for (let y = HEAD; y < H; y += 8) rect(0, y, W, 1, ARENA.voidLine);
    // a stock chart crashing down behind the floor
    const shift = Math.floor(now / 60) % W;
    let last = HEAD + 6;
    for (let x = 0; x < W; x++) {
      const q = (x + shift) % W;
      const v = HEAD + 6 + Math.floor((q / W) * (H - HEAD - 16)) + ((battleHash(7, q, 0) % 7) - 3);
      const from = Math.min(last, v);
      rect(x, from, 1, Math.abs(v - last) + 1, ARENA.chartRedDim);
      last = v;
    }
  }

  function drawFloor(s: FloorState, now: number, alpha: number) {
    chartVoid(now);
    const t = s.tick - 1 + alpha;
    const warn = Number(params.game.warnTicks ?? 24);
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        const c = s.crack[y * s.w + x]!;
        const up = battleHash(s.seed, 11, y * s.w + x) % 3 !== 0;
        if (c === 0) {
          tileBase(x, y, ARENA.tileA, ARENA.tileB, ARENA.tileEdge, ARENA.tileShine);
          candle(x, y, up);
          continue;
        }
        const left = c - t;
        if (left > 0) {
          // cracking: it shakes harder, the candle turns red, the cracks glow
          const urgency = 1 - left / warn;
          const jitter = opts.reducedMotion ? 0 : Math.round(Math.sin(now / 30 + x * 3 + y) * urgency * 1.4);
          tileBase(x, y, ARENA.tileA, ARENA.tileB, ARENA.tileEdge, ARENA.tileShine, jitter, 0);
          candle(x, y, false, jitter, 0);
          const X = x * TILE + jitter;
          const Y = HEAD + y * TILE;
          const glow = Math.floor(now / 120) % 2 === 0 ? ARENA.crack : ARENA.warn;
          for (let i = 0; i < 6; i++) {
            const cx = 2 + ((battleHash(c, x, i) % 12) | 0);
            const cy = 2 + ((battleHash(c, y, i + 9) % 12) | 0);
            rect(X + cx, Y + cy, 2, 1, glow, 0.5 + urgency * 0.5);
            rect(X + cx + 1, Y + cy + 1, 1, 2, ARENA.crackDark, 0.6 + urgency * 0.4);
          }
          rect(X, Y, TILE, TILE, ARENA.crack, 0.08 + urgency * 0.22);
          continue;
        }
        // falling for a moment, then gone
        const fallen = -left * params.tickMs;
        if (fallen < 420) {
          const drop = (fallen / 420) ** 2 * 26;
          tileBase(x, y, ARENA.tileA, ARENA.tileB, ARENA.tileEdge, ARENA.tileShine, 0, drop);
          candle(x, y, false, 0, drop);
          rect(x * TILE, HEAD + y * TILE + drop, TILE, TILE, ARENA.void, fallen / 420);
        }
      }
  }

  function drawSand(s: BullsState) {
    rect(0, 0, W, H, ARENA.frame);
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        const X = x * TILE;
        const Y = HEAD + y * TILE;
        rect(X, Y, TILE, TILE, ARENA.sand);
        for (let i = 0; i < 7; i++) {
          const h = battleHash(3, y * s.w + x, i);
          rect(X + (h % 16), Y + ((h >> 4) % 16), 1, 1, i % 2 ? ARENA.sandDark : ARENA.sandLight);
        }
      }
    rect(0, HEAD - 2, W, 2, ARENA.frameLight);
  }

  function drawBulls(s: BullsState, now: number, alpha: number, layer: "warn" | "bulls") {
    const g = params.game;
    const tpt = Number(g.ticksPerTile ?? 2);
    const warn = Number(g.warnTicks ?? 26);
    const t = s.tick - 1 + alpha;
    for (let k2 = s.first; k2 < s.bulls.length; k2++) {
      const bull = s.bulls[k2]!;
      const len = bullLength(s, bull);
      if (layer === "warn") {
        if (t < bull.t0 - warn || t >= bull.t0) continue;
        const urgency = 1 - (bull.t0 - t) / warn;
        const on = Math.floor(now / (160 - urgency * 100)) % 2 === 0;
        if (bull.line === 0) {
          rect(0, HEAD + bull.idx * TILE, W, TILE, ARENA.loss, on ? 0.18 + urgency * 0.25 : 0.08);
          const ax = bull.dir > 0 ? 1 : W - 9;
          if (on) px(sprite(WARN_ARROW, bull.dir > 0 ? "" : "flip"), ax, HEAD + bull.idx * TILE + 4);
        } else {
          rect(bull.idx * TILE, HEAD, TILE, H - HEAD, ARENA.loss, on ? 0.18 + urgency * 0.25 : 0.08);
          const ay = bull.dir > 0 ? HEAD + 1 : H - 9;
          if (on) px(sprite(bull.dir > 0 ? ARROW_DOWN : ARROW_UP), bull.idx * TILE + 4, ay);
        }
        continue;
      }
      if (t < bull.t0 || t >= bull.t0 + (len + 1) * tpt) continue;
      const kk = (t - bull.t0) / tpt;
      const head = bull.dir > 0 ? kk : len - 1 - kk;
      if (bull.line === 0) {
        const s2 = sprite(BULL, bull.dir > 0 ? "" : "flip");
        const x = (bull.dir > 0 ? head * TILE + TILE - s2.w : head * TILE) + (bull.dir > 0 ? 0 : 0);
        const y = HEAD + bull.idx * TILE + TILE - s2.h - 1;
        rect(x + 2, y + s2.h - 1, s2.w - 4, 2, ARENA.shadow, 0.3);
        px(s2, x, y);
        if (Math.random() < 0.5)
          burst(bull.dir > 0 ? x : x + s2.w, y + s2.h - 1, 1, [ARENA.sandLight, ARENA.sandDark], 0.4, 0.02);
      } else {
        const s2 = sprite(bull.dir > 0 ? BULL_DOWN : BULL_UP);
        const x = bull.idx * TILE + (TILE - s2.w) / 2;
        const y = HEAD + (bull.dir > 0 ? head * TILE + TILE - s2.h : head * TILE);
        px(s2, x, y);
        if (Math.random() < 0.5)
          burst(x + s2.w / 2, bull.dir > 0 ? y : y + s2.h, 1, [ARENA.sandLight, ARENA.sandDark], 0.4, 0.02);
      }
    }
  }

  function drawParquet(w: number, h: number) {
    rect(0, 0, W, H, ARENA.frame);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const X = x * TILE;
        const Y = HEAD + y * TILE;
        rect(X, Y, TILE, TILE, (x + y) % 2 ? ARENA.parquet : ARENA.parquetLight);
        for (let i = 0; i < 4; i++)
          rect(
            X + ((x + y) % 2 ? i * 4 : 0),
            Y + ((x + y) % 2 ? 0 : i * 4),
            (x + y) % 2 ? 1 : TILE,
            (x + y) % 2 ? TILE : 1,
            ARENA.parquetDark,
            0.6,
          );
      }
  }

  function drawDrops(s: CoinsState, now: number, alpha: number, layer: "ground" | "air") {
    const life = Number(params.game.lifeTicks ?? 80);
    const fall = Number(params.game.fallTicks ?? 16);
    const t = s.tick - 1 + alpha;
    for (let k2 = s.first; k2 < s.drops.length; k2++) {
      const d = s.drops[k2]!;
      if (d.taken && t >= d.land) continue;
      const x = (d.tile % s.w) * TILE;
      const y = HEAD + Math.floor(d.tile / s.w) * TILE;
      const art = d.type === BEAR_DROP ? BEAR : d.type === GOLD ? GOLD_BAR : COIN_SPRITE;
      const sp = sprite(art);
      if (t < d.land) {
        const left = d.land - t;
        if (layer === "ground") {
          const size = Math.round(4 + (1 - left / fall) * 8);
          rect(
            x + (TILE - size) / 2,
            y + TILE - 5,
            size,
            3,
            d.type === BEAR_DROP ? ARENA.loss : ARENA.shadow,
            0.35 + (1 - left / fall) * 0.3,
          );
        } else px(sp, x + (TILE - sp.w) / 2, y + TILE - sp.h - 3 - left * 7);
        continue;
      }
      if (layer !== "ground" || d.type === BEAR_DROP || t >= d.land + life) continue;
      const age = t - d.land;
      if (life - age < 20 && Math.floor(now / 90) % 2 === 0) continue;
      const spin = d.type === GOLD ? sp : Math.floor(now / 180 + d.tile) % 4 === 0 ? sprite(COIN_THIN) : sp;
      const bob = opts.reducedMotion ? 0 : Math.round(Math.sin(now / 200 + d.tile) * 1);
      rect(x + 4, y + TILE - 4, 8, 2, ARENA.shadow, 0.3);
      px(spin, x + (TILE - spin.w) / 2, y + TILE - spin.h - 4 + bob);
    }
  }

  function drawSumo(s: SumoState, alpha: number, now: number) {
    rect(0, 0, W, H, ARENA.void);
    const warn = Number(params.game.warnTicks ?? 40);
    const t = s.tick - 1 + alpha;
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        const f = s.fall[y * s.w + x]!;
        if (f === 0) continue;
        const X = x * TILE;
        const Y = HEAD + y * TILE;
        if (t >= f) {
          const fallen = (t - f) * params.tickMs;
          if (fallen < 420) {
            const drop = (fallen / 420) ** 2 * 26;
            rect(X, Y + drop, TILE, TILE, ARENA.tatamiDark, 1 - fallen / 420);
          }
          continue;
        }
        rect(X, Y, TILE, TILE, (x + y) % 2 ? ARENA.tatami : ARENA.tatamiDark);
        rect(X, Y, TILE, 1, ARENA.tatamiLine, 0.5);
        rect(X, Y, 1, TILE, ARENA.tatamiLine, 0.5);
        if (f - t < warn) {
          const on = Math.floor(now / (f - t < warn / 2 ? 80 : 160)) % 2 === 0;
          rect(X, Y, TILE, TILE, on ? ARENA.loss : ARENA.warn, 0.28);
        }
      }
    // the rope along the edge of the ring that is still there
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        const solid = (a: number, c: number) => {
          if (a < 0 || c < 0 || a >= s.w || c >= s.h) return false;
          const f = s.fall[c * s.w + a]!;
          return f > 0 && t < f;
        };
        if (!solid(x, y)) continue;
        const X = x * TILE;
        const Y = HEAD + y * TILE;
        if (!solid(x, y - 1)) rect(X, Y, TILE, 2, ARENA.rope);
        if (!solid(x, y + 1)) rect(X, Y + TILE - 2, TILE, 2, ARENA.ropeDark);
        if (!solid(x - 1, y)) rect(X, Y, 2, TILE, ARENA.rope);
        if (!solid(x + 1, y)) rect(X + TILE - 2, Y, 2, TILE, ARENA.ropeDark);
      }
  }

  function drawOffice(s: PotatoState) {
    rect(0, 0, W, H, ARENA.frame);
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        const X = x * TILE;
        const Y = HEAD + y * TILE;
        rect(X, Y, TILE, TILE, (x + y) % 2 ? ARENA.office : ARENA.officeDark);
        rect(X, Y, TILE, 1, ARENA.officeLine, 0.5);
        rect(X, Y, 1, TILE, ARENA.officeLine, 0.5);
      }
  }

  // ------------------------------------------------------------------ players

  function drawPlayer(s: AnyBattleState, i: number, alpha: number, now: number) {
    const info = bySlot.get(i);
    if (!info) return;
    const fig = sprite(figureArt(info.avatarKey, info.accessories));
    const death = deaths.get(i);
    const pos = posOf(s, i, alpha);
    let x = pos.x - fig.w / 2;
    let y = pos.y - fig.h + 1;
    if (death) {
      const age = (now - death.at) / 900;
      if (age >= 1) return;
      if (kind === "floor") {
        y += age * age * 30;
        px(fig, x, y, 1 - age);
      } else if (kind === "sumo") {
        x += death.dx * age * 22;
        y += death.dy * age * 22 + age * age * 26;
        px(fig, x, y, 1 - age);
      } else if (kind === "bulls") {
        y -= age * 40;
        x += death.dx * age * 18;
        px(sprite(figureArt(info.avatarKey, info.accessories), Math.floor(now / 60) % 2 ? "white" : ""), x, y, 1 - age);
      } else {
        px(sprite(figureArt(info.avatarKey, info.accessories), "dark"), x, y, 1 - age);
      }
      return;
    }
    const bob = pos.moving && !opts.reducedMotion ? (Math.floor(now / 110) % 2 ? -1 : 0) : 0;
    rect(pos.x - 6, pos.y - 1, 12, 3, ARENA.shadow, 0.35);
    if (kind === "potato" && (s as PotatoState).holder === i) {
      rect(pos.x - 9, pos.y - 2, 18, 4, ARENA.toxic, 0.35 + Math.sin(now / 90) * 0.1);
    }
    const stunned = s.p.stun[i]! > 0;
    const blink =
      (kind === "bulls" && (s as BullsState).inv[i]! > 0 && Math.floor(now / 80) % 2 === 0) ||
      (stunned && Math.floor(now / 70) % 3 === 0);
    if (!blink) px(fig, x, y + bob);
    if (stunned) px(sprite(STARS), pos.x - 4, y - 2 + (Math.floor(now / 150) % 2));
    if (info.me) {
      const ay = y - 6 + (opts.reducedMotion ? 0 : Math.round(Math.sin(now / 160)));
      rect(pos.x - 2, ay, 5, 1, accent);
      rect(pos.x - 1, ay + 1, 3, 1, accent);
      rect(pos.x, ay + 2, 1, 1, accent);
    }
    if (kind === "bulls") {
      const hearts = (s as BullsState).hearts[i]!;
      const heart = sprite(HEART);
      for (let h = 0; h < hearts; h++) px(heart, pos.x - (hearts * 8) / 2 + h * 8, y - 14);
    }
    if (kind === "potato" && (s as PotatoState).holder === i) {
      const st = s as PotatoState;
      const left = st.bang - (s.tick - 1 + alpha);
      const shake = opts.reducedMotion ? 0 : left < 40 ? Math.round(Math.sin(now / 25) * 1.5) : 0;
      // held in both hands in front of the chest, the fuse burning on top
      const tox = sprite(TOXIC);
      const tx = pos.x - tox.w / 2 + shake;
      const ty = y + 14;
      px(tox, tx, ty);
      px(sprite(FLAME[Math.floor(now / 90) % 2]!), tx + 4, ty - 4);
      if (Math.random() < 0.6) burst(tx + 6, ty - 2, 1, [ARENA.spark, ARENA.gold], 0.5, 0.03);
    }
  }

  // ------------------------------------------------------------------ effects from the state change

  function events(s: AnyBattleState, now: number, alpha: number) {
    const p0 = prev;
    prev = s;
    if (!p0 || p0.tick > s.tick + 40) return;
    for (let i = 0; i < s.n; i++) {
      const pos = posOf(s, i, alpha);
      if (p0.p.out[i]! < 0 && s.p.out[i]! >= 0 && !deaths.has(i)) {
        deaths.set(i, {
          at: now,
          x: pos.x,
          y: pos.y,
          dx: Math.sign(s.p.x[i]! - s.p.fx[i]!),
          dy: Math.sign(s.p.y[i]! - s.p.fy[i]!),
        });
        const name = bySlot.get(i)?.nickname ?? "";
        if (kind === "potato") {
          burst(pos.x, pos.y - 16, 40, [ARENA.toxic, ARENA.spark, ARENA.gold, ARENA.smoke], 2.2, 0.05);
          flashUntil = now + 140;
          opts.onShake(6);
          opts.onSound("battleBang");
        } else if (kind === "bulls") {
          burst(pos.x, pos.y - 12, 22, [ARENA.loss, ARENA.white, ARENA.sandLight], 1.6);
          opts.onShake(4);
          opts.onSound("battleHit");
        } else {
          burst(pos.x, pos.y, 16, [ARENA.smoke, ARENA.tileShine, ARENA.crack], 1);
          opts.onShake(2);
          opts.onSound("battleFall");
        }
        say(`${name}: RAUS!`, pos.x, pos.y - 34, ARENA.loss, now);
      }
      if (s.p.out[i]! >= 0) continue;
      if (kind === "bulls") {
        const a = (p0 as BullsState).hearts[i]!;
        const c = (s as BullsState).hearts[i]!;
        if (c < a && c > 0) {
          burst(pos.x, pos.y - 12, 14, [ARENA.loss, ARENA.white], 1.4);
          say("AUTSCH!", pos.x, pos.y - 34, ARENA.loss, now);
          opts.onShake(3);
          opts.onSound("battleHit");
        }
      } else if (kind === "coins") {
        const a = (p0 as CoinsState).score[i]!;
        const c = (s as CoinsState).score[i]!;
        if (c > a) {
          burst(pos.x, pos.y - 14, c - a >= 3 ? 14 : 6, [ARENA.gold, ARENA.white, ARENA.goldDark], 1);
          say(`+${c - a}`, pos.x, pos.y - 34, ARENA.gold, now);
          opts.onSound(c - a >= 3 ? "battleGold" : "battleCoin");
        } else if (c < a) {
          burst(pos.x, pos.y - 10, 12, [ARENA.sandDark, ARENA.smoke, ARENA.gold], 1.2);
          say(`−${a - c}`, pos.x, pos.y - 34, ARENA.loss, now);
          opts.onShake(3);
          opts.onSound("battleHit");
        }
      } else if (kind === "sumo") {
        if ((s as SumoState).pushes[i]! > (p0 as SumoState).pushes[i]!) {
          burst(pos.x + (s.p.x[i]! - s.p.fx[i]!) * 10, pos.y - 12, 10, [ARENA.white, ARENA.warn], 1.3);
          opts.onShake(2);
          opts.onSound("battlePush");
        }
      } else if (kind === "potato") {
        const a = p0 as PotatoState;
        const c = s as PotatoState;
        if (c.holder === i && a.holder !== i && a.holder >= 0) {
          burst(pos.x, pos.y - 20, 12, [ARENA.toxic, ARENA.white], 1.2);
          say("DEINS!", pos.x, pos.y - 40, ARENA.toxic, now);
          opts.onSound("battlePass");
        }
      }
    }
    if (kind === "floor") {
      const a = p0 as FloorState;
      const c = s as FloorState;
      let cracked = false;
      for (let tile = 0; tile < c.crack.length; tile++) {
        if (a.crack[tile] === 0 && c.crack[tile]! > 0) cracked = true;
        const f = c.crack[tile]!;
        if (f > 0 && a.tick <= f && c.tick > f) {
          burst(
            (tile % c.w) * TILE + 8,
            HEAD + Math.floor(tile / c.w) * TILE + 8,
            5,
            [ARENA.tileShine, ARENA.crack, ARENA.smoke],
            0.8,
          );
        }
      }
      if (cracked) opts.onSound("battleCrack");
    }
    if (kind === "potato") {
      const a = p0 as PotatoState;
      const c = s as PotatoState;
      if (c.holder >= 0 && a.holder < 0) opts.onSound("battleFuse");
    }
  }

  // ------------------------------------------------------------------ a frame

  function draw(view: LockstepView, now: number) {
    const dt = lastFrame ? Math.min(50, now - lastFrame) / 16.7 : 1;
    lastFrame = now;
    const s = view.state;
    events(s, now, view.alpha);
    b.clearRect(0, 0, W, H);
    if (kind === "floor") drawFloor(s as FloorState, now, view.alpha);
    else if (kind === "bulls") {
      drawSand(s as BullsState);
      drawBulls(s as BullsState, now, view.alpha, "warn");
    } else if (kind === "coins") {
      drawParquet(s.w, s.h);
      drawDrops(s as CoinsState, now, view.alpha, "ground");
    } else if (kind === "sumo") drawSumo(s as SumoState, view.alpha, now);
    else drawOffice(s as PotatoState);

    // walls, players and bulls back to front
    const order: { y: number; draw: () => void }[] = [];
    if (kind === "potato") {
      const st = s as PotatoState;
      st.wall.forEach((w, tile) => {
        if (!w) return;
        const x = (tile % st.w) * TILE;
        const y = HEAD + Math.floor(tile / st.w) * TILE;
        const plant = sprite(PLANT);
        order.push({ y: y + TILE, draw: () => px(plant, x, y + TILE - plant.h) });
      });
    }
    for (let i = 0; i < s.n; i++) {
      if (s.p.out[i]! >= 0 && !deaths.has(i)) continue;
      const pos = posOf(s, i, view.alpha);
      order.push({ y: pos.y, draw: () => drawPlayer(s, i, view.alpha, now) });
    }
    if (kind === "bulls") order.push({ y: H + 1, draw: () => drawBulls(s as BullsState, now, view.alpha, "bulls") });
    order.sort((a, c) => a.y - c.y).forEach((o) => o.draw());
    if (kind === "coins") drawDrops(s as CoinsState, now, view.alpha, "air");

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i]!;
      q.life += dt;
      q.vy += q.gravity * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.life >= q.max) {
        particles.splice(i, 1);
        continue;
      }
      rect(q.x, q.y, q.size, q.size, q.color, 1 - q.life / q.max);
    }
    if (now < flashUntil) rect(0, 0, W, H, ARENA.white, 0.55);
    for (const [slot, d] of deaths) if (now - d.at > 1200) deaths.delete(slot);

    // up to the screen: whole device pixels per art pixel
    out.imageSmoothingEnabled = false;
    out.clearRect(0, 0, canvas.width, canvas.height);
    out.drawImage(buf, 0, 0, W * k, H * k);
    drawTags(s, view.alpha, now);
  }

  function drawTags(s: AnyBattleState, alpha: number, now: number) {
    const size = Math.max(10, Math.round(Math.min(13, 3.2 * k) * dpr));
    out.font = `600 ${Math.round(size * 0.85)}px ${fontSans}`;
    out.textAlign = "center";
    out.textBaseline = "middle";
    for (let i = 0; i < s.n; i++) {
      if (s.p.out[i]! >= 0) continue;
      const info = bySlot.get(i);
      if (!info) continue;
      const pos = posOf(s, i, alpha);
      const name = info.me ? "Du" : info.nickname.length > 11 ? `${info.nickname.slice(0, 10)}…` : info.nickname;
      const w = out.measureText(name).width + size * 0.9;
      const cx = Math.max(w / 2 + 2, Math.min(canvas.width - w / 2 - 2, pos.x * k));
      const cy = Math.min(canvas.height - size * 0.7, (pos.y + 4) * k + size * 0.2);
      out.fillStyle = info.me ? accent : tagBg;
      out.beginPath();
      out.roundRect(cx - w / 2, cy - size * 0.62, w, size * 1.24, size * 0.3);
      out.fill();
      out.fillStyle = "#ffffff";
      out.fillText(name, cx, cy + 0.5);
    }
    out.font = `${Math.round(size * 1.1)}px ${fontFamily}`;
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i]!;
      const age = (now - f.born) / 1000;
      if (age > 1) {
        floats.splice(i, 1);
        continue;
      }
      out.globalAlpha = 1 - age * age;
      out.fillStyle = "#151722";
      const fx = f.x * k;
      const fy = (f.y - age * 14) * k;
      out.fillText(f.text, fx + 2, fy + 2);
      out.fillStyle = f.color;
      out.fillText(f.text, fx, fy);
      out.globalAlpha = 1;
    }
  }

  function resize(widthCss: number, maxHeightCss: number) {
    dpr = window.devicePixelRatio || 1;
    k = Math.max(1, Math.floor(Math.min((widthCss * dpr) / W, (maxHeightCss * dpr) / H)));
    canvas.width = W * k;
    canvas.height = H * k;
    canvas.style.width = `${(W * k) / dpr}px`;
    canvas.style.height = `${(H * k) / dpr}px`;
  }

  return {
    draw,
    resize,
    size: { w: W, h: H },
    /** CSS pixels per art pixel (for overlays). */
    scale: () => k / dpr,
  };
}

export type ArenaRenderer = ReturnType<typeof createArenaRenderer>;
