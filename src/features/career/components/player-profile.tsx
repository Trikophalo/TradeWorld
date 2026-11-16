"use client";

import { FriendButton } from "@/features/friends/components/friends";
import { PokeButton } from "@/features/friends/components/poke";
import { friendStatus, useFriends } from "@/features/friends/hooks";
import { FigureCard } from "@/features/wardrobe/components/figure-card";
import type { PlayerCard } from "@/features/game/types";
import { ProfileHoldings } from "@/features/friends/components/holdings";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useGame } from "@/features/game/store";
import { BEAR } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileCollection } from "@/features/artworks/components/artworks-hub";
import { ProfileNexamon } from "@/features/nexamon/components/profile-collection";
import { PropertyShowcase } from "@/features/property/components/property-hub";
import { usePlayerCard } from "../hooks";
import { BusinessCard } from "./business-card";

export function PlayerProfile({ nickname }: { nickname: string }) {
  const t = useTranslations("playerCard");
  const card = usePlayerCard(nickname);
  const track = useGame((state) => state.track);
  const loaded = card.data?.nickname ?? null;
  // Visiting other players counts for missions (ADR-081).
  useEffect(() => {
    if (loaded) track("view_profile", loaded);
  }, [loaded, track]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/rich-list"
        transitionTypes={["nav-back"]}
        className="inline-flex items-center gap-1.5 text-sm text-fg-2 focus-ring transition-colors duration-fast hover:text-fg-1"
      >
        ← {t("back")}
      </Link>
      {card.data ? (
        <>
          <BusinessCard card={card.data} />
          {/* The dressed pixel figure; friends can be poked (ADR-155) */}
          <ProfileFigure card={card.data} />
          {/* Friends (ADR-084) */}
          <FriendButton nickname={card.data.nickname} />
          {/* What they are invested in, for friends (ADR-121) */}
          <ProfileHoldings nickname={card.data.nickname} />
          {/* Their artworks with values (ADR-080) */}
          <ProfileCollection nickname={card.data.nickname} />
          {/* Their home and garage, the flex (ADR-082) */}
          <PropertyShowcase nickname={card.data.nickname} />
          {/* Their collectible cards, the best ones first (ADR-165) */}
          <ProfileNexamon nickname={card.data.nickname} />
        </>
      ) : card.isError ? (
        <EmptyState
          art={<PixelIcon {...BEAR} scale={4} />}
          title={t("notFound")}
          description={nickname}
          action={
            <Link href="/rich-list" className={buttonVariants({ variant: "secondary" })}>
              {t("back")}
            </Link>
          }
        />
      ) : (
        <Skeleton className="h-72 w-full rounded-xl" />
      )}
    </div>
  );
}

function ProfileFigure({ card }: { card: PlayerCard }) {
  const me = useGame((state) => state.portfolio?.nickname ?? "");
  const friends = useFriends();
  const status = friendStatus(friends.data, card.nickname, me);
  return (
    <FigureCard
      nickname={card.nickname}
      avatarKey={card.avatarKey}
      accessories={card.accessories}
      own={status === "self"}
      action={status === "friends" ? <PokeButton nickname={card.nickname} /> : undefined}
    />
  );
}
