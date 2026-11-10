import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SECTOR_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Page, PageHeader } from "@/components/layout/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
      <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
        <div className="space-y-5 lg:space-y-6">
          <LevelCard />
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
          <SettingsCard />
        </div>
        <UnlockList />
      </div>
    </Page>
  );
}
