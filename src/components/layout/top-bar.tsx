"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { QUEST_BOARD, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Avatar } from "@/components/ui/avatar";
import { useGame } from "@/features/game/store";
import { useSearch } from "@/features/market/search-store";
import { NotificationBell } from "@/features/social/components/notification-bell";
import { cn } from "@/lib/utils";
import { CashBalance } from "./cash-balance";
import { MarketStatus } from "./market-status";
import { Wordmark } from "./wordmark";

export function TopBar() {
  const t = useTranslations("topbar");
  const openSearch = useSearch((state) => state.setOpen);

  return (
    <header className="sticky top-0 z-sticky border-b border-line-1 bg-bg/88 pt-safe backdrop-blur-lg">
      <div className="mx-auto flex h-(--topbar-height) max-w-(--content-max) items-center gap-2 px-4 sm:gap-3 lg:px-8">
        <Link href="/" className="rounded-sm focus-ring lg:hidden">
          <Wordmark />
        </Link>

        <button
          type="button"
          onClick={() => openSearch(true)}
          className="hidden h-10 w-80 items-center gap-3 rounded-md border border-line-1 bg-surface-1 px-3 text-sm text-fg-3 focus-ring transition-colors duration-fast hover:border-line-2 hover:text-fg-2 lg:flex"
        >
          <PixelIcon {...UI_ICONS.search} scale={1} />
          <span className="flex-1 text-left">{t("search")}</span>
          <kbd className="grid size-5 place-items-center rounded-xs bg-surface-3 label-pixel text-fg-2">/</kbd>
        </button>

        <div className="ml-auto flex min-w-0 items-center gap-0.5 sm:gap-2 lg:gap-4">
          <MarketStatus className="hidden sm:inline-flex" />
          <button
            type="button"
            onClick={() => openSearch(true)}
            aria-label={t("searchShort")}
            className="grid size-8 shrink-0 place-items-center rounded-md text-fg-2 focus-ring transition-colors duration-fast hover:bg-surface-2 hover:text-fg-1 sm:size-9 lg:hidden"
          >
            <PixelIcon {...UI_ICONS.search} scale={2} />
          </button>
          <NotificationBell />
          <MissionsButton />
          <CashBalance />
          <ProfileButton />
        </div>
      </div>
    </header>
  );
}

/** Always reachable: the missions, with a blue dot when XP is waiting to be claimed. */
function MissionsButton() {
  const t = useTranslations("topbar");
  // Missions refresh right after tracked actions; the portfolio count only with the next portfolio load.
  const claimable = useGame((state) =>
    state.missions
      ? state.missions.reduce((n, g) => n + g.missions.filter((m) => m.status === "completed").length, 0)
      : (state.portfolio?.missionsClaimable ?? 0),
  );
  return (
    <Link
      href="/missions"
      aria-label={claimable > 0 ? t("missionsClaimable", { count: claimable }) : t("missions")}
      data-testid="missions-button"
      className="relative flex h-10 items-center gap-2 rounded-md px-1.5 text-sm text-fg-2 focus-ring transition duration-fast hover:bg-surface-2 hover:text-fg-1 active:scale-95 sm:px-2.5"
    >
      <PixelIcon {...QUEST_BOARD} scale={2} />
      <span className="hidden xl:inline">{t("missions")}</span>
      {claimable > 0 && (
        <span className="absolute top-1.5 right-1.5 grid size-2.5 place-items-center" data-testid="missions-dot">
          <span className="absolute size-full rounded-pill bg-info motion-safe:animate-ping" />
          <span className={cn("relative size-2.5 rounded-pill bg-info ring-2 ring-bg")} />
        </span>
      )}
    </Link>
  );
}

/** On phones the profile sits here instead of in the bottom bar (ADR-075). */
function ProfileButton() {
  const t = useTranslations("nav");
  const avatarKey = useGame((state) => state.portfolio?.avatarKey ?? null);
  return (
    <Link
      href="/profile"
      aria-label={t("profile")}
      data-tour="nav-profile"
      className="grid size-8 shrink-0 place-items-center rounded-md focus-ring transition duration-fast hover:bg-surface-2 active:scale-95 sm:size-9 lg:hidden"
    >
      <Avatar avatarKey={avatarKey} size="xs" />
    </Link>
  );
}
