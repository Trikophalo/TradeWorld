import { ACCESSORIES, type AccessorySlot } from "@/config/accessories";
import { BALANCE } from "@/config/balance";
import { hashSeed } from "@/lib/sim/rng";
import type { FloorMember } from "../types";

/*
 * Made-up coworkers for the company floor in the offline demo (ADR-156). The demo has no other players; at an AI
 * employer a few colleagues stand next to the demo player so the scene and its speech bubbles can be tried. Everything
 * is derived from the employer's name and the clock: the same company always has the same people, and every
 * bubble window one of the online colleagues says something.
 */

const NAMES = ["Mila", "Jonas", "Ayla", "Theo", "Lina", "Emil", "Noah", "Zoe", "Paul", "Ida"] as const;
const LINES = [
  "Kaffee, jemand?",
  "Wer hat meinen Tacker?",
  "Die Zahlen sehen gut aus!",
  "Mittag um zwölf?",
  "Läuft bei uns.",
  "Der Drucker streikt schon wieder.",
  "Gleich Meeting!",
  "Schönes Outfit heute!",
] as const;

export interface DemoCoworker {
  nickname: string;
  avatarKey: string;
  accessories: string[];
  online: boolean;
}

/** Portraits for the colleagues: the cheaper ones, like a real office. */
const PORTRAITS = BALANCE.avatars.portraits.filter((p) => p.level <= 25).map((p) => p.key);

/** One to three accessories in different slots, stable per name. */
export function demoAccessories(name: string): string[] {
  const count = 1 + (hashSeed(7, name, "count") % 3);
  const used = new Set<AccessorySlot>();
  const picked: string[] = [];
  for (let i = 0; picked.length < count && i < 12; i++) {
    const item = ACCESSORIES[hashSeed(11, name, i) % ACCESSORIES.length]!;
    if (used.has(item.slot)) continue;
    used.add(item.slot);
    picked.push(item.key);
  }
  return picked;
}

/** `count` colleagues of a company (never named like the demo player); the last one is away. */
export function demoCoworkers(company: string, me: string, count = 3): DemoCoworker[] {
  const pool = NAMES.filter((n) => n.toLowerCase() !== me.trim().toLowerCase());
  const start = hashSeed(3, company) % pool.length;
  return Array.from({ length: Math.min(count, pool.length) }, (_, i) => {
    const nickname = pool[(start + i) % pool.length]!;
    return {
      nickname,
      avatarKey: PORTRAITS[hashSeed(5, nickname) % PORTRAITS.length] ?? BALANCE.avatars.defaultKey,
      accessories: demoAccessories(nickname),
      online: i < count - 1,
    };
  });
}

/**
 * Who says what right now: every `bubbleSeconds` window one online colleague speaks (from the start of the window).
 */
export function demoChatter(
  coworkers: readonly DemoCoworker[],
  nowMs: number,
  bubbleSeconds: number,
): Map<string, { body: string; at: string }> {
  const online = coworkers.filter((c) => c.online);
  const out = new Map<string, { body: string; at: string }>();
  if (online.length === 0 || bubbleSeconds <= 0) return out;
  const windowMs = bubbleSeconds * 1000;
  const slot = Math.floor(nowMs / windowMs);
  const speaker = online[hashSeed(13, slot) % online.length]!;
  out.set(speaker.nickname, {
    body: LINES[hashSeed(17, slot, speaker.nickname) % LINES.length]!,
    at: new Date(slot * windowMs).toISOString(),
  });
  return out;
}

/** The colleagues as floor members, with the current chatter. */
export function demoCoworkerMembers(coworkers: readonly DemoCoworker[], nowMs: number): FloorMember[] {
  const chatter = demoChatter(coworkers, nowMs, BALANCE.startups.chat.bubbleSeconds);
  return coworkers.map((c) => ({
    nickname: c.nickname,
    avatarKey: c.avatarKey,
    accessories: c.accessories,
    role: "employee",
    title: null,
    online: c.online,
    me: false,
    lastMessage: chatter.get(c.nickname) ?? null,
  }));
}
