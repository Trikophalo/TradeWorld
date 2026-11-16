"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { useLiveOpenerReport } from "./hooks";
import { Reactions } from "./reactions";

/**
 * The opener's side of a live opening (ADR-172): reports each shown card so spectators follow the real pace, and
 * shows how many watch, with their emoji bursts. Nothing while nobody watches.
 */
export function LiveWatchers({ packId, revealed }: { packId: string | null; revealed: number }) {
  const t = useTranslations("nexamonLive");
  const report = useLiveOpenerReport(packId, revealed);
  if (!report?.liveId || report.viewers === 0) return null;
  return (
    <>
      <Badge tone="loss" data-testid="opener-viewers">
        {t("liveViewers", { count: report.viewers })}
      </Badge>
      <Reactions liveId={report.liveId} reactions={report.reactions} canReact={false} />
    </>
  );
}
