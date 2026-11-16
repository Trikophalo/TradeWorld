"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Segmented } from "@/components/ui/segmented";
import { ChatsView, ChatUnreadBadge } from "@/features/friends/components/chats";
import { FriendsView } from "@/features/friends/components/friends";
import { FriendsPlaza } from "@/features/friends/components/plaza";
import { useDisclosed } from "@/features/progression/components/reveal";
import { FeedList } from "./feed";
import { LeagueBoard } from "./league";

type Tab = "feed" | "league" | "friends" | "chats";
const TABS: readonly Tab[] = ["feed", "league", "friends", "chats"];

/**
 * The social hub (ADR-088, ADR-089): all friends on the plaza first (ADR-155), then what friends did, the weekly
 * league, the friends list and the chats with friends (ADR-164). An open chat leaves the plaza out, so the
 * conversation sits right under the tabs on a phone.
 */
export function FriendsHub() {
  const t = useTranslations("social.tabs");
  const params = useSearchParams();
  const router = useRouter();
  const chats = useDisclosed("friendChats");
  const tabs = chats ? TABS : TABS.filter((x) => x !== "chats");
  const raw = params.get("tab");
  const tab: Tab = tabs.includes(raw as Tab) ? (raw as Tab) : "feed";
  const inChat = tab === "chats" && params.get("chat") !== null;
  return (
    <div className="space-y-5">
      {!inChat && <FriendsPlaza />}
      <Segmented
        value={tab}
        onValueChange={(next) => router.replace(`/friends?tab=${next}`, { scroll: false })}
        options={tabs.map((value) => ({
          value,
          label: t(value),
          adornment: value === "chats" ? <ChatUnreadBadge /> : undefined,
        }))}
        label={t("feed")}
        block
      />
      {tab === "feed" && <FeedList />}
      {tab === "league" && <LeagueBoard />}
      {tab === "friends" && <FriendsView />}
      {tab === "chats" && <ChatsView />}
    </div>
  );
}
