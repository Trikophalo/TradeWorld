import type { UiIconName } from "@/components/pixel/art";

export interface NavItem {
  href: string;
  /** Key in messages/*.json under "nav". */
  key: "home" | "portfolio" | "markets" | "job" | "career" | "company" | "profile";
  icon: UiIconName;
  /** Unlock key (BALANCE.progression.unlocks). The tab is always visible, with a lock until then. */
  unlock?: string;
  /** Only in the sidebar; on phones the profile sits in the top bar (ADR-075). */
  desktopOnly?: boolean;
}

/** Main tabs: sidebar on desktop, bottom bar (without desktop-only ones) on phones. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", key: "home", icon: "home" },
  { href: "/portfolio", key: "portfolio", icon: "portfolio" },
  { href: "/markets", key: "markets", icon: "markets" },
  { href: "/job", key: "job", icon: "briefcase" },
  { href: "/career", key: "career", icon: "star" },
  { href: "/company", key: "company", icon: "company", unlock: "found_garage" },
  { href: "/profile", key: "profile", icon: "profile", desktopOnly: true },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
