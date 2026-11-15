import { BALANCE, type FloorMaterial, type PropertyTier } from "@/config/balance";
import { FURNITURE } from "@/config/furniture";
import { layoutWohnwert } from "@/features/property/wohnwert";
import { invalidPlacements, rotated, tierConfig, tierIndex, type Placement } from "@/lib/sim/property";
import {
  aiStayHours,
  aiTenantChanceBps,
  hourlyPrice,
  noticeEndMs,
  periodHours,
  rentLimits,
  tenantXp,
} from "@/lib/sim/rentals";
import { createRng, hashSeed } from "@/lib/sim/rng";
import {
  GameError,
  type GameEngine,
  type OwnTenancy,
  type PlacedItem,
  type Property,
  type PropertyRental,
  type RentalOffer,
  type RentalsState,
  type RentPeriodKey,
  type Tenant,
} from "../types";

/*
 * Renting out places in the home in the offline demo (ADR-158): the rules of rentals_run_due(), rent_home() and
 * set_rental_offer() on the server, caught up whenever the demo is looked at. The demo has no other players: three
 * made-up landlords with furnished homes stand in the rental market.
 */
const cfg = BALANCE.rentals;
const HOUR = 3_600_000;

interface DemoTenancy {
  id: string;
  name: string;
  isAi: boolean;
  period: RentPeriodKey;
  priceCents: number;
  startedAt: number;
  nextDueAt: number;
  endsAt: number | null;
  noticeBy: "tenant" | "owner" | null;
  paidCents: number;
}

export interface DemoRentalsState {
  seq: number;
  offer: { period: RentPeriodKey; priceCents: number; isOpen: boolean; aiCheckAt: number } | null;
  tenancies: DemoTenancy[];
  past: { id: string; name: string; isAi: boolean; endedAt: number; endReason: string; paidCents: number }[];
  payments: { at: number; cents: number }[];
  earnedTotalCents: number;
  /** The demo player's own place at a made-up landlord. */
  renting: (DemoTenancy & { owner: string; xpTotal: number }) | null;
}

export interface RentalsHost {
  state(): DemoRentalsState | undefined;
  setState(value: DemoRentalsState): void;
  home(): { tier: PropertyTier | null; floor: FloorMaterial; itemKeys: string[] };
  nickname(): string;
  avatarKey(): string;
  accessories(): string[];
  level(): number;
  cashCents(): number;
  addCash(cents: number): void;
  addXp(base: number): number;
  notify(typeKey: string, title: string, body: string | null, link: string | null): void;
  feed(kind: string, payload: Record<string, unknown>): void;
  track(metric: "rentals_offered" | "tenants_found" | "rent_cents" | "homes_rented", by?: number): void;
  idempotent<T>(requestId: string, run: () => T): T;
  persist(): void;
  now(): number;
}

// ------------------------------------------------------------------ made-up landlords

interface Landlord {
  owner: string;
  avatarKey: string;
  accessories: string[];
  tier: PropertyTier;
  floor: FloorMaterial;
  wallColor: string;
  period: RentPeriodKey;
  items: string[];
  /** AI tenants who live there already. */
  tenants: string[];
}

const LANDLORDS: readonly Landlord[] = [
  {
    owner: "Lena_Loft",
    avatarKey: "chef",
    accessories: ["sunglasses"],
    tier: "apartment",
    floor: "parquet",
    wallColor: "#c8e6c9",
    period: "hour",
    items: [
      "bed_double",
      "sofa_leather",
      "table_oak",
      "bookshelf",
      "kitchen_fridge",
      "kitchen_sink",
      "shower",
      "plant_monstera",
      "armchair_fabric",
      "tv_big",
      "rug_wool",
      "lamp_table",
      "vase_flowers",
      "coffee_maker",
    ],
    tenants: ["Kira T."],
  },
  {
    owner: "Bodo_Bungalow",
    avatarKey: "trucker",
    accessories: ["cowboy_hat"],
    tier: "flat",
    floor: "carpet",
    wallColor: "#ffe0b2",
    period: "day",
    items: [
      "bed_single",
      "sofa_basic",
      "table_pine",
      "kitchen_counter",
      "toilet",
      "plant_small",
      "rug_basic",
      "books_stack",
    ],
    tenants: [],
  },
  {
    owner: "Vicky_Villa",
    avatarKey: "founder",
    accessories: ["party_hat"],
    tier: "house",
    floor: "marble",
    wallColor: "#bfe6ff",
    period: "hour",
    items: [
      "bed_boxspring",
      "sofa_velvet",
      "table_glass",
      "armchair_velvet",
      "kitchen_espresso",
      "bathtub",
      "plant_palm",
      "plant_bonsai",
      "aquarium",
      "gaming_setup",
      "dresser",
      "arcade",
      "rug_fur",
      "laptop",
      "speaker_smart",
      "globe",
    ],
    tenants: ["Luca R.", "Greta W."],
  },
];

