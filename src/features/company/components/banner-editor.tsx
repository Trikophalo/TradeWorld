"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, type ButtonState } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { MyCompany } from "@/features/game/types";
import { hasForbiddenSymbol, isValidBanner, type CompanyLogoData } from "@/lib/sim/logo";
import { playSound } from "@/lib/sound";
import { useCompanyRefresh } from "../hooks";
import { PixelEditor } from "./pixel-editor";

const W = BALANCE.startups.banner.width;
const H = BALANCE.startups.banner.height;

/** A starting banner: company colour with a lighter stripe, so nobody starts from nothing. */
function starter(color: string): CompanyLogoData {
  const grid = Array.from({ length: H }, (_, y) => (y === H - 3 || y === H - 2 ? "1" : "0").repeat(W));
  return { palette: [color.toLowerCase(), "#ffffff"], grid };
}

/** Banner editor (ADR-078, ADR-079): a big window in the middle; the banner can be redrawn any time. */
export function BannerEditor({ company, open, onClose }: { company: MyCompany; open: boolean; onClose: () => void }) {
  const t = useTranslations("banner");
  const tl = useTranslations("logo");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const [banner, setBanner] = useState<CompanyLogoData>(() => company.banner ?? starter(company.color));
  const [state, setState] = useState<ButtonState>("idle");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setBanner(
        company.banner
          ? { palette: [...company.banner.palette], grid: [...company.banner.grid] }
          : starter(company.color),
      );
      setState("idle");
    }
  }

  const forbidden = hasForbiddenSymbol(banner);
  const valid = isValidBanner(banner) && !forbidden;

  const save = async (next: CompanyLogoData | null) => {
    setState("loading");
    try {
      await engine.setCompanyBanner(crypto.randomUUID(), next);
      setState("success");
      void playSound("success");
      toast.success(next ? t("saved") : t("removed"), undefined, { silent: true });
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
      title={t("title")}
      description={t("intro")}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setBanner(starter(company.color))}>
            {t("reset")}
          </Button>
          {company.banner && (
            <Button variant="ghost" disabled={state === "loading"} onClick={() => void save(null)}>
              {t("remove")}
            </Button>
          )}
          <Button size="lg" state={state} disabled={!valid} onClick={() => void save(banner)}>
            {t("save")}
          </Button>
        </div>
      }
    >
      <PixelEditor
        width={W}
        height={H}
        maxColors={BALANCE.startups.banner.maxColors}
        value={banner}
        onChange={setBanner}
        testId="banner-board"
        aside={
          forbidden && (
            <p className="rounded-md bg-loss-soft px-3 py-2 text-sm text-loss" role="alert">
              {tl("forbidden")}
            </p>
          )
        }
      />
    </Modal>
  );
}
