"use client";

import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import type { NexamonArt, NexamonCard } from "@/config/nexamon";
import {
  ASP_INK,
  BLACK_LABEL_INK,
  composeSlab,
  SLAB_CARD,
  SLAB_LABEL,
  SLAB_SIZE,
  slabTier,
} from "@/components/pixel/nexamon-pack";
import { GOLD_INK } from "@/components/pixel/nexamon-symbols";
import {
  clampGrade,
  fitTextScale,
  formatCardNumber,
  formatGrade,
  formatSerial,
  gradeNumber,
  gradeWordKey,
  pixelScale,
} from "../lib";
import { NexamonCardBack, NexamonCardFace } from "./card-face";
import { FoilLayer, type CardLight, type FoilSpec } from "./holo";
import { PixelCanvas } from "./pixel-canvas";
import { TiltFlip, type CardSide } from "./tilt-flip";

const PLASTIC: FoilSpec = { ink: "nexamon-plastic", blend: "screen", opacity: 0.55, travel: -30 };

export interface NexamonSlabProps {
  card: NexamonCard;
  art?: NexamonArt;
  /** Grade of the grading company "ASP", 1 to 10. 10 gets the gold label, 11 is the Black Label (a 10 on black). */
  grade: number;
  /** Serial number of the slab; shown with eight digits. */
  serial: number | string;
  /** CSS pixels per art pixel. The slab is 86 x 138 art pixels. */
  scale?: number;
  evolvesFromName?: string;
  side?: CardSide;
  defaultSide?: CardSide;
  onSideChange?: (side: CardSide) => void;
  tilt?: boolean;
  flippable?: boolean;
  className?: string;
}

function Plastic({ light, u }: { light: CardLight; u: number }) {
  return (
    <div aria-hidden className="nexamon-foil-box" style={{ inset: 0, borderRadius: u * 2 }}>
      <FoilLayer spec={PLASTIC} light={light} still={false} />
    </div>
  );
}

/**
 * A graded card sealed in its case: the label of the made-up grading company ASP on top (name, set, number,
 * grade with its word, serial), the card underneath, clear plastic with a streak of light over everything.
 * Leans and turns like a card; the back shows the card back and the seal.
 */
export function NexamonSlab({
  card,
  art,
  grade: rawGrade,
  serial,
  scale = 3,
  evolvesFromName,
  side,
  defaultSide,
  onSideChange,
  tilt = true,
  flippable = true,
  className,
}: NexamonSlabProps) {
  const t = useTranslations("nexamonCards");
  const u = pixelScale(scale);
  const grade = clampGrade(rawGrade);
  const word = t(`grade.${gradeWordKey(grade)}`);
  const tier = slabTier(grade);
  const gold = tier === "gold";
  const black = tier === "black";
  const rasters = composeSlab(grade);
  const l = SLAB_LABEL;
  const brand = black ? BLACK_LABEL_INK.white : gold ? GOLD_INK.dark : ASP_INK.brand;
  const onBand = black ? BLACK_LABEL_INK.black : gold ? GOLD_INK.deep : "#ffffff";
  const ink = black ? BLACK_LABEL_INK.silver : ASP_INK.ink;
  const at = (x: number, y: number, w: number, h: number): CSSProperties => ({
    position: "absolute",
    left: x * u,
    top: y * u,
    width: w * u,
    height: h * u,
  });
  const cardAt: CSSProperties = { position: "absolute", left: SLAB_CARD.x * u, top: SLAB_CARD.y * u };
  const band = (text: string) => (
    <p
      aria-hidden
      className="overflow-hidden font-sans nums font-bold whitespace-nowrap"
      style={{ ...at(l.x + 2, l.y, l.w - 4, 5), fontSize: u * 3, lineHeight: `${u * 5}px`, color: onBand }}
    >
      {text}
    </p>
  );

  return (
    <TiltFlip
      width={SLAB_SIZE.width * u}
      height={SLAB_SIZE.height * u}
      side={side}
      defaultSide={defaultSide}
      onSideChange={onSideChange}
      tilt={tilt}
      flippable={flippable}
      maxTilt={9}
      label={t("slabFlipHint", { name: card.name })}
      className={className}
      testId="nexamon-slab"
      front={(light) => (
        <div
          role="img"
          aria-label={t("slabLabel", { name: card.name, grade: formatGrade(grade), word })}
          data-grade={grade}
          data-label={tier}
          className="relative isolate size-full select-none"
        >
          <PixelCanvas raster={rasters.front} scale={u} />
          <div style={cardAt}>
            <NexamonCardFace card={card} art={art} scale={u} evolvesFromName={evolvesFromName} light={light} />
          </div>
          {band(`ASP · ${t("slabSerial", { serial: formatSerial(serial) })}`)}
          <div aria-hidden style={{ color: ink }}>
            <p
              className="overflow-hidden font-pixel whitespace-nowrap"
              style={{ ...at(l.x + 21, l.y + 6, 36, 5), fontSize: u * 4, lineHeight: `${u * 5}px` }}
            >
              <span
                className="inline-block origin-left"
                style={{ transform: `scaleX(${fitTextScale(card.name, 4, 36)})` }}
              >
                {card.name}
              </span>
            </p>
            <p
              className="overflow-hidden font-sans nums font-semibold whitespace-nowrap"
              style={{ ...at(l.x + 21, l.y + 11, 36, 4), fontSize: u * 2.6, lineHeight: `${u * 4}px` }}
            >
              {t(`sets.${card.set}`)} · {formatCardNumber(card.number)}
            </p>
            <p
              className="overflow-hidden font-pixel whitespace-nowrap uppercase"
              style={{ ...at(l.x + 21, l.y + 15.5, 36, 5), fontSize: u * 3.4, lineHeight: `${u * 5}px`, color: brand }}
              data-testid="slab-grade-word"
            >
              {word}
            </p>
            <p
              className="text-center font-sans nums font-black"
              style={{
                ...at(l.x + l.w - 18, l.y + 6, 16, 14),
                // a half grade ("9,5") needs three characters in the box
                fontSize: u * (Number.isInteger(gradeNumber(grade)) ? 11 : 7),
                lineHeight: `${u * 14}px`,
              }}
              data-testid="slab-grade"
            >
              {formatGrade(grade)}
            </p>
          </div>
          <Plastic light={light} u={u} />
        </div>
      )}
      back={
        <div role="img" aria-label={t("slabBack")} className="relative isolate size-full select-none">
          <PixelCanvas raster={rasters.back} scale={u} />
          <div style={cardAt}>
            <NexamonCardBack scale={u} />
          </div>
          {band(t("slabBack"))}
        </div>
      }
    />
  );
}
