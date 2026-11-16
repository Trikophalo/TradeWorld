"use client";

import { motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Popover } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { BALANCE } from "@/config/balance";
import { NEXAMON_SETS, type NexamonSetKey } from "@/config/nexamon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { PlayerFigure } from "@/components/ui/player-figure";
import { PlazaGround } from "@/components/ui/plaza-ground";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import type { NexamonBattle, NexamonLiveSession, NexamonLobbyPlayer } from "@/features/game/pack-battle-types";
import { engine, useGame } from "@/features/game/store";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { useMountTime } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { NexamonPack } from "../components/pack";
import { useNexamonRefresh } from "../hooks";
import { BattleView } from "./battle-view";
import { useLobbyRefresh, useNexamonLobby } from "./hooks";
import { SpectatorView } from "./spectator-view";

const cfg = BALANCE.nexamon;

/** Runs a battle action with button state and an error toast. */
function useBattleAction() {
  const errorText = useGameErrorText();
  const refreshLobby = useLobbyRefresh();
  const refreshCards = useNexamonRefresh();
  const [state, setState] = useState<ButtonState>("idle");
  const run = async (action: (requestId: string) => Promise<NexamonBattle>, errorTitle: string) => {
    setState("loading");
    try {
      const battle = await action(crypto.randomUUID());
      setState("success");
      haptic("success");
      window.setTimeout(() => setState("idle"), 900);
      return battle;
    } catch (error) {
      setState("idle");
      toast.error(errorTitle, errorText(error));
      return null;
    } finally {
      void refreshLobby();
      void refreshCards();
    }
  };
  return { state, run };
}

/**
 * Who is on the Collectibles tab (ADR-172): friends as their dressed pixel figures on a small square, badges for
 * "opening right now" and "in a battle". A figure opens a little card with the challenge; the Live button lists the
 * running live openings. Open challenges show as banners; a battle that starts opens the battle view by itself.
 */
export function NexamonLobbyStrip() {
  const t = useTranslations("nexamonLive");
  const mounted = useMountTime() !== null;
  const lobby = useNexamonLobby(mounted);
  const params = useSearchParams();
  const [battleId, setBattleId] = useState<string | null>(null);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [challenge, setChallenge] = useState<NexamonLobbyPlayer | null>(null);
  const seenBattles = useRef(new Set<string>());

  // a battle from a notification link, then every own battle as soon as it runs
  const linked = params.get("battle");
  useEffect(() => {
    if (linked && !seenBattles.current.has(linked)) {
      seenBattles.current.add(linked);
      setBattleId(linked);
    }
  }, [linked]);
  const running = lobby.data?.battles.find((b) => b.status === "running" && b.me !== null);
  useEffect(() => {
    if (running && !seenBattles.current.has(running.id)) {
      seenBattles.current.add(running.id);
      setBattleId(running.id);
    }
  }, [running]);

  if (!mounted || !lobby.data)
    return <Skeleton className="h-36 w-full rounded-lg" data-testid="nexamon-lobby-loading" />;
  const data = lobby.data;
  const others = data.live.filter((l) => !l.isMe);
  const pending = data.battles.filter((b) => b.status === "pending");

  return (
    <Card padding="none" className="overflow-hidden" data-testid="nexamon-lobby">
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <h2 className="font-pixel text-xs text-fg-1 uppercase">{t("lobby.title")}</h2>
        <Button
          variant={others.length > 0 ? "loss" : "secondary"}
          size="sm"
          onClick={() => setLiveOpen(true)}
          data-testid="live-button"
          data-count={others.length}
          aria-label={t("lobby.liveLabel", { count: others.length })}
        >
          <span aria-hidden className={cn("size-2 rounded-pill bg-current", others.length > 0 && "animate-pulse")} />
          {t("lobby.live", { count: others.length })}
        </Button>
      </div>
      <div className="relative isolate border-t-2 border-line-1">
        <PlazaGround className="-z-10" />
        {data.players.length === 0 ? (
          <p className="px-4 py-5 text-center text-sm text-pretty text-fg-2" data-testid="lobby-empty">
            {t("lobby.empty")}
          </p>
        ) : (
          <ul
            aria-label={t("lobby.label", { count: data.players.length })}
            className="flex flex-wrap justify-center gap-x-3 gap-y-2 px-3 pt-2 pb-3"
          >
            {data.players.map((player, i) => (
              <LobbyFigure key={player.nickname} player={player} index={i} onChallenge={() => setChallenge(player)} />
            ))}
          </ul>
        )}
      </div>
      {pending.length > 0 && (
        <div className="space-y-2 border-t-2 border-line-1 bg-surface-1 px-4 py-3">
          {pending.map((b) => (
            <PendingBanner key={b.id} battle={b} onOpen={() => setBattleId(b.id)} />
          ))}
        </div>
      )}
      {data.battles
        .filter((b) => b.status === "running" && b.me !== null && battleId !== b.id)
        .map((b) => (
          <div key={b.id} className="border-t-2 border-line-1 bg-surface-1 px-4 py-2">
            <Button size="sm" block onClick={() => setBattleId(b.id)} data-testid="battle-rejoin">
              {t("lobby.rejoin")}
            </Button>
          </div>
        ))}

      <ChallengeSheet player={challenge} onClose={() => setChallenge(null)} limits={data.limits} />
      <LiveSheet
        open={liveOpen}
        onOpenChange={setLiveOpen}
        sessions={others}
        onPick={(s) => {
          setLiveOpen(false);
          if (s.kind === "battle" && s.battleId) setBattleId(s.battleId);
          else setLiveId(s.id);
        }}
      />
      <BattleView battleId={battleId} onClose={() => setBattleId(null)} />
      <SpectatorView liveId={liveId} onClose={() => setLiveId(null)} />
    </Card>
  );
}

