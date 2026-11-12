import { BALANCE, type FloorMaterial, type PropertyTier } from "@/config/balance";
import { CARS, FURNITURE } from "@/config/furniture";
import {
  invalidPlacements,
  propertyValueCents,
  resaleCents,
  tierConfig,
  tierIndex,
  upgradeCostCents,
} from "@/lib/sim/property";
import { GameError, type GameEngine, type PlacedItem, type PropertyState } from "../types";

/*
 * Own home in the offline demo (ADR-082). Everything lives in the demo player's localStorage.
 */
const cfg = BALANCE.property;

export interface HomeState {
  tier: PropertyTier | null;
  wallColor: string;
  floor: FloorMaterial;
  floorsOwned: FloorMaterial[];
  furniture: { id: string; itemKey: string; placed: { x: number; y: number; rot: 0 | 90 } | null }[];
  cars: { id: string; carKey: string; slot: number }[];
  seq: number;
}

export interface PropertyHost {
  home(): HomeState | undefined;
  setHome(state: HomeState): void;
  nickname(): string;
  level(): number;
  cashCents(): number;
  addCash(cents: number): void;
  idempotent<T>(requestId: string, run: () => T): T;
  persist(): void;
}

const fresh = (): HomeState => ({
  tier: null,
  wallColor: cfg.wallColors[0]!,
  floor: "laminate",
  floorsOwned: ["laminate"],
  furniture: [],
  cars: [],
  seq: 0,
});

export function createPropertyEngine(host: PropertyHost) {
  const state = () => {
    let s = host.home();
    if (!s) {
      s = fresh();
      host.setHome(s);
    }
    return s;
  };
  const itemPrice = (key: string) => FURNITURE.find((f) => f.key === key)?.priceCents ?? 0;
  const carPrice = (key: string) => CARS.find((c) => c.key === key)?.priceCents ?? 0;

  function view(): PropertyState {
    const s = state();
    const t = s.tier ? tierConfig(s.tier) : null;
    const prices = [
      ...s.furniture.map((f) => itemPrice(f.itemKey)),
      ...s.cars.map((c) => carPrice(c.carKey)),
      ...s.floorsOwned.map((f) => cfg.floors[f]),
    ];
    return {
      property: {
        owner: host.nickname(),
        tier: s.tier,
        width: t?.width ?? 0,
        height: t?.height ?? 0,
        garageSlots: t?.garageSlots ?? 0,
        wallColor: s.wallColor,
        floor: s.floor,
        floorsOwned: [...s.floorsOwned],
        placed: s.furniture
          .filter((f) => f.placed)
          .map((f): PlacedItem => ({ id: f.id, itemKey: f.itemKey, ...f.placed! })),
        garage: s.cars.map((c) => ({ ...c })),
        valueCents: propertyValueCents(s.tier, prices),
      },
      inventory: {
        furniture: s.furniture.filter((f) => !f.placed).map((f) => ({ id: f.id, itemKey: f.itemKey })),
        cars: [],
      },
    };
  }

  const requireUnlocked = (level: number) => {
    if (host.level() < level) throw new GameError("property_locked");
  };
  const pay = (cents: number) => {
    if (host.cashCents() < cents) throw new GameError("insufficient_funds");
    host.addCash(-cents);
  };
  const done = <T>(value: T) => {
    host.persist();
    return value;
  };

  const engine: Pick<
    GameEngine,
    "property" | "buyHome" | "buyFurniture" | "buyFloor" | "saveLayout" | "buyCar" | "sellItem"
  > = {
    async property(nickname) {
      if (nickname && nickname.toLowerCase() !== host.nickname().toLowerCase()) throw new GameError("player_not_found");
      return view();
    },

    buyHome: (requestId, tier) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          const s = state();
          const target = tierConfig(tier);
          requireUnlocked(target.minLevel);
          if (tierIndex(tier) <= tierIndex(s.tier)) throw new GameError("invalid_tier");
          const cost = upgradeCostCents(s.tier, tier);
          pay(cost);
          s.tier = tier;
          // Moving: everything goes back into the inventory, the cars stay in the garage.
          for (const f of s.furniture) f.placed = null;
          return done({ ...view(), costCents: cost });
        }),
      ),

    buyFurniture: (requestId, itemKey, count) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          requireUnlocked(cfg.tiers[0]!.minLevel);
          const item = FURNITURE.find((f) => f.key === itemKey);
          if (!item || !Number.isInteger(count) || count < 1 || count > 20) throw new GameError("item_not_found");
          pay(item.priceCents * count);
          const s = state();
          for (let i = 0; i < count; i++) {
            s.seq += 1;
            s.furniture.push({ id: `f-${s.seq}`, itemKey, placed: null });
          }
          return done(view());
        }),
      ),

    buyFloor: (requestId, material) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          const s = state();
          if (!(material in cfg.floors)) throw new GameError("invalid_argument");
          if (!s.floorsOwned.includes(material)) {
            pay(cfg.floors[material]);
            s.floorsOwned.push(material);
          }
          return done(view());
        }),
      ),

    saveLayout: (requestId, wallColor, floor, placed) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          const s = state();
          if (!s.tier) throw new GameError("no_home");
          if (!cfg.wallColors.includes(wallColor as never)) throw new GameError("invalid_argument");
          if (!s.floorsOwned.includes(floor)) throw new GameError("floor_not_owned");
          const t = tierConfig(s.tier);
          const byId = new Map(s.furniture.map((f) => [f.id, f]));
          const footprint = (id: string) => {
            const f = byId.get(id);
            const item = f && FURNITURE.find((x) => x.key === f.itemKey);
            return item ? { w: item.w, h: item.h, layer: item.layer } : undefined;
          };
          if (invalidPlacements(placed, footprint, t.width, t.height).length > 0) throw new GameError("layout_invalid");
          for (const f of s.furniture) f.placed = null;
          for (const p of placed) byId.get(p.id)!.placed = { x: p.x, y: p.y, rot: p.rot };
          s.wallColor = wallColor;
          s.floor = floor;
          return done(view());
        }),
      ),

    buyCar: (requestId, carKey) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          const s = state();
          if (!s.tier) throw new GameError("no_home");
          const car = CARS.find((c) => c.key === carKey);
          if (!car) throw new GameError("item_not_found");
          const slots = tierConfig(s.tier).garageSlots;
          if (s.cars.length >= slots) throw new GameError("garage_full");
          pay(car.priceCents);
          const used = new Set(s.cars.map((c) => c.slot));
          const slot = Array.from({ length: slots }, (_, i) => i).find((i) => !used.has(i))!;
          s.seq += 1;
          s.cars.push({ id: `c-${s.seq}`, carKey, slot });
          return done(view());
        }),
      ),

    sellItem: (requestId, kind, id) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          const s = state();
          let refund = 0;
          if (kind === "car") {
            const car = s.cars.find((c) => c.id === id);
            if (!car) throw new GameError("item_not_found");
            refund = resaleCents(carPrice(car.carKey));
            s.cars = s.cars.filter((c) => c.id !== id);
          } else {
            const f = s.furniture.find((x) => x.id === id && !x.placed);
            if (!f) throw new GameError("item_not_found");
            refund = resaleCents(itemPrice(f.itemKey));
            s.furniture = s.furniture.filter((x) => x.id !== id);
          }
          host.addCash(refund);
          return done({ ...view(), refundCents: refund });
        }),
      ),
  };

  return { engine, valueCents: () => view().property.valueCents };
}
