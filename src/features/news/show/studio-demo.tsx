"use client";

import { useEffect, useState } from "react";
import { ANCHOR_MOODS } from "@/components/pixel/news-art";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BALANCE } from "@/config/balance";
import {
  NewsStudio,
  segmentMood,
  speechDelayMs,
  type AnchorMood,
  type NewsStudioProps,
  type StudioSegment,
} from "./studio";

/*
 * A stand-in for the real show on /dev/ui: it plays standby → intro → three stories → outro on a local timer and
 * lets a reviewer jump to every state, give the anchor every mood and scrub through a scene (the intro montage shot
 * by shot). The real page gets the same props from the server clock.
 */

const CHARS_PER_SECOND = 28;
/** How long a finished story stays before the next one. */
const HOLD_MS = 4000;
const INTRO_MS = BALANCE.newsShow.introSeconds * 1000;

const SEGMENTS: StudioSegment[] = [
  {
    kind: "loser",
    headline: "Boersenfuchs_7 verbrennt 12.400 € mit Brezeln",
    text: "Liebe Zuschauer, schnallen Sie sich an. Boersenfuchs_7 hat heute alles auf Brotzeit gesetzt, kurz bevor die Aktie in den Keller gerauscht ist. 12.400 € weg! Mein Schnurrbart hat mehr Marktgefühl. Kopf hoch: Morgen ist auch noch ein Handelstag.",
    effects: [
      { label: "BRZ −12 %", tone: "loss" },
      { label: "Boersenfuchs_7 −12.400 €", tone: "loss" },
    ],
    figure: { nickname: "Boersenfuchs_7", avatarKey: "trader", accessories: ["party_hat"] },
  },
  {
    kind: "hype",
    headline: "KlarSoft liefert ein Update, das funktioniert",
    text: "Jubel in der Softwarebranche! KlarSoft hat ein Update veröffentlicht, das tatsächlich funktioniert. Die Anleger sind außer sich, die Aktie schießt nach oben. Experten sprechen von einem Wunder, die Entwickler von einem Versehen.",
    effects: [
      { label: "KLS +8 %", tone: "gain" },
      { label: "Tech +2 %", tone: "gain" },
    ],
  },
  {
    kind: "world",
    headline: "Kaffee wird knapp, die Büros zittern",
    text: "Und nun zur Weltlage. Eine Kaffeeknappheit erschüttert die Büros dieser Welt. Die Produktivität sinkt, die Laune auch. Nur die Teehändler reiben sich die Hände. Ich bleibe gelassen, ich habe vorgesorgt.",
    effects: [
      { label: "Handel −3 %", tone: "loss" },
      { label: "Logistik +4 %", tone: "gain" },
      { label: "Stimmung: müde", tone: "neutral" },
    ],
  },
];

