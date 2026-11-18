"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { Countdown } from "@/components/ui/countdown";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import { GameError, type LogoRedrawInfo, type MyCompany } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { logoArt, type CompanyLogoData } from "@/lib/sim/logo";
import { playSound } from "@/lib/sound";
import { useClock } from "@/lib/use-now";
import { useCompanyRefresh } from "../hooks";
import { logoRedrawBlock, logoRedrawKey } from "../logo-redraw";
import { LogoEditor } from "./logo-editor";

const SUCCESS_MS = 500;

/**
 * "Logo neu zeichnen · 50.000 €" (ADR-200): the founder redraws the fixed logo for a price from the company cash,
 * once per cooldown. Opens the logo editor with the current logo, then asks in a sheet before it pays.
 */
export function LogoRedraw({ company, preview }: { company: MyCompany; preview?: LogoRedrawInfo }) {
  const t = useTranslations("logo.redraw");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const now = useClock();
  const query = useQuery({
    queryKey: logoRedrawKey(company.id),
    queryFn: () => engine.logoRedraw(company.id),
    enabled: !preview,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CompanyLogoData | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<ButtonState>("idle");

  const data = preview ?? query.data;
  if (!data) {
    // Not the founder or an older server: nothing to offer.
    if (query.isError) return null;
    return <Skeleton className="h-8 w-52" data-testid="logo-redraw-loading" />;
  }

  const block = logoRedrawBlock(data, company.cashCents - company.unpaidCents, now);
  const price = formatMoney(data.costCents, { whole: true });

  const onConfirm = async () => {
    if (!draft) return;
    setState("loading");
    try {
      await engine.redrawCompanyLogo(crypto.randomUUID(), company.id, draft);
      setState("success");
      haptic("success");
      void playSound("success");
      toast.success(t("doneTitle"), t("doneText"), { silent: true });
      await refresh();
      window.setTimeout(() => {
        setConfirming(false);
        setDraft(null);
        setState("idle");
      }, SUCCESS_MS);
    } catch (error) {
      setState("idle");
      const key = error instanceof GameError ? error.key : null;
      toast.error(t("failed"), key === "locked" ? t("cooldown") : errorText(error));
      if (key === "locked" || key === "insufficient_funds") void query.refetch();
    }
  };

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={block !== null}
        onClick={() => {
          void playSound("tap");
          setDraft(null);
          setEditing(true);
        }}
        data-testid="logo-redraw"
      >
        {t("button", { price })}
      </Button>
      {block === "cooldown" && data.availableAt && (
        <p className="text-xs text-fg-3" data-testid="logo-redraw-block">
          {t("again")} <Countdown target={Date.parse(data.availableAt)} className="text-fg-2" />
        </p>
      )}
      {block === "cash" && (
        <p className="text-xs text-pretty text-fg-3" data-testid="logo-redraw-block">
          {t("noCash", { price })}
        </p>
      )}

      <LogoEditor
        company={company}
        open={editing}
        onClose={() => setEditing(false)}
        redraw={{
          costCents: data.costCents,
          initial: draft,
          onDone: (logo) => {
            setDraft(logo);
            setEditing(false);
            setConfirming(true);
          },
        }}
      />

      <Sheet
        open={confirming}
        onOpenChange={(next) => state === "idle" && setConfirming(next)}
        title={t("confirmTitle")}
        description={t("confirmText", { price, hours: data.cooldownHours })}
      >
        <div className="space-y-4" data-testid="logo-redraw-sheet">
          <div className="flex items-center justify-center gap-4">
            {company.logo && (
              <figure className="flex flex-col items-center gap-1 opacity-60">
                <PixelIcon {...logoArt(company.logo)} scale={3} />
                <figcaption className="text-xs text-fg-3">{t("old")}</figcaption>
              </figure>
            )}
            {draft && (
              <figure className="flex flex-col items-center gap-1">
                <PixelIcon {...logoArt(draft)} scale={4} />
                <figcaption className="text-xs text-fg-2">{t("new")}</figcaption>
              </figure>
            )}
          </div>
          <p className="text-sm text-pretty text-fg-3">{t("confirmFeed")}</p>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button block state={state} onClick={() => void onConfirm()} data-testid="logo-redraw-confirm">
              {t("confirm", { price })}
            </Button>
            <Button
              block
              variant="ghost"
              disabled={state !== "idle"}
              onClick={() => {
                setConfirming(false);
                setEditing(true);
              }}
            >
              {t("back")}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
