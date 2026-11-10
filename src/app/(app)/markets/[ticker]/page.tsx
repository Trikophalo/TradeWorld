import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Page } from "@/components/layout/page";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StockDetail } from "@/features/market/components/stock-detail";
import { DEMO_COMPANIES, findDemoCompany } from "@/lib/demo/market";

type Params = PageProps<"/markets/[ticker]">["params"];

/** Known tickers are prerendered, so list -> detail navigates instantly and the logo can morph. */
export async function generateStaticParams() {
  return DEMO_COMPANIES.map((company) => ({ ticker: company.ticker }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { ticker } = await params;
  const company = findDemoCompany(ticker);
  return { title: company ? `${company.name} (${company.ticker})` : ticker.toUpperCase() };
}

export default function StockPage({ params }: { params: Params }) {
  return (
    <Page>
      <Suspense fallback={<StockSkeleton />}>
        <Stock params={params} />
      </Suspense>
    </Page>
  );
}

async function Stock({ params }: { params: Params }) {
  const { ticker } = await params;
  const company = findDemoCompany(ticker);
  if (!company) notFound();
  return <StockDetail company={company} />;
}

/** Same shape as the loaded page: header, chart card, side cards. */
function StockSkeleton() {
  return (
    <div className="space-y-5 lg:space-y-6">
      <Skeleton className="h-5 w-40" />
      <div className="flex items-center gap-4">
        <Skeleton className="size-16 rounded-none" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-5 w-28" />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <Card padding="lg" className="space-y-4">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-64 w-full rounded-md lg:h-96" />
        </Card>
        <Card padding="lg" className="space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-24 w-full" />
        </Card>
      </div>
    </div>
  );
}
