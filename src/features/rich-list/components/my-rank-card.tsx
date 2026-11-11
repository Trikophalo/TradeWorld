"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatInteger, formatMoney } from "@/lib/format";
import { useRichList } from "../hooks";

/** Your place on the rich list and the next person to overtake. */
export function MyRankCard({ link = false }: { link?: boolean }) {
  const t = useTranslations("richList");
  const list = useRichList("all", 3);
  const me = list.data?.me;

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="label-pixel text-fg-2">{t("title")}</h2>
        {me && (
          <span className="nums text-sm text-fg-3">{t("ofTotal", { total: formatInteger(list.data!.total) })}</span>
        )}
      </div>
      {me ? (
        <>
          <p className="mt-1 font-pixel text-3xl text-fg-1">{t("rank", { rank: formatInteger(me.rank) })}</p>
          {me.next ? (
            <>
              <p className="mt-2 text-sm text-pretty text-fg-2">
                {t("nextTarget", {
                  gap: formatMoney(me.next.gapCents, { whole: true }),
                  name: me.next.name,
                  rank: me.next.rank,
                })}
              </p>
              <Progress
                value={me.netWorthCents / (me.netWorthCents + me.next.gapCents)}
                label={t("nextProgress")}
                size="sm"
                tone="gold"
                className="mt-3"
              />
            </>
          ) : (
            <p className="mt-2 text-sm text-gain">{t("top")}</p>
          )}
        </>
      ) : (
        <>
          <Skeleton className="mt-2 h-9 w-32" />
          <Skeleton className="mt-3 h-4 w-full" />
        </>
      )}
    </>
  );

  return link ? (
    <Link
      href="/rich-list"
      transitionTypes={["nav-forward"]}
      className="block rounded-lg focus-ring"
      data-tour="rich-list-card"
    >
      <Card padding="lg" interactive>
        {body}
      </Card>
    </Link>
  ) : (
    <Card padding="lg">{body}</Card>
  );
}
