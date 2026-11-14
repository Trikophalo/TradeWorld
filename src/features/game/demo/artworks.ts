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
} from "@/lib/sim/artworks";
import {
  nftAiAccepts,
  nftAiAskCents,
  nftAiValueCents,
  nftAiWouldBuy,
  nftLowballCents,
  nftSaleSplit,
} from "@/lib/sim/nfts";
import {
  GameError,
  type Artwork,
  type ArtworkPixels,
  type GameEngine,
  type GameErrorKey,
  type NftChat,
  type NftMessage,
  type NftSale,
  type NftSaleKind,
} from "../types";

/*
 * NFTs in the offline demo (ADR-080, ADR-135). The gallery auctions a few works at a time; the tycoons bid now and
 * then, so prices move and auctions feel alive. AI collectors (names from nfts.ai.collectors) hold some NFTs from the
 * start, answer offers in the chat at once, buy the player's listings only at a fair price and write lowball offers.
 * Resales of the player's NFTs between collectors pay the player royalties. Everything is kept in localStorage.
 */
const cfg = BALANCE.artworks;
const nft = BALANCE.nfts;
const COLLECTORS: readonly string[] = nft.ai.collectors;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
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

interface DemoSale {
  at: number;
  priceCents: number;
  seller: string | null;
  buyer: string;
  kind?: NftSaleKind;
  royaltyCents?: number;
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
  sales: DemoSale[];
  /** ADR-135: fixed price, mint cost, royalties paid so far, when the collectors last looked at it. */
  askCents?: number | null;
  mintCents?: number | null;
  royaltiesCents?: number;
  aiUntil?: number;
}

interface DemoMessage {
  id: number;
  author: string | null;
  ai: boolean;
  kind: NftMessage["kind"];
  text: string;
  offerCents: number | null;
  offerStatus: NftMessage["offerStatus"];
  expiresAt: number | null;
  at: number;
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
  /** Offer chats per NFT (ADR-135). */
  chats?: Record<string, DemoMessage[]>;
  msgSeq?: number;
  /** Royalties the player has earned. */
  royaltiesCents?: number;
}

export interface ArtHost {
  art(): ArtState | undefined;
  setArt(state: ArtState): void;
  nickname(): string;
  level(): number;
  cashCents(): number;
  addCash(cents: number): void;
  /** XP from base XP (alpha multiplier applied), returns what was granted. */
  addXp(base: number): number;
  collectors(): string[];
  nameViolation(name: string): string | null;
  day(at?: number): string;
  idempotent<T>(requestId: string, run: () => T): T;
  persist(): void;
  /** Mission counters (art_likes, art_bids, artworks_painted, auctions_started, nft_offers). */
  track(metric: "art_likes" | "art_bids" | "artworks_painted" | "auctions_started" | "nft_offers"): void;
}

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
/** Deterministic number in [0, 1) from a text (the demo has no server randomness to share). */
const unit = (text: string) => (hash(text) % 100_000) / 100_000;
const pick = <T>(list: readonly T[], u: number): T => list[Math.min(list.length - 1, Math.floor(u * list.length))]!;

