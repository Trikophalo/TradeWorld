"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ShortMoney } from "@/components/ui/live-money";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { BALANCE } from "@/config/balance";
import { useGame, usePlayerLevel } from "@/features/game/store";
import type { ArtOrigin, ArtSort, Artwork } from "@/features/game/types";
import { useVisitTour } from "@/features/tutorial/use-visit-tour";
import { formatMoney } from "@/lib/format";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useArtRankings, useArtworks, useCollection } from "../hooks";
import { ArtStudio } from "./art-studio";
import { ArtworkCard } from "./artwork-card";
import { ArtworkDetail } from "./artwork-detail";
import { ArtworkImage } from "./artwork-image";

type Tab = "market" | "collection" | "rankings";
const UNLOCK = BALANCE.progression.unlocks.find((u) => u.key === "artworks")?.level ?? 8;

/** The NFT tab (ADR-080, ADR-135): marketplace, own collection, rankings and the studio. */
export function ArtworksHub() {
  const t = useTranslations("art");
  const level = usePlayerLevel();
  const [tab, setTab] = useState<Tab>("market");
  const [open, setOpen] = useState<string | null>(null);
  const unlocked = level >= UNLOCK;
  useVisitTour("visit_artworks", unlocked);

  if (!unlocked) {
    return (
      <EmptyState
        art={<PixelIcon {...UI_ICONS.lock} scale={4} />}
        title={t("lockedTitle")}
        description={t("lockedText")}
      />
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-pretty text-fg-2">{t("intro")}</p>
      <ArtStudio />
      <Segmented<Tab>
        value={tab}
        onValueChange={setTab}
        label={t("title")}
        block
        options={[
          { value: "market", label: t("tabMarket") },
          { value: "collection", label: t("tabCollection") },
          { value: "rankings", label: t("tabRankings") },
        ]}
      />
      {tab === "market" && <Market onOpen={setOpen} />}
      {tab === "collection" && <MyCollection onOpen={setOpen} />}
      {tab === "rankings" && <Rankings onOpen={setOpen} />}
      <ArtworkDetail id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Market({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useTranslations("art");
  const [sort, setSort] = useState<ArtSort>("hot");
  const [origin, setOrigin] = useState<ArtOrigin>("all");
  const [onlyAuctions, setOnlyAuctions] = useState(false);
  const list = useArtworks(sort, origin, onlyAuctions);
  const spotlight = useArtworks("hot", "all", true);
  const top = (spotlight.data?.entries ?? []).slice(0, 3);

  return (
    <div className="space-y-5" data-tour="art-market">
      {top.length > 0 && (
        <section className="space-y-3">
          <p className="label-pixel text-gold">★ {t("spotlight")}</p>
          <ul className="grid gap-3 sm:grid-cols-3">
            {top.map((a) => (
              <li key={a.id}>
                <ArtworkCard artwork={a} onOpen={() => onOpen(a.id)} big />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 p-3">
        <Segmented<ArtSort>
          value={sort}
          onValueChange={setSort}
          label={t("sort")}
          size="sm"
          options={[
            { value: "hot", label: t("sortHot") },
            { value: "price", label: t("sortPrice") },
            { value: "new", label: t("sortNew") },
            { value: "wanted", label: t("sortWanted") },
            { value: "for_sale", label: t("sortForSale") },
            { value: "ending", label: t("sortEnding") },
          ]}
        />
        <Segmented<ArtOrigin>
          value={origin}
          onValueChange={setOrigin}
          label={t("origin")}
          size="sm"
          options={[
            { value: "all", label: t("originAll") },
            { value: "game", label: t("originGame") },
            { value: "player", label: t("originPlayer") },
          ]}
        />
        <label className="ml-auto flex items-center gap-2 text-sm text-fg-2">
          <Switch checked={onlyAuctions} onCheckedChange={setOnlyAuctions} label={t("onlyAuctions")} />
          {t("onlyAuctions")}
        </label>
      </div>

      {!list.data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-64 rounded-lg" />
          ))}
        </div>
      ) : list.data.entries.length === 0 ? (
        <EmptyState art={<PixelIcon {...UI_ICONS.art} scale={4} />} title={t("tabMarket")} description={t("empty")} />
      ) : (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="art-grid">
          <AnimatePresence initial={false}>
            {list.data.entries.map((a) => (
              <motion.li key={a.id} layout transition={SPRING.smooth}>
                <ArtworkCard artwork={a} onOpen={() => onOpen(a.id)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

function MyCollection({ onOpen }: { onOpen: (id: string) => void }) {
  const nickname = useGame((state) => state.portfolio?.nickname ?? null);
  return <CollectionView nickname={nickname} onOpen={onOpen} />;
}

/** A player's collection: count, total value and the artworks (own tab and player profiles). */
export function CollectionView({ nickname, onOpen }: { nickname: string | null; onOpen: (id: string) => void }) {
  const t = useTranslations("art");
  const collection = useCollection(nickname);
  if (!collection.data) return <Skeleton className="h-48 w-full rounded-lg" />;
  return (
    <section className="space-y-3" data-testid="collection">
      <p className="text-sm text-fg-2">
        {t("collectionValue", {
          count: collection.data.count,
          amount: formatMoney(collection.data.valueCents, { whole: true }),
        })}
      </p>
      {collection.data.created > 0 && (
        <p className="text-sm text-gain" data-testid="collection-royalties">
          {t("collectionCreated", {
            count: collection.data.created,
            amount: formatMoney(collection.data.royaltiesCents, { whole: true }),
          })}
        </p>
      )}
      {collection.data.artworks.length === 0 ? (
        <EmptyState
          art={<PixelIcon {...UI_ICONS.art} scale={4} />}
          title={t("collectionTitle")}
          description={t("collectionEmpty")}
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {collection.data.artworks.map((a) => (
            <li key={a.id}>
              <ArtworkCard artwork={a} onOpen={() => onOpen(a.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Rankings({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useTranslations("art");
  const rankings = useArtRankings();
  if (!rankings.data) return <Skeleton className="h-64 w-full rounded-lg" />;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card padding="lg" className="lg:col-span-2">
        <p className="mb-3 label-pixel text-fg-2">{t("rankCreators")}</p>
        {rankings.data.creators.length === 0 ? (
          <p className="text-sm text-fg-3">{t("rankEmpty")}</p>
        ) : (
          <ol className="grid gap-1 lg:grid-cols-2" data-testid="rank-creators">
            {rankings.data.creators.map((c) => (
              <li
                key={c.nickname}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-2",
                  c.isMe ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-surface-2",
                )}
              >
                <span className="w-7 text-center font-pixel nums text-xs text-fg-2">{c.rank}</span>
                <Avatar avatarKey={c.avatarKey} size="xs" />
                <span className="min-w-0 flex-1 truncate text-fg-1">{c.isMe ? t("you") : c.nickname}</span>
                <span className="text-xs text-fg-3">{t("rankCreatorsCount", { count: c.count })}</span>
                <ShortMoney cents={c.royaltiesCents} className="font-semibold text-gain" />
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card padding="lg">
        <p className="mb-3 label-pixel text-fg-2">{t("rankCollections")}</p>
        {rankings.data.collections.length === 0 ? (
          <p className="text-sm text-fg-3">{t("rankEmpty")}</p>
        ) : (
          <ol className="space-y-1" data-testid="rank-collections">
            {rankings.data.collections.map((c) => (
              <li
                key={c.nickname}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-2",
                  c.isMe ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-surface-2",
                )}
              >
                <span className="w-7 text-center font-pixel nums text-xs text-fg-2">{c.rank}</span>
                <Avatar avatarKey={c.avatarKey} size="xs" />
                <span className="min-w-0 flex-1 truncate text-fg-1">{c.isMe ? t("you") : c.nickname}</span>
                <span className="text-xs text-fg-3">{c.count}×</span>
                <ShortMoney cents={c.valueCents} className="font-semibold text-fg-1" />
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card padding="lg">
        <p className="mb-3 label-pixel text-fg-2">{t("rankArtworks")}</p>
        {rankings.data.artworks.length === 0 ? (
          <p className="text-sm text-fg-3">{t("rankEmpty")}</p>
        ) : (
          <ol className="space-y-1" data-testid="rank-artworks">
            {rankings.data.artworks.map(({ rank, artwork }) => (
              <RankedArtwork key={artwork.id} rank={rank} artwork={artwork} onOpen={() => onOpen(artwork.id)} />
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function RankedArtwork({ rank, artwork, onOpen }: { rank: number; artwork: Artwork; onOpen: () => void }) {
  const t = useTranslations("art");
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left focus-ring transition duration-fast hover:bg-surface-2"
      >
        <span className="w-7 text-center font-pixel nums text-xs text-fg-2">{rank}</span>
        <ArtworkImage artwork={artwork} scale={1} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-fg-1">{artwork.title}</span>
          <span className="block truncate text-xs text-fg-3">
            {artwork.owner
              ? t("ownedBy", { name: artwork.owner })
              : artwork.aiOwner
                ? t("ownedByAi", { name: artwork.aiOwner })
                : t("ownedByGallery")}
          </span>
        </span>
        <ShortMoney cents={artwork.valueCents ?? 0} className="font-semibold text-fg-1" />
      </button>
    </li>
  );
}

/** For the player profile: their collection with values (ADR-080). */
export function ProfileCollection({ nickname }: { nickname: string }) {
  const t = useTranslations("art");
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card padding="lg" className="space-y-3">
      <p className="label-pixel text-fg-2">{t("collectionTitle")}</p>
      <CollectionView nickname={nickname} onOpen={setOpen} />
      <ArtworkDetail id={open} onClose={() => setOpen(null)} />
    </Card>
  );
}
