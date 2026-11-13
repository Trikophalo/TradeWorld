"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { engine } from "@/features/game/store";
import { brandColor } from "@/features/market/brand";
import { CompanyLogo } from "@/features/market/components/company-logo";
import { formatMoney } from "@/lib/format";

/**
 * What a player is invested in and how much (ADR-121). Friends and the player see the positions; everyone else
 * reads that it is private.
 */
export function ProfileHoldings({ nickname }: { nickname: string }) {
  const t = useTranslations("holdings");
  const holdings = useQuery({
    queryKey: ["holdings", nickname.toLowerCase()],
    queryFn: () => engine.playerHoldings(nickname),
    refetchInterval: 60_000,
  });
  const data = holdings.data;
  return (
    <Card padding="lg" data-testid="profile-holdings">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        {data?.visible && data.totalCents !== null && (
          <span className="nums text-sm text-fg-2">{t("total", { amount: formatMoney(data.totalCents) })}</span>
        )}
      </CardHeader>
      {!data ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
        </div>
      ) : !data.visible ? (
        <p className="text-sm text-pretty text-fg-3" data-testid="holdings-private">
          {t("private", { name: nickname })}
        </p>
      ) : data.positions.length === 0 ? (
        <p className="text-sm text-fg-3">{t("empty", { name: nickname })}</p>
      ) : (
        <ul>
          {data.positions.map((p) => (
            <li key={p.ticker}>
              <Link
                href={
                  p.kind === "stock" ? `/markets/${p.ticker}` : p.kind === "crypto" ? `/crypto/${p.ticker}` : "/markets"
                }
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 focus-ring transition-colors duration-fast hover:bg-surface-2"
                data-holding={p.ticker}
              >
                <CompanyLogo ticker={p.ticker} color={brandColor(p.ticker)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg-1">{p.name}</span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-3">
                      <span
                        className="block h-full origin-left rounded-pill bg-accent"
                        style={{ transform: `scaleX(${Math.min(1, p.shareBps / 10_000)})` }}
                      />
                    </span>
                    <span className="nums text-xs text-fg-3">
                      {t("share", { percent: Math.round(p.shareBps / 100) })}
                    </span>
                  </span>
                </span>
                <span className="nums font-semibold text-fg-1">{formatMoney(p.valueCents, { whole: true })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
