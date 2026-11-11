"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useMyCompany } from "../hooks";
import { CompanyDashboard } from "./company-dashboard";
import { Founding } from "./founding";

/** Company tab: founding first, then the dashboard (ADR-057). */
export function CompanyHub() {
  const overview = useMyCompany();
  if (overview.isPending) return <Skeleton className="h-96 w-full rounded-lg" />;
  return overview.data?.company ? (
    <CompanyDashboard company={overview.data.company} />
  ) : (
    <Founding dissolution={overview.data?.lastDissolution ?? null} />
  );
}
