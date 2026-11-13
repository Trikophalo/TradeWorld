"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useState } from "react";
import { NAV_GROUPS, NAV_ITEMS, isActivePath, type NavItem } from "@/config/navigation";
import { useGame, usePlayerLevel } from "@/features/game/store";
import { LockBadge } from "@/components/ui/lock-badge";
import { isUnlocked, unlockLevel } from "@/lib/sim/progression";
import { SPRING } from "@/lib/motion";
import { xpForNextLevel } from "@/lib/sim/progression";
import { isDemoMode } from "@/lib/supabase/env";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { Wordmark } from "./wordmark";

/** Desktop navigation. Hidden below the `lg` breakpoint, where the tab bar takes over. */
export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations();
  const level = usePlayerLevel();
  const xp = useGame((state) => state.portfolio?.xpIntoLevel ?? 0);
  const needed = xpForNextLevel(level);
  const [showSoon, setShowSoon] = useState(false);
  // Locked areas wait under "Bald frei", the next one first (ADR-107).
  const open = NAV_ITEMS.filter((item) => !item.unlock || isUnlocked(item.unlock, level));
  const locked = NAV_ITEMS.filter((item) => item.unlock && !isUnlocked(item.unlock, level)).sort(
    (a, b) => (unlockLevel(a.unlock!) ?? 99) - (unlockLevel(b.unlock!) ?? 99),
  );
  const soonOpen = showSoon || locked.some((item) => isActivePath(pathname, item.href));

  return (
    <aside className="fixed inset-y-0 left-0 z-nav hidden w-(--sidebar-width) flex-col border-r border-line-1 bg-surface-1 lg:flex">
      <Link href="/" className="mx-3 mt-4 flex h-12 items-center rounded-md px-3 focus-ring">
        <Wordmark />
        {isDemoMode && (
          <Badge tone="accent" className="ml-auto">
            {t("app.demoBadge")}
          </Badge>
        )}
      </Link>

      <nav aria-label={t("nav.label")} className="mt-5 flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
        {NAV_GROUPS.map((group) => {
          const items = open.filter((item) => item.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className={cn(group !== "start" && "mt-4")}>
              {group !== "start" && (
                <p className="mb-1 px-3 label-pixel text-fg-3">{t(`nav.groups.${group}` as "nav.groups.invest")}</p>
              )}
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} pathname={pathname} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {locked.length > 0 && (
          <div className="mt-4 border-t border-line-1 pt-3" data-testid="nav-soon">
            <button
              type="button"
              aria-expanded={soonOpen}
              onClick={() => setShowSoon((v) => !v)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left focus-ring transition-colors duration-fast hover:bg-surface-2"
            >
              <PixelIcon {...UI_ICONS.lock} scale={2} className="text-fg-3" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg-2">
                  {t("nav.soon")} <span className="nums text-fg-3">({locked.length})</span>
                </span>
                <span className="block truncate text-xs text-fg-3">
                  {t("nav.soonNext", {
                    name: t(`nav.${locked[0]!.key}`),
                    level: unlockLevel(locked[0]!.unlock!) ?? 1,
                  })}
                </span>
              </span>
              <span aria-hidden className={cn("text-fg-3 transition-transform duration-fast", soonOpen && "rotate-90")}>
                ›
              </span>
            </button>
            {soonOpen && (
              <ul className="mt-1 flex flex-col gap-0.5">
                {locked.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} pathname={pathname} lockedLevel={unlockLevel(item.unlock!) ?? 1} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </nav>

      <Link
        href="/profile"
        className="mx-3 mb-4 rounded-lg border border-line-1 bg-surface-2 p-3.5 focus-ring transition-colors duration-fast hover:border-line-2"
      >
        <div className="mb-2.5 flex items-baseline justify-between">
          <span className="font-pixel text-xs text-fg-1 uppercase">{t("topbar.level", { level })}</span>
          <span className="nums text-xs text-fg-3">
            {xp} / {needed} XP
          </span>
        </div>
        <Progress value={xp / needed} label={t("profile.xpLabel")} tone="accent" size="sm" />
      </Link>
    </aside>
  );
}

function NavLink({ item, pathname, lockedLevel }: { item: NavItem; pathname: string; lockedLevel?: number }) {
  const t = useTranslations("nav");
  const active = isActivePath(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      data-tour={`nav-${item.key}`}
      onClick={() => void playSound("tap")}
      className={cn(
        "group relative flex h-10 items-center gap-3 rounded-md px-3 text-base font-medium focus-ring transition-colors duration-fast",
        active ? "text-fg-1" : lockedLevel ? "text-fg-3 hover:text-fg-2" : "text-fg-2 hover:text-fg-1",
      )}
    >
      {active ? (
        <motion.span
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-md bg-surface-3"
          transition={SPRING.snappy}
        />
      ) : (
        <span className="absolute inset-0 rounded-md bg-surface-2 opacity-0 transition-opacity duration-fast group-hover:opacity-100" />
      )}
      <PixelIcon
        {...UI_ICONS[item.icon]}
        scale={2}
        className={cn("relative transition-colors duration-fast", active && "text-accent")}
      />
      <span className="relative truncate">{t(item.key)}</span>
      {lockedLevel !== undefined && <LockBadge level={lockedLevel} className="relative ml-auto" />}
    </Link>
  );
}
