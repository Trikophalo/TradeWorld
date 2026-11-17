"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { BATTLE_ICONS, HEART, HEART_EMPTY } from "@/components/pixel/battle-art";
import { BATTLE_ACCESSORY_ART } from "@/components/pixel/battle-accessories";
import { anchorArt, type AnchorMood } from "@/components/pixel/news-art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { PlayerFigure } from "@/components/ui/player-figure";
import { BATTLE_ACCESSORIES } from "@/config/battle-accessories";
import { BATTLE_RULES, type BattleKind } from "@/config/battles";
import { ArtworkImage } from "@/features/artworks/components/artwork-image";
import { NexamonPack } from "@/features/nexamon/components/pack";
import { NEXAMON_SETS, type NexamonSetKey } from "@/config/nexamon/types";
import type { BattlePrize } from "@/features/game/battle-types";
import { formatInteger, formatMoney } from "@/lib/format";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Fills {name}, {game} ... in a line of Mr. Doodle Dangle. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

/** Mr. Doodle Dangle with a speech bubble; the line types itself in (keyed by the text, so a new line starts over). */
export function DoodleSays(props: { text: string; mood?: AnchorMood; compact?: boolean; className?: string }) {
  return <DoodleLine key={props.text} {...props} />;
}

function DoodleLine({
  text,
  mood = "smug",
  compact,
  className,
}: {
  text: string;
  mood?: AnchorMood;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("battle");
  const reduced = useReducedMotion();
  const [typed, setShown] = useState(0);
  const [talk, setTalk] = useState(false);
  const shown = reduced ? text.length : typed;
  useEffect(() => {
    if (reduced) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 2;
      setShown(i);
      setTalk((v) => !v);
      if (i >= text.length) window.clearInterval(id);
    }, 40);
    return () => window.clearInterval(id);
  }, [text, reduced]);
  const typing = shown < text.length;
  return (
    <div className={cn("flex items-end gap-2", className)}>
      <span className="shrink-0" aria-hidden>
        <PixelIcon
          {...anchorArt({ mood, mouth: typing && talk ? "open" : "closed", eyes: "open" })}
          scale={compact ? 1 : 2}
        />
      </span>
      <div className="relative min-w-0 flex-1 rounded-md border-2 border-line-2 bg-surface-1 px-3 py-2 shadow-1">
        <span className="sr-only">{t("doodle")}: </span>
        <p className={cn("text-pretty text-fg-1", compact ? "text-xs" : "text-sm")}>
          {text.slice(0, shown)}
          <span className="opacity-0">{text.slice(shown)}</span>
        </p>
      </div>
    </div>
  );
}

export function GameIcon({ kind, scale = 3, className }: { kind: BattleKind; scale?: number; className?: string }) {
  return <PixelIcon {...BATTLE_ICONS[kind]} scale={scale} className={className} />;
}

export function Hearts({ count, max, scale = 2 }: { count: number; max: number; scale?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${count} / ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <PixelIcon key={i} {...(i < count ? HEART : HEART_EMPTY)} scale={scale} />
      ))}
    </span>
  );
}

