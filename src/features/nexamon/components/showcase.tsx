"use client";

import { useState, type ReactNode } from "react";
import {
  NEXAMON_CARD_SIZE,
  NEXAMON_CARDS,
  NEXAMON_RARITIES,
  NEXAMON_SETS,
  NEXAMON_TYPES,
  type NexamonCard as NexamonCardData,
  type NexamonSetKey,
} from "@/config/nexamon";
import {
  NEXAMON_SAMPLE_CARDS,
  NEXAMON_SAMPLE_EVENT,
  NEXAMON_SAMPLE_EVOLVES,
  NEXAMON_SAMPLE_WARRIOR,
  NEXAMON_SAMPLE_YIN_YANG,
  nexamonSampleArt,
} from "@/components/pixel/nexamon-samples";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip } from "@/components/ui/tooltip";
import type { NexamonListing } from "@/features/game/nexamon-types";
import { NEXAMON_CONDITIONS } from "../lib";
import { ConditionBadge, RarityBadge, SetIcon, TypeIcon } from "./badges";
import { BonusTag } from "./bonuses";
import { ProfileNexamon } from "./profile-collection";
import { NexamonCard } from "./card";
import { CardThumb, NexamonCardBack, NexamonCardFace } from "./card-face";
import { GradeReveal, GradingPack } from "./grading-reveal";
import { DealNote, ListingRow } from "./listing-row";
import { NexamonPack } from "./pack";
import { InstantSell } from "./instant-sell";
import { PackOpening } from "./pack-opening";
import { RareReveal } from "./rare-reveal";
import { revealTier } from "../lib";
import { CopyQuality, CopyVisual, FactRow, GradeChip, SelectField, Stat } from "./parts";
import { NexamonSlab } from "./slab";

const evolvesName = (card: NexamonCardData) =>
  card.evolvesFrom ? NEXAMON_SAMPLE_EVOLVES[card.evolvesFrom] : undefined;
const sampleArt = (card: NexamonCardData) => nexamonSampleArt()[card.key];

/** Real catalogue cards for the showcase: per set one of every rarity (numbers 7, 55, 64, 73, 77). */
const REAL_NUMBERS = new Set([7, 55, 64, 73, 77]);
const REAL_CARDS: NexamonCardData[] = NEXAMON_CARDS.filter((card) => REAL_NUMBERS.has(card.number));

/** One common of every type without artwork: the placeholder of the renderer. */
const TYPE_CARDS: NexamonCardData[] = NEXAMON_TYPES.map((type, i) => ({
  ...NEXAMON_SAMPLE_CARDS[0]!,
  key: `demo-type-${type}`,
  number: i + 1,
  type,
  name: [
    "Glutling",
    "Welpix",
    "Moosel",
    "Zappit",
    "Sinnox",
    "Kiesel",
    "Nachtua",
    "Bolzer",
    "Flimmi",
    "Drakling",
    "Sternling",
  ][i]!,
  hp: 40 + i * 10,
}));

/** The pack of the opening demo, in slot order: three commons, then the hits. */
const DEMO_PACK: NexamonCardData[] = [
  NEXAMON_SAMPLE_CARDS[0]!,
  TYPE_CARDS[2]!,
  TYPE_CARDS[7]!,
  NEXAMON_SAMPLE_CARDS[1]!,
  NEXAMON_SAMPLE_CARDS[4]!,
];

/** Offers for the listing row: an AI seller, a player with a slab, and the own offer. */
const DEMO_LISTINGS: NexamonListing[] = [
  { seller: "Karten-Kalle", sellerAi: true, mine: false, grade: null, priceCents: 1_320 },
  { seller: "Mira", sellerAi: false, mine: false, grade: 10, priceCents: 3_100 },
  { seller: "Du", sellerAi: false, mine: true, grade: null, priceCents: 1_100 },
].map((row, i) => {
  const card = REAL_CARDS[i + 1]!;
  return {
    id: `demo-listing-${i}`,
    copyId: `demo-copy-${i}`,
    cardKey: card.key,
    set: card.set,
    rarity: card.rarity,
    serial: 7 + i,
    condition: "mint",
    valueCents: row.grade === null ? 1_200 : 3_600,
    listedAt: "2026-01-01T12:00:00Z",
    ...row,
  };
});

