"use client";

import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Card } from "@/components/ui/card";
import { LinkCard } from "@/components/ui/link-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGame, usePlayerLevel } from "@/features/game/store";
import { unlockLevel } from "@/lib/sim/progression";
import { usePlayerCard, useSkills } from "../hooks";
import { BusinessCard } from "./business-card";
import { MyJobCard } from "./my-job-card";

/** Career tab: current job, skills, own business card and the way to the company (ADR-050–054). */
export function CareerHub() {
  const t = useTranslations("career");
  const level = usePlayerLevel();
  const skills = useSkills();
  const nickname = useGame((state) => state.portfolio?.nickname ?? null);
  const companyLevel = unlockLevel("found_small_business") ?? 10;

  return (
    <div className="grid items-start gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6">
      <div className="space-y-5 lg:space-y-6">
        <p className="text-pretty text-fg-2">{t("intro")}</p>
        <MyJobCard />
        <div className="grid gap-3 *:min-w-0 sm:grid-cols-2">
          <LinkCard
            href="/career/skills"
            icon={<PixelIcon {...UI_ICONS.star} scale={2} className="text-gold" />}
            title={t("skillsTitle")}
            hint={
              skills.data
                ? `${t("skillsHint", { count: skills.data.learned.length })} · ${t("skillsPoints", { count: skills.data.freePoints })}`
                : "…"
            }
          />
          <LinkCard
            href="/career/jobs"
            icon={<PixelIcon {...UI_ICONS.briefcase} scale={2} className="text-accent" />}
            title={t("portalTitle")}
            hint={t("portalHint")}
          />
        </div>
        <LinkCard
          href="/company"
          icon={<PixelIcon {...UI_ICONS.company} scale={2} className="text-fg-2" />}
          title={t("companyTitle")}
          hint={level < companyLevel ? t("companyHint") : t("companyTitle")}
        />
      </div>
      <div className="space-y-3">
        <div>
          <p className="label-pixel text-fg-2">{t("cardTitle")}</p>
          <p className="text-sm text-fg-3">{t("cardHint")}</p>
        </div>
        {nickname ? <OwnCard nickname={nickname} /> : <Skeleton className="h-72 w-full rounded-xl" />}
      </div>
    </div>
  );
}

function OwnCard({ nickname }: { nickname: string }) {
  const card = usePlayerCard(nickname);
  if (!card.data) return card.isError ? <Card padding="lg" /> : <Skeleton className="h-72 w-full rounded-xl" />;
  return <BusinessCard card={card.data} />;
}
