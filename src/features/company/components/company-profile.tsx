"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { BEAR, SECTOR_ICONS, type SectorKey } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { EmptyState } from "@/components/ui/empty-state";
import { PlayerTag } from "@/components/ui/player-tag";
import { Skeleton } from "@/components/ui/skeleton";
import { engine } from "@/features/game/store";
import { CompanyLogo } from "@/features/market/components/company-logo";
import { formatMoney, formatPrice } from "@/lib/format";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";

type TierKey = Parameters<ReturnType<typeof useTranslations<"careerTiers">>>[0];
type ProductKey = Parameters<ReturnType<typeof useTranslations<"products">>>[0];
type SectorName = Parameters<ReturnType<typeof useTranslations<"sectors">>>[0];

const date = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });

/** Any company from the outside (ADR-125): who runs it, who works there and how it is doing. */
export function CompanyProfileView({ companyId }: { companyId: string }) {
  const t = useTranslations("companyProfile");
  const ts = useTranslations("sectors");
  const tp = useTranslations("products");
  const tc = useTranslations("careerTiers");
  const profile = useQuery({
    queryKey: ["company-profile", companyId],
    queryFn: () => engine.companyProfile(companyId),
    refetchInterval: 60_000,
    retry: false,
  });
  const data = profile.data;

  if (profile.isError) {
    return (
      <EmptyState
        art={<PixelIcon {...BEAR} scale={4} />}
        title={t("notFound")}
        description={t("back")}
        action={
          <Link href="/rich-list" className={buttonVariants({ variant: "secondary" })}>
            {t("back")}
          </Link>
        }
      />
    );
  }
  if (!data) return <Skeleton className="h-96 w-full rounded-lg" />;

  const { company, founder, facts, members } = data;
  const sectorArt = SECTOR_ICONS[company.sector as SectorKey];
  const fact = (label: string, value: string, hint?: string, tone?: "gain" | "loss") => (
    <div className="rounded-md bg-surface-2 p-3">
      <p className="label-pixel text-fg-3">{label}</p>
      <p
        className={cn(
          "mt-1 nums text-lg font-semibold",
          tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-fg-1",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-fg-3">{hint}</p>}
    </div>
  );
  const period = facts.period === "quarter" ? t("periodQuarter") : facts.period === "ttm" ? t("periodTtm") : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="company-profile">
      <Card padding="lg" className="space-y-4">
        <div className="flex items-start gap-4">
          <CompanyLogo
            ticker={company.ticker ?? ""}
            color={company.brandColor ?? "#888888"}
            logo={company.logo}
            scale={4}
          />
          <div className="min-w-0 flex-1">
            <h1 className="font-pixel text-xl break-words text-fg-1 uppercase">{company.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-2">
              <Badge tone={company.isAi ? "neutral" : "accent"}>{company.isAi ? t("ai") : t("player")}</Badge>
              {company.ticker && <Badge>{company.ticker}</Badge>}
              <span className="inline-flex items-center gap-1">
                {sectorArt && <PixelIcon {...sectorArt} scale={1} />}
                {ts(company.sector as SectorName)}
              </span>
            </p>
            {company.idea && <p className="mt-2 text-sm text-pretty text-fg-3">{company.idea}</p>}
          </div>
        </div>
        {company.listed && company.priceE4 !== null && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2">
            <span className="flex items-center gap-2 nums">
              <span className="font-semibold text-fg-1">{formatPrice(company.priceE4)}</span>
              <Delta bps={company.changeBps ?? 0} />
            </span>
            {company.ticker && (
              <Link
                href={`/markets/${company.ticker}`}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                {t("stock")}
              </Link>
            )}
          </div>
        )}
        {founder && (
          <Link
            href={`/players/${encodeURIComponent(founder.nickname)}`}
            className="flex items-center gap-3 rounded-md px-1 py-1 focus-ring transition-colors duration-fast hover:bg-surface-2"
          >
            <Avatar avatarKey={founder.avatarKey} />
            <span className="min-w-0">
              <span className="block text-xs text-fg-3">{t("founder")}</span>
              <span className="flex items-center gap-2 font-medium text-fg-1">
                {founder.nickname} <PlayerTag tag={founder.tag} />
              </span>
            </span>
          </Link>
        )}
        <p className="text-xs text-fg-3">{t("since", { date: date.format(new Date(company.foundedAt)) })}</p>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="company-facts">
        {facts.valueCents !== null && fact(t("value"), formatMoney(facts.valueCents, { compact: true }))}
        {facts.revenueCents !== null && fact(t("revenue"), formatMoney(facts.revenueCents, { compact: true }), period)}
        {facts.profitCents !== null &&
          fact(
            t("profit"),
            formatMoney(facts.profitCents, { compact: true }),
            period,
            facts.profitCents >= 0 ? "gain" : "loss",
          )}
        {fact(
          t("staff"),
          t("staffValue", { staff: facts.staff }),
          facts.aiWorkers > 0 ? t("aiWorkers", { count: facts.aiWorkers }) : undefined,
        )}
        {facts.product &&
          fact(
            t("product"),
            tp(`${facts.product}.name` as `${ProductKey}`),
            facts.stage !== null ? t("stage", { stage: facts.stage }) : undefined,
          )}
        {facts.qualityBps !== null && fact(t("quality"), `${Math.round(facts.qualityBps / 100)} %`)}
        {facts.awarenessBps !== null && fact(t("awareness"), `${Math.round(facts.awarenessBps / 100)} %`)}
      </div>

      {(data.company.isAi || data.news.length > 0) && (
        <CompanyNewsList ticker={data.company.isAi ? data.company.ticker : null} news={data.news} />
      )}

      <Card padding="lg">
        <CardHeader>
          <CardTitle>{t("team")}</CardTitle>
        </CardHeader>
        {members.length === 0 ? (
          <p className="text-sm text-fg-3">{t("teamEmpty")}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="company-members">
            {members.map((m) => (
              <li key={m.nickname}>
                <Link
                  href={`/players/${encodeURIComponent(m.nickname)}`}
                  className="flex items-center gap-3 rounded-md border border-line-1 bg-surface-2 p-2.5 focus-ring transition duration-fast hover:-translate-y-0.5 hover:border-line-2"
                >
                  <Avatar avatarKey={m.avatarKey} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg-1">{m.nickname}</span>
                    <span className="block text-xs text-fg-3">{tc(m.tier as TierKey)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * News about a company (ADR-130): market news from the server (results, stock hints) and, for AI companies, their
 * own stories from the company's everyday life (messages aiCompanyNews.<ticker>), a few at a time, changing hourly.
 */
function CompanyNewsList({
  ticker,
  news,
}: {
  ticker: string | null;
  news: { headline: string; body: string | null; category: string; publishedAt: string }[];
}) {
  const t = useTranslations("companyProfile");
  const tn = useTranslations("aiCompanyNews");
  const now = useClock();
  const stories =
    ticker && tn.has(ticker as Parameters<typeof tn.has>[0])
      ? (tn.raw(ticker as Parameters<typeof tn.raw>[0]) as string[])
      : [];
  const hour = now === null ? 0 : Math.floor(now / 3_600_000);
  // three stories per hour, one, three and seven hours old
  const inside = stories.length
    ? [0, 1, 2].map((i) => ({ text: stories[(hour + i * 2) % stories.length]!, hoursAgo: [1, 3, 7][i]! }))
    : [];
  if (news.length === 0 && inside.length === 0) return null;
  return (
    <Card padding="lg" className="space-y-3" data-testid="company-profile-news">
      <CardHeader>
        <CardTitle>{t("news")}</CardTitle>
      </CardHeader>
      <ul className="space-y-3">
        {news.map((n, i) => (
          <li key={`m${i}`} className="space-y-0.5">
            <p className="flex items-center gap-2 text-2xs text-fg-3">
              <Badge tone="accent">{t("newsMarket")}</Badge>
              {now !== null &&
                t("newsAgo", { hours: Math.max(0, Math.floor((now - Date.parse(n.publishedAt)) / 3_600_000)) })}
            </p>
            <p className="text-sm font-semibold text-pretty text-fg-1">{n.headline}</p>
            {n.body && <p className="text-xs text-pretty text-fg-2">{n.body}</p>}
          </li>
        ))}
        {now !== null &&
          inside.map((s, i) => (
            <li key={`i${i}`} className="space-y-0.5">
              <p className="flex items-center gap-2 text-2xs text-fg-3">
                <Badge tone="warn">{t("newsInside")}</Badge>
                {t("newsAgo", { hours: s.hoursAgo })}
              </p>
              <p className="text-sm text-pretty text-fg-1">{s.text}</p>
            </li>
          ))}
      </ul>
    </Card>
  );
}
