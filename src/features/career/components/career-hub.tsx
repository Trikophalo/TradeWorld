"use client";

import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Card } from "@/components/ui/card";
import { LinkCard } from "@/components/ui/link-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGame, usePlayerLevel } from "@/features/game/store";
import { BALANCE } from "@/config/balance";
import { useMyCompany } from "@/features/company/hooks";
import { useMyJob, usePlayerCard, useSkills } from "../hooks";
import { BusinessCard } from "./business-card";
import { MyJobCard } from "./my-job-card";
import { WorkTaskCard } from "./work-task-card";

/** Career tab: current job, skills, own business card and the way to the company (ADR-050–054). */
export function CareerHub() {
  const t = useTranslations("career");
  const level = usePlayerLevel();
  const skills = useSkills();
  const nickname = useGame((state) => state.portfolio?.nickname ?? null);
  const companyLevel = BALANCE.startups.garage.minLevel;
  const company = useMyCompany();
  const job = useMyJob();
  const tc = useTranslations("chat");

  return (
    <div className="grid items-start gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6">
      <div className="space-y-5 lg:space-y-6">
        <p className="text-pretty text-fg-2">{t("intro")}</p>
        <MyJobCard />
        {job.data && <WorkTaskCard />}
        {(job.data ? !job.data.company.isAi : Boolean(company.data?.company)) && (
          <LinkCard
            href="/career/chat"
            icon={<PixelIcon {...UI_ICONS.card} scale={2} className="text-accent" />}
            title={tc("link")}
            hint={tc("linkHint")}
          />
        )}
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
          title={company.data?.company ? t("companyOwn") : t("companyTitle")}
          hint={
            company.data?.company
              ? company.data.company.name
              : level < companyLevel
                ? t("companyHint")
                : t("companyOwn")
          }
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
