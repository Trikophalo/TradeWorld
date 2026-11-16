"use client";

import { memo, useSyncExternalStore, type CSSProperties } from "react";
import type { Raster } from "@/components/pixel/nexamon-raster";
import { cn } from "@/lib/utils";
import { pixelScale } from "../lib";

/** One encoded picture per raster, shared by every place that shows it. */
const urls = new WeakMap<Raster, string>();
let scratch: HTMLCanvasElement | null = null;

/** Encodes a raster as a PNG data URL (browser only), once. */
function rasterUrl(raster: Raster): string {
  const hit = urls.get(raster);
  if (hit) return hit;
  scratch ??= document.createElement("canvas");
  scratch.width = raster.width;
  scratch.height = raster.height;
  const context = scratch.getContext("2d");
  if (!context) return "";
  const image = context.createImageData(raster.width, raster.height);
  image.data.set(raster.data);
  context.putImageData(image, 0, 0);
  const url = scratch.toDataURL("image/png");
  urls.set(raster, url);
  return url;
}

const subscribe = () => () => undefined;
/** A transparent pixel for the server render, where nothing can be encoded. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

export interface PixelCanvasProps {
  raster: Raster;
  /** CSS pixels per art pixel; whole numbers only. */
  scale?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Shows a raster as one picture at its native size, enlarged by a whole factor without smoothing. The raster is
 * encoded once and cached, so a wall of cards costs one DOM node per card and the same card shown twice costs
 * nothing extra.
 */
export const PixelCanvas = memo(function PixelCanvas({ raster, scale = 1, className, style }: PixelCanvasProps) {
  const src = useSyncExternalStore(
    subscribe,
    () => rasterUrl(raster),
    () => BLANK,
  );
  const factor = pixelScale(scale);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a generated data URL, nothing for the image optimiser
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      width={raster.width * factor}
      height={raster.height * factor}
      className={cn("block max-w-none pixelated select-none", className)}
      style={{ width: raster.width * factor, height: raster.height * factor, ...style }}
    />
  );
});
