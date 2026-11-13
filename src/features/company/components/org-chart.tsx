"use client";

import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BALANCE } from "@/config/balance";
import { engine } from "@/features/game/store";
import type { CareerTier, CompanyOrg, MyJob, OrgPerson } from "@/features/game/types";
import { SPRING, STAGGER } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Ranks from the top, below the founder (ADR-104). */
const RANKS: readonly CareerTier[] = [...BALANCE.careers.tiers.map((t) => t.id)].reverse();
const ROW_MAX = 8;
const AI_MAX = 10;

export function useCompanyOrg(companyId: string | null) {
  return useQuery({
    queryKey: ["company", "org", companyId],
    queryFn: () => engine.companyOrg(companyId!),
    enabled: Boolean(companyId),
    staleTime: 30_000,
  });
}

type Level = { key: "founder" | CareerTier; people: (OrgPerson & { title?: string | null })[] };

/** Levels from the top; empty ranks are left out. */
export function orgLevels(org: CompanyOrg): Level[] {
  const levels: Level[] = [{ key: "founder", people: [org.founder] }];
  for (const rank of RANKS) {
    const people = org.members.filter((m) => m.tier === rank);
    if (people.length > 0) levels.push({ key: rank, people });
  }
  return levels;
}

/** Index of the level directly above the player's (the bosses), or -1. */
export function bossLevelIndex(levels: Level[]): number {
  const mine = levels.findIndex((l) => l.people.some((p) => p.isMe));
  return mine > 0 ? mine - 1 : -1;
}

/**
 * The org chart (ADR-104): the founder on top, then every occupied rank, the AI workers at the bottom. Everyone is a
 * pixel person with name and rank; the player's own place is marked, the bosses directly above are highlighted.
 */
export function OrgChart({ companyId }: { companyId: string }) {
  const t = useTranslations("org");
  const org = useCompanyOrg(companyId);
  if (org.isPending) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!org.data) return null;
  return <OrgView org={org.data} title={t("title", { company: org.data.company.name })} />;
}

export function OrgView({ org, title, links = true }: { org: CompanyOrg; title: string; links?: boolean }) {
  const t = useTranslations("org");
  const tc = useTranslations("careerTiers");
  const reduced = useReducedMotion();
  const levels = orgLevels(org);
  const boss = bossLevelIndex(levels);
  const total = 1 + org.members.length + org.aiWorkers;

  return (
    <Card padding="lg" className="space-y-4 overflow-hidden" data-testid="org-chart">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="label-pixel text-fg-2">{title}</h2>
        <span className="text-xs text-fg-3">{t("count", { count: total })}</span>
      </div>
      <ol className="flex flex-col items-center">
        {levels.map((level, i) => (
          <motion.li
            key={level.key}
            initial={reduced ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING.smooth, delay: reduced ? 0 : i * STAGGER * 2 }}
            className="flex w-full flex-col items-center"
            data-level={level.key}
          >
            {i > 0 && <span aria-hidden className="h-4 w-0.5 bg-line-2" />}
            <p className="mb-1.5 label-pixel text-fg-3">
              {level.key === "founder" ? t("founder") : tc(level.key)}
              {i === boss && <span className="ml-1.5 text-accent">· {t("yourBoss")}</span>}
            </p>
            <ul className="flex flex-wrap justify-center gap-2">
              {level.people.slice(0, ROW_MAX).map((p) => (
                <li key={p.nickname}>
                  <PersonCard person={p} highlight={i === boss} link={links} />
                </li>
              ))}
              {level.people.length > ROW_MAX && (
                <li className="grid place-items-center rounded-md border border-dashed border-line-2 px-3 text-sm text-fg-3">
                  {t("more", { count: level.people.length - ROW_MAX })}
                </li>
              )}
            </ul>
          </motion.li>
        ))}
        {org.aiWorkers > 0 && (
          <li className="flex w-full flex-col items-center" data-level="ai">
            <span aria-hidden className="h-4 w-0.5 bg-line-2" />
            <p className="mb-1.5 label-pixel text-fg-3">{t("ai")}</p>
            <div
              className="flex flex-wrap justify-center gap-1 text-fg-2"
              aria-label={t("aiCount", { count: org.aiWorkers })}
            >
              {Array.from({ length: Math.min(AI_MAX, org.aiWorkers) }, (_, k) => (
                <motion.span
                  key={k}
                  aria-hidden
                  animate={reduced ? undefined : { y: [0, -2, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, delay: k * 0.15, ease: "easeInOut" }}
                  className="grid size-8 place-items-center rounded-xs border border-line-2 bg-surface-2"
                >
                  <PixelIcon {...UI_ICONS.robot} scale={2} />
                </motion.span>
              ))}
              {org.aiWorkers > AI_MAX && <span className="self-center text-sm">+{org.aiWorkers - AI_MAX}</span>}
            </div>
          </li>
        )}
      </ol>
      <p className="text-xs text-pretty text-fg-3">{t("hint")}</p>
    </Card>
  );
}

function PersonCard({
  person,
  highlight,
  link,
}: {
  person: OrgPerson & { title?: string | null };
  highlight: boolean;
  link: boolean;
}) {
  const t = useTranslations("org");
  const className = cn(
    "relative flex w-28 flex-col items-center gap-1 rounded-lg border px-2 py-2 text-center",
    link && "focus-ring transition duration-fast hover:-translate-y-0.5 hover:bg-surface-2",
    person.isMe
      ? "border-accent bg-accent-soft"
      : highlight
        ? "border-gold/60 bg-surface-2"
        : "border-line-1 bg-surface-1",
  );
  const inner = (
    <>
      {person.isMe && (
        <span className="absolute -top-2 rounded-xs bg-accent px-1.5 font-pixel text-2xs text-on-accent uppercase">
          {t("you")}
        </span>
      )}
      <Avatar avatarKey={person.avatarKey} size="xs" />
      <span className="w-full truncate text-xs font-medium text-fg-1">{person.nickname}</span>
      {person.title && <span className="w-full truncate text-2xs text-fg-3">{person.title}</span>}
    </>
  );
  return link ? (
    <Link
      href={`/players/${encodeURIComponent(person.nickname)}`}
      className={className}
      data-testid="org-person"
      data-me={person.isMe}
    >
      {inner}
    </Link>
  ) : (
    <div className={className} data-testid="org-person" data-me={person.isMe}>
      {inner}
    </div>
  );
}

/**
 * AI employers have no players to show: a simple chain from the AI board down to the player, with the AI boss one
 * rank above (ADR-104).
 */
export function AiOrgChart({ job, nickname, avatarKey }: { job: MyJob; nickname: string; avatarKey: string }) {
  const t = useTranslations("org");
  const myRank = RANKS.indexOf(job.tier);
  const above = myRank > 0 ? RANKS[myRank - 1]! : null;
  const org: CompanyOrg = {
    company: { id: job.company.id, name: job.company.name, tier: "ag" },
    founder: { nickname: t("aiBoard"), tag: null, avatarKey: "analyst", isMe: false },
    members: [
      ...(above && above !== job.tier
        ? [
            {
              nickname: t("aiBoss"),
              tag: null,
              avatarKey: "builder",
              tier: above,
              title: null,
              since: null,
              isMe: false,
            },
          ]
        : []),
      { nickname, tag: null, avatarKey, tier: job.tier, title: null, since: job.startedAt, isMe: true },
    ],
    aiWorkers: 6,
    aiWorkerSkills: [],
  };
  return <OrgView org={org} title={t("title", { company: job.company.name })} links={false} />;
}
