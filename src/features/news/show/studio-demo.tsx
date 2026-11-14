"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { NewsStudio, type NewsStudioProps, type StudioSegment } from "./studio";

/*
 * A stand-in for the real show on /dev/ui: it plays standby → intro → three stories → outro on a local timer and
 * lets a reviewer jump to every state. The real page gets the same props from the server clock.
 */

const CHARS_PER_SECOND = 28;
/** How long a finished story stays before the next one. */
const HOLD_MS = 4000;

const SEGMENTS: StudioSegment[] = [
  {
    kind: "loser",
    headline: "Boersenfuchs_7 verbrennt 12.400 € mit Brezeln",
    text: "Liebe Zuschauer, schnallen Sie sich an. Boersenfuchs_7 hat heute alles auf Brotzeit gesetzt, kurz bevor die Aktie in den Keller gerauscht ist. 12.400 € weg! Mein Schnurrbart hat mehr Marktgefühl. Kopf hoch: Morgen ist auch noch ein Handelstag.",
    effects: [
      { label: "BRZ −12 %", tone: "loss" },
      { label: "Boersenfuchs_7 −12.400 €", tone: "loss" },
    ],
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

/** The longest text the show sends (about 320 characters), to check that the bubble holds it on a phone. */
const LONG_SEGMENT: StudioSegment = {
  kind: "scandal",
  headline: "Skandal bei der Dangle & Söhne GmbH: Der Chef zählt das Geld im Tresor doppelt",
  text: "Ein Skandal, meine Damen und Herren, wie ihn dieses Studio noch nicht gesehen hat! Bei der Dangle & Söhne GmbH wurde das Geld im Tresor jahrelang doppelt gezählt. Die Aktionäre toben, der Chef schweigt, und der Buchhalter ist seit Dienstag auf Dienstreise. Wohin? Das weiß nur sein Reisebüro. Wir bleiben für Sie dran.",
  effects: [
    { label: "DNG −21 %", tone: "loss" },
    { label: "Vertrauen −40", tone: "loss" },
    { label: "Reisebüros +3 %", tone: "gain" },
  ],
};

type Phase = "off" | "standby" | "intro" | "story-0" | "story-1" | "story-2" | "long" | "outro";

const LOOP: Phase[] = ["standby", "intro", "story-0", "story-1", "story-2", "outro"];
const BUTTONS: { phase: Phase; label: string }[] = [
  { phase: "standby", label: "Standby" },
  { phase: "intro", label: "Intro" },
  { phase: "story-0", label: "Meldung 1" },
  { phase: "story-1", label: "Meldung 2" },
  { phase: "story-2", label: "Meldung 3" },
  { phase: "long", label: "Lange Meldung" },
  { phase: "outro", label: "Outro" },
  { phase: "off", label: "Aus" },
];

function storyOf(phase: Phase): StudioSegment | null {
  if (phase === "long") return LONG_SEGMENT;
  const match = /^story-(\d)$/.exec(phase);
  return match ? (SEGMENTS[Number(match[1])] ?? null) : null;
}

function durationOf(phase: Phase): number {
  if (phase === "standby") return 14_000;
  if (phase === "intro") return 4500;
  if (phase === "outro") return 7000;
  const story = storyOf(phase);
  return story ? (story.text.length / CHARS_PER_SECOND) * 1000 + HOLD_MS : Number.POSITIVE_INFINITY;
}

interface DemoClock {
  phase: Phase;
  startedAt: number;
  now: number;
}

export function NewsStudioDemo() {
  const [clock, setClock] = useState<DemoClock | null>(null);
  const [running, setRunning] = useState(true);
  const [replay, setReplay] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock((current) => {
        if (!current) return { phase: "standby", startedAt: now, now };
        if (now - current.startedAt < durationOf(current.phase)) return { ...current, now };
        const next = LOOP[(LOOP.indexOf(current.phase) + 1) % LOOP.length] ?? "standby";
        return { phase: next, startedAt: now, now };
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [running]);

  const phase = clock?.phase ?? "off";
  const elapsed = clock ? clock.now - clock.startedAt : 0;
  const story = storyOf(phase);
  const mode: NewsStudioProps["mode"] =
    phase === "off" || phase === "standby" || phase === "intro" || phase === "outro" ? phase : "live";

  return (
    <div className="space-y-4" data-testid="news-studio-demo" data-phase={phase}>
      <div className="flex flex-wrap items-center gap-2">
        {BUTTONS.map((button) => (
          <Button
            key={button.phase}
            size="sm"
            variant={phase === button.phase ? "primary" : "secondary"}
            onClick={() => {
              const now = Date.now();
              setClock({ phase: button.phase, startedAt: now, now });
              setRunning(button.phase !== "off");
            }}
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
      <NewsStudio
        mode={mode}
        startsAt={phase === "standby" && clock ? clock.startedAt + durationOf("standby") : null}
        segment={story}
        segmentIndex={phase === "long" ? 3 : Math.max(0, LOOP.indexOf(phase) - 2)}
        segmentCount={phase === "long" ? 4 : SEGMENTS.length}
        elapsedMs={elapsed}
        charsPerSecond={CHARS_PER_SECOND}
        viewers={phase === "standby" ? 3 : 17}
        replay={replay}
      />
    </div>
  );
}
