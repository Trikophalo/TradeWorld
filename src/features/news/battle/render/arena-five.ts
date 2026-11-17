"use client";

import { ARENA, BEAR, COIN_SPRITE, GOLD_BAR, PAINT_PALETTE } from "@/components/pixel/battle-art";
import type { AnyBattleState } from "@/lib/sim/battle";
import { crashCentres, crashGap, crashHits, type CrashState } from "@/lib/sim/battle/crash";
import { battleHash } from "@/lib/sim/battle/hash";
import type { PaintState } from "@/lib/sim/battle/paint";
import type { TagState } from "@/lib/sim/battle/tag";
import { tilesHole, type TilesState } from "@/lib/sim/battle/tiles";
import { zoneDist, zoneShrinkTick, zoneStartRadius, zoneValue, type ZoneState } from "@/lib/sim/battle/zone";
import type { DrawApi } from "./arena-more";
import { sprite } from "./sprites";

/*
 * The arenas of the five games of ADR-177 (Goldrausch-Zone, Bulle und Bär, Wackelparkett, Farbrausch, Crash-Regen),
 * drawn through the drawing interface of render/arena-more.ts: floors, marks over everyone and the effects of state
 * changes.
 */

export const FIVE_KINDS = ["zone", "tag", "tiles", "paint", "crash"] as const;
export type FiveKind = (typeof FIVE_KINDS)[number];
export const isFiveKind = (kind: string): kind is FiveKind => (FIVE_KINDS as readonly string[]).includes(kind);

