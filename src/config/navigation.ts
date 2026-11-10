import type { UiIconName } from "@/components/pixel/art";

export interface NavItem {
  href: string;
  /** Key in messages/*.json under "nav". */
  key: "home" | "portfolio" | "markets" | "company" | "profile";
  icon: UiIconName;
}

/** The five main tabs: bottom bar on phones, sidebar on desktop. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", key: "home", icon: "home" },
  { href: "/portfolio", key: "portfolio", icon: "portfolio" },
  { href: "/markets", key: "markets", icon: "markets" },
  { href: "/company", key: "company", icon: "company" },
  { href: "/profile", key: "profile", icon: "profile" },
];

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
