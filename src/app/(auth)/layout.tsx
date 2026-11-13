import { getTranslations } from "next-intl/server";
import { TitleScene } from "@/components/layout/title-scene";
import { Wordmark } from "@/components/layout/wordmark";
import { Mascot } from "@/components/pixel/mascot";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("auth");
  return (
    <>
      <TitleScene />
      <main className="mx-auto flex min-h-dvh w-full max-w-md page-stack flex-col justify-center px-4 py-10 pt-safe pb-safe">
        {/* Finn greets at the door (ADR-108). */}
        <Mascot mood="idle" scale={5} className="mb-3 self-center" />
        <span className="group mb-8 self-center">
          <Wordmark size="lg" />
        </span>
        {children}
        <p className="mt-6 self-center rounded-md bg-bg/80 px-3 py-1.5 text-center text-sm text-pretty text-fg-3">
          {t("playMoney")}
        </p>
      </main>
    </>
  );
}
