import { NEXAMON_RULES } from "@/config/nexamon-rules";
import { NEXAMON_SETS } from "@/config/nexamon/types";
import { nexamonSetReleased } from "@/lib/sim/nexamon";
import { unlockLevel } from "@/lib/sim/progression";
import type { NexamonPackResult, NexamonSetKey } from "../nexamon-types";
import type { NexamonSealedEngine, NexamonSealedOpenResult, NexamonSealedPack } from "../nexamon-sealed-types";
import { GameError } from "../types";

/*
 * Sealed booster packs in the offline demo (ADR-177), the same rules as public.get_nexamon_sealed_packs,
 * open_nexamon_sealed_pack and buy_nexamon_sealed_pack: won in a news battle or bought to open later; opening one is
 * the pull of a bought pack without paying again.
 */

export interface DemoSealedPack {
  id: string;
  set: NexamonSetKey;
  source: "battle" | "bought";
  priceCents: number;
  createdAt: number;
}

export interface SealedHost {
  list(): DemoSealedPack[];
  setList(packs: DemoSealedPack[]): void;
  level(): number;
  cashCents(): number;
  /** Money leaves the player (to the households). */
  pay(cents: number): void;
  /** The pull of a bought pack, nothing to pay (demo Nexamon engine). */
  open(requestId: string, set: NexamonSetKey, priceCents: number): Promise<NexamonPackResult>;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
}

const cfg = NEXAMON_RULES;
const isSet = (set: string): set is NexamonSetKey => (NEXAMON_SETS as readonly string[]).includes(set);

export function createSealedEngine(host: SealedHost): NexamonSealedEngine & {
  /** Battle prizes: count sealed packs of a set. */
  grantSealed(set: string, count: number, source: "battle" | "bought", priceCents?: number): void;
} {
  const unlocked = () => host.level() >= (unlockLevel("nexamon") ?? 10);
  const requireUnlock = () => {
    if (!unlocked()) throw new GameError("nexamon_locked");
  };
  const view = (p: DemoSealedPack): NexamonSealedPack => ({
    id: p.id,
    set: p.set,
    name: cfg.sets[p.set]?.name ?? p.set,
    source: p.source,
    priceCents: p.priceCents,
    createdAt: new Date(p.createdAt).toISOString(),
  });
  let nextId = 0;
  const grantSealed = (set: string, count: number, source: "battle" | "bought", priceCents = 0) => {
    if (!isSet(set) || count < 1) return;
    const now = host.now();
    const fresh = Array.from({ length: count }, () => ({
      id: `sealed-${now}-${nextId++}`,
      set,
      source,
      priceCents,
      createdAt: now,
    }));
    host.setList([...host.list(), ...fresh]);
  };
  const opened = new Map<string, Promise<NexamonSealedOpenResult>>();

  return {
    grantSealed,
    async nexamonSealedPacks() {
      return { packs: host.list().map(view), unlocked: unlocked() };
    },
    openNexamonSealedPack(requestId, packId) {
      const replay = opened.get(requestId);
      if (replay) return replay;
      const run = (async (): Promise<NexamonSealedOpenResult> => {
        requireUnlock();
        if (!requestId || !packId) throw new GameError("invalid_argument");
        const pack = host.list().find((p) => p.id === packId);
        if (!pack) throw new GameError("sealed_pack_unknown");
        const result = await host.open(requestId, pack.set, pack.priceCents);
        const left = host.list().filter((p) => p.id !== packId);
        host.setList(left);
        return { ...result, sealedId: packId, sealedLeft: left.length };
      })();
      opened.set(requestId, run);
      run.catch(() => opened.delete(requestId));
      return run;
    },
    buyNexamonSealedPack: (requestId, set, count) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          requireUnlock();
          if (!requestId || !Number.isInteger(count) || count < 1 || count > cfg.packs.perMinute)
            throw new GameError("invalid_argument");
          if (!isSet(set)) throw new GameError("nexamon_unknown");
          if (!nexamonSetReleased(set, host.now())) throw new GameError("nexamon_set_not_released");
          const price = cfg.sets[set].packPriceCents;
          if (host.cashCents() < price * count) throw new GameError("insufficient_funds");
          host.pay(price * count);
          grantSealed(set, count, "bought", price);
          return { set, count, priceCents: price * count, packs: host.list().map(view) };
        }),
      ),
  };
}
