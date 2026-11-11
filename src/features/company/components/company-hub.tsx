"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useMyCompany } from "../hooks";
import { CompanyDashboard } from "./company-dashboard";
import { Founding } from "./founding";

/** Company tab: founding first, then the dashboard (ADR-057). */
export function CompanyHub() {
  const company = useMyCompany();
  if (company.isPending) return <Skeleton className="h-96 w-full rounded-lg" />;
  return company.data ? <CompanyDashboard company={company.data} /> : <Founding />;
}
