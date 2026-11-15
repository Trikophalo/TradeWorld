"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { PlayerFigure } from "@/components/ui/player-figure";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlazaGround } from "@/components/ui/plaza-ground";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BATTLE_KINDS, BATTLE_RULES, isTickKind, type BattleKind } from "@/config/battles";
import type { Battle, BattleState } from "@/features/game/battle-types";
import { demoForceBattleKind, demoForcedBattleKind } from "@/features/game/demo-engine";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import { formatCountdown } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { isDemoMode } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { BattleStage } from "./battle-stage";
import { DoodleSays, GameIcon, PrizeView } from "./parts";

export const BATTLE_KEY = ["battle"] as const;

/** How often to ask the server: fast while a round game runs (the bell even faster), slow otherwise. */
function pollMs(data: BattleState | undefined, stage: boolean): number {
  const b = data?.battle;
  if (!b) return 3_000;
  if (b.status === "running") {
    if (!stage) return 3_000;
    if (b.kind && !isTickKind(b.kind)) return b.kind === "bell" ? 150 : 400;
    return 3_000;
  }
  if (b.status === "open" && b.countdownEndsAt) return 800;
  return 2_000;
}

/**
 * News battles (ADR-160) on the news page: the lobby under the TV with the joined players as their dressed figures,
 * the prize and the countdown; the battle itself opens on the whole screen.
 */