export function createFiveKinds(api: DrawApi) {
  const { W, H, tile: T, head: HEAD, params } = api;
  const g = params.game;
  const num = (key: string, fallback: number) => {
    const v = g[key];
    return typeof v === "number" ? v : fallback;
  };
  const tx = (tile: number, w: number) => (tile % w) * T;
  const ty = (tile: number, w: number) => HEAD + Math.floor(tile / w) * T;

  // ------------------------------------------------------------------ Goldrausch-Zone

  function zoneFloor(s: ZoneState, now: number, alpha: number) {
    api.rect(0, 0, W, H, ARENA.void);
    const t = s.tick - 1 + alpha;
    const r0 = zoneStartRadius(s.w, s.h);
    const next = zoneShrinkTick(g as never, r0 - s.r);
    const warn = s.r > num("radiusMin", 1) && next - t < num("warnTicks", 60) && next - t > 0;
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        const d = zoneDist(s, x, y);
        if (d > s.r) {
          api.tileBase(x, y, ARENA.officeDark, ARENA.frame, ARENA.tileEdge, ARENA.frameLight);
          continue;
        }
        api.tileBase(x, y, ARENA.parquet, ARENA.parquetDark, ARENA.tileEdge, ARENA.parquetLight);
        if (d === s.r) {
          // the golden rope at the edge, red and blinking just before it moves in
          const blink = warn && (api.reducedMotion || Math.floor(now / 160) % 2 === 0);
          api.rect(x * T, HEAD + y * T, T, T, blink ? ARENA.loss : ARENA.gold, blink ? 0.45 : 0.16);
        }
      }
    // coins
    for (let c = 0; c < s.ct.length; c++) {
      const tile = s.ct[c]!;
      if (tile < 0) continue;
      const x = tx(tile, s.w);
      const y = ty(tile, s.w);
      const gold = zoneValue(g as never, s.cn[c]!) > 1;
      if (t < s.ca[c]!) {
        api.rect(x + 7, y + 7, 2, 2, gold ? ARENA.gold : ARENA.white, 0.6);
        continue;
      }
      const sp = sprite(gold ? GOLD_BAR : COIN_SPRITE);
      const bob = api.reducedMotion ? 0 : Math.round(Math.sin(now / 180 + tile) * 1.5);
      api.rect(x + 4, y + T - 4, 8, 2, ARENA.shadow, 0.35);
      api.px(sp, x + (T - sp.w) / 2, y + T - sp.h - 5 + bob);
    }
  }

  function zoneEvents(a: ZoneState, c: ZoneState, now: number, alpha: number) {
    if (c.r < a.r) {
      api.shake(4);
      api.flash(now + 80);
      api.sound("battleShrink");
      api.say("ZONE!", W / 2, HEAD + 12, ARENA.loss, now);
    }
    for (let i = 0; i < c.n; i++) {
      if (c.p.out[i]! >= 0) continue;
      const gain = c.score[i]! - a.score[i]!;
      if (gain <= 0) continue;
      const pos = api.posOf(c, i, alpha);
      api.burst(pos.x, pos.y - 14, gain > 1 ? 14 : 6, [ARENA.gold, ARENA.white, ARENA.goldDark], 1);
      api.say(`+${gain}`, pos.x, pos.y - 34, ARENA.gold, now);
      api.sound(gain > 1 ? "battleGold" : "battleCoin");
    }
  }

  // ------------------------------------------------------------------ Bulle und Bär

  function tagFloor(s: TagState) {
    api.rect(0, 0, W, H, ARENA.frame);
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        api.tileBase(x, y, ARENA.bank, ARENA.bankDark, ARENA.tileEdge, ARENA.bankLine);
        const h = battleHash(11, y * s.w + x, 0);
        if (h % 5 === 0) api.rect(x * T + (h % 11) + 2, HEAD + y * T + ((h >> 4) % 10) + 3, 1, 2, ARENA.gain, 0.6);
      }
  }

  function tagMarks(s: TagState, now: number, alpha: number) {
    if (s.bear < 0 || s.p.out[s.bear]! >= 0) return;
    const pos = api.posOf(s, s.bear, alpha);
    // a red glow at the feet and the bear's head over the player's
    api.rect(pos.x - 8, pos.y - 2, 16, 4, ARENA.loss, 0.35 + (api.reducedMotion ? 0 : 0.15 * Math.sin(now / 90)));
    const sp = sprite(BEAR);
    const bob = api.reducedMotion ? 0 : Math.floor(now / 200) % 2;
    api.px(sp, pos.x - sp.w / 2, pos.y - 46 - sp.h + bob);
  }

  function tagEvents(a: TagState, c: TagState, now: number, alpha: number) {
    if (c.bear === a.bear || c.bear < 0) return;
    const pos = api.posOf(c, c.bear, alpha);
    api.burst(pos.x, pos.y - 14, 18, [ARENA.loss, ARENA.white, ARENA.sandDark], 1.4);
    api.say("BÄR!", pos.x, pos.y - 40, ARENA.loss, now);
    api.shake(3);
    api.sound("battleTag");
  }

  // ------------------------------------------------------------------ Wackelparkett

  function tilesFloor(s: TilesState, now: number, alpha: number) {
    api.rect(0, 0, W, H, ARENA.void);
    for (let y = HEAD; y < H; y += 8) api.rect(0, y, W, 1, ARENA.voidLine);
    const t = s.tick - 1 + alpha;
    for (let tile = 0; tile < s.crack.length; tile++) {
      const x = tile % s.w;
      const y = Math.floor(tile / s.w);
      if (tilesHole(s, tile, Math.floor(t))) {
        // a hole that grows back: the last ticks show it shimmering in
        const left = s.hole[tile]! - t;
        if (left < 20) api.rect(x * T + 1, HEAD + y * T + 1, T - 2, T - 2, ARENA.tileShine, (20 - left) / 40);
        continue;
      }
      const c = s.crack[tile]!;
      const left = c >= 0 ? c - t : Infinity;
      const shake = left < 10 && !api.reducedMotion ? (Math.floor(now / 50) % 2 ? 1 : -1) : 0;
      api.tileBase(x, y, ARENA.tileA, ARENA.tileB, ARENA.tileEdge, ARENA.tileShine, shake, 0);
      if (c >= 0) {
        const X = x * T + shake;
        const Y = HEAD + y * T;
        api.rect(X + 3, Y + 4, 6, 1, ARENA.crack, 0.9);
        api.rect(X + 8, Y + 5, 1, 5, ARENA.crack, 0.9);
        if (left < 20) api.rect(X + 4, Y + 10, 8, 1, ARENA.crack, 0.9);
        if (left < 10) api.rect(X, Y, T, T, ARENA.crackDark, 0.35);
      }
    }
  }

  function tilesEvents(a: TilesState, c: TilesState, now: number) {
    let broke = 0;
    for (let tile = 0; tile < c.hole.length; tile++) {
      if (c.hole[tile]! > c.tick - 1 && !(a.hole[tile]! > a.tick - 1)) {
        broke++;
        if (broke <= 4)
          api.burst(tx(tile, c.w) + 8, ty(tile, c.w) + 8, 5, [ARENA.tileShine, ARENA.crack, ARENA.smoke], 0.8);
      }
    }
    if (broke > 0) api.sound("battleCrack");
    void now;
  }

  // ------------------------------------------------------------------ Farbrausch

  function paintFloor(s: PaintState) {
    api.rect(0, 0, W, H, ARENA.frame);
    for (let tile = 0; tile < s.own.length; tile++) {
      const x = tile % s.w;
      const y = Math.floor(tile / s.w);
      const o = s.own[tile]!;
      if (o < 0) {
        api.tileBase(x, y, ARENA.office, ARENA.officeDark, ARENA.tileEdge, ARENA.officeLine);
        continue;
      }
      const light = PAINT_PALETTE.light[o % PAINT_PALETTE.light.length]!;
      const dark = PAINT_PALETTE.dark[o % PAINT_PALETTE.dark.length]!;
      api.tileBase(x, y, light, light, dark, ARENA.white);
      // drips of paint
      const h = battleHash(13, tile, o);
      api.rect(x * T + (h % 10) + 2, HEAD + y * T + ((h >> 5) % 9) + 3, 2, 2, dark, 0.7);
    }
  }

  function paintMarks(s: PaintState, alpha: number) {
    // the own colour under each player, so everyone knows theirs
    for (let i = 0; i < s.n; i++) {
      if (s.p.out[i]! >= 0) continue;
      const pos = api.posOf(s, i, alpha);
      const light = PAINT_PALETTE.light[i % PAINT_PALETTE.light.length]!;
      const dark = PAINT_PALETTE.dark[i % PAINT_PALETTE.dark.length]!;
      api.rect(pos.x - 6, pos.y + 1, 12, 2, dark);
      api.rect(pos.x - 5, pos.y + 1, 10, 1, light);
    }
  }

  function paintEvents(a: PaintState, c: PaintState, now: number, alpha: number) {
    for (let i = 0; i < c.n; i++) {
      if (c.bombs[i]! <= a.bombs[i]!) continue;
      const pos = api.posOf(c, i, alpha);
      const light = PAINT_PALETTE.light[i % PAINT_PALETTE.light.length]!;
      const dark = PAINT_PALETTE.dark[i % PAINT_PALETTE.dark.length]!;
      api.burst(pos.x, pos.y - 8, 30, [light, dark, ARENA.white], 1.8, 0.08);
      api.say("SPLASH!", pos.x, pos.y - 36, light, now);
      api.shake(2);
      api.sound("battleSplat");
    }
  }

  // ------------------------------------------------------------------ Crash-Regen

  function crashFloor(s: CrashState) {
    api.rect(0, 0, W, H, ARENA.frame);
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++)
        api.tileBase(x, y, ARENA.lossFloor, ARENA.lossFloorDark, ARENA.tileEdge, ARENA.lossLine);
  }

  /** The waves announced but not hit yet: their tiles blink, a red chart arrow falls towards each centre. */
  function crashWarnings(s: CrashState, now: number, alpha: number) {
    const t = s.tick - 1 + alpha;
    const warn = num("warnTicks", 30);
    let k = s.hit;
    let at = s.hitAt;
    while (at <= t) {
      const left = at + warn - t;
      const centres = crashCentres(s.seed, g as never, s.n, s.w, s.h, k);
      const blink = api.reducedMotion || Math.floor(now / (left < 10 ? 70 : 140)) % 2 === 0;
      for (let y = 0; y < s.h; y++)
        for (let x = 0; x < s.w; x++) {
          if (!centres.some((c) => crashHits(s.w, c, x, y))) continue;
          api.rect(x * T + 1, HEAD + y * T + 1, T - 2, T - 2, ARENA.loss, blink ? 0.45 : 0.22);
        }
      for (const c of centres) {
        const X = tx(c, s.w) + T / 2;
        const Y = ty(c, s.w) + T / 2;
        const fall = Math.max(0, Math.min(1, 1 - left / warn));
        // the falling crash: a red candle coming down from the top
        const cy = HEAD - 10 + (Y - HEAD + 6) * fall;
        api.rect(X - 2, cy - 8, 4, 8, ARENA.candleDown);
        api.rect(X - 1, cy - 12, 2, 14, ARENA.candleDownDark);
        api.rect(X - 4, Y - 1, 8, 2, ARENA.white, 0.3 + 0.4 * fall);
      }
      at += crashGap(g as never, k);
      k += 1;
    }
  }

  function crashEvents(a: CrashState, c: CrashState, now: number, alpha: number) {
    if (c.hit > a.hit) {
      for (const centre of crashCentres(c.seed, g as never, c.n, c.w, c.h, a.hit))
        api.burst(tx(centre, c.w) + 8, ty(centre, c.w) + 8, 10, [ARENA.loss, ARENA.spark, ARENA.smoke], 1.4);
      api.shake(4);
      api.sound("battleImpact");
    }
    for (let i = 0; i < c.n; i++) {
      if (c.p.out[i]! >= 0 || c.hearts[i]! >= a.hearts[i]!) continue;
      const pos = api.posOf(c, i, alpha);
      api.burst(pos.x, pos.y - 12, 14, [ARENA.loss, ARENA.white], 1.4);
      api.say("CRASH!", pos.x, pos.y - 34, ARENA.loss, now);
      api.sound("battleHit");
    }
  }

  // ------------------------------------------------------------------ the interface for arena-more.ts

  return {
    floor(kind: FiveKind, s: AnyBattleState, now: number, alpha: number) {
      if (kind === "zone") zoneFloor(s as ZoneState, now, alpha);
      else if (kind === "tag") tagFloor(s as TagState);
      else if (kind === "tiles") tilesFloor(s as TilesState, now, alpha);
      else if (kind === "paint") paintFloor(s as PaintState);
      else {
        crashFloor(s as CrashState);
        crashWarnings(s as CrashState, now, alpha);
      }
    },
    overlay(kind: FiveKind, s: AnyBattleState, now: number, alpha: number) {
      if (kind === "tag") tagMarks(s as TagState, now, alpha);
      if (kind === "paint") paintMarks(s as PaintState, alpha);
    },
    events(kind: FiveKind, a: AnyBattleState, c: AnyBattleState, now: number, alpha: number) {
      if (kind === "zone") zoneEvents(a as ZoneState, c as ZoneState, now, alpha);
      else if (kind === "tag") tagEvents(a as TagState, c as TagState, now, alpha);
      else if (kind === "tiles") tilesEvents(a as TilesState, c as TilesState, now);
      else if (kind === "paint") paintEvents(a as PaintState, c as PaintState, now, alpha);
      else crashEvents(a as CrashState, c as CrashState, now, alpha);
    },
    hearts(kind: FiveKind, s: AnyBattleState, i: number): number {
      return kind === "crash" ? (s as CrashState).hearts[i]! : -1;
    },
  };
}
