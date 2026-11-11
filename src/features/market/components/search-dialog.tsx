"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { DEMO_COMPANIES } from "@/lib/demo/market";
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

/** Global search. Opens with "/" or from the top bar; arrow keys and Enter work. */
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

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return DEMO_COMPANIES.slice(0, 6);
    return DEMO_COMPANIES.filter(
      (c) => c.name.toLowerCase().includes(needle) || c.ticker.toLowerCase().includes(needle),
    );
  }, [query]);

  const go = (ticker: string) => {
    setOpen(false);
    router.push(`/markets/${ticker}`);
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
                  go(results[cursor].ticker);
                }
              }}
              placeholder={t("search.placeholder")}
              aria-label={t("topbar.search")}
              role="combobox"
              aria-expanded
              aria-controls="search-results"
              aria-activedescendant={results[cursor] ? `search-${results[cursor].ticker}` : undefined}
              className="h-full flex-1 bg-transparent text-base text-fg-1 outline-none placeholder:text-fg-3"
            />
            <kbd className="hidden rounded-xs bg-surface-3 px-1.5 py-0.5 label-pixel text-fg-2 sm:block">Esc</kbd>
          </div>

          {results.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="font-pixel text-sm text-fg-1 uppercase">{t("search.empty")}</p>
              <p className="mt-2 text-sm text-fg-2">{t("search.emptyHint")}</p>
            </div>
          ) : (
            <ul id="search-results" role="listbox" className="max-h-[50dvh] overflow-y-auto p-2">
              {results.map((company, index) => (
                <li key={company.ticker} id={`search-${company.ticker}`} role="option" aria-selected={index === cursor}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => go(company.ticker)}
                    onPointerMove={() => setCursor(index)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-fast",
                      index === cursor && "bg-surface-3",
                    )}
                  >
                    <CompanyLogo ticker={company.ticker} color={company.color} />
                    <span className="min-w-0 flex-1 truncate font-medium text-fg-1">{company.name}</span>
                    <span className="label-pixel text-fg-3">{company.ticker}</span>
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