const ITEM = new Map(FURNITURE.map((f) => [f.key, f]));

/** Places pieces one by one on the first free spot, rows from the back wall, small things on surfaces. */
export function autoLayout(tier: PropertyTier, keys: readonly string[], seed: string): PlacedItem[] {
  const { width, height } = tierConfig(tier);
  const placed: (Placement & { itemKey: string })[] = [];
  const keyOf = new Map<string, string>();
  const footprint = (id: string) => {
    const f = ITEM.get(keyOf.get(id) ?? "");
    return f ? { w: f.w, h: f.h, layer: f.layer, surface: f.surface } : undefined;
  };
  keys.forEach((key, i) => {
    const f = ITEM.get(key);
    if (!f) return;
    const id = `${seed}-${i}`;
    keyOf.set(id, key);
    // leave a walkway in the middle row for the tenants
    // every other piece from the far corner, so the room fills from both walls
    const back = i % 2 === 1 && f.layer === "object";
    for (const rot of [0, 90] as const) {
      const { w, h } = rotated(f, rot);
      for (let yi = 0; yi + h <= height; yi++) {
        const y = back ? height - h - yi : yi;
        for (let xi = 0; xi + w <= width; xi++) {
          const x = back ? width - w - xi : xi;
          if (f.layer === "object" && y <= Math.floor(height / 2) && y + h > Math.floor(height / 2)) continue;
          const candidate = { id, itemKey: key, x, y, rot };
          if (invalidPlacements([...placed, candidate], footprint, width, height).length === 0) {
            placed.push(candidate);
            return;
          }
        }
      }
    }
  });
  return placed.map((p) => ({ id: p.id, itemKey: p.itemKey, x: p.x, y: p.y, rot: p.rot }));
}

function landlordProperty(l: Landlord): Property {
  const t = tierConfig(l.tier);
  return {
    owner: l.owner,
    tier: l.tier,
    width: t.width,
    height: t.height,
    garageSlots: t.garageSlots,
    wallColor: l.wallColor,
    floor: l.floor,
    floorsOwned: ["laminate", l.floor],
    placed: landlordLayout(l),
    garage: [],
    valueCents: 0,
  };
}

const layouts = new Map<string, PlacedItem[]>();
const landlordLayout = (l: Landlord) => {
  let placed = layouts.get(l.owner);
  if (!placed) {
    placed = autoLayout(l.tier, l.items, l.owner);
    layouts.set(l.owner, placed);
  }
  return placed;
};
const landlordWohnwert = (l: Landlord) =>
  layoutWohnwert(
    l.tier,
    l.floor,
    landlordLayout(l).map((p) => p.itemKey),
  ).total;
/** The made-up landlords ask the fair rent of their home. */
const landlordPrice = (l: Landlord) => rentLimits(l.tier, landlordWohnwert(l), l.period).fairCents;

// ------------------------------------------------------------------ engine

const fresh = (): DemoRentalsState => ({
  seq: 0,
  offer: null,
  tenancies: [],
  past: [],
  payments: [],
  earnedTotalCents: 0,
  renting: null,
});

