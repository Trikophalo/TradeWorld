import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BULL, COIN, SECTOR_ICONS, UI_ICONS } from "@/components/pixel/art";
import { LinkCard } from "@/components/ui/link-card";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Page, PageHeader } from "@/components/layout/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Reveal } from "@/features/progression/components/reveal";
import { LevelCard } from "@/features/progression/components/level-card";
import { UnlockList } from "@/features/progression/components/unlock-list";
import { AccountReset } from "@/features/settings/components/account-reset";
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
          <Reveal feature="profileFriends">
            <LinkCard
              href="/friends"
              icon={<PixelIcon {...UI_ICONS.heart} scale={2} />}
              title={t("friends")}
              hint={t("friendsHint")}
            />
          </Reveal>
          <LinkCard
            href="/missions"
            icon={<PixelIcon {...BULL} scale={2} />}
            title={t("missions")}
            hint={t("missionsHint")}
          />
          <LinkCard
            href="/rich-list"
            icon={<PixelIcon {...COIN} scale={2} />}
            title={t("richList")}
            hint={t("richListHint")}
          />
          <LinkCard
            href="/profile/rules"
            icon={<PixelIcon {...SECTOR_ICONS.tech} scale={2} />}
            title={t("rules")}
            hint={t("rulesHint")}
          />
          <SettingsCard />
          <AccountReset />
        </div>
        <UnlockList />
      </div>
    </Page>
  );
}
