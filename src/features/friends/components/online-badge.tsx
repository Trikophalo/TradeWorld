"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useFriends } from "../hooks";

/** How many friends are online right now; nothing when none are. */
export function FriendsOnlineBadge({ className }: { className?: string }) {
  const t = useTranslations("friends");
  const count = useFriends().data?.friends.filter((f) => f.online).length ?? 0;
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-pill bg-gain-soft px-1.5 py-0.5 nums text-2xs text-gain",
        className,
      )}
      aria-label={t("onlineCount", { count })}
      data-testid="friends-online"
    >
      <span className="size-1.5 rounded-full bg-gain" aria-hidden />
      {count}
    </span>
  );
}
