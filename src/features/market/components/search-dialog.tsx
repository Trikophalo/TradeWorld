"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { PlayerTag } from "@/components/ui/player-tag";
import { Skeleton } from "@/components/ui/skeleton";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { engine, useGame } from "@/features/game/store";
import type { PlayerSearchResult } from "@/features/game/types";
import { brandColor } from "../brand";
import { cn } from "@/lib/utils";
import { isTutorialActive } from "@/features/tutorial/store";
import { useSearch } from "../search-store";
import { CompanyLogo } from "./company-logo";

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

type Hit =
  | { kind: "stock"; id: string; ticker: string; name: string; crypto?: boolean }
  | { kind: "player"; id: string; player: PlayerSearchResult };

/** The query after a short pause, so the player search does not run on every key. */
function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Global search: stocks and players by name or #tag (ADR-085). Opens with "/" or from the top bar. */
export function SearchDialog() {
  const t = useTranslations();
  const router = useRouter();
  const open = useSearch((state) => state.open);
  const setOpen = useSearch((state) => state.setOpen);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "/" && !isTyping(event.target) && !event.metaKey && !event.ctrlKey && !isTutorialActive()) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const securities = useGame((state) => state.snapshot?.securities);
  const playerQuery = useDebounced(query.trim(), 250);
  const players = useQuery({
    queryKey: ["search-players", playerQuery],
    queryFn: () => engine.searchPlayers(playerQuery),
    enabled: open && playerQuery.length >= 2,
    staleTime: 30_000,
  });
  const stocks = useMemo(() => {
    const all = securities ?? [];
    const needle = query.trim().toLowerCase();
    if (needle.startsWith("#")) return [];
    if (!needle) return all.filter((s) => s.kind === "stock").slice(0, 6);
    return all.filter((c) => c.name.toLowerCase().includes(needle) || c.ticker.toLowerCase().includes(needle));
  }, [query, securities]);
  const results = useMemo<Hit[]>(
    () => [
      ...stocks.map((s): Hit => ({
        kind: "stock",
        id: `stock-${s.ticker}`,
        ticker: s.ticker,
        name: s.name,
        crypto: s.kind === "crypto",
      })),
      ...(playerQuery.length >= 2 && playerQuery === query.trim() ? (players.data ?? []) : []).map((p): Hit => ({
        kind: "player",
        id: `player-${p.nickname}`,
        player: p,
      })),
    ],
    [stocks, players.data, playerQuery, query],
  );
  const firstPlayer = results.findIndex((r) => r.kind === "player");
  const searchingPlayers = query.trim().length >= 2 && (players.isFetching || playerQuery !== query.trim());

  const go = (hit: Hit) => {
    setOpen(false);
    router.push(
      hit.kind === "stock"
        ? hit.crypto
          ? `/crypto/${hit.ticker}`
          : `/markets/${hit.ticker}`
        : `/players/${encodeURIComponent(hit.player.nickname)}`,
    );
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setCursor(0);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-overlay bg-scrim data-[state=open]:animate-[vt-fade_var(--duration-fast)_var(--ease-out)]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-3 top-[calc(var(--safe-top)+12px)] z-sheet mx-auto max-w-xl overflow-hidden rounded-xl border border-line-2 bg-surface-1 shadow-3 outline-none data-[state=open]:animate-pop lg:top-24"
        >
          <Dialog.Title className="sr-only">{t("search.title")}</Dialog.Title>
          <div className="flex h-14 items-center gap-3 border-b border-line-1 px-4 text-fg-3">
            <PixelIcon {...UI_ICONS.search} scale={2} />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setCursor((c) => Math.min(results.length - 1, c + 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setCursor((c) => Math.max(0, c - 1));
                } else if (event.key === "Enter" && results[cursor]) {
                  go(results[cursor]);
                }
              }}
              placeholder={t("search.placeholder")}
              aria-label={t("topbar.search")}
              role="combobox"
              aria-expanded
              aria-controls="search-results"
              aria-activedescendant={results[cursor] ? `search-${results[cursor].id}` : undefined}
              className="h-full flex-1 bg-transparent text-base text-fg-1 outline-none placeholder:text-fg-3"
            />
            <kbd className="hidden rounded-xs bg-surface-3 px-1.5 py-0.5 label-pixel text-fg-2 sm:block">Esc</kbd>
          </div>

          {results.length === 0 && searchingPlayers ? (
            <div className="space-y-2 p-4" aria-busy="true">
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ) : results.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="font-pixel text-sm text-fg-1 uppercase">{t("search.empty")}</p>
              <p className="mt-2 text-sm text-fg-2">{t("search.emptyHint")}</p>
            </div>
          ) : (
            <ul id="search-results" role="listbox" className="max-h-[50dvh] overflow-y-auto p-2">
              {results.map((hit, index) => (
                <li key={hit.id} id={`search-${hit.id}`} role="option" aria-selected={index === cursor}>
                  {index === firstPlayer && (
                    <p className="px-3 pt-3 pb-1 label-pixel text-fg-3" role="presentation">
                      {t("search.players")}
                    </p>
                  )}
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => go(hit)}
                    onPointerMove={() => setCursor(index)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-fast",
                      index === cursor && "bg-surface-3",
                    )}
                    data-testid={hit.kind === "player" ? "search-player" : undefined}
                  >
                    {hit.kind === "stock" ? (
                      <>
                        <CompanyLogo ticker={hit.ticker} color={brandColor(hit.ticker)} />
                        <span className="min-w-0 flex-1 truncate font-medium text-fg-1">{hit.name}</span>
                        <span className="label-pixel text-fg-3">{hit.ticker}</span>
                      </>
                    ) : (
                      <>
                        <Avatar avatarKey={hit.player.avatarKey} size="xs" />
                        <span className="min-w-0 flex-1 truncate font-medium text-fg-1">{hit.player.nickname}</span>
                        <PlayerTag tag={hit.player.tag} />
                        <span className="nums text-xs text-fg-3">{t("search.level", { level: hit.player.level })}</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-line-1 px-4 py-2.5 text-xs text-fg-3">{t("search.hint")}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
