"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ViewTransition } from "react";
import { Delta } from "@/components/ui/delta";
import { NumberTicker } from "@/components/ui/number-ticker";
import { useSecurity } from "@/features/game/store";
import { formatPrice } from "@/lib/format";
import { brandColor } from "../brand";
import { CompanyLogo } from "./company-logo";

const format = (value: number) => formatPrice(Math.round(value));

/**
 * One stock in a list. Logo and price carry view-transition names, so they
 * glide into the header of the detail page. Only this row re-renders when
 * its price ticks.
 */
export function SecurityRow({ ticker, shared = true }: { ticker: string; shared?: boolean }) {
  const t = useTranslations("sectors");
  const security = useSecurity(ticker);
  if (!security) return null;

  const logo = <CompanyLogo ticker={ticker} color={brandColor(ticker)} />;

  return (
    <Link
      href={`/markets/${ticker}`}
      transitionTypes={["nav-forward"]}
      data-tour="stock-row"
      className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 focus-ring transition-colors duration-fast hover:bg-surface-2 active:bg-surface-3"
    >
      {shared ? (
        <ViewTransition name={`logo-${ticker}`} share="morph" default="none">
          {logo}
        </ViewTransition>
      ) : (
        logo
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-fg-1">{security.name}</span>
        <span className="label-pixel text-fg-3">
          {ticker}
          {security.sector && ` · ${t(security.sector)}`}
        </span>
      </span>
      <span className="flex flex-col items-end gap-0.5">
        <NumberTicker value={security.lastE4} format={format} flash className="px-1 font-semibold text-fg-1" />
        <Delta bps={security.changeBps} className="px-1" />
      </span>
    </Link>
  );
}

/** Placeholder rows while the first snapshot loads. */
export { SkeletonRow as SecurityRowSkeleton } from "@/components/ui/skeleton";
