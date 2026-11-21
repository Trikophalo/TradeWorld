"use client";

import { useState } from "react";
import { NEXAMON_SAMPLE_CARDS } from "@/components/pixel/nexamon-samples";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BALANCE } from "@/config/balance";
import { NEXAMON_SETS, type NexamonSetKey } from "@/config/nexamon";
import { packBattleCostCents } from "@/lib/sim/nexamon-battle";
import { NexamonCardFace } from "../components/card-face";
import { BattleLineupPicker } from "./battle-lineup-picker";
import { BattleModeBadges } from "./battle-lobby";
import { battleRevealTier } from "./battle-reveal";
import { BattleRevealFx } from "./battle-reveal-fx";
import { TwistOverlay } from "./battle-view";

const SIZE = BALANCE.nexamon.packSize;
const DEMOS = [
  { card: 0, slot: SIZE - 1, valueCents: 120 },
  { card: 1, slot: SIZE - 1, valueCents: 2_400 },
  { card: 2, slot: SIZE, valueCents: 18_000 },
  { card: 4, slot: SIZE, valueCents: 960_000 },
] as const;
const PERMS = [
  [1, 0],
  [2, 0, 1],
  [1, 0, 3, 2],
  [0, 1, 2, 3],
] as const;
const NAMES = ["Lena", "Max", "Ida", "Tom"];

/**
 * Pack Battle modes on /dev/ui (ADR-205): mode badges, the reveal of the last two cards, the twist; the lineup picker
 * of the create sheet (ADR-192 Nachtrag).
 */
export function BattleModesShowcase() {
  const [round, setRound] = useState(0);
  const [perm, setPerm] = useState(0);
  const [lineup, setLineup] = useState<NexamonSetKey[]>([
    ...Array<NexamonSetKey>(3).fill(NEXAMON_SETS[0]),
    ...Array<NexamonSetKey>(2).fill(NEXAMON_SETS[1]),
  ]);
  return (
    <div className="space-y-4" data-testid="battle-modes-showcase">
      <Card padding="lg" className="min-w-0">
        <p className="mb-3 label-pixel text-fg-3">Packs pro Set wählen</p>
        <BattleLineupPicker
          lineup={lineup}
          onChange={setLineup}
          sets={NEXAMON_SETS.slice(0, 3)}
          price={packBattleCostCents(lineup)}
        />
      </Card>
      <Card padding="lg" className="min-w-0">
        <p className="mb-3 label-pixel text-fg-3">Modus-Badges</p>
        <div className="flex flex-wrap gap-3">
          <BattleModeBadges twist />
          <BattleModeBadges reverse />
          <BattleModeBadges twist reverse />
        </div>
      </Card>
      <Card padding="lg" className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="label-pixel text-fg-3">Die letzten zwei Karten: Glühen, Blitz, Wackeln, Funken</p>
          <Button size="sm" variant="secondary" onClick={() => setRound((r) => r + 1)}>
            Nochmal
          </Button>
        </div>
        <div className="flex flex-wrap items-start justify-center gap-8 pb-4">
          {DEMOS.map((d) => {
            const card = NEXAMON_SAMPLE_CARDS[d.card]!;
            return (
              <BattleRevealFx
                key={`${round}-${d.card}`}
                tier={battleRevealTier(card.rarity, d.slot, SIZE)}
                rarity={card.rarity}
                valueCents={d.valueCents}
                reduced={false}
              >
                <NexamonCardFace card={card} scale={2} foil="still" />
              </BattleRevealFx>
            );
          })}
        </div>
      </Card>
      <Card padding="lg" className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="label-pixel text-fg-3">Twist nach einem Pack</p>
          <Button size="sm" variant="secondary" onClick={() => setPerm((p) => (p + 1) % PERMS.length)}>
            Nächster Twist
          </Button>
        </div>
        <div className="relative h-56 overflow-hidden rounded-lg bg-surface-2">
          <TwistOverlay
            key={perm}
            names={NAMES.slice(0, PERMS[perm]!.length)}
            round={perm + 1}
            perm={[...PERMS[perm]!]}
            reduced={false}
          />
        </div>
      </Card>
    </div>
  );
}
