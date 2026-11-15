"use client";

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import { HEART } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { SpeechBubble } from "@/components/ui/figure-bubble";
import { PlayerFigure } from "@/components/ui/player-figure";
import { BALANCE } from "@/config/balance";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Bubble, StageFigure } from "./audience";
import { useElementWidth } from "./studio";

/*
 * The studio audience under the TV (ADR-157): everyone watching stands in a row as their dressed figure, me marked
 * "Du", friends with a heart, the made-up chat viewers in looks of their own. What someone writes pops up above
 * them as a speech bubble; bubbles up at the same time sit on different heights (lanes) with a stem down to the
 * speaker. The row is measured so that it always fits: on a phone the figures stand close together.
 */

const cfg = BALANCE.newsShow.audience;
/** Height of one bubble lane in px (two lines of text, border, tail). */
const LANE = 50;
const SIDE = 8;

export interface AudienceStageProps {
  figures: readonly StageFigure[];
  /** Watching but not on the stage. */
  hidden: number;
  bubbles: readonly Bubble[];
  watching: number;
  live: boolean;
  className?: string;
}

export function AudienceStage({ figures, hidden, bubbles, watching, live, className }: AudienceStageProps) {
  const t = useTranslations("newsShow");
  const reduced = Boolean(useReducedMotionConfig());
  const [measure, measured] = useElementWidth<HTMLDivElement>();
  const width = measured ?? 334;
  const scale = width >= 560 ? 3 : 2;
  const figureWidth = 24 * scale;
  const figureHeight = 32 * scale;
  const slots = figures.length + (hidden > 0 ? 1 : 0);
  const spacing = Math.max(16, Math.min(figureWidth + 10 * scale, Math.floor((width - 2 * SIDE) / Math.max(1, slots))));
  const start = Math.round((width - slots * spacing) / 2);
  const centerOf = (i: number) => start + i * spacing + spacing / 2;
  const bubbleWidth = Math.min(scale === 3 ? 220 : 172, width - 2 * SIDE);
  const lanes = cfg.bubblesAtOnce;
  const top = lanes * LANE + 12;
  // name tags: when the figures stand close, every second tag drops a line so names stay readable
  const crowded = spacing < 56;
  const height = top + figureHeight + (crowded ? 40 : 26);
  const index = new Map(figures.map((f, i) => [f.nickname, i]));

  return (
    <section
      aria-label={t("audienceLabel")}
      className={cn("relative overflow-hidden border-t border-line-1 bg-surface-2", className)}
      data-testid="news-audience"
    >
      <div ref={measure} className="relative w-full" style={{ height }}>
        {/* the studio wall: a sign that lights up while the show is live */}
        <div aria-hidden className="absolute inset-x-0 top-0 flex items-start justify-between px-3 pt-2">
          <p className="label-pixel text-fg-3">{t("audienceTitle")}</p>
          <span
            className={cn(
              "rounded-xs border-2 px-1.5 label-pixel transition-opacity duration-slow",
              live ? "border-warn text-warn" : "border-line-2 text-fg-3 opacity-60",
            )}
          >
            {t("applause")}
          </span>
        </div>
        <p className="sr-only">{t("viewers", { count: watching })}</p>
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-5 border-t border-line-2 bg-surface-3" />
        {/* the sofa behind the audience */}
        {figures.length > 0 && (
          <div
            aria-hidden
            className="absolute rounded-t-lg border-2 border-b-0 border-line-2 bg-surface-3"
            style={{
              left: Math.max(SIDE / 2, start - 3 * scale),
              width: Math.min(width - SIDE, figures.length * spacing + 6 * scale),
              top: top + 16 * scale,
              bottom: 20,
            }}
          />
        )}

        <ul className="absolute inset-0" aria-label={t("audienceList")}>
          {figures.map((f, i) => {
            const talking = bubbles.some((b) => b.nickname === f.nickname);
            return (
              <motion.li
                key={f.nickname}
                className="absolute top-0 left-0"
                style={{ top, width: figureWidth }}
                initial={reduced ? { opacity: 0, x: centerOf(i) - figureWidth / 2 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, x: centerOf(i) - figureWidth / 2, y: talking && !reduced ? -scale : 0 }}
                transition={reduced ? { duration: 0 } : SPRING.smooth}
                data-testid="audience-figure"
                data-nickname={f.nickname}
                data-me={f.me || undefined}
                data-friend={f.friend || undefined}
                data-bot={f.bot || undefined}
              >
                <span className="sr-only">
                  {f.me
                    ? t("audienceMeName", { name: f.nickname })
                    : f.friend
                      ? t("audienceFriendName", { name: f.nickname })
                      : f.nickname}
                </span>
                <PlayerFigure
                  avatarKey={f.avatarKey}
                  accessories={f.accessories}
                  scale={scale}
                  title={f.nickname}
                  className="block"
                />
                {/* the name tag under the figure; "Du" for me, a heart for friends */}
                <span
                  aria-hidden
                  className="absolute top-full left-1/2 flex -translate-x-1/2 items-center justify-center gap-0.5"
                  style={{
                    width: crowded ? spacing * 2 - 4 : Math.max(figureWidth, spacing - 2),
                    marginTop: crowded && i % 2 === 1 ? 16 : 2,
                  }}
                  data-testid="audience-name"
                >
                  {f.friend && !f.me && <PixelIcon {...HEART} scale={1} className="block shrink-0" />}
                  <span
                    className={cn(
                      "min-w-0 truncate rounded-xs px-1 text-2xs leading-4 font-semibold",
                      f.me ? "bg-accent text-on-accent" : "bg-surface-1/80 text-fg-1",
                    )}
                  >
                    {f.me ? t("audienceMe") : f.nickname}
                  </span>
                </span>
              </motion.li>
            );
          })}
          {hidden > 0 && (
            <li
              className="absolute grid place-items-center"
              style={{ top: top + figureHeight / 2 - 12, left: centerOf(figures.length) - 18, width: 36 }}
              data-testid="audience-more"
            >
              <span className="rounded-full bg-surface-3 px-1.5 nums text-xs leading-6 font-semibold text-fg-2">
                {t("audienceMore", { count: hidden })}
              </span>
              <span className="sr-only">{t("audienceMoreLabel", { count: hidden })}</span>
            </li>
          )}
        </ul>

        {/* what they say: oldest highest, each bubble keeps its lane */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <AnimatePresence>
            {bubbles.map((b) => {
              const i = index.get(b.nickname);
              if (i === undefined) return null;
              const x = centerOf(i);
              const left = Math.max(SIDE, Math.min(width - SIDE - bubbleWidth, Math.round(x - bubbleWidth / 2)));
              const lane = Math.min(b.lane, lanes - 1);
              const mine = figures[i]?.me ?? false;
              return (
                <motion.div
                  key={b.id}
                  className="absolute"
                  style={{
                    left,
                    width: bubbleWidth,
                    bottom: height - top - 2 * scale + lane * LANE + 6,
                    zIndex: 10 + lanes - lane,
                  }}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: DURATION.base, ease: EASE.out }}
                  data-testid="audience-bubble"
                  data-nickname={b.nickname}
                >
                  <SpeechBubble
                    author={mine ? t("audienceMe") : b.nickname}
                    tailX={x - left}
                    stem={lane * LANE}
                    tone={mine ? "accent" : "default"}
                  >
                    {b.body}
                  </SpeechBubble>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
