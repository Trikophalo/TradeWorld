import { BALANCE } from "@/config/balance";
import { GALLERY_ARTWORKS } from "@/config/gallery";
import { hasForbiddenSymbol } from "@/lib/sim/logo";
import {
  artworkCode,
  artworkCreateCostCents,
  endAfterBid,
  hotScore,
  isValidArtwork,
  minNextBidCents,
  sellerProceedsCents,
} from "@/lib/sim/artworks";
import { GameError, type Artwork, type ArtworkPixels, type GameEngine, type GameErrorKey } from "../types";

/*
 * Artworks in the offline demo (ADR-080). The gallery auctions a few works at a time; AI collectors (the tycoons)
 * bid now and then, so prices move and auctions feel alive. Everything the player owns is kept in localStorage.
 */
const cfg = BALANCE.artworks;
const HOUR = 3_600_000;
const STEP = 10 * 60_000;

interface DemoAuction {
  id: string;
  artworkId: string;
  seller: string | null;
  startCents: number;
  endsAt: number;
  currentCents: number | null;
  leader: string | null;
  bids: { nickname: string; amountCents: number; at: number }[];
  simulatedUntil: number;
  /** What the AI collectors are willing to pay at most. */
  ceilingCents: number;
}

interface DemoArtwork {
  id: string;
  serial: number;
  title: string;
  origin: "game" | "player";
  rarity: Artwork["rarity"];
  creator: string | null;
  owner: string | null;
  pixels: ArtworkPixels;
  valueCents: number | null;
  baseLikes: number;
  createdAt: number;
  sales: { at: number; priceCents: number; seller: string | null; buyer: string }[];
}

export interface ArtState {
  /** Artworks that changed since the start: sold gallery works and everything the player painted. */
  works: DemoArtwork[];
  auctions: DemoAuction[];
  likes: string[];
  painted: number;
  /** Day keys for which the gallery auctions were started. */
  galleryDays: string[];
  seq: number;
}

export interface ArtHost {
  art(): ArtState | undefined;
  setArt(state: ArtState): void;
  nickname(): string;
  level(): number;
  cashCents(): number;
  addCash(cents: number): void;
  collectors(): string[];
  nameViolation(name: string): string | null;
  day(at?: number): string;
  idempotent<T>(requestId: string, run: () => T): T;
  persist(): void;
  /** Mission counters (art_likes, art_bids, artworks_painted, auctions_started). */
  track(metric: "art_likes" | "art_bids" | "artworks_painted" | "auctions_started"): void;
}

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
/** Deterministic number in [0, 1) from a text (the demo has no server randomness to share). */
const unit = (text: string) => (hash(text) % 100_000) / 100_000;

/** The world start: gallery works as of the first visit of the demo. */
function galleryWorks(start: number): DemoArtwork[] {
  return GALLERY_ARTWORKS.map((g, i) => ({
    id: g.key,
    serial: i + 1,
    title: g.title,
    origin: "game",
    rarity: g.rarity,
    creator: null,
    owner: null,
    pixels: { palette: [...g.palette], grid: [...g.grid] },
    valueCents: null,
    baseLikes: Math.floor(unit(`${g.key}:likes`) * (g.rarity === "legendary" ? 60 : g.rarity === "rare" ? 25 : 12)),
    createdAt: start - (i + 1) * 5 * HOUR,
    sales: [],
  }));
}

