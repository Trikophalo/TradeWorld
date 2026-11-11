"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Delta } from "@/components/ui/delta";
import { NumberTicker } from "@/components/ui/number-ticker";
import { useGame } from "@/features/game/store";
import type { RichListEntry } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const money = (value: number) => formatMoney(Math.round(value), { whole: true });
const MEDALS = ["bg-gold text-on-semantic", "bg-fg-2 text-fg-inverse", "bg-warn text-on-semantic"] as const;

/** One line of the rich list. Your own line is highlighted; players link to their business card. */
export function RankRow({ entry }: { entry: RichListEntry }) {
  const t = useTranslations("richList");
  const myName = useGame((state) => state.portfolio?.nickname);
  const myAvatar = useGame((state) => state.portfolio?.avatarKey ?? null);
  const moved = entry.rankChange24h ?? 0;
  const nickname = entry.isMe ? myName : entry.name;
  const className = cn(
    "flex items-center gap-3 rounded-md px-2 py-2.5",
    entry.isMe ? "bg-accent-soft ring-1 ring-accent" : "transition-colors duration-fast hover:bg-surface-2",
    entry.kind === "player" && nickname && "focus-ring",
  );
  const body = (
    <>
      <span
        className={cn(
          "grid h-7 min-w-9 shrink-0 place-items-center rounded-xs px-1 font-pixel nums text-xs",
          entry.rank <= 3 ? MEDALS[entry.rank - 1] : "bg-surface-3 text-fg-2",
        )}
      >
        {entry.rank}
      </span>
      <Avatar avatarKey={entry.isMe ? myAvatar : entry.avatarKey} size="xs" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn("truncate font-medium", entry.isMe ? "text-fg-1" : "text-fg-1")}>{entry.name}</span>
          {entry.isMe && <span className="shrink-0 label-pixel text-accent">{t("you")}</span>}
        </span>
        <span className="block truncate text-sm text-fg-3">
          {entry.kind === "player" ? t("player") : entry.description}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <NumberTicker value={entry.netWorthCents} format={money} className="font-semibold text-fg-1" />
        <span className="flex items-center gap-2">
          {moved !== 0 && (
            <span className={cn("nums text-xs", moved > 0 ? "text-gain" : "text-loss")}>
              {moved > 0 ? "▲" : "▼"} {Math.abs(moved)}
            </span>
          )}
          {entry.change24hBps !== null && <Delta bps={entry.change24hBps} className="text-xs" />}
        </span>
      </span>
    </>
  );
  if (entry.kind === "player" && nickname) {
    return (
      <Link href={`/players/${encodeURIComponent(nickname)}`} transitionTypes={["nav-forward"]} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}
