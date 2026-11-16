"use client";

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useEffect, useRef } from "react";
import { BALANCE } from "@/config/balance";
import { nexamonCard, type NexamonRarity } from "@/config/nexamon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayerFigure } from "@/components/ui/player-figure";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { playSound, type SoundName } from "@/lib/sound";
import { RarityBadge } from "../components/badges";
import { CardThumb, NexamonCardBack, NexamonCardFace } from "../components/card-face";
import { NexamonPack } from "../components/pack";
import { useNexamonLive } from "./hooks";
import { Reactions } from "./reactions";

const SOUND: Record<NexamonRarity, SoundName> = {
  common: "cardShow",
  rare: "pullRare",
  ultra: "pullUltra",
  prisma: "pullPrisma",
  legendary: "pullLegendary",
};

/**
 * Watching someone open a pack (ADR-172): their figure, the pack, and every card as soon as the opener has seen it
 * (never earlier: the server holds the rest back), with viewers and emoji reactions.
 */
export function SpectatorView({ liveId, onClose }: { liveId: string | null; onClose: () => void }) {
  const t = useTranslations("nexamonLive");
  const reduced = useReducedMotionConfig();
  const query = useNexamonLive(liveId);
  const v = query.data;
  const last = v?.cards[v.cards.length - 1];
  const lastCard = last ? nexamonCard(last.cardKey) : undefined;
  const sum = v?.cards.reduce((s, p) => s + p.valueCents, 0) ?? 0;
  const heard = useRef(0);
  useEffect(() => {
    if (!v || v.cards.length <= heard.current) return;
    heard.current = v.cards.length;
    if (last) void playSound(SOUND[last.rarity]);
  }, [v, last]);

  return (
    <Dialog.Root open={liveId !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-overlay bg-scrim backdrop-blur-sm" />
        <Dialog.Content
          data-testid="spectator-view"
          data-shown={v?.cards.length ?? 0}
          aria-describedby={undefined}
          className="fixed inset-0 z-sheet flex flex-col bg-bg pt-safe pb-safe outline-none lg:m-auto lg:h-[min(94dvh,820px)] lg:w-[min(94vw,760px)] lg:rounded-xl lg:border-2 lg:border-line-2 lg:shadow-3"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-line-1 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              {v && <PlayerFigure avatarKey={v.player.avatarKey} accessories={v.player.accessories} scale={1} />}
              <div className="min-w-0">
                <Dialog.Title className="truncate font-pixel text-sm text-fg-1 uppercase">
                  {v ? t("spectate.title", { name: v.player.nickname }) : t("spectate.loading")}
                </Dialog.Title>
                {v && <p className="text-xs text-fg-3">{t(`sets.${v.set}`)}</p>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {v && (
                <Badge tone={v.done ? "neutral" : "loss"} data-testid="spectate-viewers">
                  {v.done ? t("spectate.over") : t("liveViewers", { count: v.viewers })}
                </Badge>
              )}
              <Dialog.Close asChild>
                <Button variant="secondary" size="sm" data-testid="spectate-close">
                  {t("close")}
                </Button>
              </Dialog.Close>
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-4 py-6">
            {!v ? (
              <Skeleton className="h-80 w-56 rounded-lg" />
            ) : (
              <>
                <div className="relative grid min-h-[300px] place-items-center">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {lastCard ? (
                      <motion.div
                        key={`c-${v.cards.length}`}
                        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.7, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, x: -80, scale: 0.8 }}
                        transition={SPRING.bouncy}
                        className="relative"
                        data-testid="spectate-card"
                      >
                        <NexamonCardFace card={lastCard} scale={3} foil={reduced ? "still" : "live"} />
                        <span className="absolute -top-2 left-1/2 -translate-x-1/2">
                          <RarityBadge rarity={last!.rarity} />
                        </span>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="pack"
                        animate={reduced ? undefined : { y: [0, -6, 0] }}
                        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                        exit={{ opacity: 0 }}
                      >
                        <NexamonPack set={v.set} scale={3} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <p className="nums text-sm text-fg-2" data-testid="spectate-total">
                  {v.cards.length === 0
                    ? t("spectate.waiting")
                    : t("spectate.sofar", { count: v.cards.length, value: formatMoney(sum) })}
                </p>
                <ol className="flex justify-center gap-1" aria-label={t("battle.slots")}>
                  {Array.from({ length: BALANCE.nexamon.packSize }, (_, i) => {
                    const pull = v.cards[i];
                    const card = pull ? nexamonCard(pull.cardKey) : undefined;
                    return (
                      <li key={i}>
                        {card ? (
                          <motion.div
                            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: DURATION.slow, ease: EASE.out }}
                          >
                            <CardThumb card={card} scale={1} />
                          </motion.div>
                        ) : (
                          <NexamonCardBack scale={1} className="opacity-60" />
                        )}
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
          </div>
          {v && <Reactions liveId={v.id} reactions={v.reactions} canReact={!v.isMe && !v.done} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
