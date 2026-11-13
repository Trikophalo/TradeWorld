"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type PointerEvent } from "react";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { BALANCE, type FloorMaterial } from "@/config/balance";
import { FLOOR_TILES, TILE } from "@/config/furniture";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { Property, PropertyInventory } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { logoArt } from "@/lib/sim/logo";
import { invalidPlacements, type Placement } from "@/lib/sim/property";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useFitScale, usePropertyRefresh } from "../hooks";
import { furnitureItem, furnitureSprite, roomBackdrop, WALL } from "../room";

type Layout = Map<string, { x: number; y: number; rot: 0 | 90 }>;
interface Carry {
  id: string;
  itemKey: string;
  rot: 0 | 90;
}

/**
 * The big furnishing editor (ADR-082): pick a piece from the inventory, place it on the floor, select, rotate,
 * move or put it back; choose wall colour and floor. Nothing is saved until "Speichern".
 */
export function RoomEditor({
  open,
  property,
  inventory,
  onClose,
}: {
  open: boolean;
  property: Property;
  inventory: PropertyInventory;
  onClose: () => void;
}) {
  const t = useTranslations("estate");
  const errorText = useGameErrorText();
  const refresh = usePropertyRefresh();
  const keyOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of property.placed) m.set(p.id, p.itemKey);
    for (const f of inventory.furniture) m.set(f.id, f.itemKey);
    return m;
  }, [property.placed, inventory.furniture]);

  const initial = (): Layout => new Map(property.placed.map((p) => [p.id, { x: p.x, y: p.y, rot: p.rot }]));
  const [layout, setLayout] = useState<Layout>(initial);
  const [wall, setWall] = useState(property.wallColor);
  const [floor, setFloor] = useState<FloorMaterial>(property.floor);
  const [carry, setCarry] = useState<Carry | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [state, setState] = useState<ButtonState>("idle");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setLayout(initial());
      setWall(property.wallColor);
      setFloor(property.floor);
      setCarry(null);
      setSelected(null);
      setState("idle");
    }
  }

  const { ref, scale } = useFitScale(property.width * TILE, 4);
  const backdrop = useMemo(
    () => roomBackdrop(property.width, property.height, floor, wall),
    [property.width, property.height, floor, wall],
  );
  const footprint = (id: string) => {
    const item = furnitureItem(keyOf.get(id) ?? "");
    return item ? { w: item.w, h: item.h, layer: item.layer, surface: item.surface } : undefined;
  };
  const placements = (l: Layout): Placement[] => [...l].map(([id, p]) => ({ id, ...p }));

  // Unplaced pieces, grouped by kind.
  const unplaced = [...keyOf].filter(([id]) => !layout.has(id) && carry?.id !== id);
  const groups = new Map<string, string[]>();
  for (const [id, key] of unplaced) groups.set(key, [...(groups.get(key) ?? []), id]);

  const cellAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / (TILE * scale));
    const y = Math.floor((event.clientY - rect.top - WALL * scale) / (TILE * scale));
    return x >= 0 && y >= 0 && x < property.width && y < property.height ? { x, y } : null;
  };

  const ghost = carry && hover ? { id: carry.id, x: hover.x, y: hover.y, rot: carry.rot } : null;
  const ghostValid =
    ghost !== null &&
    invalidPlacements(
      [...placements(layout).filter((p) => p.id !== ghost.id), ghost],
      footprint,
      property.width,
      property.height,
    ).length === 0;

  /** Places the carried piece on a cell (the cell under the pointer at the click, not the last hover). */
  const place = (cell: { x: number; y: number } | null) => {
    if (!carry || !cell) return;
    const piece = { id: carry.id, x: cell.x, y: cell.y, rot: carry.rot };
    const ok =
      invalidPlacements(
        [...placements(layout).filter((p) => p.id !== piece.id), piece],
        footprint,
        property.width,
        property.height,
      ).length === 0;
    if (!ok) {
      haptic("error");
      return;
    }
    setLayout((l) => new Map(l).set(piece.id, { x: piece.x, y: piece.y, rot: piece.rot }));
    setSelected(piece.id);
    setCarry(null);
    haptic("tap");
    void playSound("tap");
  };

  const pickUp = (id: string) => {
    const p = layout.get(id);
    if (!p) return;
    setLayout((l) => {
      const next = new Map(l);
      next.delete(id);
      return next;
    });
    setCarry({ id, itemKey: keyOf.get(id)!, rot: p.rot });
    setSelected(null);
  };

  const rotate = () => {
    if (carry) {
      setCarry({ ...carry, rot: carry.rot === 0 ? 90 : 0 });
      return;
    }
    if (!selected) return;
    const p = layout.get(selected)!;
    const next = new Map(layout).set(selected, { ...p, rot: p.rot === 0 ? 90 : 0 });
    if (invalidPlacements(placements(next), footprint, property.width, property.height).length > 0) {
      haptic("error");
      toast.error(t("rotate"), t("noRoom"));
      return;
    }
    setLayout(next);
  };

  const store = () => {
    if (carry) setCarry(null);
    else if (selected) {
      setLayout((l) => {
        const next = new Map(l);
        next.delete(selected);
        return next;
      });
      setSelected(null);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "r" || event.key === "R") rotate();
      if (event.key === "Escape" && carry) {
        event.preventDefault();
        setCarry(null);
      }
      if (event.key === "Delete" || event.key === "Backspace") store();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const save = async () => {
    setState("loading");
    try {
      await engine.saveLayout(crypto.randomUUID(), wall, floor, placements(layout));
      setState("success");
      haptic("success");
      void playSound("success");
      toast.success(t("saved"), undefined, { silent: true });
      await refresh();
      window.setTimeout(onClose, 400);
    } catch (error) {
      setState("idle");
      toast.error(t("editorTitle"), errorText(error));
    }
  };

  const buyFloor = async (material: FloorMaterial) => {
    try {
      await engine.buyFloor(crypto.randomUUID(), material);
      void playSound("coin");
      toast.success(t("floorBought"), t(`floors.${material}`), { silent: true });
      await refresh();
      setFloor(material);
    } catch (error) {
      toast.error(t("floor"), errorText(error));
    }
  };

  const ordered = placements(layout).sort(
    (a, b) => (footprint(a.id)?.layer === "floor" ? 0 : 1) - (footprint(b.id)?.layer === "floor" ? 0 : 1),
  );

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("editorTitle")}
      description={t("editorIntro")}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-fg-3">{t("editorKeys")}</p>
          <Button size="lg" state={state} onClick={() => void save()}>
            {t("save")}
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-3">
          <div ref={ref} className="w-full overflow-x-auto rounded-lg bg-surface-2 p-2">
            <div
              data-testid="room-editor"
              className={cn("relative mx-auto w-fit touch-none select-none", carry ? "cursor-copy" : "cursor-default")}
              onPointerMove={(event) => setHover(cellAt(event))}
              onPointerLeave={() => setHover(null)}
              onPointerDown={(event) => {
                if (carry) place(cellAt(event));
                else setSelected(null);
              }}
            >
              <PixelIcon {...logoArt(backdrop)} scale={scale} />
              {ordered.map((p) => {
                const sprite = furnitureSprite(keyOf.get(p.id)!, p.rot);
                if (!sprite) return null;
                const isSelected = selected === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    data-piece={keyOf.get(p.id)}
                    aria-label={furnitureItem(keyOf.get(p.id)!)?.name}
                    onPointerDown={(event) => {
                      if (carry) return;
                      event.stopPropagation();
                      if (isSelected) pickUp(p.id);
                      else setSelected(p.id);
                    }}
                    className={cn(
                      "absolute rounded-xs focus-ring transition-[outline-color] duration-fast",
                      isSelected
                        ? "z-10 outline-2 outline-offset-1 outline-accent"
                        : "hover:outline hover:outline-fg-1/40",
                    )}
                    style={{ left: p.x * TILE * scale, top: (WALL + p.y * TILE) * scale }}
                  >
                    <PixelIcon {...logoArt(sprite)} scale={scale} />
                  </button>
                );
              })}
              {ghost && (
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute z-20 rounded-xs opacity-80 outline-2",
                    ghostValid ? "outline-gain" : "outline-loss",
                  )}
                  style={{ left: ghost.x * TILE * scale, top: (WALL + ghost.y * TILE) * scale }}
                >
                  <PixelIcon {...logoArt(furnitureSprite(carry!.itemKey, carry!.rot)!)} scale={scale} />
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2" data-testid="editor-actions">
            <Button size="sm" variant="secondary" disabled={!carry && !selected} onClick={rotate}>
              ⟳ {t("rotate")}
            </Button>
            <Button size="sm" variant="secondary" disabled={!selected} onClick={() => selected && pickUp(selected)}>
              ✥ {t("move")}
            </Button>
            <Button size="sm" variant="ghost" disabled={!carry && !selected} onClick={store}>
              ⌫ {t("toInventory")}
            </Button>
            {carry && (
              <span className="text-sm text-accent">
                {t("carrying", { name: furnitureItem(carry.itemKey)?.name ?? "" })}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <section>
            <p className="mb-2 label-pixel text-fg-2">{t("inventory")}</p>
            {groups.size === 0 ? (
              <p className="text-sm text-fg-3">{t("inventoryEmpty")}</p>
            ) : (
              <ul className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1" data-testid="inventory">
                {[...groups].map(([key, ids]) => {
                  const item = furnitureItem(key)!;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        title={item.name}
                        onClick={() => {
                          haptic("tap");
                          setSelected(null);
                          setCarry({ id: ids[0]!, itemKey: key, rot: 0 });
                        }}
                        className={cn(
                          "relative flex w-full flex-col items-center gap-1 rounded-md bg-surface-2 p-2 focus-ring transition duration-fast hover:bg-surface-3 active:scale-95",
                          carry?.itemKey === key && "ring-2 ring-accent",
                        )}
                      >
                        <PixelIcon {...logoArt(item.sprite)} scale={item.w * item.h > 2 ? 1 : 2} />
                        <span className="w-full truncate text-2xs text-fg-2">{item.name}</span>
                        {ids.length > 1 && (
                          <span className="absolute top-1 right-1 rounded-pill bg-accent px-1.5 nums text-2xs text-on-accent">
                            {ids.length}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <p className="mb-2 label-pixel text-fg-2">{t("wall")}</p>
            <div role="radiogroup" aria-label={t("wall")} className="grid grid-cols-8 gap-1.5">
              {BALANCE.property.wallColors.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={wall === c}
                  aria-label={c}
                  onClick={() => setWall(c)}
                  style={{ backgroundColor: c }}
                  className={cn(
                    "aspect-square rounded-sm border border-line-2 focus-ring transition duration-fast hover:scale-110",
                    wall === c && "ring-2 ring-fg-1 ring-offset-2 ring-offset-surface-1",
                  )}
                />
              ))}
            </div>
          </section>

          <section>
            <p className="mb-2 label-pixel text-fg-2">{t("floor")}</p>
            <ul className="grid grid-cols-2 gap-2">
              {(Object.keys(BALANCE.property.floors) as FloorMaterial[]).map((m) => {
                const owned = property.floorsOwned.includes(m);
                return (
                  <li key={m}>
                    <button
                      type="button"
                      aria-pressed={floor === m}
                      onClick={() => (owned ? setFloor(m) : void buyFloor(m))}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md bg-surface-2 p-1.5 text-left focus-ring transition duration-fast hover:bg-surface-3",
                        floor === m && "ring-2 ring-accent",
                      )}
                    >
                      <PixelIcon {...logoArt(FLOOR_TILES[m])} scale={2} />
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-fg-1">{t(`floors.${m}`)}</span>
                        <span className={cn("block text-2xs", owned ? "text-gain" : "text-fg-3")}>
                          {owned ? t("owned") : formatMoney(BALANCE.property.floors[m], { whole: true })}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </Modal>
  );
}
