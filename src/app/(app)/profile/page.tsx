import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { COIN, SECTOR_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Page, PageHeader } from "@/components/layout/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Reveal } from "@/features/progression/components/reveal";
import { LevelCard } from "@/features/progression/components/level-card";
import { UnlockList } from "@/features/progression/components/unlock-list";
import { SettingsCard } from "@/features/settings/components/settings-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("title") };
}

export default async function ProfilePage() {
  const t = await getTranslations("profile");
  return (
    <Page>
      <PageHeader title={t("title")} />
      <div className="grid gap-5 *:min-w-0 lg:grid-cols-2 lg:gap-6">
        <div className="space-y-5 lg:space-y-6">
          <LevelCard />
          <Reveal feature="profileCareer">
            <Card padding="lg">
              <CardHeader>
                <CardTitle>{t("career")}</CardTitle>
              </CardHeader>
              <EmptyState
                className="py-4"
                art={<PixelIcon {...SECTOR_ICONS.retail} scale={4} />}
                title={t("careerEmptyTitle")}
                description={t("careerEmptyText")}
              />
            </Card>
          </Reveal>
          <Link href="/profile/rules" transitionTypes={["nav-forward"]} className="block rounded-lg focus-ring">
            <Card padding="lg" interactive className="flex items-center gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-md bg-surface-2">
                <PixelIcon {...COIN} scale={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-fg-1">{t("rules")}</span>
                <span className="block truncate text-sm text-fg-3">{t("rulesHint")}</span>
              </span>
              <svg
                viewBox="0 0 4 7"
                width="8"
                height="14"
                shapeRendering="crispEdges"
                aria-hidden
                className="text-fg-3"
              >
                <path
                  fill="currentColor"
                  d="M0 0h1v1H0zM1 1h1v1H1zM2 2h1v1H2zM3 3h1v1H3zM2 4h1v1H2zM1 5h1v1H1zM0 6h1v1H0z"
                />
              </svg>
            </Card>
          </Link>
          <SettingsCard />
        </div>
        <UnlockList />
      </div>
    </Page>
  );
}
