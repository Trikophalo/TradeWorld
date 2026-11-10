import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Wordmark } from "@/components/layout/wordmark";
import { buttonVariants } from "@/components/ui/button-variants";
import { Showcase } from "./showcase";

export const metadata: Metadata = { title: "UI", robots: { index: false } };

export default async function ShowcasePage() {
  const t = await getTranslations("showcase");
  return (
    <main className="mx-auto w-full max-w-(--content-max) px-4 pt-safe pb-24 lg:px-8">
      <header className="flex h-16 items-center justify-between">
        <Wordmark />
        <Link href="/" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          App
        </Link>
      </header>
      <h1 className="mt-6 font-pixel text-2xl text-fg-1 uppercase">{t("title")}</h1>
      <p className="mt-2 max-w-xl text-fg-2">{t("intro")}</p>
      <Showcase />
    </main>
  );
}
