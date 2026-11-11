import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { SearchDialog } from "@/features/market/components/search-dialog";
import { Tutorial } from "@/features/tutorial/components/tutorial";
import { Sidebar } from "./sidebar";
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
      <Sidebar />
      <div className="flex min-h-dvh flex-col lg:pl-(--sidebar-width)">
        <TopBar />
        <main
          id="main"
          className="mx-auto w-full max-w-(--content-max) flex-1 px-4 pt-5 pb-[calc(var(--tabbar-height)+var(--safe-bottom)+24px)] lg:px-8 lg:pt-8 lg:pb-12"
        >
          {children}
        </main>
      </div>
      <TabBar />
      <SearchDialog />
      <Tutorial />
    </>
  );
}
