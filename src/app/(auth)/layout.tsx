import { getTranslations } from "next-intl/server";
import { Wordmark } from "@/components/layout/wordmark";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("auth");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10 pt-safe pb-safe">
      <Wordmark size="lg" className="mb-8 self-center" />
      {children}
      <p className="mt-6 text-center text-sm text-pretty text-fg-3">{t("playMoney")}</p>
    </main>
  );
}
