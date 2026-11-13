"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Segmented } from "@/components/ui/segmented";
import { FriendsView } from "@/features/friends/components/friends";
import { FeedList } from "./feed";
import { LeagueBoard } from "./league";

type Tab = "feed" | "league" | "friends";
const TABS: readonly Tab[] = ["feed", "league", "friends"];

/** The social hub (ADR-088, ADR-089): what friends did, the weekly league and the friends list. */
export function FriendsHub() {
  const t = useTranslations("social.tabs");
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "feed";
  return (
    <div className="space-y-5">
      <Segmented
        value={tab}
        onValueChange={(next) => router.replace(`/friends?tab=${next}`, { scroll: false })}
        options={TABS.map((value) => ({ value, label: t(value) }))}
        label={t("feed")}
        block
      />
      {tab === "feed" && <FeedList />}
      {tab === "league" && <LeagueBoard />}
      {tab === "friends" && <FriendsView />}
    </div>
  );
}
