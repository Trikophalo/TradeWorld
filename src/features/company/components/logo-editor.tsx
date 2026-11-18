"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, type ButtonState } from "@/components/ui/button";
import { HoldButton } from "@/components/ui/hold-button";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { MyCompany } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { hasForbiddenSymbol, isValidLogo, type CompanyLogoData } from "@/lib/sim/logo";
import { playSound } from "@/lib/sound";
import { useCompanyRefresh } from "../hooks";
import { PixelEditor } from "./pixel-editor";

const SIZE = BALANCE.startups.logo.size;
const empty = (color: string): CompanyLogoData => ({
  palette: [color.toLowerCase(), "#ffffff"],
  grid: Array.from({ length: SIZE }, () => ".".repeat(SIZE)),
});

const sameLogo = (a: CompanyLogoData | null, b: CompanyLogoData | null) =>
  a !== null && b !== null && a.palette.join() === b.palette.join() && a.grid.join() === b.grid.join();

/**
 * Logo editor (ADR-065, ADR-076, ADR-079): a big window in the middle, the logo is fixed once. With `redraw`
 * (ADR-200) it starts from `initial` (or the current logo) and hands the drawing back to `onDone` instead of
 * saving; the caller asks before it pays.
 */
export function LogoEditor({
  company,
  open,
  onClose,
  redraw,
}: {
  company: MyCompany;
  open: boolean;
  onClose: () => void;
  redraw?: { costCents: number; initial: CompanyLogoData | null; onDone: (logo: CompanyLogoData) => void };
}) {
  const t = useTranslations("logo");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const [logo, setLogo] = useState<CompanyLogoData>(() => company.logo ?? empty(company.color));
  const [state, setState] = useState<ButtonState>("idle");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const start = redraw?.initial ?? company.logo;
      setLogo(start ? { palette: [...start.palette], grid: [...start.grid] } : empty(company.color));
      setState("idle");
    }
  }

  const forbidden = hasForbiddenSymbol(logo);
  const valid = isValidLogo(logo) && !forbidden;
  const unchanged = redraw !== undefined && sameLogo(logo, company.logo);

  const save = async () => {
    setState("loading");
    try {
      await engine.setCompanyLogo(crypto.randomUUID(), logo);
      setState("success");
      void playSound("success");
      toast.success(t("saved"), undefined, { silent: true });
      await refresh();
      window.setTimeout(onClose, 400);
    } catch (error) {
      setState("idle");
      toast.error(t("title"), errorText(error));
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={redraw ? t("redraw.title") : t("title")}
      description={redraw ? t("redraw.intro") : t("intro")}
      footer={
        redraw ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-xs text-pretty text-fg-2" data-testid="logo-redraw-hint">
              {unchanged ? t("redraw.unchanged") : t("redraw.editorHint", { price: formatMoney(redraw.costCents) })}
            </p>
            <Button
              disabled={!valid || unchanged}
              onClick={() => redraw.onDone(logo)}
              className="w-full sm:w-auto"
              data-testid="logo-redraw-next"
            >
              {t("redraw.next")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-xs text-pretty text-warn">{t("once")}</p>
            <HoldButton
              tone="accent"
              onConfirm={() => void save()}
              disabled={!valid || state === "loading" || state === "success"}
              className="w-full sm:w-80"
            >
              {t("saveOnce")}
            </HoldButton>
          </div>
        )
      }
    >
      <PixelEditor
        width={SIZE}
        height={SIZE}
        maxColors={BALANCE.startups.logo.maxColors}
        value={logo}
        onChange={setLogo}
        mirror
        testId="logo-board"
        aside={
          forbidden ? (
            <p
              className="rounded-md bg-loss-soft px-3 py-2 text-sm text-loss"
              role="alert"
              data-testid="logo-forbidden"
            >
              {t("forbidden")}
            </p>
          ) : (
            !valid && <p className="text-xs text-fg-3">{t("tooEmpty")}</p>
          )
        }
      />
    </Modal>
  );
}