export function NewsBattle() {
  const t = useTranslations("battle");
  const client = useQueryClient();
  const errorText = useGameErrorText();
  const [watch, setWatch] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [action, setAction] = useState<ButtonState>("idle");
  const [demoKind, setDemoKind] = useState<BattleKind | null>(() => (isDemoMode ? demoForcedBattleKind() : null));
  const query = useQuery({
    queryKey: BATTLE_KEY,
    queryFn: () => engine.battle(),
    refetchInterval: (q) => pollMs(q.state.data, watch !== null || !!q.state.data?.battle?.joined),
  });
  const data = query.data;
  const offset = data ? Date.parse(data.now) - query.dataUpdatedAt : 0;
  const battle = data?.battle ?? null;
  const recent = data?.recent ?? null;

  // My battle opens by itself; its podium too, until I close it.
  const mine = battle?.status === "running" && battle.joined ? battle : recent?.joined ? recent : null;
  const stageId = watch ?? (mine && !dismissed.includes(mine.id) ? mine.id : null);
  const stageBattle =
    stageId === null ? null : battle?.id === stageId ? battle : recent?.id === stageId ? recent : null;

  const setState = useCallback((s: BattleState) => client.setQueryData(BATTLE_KEY, s), [client]);
  const refresh = useCallback(() => void client.invalidateQueries({ queryKey: BATTLE_KEY }), [client]);
  const close = useCallback(() => {
    if (stageId !== null) setDismissed((d) => [...d, stageId]);
    setWatch(null);
  }, [stageId]);

  // a joined lobby that starts: the stage opens with a sound
  const startedId = battle?.status === "running" && battle.joined ? battle.id : null;
  useEffect(() => {
    if (startedId !== null) void playSound("newsSting");
  }, [startedId]);

  if (!data) return <Skeleton className="h-64 w-full rounded-lg" />;

  const join = async () => {
    setAction("loading");
    try {
      setState(await engine.joinBattle(crypto.randomUUID()));
      void playSound("battleJoin");
      haptic("success");
    } catch (error) {
      toast.error(t("joinError"), errorText(error));
    } finally {
      setAction("idle");
    }
  };
  const leave = async () => {
    setAction("loading");
    try {
      setState(await engine.leaveBattle(crypto.randomUUID()));
      void playSound("tap");
    } catch (error) {
      toast.error(t("joinError"), errorText(error));
    } finally {
      setAction("idle");
    }
  };

  return (
    <>
      <Card padding="none" className="overflow-hidden" data-testid="news-battle" data-status={battle?.status ?? "none"}>
        {battle?.status === "running" ? (
          <RunningBanner battle={battle} onWatch={() => setWatch(battle.id)} />
        ) : battle ? (
          <Lobby battle={battle} now={data.now} offset={offset} action={action} onJoin={join} onLeave={leave} />
        ) : null}
        {recent?.result && battle?.status !== "running" && (
          <p className="border-t border-line-1 px-4 py-2 text-2xs text-fg-3" data-testid="battle-last-winner">
            {t("lastWinner", {
              name: recent.players.find((p) => p.slot === recent.result!.winnerSlot)?.nickname ?? "?",
              game: recent.kind ? t(`games.${recent.kind}.name`) : "",
            })}
          </p>
        )}
        {isDemoMode && (
          <div
            className="flex flex-wrap items-center gap-1.5 border-t border-line-1 px-4 py-2.5"
            data-testid="battle-demo"
          >
            <span className="text-2xs text-fg-3">{t("demoPick")}</span>
            {([null, ...BATTLE_KINDS] as const).map((k) => (
              <button
                key={k ?? "random"}
                type="button"
                onClick={() => {
                  demoForceBattleKind(k);
                  setDemoKind(k);
                  void playSound("tap");
                }}
                className={cn(
                  "flex h-8 items-center gap-1 rounded-sm border-2 px-2 text-2xs focus-ring transition duration-fast active:scale-95",
                  demoKind === k
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line-1 text-fg-2 hover:border-line-2",
                )}
                aria-pressed={demoKind === k}
                data-testid={`battle-demo-${k ?? "random"}`}
              >
                {k && <GameIcon kind={k} scale={1} />}
                {k ? t(`games.${k}.name`) : t("demoRandom")}
              </button>
            ))}
          </div>
        )}
      </Card>
      <AnimatePresence>
        {stageBattle && (
          <BattleStage
            key={stageBattle.id}
            battle={stageBattle}
            offsetMs={offset}
            onState={setState}
            onFinished={refresh}
            onClose={close}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function RunningBanner({ battle, onWatch }: { battle: Battle; onWatch: () => void }) {
  const t = useTranslations("battle");
  const kind = battle.kind!;
  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <GameIcon kind={kind} scale={3} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-semibold text-fg-1">
          {t("running", { game: t(`games.${kind}.name`) })}
          <Badge tone="loss">LIVE</Badge>
        </p>
        <p className="text-xs text-fg-3">{t("runningHint")}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {battle.players.map((p) => (
            <PlayerFigure key={p.nickname} avatarKey={p.avatarKey} accessories={p.accessories} scale={1} />
          ))}
        </div>
      </div>
      <Button variant={battle.joined ? "primary" : "secondary"} onClick={onWatch} data-testid="battle-watch">
        {battle.joined ? t("open") : t("watch")}
      </Button>
    </div>
  );
}

function Lobby({
  battle,
  now,
  offset,
  action,
  onJoin,
  onLeave,
}: {
  battle: Battle;
  now: string;
  offset: number;
  action: ButtonState;
  onJoin: () => void;
  onLeave: () => void;
}) {
  const t = useTranslations("battle");
  const count = battle.players.length;
  const missing = Math.max(0, battle.minPlayers - count);
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setClock(Date.now() + offset);
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [offset]);
  const left =
    battle.countdownEndsAt && clock !== null ? Math.max(0, Date.parse(battle.countdownEndsAt) - clock) : null;
  const lines = left !== null ? BATTLE_RULES.doodle.countdown : BATTLE_RULES.doodle.lobby;
  const line = lines[Math.floor(Date.parse(now) / 8_000) % lines.length]!;
  const total = BATTLE_RULES.lobby.countdownSeconds * 1000;
  const ghosts = Math.max(0, battle.minPlayers - count);

  return (
    <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className="flex -space-x-2" aria-hidden>
            {(["floor", "bulls", "quiz"] as const).map((k) => (
              <GameIcon key={k} kind={k} scale={2} className="rounded-xs bg-surface-2 ring-2 ring-surface-1" />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-pixel text-lg text-fg-1">{t("title")}</h2>
            <p className="text-xs text-pretty text-fg-3">{t("subtitle")}</p>
          </div>
          <span className="nums text-xs text-fg-2" data-testid="battle-count">
            {t("players", { count, max: battle.maxPlayers })}
          </span>
        </div>
        <div className="relative isolate overflow-hidden rounded-md bg-spotlight px-2 pt-4" data-testid="battle-lineup">
          <span aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-10">
            <PlazaGround />
          </span>
          <ul className="flex min-h-28 flex-wrap items-end justify-center gap-x-1 gap-y-2 pb-3">
            <AnimatePresence initial={false}>
              {battle.players.map((p) => (
                <motion.li
                  key={p.nickname}
                  layout
                  initial={{ y: -24, opacity: 0, scale: 0.8 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  exit={{ y: 12, opacity: 0 }}
                  transition={{ ...SPRING.bouncy }}
                  className="flex w-16 flex-col items-center"
                >
                  <PlayerFigure avatarKey={p.avatarKey} accessories={p.accessories} scale={2} title={p.nickname} />
                  <span
                    className={cn(
                      "mt-0.5 max-w-full truncate rounded-xs px-1 text-2xs",
                      p.me ? "bg-accent text-on-accent" : "bg-surface-1/80 text-fg-2",
                    )}
                  >
                    {p.me ? t("you") : p.nickname}
                  </span>
                </motion.li>
              ))}
              {Array.from({ length: ghosts }, (_, i) => (
                <motion.li
                  key={`ghost-${i}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex w-16 flex-col items-center opacity-40"
                >
                  <span className="grid h-16 w-12 place-items-center rounded-sm border-2 border-dashed border-line-2 font-pixel text-fg-3">
                    ?
                  </span>
                  <span className="mt-0.5 text-2xs text-fg-3">{t("emptySlot")}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
        <DoodleSays text={line} mood={left !== null ? "laughing" : "smug"} compact />
      </div>
      <div className="space-y-3 border-t-2 border-line-1 bg-surface-2/40 p-4 lg:border-t-0 lg:border-l-2">
        <div>
          <p className="label-pixel text-fg-3">{t("prizeTitle")}</p>
          <div className="mt-1.5" data-testid="battle-lobby-prize">
            <PrizeView prize={battle.prize} />
          </div>
        </div>
        <div className="min-h-12" aria-live="polite">
          {left !== null ? (
            <div className="space-y-1.5">
              <p className="font-pixel text-2xl text-fg-1" data-testid="battle-countdown">
                {t("startsIn", { time: formatCountdown(left / 1000) })}
              </p>
              <div className="h-2 overflow-hidden rounded-pill bg-surface-3">
                <div
                  className="h-full origin-left rounded-pill bg-gold transition-transform duration-base ease-linear"
                  style={{ transform: `scaleX(${Math.min(1, left / total)})` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-fg-2">
              {missing > 0 ? t("waitingMore", { count: missing }) : t("waiting")}
              <span className="block text-2xs text-fg-3">
                {t("lobbyHint", { min: battle.minPlayers, max: battle.maxPlayers })}
              </span>
            </p>
          )}
        </div>
        {battle.joined ? (
          <div className="flex items-center gap-2">
            <motion.p
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: DURATION.base, ease: EASE.out }}
              className="flex-1 font-pixel text-sm text-gain"
            >
              {t("joined")}
            </motion.p>
            <Button variant="ghost" size="sm" state={action} onClick={onLeave} data-testid="battle-leave">
              {t("leave")}
            </Button>
          </div>
        ) : (
          <Button
            block
            size="lg"
            state={action}
            onClick={onJoin}
            disabled={count >= battle.maxPlayers}
            data-testid="battle-join"
          >
            {t("join")}
          </Button>
        )}
        <p className="text-2xs text-fg-3">{t("prizeWinsLeft", { count: battle.prizeWinsLeft })}</p>
      </div>
    </div>
  );
}
