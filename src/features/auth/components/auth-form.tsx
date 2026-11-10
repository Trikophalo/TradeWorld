"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button, type ButtonState } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/supabase/env";
import { fieldErrors, loginSchema, registerSchema } from "../schemas";

type ErrorKey =
  "errorEmail" | "errorPassword" | "errorDisplayName" | "errorInvite" | "errorAge" | "errorInvalid" | "errorGeneric";

/** Only same-origin paths are accepted as a redirect target. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const params = useSearchParams();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<ButtonState>("idle");
  const register = mode === "register";
  const message = (key?: string) => (key ? t(key as ErrorKey) : undefined);

  if (isDemoMode) {
    return (
      <Card padding="lg" className="text-center">
        <h2 className="font-pixel text-sm text-fg-1 uppercase">{t("demoTitle")}</h2>
        <p className="mt-2 text-fg-2">{t("demoText")}</p>
        <Link href="/" className={buttonVariants({ block: true, className: "mt-5" })}>
          {t("demoAction")}
        </Link>
      </Card>
    );
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const raw = {
      displayName: String(form.get("displayName") ?? ""),
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
      inviteCode: String(form.get("inviteCode") ?? ""),
      ageConfirmed: form.get("ageConfirmed") === "on",
    };
    const parsed = register ? registerSchema.safeParse(raw) : loginSchema.safeParse(raw);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setState("loading");

    const { error } = register
      ? await supabase.auth.signUp({
          email: raw.email,
          password: raw.password,
          // Read by the handle_new_user() trigger. The invite code is checked there, not here.
          options: { data: { display_name: raw.displayName, invite_code: raw.inviteCode.trim(), age_confirmed: true } },
        })
      : await supabase.auth.signInWithPassword({ email: raw.email, password: raw.password });

    if (error) {
      setState("idle");
      setErrors({ form: register ? "errorGeneric" : "errorInvalid" });
      return;
    }
    setState("success");
    if (register) toast.success(t("registered"), t("registeredText"));
    router.replace(register ? "/login" : safeNext(params.get("next")));
    router.refresh();
  };

  return (
    <Card padding="lg">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {register && (
          <Field
            name="displayName"
            label={t("displayName")}
            hint={t("displayNameHint")}
            autoComplete="nickname"
            error={message(errors.displayName)}
          />
        )}
        <Field
          name="email"
          type="email"
          label={t("email")}
          autoComplete="email"
          inputMode="email"
          error={message(errors.email)}
        />
        <Field
          name="password"
          type="password"
          label={t("password")}
          hint={register ? t("passwordHint") : undefined}
          autoComplete={register ? "new-password" : "current-password"}
          error={message(errors.password)}
        />
        {register && (
          <>
            <Field
              name="inviteCode"
              label={t("inviteCode")}
              autoComplete="off"
              autoCapitalize="characters"
              error={message(errors.inviteCode)}
            />
            <div>
              <label className="flex cursor-pointer items-start gap-3 text-fg-1">
                <input
                  type="checkbox"
                  name="ageConfirmed"
                  className="mt-0.5 size-5 shrink-0 accent-(--accent-strong) focus-ring"
                />
                <span>{t("ageConfirm")}</span>
              </label>
              {errors.ageConfirmed && (
                <p role="alert" className="mt-1.5 text-sm text-loss">
                  {message(errors.ageConfirmed)}
                </p>
              )}
            </div>
          </>
        )}
        {errors.form && (
          <p role="alert" className="rounded-md bg-loss-soft px-3.5 py-2.5 text-sm text-loss">
            {message(errors.form)}
          </p>
        )}
        <Button type="submit" block size="lg" state={state}>
          {t(register ? "register" : "login")}
        </Button>
      </form>
    </Card>
  );
}
