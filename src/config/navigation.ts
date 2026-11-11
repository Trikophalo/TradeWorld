import type { UiIconName } from "@/components/pixel/art";

export interface NavItem {
  href: string;
  /** Key in messages/*.json under "nav". */
  key: "home" | "portfolio" | "markets" | "career" | "profile";
  icon: UiIconName;
  /** Unlock key (BALANCE.progression.unlocks). The tab is always visible, with a lock until then. */
  unlock?: string;
}

/** The five main tabs: bottom bar on phones, sidebar on desktop. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", key: "home", icon: "home" },
  { href: "/portfolio", key: "portfolio", icon: "portfolio" },
  { href: "/markets", key: "markets", icon: "markets" },
  { href: "/career", key: "career", icon: "briefcase" },
  { href: "/profile", key: "profile", icon: "profile" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // The company lives under the career tab (ADR-057).
  if (href === "/career" && (pathname === "/company" || pathname.startsWith("/company/"))) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}
