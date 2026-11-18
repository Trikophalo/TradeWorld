/*
 * Where a mission is done. Most missions happen all over the game and have no single place; the ones that
 * belong to one area lead there from the missions list. Matched by the template key the server sends
 * (for example "d_nexamon_pack", "m_nexamon_first_ten").
 */
const MISSION_ROUTES: readonly { part: string; href: string }[] = [
  { part: "nexamon", href: "/nexamon" },
  // ADR-202: the new feature missions lead to their pages too
  { part: "crypto", href: "/crypto" },
  { part: "nft", href: "/nfts" },
  { part: "upgrade", href: "/upgrades" },
  { part: "upgrades", href: "/upgrades" },
];

/** The page of a mission, or null when it has none. `key` is the mission's template key. */
export function missionRoute(key: string): string | null {
  const parts = key.toLowerCase().split("_");
  return MISSION_ROUTES.find((route) => parts.includes(route.part))?.href ?? null;
}
