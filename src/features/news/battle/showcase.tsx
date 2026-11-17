"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { BATTLE_ACCESSORIES } from "@/config/battle-accessories";
import { BULL, CUE_ARROW, GAVEL } from "@/components/pixel/battle-art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { BATTLE_KINDS, BATTLE_RULES } from "@/config/battles";
import { PlayerFigure } from "@/components/ui/player-figure";
import { battleParamsFor } from "@/features/game/demo/battles";
import { initBattle, stepBattle, tickInputs } from "@/lib/sim/battle";
import { botStream } from "@/lib/sim/battle/vectors";
import { prefersReducedMotion } from "@/stores/settings";
import { DoodleSays, GameIcon, Hearts, PrizeView } from "./parts";
import { createArenaRenderer, type ArenaKind } from "./render/arena";
import { ArrowPad } from "./rodeo-game";
import { Candles } from "./round-games-more";
import { TouchPad } from "./touch-pad";

const SAMPLE_PLAYERS = BATTLE_RULES.demoBots.slice(0, 5).map((b, slot) => ({
  slot,
  nickname: b.nickname,
  avatarKey: b.avatarKey,
  accessories: [...b.accessories],
  me: slot === 0,
}));

/** An arena running by itself with made-up players (the showcase on /dev/ui, ADR-160). */
export function ArenaPreview({ kind, seed = 3 }: { kind: ArenaKind; seed?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const params = battleParamsFor(kind);
    const renderer = createArenaRenderer(el, {
      kind,
      params,
      players: SAMPLE_PLAYERS,
      reducedMotion: prefersReducedMotion(),
      onShake: () => undefined,
      onSound: () => undefined,
    });
    renderer.resize(el.parentElement?.clientWidth ?? 352, 400);
    const streams = SAMPLE_PLAYERS.map((p) => botStream(seed, kind, p.slot, 2000));
    let state = initBattle(kind, seed, SAMPLE_PLAYERS.length, params as never);
    const start = performance.now();
    let frame = 0;
    const loop = () => {
      const exact = (performance.now() - start) / params.tickMs;
      if (state.done) state = initBattle(kind, seed, SAMPLE_PLAYERS.length, params as never);
      while (!state.done && state.tick <= exact % 1200)
        stepBattle(kind, state, tickInputs(streams, state.tick), params as never);
      renderer.draw({ state, tick: state.tick, alpha: exact % 1 }, performance.now());
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [kind, seed]);
  return <canvas ref={canvas} className="block pixelated" aria-hidden />;
}

/** The parts of the news battles for the UI showcase. */
export function BattleShowcase() {
  const t = useTranslations("battle");
  return (
    <>
      <div className="space-y-3 rounded-lg border border-line-1 bg-surface-1 p-4">
        <p className="label-pixel text-fg-3">{t("showcase")}: Spiele</p>
        <ul className="flex flex-wrap gap-3">
          {BATTLE_KINDS.map((k) => (
            <li key={k} className="flex items-center gap-1.5 text-xs text-fg-2">
              <GameIcon kind={k} scale={2} />
              {t(`games.${k}.name`)}
            </li>
          ))}
        </ul>
        <DoodleSays text={BATTLE_RULES.doodle.lobby[0]!} compact />
        <Hearts count={2} max={3} />
      </div>
      <div className="space-y-3 rounded-lg border border-line-1 bg-surface-1 p-4">
        <p className="label-pixel text-fg-3">{t("showcase")}: Preise</p>
        <PrizeView prize={{ kind: "xp", xp: 2900 }} />
        <PrizeView prize={{ kind: "money", cents: 600_000 }} />
        <PrizeView prize={{ kind: "skin" }} />
        <PrizeView prize={{ kind: "accessory", tier: "epic" }} />
        <PrizeView prize={{ kind: "accessory", tier: "rare", key: "cowboy_hat", name: "Cowboyhut" }} />
        <PrizeView
          prize={{
            kind: "packs",
            packs: [
              { set: "super_apex", count: 1, name: "Nexamon: Super Apex" },
              { set: "mystic_energy", count: 5, name: "Nexamon: Mystic Energy" },
            ],
            cents: 200_000,
          }}
        />
        <div className="flex flex-wrap gap-2">
          {BATTLE_ACCESSORIES.map((a) => (
            <PlayerFigure key={a.key} avatarKey="rookie" accessories={[a.key]} scale={2} title={a.name} />
          ))}
        </div>
      </div>
      {(
        [
          "floor",
          "bulls",
          "coins",
          "sumo",
          "potato",
          "bear",
          "dash",
          "margin",
          "elevator",
          "laser",
          "zone",
          "tag",
          "tiles",
          "paint",
          "crash",
        ] as const
      ).map((k) => (
        <div key={k} className="space-y-2 rounded-lg border border-line-1 bg-surface-1 p-4">
          <p className="label-pixel text-fg-3">
            {t("showcase")}: {t(`games.${k}.name`)}
          </p>
          <ArenaPreview kind={k} />
        </div>
      ))}
      <div className="space-y-3 rounded-lg border border-line-1 bg-surface-1 p-4">
        <p className="label-pixel text-fg-3">
          {t("showcase")}: {t("games.rodeo.name")}
        </p>
        <div className="flex flex-wrap items-end gap-4">
          {SAMPLE_PLAYERS.slice(0, 3).map((p) => (
            <div key={p.slot} className="flex flex-col items-center">
              <div className="-mb-3">
                <PlayerFigure avatarKey={p.avatarKey} accessories={p.accessories} scale={2} />
              </div>
              <PixelIcon {...BULL} scale={3} />
            </div>
          ))}
          <PixelIcon {...CUE_ARROW} scale={5} />
        </div>
        <ArrowPad onChange={() => undefined} className="w-fit" />
      </div>
      <div className="space-y-3 rounded-lg border border-line-1 bg-surface-1 p-4">
        <p className="label-pixel text-fg-3">
          {t("showcase")}: {t("games.higher.name")} · {t("games.auction.name")}
        </p>
        <div className="rounded-md bg-surface-2 p-2">
          <Candles chart={[100, 102, 101, 104, 107, 106, 109, 113, 111, 115]} next={118} className="h-32 w-full" />
        </div>
        <PixelIcon {...GAVEL} scale={3} />
      </div>
      <div className="space-y-2 rounded-lg border border-line-1 bg-surface-1 p-4">
        <p className="label-pixel text-fg-3">{t("showcase")}: Touch</p>
        <TouchPad onChange={() => undefined} action={t("controls.actionButton")} />
      </div>
    </>
  );
}
