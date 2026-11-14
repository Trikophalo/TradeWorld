"use client";

/*
 * Placeholder with the agreed interface; the pixel-art studio with Mr. Doodle Dangle replaces this file.
 */
export interface StudioEffect {
  label: string;
  tone: "gain" | "loss" | "neutral";
}
export interface StudioSegment {
  kind: string;
  headline: string;
  text: string;
  effects: StudioEffect[];
}
export interface NewsStudioProps {
  mode: "off" | "standby" | "intro" | "live" | "outro";
  startsAt?: number | null;
  segment?: StudioSegment | null;
  segmentIndex?: number;
  segmentCount?: number;
  elapsedMs?: number;
  charsPerSecond?: number;
  viewers?: number;
  replay?: boolean;
  className?: string;
}

export function NewsStudio({ mode, segment, elapsedMs = 0, charsPerSecond = 28, className }: NewsStudioProps) {
  const shown = segment ? segment.text.slice(0, Math.floor((elapsedMs / 1000) * charsPerSecond)) : "";
  return (
    <div className={className} data-testid="news-studio" data-mode={mode}>
      {segment && (
        <>
          <p className="font-semibold text-fg-1">{segment.headline}</p>
          <p className="text-sm text-fg-2">{shown}</p>
        </>
      )}
    </div>
  );
}
