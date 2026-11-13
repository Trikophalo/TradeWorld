import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Page } from "@/components/layout/page";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyProfileView } from "@/features/company/components/company-profile";

type Params = PageProps<"/companies/[id]">["params"];

/** Cache Components needs one prerendered param; every other company renders on request. */
export async function generateStaticParams() {
  return [{ id: "demo-company-KLS" }];
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("companyProfile");
  return { title: t("open") };
}

/** The public profile of any company, AI or player (ADR-125). */
export default function CompanyPage({ params }: { params: Params }) {
  return (
    <Page>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-lg" />}>
        <Company params={params} />
      </Suspense>
    </Page>
  );
}

async function Company({ params }: { params: Params }) {
  const { id } = await params;
  return <CompanyProfileView companyId={decodeURIComponent(id)} />;
}
