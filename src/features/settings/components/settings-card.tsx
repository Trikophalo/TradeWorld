"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { playSound } from "@/lib/sound";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/supabase/env";
import { ACCENTS, useSettings, type Accent } from "@/stores/settings";
import { cn } from "@/lib/utils";

/** Swatches show each accent as it looks in the dark theme. */
const ACCENT_SWATCH: Record<Accent, string> = {
  violet: "#8f7bff",
  blue: "#5aa7ff",
  pink: "#ff7ac3",
  orange: "#ff9a52",
  cyan: "#45d6e6",
};
const ACCENT_LABEL = {
  violet: "accentViolet",
  blue: "accentBlue",
  pink: "accentPink",
  orange: "accentOrange",
  cyan: "accentCyan",
} as const;

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
      <div>
        <p className="font-medium text-fg-1">{label}</p>
        {hint && <p className="text-sm text-fg-3">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function SettingsCard() {
  const t = useTranslations("profile");
  const router = useRouter();
  const settings = useSettings();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => setSignedIn(Boolean(data.user)));
  }, []);

  const signOut = async () => {
    await getSupabaseBrowserClient()?.auth.signOut();
    toast.info(t("signedOut"));
    router.replace("/login");
  };

  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle>{t("settings")}</CardTitle>
      </CardHeader>
      <div className="divide-y divide-line-1">
        <Row label={t("theme")}>
          <Segmented
            value={settings.theme}
            onValueChange={(value) => settings.set("theme", value)}
            label={t("theme")}
            size="sm"
            options={[
              { value: "dark", label: t("themeDark") },
              { value: "light", label: t("themeLight") },
            ]}
          />
        </Row>
        <Row label={t("accent")}>
          <div role="radiogroup" aria-label={t("accent")} className="flex gap-2">
            {ACCENTS.map((accent) => (
              <button
                key={accent}
                type="button"
                role="radio"
                aria-checked={settings.accent === accent}
                aria-label={t(ACCENT_LABEL[accent])}
                onClick={() => settings.set("accent", accent)}
                style={{ backgroundColor: ACCENT_SWATCH[accent] }}
                className={cn(
                  "size-8 rounded-xs focus-ring transition duration-fast ease-out hover:scale-110 active:scale-95",
                  settings.accent === accent && "outline-2 outline-offset-2 outline-fg-1",
                )}
              />
            ))}
          </div>
        </Row>
        <Row label={t("motion")}>
          <Segmented
            value={settings.motion}
            onValueChange={(value) => settings.set("motion", value)}
            label={t("motion")}
            size="sm"
            options={[
              { value: "system", label: t("motionSystem") },
              { value: "full", label: t("motionFull") },
              { value: "reduced", label: t("motionReduced") },
            ]}
          />
        </Row>
        <Row label={t("sound")} hint={t("soundHint")}>
          <Switch
            checked={settings.sound}
            label={t("sound")}
            onCheckedChange={(checked) => {
              settings.set("sound", checked);
              if (checked) void playSound("tap");
            }}
          />
        </Row>
        <Row label={t("haptics")} hint={t("hapticsHint")}>
          <Switch
            checked={settings.haptics}
            label={t("haptics")}
            onCheckedChange={(checked) => settings.set("haptics", checked)}
          />
        </Row>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 border-t border-line-1 pt-4">
        {signedIn ? (
          <Button variant="danger" onClick={signOut}>
            {t("signOut")}
          </Button>
        ) : (
          !isDemoMode && (
            <Link href="/login" className={buttonVariants({ variant: "secondary" })}>
              {t("signIn")}
            </Link>
          )
        )}
        <Link href="/dev/ui" className={buttonVariants({ variant: "ghost" })}>
          {t("showcase")}
        </Link>
      </div>
    </Card>
  );
}
