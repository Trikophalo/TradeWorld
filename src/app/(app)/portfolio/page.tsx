import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BULL, COIN } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Page, PageHeader } from "@/components/layout/page";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PortfolioSummary } from "@/features/portfolio/components/portfolio-summary";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portfolio");
  return { title: t("title") };
}

export default async function PortfolioPage() {
  const t = await getTranslations("portfolio");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <PortfolioSummary />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <Card padding="lg">
          <CardHeader>
            <CardTitle>{t("positions")}</CardTitle>
          </CardHeader>
          <EmptyState
            art={<PixelIcon {...BULL} scale={4} />}
            title={t("emptyTitle")}
            description={t("emptyText")}
            action={
              <Link href="/markets" className={buttonVariants()}>
                {t("emptyAction")}
              </Link>
            }
          />
        </Card>
        <Card padding="lg">
          <CardHeader>
            <CardTitle>{t("history")}</CardTitle>
          </CardHeader>
          <EmptyState
            className="py-4"
            art={<PixelIcon {...COIN} scale={4} />}
            title={t("historyEmptyTitle")}
            description={t("historyEmptyText")}
          />
        </Card>
      </div>
    </Page>
  );
}