/** What the winner gets, as a little card: XP, money, the exclusive skins or the NFT. */
export function PrizeView({ prize, size = "md" }: { prize: BattlePrize; size?: "md" | "lg" }) {
  const t = useTranslations("battle");
  const big = size === "lg";
  if (prize.kind === "nft") {
    return (
      <div className="flex items-center gap-3">
        <ArtworkImage
          artwork={{
            pixels: prize.artwork.pixels,
            rarity: (prize.artwork.rarity as "common" | "rare" | "legendary" | null) ?? "common",
            origin: "game",
            title: prize.artwork.title,
          }}
          scale={big ? 3 : 2}
        />
        <p className={cn("min-w-0 font-semibold text-pretty text-fg-1", big ? "text-lg" : "text-sm")}>
          {t("prize.nft", { title: prize.artwork.title })}
        </p>
      </div>
    );
  }
  if (prize.kind === "accessory") {
    const tier = (["common", "rare", "epic", "legendary", "mythic"] as const).find((x) => x === prize.tier) ?? "rare";
    return (
      <div className="min-w-0 space-y-1.5" data-testid="prize-accessory">
        <p className={cn("font-semibold text-fg-1", big ? "text-lg" : "text-sm")}>
          {prize.name ?? t("prize.accessory", { tier: t(`prize.tiers.${tier}`) })}
        </p>
        {prize.key ? (
          <PlayerFigure avatarKey="rookie" accessories={[prize.key]} scale={big ? 4 : 2} />
        ) : (
          <p className="text-2xs text-gold">{t("prize.accessoryHint")}</p>
        )}
      </div>
    );
  }
  if (prize.kind === "packs") {
    const isSet = (set: string): set is NexamonSetKey => (NEXAMON_SETS as readonly string[]).includes(set);
    return (
      <div className="min-w-0 space-y-1.5" data-testid="prize-packs">
        <p className={cn("font-semibold text-fg-1", big ? "text-lg" : "text-sm")}>{t("prize.packs")}</p>
        <ul className="flex flex-wrap items-end gap-3">
          {prize.packs.map((x) => (
            <li key={x.set} className="flex items-center gap-1.5">
              {isSet(x.set) && <NexamonPack set={x.set} scale={1} sheen={false} />}
              <span className="nums text-sm text-fg-1">{t("prize.packLine", { count: x.count, set: x.name })}</span>
            </li>
          ))}
        </ul>
        <p className="nums text-2xs text-gold">
          {formatMoney(prize.cents, { whole: true })} · {t("prize.packsHint")}
        </p>
      </div>
    );
  }
  if (prize.kind === "skin") {
    const keys = prize.key ? [prize.key] : (prize.accessories ?? BATTLE_ACCESSORIES.map((a) => a.key));
    const name = prize.name ?? BATTLE_ACCESSORIES.find((a) => a.key === prize.key)?.name;
    return (
      <div className="min-w-0 space-y-1.5">
        <p className={cn("font-semibold text-fg-1", big ? "text-lg" : "text-sm")}>{name ?? t("prize.skin")}</p>
        <div className="flex flex-wrap items-end gap-1.5">
          {keys
            .slice(0, big ? 1 : 8)
            .map((key) =>
              prize.key ? (
                <PlayerFigure key={key} avatarKey="rookie" accessories={[key]} scale={big ? 4 : 2} />
              ) : (
                <SkinChip key={key} itemKey={key} />
              ),
            )}
        </div>
        {!prize.key && <p className="text-2xs text-gold">{t("prize.skinHint")}</p>}
      </div>
    );
  }
  const label =
    prize.kind === "xp"
      ? t("prize.xp", { xp: formatInteger(prize.xp) })
      : prize.kind === "money"
        ? t("prize.money", { amount: formatMoney(prize.cents, { whole: true }) })
        : t("prize.none");
  return (
    <div>
      <p className={cn("font-pixel nums text-gold", big ? "text-3xl" : "text-xl")}>{label}</p>
      {prize.kind === "money" && prize.fallback && <p className="text-2xs text-fg-3">{t("prize.fallback")}</p>}
    </div>
  );
}

function SkinChip({ itemKey }: { itemKey: string }) {
  const art = BATTLE_ACCESSORY_ART[itemKey];
  if (!art) return null;
  const name = BATTLE_ACCESSORIES.find((a) => a.key === itemKey)?.name ?? itemKey;
  return (
    <span className="grid size-9 place-items-center rounded-sm bg-gold/15 ring-1 ring-gold/60" title={name}>
      <PixelIcon grid={art.grid} palette={resolvePalette(art.palette)} scale={2} title={name} />
    </span>
  );
}

/** "$s" style colours of accessory art (the wearer's colours) shown neutral on their own. */
function resolvePalette(palette: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, v.startsWith("$") ? "var(--fg-3)" : v]));
}

/** A big number that pops in: 3, 2, 1, LOS! */
export function PopNumber({ value, className }: { value: string; className?: string }) {
  return (
    <motion.span
      key={value}
      initial={{ scale: 2.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.6, opacity: 0 }}
      transition={{ ...SPRING.bouncy }}
      className={cn("inline-block font-pixel text-fg-1", className)}
    >
      {value}
    </motion.span>
  );
}

export const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE.out } },
  exit: { opacity: 0, y: -8, transition: { duration: DURATION.fast, ease: EASE.in } },
};

export const gameName = (kind: BattleKind) => BATTLE_RULES.names[kind];