export function createArtEngine(host: ArtHost) {
  const state = (): ArtState => {
    let s = host.art();
    if (!s) {
      s = { works: [], auctions: [], likes: [], painted: 0, galleryDays: [], seq: 0 };
      host.setArt(s);
    }
    return s;
  };
  const start = Date.now();
  let base: DemoArtwork[] | null = null;

  /** All works: the gallery as generated, overlaid with the ones that changed. */
  function works(): DemoArtwork[] {
    base ??= galleryWorks(start);
    const changed = new Map(state().works.map((w) => [w.id, w]));
    const gallery = base.map((w) => changed.get(w.id) ?? w);
    return [...gallery, ...state().works.filter((w) => w.origin === "player")];
  }
  const work = (id: string) => works().find((w) => w.id === id);
  const save = (w: DemoArtwork) => {
    const s = state();
    s.works = [...s.works.filter((x) => x.id !== w.id), w];
  };

  /** The gallery opens its daily auctions; AI collectors bid; due auctions end. */
  function tick(now = Date.now()) {
    const s = state();
    const today = host.day(now);
    if (!s.galleryDays.includes(today)) {
      s.galleryDays = [...s.galleryDays.slice(-6), today];
      const free = works().filter((w) => w.origin === "game" && w.owner === null && !openAuction(w.id));
      free
        .sort((a, b) => unit(`${today}:${a.id}`) - unit(`${today}:${b.id}`))
        .slice(0, cfg.gallery.auctionsPerDay)
        .forEach((w, i) => {
          const startCents = cfg.gallery.startPriceCents[w.rarity ?? "common"];
          s.seq += 1;
          s.auctions.push({
            id: `auction-${s.seq}`,
            artworkId: w.id,
            seller: null,
            startCents,
            // Staggered, so something always ends soon.
            endsAt: now + (cfg.gallery.auctionHours * HOUR * (i + 1)) / cfg.gallery.auctionsPerDay,
            currentCents: null,
            leader: null,
            bids: [],
            simulatedUntil: now - STEP * 6,
            ceilingCents: Math.round(startCents * (1.6 + unit(`${w.id}:${today}`) * 3)),
          });
        });
    }
    for (const a of s.auctions) simulate(a, now);
    for (const a of [...s.auctions]) if (a.endsAt <= now) close(a);
  }

  /** AI collectors: every ten minutes one of them may bid, until their ceiling. */
  function simulate(a: DemoAuction, now: number) {
    const collectors = host.collectors();
    while (a.simulatedUntil + STEP <= Math.min(now, a.endsAt)) {
      a.simulatedUntil += STEP;
      const roll = unit(`${a.id}:${a.simulatedUntil}`);
      const next = minNextBidCents(a.startCents, a.currentCents);
      if (roll > 0.45 || next > a.ceilingCents) continue;
      const bidder = collectors[Math.floor(roll * 1000) % collectors.length]!;
      if (bidder === a.leader || bidder === a.seller) continue;
      outbid(a);
      a.currentCents = next;
      a.leader = bidder;
      a.bids.push({ nickname: bidder, amountCents: next, at: a.simulatedUntil });
      a.endsAt = endAfterBid(a.endsAt, a.simulatedUntil);
    }
  }

  /** The player was the leader and is outbid: the reserved money comes back. */
  function outbid(a: DemoAuction) {
    if (a.leader === host.nickname() && a.currentCents) host.addCash(a.currentCents);
  }

  function close(a: DemoAuction) {
    const s = state();
    s.auctions = s.auctions.filter((x) => x.id !== a.id);
    const w = work(a.artworkId);
    if (!w || !a.leader || a.currentCents === null) return;
    const me = host.nickname();
    if (a.seller === me) host.addCash(sellerProceedsCents(a.currentCents));
    save({
      ...w,
      owner: a.leader,
      valueCents: a.currentCents,
      sales: [...w.sales, { at: a.endsAt, priceCents: a.currentCents, seller: a.seller, buyer: a.leader }],
    });
    host.persist();
  }

  const openAuction = (artworkId: string) => state().auctions.find((a) => a.artworkId === artworkId) ?? null;

  function view(w: DemoArtwork, now = Date.now()): Artwork {
    const me = host.nickname();
    const a = openAuction(w.id);
    const liked = state().likes.includes(w.id);
    const likes = w.baseLikes + (liked ? 1 : 0);
    return {
      id: w.id,
      code: artworkCode(w.serial),
      title: w.title,
      origin: w.origin,
      rarity: w.rarity,
      creator: w.creator,
      owner: w.owner,
      pixels: w.pixels,
      valueCents: w.valueCents,
      likes,
      liked,
      createdAt: new Date(w.createdAt).toISOString(),
      hot: hotScore(likes, a?.bids.length ?? 0, (now - w.createdAt) / HOUR),
      auction: a
        ? {
            id: a.id,
            endsAt: new Date(a.endsAt).toISOString(),
            startCents: a.startCents,
            currentCents: a.currentCents,
            minBidCents: minNextBidCents(a.startCents, a.currentCents),
            bids: a.bids.length,
            leader: a.leader,
            seller: a.seller,
            myBidCents: a.leader === me ? a.currentCents : null,
          }
        : null,
    };
  }

  const unlocked = () => host.level() >= (BALANCE.progression.unlocks.find((u) => u.key === "artworks")?.level ?? 8);
  const requireUnlocked = () => {
    if (!unlocked()) throw new GameError("artworks_locked");
  };
  const findAuction = (auctionId: string) => {
    const a = state().auctions.find((x) => x.id === auctionId);
    if (!a) throw new GameError("auction_not_found");
    return a;
  };

  function collectionOf(nickname: string) {
    const list = works().filter((w) => w.owner?.toLowerCase() === nickname.toLowerCase());
    return {
      nickname,
      count: list.length,
      valueCents: list.reduce((sum, w) => sum + (w.valueCents ?? 0), 0),
      artworks: list.map((w) => view(w)),
    };
  }

  /** Unique titles (ADR-100): compared without case, spaces and punctuation. */
  const titleKey = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const titleTaken = (t: string) => works().some((w) => titleKey(w.title) === titleKey(t));
  function titleProblem(title: string): GameErrorKey | null {
    const name = title.trim().replace(/\s+/g, " ");
    if (name.length < 3) return "name_too_short";
    if (name.length > cfg.titleMaxLength) return "name_too_long";
    const violation = host.nameViolation(name);
    if (violation) return violation as GameErrorKey;
    return titleTaken(name) ? "name_taken" : null;
  }

  const engine: Pick<
    GameEngine,
    | "artworks"
    | "artwork"
    | "artStudio"
    | "checkArtworkTitle"
    | "createArtwork"
    | "likeArtwork"
    | "startAuction"
    | "cancelAuction"
    | "bidArtwork"
    | "artRankings"
    | "collection"
  > = {
    async artworks(sort, origin, onAuction, limit, offset) {
      tick();
      let list = works()
        .map((w) => view(w))
        .filter((w) => origin === "all" || w.origin === origin)
        .filter((w) => !onAuction || w.auction !== null);
      const price = (w: Artwork) => w.auction?.currentCents ?? w.auction?.startCents ?? w.valueCents ?? 0;
      list =
        sort === "price"
          ? list.sort((a, b) => price(b) - price(a))
          : sort === "new"
            ? list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
            : sort === "ending"
              ? list
                  .filter((w) => w.auction)
                  .sort((a, b) => Date.parse(a.auction!.endsAt) - Date.parse(b.auction!.endsAt))
              : list.sort((a, b) => b.hot - a.hot);
      host.persist();
      return { serverTime: new Date().toISOString(), total: list.length, entries: list.slice(offset, offset + limit) };
    },

    async artwork(id) {
      tick();
      const w = work(id);
      if (!w) throw new GameError("artwork_not_found");
      const a = openAuction(id);
      return {
        artwork: view(w),
        sales: [...w.sales].reverse().map((x) => ({ ...x, at: new Date(x.at).toISOString() })),
        bids: [...(a?.bids ?? [])].reverse().map((b) => ({ ...b, at: new Date(b.at).toISOString() })),
      };
    },

    async artStudio() {
      return { painted: state().painted, nextCostCents: artworkCreateCostCents(state().painted), unlocked: unlocked() };
    },

    async checkArtworkTitle(title) {
      const reason = titleProblem(title);
      return { allowed: reason === null, reason };
    },

    createArtwork: (requestId, title, pixels) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          requireUnlocked();
          const name = title.trim().replace(/\s+/g, " ");
          if (name.length < 3 || name.length > cfg.titleMaxLength) throw new GameError("invalid_argument");
          const violation = host.nameViolation(name);
          if (violation) throw new GameError(violation as never);
          if (titleTaken(name)) throw new GameError("name_taken");
          if (!isValidArtwork(pixels)) throw new GameError("invalid_argument");
          if (hasForbiddenSymbol(pixels)) throw new GameError("logo_forbidden");
          const s = state();
          const cost = artworkCreateCostCents(s.painted);
          if (host.cashCents() < cost) throw new GameError("insufficient_funds");
          host.addCash(-cost);
          s.painted += 1;
          host.track("artworks_painted");
          s.seq += 1;
          const me = host.nickname();
          const w: DemoArtwork = {
            id: `player-art-${s.seq}`,
            serial: 1000 + s.seq,
            title: name,
            origin: "player",
            rarity: null,
            creator: me,
            owner: me,
            pixels: { palette: [...pixels.palette], grid: [...pixels.grid] },
            valueCents: null,
            baseLikes: 0,
            createdAt: Date.now(),
            sales: [],
          };
          save(w);
          host.persist();
          return { artwork: view(w), costCents: cost, nextCostCents: artworkCreateCostCents(s.painted) };
        }),
      ),

    likeArtwork: (requestId, artworkId, like) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          requireUnlocked();
          const w = work(artworkId);
          if (!w) throw new GameError("artwork_not_found");
          if (w.owner === host.nickname() || w.creator === host.nickname()) throw new GameError("own_artwork");
          const s = state();
          if (like && !s.likes.includes(artworkId)) host.track("art_likes");
          s.likes = like ? [...new Set([...s.likes, artworkId])] : s.likes.filter((x) => x !== artworkId);
          host.persist();
          const v = view(w);
          return { likes: v.likes, liked: v.liked };
        }),
      ),

    startAuction: (requestId, artworkId, startCents, hours) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          requireUnlocked();
          const w = work(artworkId);
          if (!w) throw new GameError("artwork_not_found");
          if (w.owner !== host.nickname()) throw new GameError("artwork_not_found");
          if (openAuction(artworkId)) throw new GameError("already_on_auction");
          if (!cfg.auction.durationsHours.includes(hours as never) || startCents < cfg.auction.minStartCents)
            throw new GameError("invalid_argument");
          const s = state();
          s.seq += 1;
          host.track("auctions_started");
          const now = Date.now();
          s.auctions.push({
            id: `auction-${s.seq}`,
            artworkId,
            seller: host.nickname(),
            startCents,
            endsAt: now + hours * HOUR,
            currentCents: null,
            leader: null,
            bids: [],
            simulatedUntil: now,
            // Collectors pay for value: a known price, likes, a bit of luck.
            ceilingCents: Math.round(
              Math.max(startCents, w.valueCents ?? cfg.auction.minStartCents * 20) *
                (1 + w.baseLikes / 40 + unit(`${w.id}:${now}`) * 0.8),
            ),
          });
          host.persist();
          return view(w);
        }),
      ),

    cancelAuction: (requestId, auctionId) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          const a = findAuction(auctionId);
          if (a.seller !== host.nickname()) throw new GameError("auction_not_found");
          if (a.bids.length > 0) throw new GameError("auction_has_bids");
          state().auctions = state().auctions.filter((x) => x.id !== auctionId);
          host.persist();
          return view(work(a.artworkId)!);
        }),
      ),

    bidArtwork: (requestId, auctionId, amountCents) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          requireUnlocked();
          tick();
          const a = findAuction(auctionId);
          const now = Date.now();
          if (a.endsAt <= now) throw new GameError("auction_ended");
          const me = host.nickname();
          if (a.seller === me) throw new GameError("own_artwork");
          if (amountCents < minNextBidCents(a.startCents, a.currentCents)) throw new GameError("bid_too_low");
          const refund = a.leader === me ? (a.currentCents ?? 0) : 0;
          if (host.cashCents() + refund < amountCents) throw new GameError("insufficient_funds");
          outbid(a);
          host.addCash(-amountCents);
          a.currentCents = amountCents;
          a.leader = me;
          a.bids.push({ nickname: me, amountCents, at: now });
          host.track("art_bids");
          a.endsAt = endAfterBid(a.endsAt, now);
          // The collectors only answer later (simulated in ten-minute steps).
          a.simulatedUntil = Math.max(a.simulatedUntil, now);
          host.persist();
          return view(work(a.artworkId)!);
        }),
      ),

    async artRankings(limit) {
      tick();
      const owners = new Map<string, { count: number; valueCents: number }>();
      for (const w of works()) {
        if (!w.owner) continue;
        const o = owners.get(w.owner) ?? { count: 0, valueCents: 0 };
        o.count += 1;
        o.valueCents += w.valueCents ?? 0;
        owners.set(w.owner, o);
      }
      const me = host.nickname();
      const collections = [...owners]
        .sort((a, b) => b[1].valueCents - a[1].valueCents)
        .slice(0, limit)
        .map(([nickname, o], i) => ({ rank: i + 1, nickname, avatarKey: null, ...o, isMe: nickname === me }));
      const artworks = works()
        .filter((w) => w.valueCents !== null)
        .sort((a, b) => (b.valueCents ?? 0) - (a.valueCents ?? 0))
        .slice(0, limit)
        .map((w, i) => ({ rank: i + 1, artwork: view(w) }));
      return { collections, artworks };
    },

    async collection(nickname) {
      tick();
      return collectionOf(nickname);
    },
  };

  /** Value of the player's artworks, for the net worth. */
  const myArtValueCents = () => collectionOf(host.nickname()).valueCents;

  return { engine, tick, myArtValueCents };
}
