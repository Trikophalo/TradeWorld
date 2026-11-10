"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ViewTransition } from "react";
import { Delta } from "@/components/ui/delta";
import { NumberTicker } from "@/components/ui/number-ticker";
import type { DemoCompany } from "@/lib/demo/market";
import { useDemo } from "@/lib/demo/store";
import { formatPrice } from "@/lib/format";
import { CompanyLogo } from "./company-logo";

const format = (value: number) => formatPrice(Math.round(value));

/**
 * One stock in a list. Logo and price carry view-transition names, so they
 * glide into the header of the detail page.
 */
export function SecurityRow({ company, shared = true }: { company: DemoCompany; shared?: boolean }) {
  const t = useTranslations("sectors");
  const quote = useDemo((state) => state.quotes[company.ticker]);
  const price = quote?.priceE4 ?? company.priceE4;
  const change = quote?.changeBps ?? company.changeBps;

  const logo = <CompanyLogo ticker={company.ticker} color={company.color} />;
  const priceNode = <NumberTicker value={price} format={format} flash className="px-1 font-semibold text-fg-1" />;

  return (
    <Link
      href={`/markets/${company.ticker}`}
      transitionTypes={["nav-forward"]}
      className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 focus-ring transition-colors duration-fast hover:bg-surface-2 active:bg-surface-3"
    >
      {shared ? (
        <ViewTransition name={`logo-${company.ticker}`} share="morph" default="none">
          {logo}
        </ViewTransition>
      ) : (
        logo
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-fg-1">{company.name}</span>
        <span className="label-pixel text-fg-3">
          {company.ticker} · {t(company.sector)}
        </span>
      </span>
      <span className="flex flex-col items-end gap-0.5">
        {priceNode}
        <Delta bps={change} className="px-1" />
      </span>
    </Link>
  );
}
