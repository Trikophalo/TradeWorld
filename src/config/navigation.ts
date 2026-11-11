import type { UiIconName } from "@/components/pixel/art";
import { DISCLOSURE } from "./disclosure";

export interface NavItem {
  href: string;
  /** Key in messages/*.json under "nav". */
  key: "home" | "portfolio" | "markets" | "company" | "profile";
  icon: UiIconName;
  /** Hidden below this level (progressive disclosure). */
  minLevel?: number;
}

/** The five main tabs: bottom bar on phones, sidebar on desktop. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", key: "home", icon: "home" },
  { href: "/portfolio", key: "portfolio", icon: "portfolio" },
  { href: "/markets", key: "markets", icon: "markets" },
  { href: "/company", key: "company", icon: "company", minLevel: DISCLOSURE.navCompany },
  { href: "/profile", key: "profile", icon: "profile" },
];

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The tabs a player of this level sees. */
export function visibleNavItems(level: number): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => level >= (item.minLevel ?? 1));
}
