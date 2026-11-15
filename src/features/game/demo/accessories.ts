import { catalogItemByKey } from "@/config/accessory-catalog";
import { ACCESSORY_RULES, ACCESSORY_SLOTS, accessoryByKey } from "@/config/accessories";
import { GameError, type GameEngine, type Wardrobe } from "../types";

/*
 * Accessories in the offline demo (ADR-155): the same rules as buy_accessory() / wear_accessory() on the server.
 * Bought once, worn at once, one per slot; money leaves the demo player.
 */
export interface DemoWardrobe {
  owned: string[];
  /** Worn keys, one per slot. */
  worn: string[];
}

export interface AccessoryHost {
  state(): DemoWardrobe | undefined;
  setState(value: DemoWardrobe): void;
  level(): number;
  avatarKey(): string;
  cashCents(): number;
  pay(cents: number): void;
  feed(kind: string, payload: Record<string, unknown>): void;
  idempotent<T>(requestId: string, run: () => T): T;
}

/** Worn keys back to front, one per slot. */
export function sortWorn(worn: readonly string[]): string[] {
  const slotOf = (key: string) => ACCESSORY_SLOTS.indexOf(catalogItemByKey(key)?.slot ?? "pet");
  return [...new Set(worn)].filter((key) => catalogItemByKey(key)).sort((a, b) => slotOf(a) - slotOf(b));
}

export function createAccessoryEngine(
  host: AccessoryHost,
): Pick<GameEngine, "accessories" | "buyAccessory" | "wearAccessory"> & { worn(): string[] } {
  const st = (): DemoWardrobe => host.state() ?? { owned: [], worn: [] };
  const view = (): Wardrobe => ({ owned: [...st().owned], worn: sortWorn(st().worn), avatarKey: host.avatarKey() });
  const wear = (s: DemoWardrobe, key: string): DemoWardrobe => {
    const slot = catalogItemByKey(key)!.slot;
    return { ...s, worn: sortWorn([...s.worn.filter((k) => catalogItemByKey(k)?.slot !== slot), key]) };
  };
  return {
    worn: () => sortWorn(st().worn),
    async accessories() {
      return view();
    },
    buyAccessory: (requestId, key) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          if (catalogItemByKey(key) && !accessoryByKey(key)) throw new GameError("accessory_exclusive");
          const item = accessoryByKey(key);
          if (!item) throw new GameError("accessory_unknown");
          if (host.level() < item.minLevel) throw new GameError("accessory_locked");
          const s = st();
          if (s.owned.includes(key)) throw new GameError("accessory_owned");
          if (host.cashCents() < item.priceCents) throw new GameError("insufficient_funds");
          host.pay(item.priceCents);
          host.setState(wear({ ...s, owned: [...s.owned, key] }, key));
          if ((ACCESSORY_RULES.feedRarities as readonly string[]).includes(item.rarity))
            host.feed("accessory_bought", { key, name: item.name, rarity: item.rarity, price_cents: item.priceCents });
          return { ...view(), paidCents: item.priceCents };
        }),
      ),
    wearAccessory: (requestId, key, on) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          if (!catalogItemByKey(key)) throw new GameError("accessory_unknown");
          const s = st();
          if (!s.owned.includes(key)) throw new GameError("accessory_not_owned");
          host.setState(on ? wear(s, key) : { ...s, worn: s.worn.filter((k) => k !== key) });
          return view();
        }),
      ),
  };
}
