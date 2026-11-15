import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Page, PageHeader } from "@/components/layout/page";
import { ACCESSORY_ART } from "@/components/pixel/accessories";
import { WardrobeView } from "@/features/wardrobe/components/wardrobe";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("wardrobe");
  return { title: t("title") };
}

/** Wardrobe and accessory shop for the pixel figure (ADR-155). */
export default async function WardrobePage() {
  const t = await getTranslations("wardrobe");
  const tp = await getTranslations("profile");
  return (
    <Page>
      <Link
        href="/profile"
        transitionTypes={["nav-back"]}
        className="-ml-2 inline-flex h-9 items-center gap-2 rounded-sm px-2 label-pixel text-fg-2 focus-ring transition-colors duration-fast hover:text-fg-1"
      >
        <svg viewBox="0 0 4 7" width="8" height="14" shapeRendering="crispEdges" aria-hidden>
          <path fill="currentColor" d="M3 0h1v1H3zM2 1h1v1H2zM1 2h1v1H1zM0 3h1v1H0zM1 4h1v1H1zM2 5h1v1H2zM3 6h1v1H3z" />
        </svg>
        {tp("title")}
      </Link>
      <PageHeader title={t("title")} intro={t("intro")} art={ACCESSORY_ART.cowboy_hat} />
      <WardrobeView />
    </Page>
  );
}
