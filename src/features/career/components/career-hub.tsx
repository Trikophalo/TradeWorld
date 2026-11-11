"use client";

import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Card } from "@/components/ui/card";
import { LinkCard } from "@/components/ui/link-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGame } from "@/features/game/store";
import { useMyCompany } from "@/features/company/hooks";
import { useMyJob, usePlayerCard, useSkills } from "../hooks";
import { BusinessCard } from "./business-card";
import { MyJobCard } from "./my-job-card";
import { useJobTitle } from "./job-title";

/** Career tab: current job, skills, own business card (the company has its own tab, ADR-075) (ADR-050–054). */
export function CareerHub() {
  const t = useTranslations("career");
  const skills = useSkills();
  const nickname = useGame((state) => state.portfolio?.nickname ?? null);
  const company = useMyCompany();
  const job = useMyJob();
  const jobTitle = useJobTitle(job.data ?? { titleKey: null, title: null });
  const tc = useTranslations("chat");

  return (
    <div className="grid items-start gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6">
      <div className="space-y-5 lg:space-y-6">
        <p className="text-pretty text-fg-2">{t("intro")}</p>
        {job.data ? (
          <LinkCard
            href="/job"
            icon={<PixelIcon {...UI_ICONS.briefcase} scale={2} className="text-gain" />}
            title={t("jobLink")}
            hint={t("jobLinkHint", { title: jobTitle, company: job.data.company.name })}
          />
        ) : (
          <MyJobCard />
        )}
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
