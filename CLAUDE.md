# NEXA: Leitfaden für Claude-Code-Sitzungen

Multiplayer-Börsen- und Wirtschaftsspiel für den Browser (Handy und PC). Reines Menü- und Dashboard-Spiel,
nur Spielgeld, Zielgruppe 18+. Arbeitstitel „NEXA“.

@AGENTS.md

## Zuerst lesen

| Frage                      | Dokument                                                      |
| -------------------------- | ------------------------------------------------------------- |
| Was soll das Spiel können? | `docs/GAME_DESIGN.md` (Ursprung: `docs/ORIGINAL_PROMPT.md`)   |
| Was ist als Nächstes dran? | `docs/ROADMAP.md`                                             |
| Warum ist etwas so gebaut? | `docs/DECISIONS.md` (ADRs; neue Entscheidungen dort anhängen) |
| Wie hängt alles zusammen?  | `docs/ARCHITECTURE.md`                                        |
| Tabellen, RLS, RPCs        | `docs/DATA_MODEL.md`                                          |
| Formeln und Simulation     | `docs/SIMULATION.md`, Werte in `docs/BALANCING.md`            |
| Aussehen und Animation     | `docs/DESIGN_SYSTEM.md`, lebend unter `/dev/ui`               |

## Stack

Next.js 16 (App Router, Turbopack, `cacheComponents`), React 19, TypeScript strict, Tailwind CSS 4 (CSS-first),
Radix UI, Motion, Lightweight Charts, Zustand, TanStack Query, Zod 4, next-intl, Howler,
Supabase (Postgres, Auth, Realtime, Edge Functions, pg_cron), Vitest, Playwright. Paketmanager: **pnpm**.

Next.js 16 weicht von älterem Wissen ab (`proxy.ts` statt `middleware.ts`, `params` als Promise,
`cacheComponents`, `<ViewTransition>`). Vor Änderungen an Routing oder Caching in
`node_modules/next/dist/docs/` nachlesen.

## Befehle

```bash
pnpm dev            # Entwicklungsserver (ohne .env.local: Demo-Modus)
pnpm build          # Produktions-Build
pnpm typecheck      # tsc --noEmit
pnpm lint           # ESLint
pnpm format         # Prettier
pnpm test           # Vitest (Simulation, Formeln, Tokens, Pixel-Art)
pnpm test:e2e       # Playwright (baut und startet die App selbst)
pnpm db:config      # supabase/seeds/game_config.sql aus src/config/balance.ts erzeugen
pnpm sounds         # 8-Bit-Sounds neu erzeugen
pnpm icons          # App-Icons neu erzeugen
bash supabase/tests/verify_local.sh   # Schema, RLS und Seeds gegen lokales Postgres prüfen
NEXA_FIXTURE_DIR=$PWD/src/features/game/__fixtures__ bash supabase/tests/verify_local.sh   # dazu RPC-Antworten für den Vertragstest neu schreiben
```

Vor jedem Commit müssen `pnpm typecheck`, `pnpm lint` und `pnpm test` grün sein.

## Harte Regeln

### Server-Autorität

- Geld, Orders, Bestände, XP und Simulation ändern sich **nur serverseitig** (Postgres-Funktionen,
  Edge Functions). Der Client sendet Absichten über `rpc()` und zeigt Ergebnisse.
- Keine direkten `insert`/`update`/`delete` aus dem Client auf Spieltabellen. Ausnahmen sind eng begrenzt
  (Einstellungen, Watchlist, gelesene Benachrichtigungen) und stehen in `docs/DATA_MODEL.md`.
- Jede schreibende Aktion trägt eine `request_id` (UUID) und ist idempotent.
- Der `SUPABASE_SERVICE_ROLE_KEY` kommt in `src/` nicht vor.

### Geld und Zahlen

- Geld: `bigint` in **Cent** (`*_cents`). Kurse: `bigint` × 10 000 (`*_e4`). Sätze: Basispunkte (`*_bps`).
- Niemals Floats für Geld. Gerundet wird einmal, beim Übergang von Kurs zu Geld, kaufmännisch „half even“.
- Umrechnung in `number` nur für die Anzeige, in `src/lib/format.ts`.
- Die Währung ist eine Anzeige-Einstellung (ADR-113): Euro (Standard), Dollar oder NX, Beträge 1:1. Beträge nur über
  `formatMoney` & Co. anzeigen; in Texten (`messages`, Server) „€“ schreiben, der Client tauscht das Zeichen.
  Komponenten, die Beträge zeigen, sind Client-Komponenten.
- Jede Geldbewegung ist eine Ledger-Buchung mit Summe 0. Kein `UPDATE` auf Kontostände an der Buchung vorbei.

### Balancing

- Kein Spielwert im Code. Alles steht in `src/config/balance.ts` und zur Laufzeit in `game_config`.

### Simulation (`src/lib/sim`, `src/config/balance.ts`)