function LobbyFigure({
  player,
  index,
  onChallenge,
}: {
  player: NexamonLobbyPlayer;
  index: number;
  onChallenge: () => void;
}) {
  const t = useTranslations("nexamonLive");
  const reduced = useReducedMotionConfig();
  return (
    <motion.li
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.slow, ease: EASE.out, delay: Math.min(index, 10) * 0.04 }}
      className="relative flex w-20 flex-col items-center"
      data-testid="lobby-figure"
      data-nickname={player.nickname}
      data-opening={player.opening ? "true" : "false"}
      data-battling={player.battling ? "true" : "false"}
    >
      <span className="mb-0.5 h-5">
        {player.opening ? (
          <Badge tone="loss" data-testid="figure-opening">
            {t("lobby.opening")}
          </Badge>
        ) : player.battling ? (
          <Badge tone="warn" data-testid="figure-battling">
            {t("lobby.battling")}
          </Badge>
        ) : null}
      </span>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={t("lobby.figureLabel", { name: player.nickname })}
            className="group relative grid place-items-center rounded-sm focus-ring"
            data-testid="lobby-figure-button"
          >
            <motion.span
              className="relative z-10 block origin-bottom transition-transform duration-fast ease-standard group-hover:-translate-y-1 group-active:translate-y-0"
              animate={reduced ? undefined : { y: [0, -2, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: (index % 5) * 0.3 }}
            >
              <PlayerFigure avatarKey={player.avatarKey} accessories={player.accessories} scale={2} />
            </motion.span>
            <span aria-hidden className="absolute inset-x-2 bottom-0 h-1 rounded-pill bg-shade opacity-60" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            sideOffset={6}
            collisionPadding={16}
            className="z-overlay w-60 rounded-md border-2 border-line-2 bg-surface-1 p-3 shadow-3 outline-none data-[state=open]:animate-[fade-in_var(--duration-base)_var(--ease-out)]"
            data-testid="lobby-card"
          >
            <p className="font-semibold text-fg-1">{player.nickname}</p>
            <p className="text-xs text-fg-3">{t("level", { level: player.level })}</p>
            <div className="mt-3 flex flex-col gap-2">
              <Popover.Close asChild>
                <Button size="sm" block onClick={onChallenge} disabled={player.battling} data-testid="lobby-challenge">
                  {t("lobby.challenge")}
                </Button>
              </Popover.Close>
              <Link
                href={`/players/${encodeURIComponent(player.nickname)}`}
                className="text-center text-xs text-fg-2 underline-offset-2 focus-ring hover:underline"
              >
                {t("lobby.profile")}
              </Link>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <span className="mt-1 w-full truncate text-center text-xs font-medium text-fg-1">{player.nickname}</span>
    </motion.li>
  );
}

