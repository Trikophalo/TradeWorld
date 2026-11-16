"use client";

import { useTranslations } from "next-intl";
import { memo, useMemo, type CSSProperties } from "react";
import { NEXAMON_ART, NEXAMON_CARD_SIZE, nexamonCard, type NexamonArt, type NexamonCard } from "@/config/nexamon";
import { composeCardBack, composeCardFace, FACE_LAYOUT, type Box } from "@/components/pixel/nexamon-face";
import type { Raster } from "@/components/pixel/nexamon-raster";
import { GOLD_INK, TYPE_INK } from "@/components/pixel/nexamon-symbols";
import { cn } from "@/lib/utils";
import { fitTextScale, formatCardNumber, pixelScale } from "../lib";
import { HoloHint, HoloLayers, type CardLight } from "./holo";
import { PixelCanvas } from "./pixel-canvas";

const { width: W, height: H } = NEXAMON_CARD_SIZE;

/** Composed fronts by card key. An entry is reused while the card data and the artwork are the same objects. */
const faceCache = new Map<string, { card: NexamonCard; art: NexamonArt | undefined; raster: Raster }>();

function faceRaster(card: NexamonCard, art: NexamonArt | undefined): Raster {
  const hit = faceCache.get(card.key);
  if (hit && hit.card === card && hit.art === art) return hit.raster;
  const raster = composeCardFace(card, art);
  faceCache.set(card.key, { card, art, raster });
  return raster;
}

/** Inks of the text by rarity: dark on paper for framed cards, light on the plates of full-art cards. */
function textInks(card: NexamonCard) {
  const ink = TYPE_INK[card.type];
  if (card.rarity === "legendary")
    return {
      main: GOLD_INK.pale,
      soft: GOLD_INK.light,
      strip: GOLD_INK.pale,
      halo: GOLD_INK.plate,
      number: GOLD_INK.light,
    };
  if (card.rarity === "prisma")
    return { main: "#ffffff", soft: ink.pale, strip: "#ffffff", halo: ink.deep, number: "#ffffff" };
  return { main: ink.deep, soft: ink.dark, strip: ink.pale, halo: ink.paper, number: ink.deep };
}

export interface NexamonCardFaceProps {
  card: NexamonCard;
  /** Artwork; defaults to the catalogue's artwork of the card, then to the placeholder. */
  art?: NexamonArt;
  /** CSS pixels per art pixel (whole number). 1 = 72 x 100, 4 = 288 x 400. Text appears from 2, all of it from 3. */
  scale?: number;
  /** Name of the card this one evolves from; defaults to a lookup of `card.evolvesFrom` in the catalogue. */
  evolvesFromName?: string;
  /** "live": foil that drifts and follows `light`; "still": foil without movement; "none": print only. */
  foil?: "live" | "still" | "none";
  /** Light from a tilting parent (NexamonCard, NexamonSlab). */
  light?: CardLight;
  className?: string;
}

/**
 * The front of a Nexamon card: one canvas with frame and artwork on the 72 x 100 grid, the foil of its rarity
 * above it and real text on top, sized in art pixels so it sits in the frame at every scale.
 */
