# Design-System

Referenz für alles Sichtbare. Die lebende Fassung ist die Showcase-Seite **`/dev/ui`**: Dort sind alle
Komponenten mit ihren Zuständen zu sehen, in beiden Themes und mit allen Akzentfarben.

## Inhalt

1. [Stilprinzip](#1-stilprinzip)
2. [Tokens](#2-tokens)
3. [Typografie](#3-typografie)
4. [Komponenten](#4-komponenten)
5. [Motion](#5-motion)
6. [Pixel-Art](#6-pixel-art)
7. [Layout und Navigation](#7-layout-und-navigation)
8. [Barrierefreiheit](#8-barrierefreiheit)
9. [Sound und Haptik](#9-sound-und-haptik)
10. [Checkliste für neue Screens](#10-checkliste-für-neue-screens)

---

## 1. Stilprinzip

Zwei Ebenen, die sich nicht vermischen:

| Ebene              | Aussehen                                                                     | Wo                                                                   |
| ------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Daten**          | Ruhig und glatt: Inter, große Zahlen, viel Raum, feine Linien, weiche Charts | Kurse, Beträge, Tabellen, Fließtext, Formulare                       |
| **Persönlichkeit** | Pixel-Art und Pixelschrift, harte Kanten                                     | Logos, Icons, Abzeichen, Überschriften, Labels, Buttons, Belohnungen |

Faustregel: Alles, was man **liest oder vergleicht**, ist clean. Alles, was man **erkennt oder feiert**, ist Pixel.
Eine Zahl steht nie in der Pixelschrift.

NEXA hat eine eigene Identität. Keine Logos, Namen, Farbschemata oder Markenelemente anderer Apps übernehmen.

## 2. Tokens

Quelle: [`src/styles/tokens.css`](../src/styles/tokens.css) (CSS-Variablen). In
[`src/app/globals.css`](../src/app/globals.css) werden daraus über `@theme inline` Tailwind-Utilities.
Die Standardpalette von Tailwind ist **entfernt**: `bg-zinc-900` oder `text-red-500` existieren nicht.
Wer eine Farbe braucht, die es nicht gibt, ergänzt ein Token und nicht einen Hex-Wert im Bauteil.

### Farben

| Token                                          | Utility                                             | Zweck                                           |
| ---------------------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| `--bg-0`                                       | `bg-bg`                                             | Seitenhintergrund                               |
| `--bg-1`                                       | `bg-surface-1`                                      | Karten, Seitenleiste, Sheets                    |
| `--bg-2`                                       | `bg-surface-2`                                      | Erhöhte Flächen in Karten, Eingabefelder, Hover |
| `--bg-3`                                       | `bg-surface-3`                                      | Aktive Auswahl, Skeletons, Fortschritts-Schiene |
| `--fg-1`                                       | `text-fg-1`                                         | Haupttext, Zahlen                               |
| `--fg-2`                                       | `text-fg-2`                                         | Sekundärtext                                    |
| `--fg-3`                                       | `text-fg-3`                                         | Labels, Hinweise, Platzhalter                   |
| `--line-1`, `--line-2`                         | `border-line-1`, `border-line-2`                    | Feine und betonte Linien                        |
| `--accent`, `--accent-strong`, `--accent-soft` | `text-accent`, `bg-accent-strong`, `bg-accent-soft` | Aktionen, aktive Navigation, Fokus              |
| `--gain`, `--gain-soft`                        | `text-gain`, `bg-gain-soft`                         | Gewinn, Kaufen, steigende Kurse                 |
| `--loss`, `--loss-soft`                        | `text-loss`, `bg-loss-soft`                         | Verlust, Verkaufen, fallende Kurse, Fehler      |
| `--warn`, `--info` (+ `-soft`)                 | `text-warn`, `text-info`                            | Warnungen (Margin, Sperrfrist), Hinweise        |
| `--gold`                                       | `bg-gold`                                           | Münzen, Tresor, Belohnungen                     |
| `--on-accent`, `--on-semantic`                 | `text-on-accent`, `text-on-semantic`                | Text auf gefüllten Buttons                      |

Semantik ist fest: **Grün heißt Gewinn, Rot heißt Verlust.** Die Akzentfarbe ist deshalb nie grün oder rot.
Farbe trägt Information nie allein: Veränderungen haben zusätzlich Vorzeichen und Pfeil.

**Themes:** Dunkel ist Standard (`data-theme="dark"`), Hell ist gleichwertig (`data-theme="light"`).
**Akzent:** Violett (Standard), Blau, Pink, Orange, Cyan über `data-accent` am `<html>`.
Ein Inline-Skript im Root-Layout setzt beide Attribute vor dem ersten Paint, damit nichts aufblitzt.

Die Kontraste aller Text- und Semantikfarben gegen `bg-0` bis `bg-2` werden in
[`src/styles/tokens.test.ts`](../src/styles/tokens.test.ts) automatisch gegen **WCAG AA (4,5:1)** geprüft.
Ein neues Token, das die Schwelle reißt, lässt den Test fehlschlagen.

### Abstände, Radien, Schatten, Ebenen

| Gruppe   | Werte                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Abstände | 4er-Raster über die Tailwind-Skala (`p-1` = 4 px, `gap-3` = 12 px, `p-5` = 20 px). Keine krummen Werte                                 |
| Radien   | `rounded-xs` 4, `-sm` 8, `-md` 12, `-lg` 16, `-xl` 24, `-pill`. Pixel-Elemente (Badges, Checkboxen, Logos) bleiben bei `xs` oder eckig |
| Schatten | `shadow-1` (Karten), `shadow-2` (Hover), `shadow-3` (Sheets, Toasts, Dialoge)                                                          |
| Ebenen   | `z-sticky` 10, `z-nav` 20, `z-overlay` 40, `z-sheet` 50, `z-toast` 60, `z-celebration` 70. Keine freien `z-[…]`-Werte                  |
| Layout   | `--sidebar-width` 248 px, `--tabbar-height` 64 px, `--topbar-height` 56 px, `--content-max` 1280 px, Safe-Area-Variablen               |

## 3. Typografie

| Schrift            | Einsatz                                | Quelle                                              |
| ------------------ | -------------------------------------- | --------------------------------------------------- |
| **Inter Variable** | Fließtext, Zahlen, Formulare           | `@fontsource-variable/inter` (OFL), selbst gehostet |
| **Silkscreen**     | Überschriften, Labels, Badges, Buttons | `@fontsource/silkscreen` (OFL), selbst gehostet     |

Skala (Größe / Zeilenhöhe): `text-2xs` 11/16, `text-xs` 12/16, `text-sm` 13/18, `text-base` 15/22,
`text-lg` 17/24, `text-xl` 20/28, `text-2xl` 24/32, `text-3xl` 32/38, `text-4xl` 40/44.

- **Zahlen** bekommen immer die Utility `nums` (`tabular-nums`), damit beim Ticken nichts springt.
- **Labels** nutzen `label-pixel` (Silkscreen, 11 px, Versalien, leicht gesperrt).
- Pixelschrift nie für Fließtext und nie kleiner als 11 px.
- Texte stehen in `messages/de.json`, nicht im Code. Ausnahme: die Showcase-Seite.

## 4. Komponenten

Geteilte Bausteine liegen in `src/components/ui`, Feature-spezifische unter `src/features/<feature>/components`.

| Komponente                  | Datei                           | Zustände und Hinweise                                                                                                                                                                                                     |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                    | `ui/button.tsx`                 | Varianten `primary`, `secondary`, `ghost`, `gain`, `loss`, `danger`; Größen `sm`, `md`, `lg`, `icon`; `state="loading"` (Pixel-Loader) und `"success"` (Haken) ohne Breitensprung; Hover hebt an, Press skaliert auf 0,97 |
| `buttonVariants`            | `ui/button-variants.ts`         | Dieselben Klassen für Links (`<Link className={buttonVariants()}>`), auch in Server Components nutzbar                                                                                                                    |
| `HoldButton`                | `ui/hold-button.tsx`            | „Zum Kaufen halten“ mit Füllanimation für große oder gehebelte Orders; Maus, Touch und Leertaste/Enter                                                                                                                    |
| `Card`                      | `ui/card.tsx`                   | `interactive` für klickbare Karten (Anheben, stärkere Linie)                                                                                                                                                              |
| `NumberTicker`              | `ui/number-ticker.tsx`          | Zählt animiert; `flash` lässt den Wert grün oder rot aufblitzen. Schreibt direkt ins DOM, kein Re-Render pro Tick                                                                                                         |
| `Delta`                     | `ui/delta.tsx`                  | Veränderung in Basispunkten mit Pfeil und Farbe, optional als Pille                                                                                                                                                       |
| `Skeleton`, `SkeletonRow`   | `ui/skeleton.tsx`               | Immer in der Form des späteren Inhalts. Keine Spinner, keine leeren Flächen                                                                                                                                               |
| `toast` / `Toaster`         | `ui/toast.tsx`                  | `toast.success/error/warn/info`; gestapelt (max. 3), wischbar, mit Sound und Haptik                                                                                                                                       |
| `Sheet`                     | `ui/sheet.tsx`                  | Handy: Bottom Sheet mit Wischgeste. Ab `lg`: Seitenpanel rechts. Fokusfalle und Escape inklusive                                                                                                                          |
| `Segmented`                 | `ui/segmented.tsx`              | Einfachauswahl (Zeiträume, Filter) mit gleitender Markierung                                                                                                                                                              |
| `Switch`, `Field`           | `ui/switch.tsx`, `ui/input.tsx` | Formularbausteine mit Label, Hinweis und Fehlertext für Screenreader                                                                                                                                                      |
| `Progress`                  | `ui/progress.tsx`               | XP, Tresor, Fortschritt; Füllung über `scaleX`                                                                                                                                                                            |
| `Countdown`                 | `ui/countdown.tsx`              | Restzeit bis zu einem Zeitpunkt, hydrationssicher                                                                                                                                                                         |
| `EmptyState`                | `ui/empty-state.tsx`            | Pixel-Illustration, Titel, ein Satz, eine Handlung                                                                                                                                                                        |
| `Badge`                     | `ui/badge.tsx`                  | Töne `neutral`, `accent`, `gain`, `loss`, `warn`, `info`                                                                                                                                                                  |
| `flyCoins`, `burstConfetti` | `ui/effects.tsx`                | Pixel-Münzen und Pixel-Konfetti auf einer festen Ebene über allem                                                                                                                                                         |
| `Page`, `PageHeader`        | `layout/page.tsx`               | Jede Seite steckt in `Page`: liefert den Seitenübergang                                                                                                                                                                   |

**Jede Interaktion bekommt Feedback:** Hover, Press, Fokus-Ring, Lade- und Erfolgszustand, deaktivierter Zustand.
Ein Bauteil ohne diese Zustände ist nicht fertig.

## 5. Motion

Tokens stehen doppelt und müssen synchron bleiben: als CSS-Variablen in `tokens.css` und als Konstanten für die
Motion-Bibliothek in [`src/lib/motion.ts`](../src/lib/motion.ts).

| Token     | Wert   | Einsatz                                |
| --------- | ------ | -------------------------------------- |
| `instant` | 80 ms  | Verzögerungen, Press-Feedback          |
| `fast`    | 150 ms | Hover, Farbwechsel, kleine Zustände    |
| `base`    | 200 ms | Standard für UI-Übergänge              |
| `slow`    | 300 ms | Einblenden von Karten, Seitenwechsel   |
| `slower`  | 450 ms | Number Ticker, Shared-Element-Übergang |
| `flash`   | 700 ms | Grün/Rot-Aufblitzen eines Kurses       |

| Easing     | Kurve                            | Einsatz                 |
| ---------- | -------------------------------- | ----------------------- |
| `standard` | `cubic-bezier(0.2, 0, 0, 1)`     | Zustandswechsel         |
| `out`      | `cubic-bezier(0.16, 1, 0.3, 1)`  | Alles, was erscheint    |
| `in`       | `cubic-bezier(0.5, 0, 0.9, 0.3)` | Alles, was verschwindet |
| `inOut`    | `cubic-bezier(0.65, 0, 0.35, 1)` | Bewegung von A nach B   |

| Spring   | Einsatz                                   |
| -------- | ----------------------------------------- |
| `snappy` | Tab-Indikator, Segmented, Icons           |
| `smooth` | Listen-Layout, Fortschrittsbalken, Sheets |
| `bouncy` | Belohnungen (darf überschwingen)          |

**Regeln**

1. Nur `transform` und `opacity` animieren. Ausnahme: das Farb-Aufblitzen von Kursen. Nie `width`, `height`,
   `top`, `left` oder `box-shadow` in Dauerschleife.
2. UI-Übergänge 150 bis 250 ms, größere Übergänge 300 bis 500 ms, physische Bewegung als Spring.
3. Erscheinen ist langsamer als Verschwinden.
4. Listen blenden gestaffelt ein (`staggerContainer` + `fadeUp`, 40 ms Versatz); Sortieren und Filtern
   nutzt Layout-Animationen (`layout` an `motion.li`).
5. Echtzeitdaten werden gebündelt: höchstens ein Render pro Animation-Frame, Zahlen über `NumberTicker`.
6. `prefers-reduced-motion` wird respektiert, und die Einstellung „Animationen“ (System, An, Reduziert) kann es
   übersteuern. Reduziert heißt: Dauern auf 0, keine Partikel, Zahlen springen direkt.

**Seitenübergänge** laufen über Reacts `<ViewTransition>` (Browser-API, keine zusätzliche Bibliothek):

- Tab-Wechsel: kurzes Fade-up (Klasse `page`).
- Liste → Detail: Link mit `transitionTypes={["nav-forward"]}`, zurück mit `["nav-back"]` (Slide in Leserichtung).
- Shared Element: Das Firmenlogo trägt in Liste und Detail denselben Namen (`logo-<TICKER>`) und gleitet an
  seine neue Position.

## 6. Pixel-Art

Technik: [`PixelIcon`](../src/components/pixel/pixel-icon.tsx) rendert ein Zeichenraster als SVG
(`shape-rendering: crispEdges`), ein Pfad je Farbe. Die Motive liegen als Daten in
[`src/components/pixel/art.ts`](../src/components/pixel/art.ts): eine Zeichenkette pro Zeile, ein Zeichen pro Pixel,
`.` ist transparent.

| Regel           | Wert                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| Rastergrößen    | 16×16 für Illustrationen und Logos, 12×12 für einfarbige Interface-Icons, 24×24 optional für große Motive |
| Skalierung      | Nur ganzzahlig (`scale={2}` = 2 CSS-Pixel pro Art-Pixel). 12er-Icons mit Faktor 2 ergeben 24 px           |
| Farben          | Höchstens 6 pro Motiv                                                                                     |
| Kontur          | Mittlerer Grauton (`#5d6679`), damit Motive auf dunklen **und** hellen Flächen lesbar sind                |
| Licht           | Von oben links: Glanzpunkt oben links, Schatten unten rechts                                              |
| Interface-Icons | Einfarbig mit `currentColor`, übernehmen also die Textfarbe (aktiv = Akzent)                              |
| Logos           | Füllen das Raster als farbige Kachel mit abgeschrägten Ecken                                              |

Ein Test (`art.test.ts`) prüft bei jedem Motiv Rastergröße, Zeilenlängen, Palette und Farbanzahl.

**Erstes Set (M0):** 5 Branchen-Icons (Tech, Handel, Energie, Pharma, Logistik), 3 Firmenlogos
(Volta Energie, Brotzeit Handel, KlarSoft), Münze, Stier, Bär, 8 Interface-Icons (5 Tabs, Schloss, Suche, Glocke).
Firmen ohne gezeichnetes Logo zeigen eine Kachel in Firmenfarbe mit Kürzel.

**Offen für später:** die übrigen 12 Firmenlogos (M1), Abzeichen für Erfolge (M2), Avatar-Teile und
Statussymbole (M8), Logo-Editor für Spielerfirmen (M4, speichert dasselbe Rasterformat).

## 7. Layout und Navigation

|             | Handy (< 1024 px)                                             | PC (ab 1024 px)                             |
| ----------- | ------------------------------------------------------------- | ------------------------------------------- |
| Navigation  | Feste Tab-Leiste unten, 5 Tabs, Safe-Area beachtet            | Seitenleiste links, 248 px                  |
| Aktiver Tab | Akzentfläche gleitet zwischen den Icons                       | Fläche gleitet zwischen den Einträgen       |
| Kopfzeile   | Logo, Suche, Guthaben                                         | Suchfeld mit `/`, Börsenstatus, Guthaben    |
| Inhalt      | Eine Spalte, Aktionen in Daumenreichweite über der Tab-Leiste | Zwei Spalten (Inhalt + 360 px Seitenspalte) |
| Order-Maske | Bottom Sheet                                                  | Seitenpanel                                 |

Tastaturkürzel: `/` öffnet die Suche, `B` und `S` öffnen auf der Aktienseite Kaufen und Verkaufen, `Esc` schließt.

## 8. Barrierefreiheit

- Kontrast AA für Text, automatisch getestet.
- Sichtbarer Fokus-Ring (`focus-ring`) auf allem Bedienbaren; „Zum Inhalt springen“ als erster Fokus.
- Dialoge, Sheets, Schalter und Auswahlfelder basieren auf Radix-Primitives (Fokusfalle, Rollen, Tastatur).
- Icons ohne Bedeutung sind `aria-hidden`; Icon-Buttons haben ein `aria-label`.
- Tippflächen mindestens 40 × 40 px, Hauptaktionen 44 px und höher.
- Toasts werden Screenreadern angesagt; Fehlertexte hängen per `aria-describedby` am Feld.

## 9. Sound und Haptik

Sechs kurze 8-Bit-Töne (`tap`, `success`, `coin`, `error`, `warning`, `level-up`), erzeugt von
`scripts/gen-sounds.ts` (selbst synthetisiert, daher keine Lizenzfragen). Howler wird erst beim ersten Ton geladen.
Haptik über `navigator.vibrate`, wo verfügbar. Beides ist in den Einstellungen einzeln abschaltbar.

## 10. Checkliste für neue Screens

- [ ] Nur Token-Utilities, keine Hex-Werte, keine freien `z-`Werte
- [ ] Zahlen mit `nums`, Beträge über `formatMoney`/`formatPrice`
- [ ] Texte in `messages/de.json`
- [ ] Ladezustand als Skeleton in Inhaltsform, leerer Zustand mit `EmptyState`
- [ ] Hover, Press, Fokus, deaktiviert, Laden und Erfolg für jede Aktion
- [ ] Seite in `<Page>` gewickelt, Listen gestaffelt
- [ ] Auf 390 px und 1440 px geprüft, kein horizontales Scrollen
- [ ] Mit Tastatur bedienbar, mit „Reduziert“ weiterhin verständlich
- [ ] Neue Komponente auf `/dev/ui` ergänzt