export function createRentalsEngine(host: RentalsHost) {
  const state = () => {
    let s = host.state();
    if (!s) {
      s = fresh();
      host.setState(s);
    }
    return s;
  };
  const W = () => {
    const h = host.home();
    return h.tier ? layoutWohnwert(h.tier, h.floor, h.itemKeys) : null;
  };
  const rngFor = (s: DemoRentalsState, ...parts: (string | number)[]) => {
    s.seq += 1;
    return createRng(hashSeed(s.seq, "rent", ...parts));
  };
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

  function end(s: DemoRentalsState, t: DemoTenancy, reason: string, at: number) {
    s.tenancies = s.tenancies.filter((x) => x.id !== t.id);
    s.past = [
      { id: t.id, name: t.name, isAi: t.isAi, endedAt: at, endReason: reason, paidCents: t.paidCents },
      ...s.past,
    ].slice(0, 8);
    host.notify("rental_ended", `${t.name} ist ausgezogen`, reasonText(reason), "/property");
  }

  /** Catches up with the clock: due rent, ended tenancies, AI tenants, the own rent elsewhere. */
  function tick() {
    const s = state();
    const now = host.now();
    const home = host.home();
    const w = W()?.total ?? 0;
    let changed = false;
    for (const t of [...s.tenancies]) {
      let n = 0;
      while (t.nextDueAt <= now && (t.endsAt === null || t.nextDueAt < t.endsAt) && n < 48) {
        if (w < cfg.ai.minWohnwert) {
          end(s, t, "ai_unhappy", now);
          break;
        }
        host.addCash(t.priceCents);
        s.payments.push({ at: now, cents: t.priceCents });
        s.earnedTotalCents += t.priceCents;
        t.paidCents += t.priceCents;
        host.track("rent_cents", t.priceCents);
        t.nextDueAt += periodHours(t.period) * HOUR;
        n += 1;
        changed = true;
      }
    }
    for (const t of [...s.tenancies]) {
      if (t.endsAt !== null && t.endsAt <= now && s.tenancies.includes(t)) {
        end(s, t, t.noticeBy === "owner" ? "notice_owner" : "ai_left", now);
        changed = true;
      }
    }
    const offer = s.offer;
    if (offer?.isOpen && offer.aiCheckAt <= now && home.tier) {
      offer.aiCheckAt = now + cfg.ai.checkEveryMinutes * 60_000;
      const free = cfg.places[home.tier] - s.tenancies.length;
      const chance = aiTenantChanceBps(home.tier, w, hourlyPrice(offer.priceCents, offer.period));
      const rng = rngFor(s, "ai", now);
      for (let i = 0; i < free; i++) {
        if (rng.next() * 10_000 >= chance) continue;
        const name = cfg.ai.names[rng.int(0, cfg.ai.names.length - 1)]!;
        const t: DemoTenancy = {
          id: `rt-${s.seq}-${i}`,
          name,
          isAi: true,
          period: offer.period,
          priceCents: offer.priceCents,
          startedAt: now,
          nextDueAt: now + periodHours(offer.period) * HOUR,
          endsAt: now + aiStayHours(rng.next(), offer.period) * HOUR,
          noticeBy: null,
          paidCents: offer.priceCents,
        };
        s.tenancies.push(t);
        host.addCash(offer.priceCents);
        s.payments.push({ at: now, cents: offer.priceCents });
        s.earnedTotalCents += offer.priceCents;
        host.track("rent_cents", offer.priceCents);
        host.track("tenants_found");
        host.notify("rental_new_tenant", `${name} ist eingezogen`, null, "/property");
      }
      changed = true;
    }
    const r = s.renting;
    if (r) {
      const landlord = LANDLORDS.find((l) => l.owner === r.owner);
      let n = 0;
      while (r.nextDueAt <= now && (r.endsAt === null || r.nextDueAt < r.endsAt) && n < 48) {
        if (host.cashCents() < r.priceCents) {
          s.renting = null;
          host.notify("rental_ended", `Mietvertrag bei ${r.owner} beendet`, reasonText("unpaid"), "/property/rentals");
          break;
        }
        host.addCash(-r.priceCents);
        r.paidCents += r.priceCents;
        r.xpTotal += host.addXp(tenantXp(landlord ? landlordWohnwert(landlord) : 0, periodHours(r.period)));
        r.nextDueAt += periodHours(r.period) * HOUR;
        n += 1;
      }
      if (s.renting && r.endsAt !== null && r.endsAt <= now) {
        s.renting = null;
        host.notify(
          "rental_ended",
          `Mietvertrag bei ${r.owner} beendet`,
          reasonText("notice_tenant"),
          "/property/rentals",
        );
      }
      changed = true;
    }
    const weekAgo = now - 7 * 24 * HOUR;
    s.payments = s.payments.filter((p) => p.at > weekAgo);
    if (changed) host.persist();
  }

  const me = (): Tenant => ({
    id: "me",
    name: host.nickname(),
    isAi: false,
    avatarKey: host.avatarKey(),
    accessories: host.accessories(),
    since: iso(state().renting?.startedAt ?? host.now())!,
  });

  const aiTenant = (name: string, since: number, id: string): Tenant => ({
    id,
    name,
    isAi: true,
    avatarKey: null,
    accessories: [],
    since: iso(since)!,
  });

  function landlordTenants(l: Landlord): Tenant[] {
    const list = l.tenants.map((name, i) => aiTenant(name, host.now() - (i + 2) * 7 * HOUR, `${l.owner}-${i}`));
    if (state().renting?.owner === l.owner) list.push(me());
    return list;
  }

  function view(): RentalsState {
    const s = state();
    const h = host.home();
    const w = W();
    const r = s.renting;
    const landlord = r ? LANDLORDS.find((l) => l.owner === r.owner) : undefined;
    return {
      home:
        h.tier && w
          ? {
              tier: h.tier,
              places: cfg.places[h.tier],
              wohnwert: w,
              limits: { hour: rentLimits(h.tier, w.total, "hour"), day: rentLimits(h.tier, w.total, "day") },
            }
          : null,
      offer: s.offer
        ? {
            period: s.offer.period,
            priceCents: s.offer.priceCents,
            isOpen: s.offer.isOpen,
            aiCheckAt: iso(s.offer.aiCheckAt)!,
            chanceBps: h.tier
              ? aiTenantChanceBps(h.tier, w?.total ?? 0, hourlyPrice(s.offer.priceCents, s.offer.period))
              : 0,
          }
        : null,
      tenants: s.tenancies.map((t): OwnTenancy => ({
        ...aiTenant(t.name, t.startedAt, t.id),
        period: t.period,
        priceCents: t.priceCents,
        startedAt: iso(t.startedAt)!,
        nextDueAt: iso(t.nextDueAt)!,
        endsAt: iso(t.endsAt),
        noticeBy: t.noticeBy,
        paidCents: t.paidCents,
      })),
      past: s.past.map((p) => ({ ...p, endedAt: iso(p.endedAt)! })),
      earned7dCents: s.payments.reduce((sum, p) => sum + p.cents, 0),
      earnedTotalCents: s.earnedTotalCents,
      renting:
        r && landlord
          ? {
              id: r.id,
              owner: r.owner,
              ownerAvatarKey: landlord.avatarKey,
              ownerAccessories: landlord.accessories,
              tier: landlord.tier,
              wohnwert: landlordWohnwert(landlord),
              period: r.period,
              priceCents: r.priceCents,
              startedAt: iso(r.startedAt)!,
              nextDueAt: iso(r.nextDueAt)!,
              endsAt: iso(r.endsAt),
              noticeBy: r.noticeBy,
              paidCents: r.paidCents,
              xpTotal: r.xpTotal,
              property: landlordProperty(landlord),
              tenants: landlordTenants(landlord),
            }
          : null,
    };
  }

  /** The "rental" part of the own PROPERTY. */
  function propertyRental(): PropertyRental {
    tick();
    const s = state();
    const h = host.home();
    const r = s.renting;
    const landlord = r ? LANDLORDS.find((l) => l.owner === r.owner) : undefined;
    return {
      wohnwert: W()?.total ?? 0,
      places: h.tier ? cfg.places[h.tier] : 0,
      offerOpen: s.offer?.isOpen ?? false,
      tenants: s.tenancies.map((t) => aiTenant(t.name, t.startedAt, t.id)),
      renting: r && landlord ? { owner: r.owner, tier: landlord.tier } : null,
    };
  }

  function market(): RentalOffer[] {
    const renting = state().renting?.owner;
    return LANDLORDS.map((l) => {
      const tenants = landlordTenants(l);
      return {
        owner: l.owner,
        avatarKey: l.avatarKey,
        accessories: l.accessories,
        tier: l.tier,
        wohnwert: landlordWohnwert(l),
        period: l.period,
        priceCents: landlordPrice(l),
        places: cfg.places[l.tier],
        free: cfg.places[l.tier] - tenants.length,
        property: landlordProperty(l),
        tenants,
      };
    })
      .filter((o) => o.free > 0 || o.owner === renting)
      .sort((a, b) => b.wohnwert - a.wohnwert);
  }

  const requireUnlocked = () => {
    if (host.level() < BALANCE.property.tiers[0]!.minLevel) throw new GameError("property_locked");
  };

  const engine: Pick<GameEngine, "rentals" | "rentalMarket" | "setRentalOffer" | "rentHome" | "endTenancy"> = {
    async rentals() {
      tick();
      return view();
    },
    async rentalMarket() {
      tick();
      return market().filter((o) => o.free > 0);
    },
    setRentalOffer: async (requestId, period, priceCents, open) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          requireUnlocked();
          if (period !== "hour" && period !== "day") throw new GameError("invalid_argument");
          const h = host.home();
          if (!h.tier) throw new GameError("no_home");
          const lim = rentLimits(h.tier, W()?.total ?? 0, period);
          if (!Number.isInteger(priceCents) || priceCents < lim.minCents || priceCents > lim.maxCents)
            throw new GameError("rent_price_out_of_range");
          const s = state();
          const wasOpen = s.offer?.isOpen ?? false;
          s.offer = {
            period,
            priceCents,
            isOpen: open,
            aiCheckAt: open && !wasOpen ? host.now() : (s.offer?.aiCheckAt ?? host.now()),
          };
          if (open && !wasOpen) host.track("rentals_offered");
          tick();
          host.persist();
          return view();
        }),
      ),
    rentHome: async (requestId, owner) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          requireUnlocked();
          if (owner.toLowerCase() === host.nickname().toLowerCase()) throw new GameError("rent_own_home");
          const l = LANDLORDS.find((x) => x.owner.toLowerCase() === owner.toLowerCase());
          if (!l) throw new GameError("player_not_found");
          const s = state();
          if (s.renting) throw new GameError("already_renting");
          if (cfg.places[l.tier] - l.tenants.length <= 0) throw new GameError("rental_full");
          const price = landlordPrice(l);
          if (host.cashCents() < price) throw new GameError("insufficient_funds");
          const now = host.now();
          host.addCash(-price);
          s.renting = {
            id: `rent-${now}`,
            owner: l.owner,
            name: host.nickname(),
            isAi: false,
            period: l.period,
            priceCents: price,
            startedAt: now,
            nextDueAt: now + periodHours(l.period) * HOUR,
            endsAt: null,
            noticeBy: null,
            paidCents: price,
            xpTotal: host.addXp(tenantXp(landlordWohnwert(l), periodHours(l.period))),
          };
          host.track("homes_rented");
          if (tierIndex(l.tier) >= tierIndex(cfg.feedMinTier))
            host.feed("home_rented", { owner: l.owner, tier: l.tier });
          host.persist();
          return view();
        }),
      ),
    endTenancy: async (requestId, tenancyId) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          const s = state();
          const now = host.now();
          if (s.renting?.id === tenancyId) {
            const r = s.renting;
            const at = noticeEndMs(r.startedAt, now, r.period);
            if (r.endsAt === null || at < r.endsAt) Object.assign(r, { endsAt: at, noticeBy: "tenant" });
          } else {
            const t = s.tenancies.find((x) => x.id === tenancyId);
            if (!t) throw new GameError("tenancy_not_found");
            const at = noticeEndMs(t.startedAt, now, t.period);
            if (t.endsAt === null || at < t.endsAt) Object.assign(t, { endsAt: at, noticeBy: "owner" });
          }
          host.persist();
          return view();
        }),
      ),
  };

  return { engine, tick, propertyRental };
}

function reasonText(reason: string): string {
  switch (reason) {
    case "notice_tenant":
      return "Gekündigt vom Mieter.";
    case "notice_owner":
      return "Gekündigt vom Vermieter.";
    case "unpaid":
      return "Die Miete konnte nicht bezahlt werden.";
    case "ai_unhappy":
      return "Zu ungemütlich: Der Wohnwert ist unter das Minimum gefallen.";
    default:
      return "Die Mietzeit ist vorbei.";
  }
}
