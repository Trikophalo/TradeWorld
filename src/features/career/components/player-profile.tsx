"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BEAR } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileCollection } from "@/features/artworks/components/artworks-hub";
import { usePlayerCard } from "../hooks";
import { BusinessCard } from "./business-card";

export function PlayerProfile({ nickname }: { nickname: string }) {
  const t = useTranslations("playerCard");
  const card = usePlayerCard(nickname);
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
          {/* Their artworks with values (ADR-080) */}
          <ProfileCollection nickname={card.data.nickname} />
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
