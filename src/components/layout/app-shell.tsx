import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { SearchDialog } from "@/features/market/components/search-dialog";
import { GameSync } from "@/features/game/sync";
import { DailyReward } from "@/features/progression/components/daily-reward";
import { LevelUpOverlay } from "@/features/progression/components/level-up-overlay";
import { Tutorial } from "@/features/tutorial/components/tutorial";
import { Ambient } from "./ambient";
import { Sidebar } from "./sidebar";
import { ScrollReset } from "./scroll-reset";
import { TabBar } from "./tab-bar";
import { TopBar } from "./top-bar";

/** Frame of the signed-in game: sidebar on desktop, tab bar on phones. */
export async function AppShell({ children }: { children: ReactNode }) {
  const t = await getTranslations("app");
  return (
    <>
      <a
        href="#main"
        className="sr-only z-toast rounded-md bg-accent-strong px-4 py-2 text-on-accent focus-ring focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t("skipToContent")}
      </a>
      <Ambient />
      <Sidebar />
      {/* Phones scroll this box, not the page: the browser keeps its toolbars and the first tap on the tab bar
          always lands (a tap near the bottom of a scrolled page would only bring Safari's toolbar back). */}
      <div
        id="scroll-root"
        className="flex h-dvh flex-col overflow-y-auto overscroll-y-contain lg:h-auto lg:min-h-dvh lg:overflow-visible lg:pl-(--sidebar-width)"
      >
        <TopBar />
        <main
          id="main"
          className="mx-auto w-full max-w-(--content-max) flex-1 px-4 pt-5 pb-[calc(var(--tabbar-height)+var(--safe-bottom)+24px)] lg:px-8 lg:pt-8 lg:pb-12"
        >
          {children}
        </main>
      </div>
      <TabBar />
      <ScrollReset />
      <SearchDialog />
      <Tutorial />
      <LevelUpOverlay />
      <GameSync />
      <DailyReward />
    </>
  );
}
