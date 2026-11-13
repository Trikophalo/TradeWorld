"use client";

import { AiOrgChart, OrgChart } from "@/features/company/components/org-chart";
import { CompanyNewsCard, SituationCard } from "@/features/company/components/situation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { BALANCE } from "@/config/balance";
import { useMyCompany } from "@/features/company/hooks";
import { useProductText } from "@/features/company/product-name";
import { useCandles } from "@/features/game/hooks";
import { engine, useGame, useSecurity } from "@/features/game/store";
import type { EmployerView, MyJob } from "@/features/game/types";
import { PriceChart } from "@/features/market/components/price-chart";
import { formatMoney, formatPrice } from "@/lib/format";
import { useMyJob } from "../hooks";
import { CareerLadder, PayRoutes } from "./career-ladder";
import { ActiveJob } from "./my-job-card";
import { PixelWorker } from "./pixel-worker";

function useEmployer(enabled: boolean) {
  return useQuery({ queryKey: ["career", "employer"], queryFn: () => engine.employer(), enabled, staleTime: 30_000 });
}

/** The job tab (ADR-064): the worker at the desk, pay, and everything about the employer. */
export function JobView() {
  const tn = useTranslations("companyNews");
  const t = useTranslations("jobTab");
  const job = useMyJob();
  const company = useMyCompany();
  const employer = useEmployer(Boolean(job.data));
  const nickname = useGame((state) => state.portfolio?.nickname ?? "");
  const avatarKey = useGame((state) => state.portfolio?.avatarKey ?? null);

  if (job.isPending) return <Skeleton className="h-96 w-full rounded-lg" />;

  if (!job.data) {
    const founder = Boolean(company.data?.company);
    return (
      <EmptyState
        art={<PixelIcon {...UI_ICONS.briefcase} scale={4} />}
        title={founder ? t("founder") : t("none")}
        description={founder ? "" : t("noneText")}
        action={
          <Link href={founder ? "/company" : "/career/jobs"} className={buttonVariants()}>
            {founder ? t("toCompany") : t("toPortal")}
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid items-start gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6">
      <div className="space-y-5">
        <WorkerCard job={job.data} />
        <ActiveJob job={job.data} />
        <CareerLadder job={job.data} />
        {employer.data?.kind === "player" ? (
          <OrgChart companyId={employer.data.company.id} />
        ) : (
          <AiOrgChart job={job.data} nickname={nickname} avatarKey={avatarKey ?? "rookie"} />
        )}
        {/* Staff of a player company see its situation and news (ADR-091). */}
        {employer.data?.kind === "player" && (
          <>
            <SituationCard companyId={employer.data.company.id} />
            <CompanyNewsCard companyId={employer.data.company.id} title={tn("employeeTitle")} />
          </>
        )}
      </div>
      <div className="space-y-5">
        <PayRoutes job={job.data} />
        {employer.data ? <EmployerCard employer={employer.data} /> : <Skeleton className="h-64 w-full rounded-lg" />}
        {employer.data?.kind === "player" && (
          <Link href="/career/chat" className={buttonVariants({ variant: "secondary", block: true })}>
            {t("chat")}
          </Link>
        )}
      </div>
    </div>
  );
}

function WorkerCard({ job }: { job: MyJob }) {
  const t = useTranslations("jobTab");
  const avatarKey = useGame((state) => state.portfolio?.avatarKey ?? null);
  const own = useMyCompany().data?.company ?? null;
  const sector = job.company.sector ?? "tech";
  const perHour =
    ((job.productivityBps / 10_000) * BALANCE.startups.capacityCentsPerProductivity[sector]) /
    BALANCE.time.quarterHours;
  return (
    <Card padding="lg" className="overflow-hidden" data-testid="worker" data-tour="worker">
      <div className="flex items-center justify-between gap-3">
        <Badge tone="gain">
          <span className="size-2 animate-pulse rounded-pill bg-gain" aria-hidden /> {t("working")}
        </Badge>
        <span className="text-xs text-fg-3">{job.company.name}</span>
      </div>
      <div className="my-5 rounded-md bg-surface-2 px-4 pt-6 pb-2">
        <PixelWorker avatarKey={avatarKey} />
      </div>
      <p className="text-sm text-pretty text-fg-2">{t("workingHint")}</p>
      {own && (
        <p className="mt-2 text-sm text-pretty text-info" data-testid="founder-hint">
          {t("founderHint", { name: own.name, count: own.headcount, from: own.fullTimeFrom })}
        </p>
      )}
      <p className="mt-2 nums text-sm text-gain">{t("earnsCompany", { amount: formatMoney(Math.round(perHour)) })}</p>
    </Card>
  );
}

function EmployerCard({ employer }: { employer: EmployerView }) {
  const t = useTranslations("jobTab");
  const product = useProductText();
  const ts = useTranslations("sectors");
  return (
    <Card padding="lg" className="space-y-4" data-testid="employer">
      <div>
        <p className="label-pixel text-fg-3">{t("employerTitle")}</p>
        <p className="mt-1 text-lg font-semibold text-fg-1">{employer.company.name}</p>
        <p className="text-sm text-fg-3">
          {employer.kind === "ai" ? t("aiCompany") : t("playerCompany")}
          {employer.company.sector ? ` · ${ts(employer.company.sector)}` : ""}
        </p>
      </div>
      {employer.kind === "ai" && employer.company.ticker && <StockBox ticker={employer.company.ticker} />}
      {employer.kind === "player" && (
        <dl className="space-y-2 text-sm">
          {employer.productKey && (
            <div className="flex justify-between gap-3">
              <dt className="text-fg-3">{t("product")}</dt>
              <dd className="text-fg-1">{product.name(employer.productKey)}</dd>
            </div>
          )}
          {employer.stage !== null && <p className="text-fg-2">{t("stage", { stage: employer.stage })}</p>}
          {employer.founder && <p className="text-fg-2">{t("founderName", { name: employer.founder })}</p>}
          <p className="text-fg-2">{t("team", { count: employer.teamSize })}</p>
        </dl>
      )}
      {employer.lastQuarter && (
        <div className="rounded-md bg-surface-2 px-3 py-2.5 text-sm">
          <p className="label-pixel text-fg-3">
            {t("lastQuarter")} · {employer.lastQuarter.label}
          </p>
          <p className="mt-1 nums text-fg-1">
            {t("revenue", { amount: formatMoney(employer.lastQuarter.revenueCents, { compact: true }) })}
          </p>
          <p className={employer.lastQuarter.profitCents >= 0 ? "nums text-gain" : "nums text-loss"}>
            {t("profit", { amount: formatMoney(employer.lastQuarter.profitCents, { compact: true }) })}
          </p>
        </div>
      )}
    </Card>
  );
}

function StockBox({ ticker }: { ticker: string }) {
  const t = useTranslations("jobTab");
  const security = useSecurity(ticker);
  const candles = useCandles(ticker, "1T");
  if (!security) return <Skeleton className="h-40 w-full rounded-md" />;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-fg-2">
          {t("stock")} {ticker}
        </span>
        <span className="flex items-baseline gap-2">
          <span className="nums font-semibold text-fg-1">{formatPrice(security.lastE4)}</span>
          <Delta bps={security.changeBps} className="text-xs" />
        </span>
      </div>
      <PriceChart
        candles={candles.data}
        liveE4={security.lastE4}
        positive={security.changeBps >= 0}
        label={`${ticker} ${formatPrice(security.lastE4)}`}
        className="h-32"
      />
      <Link href={`/markets/${ticker}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
        {t("toStock")}
      </Link>
    </div>
  );
}
