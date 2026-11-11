import type { UiIconName } from "@/components/pixel/art";

export interface NavItem {
  href: string;
  /** Key in messages/*.json under "nav". */
  key: "home" | "portfolio" | "markets" | "job" | "career" | "company" | "profile";
  icon: UiIconName;
  /** Unlock key (BALANCE.progression.unlocks). The tab is always visible, with a lock until then. */
  unlock?: string;
  /** Only in the sidebar; on phones the bottom bar has room for six tabs (ADR-069). */
  desktopOnly?: boolean;
}

/** Main tabs: sidebar on desktop, bottom bar (without desktop-only ones) on phones. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", key: "home", icon: "home" },
  { href: "/portfolio", key: "portfolio", icon: "portfolio" },
  { href: "/markets", key: "markets", icon: "markets" },
  { href: "/job", key: "job", icon: "briefcase" },
  { href: "/career", key: "career", icon: "star" },
  { href: "/company", key: "company", icon: "company", unlock: "found_garage", desktopOnly: true },
  { href: "/profile", key: "profile", icon: "profile" },
];

export function isActivePath(pathname: string, href: string, { mobile = false } = {}): boolean {
  if (href === "/") return pathname === "/";
  // On phones the company lives under the career tab (ADR-057, ADR-069).
  if (mobile && href === "/career" && (pathname === "/company" || pathname.startsWith("/company/"))) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}
