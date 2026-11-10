"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { useSearch } from "@/features/market/search-store";
import { CashBalance } from "./cash-balance";
import { MarketStatus } from "./market-status";
import { Wordmark } from "./wordmark";

export function TopBar() {
  const t = useTranslations("topbar");
  const openSearch = useSearch((state) => state.setOpen);

  return (
    <header className="sticky top-0 z-sticky border-b border-line-1 bg-bg/88 pt-safe backdrop-blur-lg">
      <div className="mx-auto flex h-(--topbar-height) max-w-(--content-max) items-center gap-3 px-4 lg:px-8">
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

        <div className="ml-auto flex items-center gap-2 lg:gap-4">
          <MarketStatus className="hidden sm:inline-flex" />
          <button
            type="button"
            onClick={() => openSearch(true)}
            aria-label={t("searchShort")}
            className="grid size-10 place-items-center rounded-md text-fg-2 focus-ring transition-colors duration-fast hover:bg-surface-2 hover:text-fg-1 lg:hidden"
          >
            <PixelIcon {...UI_ICONS.search} scale={2} />
          </button>
          <CashBalance />
        </div>
      </div>
    </header>
  );
}
