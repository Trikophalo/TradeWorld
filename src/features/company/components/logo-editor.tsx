"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type PointerEvent } from "react";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { HoldButton } from "@/components/ui/hold-button";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { MyCompany } from "@/features/game/types";
import { floodFill, hasForbiddenSymbol, isValidLogo, logoArt, type CompanyLogoData } from "@/lib/sim/logo";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useCompanyRefresh } from "../hooks";

const SIZE = BALANCE.startups.logo.size;
const MAX_COLORS = BALANCE.startups.logo.maxColors;
/** Colours to start from (data, like the company colours). */
const SWATCHES = ["#111318", "#ffffff", "#ffd15c", "#2fd98c", "#4f8cff", "#ff6170", "#9a6b3c", "#c03fb8"] as const;
type Tool = "pen" | "eraser" | "fill";

const empty = () => Array.from({ length: SIZE }, () => ".".repeat(SIZE));

/** Pixel editor for the company logo (ADR-065): 16×16, up to six colours, mirror drawing. */
export function LogoEditor({ company, open, onClose }: { company: MyCompany; open: boolean; onClose: () => void }) {
  const t = useTranslations("logo");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const [palette, setPalette] = useState<string[]>([company.color.toLowerCase(), "#ffffff"]);
  const [grid, setGrid] = useState<string[]>(empty);
  const [color, setColor] = useState(0);
  const [tool, setTool] = useState<Tool>("pen");
  const [mirror, setMirror] = useState(true);
  const [state, setState] = useState<ButtonState>("idle");
  const drawing = useRef(false);
  const board = useRef<HTMLDivElement>(null);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPalette(company.logo ? [...company.logo.palette] : [company.color.toLowerCase(), "#ffffff"]);
      setGrid(company.logo ? [...company.logo.grid] : empty());
      setColor(0);
      setState("idle");
    }
  }

  const paint = (x: number, y: number) => {
    const value = tool === "eraser" ? "." : String(color);
    if (tool === "fill") {
      setGrid((g) => floodFill(g, x, y, value));
      return;
    }
    setGrid((g) => {
      const rows = g.map((r) => r.split(""));
      rows[y]![x] = value;
      if (mirror) rows[y]![SIZE - 1 - x] = value;
      return rows.map((r) => r.join(""));
    });
  };

  const cellAt = (event: PointerEvent) => {
    const rect = board.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * SIZE);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * SIZE);
    return x >= 0 && y >= 0 && x < SIZE && y < SIZE ? { x, y } : null;
  };

  const logo: CompanyLogoData = { palette, grid };
  const forbidden = hasForbiddenSymbol(logo);
  const valid = isValidLogo(logo) && !forbidden;

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
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("intro")}
      footer={
        <HoldButton
          tone="accent"
          onConfirm={() => void save()}
          disabled={!valid || state === "loading" || state === "success"}
          className="w-full"
        >
          {t("saveOnce")}
        </HoldButton>
      }
    >
      <div className="space-y-4">
        <div className="flex items-end gap-4">
          <div
            ref={board}
            data-testid="logo-board"
            data-vaul-no-drag=""
            className="grid aspect-square w-full max-w-72 touch-none overflow-hidden rounded-md border border-line-2 select-none"
            style={{
              gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
              backgroundImage:
                "linear-gradient(45deg, var(--bg-3) 25%, transparent 25%, transparent 75%, var(--bg-3) 75%), linear-gradient(45deg, var(--bg-3) 25%, transparent 25%, transparent 75%, var(--bg-3) 75%)",
              backgroundSize: "12px 12px",
              backgroundPosition: "0 0, 6px 6px",
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              drawing.current = tool !== "fill";
              const cell = cellAt(event);
              if (cell) paint(cell.x, cell.y);
            }}
            onPointerMove={(event) => {
              if (!drawing.current) return;
              const cell = cellAt(event);
              if (cell) paint(cell.x, cell.y);
            }}
            onPointerUp={() => {
              drawing.current = false;
            }}
          >
            {grid.flatMap((row, y) =>
              row
                .split("")
                .map((c, x) => (
                  <span
                    key={`${x}-${y}`}
                    className="border-[0.5px] border-line-1/40"
                    style={{ backgroundColor: c === "." ? undefined : palette[Number(c)] }}
                  />
                )),
            )}
          </div>
          <div className="flex shrink-0 flex-col items-center gap-2">
            <span className="label-pixel text-fg-3">{t("preview")}</span>
            <PixelIcon {...logoArt(logo)} scale={3} />
            <PixelIcon {...logoArt(logo)} scale={2} />
          </div>
        </div>

        <Segmented<Tool>
          value={tool}
          onValueChange={setTool}
          label={t("tool")}
          size="sm"
          options={[
            { value: "pen", label: t("pen") },
            { value: "eraser", label: t("eraser") },
            { value: "fill", label: t("fill") },
          ]}
        />

        <div>
          <p className="mb-1.5 label-pixel text-fg-2">{t("colors", { count: palette.length, max: MAX_COLORS })}</p>
          <div
            className="flex flex-wrap items-center gap-2"
            role="radiogroup"
            aria-label={t("colors", { count: palette.length, max: MAX_COLORS })}
          >
            {palette.map((c, i) => (
              <button
                key={`${c}-${i}`}
                type="button"
                role="radio"
                aria-checked={color === i}
                aria-label={c}
                onClick={() => {
                  setColor(i);
                  if (tool === "eraser") setTool("pen");
                }}
                style={{ backgroundColor: c }}
                className={cn(
                  "size-9 rounded-sm border border-line-2 focus-ring",
                  color === i && "ring-2 ring-fg-1 ring-offset-2 ring-offset-surface-1",
                )}
              />
            ))}
          </div>
          {palette.length < MAX_COLORS && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SWATCHES.filter((c) => !palette.includes(c)).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={t("addColor", { color: c })}
                  onClick={() => {
                    setPalette((p) => [...p, c]);
                    setColor(palette.length);
                  }}
                  style={{ backgroundColor: c }}
                  className="size-6 rounded-xs border border-line-2 opacity-80 focus-ring hover:opacity-100"
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={mirror ? "primary" : "secondary"} onClick={() => setMirror((m) => !m)}>
            {t("mirror")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setGrid(empty())}>
            {t("clear")}
          </Button>
        </div>
        {forbidden ? (
          <p className="rounded-md bg-loss-soft px-3 py-2 text-sm text-loss" role="alert" data-testid="logo-forbidden">
            {t("forbidden")}
          </p>
        ) : (
          !valid && <p className="text-xs text-fg-3">{t("tooEmpty")}</p>
        )}
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-pretty text-warn">{t("once")}</p>
      </div>
    </Sheet>
  );
}
