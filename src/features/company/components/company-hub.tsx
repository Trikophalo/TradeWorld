"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyCompany } from "../hooks";
import { BoardView } from "../listed/board";
import { CompanyDashboard } from "./company-dashboard";
import { Founding } from "./founding";

/**
 * Company tab: founding first, then the company page (ADR-057). `?board=<company id>` shows the Geschäftsrat of a
 * company the player holds shares of (ADR-167); for the own company that is simply the board tab.
 */
export function CompanyHub() {
  const overview = useMyCompany();
  const board = useSearchParams().get("board");
  if (overview.isPending) return <HubSkeleton />;
  const company = overview.data?.company ?? null;
  if (board && board !== company?.id) return <ForeignBoard companyId={board} />;
  return company ? (
    <CompanyDashboard company={company} />
  ) : (
    <Founding dissolution={overview.data?.lastDissolution ?? null} />
  );
}

/** The page in outline: header, tab bar, numbers and a chart. */
export function HubSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-14 w-full rounded-lg" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Skeleton className="h-80 w-full rounded-lg" />
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    </div>
  );
}

function ForeignBoard({ companyId }: { companyId: string }) {
  const t = useTranslations("hq.board");
  return (
    <div className="space-y-4" data-testid="foreign-board">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-pretty text-fg-2">{t("foreignIntro")}</p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/companies/${encodeURIComponent(companyId)}`}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {t("toCompany")}
          </Link>
          <Link href="/company" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {t("toMine")}
          </Link>
        </div>
      </div>
      <BoardView companyId={companyId} />
    </div>
  );
}
