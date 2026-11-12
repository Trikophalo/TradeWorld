import type { UiIconName } from "@/components/pixel/art";

export interface NavItem {
  href: string;
  /** Key in messages/*.json under "nav". */
  key:
    "home" | "portfolio" | "markets" | "job" | "career" | "company" | "artworks" | "property" | "friends" | "profile";
  icon: UiIconName;
  /** Unlock key (BALANCE.progression.unlocks). The tab is always visible, with a lock until then. */
  unlock?: string;
  /** On phones: in the "Mehr" sheet instead of the bottom bar (ADR-082). */
  more?: boolean;
}

/** Main tabs: all in the sidebar on desktop; on phones the bottom bar plus a "Mehr" sheet for the rest. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", key: "home", icon: "home" },
  { href: "/portfolio", key: "portfolio", icon: "portfolio" },
  { href: "/markets", key: "markets", icon: "markets" },
  { href: "/job", key: "job", icon: "briefcase" },
  { href: "/career", key: "career", icon: "star" },
  { href: "/company", key: "company", icon: "company", unlock: "found_garage" },
  { href: "/artworks", key: "artworks", icon: "art", unlock: "artworks", more: true },
  { href: "/property", key: "property", icon: "home", unlock: "property", more: true },
  { href: "/friends", key: "friends", icon: "heart", more: true },
  { href: "/profile", key: "profile", icon: "profile", more: true },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
