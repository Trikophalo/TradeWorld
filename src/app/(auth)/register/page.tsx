import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthForm } from "@/features/auth/components/auth-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("register") };
}

export default async function RegisterPage() {
  const t = await getTranslations("auth");
  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="font-pixel text-xl text-fg-1 uppercase">{t("registerTitle")}</h1>
        <p className="mt-2 text-fg-2">{t("registerText")}</p>
      </div>
      {/* The form reads ?next=, which is only known at request time. */}
      <Suspense fallback={<Skeleton className="h-72 rounded-lg" />}>
        <AuthForm mode="register" />
      </Suspense>
      <Link
        href="/login"
        className="mt-5 self-center rounded-sm px-2 py-1 text-sm text-accent focus-ring transition-colors duration-fast hover:text-fg-1"
      >
        {t("toLogin")}
      </Link>
    </>
  );
}
