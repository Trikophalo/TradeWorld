"use client";

import { motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Popover } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { BALANCE } from "@/config/balance";
import { NEXAMON_SETS, type NexamonSetKey } from "@/config/nexamon";
import { nexamonSetReleased } from "@/lib/sim/nexamon";
import { packBattleCostCents } from "@/lib/sim/nexamon-battle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { PlayerFigure } from "@/components/ui/player-figure";
import { PlazaGround } from "@/components/ui/plaza-ground";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/segmented";
import type { NexamonBattle, NexamonLiveSession, NexamonLobbyPlayer } from "@/features/game/pack-battle-types";
import { engine, useGame } from "@/features/game/store";
import { formatMoney } from "@/lib/format";
import { DURATION, EASE } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { useMountTime } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { NexamonPack } from "../components/pack";
import { BattleView } from "./battle-view";
import { BattleModeBadges, LineupStrip, useBattleAction } from "./battle-lobby";
import { useNexamonLobby } from "./hooks";
import { SpectatorView } from "./spectator-view";

const cfg = BALANCE.nexamon;

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
  // ADR-192: the create sheet; `invite` is the friend it was opened for (null = an open lobby)
  const [create, setCreate] = useState<{ invite: NexamonLobbyPlayer | null } | null>(null);
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
  const busy = data.battles.length > 0;

  return (
    <Card padding="none" className="overflow-hidden" data-testid="nexamon-lobby">
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <h2 className="font-pixel text-xs text-fg-1 uppercase">{t("lobby.title")}</h2>
        <span className="ml-auto" />
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() => setCreate({ invite: null })}
          data-testid="battle-create"
        >
          {t("lobby.create")}
        </Button>
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
              <LobbyFigure
                key={player.nickname}
                player={player}
                index={i}
                onChallenge={() => setCreate({ invite: player })}
              />
            ))}
          </ul>
        )}
      </div>
      {(pending.length > 0 || data.openBattles.length > 0) && (
        <div className="space-y-2 border-t-2 border-line-1 bg-surface-1 px-4 py-3">
          {pending.map((b) =>
            b.mode === "multi" ? (
              <LobbyBanner key={b.id} battle={b} onOpen={() => setBattleId(b.id)} />
            ) : (
              <PendingBanner key={b.id} battle={b} onOpen={() => setBattleId(b.id)} />
            ),
          )}
          {data.openBattles.map((b) => (
            <LobbyBanner key={b.id} battle={b} invited={b.invited} onOpen={() => setBattleId(b.id)} />
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

      <CreateBattleSheet
        open={create !== null}
        invite={create?.invite ?? null}
        friends={data.players}
        onClose={() => setCreate(null)}
        onCreated={(id) => setBattleId(id)}
        limits={data.limits}
      />
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

const SIZES = ["2", "3", "4"] as const;

/**
 * A new Pack Battle (ADR-192): the lineup (packs of any released set, in order: add, move, remove), the number of
 * players (2-4) and friends to invite; the running total is the stake per player. Opened from a friend's figure,
 * that friend is invited.
 */
function CreateBattleSheet({
  open,
  invite,
  friends,
  onClose,
  onCreated,
  limits,
}: {
  open: boolean;
  invite: NexamonLobbyPlayer | null;
  friends: NexamonLobbyPlayer[];
  onClose: () => void;
  onCreated: (battleId: string) => void;
  limits: { perHour: number; used: number; cooldownUntil: string | null };
}) {
  const t = useTranslations("nexamonLive");
  const cash = useGame((s) => s.portfolio?.cashCents ?? 0);
  const mountedAt = useMountTime();
  const [lineup, setLineup] = useState<NexamonSetKey[]>([NEXAMON_SETS[0]]);
  const [size, setSize] = useState<(typeof SIZES)[number]>("2");
  const [invited, setInvited] = useState<string[]>([]);
  // ADR-205: the modes; both may be on
  const [twist, setTwist] = useState(false);
  const [reverse, setReverse] = useState(false);
  const { state, run } = useBattleAction();
  const opened = useRef<string | null>(null);
  // a fresh sheet per opening: one pack, two players, the friend it was opened for
  const key = open ? (invite?.nickname ?? "") : null;
  if (opened.current !== key) {
    opened.current = key;
    if (open) {
      setLineup([NEXAMON_SETS[0]]);
      setSize("2");
      setInvited(invite ? [invite.nickname] : []);
      setTwist(false);
      setReverse(false);
    }
  }
  const players = Number(size);
  const available = NEXAMON_SETS.filter((set) => mountedAt === null || nexamonSetReleased(set, mountedAt));
  const price = packBattleCostCents(lineup);
  const maxPacks = cfg.packBattle.maxPacks;
  const short = cash < price;
  const full = limits.used >= limits.perHour;
  const invites = invited.slice(0, players - 1);
  const move = (from: number, to: number) =>
    setLineup((l) => {
      if (to < 0 || to >= l.length) return l;
      const next = [...l];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={invite ? t("challenge.title", { name: invite.nickname }) : t("create.title")}
      description={t("create.text")}
      footer={
        <Button
          block
          size="lg"
          state={state}
          disabled={short || full || lineup.length === 0}
          data-testid="challenge-send"
          onClick={async () => {
            const battle = await run(
              (id) => engine.createNexamonPackBattle(id, lineup, players, invites, { reverse, twist }),
              t("challenge.error"),
            );
            if (battle) {
              void playSound("battleJoin");
              onClose();
              onCreated(battle.id);
            }
          }}
        >
          {t("create.send", { price: formatMoney(price, { whole: true }) })}
        </Button>
      }
    >
      <div className="space-y-4">
        <section className="space-y-2">
          <h3 className="label-pixel text-fg-3">{t("create.players")}</h3>
          <Segmented
            value={size}
            onValueChange={setSize}
            options={SIZES.map((v) => ({ value: v, label: t("create.playerCount", { count: Number(v) }) }))}
            label={t("create.players")}
            block
          />
        </section>

        <section className="space-y-2" aria-labelledby="battle-mode-label">
          <h3 id="battle-mode-label" className="label-pixel text-fg-3">
            {t("modes.label")}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["twist", twist, setTwist],
                ["reverse", reverse, setReverse],
              ] as const
            ).map(([key, on, set]) => (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  set(!on);
                  void playSound("battleClick");
                }}
                data-testid={`mode-${key}`}
                className={cn(
                  "flex min-w-0 flex-col items-start gap-0.5 rounded-md border-2 p-2 text-left focus-ring transition duration-fast ease-standard active:scale-[0.98]",
                  on ? "border-accent bg-accent-soft" : "border-line-1 bg-surface-1 hover:bg-surface-2",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="font-pixel text-xs text-fg-1 uppercase">{t(`modes.${key}`)}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-4 place-items-center rounded-xs border-2 text-2xs leading-none",
                      on ? "border-accent bg-accent text-on-accent" : "border-line-2",
                    )}
                  >
                    {on ? "✓" : ""}
                  </span>
                </span>
                <span className="text-2xs text-pretty text-fg-2">{t(`modes.${key}Short`)}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-pretty text-fg-3" data-testid="mode-rules">
            {twist && reverse
              ? t("modes.both")
              : twist
                ? t("modes.twistText")
                : reverse
                  ? t("modes.reverseText")
                  : t("modes.classicText")}
          </p>
        </section>

        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="label-pixel text-fg-3">{t("create.lineup", { count: lineup.length, max: maxPacks })}</h3>
            <span className="nums text-sm font-semibold text-fg-1" data-testid="lineup-total" data-cents={price}>
              {t("create.total", { price: formatMoney(price, { whole: true }) })}
            </span>
          </div>
          {lineup.length === 0 ? (
            <p className="rounded-md border-2 border-dashed border-line-1 p-3 text-center text-xs text-fg-3">
              {t("create.empty")}
            </p>
          ) : (
            <ol className="space-y-1" data-testid="lineup">
              {lineup.map((set, i) => (
                <li
                  key={`${i}-${set}`}
                  className="flex items-center gap-2 rounded-md border-2 border-line-1 bg-surface-1 p-1.5"
                  data-testid="lineup-item"
                  data-set={set}
                >
                  <span className="w-5 text-center nums text-xs text-fg-3">{i + 1}</span>
                  <NexamonPack set={set} scale={1} sheen={false} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg-1">{t(`sets.${set}`)}</span>
                    <span className="block nums text-xs text-fg-2">
                      {formatMoney(cfg.sets[set].packPriceCents, { whole: true })}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("create.up")}
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                    data-testid="lineup-up"
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("create.down")}
                    disabled={i === lineup.length - 1}
                    onClick={() => move(i, i + 1)}
                    data-testid="lineup-down"
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("create.remove")}
                    onClick={() => setLineup((l) => l.filter((_, k) => k !== i))}
                    data-testid="lineup-remove"
                  >
                    ✕
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <div className="grid grid-cols-2 gap-2" aria-label={t("challenge.setLabel")}>
            {available.map((set) => (
              <button
                key={set}
                type="button"
                disabled={lineup.length >= maxPacks}
                onClick={() => setLineup((l) => (l.length >= maxPacks ? l : [...l, set]))}
                data-testid={`challenge-set-${set}`}
                className="flex min-w-0 items-center gap-2 rounded-md border-2 border-line-1 bg-surface-1 p-1.5 text-left focus-ring transition duration-fast ease-standard hover:bg-surface-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span aria-hidden className="font-pixel text-sm text-accent">
                  +
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-fg-1">{t(`sets.${set}`)}</span>
                  <span className="block nums text-2xs text-fg-2">
                    {formatMoney(cfg.sets[set].packPriceCents, { whole: true })}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {lineup.length >= maxPacks && (
            <p className="text-xs text-fg-3">{t("create.maxPacks", { count: maxPacks })}</p>
          )}
        </section>

        {friends.length > 0 && (
          <section className="space-y-2">
            <h3 className="label-pixel text-fg-3">{t("create.invite", { count: players - 1 })}</h3>
            <div className="flex flex-wrap gap-2">
              {friends.map((f) => {
                const on = invites.includes(f.nickname);
                return (
                  <button
                    key={f.nickname}
                    type="button"
                    aria-pressed={on}
                    disabled={!on && (invites.length >= players - 1 || f.battling)}
                    onClick={() =>
                      setInvited((list) => (on ? list.filter((n) => n !== f.nickname) : [...invites, f.nickname]))
                    }
                    data-testid="invite-friend"
                    className={cn(
                      "flex items-center gap-1.5 rounded-pill border-2 py-0.5 pr-3 pl-1 text-xs focus-ring transition duration-fast ease-standard active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50",
                      on
                        ? "border-accent bg-accent-soft text-fg-1"
                        : "border-line-1 bg-surface-1 text-fg-2 hover:bg-surface-2",
                    )}
                  >
                    <PlayerFigure avatarKey={f.avatarKey} accessories={f.accessories} scale={1} />
                    {f.nickname}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <p className="text-xs text-pretty text-fg-3">
          {t("create.rules", {
            seconds: cfg.packBattle.lobbySeconds,
            pot: formatMoney(price * players, { whole: true }),
          })}
        </p>
        {short && <p className="text-xs text-warn">{t("challenge.short")}</p>}
        {full && <p className="text-xs text-warn">{t("challenge.full", { count: limits.perHour })}</p>}
      </div>
    </Sheet>
  );
}

/** An open lobby (own or a friend's) as a banner: seats taken, the lineup, join or open. */
function LobbyBanner({
  battle: b,
  invited = false,
  onOpen,
}: {
  battle: NexamonBattle;
  invited?: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("nexamonLive");
  const join = useBattleAction();
  const mine = b.mySeat !== null;
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid={mine ? "battle-lobby-own" : "battle-lobby-open"}
      data-invited={invited ? "true" : "false"}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg-1">
          {mine
            ? t("pending.lobbyOwn", { taken: b.seats.length, size: b.size })
            : t(invited ? "pending.lobbyInvited" : "pending.lobbyOpen", {
                name: b.challenger.nickname,
                packs: b.packs.length,
                size: b.size,
                price: formatMoney(b.priceCents, { whole: true }),
              })}{" "}
          <Countdown target={Date.parse(b.expiresAt)} className="text-xs text-fg-3" />
        </p>
        <div className="mt-1 flex flex-wrap items-end gap-2">
          <LineupStrip battle={b} />
          <BattleModeBadges reverse={b.reverse} twist={b.twist} />
        </div>
      </div>
      {!mine && (
        <Button
          size="sm"
          variant="gain"
          state={join.state}
          data-testid="battle-join"
          onClick={async () => {
            const r = await join.run((id) => engine.joinNexamonPackBattle(id, b.id), t("lobbyView.joinError"));
            if (r) onOpen();
          }}
        >
          {t("lobbyView.join", { price: formatMoney(b.priceCents, { whole: true }) })}
        </Button>
      )}
      <Button size="sm" variant="secondary" onClick={onOpen} data-testid="battle-lobby-open-view">
        {t("pending.view")}
      </Button>
    </div>
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
          : t("pending.outgoing", { name: b.opponent?.nickname ?? "" })}{" "}
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
                {(s.players ?? [s.player, ...(s.opponent ? [s.opponent] : [])]).map((f) => (
                  <PlayerFigure key={f.nickname} avatarKey={f.avatarKey} accessories={f.accessories} scale={1} />
                ))}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg-1">
                    {s.kind === "battle" && s.players && s.players.length > 2
                      ? t("live.battleMany", { names: s.players.map((f) => f.nickname).join(", ") })
                      : s.kind === "battle" && s.opponent
                        ? t("live.battle", { a: s.player.nickname, b: s.opponent.nickname })
                        : t("live.pack", { name: s.player.nickname })}
                  </span>
                  <span className="flex flex-wrap items-center gap-1 text-xs text-fg-3">
                    {t(`sets.${s.set}`)}
                    {s.kind === "battle" && <BattleModeBadges reverse={s.reverse} twist={s.twist} />}
                  </span>
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