/** Stories outside the loop: the longest text the show sends, and the kinds that came later. */
const EXTRAS = {
  /** About 320 characters, to check that the bubble holds it on a phone. */
  long: {
    kind: "scandal",
    headline: "Skandal bei der Dangle & Söhne GmbH: Der Chef zählt das Geld im Tresor doppelt",
    text: "Ein Skandal, meine Damen und Herren, wie ihn dieses Studio noch nicht gesehen hat! Bei der Dangle & Söhne GmbH wurde das Geld im Tresor jahrelang doppelt gezählt. Die Aktionäre toben, der Chef schweigt, und der Buchhalter ist seit Dienstag auf Dienstreise. Wohin? Das weiß nur sein Reisebüro. Wir bleiben für Sie dran.",
    effects: [
      { label: "DNG −21 %", tone: "loss" },
      { label: "Vertrauen −40", tone: "loss" },
      { label: "Reisebüros +3 %", tone: "gain" },
    ],
  },
  nft: {
    kind: "nft",
    headline: "„Brezel im Mondlicht“ wechselt für 48.000 € den Besitzer",
    text: "Ein Bild von einer Brezel. Im Mondlicht. Für 48.000 €. Ich lese das jetzt zum dritten Mal vor und verstehe es immer noch nicht. Die Künstlerin kassiert bei jedem Weiterverkauf mit, und ich male ab morgen auch.",
    effects: [{ label: "Pixel-Kunst +9 %", tone: "gain" }],
  },
  gossip: {
    kind: "gossip",
    headline: "Aus gut unterrichteten Kreisen: Dax_Dieter zieht um",
    text: "Unter uns: Dax_Dieter hat sich eine Villa gekauft, obwohl sein Depot seit Tagen rot leuchtet. Woher das Geld kommt? Mein Schnurrbart hat da eine Vermutung, aber der redet nicht mit der Presse.",
    effects: [{ label: "Dax_Dieter: neue Adresse", tone: "neutral" }],
    figure: { nickname: "Dax_Dieter", avatarKey: "punk", accessories: [] },
  },
  ramble: {
    kind: "ramble",
    headline: "Mr. Doodle Dangle verliert kurz den Faden",
    text: "Wussten Sie eigentlich, dass ein Tintenfisch drei Herzen hat? Drei! Und trotzdem ist er nie an der Börse. Wo war ich? Ach ja, die Nachrichten. Gleich geht es weiter, sobald ich meinen Zettel wiederfinde.",
    effects: [],
  },
  cards: {
    kind: "cards",
    headline: "Nur eine 3 für Dax_Dieter",
    text: "Dax_Dieter hat 450 € bezahlt, damit Profis Mondqualle begutachten. Das Urteil von ASP: Note 3. Im Gutachten steht das Wort „Kaffeerand“. Zweimal.",
    effects: [{ label: "+100 € Schmerzensgeld", tone: "gain" }],
    figure: { nickname: "Dax_Dieter", avatarKey: "punk", accessories: [] },
  },
  tax: {
    kind: "tax",
    headline: "Kuckuck! Dangle & Söhne wird gepfändet",
    text: "Mahnung ignoriert, Frist verpasst: Bei Dangle & Söhne vollstreckt jetzt das Amt, und Dax_Dieter lernt das Wort Zwangseinzug. Griesgram kam persönlich, mit Aktentasche und einer Thermoskanne voller Genugtuung.",
    effects: [],
    figure: { nickname: "Dax_Dieter", avatarKey: "punk", accessories: [] },
  },
  corp: {
    kind: "corp",
    headline: "Kündigungswelle bei Dangle & Söhne",
    text: "Bei Dangle & Söhne haben heute 7 Leute hingeschmissen. Dax_Dieter nennt das eine natürliche Verschlankung. Sogar die Zimmerpflanze hat sich versetzen lassen.",
    effects: [],
  },
} as const satisfies Record<string, StudioSegment>;

type Extra = keyof typeof EXTRAS;
type Phase = "off" | "standby" | "intro" | "story-0" | "story-1" | "story-2" | Extra | "outro";

const LOOP: Phase[] = ["standby", "intro", "story-0", "story-1", "story-2", "outro"];
const BUTTONS: { phase: Phase; label: string }[] = [
  { phase: "standby", label: "Standby" },
  { phase: "intro", label: "Intro" },
  { phase: "story-0", label: "Meldung 1" },
  { phase: "story-1", label: "Meldung 2" },
  { phase: "story-2", label: "Meldung 3" },
  { phase: "long", label: "Lange Meldung" },
  { phase: "nft", label: "NFT" },
  { phase: "gossip", label: "Klatsch" },
  { phase: "ramble", label: "Abschweifung" },
  { phase: "cards", label: "Sammelkarten" },
  { phase: "tax", label: "Finanzamt" },
  { phase: "corp", label: "Börsenfirma" },
  { phase: "outro", label: "Outro" },
  { phase: "off", label: "Aus" },
];

const MOOD_LABELS: Record<AnchorMood, string> = {
  neutral: "Neutral",
  shocked: "Schock",
  crying: "Weinen",
  laughing: "Lachen",
  angry: "Wut",
  smug: "Süffisant",
  confused: "Verwirrt",
  proud: "Stolz",
};

function isExtra(phase: Phase): phase is Extra {
  return Object.hasOwn(EXTRAS, phase);
}

function storyOf(phase: Phase): StudioSegment | null {
  if (isExtra(phase)) return EXTRAS[phase];
  const match = /^story-(\d)$/.exec(phase);
  return match ? (SEGMENTS[Number(match[1])] ?? null) : null;
}

function durationOf(phase: Phase, mood: AnchorMood | null): number {
  if (phase === "standby") return 14_000;
  if (phase === "intro") return INTRO_MS;
  if (phase === "outro") return 7000;
  const story = storyOf(phase);
  if (!story) return Number.POSITIVE_INFINITY;
  const delay = speechDelayMs(mood ?? segmentMood(story));
  return delay + (story.text.length / CHARS_PER_SECOND) * 1000 + HOLD_MS;
}

