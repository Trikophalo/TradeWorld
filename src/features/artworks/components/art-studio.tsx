"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { burstConfetti } from "@/components/ui/effects";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { PixelEditor } from "@/features/company/components/pixel-editor";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { ArtworkPixels } from "@/features/game/types";
import { isValidArtwork } from "@/lib/sim/artworks";
import { formatMoney } from "@/lib/format";
import { hasForbiddenSymbol } from "@/lib/sim/logo";
import { playSound } from "@/lib/sound";
import { useArtRefresh, useArtStudio } from "../hooks";

const SIZE = BALANCE.artworks.size;
const blank = (): ArtworkPixels => ({
  palette: ["#111318", "#ffffff", "#ffd15c", "#4f8cff"],
  grid: Array.from({ length: SIZE }, () => ".".repeat(SIZE)),
});

/** The studio (ADR-080): paint an artwork of your own; each one costs double the previous. */
export function ArtStudio() {
  const t = useTranslations("art");
  const studio = useArtStudio();
  const [open, setOpen] = useState(false);
  const cash = useGame((state) => state.portfolio?.cashCents ?? 0);
  const cost = studio.data?.nextCostCents ?? BALANCE.artworks.createBaseCostCents;
  return (
    <Card
      padding="lg"
      className="flex flex-col gap-4 sm:flex-row sm:items-center"
      data-tour="art-studio"
      data-testid="art-studio"
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <PixelIcon {...UI_ICONS.art} scale={3} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="label-pixel text-fg-1">{t("studioTitle")}</p>
          <p className="text-sm text-pretty text-fg-2">{t("studioText")}</p>
          <p className="mt-1 text-xs text-fg-3">
            {t("studioPainted", { count: studio.data?.painted ?? 0 })} ·{" "}
            <span className="font-semibold text-fg-1">
              {t("studioCost", { amount: formatMoney(cost, { whole: true }) })}
            </span>
          </p>
        </div>
      </div>
      <Button className="w-full sm:w-auto" onClick={() => setOpen(true)} disabled={cash < cost}>
        {t("studioButton")}
      </Button>
      <ArtEditor open={open} costCents={cost} onClose={() => setOpen(false)} />
    </Card>
  );
}

function ArtEditor({ open, costCents, onClose }: { open: boolean; costCents: number; onClose: () => void }) {
  const t = useTranslations("art");
  const tl = useTranslations("logo");
  const errorText = useGameErrorText();
  const refresh = useArtRefresh();
  const [art, setArt] = useState<ArtworkPixels>(blank);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setArt(blank());
      setTitle("");
      setBusy(false);
    }
  }
  const forbidden = hasForbiddenSymbol(art);
  const name = title.trim();
  const valid = isValidArtwork(art) && !forbidden && name.length >= 3;

  const create = async () => {
    setBusy(true);
    try {
      const r = await engine.createArtwork(crypto.randomUUID(), name, art);
      void playSound("levelUp", 0.7);
      burstConfetti(document.body, 30);
      toast.success(t("created"), t("createdText", { code: r.artwork.code }));
      await refresh();
      onClose();
    } catch (error) {
      setBusy(false);
      toast.error(t("editorTitle"), errorText(error));
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("editorTitle")}
      description={t("editorIntro")}
      footer={
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-56 flex-1">
            <Field
              label={t("artTitle")}
              value={title}
              maxLength={BALANCE.artworks.titleMaxLength}
              placeholder={t("artTitlePlaceholder")}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <HoldButton
            tone="accent"
            onConfirm={() => void create()}
            disabled={!valid || busy}
            className="w-full sm:w-80"
          >
            {t("createConfirm", { amount: formatMoney(costCents, { whole: true }) })}
          </HoldButton>
        </div>
      }
    >
      <PixelEditor
        width={SIZE}
        height={SIZE}
        maxColors={BALANCE.artworks.maxColors}
        value={art}
        onChange={(next) => setArt({ palette: [...next.palette], grid: [...next.grid] })}
        mirror
        startMirrored={false}
        testId="art-board"
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
