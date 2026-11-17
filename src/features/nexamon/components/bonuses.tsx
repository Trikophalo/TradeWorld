"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BALANCE } from "@/config/balance";
import { NEXAMON_SETS, nexamonCard, type NexamonType } from "@/config/nexamon";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  NexamonBonusKind,
  NexamonBonuses,
  NexamonCardBonus,
  NexamonCollectionProgress,
} from "@/features/game/nexamon-types";
import { formatBps } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNexamonBonuses } from "../hooks";
import { LoadError } from "./parts";

/*
 * Card bonuses (ADR-171): the small tag a card shows, and the "Boni" tab with the totals against the caps and the
 * progress of every collection, with links to the market for what is missing.
 */
export const BONUS_ICON: Record<NexamonBonusKind, keyof typeof UI_ICONS> = {
  xp: "star",
  mission_xp: "upgrade",
  trade_xp: "markets",
  wage: "briefcase",
  vault: "estate",
  daily: "gift",
  company: "company",
};

/** "+0,5 % Tresorzinsen" with the kind's icon; dimmed while the bonus is not active. */
export function BonusTag({
  bonus,
  className,
  showState = true,
}: {
  bonus: Pick<NexamonCardBonus, "kind" | "bps" | "boostedBps" | "active">;
  className?: string;
  showState?: boolean;
}) {
  const t = useTranslations("nexamon.bonuses");
  const bps = bonus.active ? bonus.boostedBps : bonus.bps;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        showState && !bonus.active ? "text-fg-3" : "text-gain",
        className,
      )}
      data-testid="nexamon-bonus-tag"
      data-active={bonus.active}
    >
      <PixelIcon {...UI_ICONS[BONUS_ICON[bonus.kind]]} scale={1} />
      <span className="nums">{t("tag", { bps: formatBps(bps), kind: t(`kinds.${bonus.kind}`) })}</span>
      {showState && <span className="sr-only">{t(bonus.active ? "active" : "inactive")}</span>}
    </span>
  );
}

/** The "Boni" tab. */
export function BonusesView() {
  const t = useTranslations("nexamon.bonuses");
  const query = useNexamonBonuses();
  if (!query.data && query.error) return <LoadError error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <Skeleton className="h-96 w-full rounded-lg" />;
  const data = query.data;
  const activeCards = data.cards.filter((c) => c.active);
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="nexamon-bonuses">
      <Card padding="md" className="space-y-3">
        <h2 className="text-sm font-semibold text-fg-1">{t("totals")}</h2>
        <p className="text-xs text-pretty text-fg-2">{t("totalsHint")}</p>
        <ul className="space-y-2.5">
          {data.totals.map((total) => (
            <li key={total.kind} data-testid={`bonus-total-${total.kind}`}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 text-fg-1">
                  <PixelIcon {...UI_ICONS[BONUS_ICON[total.kind]]} scale={2} />
                  {t(`kinds.${total.kind}`)}
                </span>
                <span className="nums text-fg-2">
                  {t("ofCap", { value: formatBps(total.effectiveBps), cap: formatBps(total.capBps) })}
                </span>
              </div>
              <Progress
                className="mt-1"
                size="sm"
                tone={total.effectiveBps >= total.capBps ? "gold" : "gain"}
                value={total.capBps > 0 ? total.effectiveBps / total.capBps : 0}
                label={t(`kinds.${total.kind}`)}
              />
              {total.rawBps > total.effectiveBps && (
                <p className="mt-0.5 nums text-xs text-fg-3">{t("diminished", { raw: formatBps(total.rawBps) })}</p>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card padding="md" className="space-y-3">
        <h2 className="text-sm font-semibold text-fg-1">
          {t("cards", { n: activeCards.length, total: data.cards.length })}
        </h2>
        {activeCards.length === 0 ? (
          <EmptyState
            art={<PixelIcon {...UI_ICONS.card} scale={3} />}
            title={t("noneTitle")}
            description={t("noneText")}
          />
        ) : (
          <ul className="divide-y divide-line-1">
            {activeCards.map((c) => (
              <li key={c.cardKey} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <Link href={`/nexamon/${c.cardKey}`} className="truncate text-fg-1 focus-ring hover:text-accent">
                  {nexamonCard(c.cardKey)?.name ?? c.cardKey}
                </Link>
                <BonusTag bonus={c} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {NEXAMON_SETS.map((set) => (
        <SetProgress key={set} set={set} data={data} />
      ))}
    </div>
  );
}

function SetProgress({ set, data }: { set: (typeof NEXAMON_SETS)[number]; data: NexamonBonuses }) {
  const t = useTranslations("nexamon.bonuses");
  const cols = data.collections.filter((c) => c.set === set);
  const complete = cols.find((c) => c.kind === "complete");
  const master = cols.find((c) => c.kind === "master");
  const types = cols.filter((c) => c.kind === "type");
  return (
    <Card padding="md" className="space-y-3 lg:col-span-2" data-testid={`bonus-set-${set}`}>
      <h2 className="text-sm font-semibold text-fg-1">{BALANCE.nexamon.sets[set].name}</h2>
      {complete && <CollectionRow col={complete} />}
      {master && <CollectionRow col={master} />}
      <ul className="grid gap-2 sm:grid-cols-2">
        {types.map((col) => (
          <li key={col.id}>
            <CollectionRow col={col} compact />
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-3">{t("masterRule", { grade: BALANCE.nexamon.bonuses.sets.masterMinGrade })}</p>
    </Card>
  );
}

function CollectionRow({ col, compact = false }: { col: NexamonCollectionProgress; compact?: boolean }) {
  const t = useTranslations("nexamon.bonuses");
  const tc = useTranslations("nexamonCards");
  const title =
    col.kind === "type" ? t("typeCollection", { type: tc(`types.${col.type as NexamonType}`) }) : t(`kind.${col.kind}`);
  const bonus = col.bonusKind
    ? t("tag", { bps: formatBps(col.bonusBps), kind: t(`kinds.${col.bonusKind}`) })
    : t("everyKind", { bps: formatBps(col.bonusBps) });
  return (
    <div className="space-y-1" data-testid={`bonus-col-${col.id}`} data-complete={col.complete}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate text-fg-1">{title}</span>
        <span className="shrink-0 nums text-fg-2">
          {col.have}/{col.need}
        </span>
      </div>
      <Progress size="sm" tone={col.complete ? "gold" : "accent"} value={col.have / col.need} label={title} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {col.complete ? <Badge tone="gain">{t("activeBadge")}</Badge> : null}
        <span className={col.complete ? "text-gain" : "text-fg-3"}>{bonus}</span>
        {col.completedAt && !col.complete && <span className="text-fg-3">{t("rewardPaid")}</span>}
      </div>
      {!col.complete && col.missing.length > 0 && (!compact || col.missing.length <= 4) && (
        <p className="text-xs text-fg-2">
          {t("missing")}{" "}
          {col.missing.slice(0, compact ? 4 : 6).map((key, i) => (
            <span key={key}>
              {i > 0 && ", "}
              <Link
                href={`/nexamon?tab=market&card=${key}`}
                className="text-accent underline-offset-2 focus-ring hover:underline"
                data-testid="bonus-missing-link"
              >
                {nexamonCard(key)?.name ?? key}
              </Link>
            </span>
          ))}
          {col.missing.length > (compact ? 4 : 6) && ` ${t("more", { n: col.missing.length - (compact ? 4 : 6) })}`}
        </p>
      )}
    </div>
  );
}
