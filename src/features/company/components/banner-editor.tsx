"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type PointerEvent } from "react";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { MyCompany } from "@/features/game/types";
import { floodFill, hasForbiddenSymbol, isValidBanner, logoArt, type CompanyLogoData } from "@/lib/sim/logo";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useCompanyRefresh } from "../hooks";

const W = BALANCE.startups.banner.width;
const H = BALANCE.startups.banner.height;
const MAX_COLORS = BALANCE.startups.banner.maxColors;
/** Colours to start from (data, like the company colours). */
const SWATCHES = ["#111318", "#ffffff", "#ffd15c", "#2fd98c", "#4f8cff", "#ff6170", "#9a6b3c", "#c03fb8", "#62e0ff"];
type Tool = "pen" | "eraser" | "fill" | "line";

/** A starting banner: company colour with a lighter stripe, so nobody starts from nothing. */
function starter(color: string): CompanyLogoData {
  const grid = Array.from({ length: H }, (_, y) => (y === H - 3 || y === H - 2 ? "1" : "0").repeat(W));
  return { palette: [color.toLowerCase(), "#ffffff"], grid };
}

/** Pixel editor for the company banner (ADR-078): 48 × 12, up to six colours, can be redrawn any time. */
export function BannerEditor({ company, open, onClose }: { company: MyCompany; open: boolean; onClose: () => void }) {
  const t = useTranslations("banner");
  const tl = useTranslations("logo");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const [banner, setBanner] = useState<CompanyLogoData>(() => company.banner ?? starter(company.color));
  const [color, setColor] = useState(0);
  const [tool, setTool] = useState<Tool>("pen");
  const [state, setState] = useState<ButtonState>("idle");
  const drawing = useRef(false);
  const lineStart = useRef<{ x: number; y: number } | null>(null);
  const board = useRef<HTMLDivElement>(null);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setBanner(
        company.banner
          ? { palette: [...company.banner.palette], grid: [...company.banner.grid] }
          : starter(company.color),
      );
      setColor(0);
      setState("idle");
    }
  }

  const setPixel = (rows: string[][], x: number, y: number, value: string) => {
    if (rows[y]?.[x] !== undefined) rows[y]![x] = value;
  };

  const paint = (x: number, y: number) => {
    const value = tool === "eraser" ? "." : String(color);
    if (tool === "fill") {
      setBanner((b) => ({ ...b, grid: floodFill(b.grid, x, y, value) }));
      return;
    }
    setBanner((b) => {
      const rows = b.grid.map((r) => r.split(""));
      setPixel(rows, x, y, value);
      return { ...b, grid: rows.map((r) => r.join("")) };
    });
  };

  /** Horizontal or vertical line from the press to the release point. */
  const line = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const value = String(color);
    setBanner((b) => {
      const rows = b.grid.map((r) => r.split(""));
      if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)) {
        for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) setPixel(rows, x, from.y, value);
      } else {
        for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++) setPixel(rows, from.x, y, value);
      }
      return { ...b, grid: rows.map((r) => r.join("")) };
    });
  };

  const cellAt = (event: PointerEvent) => {
    const rect = board.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * W);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * H);
    return x >= 0 && y >= 0 && x < W && y < H ? { x, y } : null;
  };

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
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("intro")}
      footer={
        <div className="flex gap-2">
          {company.banner && (
            <Button size="lg" variant="ghost" disabled={state === "loading"} onClick={() => void save(null)}>
              {t("remove")}
            </Button>
          )}
          <Button block size="lg" state={state} disabled={!valid} onClick={() => void save(banner)}>
            {t("save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div
          ref={board}
          data-testid="banner-board"
          data-vaul-no-drag=""
          className="grid w-full touch-none overflow-hidden rounded-md border border-line-2 select-none"
          style={{
            gridTemplateColumns: `repeat(${W}, 1fr)`,
            aspectRatio: `${W} / ${H}`,
            backgroundImage:
              "linear-gradient(45deg, var(--bg-3) 25%, transparent 25%, transparent 75%, var(--bg-3) 75%), linear-gradient(45deg, var(--bg-3) 25%, transparent 25%, transparent 75%, var(--bg-3) 75%)",
            backgroundSize: "12px 12px",
            backgroundPosition: "0 0, 6px 6px",
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const cell = cellAt(event);
            if (!cell) return;
            if (tool === "line") {
              lineStart.current = cell;
              return;
            }
            drawing.current = tool !== "fill";
            paint(cell.x, cell.y);
          }}
          onPointerMove={(event) => {
            if (!drawing.current) return;
            const cell = cellAt(event);
            if (cell) paint(cell.x, cell.y);
          }}
          onPointerUp={(event) => {
            drawing.current = false;
            const start = lineStart.current;
            lineStart.current = null;
            const cell = cellAt(event);
            if (start && cell) line(start, cell);
          }}
        >
          {banner.grid.flatMap((row, y) =>
            row
              .split("")
              .map((c, x) => (
                <span
                  key={`${x}-${y}`}
                  className="border-[0.5px] border-line-1/30"
                  style={{ backgroundColor: c === "." ? undefined : banner.palette[Number(c)] }}
                />
              )),
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="label-pixel text-fg-3">{tl("preview")}</span>
          <PixelIcon {...logoArt(banner)} scale={2} />
        </div>

        <Segmented<Tool>
          value={tool}
          onValueChange={setTool}
          label={tl("tool")}
          size="sm"
          options={[
            { value: "pen", label: tl("pen") },
            { value: "line", label: t("line") },
            { value: "fill", label: tl("fill") },
            { value: "eraser", label: tl("eraser") },
          ]}
        />

        <div>
          <p className="mb-1.5 label-pixel text-fg-2">
            {tl("colors", { count: banner.palette.length, max: MAX_COLORS })}
          </p>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={tl("tool")}>
            {banner.palette.map((c, i) => (
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
          {banner.palette.length < MAX_COLORS && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SWATCHES.filter((c) => !banner.palette.includes(c)).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={tl("addColor", { color: c })}
                  onClick={() => {
                    setBanner((b) => ({ ...b, palette: [...b.palette, c] }));
                    setColor(banner.palette.length);
                  }}
                  style={{ backgroundColor: c }}
                  className="size-6 rounded-xs border border-line-2 opacity-80 focus-ring hover:opacity-100"
                />
              ))}
            </div>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setBanner(starter(company.color))}>
          {t("reset")}
        </Button>
        {forbidden && (
          <p className="rounded-md bg-loss-soft px-3 py-2 text-sm text-loss" role="alert">
            {tl("forbidden")}
          </p>
        )}
      </div>
    </Sheet>
  );
}
