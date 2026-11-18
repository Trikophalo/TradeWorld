"use client";

import { Collapsible } from "radix-ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Places gained (▲) or lost (▼) since yesterday; nothing when unchanged or unknown (ADR-203). */
export function RankMove({ moved, className }: { moved: number | null; className?: string }) {
  const t = useTranslations("ranking");
  if (!moved) return null;
  return (
    <span
      className={cn("nums text-xs", moved > 0 ? "text-gain" : "text-loss", className)}
      title={t("rankMove", { count: Math.abs(moved), up: String(moved > 0) })}
    >
      <span aria-hidden>{moved > 0 ? "▲" : "▼"}</span> {Math.abs(moved)}
      <span className="sr-only">{t("rankMove", { count: Math.abs(moved), up: String(moved > 0) })}</span>
    </span>
  );
}

type Board = "forbes" | "all" | "companies";

const LINES = {
  forbes: ["cash", "depot", "company", "cards", "nfts", "deals", "snapshot"],
  all: ["snapshot"],
  companies: ["marketCap", "companyValue", "snapshot"],
} as const;

/** "Wie wird gerechnet?": the one documented valuation of a list (ADR-203), folded away by default. */
export function RankingMethod({ board }: { board: Board }) {
  const t = useTranslations("ranking");
  const [open, setOpen] = useState(false);
  const intro = board === "forbes" ? t("methodForbes") : board === "all" ? t("methodAll") : t("methodCompanies");
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mb-3" data-testid="ranking-method">
      <Collapsible.Trigger className="group inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-accent focus-ring transition-colors duration-fast hover:text-fg-1 active:text-fg-1">
        <span
          aria-hidden
          className="grid size-4 place-items-center rounded-pill bg-accent-soft font-pixel text-2xs text-accent"
        >
          ?
        </span>
        {t("method")}
        <svg
          viewBox="0 0 7 4"
          width="10"
          height="6"
          shapeRendering="crispEdges"
          aria-hidden
          className="transition-transform duration-base ease-out group-data-[state=open]:rotate-180"
        >
          <path fill="currentColor" d="M0 0h1v1H0zM6 0h1v1H6zM1 1h1v1H1zM5 1h1v1H5zM2 2h1v1H2zM4 2h1v1H4zM3 3h1v1H3z" />
        </svg>
      </Collapsible.Trigger>
      <Collapsible.Content className="mt-2 rounded-md border border-line-1 bg-surface-2 p-3 text-xs text-fg-2 data-[state=open]:animate-[vt-fade_var(--duration-slow)_var(--ease-out)]">
        <p className="text-pretty text-fg-1">{intro}</p>
        <ul className="mt-2 space-y-1">
          {(board === "all" ? [...LINES.forbes.slice(0, -1), ...LINES.all] : LINES[board]).map((key) => (
            <li key={key} className="flex gap-2 text-pretty">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 bg-fg-3" />
              {t(`methodLines.${key}`)}
            </li>
          ))}
        </ul>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

/** Small column labels above a ranking (phone first: name left, value right). */
export function RankingColumns({ name, value }: { name: string; value: string }) {
  const t = useTranslations("ranking");
  return (
    <div
      aria-hidden
      className="mb-1 flex items-center gap-3 px-2 text-2xs font-medium tracking-wide text-fg-3 uppercase"
    >
      <span className="min-w-9">{t("colRank")}</span>
      <span className="flex-1">{name}</span>
      <span>{value}</span>
    </div>
  );
}