/** The world start: gallery works as of the first visit of the demo; every fifth is held by an AI collector. */
function galleryWorks(start: number): DemoArtwork[] {
  return GALLERY_ARTWORKS.map((g, i) => {
    const held = i % 5 === 4;
    const startCents = cfg.gallery.startPriceCents[g.rarity];
    const price = Math.round((startCents * (1.2 + unit(`${g.key}:price`))) / 100) * 100;
    const collector = pick(COLLECTORS, unit(`${g.key}:collector`));
    return {
      id: g.key,
      serial: i + 1,
      title: g.title,
      origin: "game",
      rarity: g.rarity,
      creator: null,
      owner: held ? collector : null,
      pixels: { palette: [...g.palette], grid: [...g.grid] },
      valueCents: held ? price : null,
      baseLikes: Math.floor(unit(`${g.key}:likes`) * (g.rarity === "legendary" ? 60 : g.rarity === "rare" ? 25 : 12)),
      createdAt: start - (i + 1) * 5 * HOUR,
      sales: held
        ? [{ at: start - (i + 1) * 2 * HOUR, priceCents: price, seller: null, buyer: collector, kind: "auction" }]
        : [],
      mintCents: startCents,
    };
  });
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
  const isCollector = (name: string | null) => name !== null && COLLECTORS.includes(name);

  // ------------------------------------------------------------------ NFT rules (ADR-135)
  const likesOf = (w: DemoArtwork) => w.baseLikes + (state().likes.includes(w.id) ? 1 : 0);
  const creatorSales = (creator: string | null) =>
    creator
      ? works()
          .filter((x) => x.creator === creator)
          .reduce((n, x) => n + x.sales.length, 0)
      : 0;
  const valueOf = (w: DemoArtwork, now = Date.now()) =>
    nftAiValueCents({
      lastSaleCents: w.valueCents,
      mintCents: w.mintCents ?? (w.origin === "game" ? cfg.gallery.startPriceCents[w.rarity ?? "common"] : null),
      likes: likesOf(w),
      creatorSales: creatorSales(w.creator),
      ageDays: (now - w.createdAt) / DAY,
    });
  /** The fixed price: set by the owner; an AI collector always offers its NFTs at valuation x markup. */
  const askOf = (w: DemoArtwork) => (isCollector(w.owner) ? nftAiAskCents(valueOf(w)) : (w.askCents ?? null));

  const chat = (artworkId: string): DemoMessage[] => state().chats?.[artworkId] ?? [];
  function post(artworkId: string, m: Omit<DemoMessage, "id">): DemoMessage {
    const s = state();
    s.msgSeq = (s.msgSeq ?? 0) + 1;
    const message = { ...m, id: s.msgSeq };
    s.chats = { ...s.chats, [artworkId]: [...chat(artworkId), message].slice(-nft.chat.history) };
    return message;
  }
  const aiSay = (artworkId: string, name: string, lines: readonly string[], at: number) =>
    post(artworkId, {
      author: name,
      ai: true,
      kind: "chat",
      text: pick(lines, unit(`${artworkId}:${at}:line`)),
      offerCents: null,
      offerStatus: null,
      expiresAt: null,
      at,
    });
  const openOffers = (artworkId: string, now = Date.now()) =>
    chat(artworkId).filter((m) => m.offerStatus === "open" && (m.expiresAt ?? 0) > now);

  /**
   * A direct sale: the buyer pays, the creator gets the royalty unless they sell or buy, the seller the rest minus
   * the fee; the player's cash moves when the player is buyer, seller or creator.
   */
  function sell(
    w: DemoArtwork,
    buyer: string,
    priceCents: number,
    kind: NftSaleKind,
    accepted: number | null,
    at = Date.now(),
  ) {
    const me = host.nickname();
    const seller = w.owner;
    const sellerIsCreator = w.creator === seller || w.creator === buyer || w.creator === null;
    const split = nftSaleSplit(priceCents, sellerIsCreator);
    if (buyer === me) host.addCash(-priceCents);
    if (seller === me) host.addCash(split.sellerCents);
    if (split.royaltyCents > 0 && w.creator === me) {
      host.addCash(split.royaltyCents);
      state().royaltiesCents = (state().royaltiesCents ?? 0) + split.royaltyCents;
    }
    const s = state();
    s.chats = {
      ...s.chats,
      [w.id]: chat(w.id).map((m) =>
        m.offerStatus === "open" ? { ...m, offerStatus: m.id === accepted ? "accepted" : "closed" } : m,
      ),
    };
    post(w.id, {
      author: null,
      ai: false,
      kind: "sale",
      text: buyer,
      offerCents: priceCents,
      offerStatus: null,
      expiresAt: null,
      at,
    });
    save({
      ...w,
      owner: buyer,
      valueCents: priceCents,
      askCents: null,
      royaltiesCents: (w.royaltiesCents ?? 0) + split.royaltyCents,
      sales: [...w.sales, { at, priceCents, seller, buyer, kind, royaltyCents: split.royaltyCents }],
    });
    return split;
  }

  /** Collectors look at the player's NFTs every ten minutes: buy fair listings, write lowball offers, resell. */
  function collectorsLook(now: number) {
    const me = host.nickname();
    for (const w0 of works()) {
      let w = w0;
      const owned = w.owner === me;
      const resell = isCollector(w.owner) && w.creator === me;
      if ((!owned && !resell) || openAuction(w.id)) continue;
      let until = w.aiUntil ?? now - STEP;
      while (until + STEP <= now) {
        until += STEP;
        const roll = unit(`${w.id}:${until}:ai`);
        const value = valueOf(w, until);
        const ask = w.askCents ?? null;
        if (w.owner === me && ask !== null && nftAiWouldBuy(ask, value) && roll < nft.ai.buyChanceBps / 10_000) {
          const name = pick(COLLECTORS, unit(`${w.id}:${until}:who`));
          sell(w, name, ask, "ai", null, until);
          aiSay(w.id, name, nft.ai.lines.buy, until);
          w = work(w.id)!;
        } else if (
          w.owner === me &&
          openOffers(w.id, until).every((m) => !m.ai) &&
          roll < (ask !== null ? nft.ai.listedOfferChanceBps : nft.ai.unlistedOfferChanceBps * 10) / 10_000
        ) {
          offerFromAi(w, value, until);
        } else if (resell && roll < 0.03) {
          // The collectors trade the player's NFTs among themselves: royalties for the player.
          const others = COLLECTORS.filter((c) => c !== w.owner);
          sell(w, pick(others, unit(`${w.id}:${until}:buyer`)), askOf(w)!, "ai", null, until);
          w = work(w.id)!;
        }
        if (w.owner !== me && !(isCollector(w.owner) && w.creator === me)) break;
      }
      save({ ...work(w.id)!, aiUntil: Math.max(until, now - STEP) });
    }
  }

  function offerFromAi(w: DemoArtwork, value: number, at: number) {
    const name = pick(COLLECTORS, unit(`${w.id}:${at}:who`));
    post(w.id, {
      author: name,
      ai: true,
      kind: "offer",
      text: pick(nft.ai.lines.offer, unit(`${w.id}:${at}:line`)),
      offerCents: nftLowballCents(value, unit(`${w.id}:${at}:bps`)),
      offerStatus: "open",
      expiresAt: at + nft.chat.offerHours * HOUR,
      at,
    });
  }

  /** The gallery opens its daily auctions; the tycoons bid; due auctions end; collectors look around. */
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
    collectorsLook(now);
  }

  /** Tycoons: every ten minutes one of them may bid, until their ceiling. */
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
    const split = nftSaleSplit(a.currentCents, w.creator === null || w.creator === a.seller || w.creator === a.leader);
    if (a.seller === me) host.addCash(split.sellerCents);
    if (w.creator === me && split.royaltyCents > 0) {
      host.addCash(split.royaltyCents);
      s.royaltiesCents = (s.royaltiesCents ?? 0) + split.royaltyCents;
    }
    save({
      ...w,
      owner: a.leader,
      valueCents: a.currentCents,
      askCents: null,
      royaltiesCents: (w.royaltiesCents ?? 0) + split.royaltyCents,
      sales: [
        ...w.sales,
        {
          at: a.endsAt,
          priceCents: a.currentCents,
          seller: a.seller,
          buyer: a.leader,
          kind: "auction",
          royaltyCents: split.royaltyCents,
        },
      ],
    });
    post(w.id, {
      author: null,
      ai: false,
      kind: "sale",
      text: a.leader,
      offerCents: a.currentCents,
      offerStatus: null,
      expiresAt: null,
      at: a.endsAt,
    });
    host.persist();
  }

  const openAuction = (artworkId: string) => state().auctions.find((a) => a.artworkId === artworkId) ?? null;

  function view(w: DemoArtwork, now = Date.now()): Artwork {
    const me = host.nickname();
    const a = openAuction(w.id);
    const liked = state().likes.includes(w.id);
    const likes = likesOf(w);
    const offers = openOffers(w.id, now);
    const ai = isCollector(w.owner);
    return {
      id: w.id,
      code: artworkCode(w.serial),
      title: w.title,
      origin: w.origin,
      rarity: w.rarity,
      creator: w.creator,
      owner: ai ? null : w.owner,
      aiOwner: ai ? w.owner : null,
      pixels: w.pixels,
      valueCents: w.valueCents,
      askCents: a ? null : askOf(w),
      royaltyBps: nft.royaltyBps,
      royaltiesCents: w.royaltiesCents ?? 0,
      offers: offers.length,
      bestOfferCents: offers.length > 0 ? Math.max(...offers.map((m) => m.offerCents ?? 0)) : null,
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

  function chatView(artworkId: string, now = Date.now()): NftChat {
    const me = host.nickname();
    const w = work(artworkId);
    if (!w) throw new GameError("artwork_not_found");
    const mine = openOffers(artworkId, now).filter((m) => m.author === me);
    return {
      artworkId,
      isOwner: w.owner === me,
      askCents: openAuction(artworkId) ? null : askOf(w),
      minOfferCents: nft.minOfferCents,
      maxLength: nft.chat.maxLength,
      myOfferCents: mine.at(-1)?.offerCents ?? null,
      messages: chat(artworkId).map((m) => ({
        id: m.id,
        author: m.author,
        ai: m.ai,
        kind: m.kind,
        text: m.text,
        offerCents: m.offerCents,
        offerStatus: m.offerStatus === "open" && (m.expiresAt ?? 0) <= now ? "expired" : m.offerStatus,
        expiresAt: m.expiresAt === null ? null : new Date(m.expiresAt).toISOString(),
        at: new Date(m.at).toISOString(),
        mine: m.author === me && !m.ai,
      })),
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
    const created = works().filter((w) => w.creator?.toLowerCase() === nickname.toLowerCase());
    return {
      nickname,
      count: list.length,
      valueCents: list.reduce((sum, w) => sum + (w.valueCents ?? 0), 0),
      created: created.length,
      royaltiesCents: created.reduce((sum, w) => sum + (w.royaltiesCents ?? 0), 0),
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

  const saleResult = (w: DemoArtwork, split: { feeCents: number; royaltyCents: number }, price: number): NftSale => ({
    artwork: view(work(w.id)!),
    priceCents: price,
    feeCents: split.feeCents,
    royaltyCents: split.royaltyCents,
  });

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
    | "artworkChat"
    | "postArtworkMessage"
    | "acceptArtworkOffer"
    | "setArtworkPrice"
    | "buyArtwork"
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
              : sort === "wanted"
                ? list.sort((a, b) => b.offers - a.offers || (b.bestOfferCents ?? 0) - (a.bestOfferCents ?? 0))
                : sort === "for_sale"
                  ? list.filter((w) => w.askCents !== null).sort((a, b) => a.askCents! - b.askCents!)
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
        sales: [...w.sales].reverse().map((x) => ({
          at: new Date(x.at).toISOString(),
          priceCents: x.priceCents,
          seller: x.seller,
          buyer: x.buyer,
          kind: x.kind ?? "auction",
          royaltyCents: x.royaltyCents ?? 0,
        })),
        bids: [...(a?.bids ?? [])].reverse().map((b) => ({ ...b, at: new Date(b.at).toISOString() })),
      };
    },

    async artStudio() {
      return {
        painted: state().painted,
        nextCostCents: artworkCreateCostCents(state().painted),
        unlocked: unlocked(),
        royaltiesCents: state().royaltiesCents ?? 0,
        royaltyBps: nft.royaltyBps,
        mintXp: nft.mintXp,
      };
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
          const now = Date.now();
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
            createdAt: now,
            sales: [],
            mintCents: cost,
            aiUntil: now,
          };
          save(w);
          host.persist();
          return {
            artwork: view(w),
            costCents: cost,
            nextCostCents: artworkCreateCostCents(s.painted),
            xp: host.addXp(nft.mintXp),
          };
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
          save({ ...w, askCents: null });
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
          return view(work(artworkId)!);
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
      const mine = collectionOf(me);
      const creators =
        mine.created > 0
          ? [
              {
                rank: 1,
                nickname: me,
                avatarKey: null,
                count: mine.created,
                royaltiesCents: mine.royaltiesCents,
                isMe: true,
              },
            ]
          : [];
      return { collections, artworks, creators };
    },

    async collection(nickname) {
      tick();
      return collectionOf(nickname);
    },

    async artworkChat(artworkId) {
      tick();
      return chatView(artworkId);
    },

    postArtworkMessage: (requestId, artworkId, text, offerCents) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          requireUnlocked();
          const body = text.trim().replace(/\s+/g, " ");
          if (body.length < 1 || body.length > nft.chat.maxLength) throw new GameError("nft_text_invalid");
          if (host.nameViolation(body) === "name_profanity") throw new GameError("nft_text_invalid");
          const w = work(artworkId);
          if (!w) throw new GameError("artwork_not_found");
          const me = host.nickname();
          const now = Date.now();
          const recent = Object.values(state().chats ?? {})
            .flat()
            .filter((m) => m.author === me && !m.ai && m.at > now - 60_000).length;
          if (recent >= nft.chat.perMinute) throw new GameError("rate_limited");
          if (offerCents === null) {
            post(artworkId, {
              author: me,
              ai: false,
              kind: "chat",
              text: body,
              offerCents: null,
              offerStatus: null,
              expiresAt: null,
              at: now,
            });
          } else {
            if (w.owner === me) throw new GameError("own_artwork");
            if (w.owner === null) throw new GameError("forbidden");
            if (offerCents < nft.minOfferCents) throw new GameError("bid_too_low");
            if (host.cashCents() < offerCents) throw new GameError("insufficient_funds");
            const s = state();
            s.chats = {
              ...s.chats,
              [artworkId]: chat(artworkId).map((m) =>
                m.author === me && m.offerStatus === "open" ? { ...m, offerStatus: "closed" } : m,
              ),
            };
            const offer = post(artworkId, {
              author: me,
              ai: false,
              kind: "offer",
              text: body,
              offerCents,
              offerStatus: "open",
              expiresAt: now + nft.chat.offerHours * HOUR,
              at: now,
            });
            host.track("nft_offers");
            // The holder (an AI collector or a tycoon) answers at once: from 105 % of its valuation it sells.
            const holder = w.owner;
            if (nftAiAccepts(offerCents, valueOf(w, now))) {
              sell(w, me, offerCents, "offer", offer.id, now + 1);
              aiSay(artworkId, holder, nft.ai.lines.accept, now + 2);
            } else {
              s.chats = {
                ...s.chats,
                [artworkId]: chat(artworkId).map((m) => (m.id === offer.id ? { ...m, offerStatus: "declined" } : m)),
              };
              aiSay(artworkId, holder, nft.ai.lines.decline, now + 1);
            }
          }
          host.persist();
          return chatView(artworkId, now);
        }),
      ),

    acceptArtworkOffer: (requestId, messageId) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          requireUnlocked();
          const s = state();
          const entry = Object.entries(s.chats ?? {}).find(([, list]) => list.some((m) => m.id === messageId));
          const m = entry?.[1].find((x) => x.id === messageId);
          if (!entry || !m || m.kind !== "offer") throw new GameError("nft_offer_closed");
          const w = work(entry[0])!;
          if (w.owner !== host.nickname()) throw new GameError("forbidden");
          if (m.offerStatus !== "open" || (m.expiresAt ?? 0) <= Date.now()) throw new GameError("nft_offer_closed");
          if (openAuction(w.id)) throw new GameError("already_on_auction");
          const price = m.offerCents!;
          const split = sell(w, m.author!, price, m.ai ? "ai" : "offer", m.id);
          if (m.ai) aiSay(w.id, m.author!, nft.ai.lines.buy, Date.now() + 1);
          host.persist();
          return saleResult(w, split, price);
        }),
      ),

    setArtworkPrice: (requestId, artworkId, askCents) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          requireUnlocked();
          if (askCents !== null && askCents < nft.minAskCents) throw new GameError("invalid_argument");
          const w = work(artworkId);
          if (!w) throw new GameError("artwork_not_found");
          if (w.owner !== host.nickname()) throw new GameError("forbidden");
          if (openAuction(artworkId)) throw new GameError("already_on_auction");
          const now = Date.now();
          save({ ...w, askCents });
          // A collector looks right away: fair price -> bought, too high -> a lowball offer in the chat.
          if (askCents !== null) {
            const value = valueOf(w, now);
            if (nftAiWouldBuy(askCents, value)) {
              const name = pick(COLLECTORS, unit(`${w.id}:${now}:who`));
              sell(work(artworkId)!, name, askCents, "ai", null, now);
              aiSay(artworkId, name, nft.ai.lines.buy, now + 1);
            } else if (openOffers(artworkId, now).every((m) => !m.ai)) {
              offerFromAi(work(artworkId)!, value, now);
            }
          }
          host.persist();
          return view(work(artworkId)!);
        }),
      ),

    buyArtwork: (requestId, artworkId, priceCents) =>
      Promise.resolve(
        host.idempotent(requestId, () => {
          requireUnlocked();
          const w = work(artworkId);
          if (!w) throw new GameError("artwork_not_found");
          const me = host.nickname();
          if (w.owner === me) throw new GameError("own_artwork");
          const ask = askOf(w);
          if (ask === null || w.owner === null || openAuction(artworkId)) throw new GameError("nft_not_for_sale");
          if (ask !== priceCents) throw new GameError("nft_price_changed");
          if (host.cashCents() < ask) throw new GameError("insufficient_funds");
          const holder = w.owner;
          const now = Date.now();
          const split = sell(w, me, ask, "buy", null, now);
          if (isCollector(holder)) aiSay(artworkId, holder, nft.ai.lines.accept, now + 1);
          host.persist();
          return saleResult(w, split, ask);
        }),
      ),
  };

  /** Value of the player's artworks, for the net worth. */
  const myArtValueCents = () => collectionOf(host.nickname()).valueCents;

  return { engine, tick, myArtValueCents };
}