- Reines TypeScript: keine npm-Importe, keine Pfad-Aliase, relative Importe **mit** `.ts`-Endung
  (läuft unverändert in Deno).
- Kein `Math.random()`, kein `Date.now()`: Zufall und Zeit werden übergeben.
- Jede Formel hat einen Test daneben (`*.test.ts`).

### Datenbank

- RLS auf **jeder** Tabelle. Funktionen mit `SECURITY DEFINER` setzen `search_path = ''`.
- Schema ändern heißt: neue Migration in `supabase/migrations`, nie eine alte umschreiben.
- Ändern sich RPC-Antworten, die Fixtures neu schreiben (siehe Befehle); `src/features/game/api.test.ts` prüft sie
  gegen die Zod-Schemas des Clients.
  Danach `verify_local.sh` laufen lassen und `docs/DATA_MODEL.md` nachziehen.
- Zu jeder neuen Migration gehört eine idempotente Kopie in `supabase/updates/` (siehe dortige README).
  Danach `bash scripts/build-setup-sql.sh`: Das erzeugt `setup-all.sql` (neues Projekt) und
  `update-to-latest.sql` (bestehendes Projekt, beliebig oft ausführbar) für den Supabase SQL Editor.

### Oberfläche

- **Tokens statt Hardcode:** nur Token-Utilities (`bg-surface-1`, `text-fg-2`, `text-gain`, …).
  Die Tailwind-Standardpalette existiert nicht. Keine Hex-Werte in Komponenten (Ausnahme: Pixel-Art-Paletten
  und Firmenfarben als Daten).
- **Zahlen** mit `nums`, formatiert über `formatMoney` / `formatPrice` / `formatBps`.
- **Texte** in `messages/de.json` (`useTranslations` / `getTranslations`), nicht im JSX.
- **Animation:** nur `transform` und `opacity`; Dauern und Kurven aus den Motion-Tokens
  (`src/lib/motion.ts`, `tokens.css`); `prefers-reduced-motion` und die Einstellung „Animationen“ respektieren.
- **Zustände:** Jede Aktion hat Hover, Press, Fokus, deaktiviert, Laden und Erfolg. Laden als Skeleton in
  Inhaltsform, Leere als `EmptyState`. Keine rohen Spinner.
- **Pixel-Art** nur über `PixelIcon`, nur ganzzahlig skaliert.
- **Responsiv:** Handy zuerst (390 px), ab `lg` (1024 px) mehrspaltig. Kein horizontales Scrollen.
- Jede Seite steckt in `<Page>`; neue Komponenten kommen auf `/dev/ui`.
- **Schrittweise Offenlegung:** Neue Bereiche bekommen einen Eintrag in `src/config/disclosure.ts` und werden in
  `<Reveal>` gewickelt. Neue Spieler sehen nur, was sie schon nutzen können.
- **Tutorial:** Elemente, die das Tutorial markiert, tragen `data-tour="…"`. Wer sie umbaut, prüft
  `src/features/tutorial/steps.ts` und lässt `e2e/tutorial.spec.ts` laufen.
- Clock und `localStorage` erst nach der Hydration lesen (`useClock`, `useMountTime`, `useSettings`).

### Sprache

- Code, Bezeichner, Kommentare, Datenbank, Commit-Messages: **Englisch**.
- Spieltexte und Dokumente unter `docs/`: **Deutsch**.

### Nicht verhandelbar

- Kein Echtgeld, keine In-App-Käufe, keine bezahlten Zufallsboxen, keine Kauf-Countdowns.
- Jedes Feature muss mit 4 Spielern funktionieren.

## Struktur in Kürze

```
src/app            Routen: (app) Spiel, (auth) Anmeldung, dev/ui Showcase
src/components     ui (Bausteine), pixel (Pixel-Art), layout (App-Hülle)
src/features       market, portfolio, company, career, progression, tutorial, help, auth, settings
src/lib            sim (Simulation), supabase, demo, format, motion, sound, haptics
src/config         balance.ts, disclosure.ts, app.ts, navigation.ts
src/stores         Zustand-Stores (UI-State)
src/styles         tokens.css
messages           Texte
supabase           migrations, seed.sql, seeds, tests, functions (ab M1)
e2e                Playwright
```

## Arbeitsweise

- In kleinen, prüfbaren Schritten arbeiten und nach jedem logischen Schritt committen
  (Conventional Commits: `feat(market): …`, `fix(ui): …`, `docs: …`).
- Sichtbare Änderungen mit Playwright-Screenshots auf 390 px und 1440 px prüfen, hell und dunkel.
- Annahmen als ADR in `docs/DECISIONS.md` festhalten, Fortschritt in `docs/ROADMAP.md` abhaken.
- Am Ende eines Meilensteins: Changelog-Notiz in `CHANGELOG.md`, dann auf Freigabe warten.
