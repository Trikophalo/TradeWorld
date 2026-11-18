"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { companyInitials, HQ_ROOF_COLORS, HQ_SIGN_COLORS, HQ_WALL_COLORS, hqArt } from "@/components/pixel/hq";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { HQ_STYLE_OPTIONS, type CountryConfig } from "@/config/countries";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { HqStyle } from "@/features/game/world-types";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useSetWorld } from "./hooks";

/** The headquarters as the editor draws it. */
export function HqPreview({
  tier,
  style,
  name,
  country,
  scale = 4,
}: {
  tier: number;
  style: HqStyle;
  name: string;
  country: CountryConfig | undefined;
  scale?: number;
}) {
  return (
    <PixelIcon
      {...hqArt({
        tier,
        ...style,
        flag: style.flag && country ? country.flag : null,
        flagVertical: country?.flagVertical,
        initials: companyInitials(name),
      })}
      scale={scale}
      title={name}
    />
  );
}

/**
 * HQ editor (ADR-208): wall, roof and sign colors, roof kind, decoration and the flag of the country, with a live
 * preview. Saved on the server (world_save_hq_style), free of charge.
 */
export function HqEditor({
  open,
  onClose,
  tier,
  style,
  name,
  country,
  preview,
}: {
  open: boolean;
  onClose: () => void;
  tier: number;
  style: HqStyle;
  name: string;
  country: CountryConfig | undefined;
  preview?: boolean;
}) {
  const t = useTranslations("world.editor");
  const errorText = useGameErrorText();
  const setWorld = useSetWorld();
  const [draft, setDraft] = useState<HqStyle>(style);
  const [state, setState] = useState<ButtonState>("idle");
  const patch = (next: Partial<HqStyle>) => {
    haptic("tap");
    setDraft((d) => ({ ...d, ...next }));
  };

  const save = async () => {
    setState("loading");
    try {
      setWorld(await engine.worldSaveHqStyle(crypto.randomUUID(), draft));
      haptic("success");
      void playSound("success");
      toast.success(t("saved"), name, { silent: true });
      setState("success");
      onClose();
      setState("idle");
    } catch (error) {
      toast.error(t("title"), errorText(error));
      setState("idle");
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(style);
        else onClose();
      }}
      title={t("title")}
      description={t("text")}
      footer={
        <Button block state={state} disabled={preview} onClick={() => void save()} data-testid="hq-editor-save">
          {t("save")}
        </Button>
      }
    >
      <div className="space-y-4" data-testid="hq-editor">
        <div className="grid place-items-center rounded-lg bg-surface-2 py-4 ring-1 ring-line-1">
          <HqPreview tier={tier} style={draft} name={name} country={country} scale={5} />
        </div>
        <Swatches
          label={t("wall")}
          colors={HQ_WALL_COLORS}
          value={draft.wall}
          onPick={(wall) => patch({ wall })}
          t={t}
        />
        <Swatches
          label={t("roof")}
          colors={HQ_ROOF_COLORS}
          value={draft.roof}
          onPick={(roof) => patch({ roof })}
          t={t}
        />
        <Swatches
          label={t("sign")}
          colors={HQ_SIGN_COLORS}
          value={draft.sign}
          onPick={(sign) => patch({ sign })}
          t={t}
        />
        <Choice
          label={t("roofKind")}
          options={HQ_STYLE_OPTIONS.roofs.map((k) => ({ value: k, label: t(`roofs.${k}`) }))}
          value={draft.roofKind}
          onPick={(roofKind) => patch({ roofKind })}
          testId="hq-roof"
        />
        <Choice
          label={t("deco")}
          options={HQ_STYLE_OPTIONS.decorations.map((k) => ({ value: k, label: t(`decos.${k}`) }))}
          value={draft.deco}
          onPick={(deco) => patch({ deco })}
          testId="hq-deco"
        />
        <label className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2.5 text-sm text-fg-1">
          {t("flag")}
          <Switch checked={draft.flag} onCheckedChange={(flag) => patch({ flag })} label={t("flag")} />
        </label>
      </div>
    </Sheet>
  );
}

function Swatches({
  label,
  colors,
  value,
  onPick,
  t,
}: {
  label: string;
  colors: readonly string[];
  value: number;
  onPick: (i: number) => void;
  t: ReturnType<typeof useTranslations<"world.editor">>;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="label-pixel text-fg-2">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {colors.map((c, i) => (
          <button
            key={c}
            type="button"
            aria-label={t("color", { n: i + 1 })}
            aria-pressed={value === i}
            onClick={() => onPick(i)}
            className={cn(
              "size-9 rounded-md ring-2 ring-offset-2 ring-offset-surface-1 focus-ring transition duration-fast active:scale-95",
              value === i ? "ring-accent" : "ring-line-1 hover:ring-line-2",
            )}
          >
            {/* the color itself is data (a building palette), like a pixel palette */}
            <PixelIcon grid={["#"]} palette={{ "#": c }} scale={36} className="size-full rounded-md" />
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onPick,
  testId,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
  testId: string;
}) {
  return (
    <fieldset className="space-y-1.5" data-testid={testId}>
      <legend className="label-pixel text-fg-2">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            data-value={o.value}
            onClick={() => onPick(o.value)}
            className={cn(
              "rounded-pill px-3 py-1.5 text-xs font-medium ring-1 focus-ring transition duration-fast active:scale-95",
              value === o.value
                ? "bg-accent-soft text-accent ring-accent"
                : "bg-surface-2 text-fg-2 ring-line-1 hover:text-fg-1",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
