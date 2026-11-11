"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import { ALL_PIXEL_ART, BEAR, BULL, COIN } from "@/components/pixel/art";
import { AVATAR_ART } from "@/components/pixel/avatars";
import { Mascot } from "@/components/pixel/mascot";
import { Avatar } from "@/components/ui/avatar";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { Delta } from "@/components/ui/delta";
import { burstConfetti, flyCoins } from "@/components/ui/effects";
import { EmptyState } from "@/components/ui/empty-state";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { BusinessCard } from "@/features/career/components/business-card";
import { SignaturePad } from "@/features/career/components/signature-pad";
import type { PlayerCard } from "@/features/game/types";
import { SpeechBubble } from "@/features/tutorial/components/speech-bubble";
import { useTutorial } from "@/features/tutorial/store";
import { resetDemoPlayer } from "@/features/game/demo-engine";
import { LevelCard } from "@/features/progression/components/level-card";
import { formatMoney, formatPrice } from "@/lib/format";
import { DURATION, SPRING, fadeUp, staggerContainer } from "@/lib/motion";
import { SOUND_NAMES, playSound } from "@/lib/sound";
import { useMountTime } from "@/lib/use-now";
import { useSettings } from "@/stores/settings";
import { cn } from "@/lib/utils";

const COLOR_GROUPS = [
  { title: "Flächen", tokens: ["bg-0", "bg-1", "bg-2", "bg-3"] },
  { title: "Text", tokens: ["fg-1", "fg-2", "fg-3"] },
  { title: "Linien", tokens: ["line-1", "line-2"] },
  { title: "Akzent", tokens: ["accent", "accent-strong", "accent-soft"] },
  { title: "Semantik", tokens: ["gain", "loss", "warn", "info", "gold"] },
] as const;

const SAMPLE_CARD: PlayerCard = {
  nickname: "Boersenfuchs_7",
  avatarKey: "analyst",
  level: 23,
  rank: 42,
  netWorthCents: 18_450_000_00,
  streakDays: 12,
  skillsLearned: 14,
  branchScores: { it: 12, finance: 9, law: 0, craft: 0, sales: 4, management: 3, science: 0, logistics: 0 },
  topSkills: [{ key: "it_cloud", tier: 4 }],
  job: {
    companyName: "KlarSoft AG",
    titleKey: "it_team_lead",
    title: null,
    tier: "team_lead",
    since: "2026-10-01T00:00:00Z",
  },
  company: null,
  memberSince: "2026-09-01T00:00:00Z",
};

const money = (value: number) => formatMoney(Math.round(value));
const price = (value: number) => formatPrice(Math.round(value));

function Section({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-10 scroll-mt-6">
      <h2 id={`${id}-title`} className="mb-4 font-pixel text-base text-fg-1 uppercase">
        {title}
      </h2>
      <div className={className}>{children}</div>
    </section>
  );
}

function Demo({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Card padding="lg" className="flex flex-col">
      <p className="mb-4 label-pixel text-fg-3">{label}</p>
      <div className={cn("flex flex-1 flex-wrap items-center gap-3", className)}>{children}</div>
    </Card>
  );
}