/** Values of the demo pack (ADR-204): the last two roll up under the card. */
const DEMO_PACK_VALUES = [120, 90, 80, 2_400, 9_600];
const DEMO_PACK_PRICE = 1_500;
/** The big reveal on its own: every rarity that gets one, with a made-up value. */
const RARE_DEMOS = NEXAMON_SAMPLE_CARDS.filter((card) => revealTier(card.rarity) > 0);

/** One package per result tier for the reveal demo: below 8, a 9, a 10 and the Black Label. */
const REVEAL_DEMOS = [
  { grade: 6, card: 0, serial: 41, valueCents: 960 },
  { grade: 9, card: 2, serial: 42, valueCents: 19_200 },
  { grade: 10, card: 3, serial: 43, valueCents: 96_000 },
  { grade: 11, card: 4, serial: 44, valueCents: 4_800_000 },
] as const;

function Block({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <Card padding="lg" className="min-w-0" data-testid={testId}>
      <p className="mb-4 label-pixel text-fg-3">{label}</p>
      {children}
    </Card>
  );
}

const ONE_OF_ONE_SAMPLE = NEXAMON_SAMPLE_CARDS.find((c) => c.rarity === "one_of_one")!;
const URANIUM_SAMPLE = NEXAMON_SAMPLE_CARDS.find((c) => c.rarity === "uranium")!;