interface DemoClock {
  phase: Phase;
  startedAt: number;
  now: number;
}

/** A clock that stands `elapsedMs` into `phase` right now. */
function clockAt(phase: Phase, elapsedMs = 0): DemoClock {
  const now = Date.now();
  return { phase, startedAt: now - elapsedMs, now };
}

export function NewsStudioDemo() {
  const [clock, setClock] = useState<DemoClock | null>(null);
  const [running, setRunning] = useState(true);
  const [replay, setReplay] = useState(false);
  /** null: the mood follows from the story. */
  const [mood, setMood] = useState<AnchorMood | null>(null);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock((current) => {
        if (!current) return { phase: "standby", startedAt: now, now };
        // A paused clock goes on where it stood.
        const startedAt = current.startedAt + Math.max(0, now - current.now - 250);
        if (now - startedAt < durationOf(current.phase, mood)) return { ...current, startedAt, now };
        const next = LOOP[(LOOP.indexOf(current.phase) + 1) % LOOP.length] ?? "standby";
        return { phase: next, startedAt: now, now };
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [running, mood]);

  const phase = clock?.phase ?? "off";
  const elapsed = clock ? clock.now - clock.startedAt : 0;
  const baseStory = storyOf(phase);
  const story = baseStory && mood ? { ...baseStory, mood } : baseStory;
  const mode: NewsStudioProps["mode"] =
    phase === "off" || phase === "standby" || phase === "intro" || phase === "outro" ? phase : "live";
  const length = durationOf(phase, mood);

  const jump = (next: Phase) => {
    setClock(clockAt(next));
    setRunning(next !== "off");
  };
  const pick = (next: AnchorMood | null) => {
    setMood(next);
    // Show the reaction from its start, on a story if none is on.
    jump(baseStory ? phase : "story-0");
  };
  const scrub = (ms: number) => {
    setRunning(false);
    setClock(clockAt(phase, ms));
  };

  return (
    <div className="space-y-4" data-testid="news-studio-demo" data-phase={phase}>
      <div className="flex flex-wrap items-center gap-2">
        {BUTTONS.map((button) => (
          <Button
            key={button.phase}
            size="sm"
            variant={phase === button.phase ? "primary" : "secondary"}
            onClick={() => jump(button.phase)}
          >
            {button.label}
          </Button>
        ))}
        <label className="flex items-center gap-2 text-sm text-fg-2">
          <Switch checked={running} onCheckedChange={setRunning} label="Uhr läuft" />
          Uhr läuft
        </label>
        <label className="flex items-center gap-2 text-sm text-fg-2">
          <Switch checked={replay} onCheckedChange={setReplay} label="Wiederholung" />
          Wiederholung
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Stimmung">
        <span className="text-sm text-fg-2">Stimmung</span>
        <Button size="sm" variant={mood === null ? "primary" : "secondary"} onClick={() => pick(null)}>
          Automatisch
        </Button>
        {ANCHOR_MOODS.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={mood === option ? "primary" : "secondary"}
            onClick={() => pick(option)}
          >
            {MOOD_LABELS[option]}
          </Button>
        ))}
      </div>
      {Number.isFinite(length) && (
        <label className="flex items-center gap-3 text-sm text-fg-2">
          <span className="shrink-0">Zeit in der Szene</span>
          <input
            type="range"
            min={0}
            max={Math.round(length)}
            step={50}
            value={Math.min(Math.round(length), Math.max(0, Math.round(elapsed)))}
            onChange={(event) => scrub(Number(event.target.value))}
            className="h-11 min-w-0 flex-1 accent-accent focus-ring"
            data-testid="news-studio-scrub"
          />
          <span className="w-16 shrink-0 text-right nums text-fg-3">{(Math.max(0, elapsed) / 1000).toFixed(1)} s</span>
        </label>
      )}
      <NewsStudio
        mode={mode}
        startsAt={phase === "standby" && clock ? clock.startedAt + durationOf("standby", null) : null}
        segment={story}
        segmentIndex={isExtra(phase) ? 3 : Math.max(0, LOOP.indexOf(phase) - 2)}
        segmentCount={isExtra(phase) ? 4 : SEGMENTS.length}
        elapsedMs={elapsed}
        charsPerSecond={CHARS_PER_SECOND}
        introMs={INTRO_MS}
        viewers={phase === "standby" ? 3 : 17}
        replay={replay}
      />
    </div>
  );
}