export function Showcase() {
  const t = useTranslations("showcase");
  const settings = useSettings();
  const [buttonState, setButtonState] = useState<ButtonState>("idle");
  const [balance, setBalance] = useState(1_284_250);
  const [quote, setQuote] = useState(1_126_400);
  const [loaded, setLoaded] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [range, setRange] = useState("1T");
  const [toggle, setToggle] = useState(true);
  const [progress, setProgress] = useState(0.35);
  const [shake, setShake] = useState(0);
  const [items, setItems] = useState(["KLS", "VLT", "BRZ", "NPH"]);
  const [bubble, setBubble] = useState(0);
  const router = useRouter();
  const coinFrom = useRef<HTMLDivElement>(null);
  const coinTo = useRef<HTMLDivElement>(null);
  const now = useMountTime();

  const runButton = () => {
    setButtonState("loading");
    window.setTimeout(() => setButtonState("success"), 1200);
    window.setTimeout(() => setButtonState("idle"), 2400);
  };

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Segmented
          value={settings.theme}
          onValueChange={(value) => settings.set("theme", value)}
          label="Theme"
          size="sm"
          options={[
            { value: "dark", label: "Dunkel" },
            { value: "light", label: "Hell" },
          ]}
        />
        <Segmented
          value={settings.accent}
          onValueChange={(value) => settings.set("accent", value)}
          label="Akzent"
          size="sm"
          options={[
            { value: "violet", label: "Violett" },
            { value: "blue", label: "Blau" },
            { value: "pink", label: "Pink" },
            { value: "orange", label: "Orange" },
            { value: "cyan", label: "Cyan" },
          ]}
        />
      </div>

      <Section id="tokens" title={t("tokens")} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {COLOR_GROUPS.map((group) => (
          <Card key={group.title}>
            <p className="mb-3 label-pixel text-fg-3">{group.title}</p>
            <ul className="space-y-2">
              {group.tokens.map((name) => (
                <li key={name} className="flex items-center gap-3">
                  <span
                    className="size-8 shrink-0 rounded-xs border border-line-2"
                    style={{ background: `var(--${name})` }}
                  />
                  <code className="text-sm text-fg-2">--{name}</code>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </Section>

      <Section id="typography" title={t("typography")} className="grid gap-4 lg:grid-cols-2">
        <Card padding="lg" className="space-y-3">
          <p className="label-pixel text-fg-3">Inter · Fließtext und Zahlen</p>
          <p className="nums text-4xl font-semibold">12.842,50 €</p>
          <p className="text-2xl font-semibold">Volta Energie AG</p>
          <p className="text-lg">Quartalszahlen über den Erwartungen</p>
          <p className="text-fg-2">
            Der Umsatz stieg um 8,4 %, die Marge blieb stabil. Die Prognose für das nächste Quartal wurde angehoben.
          </p>
          <p className="text-sm text-fg-3">Kleingedrucktes und Hinweise, 13 px</p>
        </Card>
        <Card padding="lg" className="space-y-3">
          <p className="label-pixel text-fg-3">Silkscreen · Überschriften, Labels, Buttons</p>
          <p className="font-pixel text-2xl uppercase">Level 12 erreicht</p>
          <p className="font-pixel text-base uppercase">Börse geöffnet</p>
          <p className="label-pixel text-fg-2">Tägliche Missionen · Größe · Übernahme</p>
          <div className="flex flex-wrap gap-2">
            <Badge>VLT</Badge>
            <Badge tone="accent">Neu</Badge>
            <Badge tone="gain">Gewinn</Badge>
            <Badge tone="loss">Margin Call</Badge>
            <Badge tone="warn">Sperrfrist</Badge>
            <Badge tone="info">IPO</Badge>
          </div>
        </Card>
      </Section>

      <Section id="buttons" title={t("buttons")} className="grid gap-4 lg:grid-cols-2">
        <Demo label="Varianten">
          <Button>Primär</Button>
          <Button variant="secondary">Sekundär</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="gain">Kaufen</Button>
          <Button variant="loss">Verkaufen</Button>
          <Button variant="danger">Löschen</Button>
        </Demo>
        <Demo label="Größen und Zustände">
          <Button size="sm">Klein</Button>
          <Button>Mittel</Button>
          <Button size="lg">Groß</Button>
          <Button disabled>Deaktiviert</Button>
          <Button state="loading">Lädt</Button>
          <Button state="success">Fertig</Button>
        </Demo>
        <Demo label="Laden → Erfolg (antippen)">
          <Button state={buttonState} onClick={runButton} className="min-w-44">
            Order senden
          </Button>
        </Demo>
        <Demo label="Zum Kaufen halten" className="flex-col items-stretch">
          <HoldButton onConfirm={() => toast.success("Order ausgeführt", "10 × VLT für 1.127,40 €")}>
            Zum Kaufen halten
          </HoldButton>
          <HoldButton tone="loss" onConfirm={() => toast.info("Verkauf bestätigt")}>
            Zum Verkaufen halten
          </HoldButton>
        </Demo>
      </Section>

      <Section id="numbers" title={t("numbers")} className="grid gap-4 lg:grid-cols-3">
        <Demo label="Number Ticker" className="flex-col items-start">
          <NumberTicker value={balance} format={money} className="text-3xl font-semibold" />
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setBalance((v) => v + 123_450)}>
              + 1.234,50 €
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBalance((v) => Math.max(0, v - 80_000))}>
              − 800 €
            </Button>
          </div>
        </Demo>
        <Demo label="Kurs mit Aufblitzen" className="flex-col items-start">
          <div className="flex items-baseline gap-3">
            <NumberTicker value={quote} format={price} flash className="px-1 text-3xl font-semibold" />
            <Delta bps={Math.round(((quote - 1_104_000) / 1_104_000) * 10_000)} pill />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="gain" onClick={() => setQuote((v) => Math.round(v * 1.012))}>
              Kurs rauf
            </Button>
            <Button size="sm" variant="loss" onClick={() => setQuote((v) => Math.round(v * 0.988))}>
              Kurs runter
            </Button>
          </div>
        </Demo>
        <Demo label="Veränderung und Countdown" className="flex-col items-start">
          <div className="flex gap-4">
            <Delta bps={208} />
            <Delta bps={-142} />
            <Delta bps={0} />
          </div>
          <div className="flex gap-2">
            <Delta bps={1840} pill />
            <Delta bps={-720} pill />
          </div>
          <p className="text-fg-2">
            Zinsentscheid in{" "}
            {now === null ? (
              <span className="nums">--:--</span>
            ) : (
              <Countdown target={now + 4_520_000} className="font-semibold text-fg-1" />
            )}
          </p>
        </Demo>
      </Section>

      <Section id="cards" title={t("cards")} className="grid gap-4 lg:grid-cols-3">
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Statische Karte</CardTitle>
          </CardHeader>
          <p className="text-fg-2">Fläche auf Ebene 1 mit feiner Linie. Für Inhalte ohne eigene Aktion.</p>
        </Card>
        <Card padding="lg" interactive tabIndex={0} className="cursor-pointer focus-ring">
          <CardHeader>
            <CardTitle>Interaktive Karte</CardTitle>
          </CardHeader>
          <p className="text-fg-2">Hebt sich beim Hover an und gibt beim Drücken nach.</p>
        </Card>
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Gestaffelt und sortierbar</CardTitle>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setItems((list) => [...list].sort(() => Math.random() - 0.5))}
            >
              Mischen
            </Button>
          </CardHeader>
          <motion.ul
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="space-y-2"
          >
            {items.map((item) => (
              <motion.li
                key={item}
                layout
                variants={fadeUp}
                transition={SPRING.smooth}
                className="rounded-sm bg-surface-2 px-3 py-2 font-pixel text-xs"
              >
                {item}
              </motion.li>
            ))}
          </motion.ul>
        </Card>
      </Section>

      <Section id="skeletons" title={t("skeletons")} className="grid gap-4 lg:grid-cols-2">
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Liste</CardTitle>
            <Button size="sm" variant="secondary" onClick={() => setLoaded((v) => !v)}>
              {loaded ? "Laden zeigen" : "Inhalt zeigen"}
            </Button>
          </CardHeader>
          {loaded ? (
            <motion.ul variants={staggerContainer} initial="hidden" animate="visible">
              {["Volta Energie AG", "KlarSoft AG", "Brotzeit Handel AG"].map((name, i) => (
                <motion.li key={name} variants={fadeUp} className="flex items-center gap-3 py-2.5">
                  <PixelIcon {...Object.values(ALL_PIXEL_ART)[5 + i]!} scale={2} />
                  <span className="flex-1 font-medium">{name}</span>
                  <Delta bps={[208, 124, 31][i]!} />
                </motion.li>
              ))}
            </motion.ul>
          ) : (
            <div>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          )}
        </Card>
        <Card padding="lg" className="space-y-3">
          <p className="label-pixel text-fg-3">Karte mit Chart</p>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-36 w-full rounded-md" />
        </Card>
      </Section>

      <Section id="toasts" title={t("toasts")}>
        <Demo label="Gestapelt, wischbar">
          <Button variant="secondary" onClick={() => toast.success("Order ausgeführt", "10 × VLT zu 112,64 €")}>
            Erfolg
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.error("Order abgelehnt", "Dafür reicht dein Guthaben nicht.")}
          >
            Fehler
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.warn("Margin Call", "Deine Position in QSL nähert sich dem Liquidationspreis.")}
          >
            Warnung
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.info("Quartalszahlen", "Volta Energie berichtet in 10 Minuten.")}
          >
            Info
          </Button>
        </Demo>
      </Section>

      <Section id="sheet" title={t("sheet")} className="grid gap-4 lg:grid-cols-2">
        <Demo label="Handy: von unten, wischbar · PC: Seitenpanel">
          <Button onClick={() => setSheet(true)}>Sheet öffnen</Button>
        </Demo>
        <Demo label="Tabs und Auswahl" className="flex-col items-start">
          <Segmented
            value={range}
            onValueChange={setRange}
            label="Zeitraum"
            options={["1T", "1W", "1M", "1J", "Max"].map((value) => ({ value, label: value }))}
          />
          <div className="flex items-center gap-3">
            <Switch checked={toggle} onCheckedChange={setToggle} label="Beispielschalter" />
            <span className="text-fg-2">{toggle ? "An" : "Aus"}</span>
          </div>
        </Demo>
      </Section>
      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="VLT kaufen"
        description="Market-Order zum aktuellen Kurs"
        footer={
          <HoldButton
            onConfirm={() => {
              setSheet(false);
              toast.success("Order ausgeführt");
            }}
          >
            Zum Kaufen halten
          </HoldButton>
        }
      >
        <Field label="Stückzahl" defaultValue="10" inputMode="numeric" hint="Ganze Aktien, mindestens 1" />
        <dl className="mt-5 space-y-3 text-fg-2">
          <div className="flex justify-between">
            <dt>Orderwert</dt>
            <dd className="nums text-fg-1">1.126,40 €</dd>
          </div>
          <div className="flex justify-between">
            <dt>Ordergebühr</dt>
            <dd className="nums text-fg-1">1,00 €</dd>
          </div>
        </dl>
      </Sheet>

      <Section id="forms" title={t("forms")} className="grid gap-4 lg:grid-cols-3">
        <Card padding="lg">
          <Field label="Spielername" placeholder="z. B. Boersenfuchs" hint="3 bis 20 Zeichen" />
        </Card>
        <Card padding="lg">
          <Field label="Limit-Preis" defaultValue="abc" error="Gib einen Betrag in Euro ein." />
        </Card>
        <Card padding="lg">
          <Field label="Deaktiviert" defaultValue="KlarSoft AG" disabled className="opacity-50" />
        </Card>
      </Section>

      <Section id="feedback" title={t("feedback")} className="grid gap-4 lg:grid-cols-3">
        <LevelCard showcase />
        <Demo label="Münzen und Konfetti" className="flex-col items-stretch">
          <div className="flex items-center justify-between">
            <div ref={coinFrom} className="grid size-14 place-items-center rounded-md bg-surface-2">
              <PixelIcon {...COIN} scale={2} />
            </div>
            <div ref={coinTo} className="rounded-sm bg-surface-2 px-3 py-2 label-pixel text-fg-2">
              Konto
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              if (coinFrom.current) flyCoins(coinFrom.current, coinTo.current);
              void playSound("coin");
            }}
          >
            Tresor leeren
          </Button>
          <Button
            variant="secondary"
            onClick={(event) => {
              burstConfetti(event.currentTarget);
              void playSound("levelUp");
            }}
          >
            Großer Gewinn
          </Button>
        </Demo>
        <Card padding="lg" className="relative overflow-hidden">
          <p className="mb-4 label-pixel text-fg-3">Margin Call und Fortschritt</p>
          <div key={shake} className={cn("relative rounded-md bg-surface-2 p-4", shake > 0 && "animate-shake")}>
            {shake > 0 && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 animate-pulse-danger rounded-md border-2 border-loss"
              />
            )}
            <p className="font-medium">QSL · Hebel 5×</p>
            <p className="nums text-sm text-loss">Liquidation bei 0,6120 €</p>
          </div>
          <Button
            variant="danger"
            size="sm"
            className="mt-3"
            onClick={() => {
              setShake((v) => v + 1);
              void playSound("warning");
            }}
          >
            Warnung auslösen
          </Button>
          <Progress value={progress} label="Beispiel" className="mt-5" />
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={() => setProgress((v) => (v >= 1 ? 0.1 : Math.min(1, v + 0.25)))}
          >
            Fortschritt
          </Button>
        </Card>
      </Section>

      <Section id="empty" title={t("empty")} className="grid gap-4 lg:grid-cols-2">
        <Card>
          <EmptyState
            art={<PixelIcon {...BULL} scale={4} />}
            title="Noch keine Positionen"
            description="Kauf deine erste Aktie. Dein Startkapital wartet schon."
            action={<Button>Zu den Märkten</Button>}
          />
        </Card>
        <Card>
          <EmptyState
            art={<PixelIcon {...BEAR} scale={4} />}
            title="Watchlist ist leer"
            description="Beobachte Aktien, um ihre Kurse hier im Blick zu behalten."
            action={<Button variant="secondary">Aktien entdecken</Button>}
          />
        </Card>
      </Section>

      <Section id="mascot" title={t("mascot")} className="grid gap-4 lg:grid-cols-2">
        <Demo label="Finn, der Börsenfuchs: ruhig, sprechend, jubelnd" className="justify-around">
          <Mascot mood="idle" scale={6} />
          <Mascot mood="talk" scale={6} />
          <Mascot key={shake} mood="happy" scale={6} />
        </Demo>
        <Card padding="lg">
          <p className="mb-4 label-pixel text-fg-3">Sprechblase und Tutorial</p>
          <SpeechBubble
            key={bubble}
            name="Finn"
            text="Hi, ich bin Finn! Ich erkläre neuen Spielern in zwei Minuten, wie die Börse läuft."
            footer={
              <>
                <Button size="sm" variant="secondary" onClick={() => setBubble((v) => v + 1)}>
                  Nochmal
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    // Demo: also forget the demo player, so the tutorial reward counts again.
                    resetDemoPlayer();
                    useTutorial.getState().restart();
                    router.push("/");
                  }}
                >
                  Tutorial neu starten
                </Button>
              </>
            }
          />
        </Card>
      </Section>

      <Section id="career" title={t("career")} className="grid gap-4 lg:grid-cols-2">
        <Demo label="Profilbilder (16×16, ganzzahlig skaliert)" className="flex-wrap justify-start gap-2">
          {Object.keys(AVATAR_ART).map((key) => (
            <Avatar key={key} avatarKey={key} size="sm" title={key} />
          ))}
        </Demo>
        <BusinessCard card={SAMPLE_CARD} />
        <Card padding="lg">
          <SignaturePad onChange={() => undefined} />
        </Card>
      </Section>

      <Section id="sounds" title={t("sounds")}>
        <Demo label="Alle Effekte (Ton in den Einstellungen an)">
          {SOUND_NAMES.map((name) => (
            <Button key={name} size="sm" variant="secondary" onClick={() => void playSound(name)}>
              {name}
            </Button>
          ))}
        </Demo>
      </Section>

      <Section id="pixel" title={t("pixel")}>
        <Card padding="lg">
          <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-5 lg:grid-cols-10">
            {Object.entries(ALL_PIXEL_ART).map(([name, art]) => (
              <li key={name} className="flex flex-col items-center gap-2 text-fg-1">
                <span className="grid size-16 place-items-center rounded-md bg-surface-2">
                  <PixelIcon {...art} scale={art.grid.length === 12 ? 2 : 3} title={name} />
                </span>
                <code className="text-xs text-fg-3">{name}</code>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section id="motion" title={t("motion")} className="grid gap-4 lg:grid-cols-2">
        <Card padding="lg">
          <p className="mb-4 label-pixel text-fg-3">Dauern (Hover über die Balken)</p>
          <ul className="space-y-3">
            {(Object.entries(DURATION) as [string, number][]).map(([name, seconds]) => (
              <li key={name} className="group flex items-center gap-3">
                <code className="w-40 shrink-0 text-sm text-fg-2">
                  {name} · {Math.round(seconds * 1000)} ms
                </code>
                <span className="h-2 flex-1 overflow-hidden rounded-xs bg-surface-3">
                  <span
                    className="block h-full w-full origin-left scale-x-[0.15] bg-accent transition-transform ease-out group-hover:scale-x-100"
                    style={{ transitionDuration: `${seconds * 1000}ms` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card padding="lg">
          <p className="mb-4 label-pixel text-fg-3">Springs (antippen)</p>
          <div className="flex gap-4">
            {(Object.keys(SPRING) as (keyof typeof SPRING)[]).map((name) => (
              <motion.button
                key={name}
                type="button"
                whileTap={{ scale: 0.8, rotate: -6 }}
                transition={SPRING[name]}
                className="grid size-24 place-items-center rounded-lg bg-accent-soft label-pixel text-accent focus-ring"
              >
                {name}
              </motion.button>
            ))}
          </div>
        </Card>
      </Section>
    </>
  );
}