function ChallengeSheet({
  player,
  onClose,
  limits,
}: {
  player: NexamonLobbyPlayer | null;
  onClose: () => void;
  limits: { perHour: number; used: number; cooldownUntil: string | null };
}) {
  const t = useTranslations("nexamonLive");
  const cash = useGame((s) => s.portfolio?.cashCents ?? 0);
  const [set, setSet] = useState<NexamonSetKey>(NEXAMON_SETS[0]);
  const { state, run } = useBattleAction();
  const price = cfg.sets[set].packPriceCents;
  const short = cash < price;
  const full = limits.used >= limits.perHour;
  return (
    <Sheet
      open={player !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("challenge.title", { name: player?.nickname ?? "" })}
      description={t("challenge.text")}
      footer={
        <Button
          block
          size="lg"
          state={state}
          disabled={short || full}
          data-testid="challenge-send"
          onClick={async () => {
            if (!player) return;
            const battle = await run(
              (id) => engine.challengeNexamonBattle(id, player.nickname, set),
              t("challenge.error"),
            );
            if (battle) {
              void playSound("battleJoin");
              onClose();
            }
          }}
        >
          {t("challenge.send", { price: formatMoney(price, { whole: true }) })}
        </Button>
      }
    >
      <div className="space-y-3" role="radiogroup" aria-label={t("challenge.setLabel")}>
        {NEXAMON_SETS.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={set === key}
            onClick={() => setSet(key)}
            data-testid={`challenge-set-${key}`}
            className={cn(
              "flex w-full items-center gap-3 rounded-md border-2 p-2 text-left focus-ring transition duration-fast ease-standard hover:bg-surface-2 active:scale-[0.99]",
              set === key ? "border-accent bg-accent-soft" : "border-line-1 bg-surface-1",
            )}
          >
            <NexamonPack set={key} scale={1} sheen={false} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-fg-1">{t(`sets.${key}`)}</span>
              <span className="block nums text-xs text-fg-2">
                {t("challenge.each", { price: formatMoney(cfg.sets[key].packPriceCents, { whole: true }) })}
              </span>
            </span>
          </button>
        ))}
        <p className="text-xs text-pretty text-fg-3">
          {t("challenge.rules", { seconds: cfg.battles.challengeSeconds })}
        </p>
        {short && <p className="text-xs text-warn">{t("challenge.short")}</p>}
        {full && <p className="text-xs text-warn">{t("challenge.full", { count: limits.perHour })}</p>}
      </div>
    </Sheet>
  );
}

function PendingBanner({ battle: b, onOpen }: { battle: NexamonBattle; onOpen: () => void }) {
  const t = useTranslations("nexamonLive");
  const accept = useBattleAction();
  const decline = useBattleAction();
  const incoming = b.me === "opponent";
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={incoming ? "battle-incoming" : "battle-outgoing"}>
      <p className="min-w-0 flex-1 text-sm text-fg-1">
        {incoming
          ? t("pending.incoming", {
              name: b.challenger.nickname,
              set: t(`sets.${b.set}`),
              price: formatMoney(b.priceCents, { whole: true }),
            })
          : t("pending.outgoing", { name: b.opponent.nickname })}{" "}
        <Countdown target={Date.parse(b.expiresAt)} className="text-xs text-fg-3" />
      </p>
      {incoming ? (
        <>
          <Button
            size="sm"
            variant="gain"
            state={accept.state}
            data-testid="battle-accept"
            onClick={async () => {
              const r = await accept.run((id) => engine.respondNexamonBattle(id, b.id, true), t("pending.error"));
              if (r?.status === "running") onOpen();
            }}
          >
            {t("pending.accept", { price: formatMoney(b.priceCents, { whole: true }) })}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            state={decline.state}
            data-testid="battle-decline"
            onClick={() => void decline.run((id) => engine.respondNexamonBattle(id, b.id, false), t("pending.error"))}
          >
            {t("pending.decline")}
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          state={decline.state}
          data-testid="battle-cancel"
          onClick={() => void decline.run((id) => engine.cancelNexamonBattle(id, b.id), t("pending.error"))}
        >
          {t("pending.cancel")}
        </Button>
      )}
    </div>
  );
}

function LiveSheet({
  open,
  onOpenChange,
  sessions,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: NexamonLiveSession[];
  onPick: (session: NexamonLiveSession) => void;
}) {
  const t = useTranslations("nexamonLive");
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("live.title")} description={t("live.text")}>
      {sessions.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-2" data-testid="live-empty">
          {t("live.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s)}
                data-testid="live-session"
                data-kind={s.kind}
                className="flex w-full items-center gap-3 rounded-md border-2 border-line-1 bg-surface-1 p-2 text-left focus-ring transition duration-fast ease-standard hover:bg-surface-2 active:scale-[0.99]"
              >
                <PlayerFigure avatarKey={s.player.avatarKey} accessories={s.player.accessories} scale={1} />
                {s.opponent && (
                  <PlayerFigure avatarKey={s.opponent.avatarKey} accessories={s.opponent.accessories} scale={1} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg-1">
                    {s.kind === "battle" && s.opponent
                      ? t("live.battle", { a: s.player.nickname, b: s.opponent.nickname })
                      : t("live.pack", { name: s.player.nickname })}
                  </span>
                  <span className="block text-xs text-fg-3">{t(`sets.${s.set}`)}</span>
                </span>
                <Badge tone="loss">{t("liveViewers", { count: s.viewers })}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