export const NexamonCardFace = memo(function NexamonCardFace({
  card,
  art,
  scale = 3,
  evolvesFromName,
  foil = "live",
  light,
  className,
}: NexamonCardFaceProps) {
  const t = useTranslations("nexamonCards");
  const u = pixelScale(scale);
  const picture = art ?? NEXAMON_ART[card.key];
  const raster = useMemo(() => faceRaster(card, picture), [card, picture]);
  const layout = FACE_LAYOUT[card.rarity];
  const inks = textInks(card);
  const type = t(`types.${card.type}`);
  const full = u >= 3;

  const at = (box: Box): CSSProperties => ({
    position: "absolute",
    left: box.x * u,
    top: box.y * u,
    width: box.w * u,
    height: box.h * u,
  });
  const halo =
    layout.kind !== "breakout"
      ? undefined
      : `${u * 0.34}px 0 0 ${inks.halo}, ${-u * 0.34}px 0 0 ${inks.halo}, 0 ${u * 0.34}px 0 ${inks.halo}, 0 ${-u * 0.34}px 0 ${inks.halo}`;

  const from = card.evolvesFrom ? (evolvesFromName ?? nexamonCard(card.evolvesFrom)?.name ?? null) : null;
  const stage = t(`stage.${card.stage}`);
  const stageLine = layout.strip || !from ? stage : `${stage} · ${t("evolvesShort", { name: from })}`;
  const stripLine = from
    ? layout.stage
      ? t("evolvesFrom", { name: from })
      : `${stage} · ${t("evolvesFrom", { name: from })}`
    : layout.stage
      ? t("typeLine", { type })
      : `${stage} · ${t("typeLine", { type })}`;

  return (
    <div
      role="img"
      aria-label={t("cardLabel", { name: card.name, type, hp: card.hp, rarity: t(`rarity.${card.rarity}`) })}
      data-rarity={card.rarity}
      data-card={card.key}
      className={cn("relative isolate shrink-0 select-none", className)}
      style={{ width: W * u, height: H * u }}
    >
      <PixelCanvas raster={raster} scale={u} />
      {foil !== "none" && <HoloLayers rarity={card.rarity} scale={u} light={light} still={foil === "still"} />}
      {u >= 2 && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ color: inks.main }}>
          {full && layout.stage && (
            <p
              className="overflow-hidden font-pixel whitespace-nowrap uppercase"
              style={{ ...at(layout.stage), fontSize: u * 2.7, lineHeight: `${u * 3}px`, color: inks.soft }}
            >
              {stageLine}
            </p>
          )}
          <p
            className="overflow-hidden font-pixel whitespace-nowrap"
            style={{ ...at(layout.name), fontSize: u * 6, lineHeight: `${u * 6}px`, textShadow: halo }}
          >
            <span
              className="inline-block origin-left"
              style={{ transform: `scaleX(${fitTextScale(card.name, 6, layout.name.w)})` }}
            >
              {card.name}
            </span>
          </p>
          <p
            className="flex items-baseline justify-end font-sans font-extrabold whitespace-nowrap"
            style={{ ...at(layout.hp), fontSize: u * 6.2, lineHeight: `${u * 7}px`, gap: u * 0.8, textShadow: halo }}
          >
            {full && (
              <span className="font-pixel font-normal" style={{ fontSize: u * 2.7 }}>
                {t("hp")}
              </span>
            )}
            <span className="nums">{card.hp}</span>
          </p>
          {full && layout.strip && (
            <p
              className="overflow-hidden text-center font-sans font-semibold whitespace-nowrap"
              style={{ ...at(layout.strip), fontSize: u * 2.6, lineHeight: `${u * 3.4}px`, color: inks.strip }}
            >
              {stripLine}
            </p>
          )}
          <p
            className="overflow-hidden font-pixel whitespace-nowrap"
            style={{ ...at(layout.attackName), fontSize: u * 5, lineHeight: `${u * 6}px` }}
          >
            <span
              className="inline-block origin-left"
              style={{ transform: `scaleX(${fitTextScale(card.attack.name, 5, layout.attackName.w)})` }}
            >
              {card.attack.name}
            </span>
          </p>
          <p
            className="text-right font-sans nums font-extrabold whitespace-nowrap"
            style={{ ...at(layout.damage), fontSize: u * 6.2, lineHeight: `${u * 7}px` }}
          >
            {card.attack.damage > 0 ? card.attack.damage : ""}
          </p>
          {full && (
            <>
              <p
                className="overflow-hidden font-sans font-medium"
                style={{ ...at(layout.attackText), fontSize: u * 2.5, lineHeight: `${u * 3}px` }}
              >
                {card.attack.text}
              </p>
              <p
                className="overflow-hidden font-sans italic"
                style={{
                  ...at(layout.flavor),
                  fontSize: u * 2.4,
                  lineHeight: `${u * 3}px`,
                  color: layout.kind === "full" ? inks.soft : inks.main,
                }}
              >
                {card.flavor}
              </p>
            </>
          )}
          <p
            className="font-sans nums font-bold whitespace-nowrap"
            style={{ ...at(layout.number), fontSize: u * 3, lineHeight: `${u * 5}px`, color: inks.number }}
          >
            {formatCardNumber(card.number)}
          </p>
        </div>
      )}
    </div>
  );
});

export interface NexamonCardBackProps {
  scale?: number;
  className?: string;
}

/** The back every Nexamon card shares: the NEXA coin in a ring of energy. */
export const NexamonCardBack = memo(function NexamonCardBack({ scale = 3, className }: NexamonCardBackProps) {
  const t = useTranslations("nexamonCards");
  const u = pixelScale(scale);
  return (
    <div
      role="img"
      aria-label={t("back")}
      className={cn("relative shrink-0 select-none", className)}
      style={{ width: W * u, height: H * u }}
    >
      <PixelCanvas raster={composeCardBack()} scale={u} />
    </div>
  );
});

export interface CardThumbProps {
  card: NexamonCard;
  art?: NexamonArt;
  /** 1 (72 x 100, picture only) or 2 (144 x 200, with name and numbers). */
  scale?: number;
  /** Greys the card out: not owned yet. */
  dimmed?: boolean;
  className?: string;
}

/**
 * A card for grids of many: one canvas, at most a handful of text nodes and one still strip of foil. No tilt, no
 * animation, no motion values. Memoised, so a wall of 77 only renders once.
 */
export const CardThumb = memo(function CardThumb({ card, art, scale = 2, dimmed = false, className }: CardThumbProps) {
  const t = useTranslations("nexamonCards");
  const u = pixelScale(scale);
  const picture = art ?? NEXAMON_ART[card.key];
  const raster = useMemo(() => faceRaster(card, picture), [card, picture]);
  const layout = FACE_LAYOUT[card.rarity];
  const inks = textInks(card);
  return (
    <div
      role="img"
      aria-label={t("cardLabel", {
        name: card.name,
        type: t(`types.${card.type}`),
        hp: card.hp,
        rarity: t(`rarity.${card.rarity}`),
      })}
      data-rarity={card.rarity}
      data-card={card.key}
      className={cn("relative isolate shrink-0 select-none", dimmed && "opacity-40 grayscale", className)}
      style={{ width: W * u, height: H * u }}
    >
      <PixelCanvas raster={raster} scale={u} />
      <HoloHint rarity={card.rarity} scale={u} />
      {u >= 2 && (
        <p
          aria-hidden
          className="absolute overflow-hidden font-pixel whitespace-nowrap"
          style={{
            left: layout.name.x * u,
            top: layout.name.y * u,
            width: (layout.name.w + 20) * u,
            fontSize: u * 6,
            lineHeight: `${u * 6}px`,
            color: inks.main,
          }}
        >
          {card.name}
        </p>
      )}
    </div>
  );
});
