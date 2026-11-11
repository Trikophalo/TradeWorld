"use client";

import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonRow } from "@/components/ui/skeleton";
import { useRichNews } from "../hooks";

const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

/** Headlines from the rich list: who climbed, who overtook whom. */
export function RichNews({ limit = 6 }: { limit?: number }) {
  const t = useTranslations("richList");
  const news = useRichNews(limit);
  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle>{t("news")}</CardTitle>
      </CardHeader>
      {!news.data ? (
        <SkeletonRow />
      ) : news.data.length === 0 ? (
        <p className="text-sm text-fg-3">{t("newsEmpty")}</p>
      ) : (
        <ul className="divide-y divide-line-1">
          {news.data.slice(0, limit).map((item) => (
            <li key={`${item.publishedAt}-${item.headline}`} className="py-2.5">
              <p className="nums text-xs text-fg-3">{time.format(new Date(item.publishedAt))}</p>
              <p className="font-medium text-fg-1">{item.headline}</p>
              {item.body && <p className="mt-0.5 text-sm text-pretty text-fg-2">{item.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