/** The Nexamon cards on /dev/ui (ADR-165): every rarity, the back, slabs, packs, the opening and the small parts. */
export function NexamonShowcase() {
  const art = nexamonSampleArt();
  const [set, setSet] = useState<NexamonSetKey>("mystic_energy");
  const [run, setRun] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [demoSort, setDemoSort] = useState<"number" | "value">("number");
  const [revealRound, setRevealRound] = useState(0);

  return (
    <div className="space-y-4" data-testid="nexamon-showcase">
      <Block label="Karten: jede Seltenheit, kippen und umdrehen" testId="nexamon-fronts">
        <div className="flex flex-wrap items-start justify-center gap-4">
          {NEXAMON_SAMPLE_CARDS.map((card) => (
            <div key={card.key} className="flex flex-col items-center gap-2">
              <NexamonCard card={card} art={art[card.key]} scale={3} evolvesFromName={evolvesName(card)} />
              <RarityBadge rarity={card.rarity} short />
            </div>
          ))}
        </div>
      </Block>

      <Block label="Cosmic Winds (ADR-174): Ereigniskarte, One of One, One-of-One-Slab" testId="nexamon-cosmic">
        <div className="flex flex-wrap items-start justify-center gap-4">
          <div className="flex flex-col items-center gap-2" data-testid="showcase-event">
            <NexamonCard card={NEXAMON_SAMPLE_EVENT} art={art[NEXAMON_SAMPLE_EVENT.key]} scale={3} />
            <RarityBadge rarity={NEXAMON_SAMPLE_EVENT.rarity} short />
          </div>
          <div className="flex flex-col items-center gap-2" data-testid="showcase-one-of-one">
            <NexamonCard card={ONE_OF_ONE_SAMPLE} art={art[ONE_OF_ONE_SAMPLE.key]} scale={3} />
            <RarityBadge rarity="one_of_one" />
          </div>
          <NexamonSlab card={ONE_OF_ONE_SAMPLE} art={art[ONE_OF_ONE_SAMPLE.key]} grade={10} serial={1} scale={2} />
        </div>
      </Block>

      <Block label="Titans Revenge und Yin Yang (ADR-182): Uranium, Krieger, Yin und Yang" testId="nexamon-new-sets">
        <div className="flex flex-wrap items-start justify-center gap-4">
          <div className="flex flex-col items-center gap-2" data-testid="showcase-uranium">
            <NexamonCard card={URANIUM_SAMPLE} art={art[URANIUM_SAMPLE.key]} scale={3} />
            <RarityBadge rarity="uranium" />
          </div>
          <div className="flex flex-col items-center gap-2" data-testid="showcase-warrior">
            <NexamonCard card={NEXAMON_SAMPLE_WARRIOR} art={art[NEXAMON_SAMPLE_WARRIOR.key]} scale={3} />
            <RarityBadge rarity={NEXAMON_SAMPLE_WARRIOR.rarity} short />
          </div>
          <div className="flex flex-wrap justify-center gap-2" data-testid="showcase-yin-yang">
            {NEXAMON_SAMPLE_YIN_YANG.map((card) => (
              <NexamonCard key={card.key} card={card} art={art[card.key]} scale={3} />
            ))}
          </div>
        </div>
      </Block>

      <Block label="Karten-Boni (ADR-171): aktiv, mit Slab-Boost, nicht aktiv" testId="nexamon-bonus-tags">
        <div className="flex flex-wrap items-center gap-4">
          <BonusTag bonus={{ kind: "vault", bps: 100, boostedBps: 100, active: true }} />
          <BonusTag bonus={{ kind: "xp", bps: 250, boostedBps: 500, active: true }} />
          <BonusTag bonus={{ kind: "company", bps: 50, boostedBps: 50, active: false }} />
        </div>
      </Block>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block label="Groß (Faktor 4) und Rückseite" testId="nexamon-inspect">
          <div className="flex flex-wrap items-start justify-center gap-4">
            <NexamonCard
              card={NEXAMON_SAMPLE_CARDS[3]!}
              art={art[NEXAMON_SAMPLE_CARDS[3]!.key]}
              scale={4}
              evolvesFromName={evolvesName(NEXAMON_SAMPLE_CARDS[3]!)}
            />
            <NexamonCardBack scale={3} />
          </div>
        </Block>
        <Block label="Slabs: bewertete Karten von ASP" testId="nexamon-slabs">
          <div className="flex flex-wrap items-start justify-center gap-4">
            <NexamonSlab
              card={NEXAMON_SAMPLE_CARDS[4]!}
              art={art[NEXAMON_SAMPLE_CARDS[4]!.key]}
              grade={10}
              serial={481516}
              scale={2}
            />
            <NexamonSlab
              card={NEXAMON_SAMPLE_CARDS[2]!}
              art={art[NEXAMON_SAMPLE_CARDS[2]!.key]}
              grade={9.5}
              serial={23420042}
              scale={2}
              evolvesFromName={evolvesName(NEXAMON_SAMPLE_CARDS[2]!)}
            />
            <NexamonSlab
              card={NEXAMON_SAMPLE_CARDS[0]!}
              art={art[NEXAMON_SAMPLE_CARDS[0]!.key]}
              grade={6}
              serial={7}
              scale={2}
            />
          </div>
        </Block>
      </div>

      <Block label="Slab groß (Faktor 3)" testId="nexamon-slab-large">
        <div className="flex flex-wrap items-start justify-center gap-6">
          <NexamonSlab
            card={NEXAMON_SAMPLE_CARDS[3]!}
            art={art[NEXAMON_SAMPLE_CARDS[3]!.key]}
            grade={10}
            serial={10000001}
            scale={3}
            evolvesFromName={evolvesName(NEXAMON_SAMPLE_CARDS[3]!)}
          />
          <NexamonSlab
            card={NEXAMON_SAMPLE_CARDS[1]!}
            art={art[NEXAMON_SAMPLE_CARDS[1]!.key]}
            grade={8.5}
            serial={5550123}
            scale={3}
            evolvesFromName={evolvesName(NEXAMON_SAMPLE_CARDS[1]!)}
          />
        </div>
      </Block>

      <Block label="Black Label: die Stufe über der ASP 10 (nur Mint, 1 %, Wert ×10)" testId="nexamon-black-label">
        <div className="flex flex-wrap items-start justify-center gap-6">
          <NexamonSlab
            card={NEXAMON_SAMPLE_CARDS[4]!}
            art={art[NEXAMON_SAMPLE_CARDS[4]!.key]}
            grade={11}
            serial={1}
            scale={3}
          />
          <NexamonSlab
            card={NEXAMON_SAMPLE_CARDS[4]!}
            art={art[NEXAMON_SAMPLE_CARDS[4]!.key]}
            grade={10}
            serial={2}
            scale={3}
          />
          <div className="flex flex-col items-start gap-2">
            <GradeChip grade={11} />
            <GradeChip grade={11} short />
            <GradeChip grade={10} />
            <CopyVisual card={REAL_CARDS[2]!} grade={11} serial={3} scale={1} />
          </div>
        </div>
      </Block>

      <Block
        label="Paket von ASP: aufreißen, dann wird die Note langsam enthüllt (unter 8, 8–9, 10, Black Label)"
        testId="nexamon-grade-reveal"
      >
        <div className="flex flex-wrap items-end justify-center gap-4">
          <GradingPack scale={2} />
          <Tooltip testId="showcase-tip" content="Tooltip: erscheint bei Hover, Fokus und Tipp">
            <button type="button" className="rounded-xs focus-ring" data-testid="showcase-tip-trigger">
              <CardThumb card={REAL_CARDS[0]!} scale={1} />
            </button>
          </Tooltip>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {REVEAL_DEMOS.map((demo) => (
            <div key={`${demo.grade}-${revealRound}`} data-testid={`reveal-demo-${demo.grade}`}>
              <GradeReveal
                card={NEXAMON_SAMPLE_CARDS[demo.card]!}
                art={art[NEXAMON_SAMPLE_CARDS[demo.card]!.key]}
                grade={demo.grade}
                serial={demo.serial}
                valueCents={demo.valueCents}
                scale={2}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-center">
          <Button size="sm" variant="secondary" onClick={() => setRevealRound((n) => n + 1)}>
            Pakete neu versiegeln
          </Button>
        </div>
      </Block>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block label="Booster: ein Design je Set" testId="nexamon-packs">
          <div className="flex flex-wrap items-end justify-center gap-4">
            {NEXAMON_SETS.map((key) => (
              <div key={key} className="flex flex-col items-center gap-2">
                <NexamonPack set={key} scale={2} />
                <SetIcon set={key} label />
              </div>
            ))}
          </div>
        </Block>
        <Block label="Booster öffnen: Karten selbst wegziehen" testId="nexamon-opening">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Segmented
              value={set}
              onValueChange={(value) => {
                setSet(value);
                setRun((n) => n + 1);
                setLog([]);
              }}
              options={NEXAMON_SETS.map((key) => ({ value: key, label: key.split("_")[0]! }))}
              label="Set"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setRun((n) => n + 1);
                setLog([]);
              }}
            >
              Neu
            </Button>
          </div>
          <PackOpening
            key={`${set}-${run}`}
            set={set}
            cards={DEMO_PACK}
            artOf={sampleArt}
            evolvesFromNameOf={evolvesName}
            onReveal={(card, index) => setLog((lines) => [...lines, `${index + 1}: ${card.name}`])}
            pullValueOf={(_, index) => DEMO_PACK_VALUES[index]}
            packPriceCents={DEMO_PACK_PRICE}
          />
          <p className="mt-3 min-h-4 text-center text-xs text-fg-3" data-testid="nexamon-reveal-log">
            {log.join(" · ")}
          </p>
        </Block>
      </div>

      <RareRevealDemo />

      <Block label="Sofort an das Spiel (ADR-196): frisch gezogene Karten für 85 % verkaufen" testId="nexamon-instant">
        <InstantSell
          className="max-w-sm"
          items={[
            { copyId: "demo-instant-1", cardKey: "me-001", rarity: "common", valueCents: 1_245 },
            { copyId: "demo-instant-2", cardKey: "me-051", rarity: "rare", valueCents: 8_990 },
          ]}
        />
      </Block>

      <Block label="Platzhalter ohne Artwork: die elf Typen (CardThumb, Faktor 2)" testId="nexamon-types">
        <div className="flex flex-wrap justify-center gap-2">
          {TYPE_CARDS.map((card) => (
            <CardThumb key={card.key} card={card} scale={2} />
          ))}
        </div>
      </Block>

      <Block label="Echte Karten aus dem Katalog: je Set eine pro Seltenheit" testId="nexamon-real">
        <div className="flex flex-wrap justify-center gap-4">
          {REAL_CARDS.map((card) => (
            <NexamonCard key={card.key} card={card} scale={3} />
          ))}
        </div>
      </Block>

      <Block label="77 Karten als Raster (CardThumb, Faktor 1)" testId="nexamon-wall">
        <div className="flex flex-wrap justify-center gap-1">
          {NEXAMON_CARDS.slice(0, 77).map((card, i) => (
            <CardThumb key={card.key} card={card} scale={1} dimmed={i % 9 === 4} />
          ))}
        </div>
      </Block>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block label="Seltenheit und Zustand" testId="nexamon-badges">
          <div className="flex flex-wrap items-center gap-2">
            {NEXAMON_RARITIES.map((rarity) => (
              <RarityBadge key={rarity} rarity={rarity} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {NEXAMON_CONDITIONS.map((condition) => (
              <ConditionBadge key={condition} condition={condition} />
            ))}
          </div>
        </Block>
        <Block label="Typen und Sets" testId="nexamon-icons">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {NEXAMON_TYPES.map((type) => (
              <TypeIcon key={type} type={type} scale={3} label />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {NEXAMON_SETS.map((key) => (
              <SetIcon key={key} set={key} scale={3} label />
            ))}
          </div>
        </Block>
      </div>

      <Block label="Ohne Folie und ohne Bewegung (foil: none / still)" testId="nexamon-flat">
        <div className="flex flex-wrap items-start justify-center gap-3">
          <NexamonCardFace
            card={NEXAMON_SAMPLE_CARDS[2]!}
            art={art[NEXAMON_SAMPLE_CARDS[2]!.key]}
            scale={2}
            foil="none"
          />
          <NexamonCardFace
            card={NEXAMON_SAMPLE_CARDS[3]!}
            art={art[NEXAMON_SAMPLE_CARDS[3]!.key]}
            scale={2}
            foil="still"
          />
          <NexamonCardFace
            card={NEXAMON_SAMPLE_CARDS[4]!}
            art={art[NEXAMON_SAMPLE_CARDS[4]!.key]}
            scale={2}
            foil="still"
          />
        </div>
      </Block>

      <Block label="Bausteine der Nexamon-Seiten: Kennzahl, Note, Kopie, Angebot" testId="nexamon-parts">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Karten">30</Stat>
              <Stat label="Motive">27 / 231</Stat>
              <Stat label="Im Umlauf" hint="je gezogen">
                362
              </Stat>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <GradeChip grade={10} />
              <GradeChip grade={9} />
              <GradeChip grade={6} short />
              <CopyQuality copy={{ grade: null, condition: "near_mint" }} />
              <DealNote priceCents={900} valueCents={1000} />
              <DealNote priceCents={1100} valueCents={1000} />
              <DealNote priceCents={2000} valueCents={1000} />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <CopyVisual card={REAL_CARDS[0]!} scale={1} />
              <CopyVisual card={REAL_CARDS[1]!} scale={1} dimmed />
              <CopyVisual card={REAL_CARDS[2]!} grade={9} serial={12} scale={1} />
            </div>
            <SelectField
              label="Auswahlfeld"
              value={demoSort}
              onChange={setDemoSort}
              options={[
                { value: "number", label: "Nummer" },
                { value: "value", label: "Wert" },
              ]}
            />
            <dl className="divide-y divide-line-1 rounded-md bg-surface-2 px-3">
              <FactRow label="Wert der Kopie">12,00 €</FactRow>
              <FactRow label="Bei dir kommt an" strong>
                11,40 €
              </FactRow>
            </dl>
          </div>
          <ul className="divide-y divide-line-1 self-start rounded-lg border-2 border-line-1">
            {DEMO_LISTINGS.map((listing) => (
              <ListingRow key={listing.id} listing={listing} onBuy={() => undefined} />
            ))}
          </ul>
        </div>
      </Block>
      <Block label="Profil: Collectibles eines Spielers (hier die eigenen)" testId="nexamon-profile-block">
        <ProfileNexamon nickname={null} />
      </Block>
    </div>
  );
}

/** ADR-204: the big reveal of the last two slots on its own, per rarity (RareReveal, also for the Pack Battle). */
function RareRevealDemo() {
  const art = nexamonSampleArt();
  const [pick, setPick] = useState(RARE_DEMOS[RARE_DEMOS.length - 1]!.key);
  const [round, setRound] = useState(0);
  const [play, setPlay] = useState(false);
  const card = RARE_DEMOS.find((c) => c.key === pick) ?? RARE_DEMOS[0]!;
  const u = 3;
  return (
    <Block label="Großer Treffer (ADR-204): Aufladen, Umdrehen, Blitz, Konfetti, Wert" testId="nexamon-rare-reveal">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={pick}
          onValueChange={(value) => {
            setPick(value);
            setPlay(false);
            setRound((n) => n + 1);
          }}
          options={RARE_DEMOS.map((c) => ({ value: c.key, label: c.rarity.replace(/_/g, " ") }))}
          label="Seltenheit"
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setPlay(true)} disabled={play} data-testid="rare-reveal-play">
            Aufdecken
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setPlay(false);
              setRound((n) => n + 1);
            }}
          >
            Neu
          </Button>
        </div>
      </div>
      <div className="flex justify-center overflow-hidden py-10">
        <RareReveal
          key={`${pick}-${round}`}
          rarity={card.rarity}
          play={play}
          width={NEXAMON_CARD_SIZE.width * u}
          height={NEXAMON_CARD_SIZE.height * u}
          valueCents={card.rarity === "one_of_one" || card.rarity === "uranium" ? 2_500_000 : 48_000}
          front={<NexamonCardFace card={card} art={art[card.key]} scale={u} evolvesFromName={evolvesName(card)} />}
          back={<NexamonCardBack scale={u} />}
        />
      </div>
    </Block>
  );
}
