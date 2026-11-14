import type { UiIconName } from "@/components/pixel/art";

/** Groups of the navigation (ADR-107): short lists with a heading instead of one long column. */
export type NavGroup = "start" | "invest" | "work" | "business" | "assets" | "you";
export const NAV_GROUPS: readonly NavGroup[] = ["start", "invest", "work", "business", "assets", "you"];

export interface NavItem {
  href: string;
  /** Key in messages/*.json under "nav". */
  key:
    | "home"
    | "portfolio"
    | "markets"
    | "job"
    | "career"
    | "company"
    | "artworks"
    | "property"
    | "friends"
    | "deals"
    | "crypto"
    | "upgrades"
    | "profile"
    | "news";
  icon: UiIconName;
  group: NavGroup;
  /** Unlock key (BALANCE.progression.unlocks). Until then the item waits under "Bald frei". */
  unlock?: string;
  /** On phones: in the "Mehr" sheet instead of the bottom bar (ADR-082). */
  more?: boolean;
}

/**
 * Main tabs, grouped (ADR-107). Desktop: the sidebar with group headings, locked areas folded into "Bald frei".
 * Phones: the bottom bar plus a grouped "Mehr" sheet. The profile sits on the avatar in the top bar.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", key: "home", icon: "home", group: "start" },
  { href: "/portfolio", key: "portfolio", icon: "portfolio", group: "invest" },
  { href: "/markets", key: "markets", icon: "markets", group: "invest" },
  { href: "/news", key: "news", icon: "news", group: "invest", more: true },
  { href: "/crypto", key: "crypto", icon: "crypto", group: "invest", unlock: "crypto", more: true },
  { href: "/job", key: "job", icon: "briefcase", group: "work" },
  { href: "/career", key: "career", icon: "star", group: "work" },
  { href: "/company", key: "company", icon: "company", group: "business", unlock: "found_garage" },
  { href: "/deals", key: "deals", icon: "deal", group: "business", unlock: "deals", more: true },
  { href: "/artworks", key: "artworks", icon: "art", group: "assets", unlock: "artworks", more: true },
  { href: "/property", key: "property", icon: "estate", group: "assets", unlock: "property", more: true },
  { href: "/friends", key: "friends", icon: "heart", group: "you", more: true },
  { href: "/upgrades", key: "upgrades", icon: "upgrade", group: "you", more: true },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
