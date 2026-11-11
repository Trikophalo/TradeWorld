# NEXA – Roadmap

Arbeitsfassung der Meilensteine M0 bis M8 aus [`ORIGINAL_PROMPT.md`](./ORIGINAL_PROMPT.md), Abschnitt 15.
Spielregeln stehen in [`GAME_DESIGN.md`](./GAME_DESIGN.md), Entscheidungen in [`DECISIONS.md`](./DECISIONS.md).
Verweise der Form „Frage n“ meinen die offenen Designfragen in `GAME_DESIGN.md`, Abschnitt 25.

## Inhaltsverzeichnis

- [Regeln für alle Meilensteine](#regeln-für-alle-meilensteine)
- [Übersicht](#übersicht)
- [M0 Fundament](#m0-fundament)
- [M1 Markt](#m1-markt)
- [Reihenfolge innerhalb von M1](#reihenfolge-innerhalb-von-m1)
- [M2 Spieler-Kern](#m2-spieler-kern)
- [M3 Karriere](#m3-karriere)
- [M4 Unternehmen](#m4-unternehmen)
- [M5 Sozial](#m5-sozial)
- [M6 Börsengang](#m6-börsengang)
- [M7 Risiko](#m7-risiko)
- [M8 Feinschliff](#m8-feinschliff)
- [Nach M8](#nach-m8)
- [Nicht im MVP](#nicht-im-mvp)

---

## Regeln für alle Meilensteine

**Jeder Meilenstein endet mit drei Dingen:**

1. lauffähiger Deploy auf Vercel,
2. Tests für die Simulationslogik des Meilensteins (Vitest, `src/lib/sim`),
3. kurze Changelog-Notiz.

Diese drei Punkte stehen in jedem Meilenstein unter „Abschluss“.

**Außerdem gilt durchgehend:**

- Ein Meilenstein beginnt erst nach Freigabe des vorigen durch den Auftraggeber.
- Geldkritische Logik liegt in PL/pgSQL-RPCs, Simulation als reine Funktionen in `src/lib/sim` (ADR-004, ADR-012).
- Neue Balancing-Werte kommen in `src/config/balance.ts` und `game_config` (ADR-009), nie in den Code.
- Neue Tabellen bekommen RLS im selben Schritt (ADR-008).
- Neue Texte kommen in `messages/de.json` (ADR-002).
- Offene Designfragen, die ein Meilenstein berührt, werden **vor** seinem Start entschieden und als ADR festgehalten.
- Abnahmekriterien sind so formuliert, dass eine Person sie durch Spielen prüfen kann. Wo Wartezeit nötig
  wäre, darf der Admin die Zeit vorspulen (ADR-006).

---

## Übersicht

| Meilenstein     | Ergebnis                                 | Baut auf                      |
| --------------- | ---------------------------------------- | ----------------------------- |
| M0 Fundament    | Leere, aber schöne und navigierbare App  | –                             |
| M1 Markt        | Man kann live traden                     | M0                            |
| M2 Spieler-Kern | 4 Freunde können spielen und sich messen | M1                            |
| M3 Karriere     | Einkommen wächst                         | M2                            |
| M4 Unternehmen  | Firmen gründen und führen                | M2 (M3 empfohlen)             |
| M5 Sozial       | Kooperation und Drama                    | M3, M4                        |
| M6 Börsengang   | Spielerfirmen an der Börse               | M4, M5                        |
| M7 Risiko       | Volles Zockgefühl                        | M2 (unabhängig von M3 bis M6) |
| M8 Feinschliff  | Release für Freundestest v1              | M0 bis M7                     |

M7 hängt fachlich nur an M1 und M2. Es kann vorgezogen werden, wenn die Testgruppe früh Hebel und Shorts will.
Die Standardreihenfolge bleibt die des Prompts.

---

## M0 Fundament

**Ziel:** Eine leere, aber polierte und navigierbare App steht, zusammen mit dem vollständigen Datenmodell,
den Simulationstypen und der Dokumentation, sodass M1 ohne Umbauten starten kann.

**Status:** in Umsetzung. Die Kästchen hakt der Lead ab.

**Abhängigkeiten:** keine.

### Daten/Backend

- [x] Projekt-Setup: Next.js (App Router), TypeScript strict, pnpm, ESLint, Prettier, Husky + lint-staged (ADR-002)
- [x] `.env.example` mit allen Variablen. `SUPABASE_SERVICE_ROLE_KEY` nur serverseitig.
- [x] Vollständiges DB-Schema als Migrationen unter `supabase/` für alle Meilensteine (Markt, Ledger, Spieler,
      Karriere, Unternehmen, Soziales, Events, Konfiguration)
- [x] RLS auf allen Tabellen, öffentliche Views für Kurse, Firmenprofile und Ranglisten (ADR-008)
- [x] Ledger mit doppelter Buchführung und Systemkonten (ADR-007)
- [x] Seeds: 15 KI-Unternehmen mit Kürzeln (ADR-014), Branchen, Staatsanleihen, `game_quarters`, `game_config`,
      Einladungscodes
- [x] `src/config/balance.ts` mit allen Startwerten und `pnpm db:config` für den Seed von `game_config` (ADR-009)
- [ ] Auth: Registrierung mit E-Mail, Passwort, Einladungscode und 18+-Bestätigung, Login, Logout,
      geschützte Spielseiten (ADR-010) _(umgesetzt, aber mangels Zugangsdaten noch nicht gegen ein echtes Supabase-Projekt getestet)_
- [x] Demo-Modus ohne Supabase-Zugangsdaten mit Beispieldaten aus `src/lib/demo` (ADR-015)

### Simulation

- [x] Typdefinitionen in `src/lib/sim` für Markt-Tick, Quartalsabschluss, KI-Investoren, Unternehmen (ADR-012)
- [x] Reine Formelfunktionen: XP-Kurve, fairer Wert, Attraktivität und Marktanteil, Marketing-Grenznutzen,
      Geldumrechnung Cent/`e4` mit Rundung (ADR-003)
- [x] Seedbarer Zufallsgenerator (ADR-012)
- [x] `docs/SIMULATION.md` mit Pseudocode für Tick, Quartal, KI-Investoren, Zentralbank, Events

### UI

- [x] Design-Tokens als CSS-Variablen in `src/styles/tokens.css`, eingebunden über `@theme inline` (ADR-002):
      Farben, Typografie, Abstände, Radien, Schatten, Motion, z-Index
- [x] Dunkles Theme als Standard, helles Theme zusätzlich
- [x] Selbst gehostete Schriften Inter und Silkscreen, `tabular-nums` für Zahlen
- [x] Layout mit 5 Tabs: untere Tab-Leiste auf dem Handy, Seitenleiste auf dem PC, animierter Tab-Indikator
- [x] Fünf Tab-Seiten mit sinnvollen Platzhaltern (leere Zustände mit Pixel-Illustration)
- [x] Komponenten-Showcase unter `/dev/ui`: Buttons (alle Zustände), Karten, Number Ticker, Skeletons, Toasts,
      Bottom Sheet, Tab-Leiste
- [x] `PixelIcon`-Komponente und erstes Icon-Set: 5 Branchen-Icons, 3 Beispiel-Firmenlogos, Münze, Stier, Bär
- [x] `prefers-reduced-motion` wird respektiert
- [x] i18n mit `next-intl`, Texte in `messages/de.json`
- [x] PWA-Grundlage: Manifest und Icons

### Tests

- [x] Vitest für alle Formelfunktionen (XP-Kurve an den Stützstellen 1, 10, 20, Marktanteile summieren zu 1,
      Rundung half-even, Determinismus des Zufallsgenerators)
- [x] Playwright-Screenshots der 5 Tabs und von `/dev/ui` in Handy- und PC-Breite, Unschönheiten korrigiert
- [x] Lint und Typecheck laufen fehlerfrei

### Dokumentation

- [x] `CLAUDE.md`, `docs/GAME_DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/SIMULATION.md`,
      `docs/BALANCING.md`, `docs/DESIGN_SYSTEM.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`

### Abnahmekriterien

- Die App öffnet sich auf dem Handy und auf dem PC ohne Layoutfehler. Alle 5 Tabs sind erreichbar.
- Auf dem Handy liegt die Tab-Leiste unten, auf dem PC die Seitenleiste links.
- Der Wechsel zwischen Hell und Dunkel funktioniert und bleibt nach dem Neuladen erhalten.
- `/dev/ui` zeigt alle genannten Komponenten in allen Zuständen. Der Number Ticker zählt animiert, Toasts
  stapeln sich, das Bottom Sheet lässt sich per Wischgeste schließen.
- Ohne Supabase-Variablen startet die App im Demo-Modus und zeigt Beispieldaten.
- Mit Supabase-Variablen: Registrierung klappt nur mit gültigem Einladungscode und 18+-Bestätigung.
  Ohne Login leiten Spielseiten zur Anmeldung um.
- Die Migrationen laufen auf einer leeren Datenbank durch. Danach existieren die 15 KI-Firmen.
- Ein angemeldeter Testnutzer kann über die Supabase-API keine fremden privaten Zeilen lesen und in keine
  spielrelevante Tabelle schreiben.

### Hauptrisiko

Das Schema wird für alle Meilensteine im Voraus entworfen. Teile davon werden sich in M4 bis M7 als unpassend
erweisen. Gegenmittel: Änderungen kommen als neue Migrationen. Es wird akzeptiert, dass späte Tabellen noch
umgebaut werden.

### Abschluss

- [ ] Deploy auf Vercel (im Demo-Modus, falls noch kein Supabase-Projekt existiert) _(offen: braucht dein Vercel-Konto)_
- [x] Tests der Formelfunktionen grün
- [x] Changelog-Notiz „M0“

---

## M1 Markt

**Ziel:** Die 15 KI-Firmen werden live gehandelt. Kurse bewegen sich alle 5 Sekunden nachvollziehbar, und
ein Spieler kann Aktien und Staatsanleihen mit Market- und Limit-Orders kaufen und verkaufen.

**Abhängigkeiten:** M0 (Schema, Auth, Layout, Simulationstypen). Ein Supabase-Projekt mit `pg_cron`, `pg_net`
und Edge Functions muss existieren.

**Vor dem Start zu entscheiden:** Fragen 2, 5, 7, 8.

### Daten/Backend

- [x] ~~Edge Function `tick-runner`~~ ersetzt durch `market_tick()` in PL/pgSQL, alle 5 s per `pg_cron` (ADR-037)
- [x] `pg_cron`-Jobs für Tick (5 s), fällige Quartale und Wartung, ohne Edge Functions (ADR-037)
- [x] Tick schreibt Kurse, Ticks, Kerzen und füllt fällige Limit-Orders in einer Transaktion
- [x] Kerzen-Aggregation: 1 min, 5 min, 1 h, 1 Quartal, 1 Spieljahr
- [x] RPC `place_order` (Market, Limit) mit `request_id`, Kontosperre und Ledger-Buchung (ADR-007, ADR-008)
- [x] RPC `cancel_order`
- [x] Ordergebühr 1 € und Steuer 25 % auf realisierte Gewinne mit Verlusttopf
- [x] Staatsanleihen: Kauf, Kupon, Rückzahlung bei Fälligkeit für 1, 2, 5 und 10 Spieljahre
- [x] Quartalsabschluss in Minimalform: Quartal fortschreiben, Quartalszahlen der KI-Firmen, Anleihezinsen
- [x] ~~Realtime-Broadcast~~ ersetzt durch Abfrage im Tick-Takt (ADR-037); Realtime bleibt eine spätere Optimierung
- [x] Rate Limit für Orders
- [x] Admin-Minimum: pausieren, fortsetzen, Tick auslösen, Quartal sofort abschließen (`admin_*`-RPCs, nur per SQL Editor)

### Simulation

- [x] Fairer Wert je Aktie aus Gewinn je Aktie, Branchen-KGV, Wachstums- und Makrofaktor
- [x] KI-Investoren vereinfacht als aggregierter Nachfragedruck (ADR-005): Marktmacher, Value-Fonds,
      Momentum-Trader. Rentenfonds, Indexfonds und Kleinanleger-Herde als einfache Platzhalter.
- [x] Preis-Impact-Funktion für Spieler-Orders und KI-Druck
- [x] Synthetisches Orderbuch aus Marktmacher-Stufen plus Limit-Orders der Spieler
- [x] Börsenzeiten 08:00 bis 22:00 Uhr, nachbörslich dünnere Liquidität und größerer Spread
- [x] Unternehmenssimulation für KI-Firmen mit festen Entscheidungen (Umsatz, Kosten, Gewinn, Marktanteil)
- [x] NEXA 30: Indexberechnung nach Marktkapitalisierung
- [x] Zentralbank: Leitzins 3 %, noch ohne Anpassung. Anleiherendite an den Leitzins gekoppelt.

### UI

- [x] Start: Live-Chart des NEXA 30, Top-Gewinner und -Verlierer
- [x] Märkte: Reiter Aktien, Staatsanleihen, Indizes. Filter nach Branche und Größe, Top-Mover.
- [x] Aktien-Detail: Kerzenchart (1 min bis 1 J, Kerze/Linie), Orderbuch, Kennzahlen, News aus Quartalszahlen
- [x] Order-Maske als Bottom Sheet (Handy) und Seitenpanel (PC) mit Vorschau von Gebühr und geschätztem Preis
- [x] Trade-Feedback: Erfolgsanimation, Toast, Kurs-Aufblitzen in Grün und Rot, Number Ticker
- [x] Einfache Positions- und Orderliste im Portfolio-Tab (das volle Portfolio folgt in M2)
- [x] Hinweis auf Börsenzeiten und nachbörslichen Handel
- [x] Globale Suche nach Aktien
- [x] TradingView-Attribution für Lightweight Charts
- [x] Ticks im Client gebündelt: ein Snapshot je Tick, Zeilen rendern nur bei eigener Kursänderung

### Tests

- [x] Vitest: Tick ist mit gleichem Seed deterministisch. Ohne Spieler-Orders bleibt der Kurs über viele Ticks
      in einem Band um den fairen Wert.
- [x] Vitest: Preis-Impact wächst monoton mit der Ordergröße. Kerzen-Aggregation ist korrekt.
- [x] Vitest: Steuer und Verlusttopf, Rundung beim Orderwert
- [x] Datenbanktest: `place_order` ist idempotent. Zwei gleichzeitige Orders überziehen das Konto nicht.
      Die Summe aller Ledger-Einträge ist 0.
- [x] Playwright: Aktie kaufen (auch per Betrag), Position sehen, verkaufen (Demo-Modus; Anmelden gegen Supabase noch manuell)

### Abnahmekriterien

- Auf der Aktien-Detailseite ändert sich der Kurs während der Börsenzeit alle 5 bis 10 Sekunden, ohne dass
  man neu lädt. Die Live-Kerze wächst mit.
- Eine Market-Order über 10 Aktien wird in unter 2 Sekunden ausgeführt. Der Kontostand sinkt um Orderwert plus
  1 € Gebühr, die Position erscheint.
- Eine Limit-Order unter dem aktuellen Kurs bleibt offen, ist im Orderbuch sichtbar, lässt sich stornieren
  und wird ausgeführt, wenn der Kurs sie erreicht.
- Eine sehr große Order bewegt den Kurs sichtbar und wird schlechter ausgeführt als der angezeigte Kurs.
- Ein Verkauf mit Gewinn zeigt 25 % Steuer in der Abrechnung. Ein Verkauf mit Verlust zeigt keine Steuer.
- Ein doppelter Klick auf „Kaufen“ erzeugt nur eine Order.
- Nach 22:00 Uhr ist Handel möglich, der Spread ist sichtbar größer.
- Eine Staatsanleihe lässt sich kaufen. Nach Vorspulen bis zur Fälligkeit sind Nennwert und Zinsen auf dem Konto.
- Zwei Spieler sehen zur selben Zeit denselben Kurs.
- Nach einer Nacht ohne angemeldete Spieler gibt es durchgehende Kerzen.

### Hauptrisiko

Der Tick-Runner auf dem Supabase-Free-Tier: Laufzeitlimit der Edge Function, Lücken zwischen zwei
Minuten-Aufrufen, doppelte Runner, Realtime-Kontingent. Gegenmittel: Lease und Überwachung der Tick-Lücken ab
dem ersten Tag. Der Runner bleibt so gebaut, dass er als Node-Prozess laufen kann (ADR-004).

Zweites Risiko: Die Kurse wirken zufällig oder zu glatt. Gegenmittel: Ein Skript simuliert einen ganzen Tag
und gibt Kennzahlen aus (Tagesschwankung je Größenklasse), bevor die UI angebunden wird.

### Abschluss

- [ ] Deploy auf Vercel mit angebundenem Supabase-Projekt _(offen: Einspielen durch den Auftraggeber)_
- [x] Tests der Tick- und Orderlogik grün
- [x] Changelog-Notiz „M1“

---

## Reihenfolge innerhalb von M1

M1 ist der technisch riskanteste Meilenstein. Er wird in fünf Schritten gebaut, die einzeln geprüft und
freigegeben werden können.

| Schritt                                | Inhalt                                                                                                                                                                                             | Prüfbar durch                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **1. Markt lesen**                     | Supabase-Projekt anbinden, Migrationen und Seeds einspielen. Märkte-Liste und Aktien-Detail lesen echte Daten aus den öffentlichen Views. Noch keine Bewegung, Kurshistorie aus einem Seed-Skript. | Liste und Detailseite zeigen die 15 Firmen mit Chart. Der Demo-Modus funktioniert weiter. |
| **2. Tick offline**                    | Tick-Funktion in `src/lib/sim` vollständig (fairer Wert, KI-Druck, Preis-Impact, Börsenzeiten), dazu das Tagessimulations-Skript und Tests. Noch keine Datenbank.                                  | Testbericht und Kennzahlen eines simulierten Tages. Kurve je Größenklasse plausibel.      |
| **3. Tick live**                       | `tick-runner`, `apply_market_tick`, Kerzen, `pg_cron`, Lease, Broadcast. Client abonniert `market:ticks`.                                                                                          | Kurse und Live-Kerze bewegen sich im Browser. Über Nacht entstehen lückenlose Kerzen.     |
| **4. Handeln**                         | `place_order` und `cancel_order` für Market und Limit, Ledger, Gebühr, Steuer, Orderbuch, Order-Maske, Positionsliste.                                                                             | Kaufen, verkaufen, Limit setzen und stornieren. Ledger-Summe 0. Doppelklick-Test.         |
| **5. Anleihen, Index, Quartal, Admin** | Staatsanleihen, NEXA 30 auf der Startseite, minimaler Quartalsabschluss mit Quartalszahlen und News, Admin-Minimum, Rate Limit, Playwright-Flow.                                                   | Alle Abnahmekriterien von M1.                                                             |

Schritt 2 vor Schritt 3 ist Absicht: Das Kursverhalten wird ohne Infrastruktur abgestimmt, wo ein Durchlauf
Sekunden dauert statt einen Tag.

---

## M2 Spieler-Kern

**Ziel:** Vier Freunde haben einen Grund, täglich wiederzukommen, und können sich vergleichen: Portfolio,
Grundeinkommen, Level, Missionen, Streak, erste Erfolge und die Freundes-Liga.

**Abhängigkeiten:** M1 (Trades als wichtigste XP-Quelle, Kurse für die Portfoliobewertung).

**Vor dem Start zu entscheiden:** Fragen 4, 6, 16, 17, 20.

### Daten/Backend

- [ ] Tutorial serverseitig: Spalte `tutorial_completed_at` und RPC `complete_tutorial(request_id)`, der die
      XP aus `xpSources.tutorial` genau einmal gutschreibt (ADR-034); der Client spiegelt nur noch den Zustand

- [ ] Startkapital 10.000 € bei der Registrierung über das Ledger (ADR-011)
- [ ] Grundeinkommen 100 € je Stunde, Tresor mit 8 Stunden Obergrenze, RPC `claim_vault`
- [ ] XP-Vergabe serverseitig mit allen Schutzregeln (30 Trades pro Tag, Wash-Trading, max. 500 XP je Trade)
- [ ] Level-up und Freischaltungen als Serverzustand. Ordertypen und Funktionen werden nach Level geprüft.
- [ ] Stop-Loss (Level 5) und Watchlist (Level 3)
- [ ] Tägliche Missionen (3 pro Tag, 200 bis 400 XP), Wochen-Challenge
- [ ] Login-Streak mit Bonus und 1 Streak-Schutz pro Woche
- [ ] Erfolge (Basis): alle Erfolge, deren Mechanik bis M2 existiert
- [ ] Portfolio-Snapshots für den Wertverlauf
- [ ] Freundes-Liga: Wochenwertung nach prozentualem Wachstum, Titel für Platz 1
- [ ] Benachrichtigungen in der App über `notifications` (ADR-013): Order ausgeführt, Tresor voll, Level-up
- [ ] Profil mit einstellbarer Sichtbarkeit des Portfolios

### Simulation

- [ ] XP-Kurve und Levelberechnung (Formel aus M0) an den Server angebunden
- [ ] Wash-Trading-Erkennung als reine Funktion
- [ ] Renditeberechnung für die Liga
- [ ] Missionsgenerator, der nur Missionen wählt, die der Spieler mit seinem Level erfüllen kann

### UI

- [ ] Portfolio vollständig: Kennzahlen, Wertverlauf (1 T / 1 W / 1 M / Gesamt), Positionsliste, Donut,
      Handelshistorie mit Gebühren und Steuern
- [ ] Start: Portfoliowert mit Tagesveränderung, Tresor-Status, Missionen kompakt
- [ ] „Tresor leeren“ mit Pixel-Münzen und Sound
- [ ] XP-Balken mit fliegendem „+XP“, Level-up-Overlay mit nacheinander erscheinenden Freischaltungen und
      Einstiegsmission
- [ ] Gesperrte Funktionen sichtbar mit Level-Hinweis
- [ ] Karriere/Profil: Level, nächste Freischaltung, Missionen, Wochen-Challenge, Erfolge, Freundes-Liga,
      Einstellungen (Theme, Sounds, Animationen, Benachrichtigungen)
- [ ] Benachrichtigungszentrale

### Tests

- [ ] Vitest: XP-Regeln mit allen Grenzen, Wash-Trading, Streak mit Schutz, Liga-Rendite mit Zuflüssen,
      Tresor-Obergrenze
- [ ] Datenbanktest: `claim_vault` ist idempotent und zahlt nie mehr als 8 Stunden aus
- [ ] Playwright: Tresor leeren, Mission abschließen, Level-up-Overlay erscheint

### Abnahmekriterien

- Ein neuer Account startet mit 10.000 € und Level 1.
- Nach 1 Stunde liegen 100 € im Tresor, nach mehr als 8 Stunden genau 800 €.
- Ein Trade bringt sichtbar 10 XP. Der 31. Trade des Tages bringt keine XP. Kauf und sofortiger Rückverkauf
  bringen keine XP.
- Beim Erreichen von Level 3 erscheint das Overlay. Danach ist die Limit-Order wählbar, vorher war sie mit
  Hinweis gesperrt.
- Drei tägliche Missionen sind sichtbar, lassen sich erfüllen und geben XP.
- Der Streak steigt bei Login an aufeinanderfolgenden Tagen und übersteht einen verpassten Tag pro Woche.
- Das Portfolio zeigt für jede Position Einstand und Gewinn/Verlust in € und %. Die Handelshistorie stimmt
  mit dem Kontostand überein.
- Vier Accounts sehen sich in der Liga, sortiert nach Wachstum in Prozent. Ein später gestarteter Account
  kann Platz 1 erreichen.
- Mindestens 10 Erfolge sind erreichbar, einer wird im Test freigeschaltet.

### Hauptrisiko

Balancing des Fortschritts: Zu schnelle Level entwerten die Freischaltungen, zu langsame verlieren die
Testgruppe in der ersten Woche. Gegenmittel: Rechnung in `BALANCING.md` (XP pro Tag je Spielweise), dazu ein
Admin-Schalter für einen XP-Multiplikator während der Alpha.

### Abschluss

- [ ] Deploy auf Vercel
- [ ] Tests der XP-, Tresor- und Liga-Logik grün
- [ ] Changelog-Notiz „M2“
- [ ] Erste Spielrunde mit den 4 Freunden und Sammlung der Rückmeldungen

---

## M3 Karriere

**Ziel:** Spieler haben neben dem Handel ein wachsendes Einkommen aus Jobs bei KI-Firmen, mit kurzen
Arbeitsaufgaben, Beförderungen und einer wöchentlichen Gehaltsverhandlung.

**Neu nach Vorgabe des Auftraggebers (ADR-050 bis ADR-054, `JOBS_AND_SKILLS.md`):** Skill-Baum statt reiner
Erfahrung, Jobportal mit Bewerbung, Gegenangebot und Unterschrift, Gehaltserhöhung nach Skill-Zuwachs, Kündigung
gegen ein Gehalt. Beförderung und Verhandlung mit Zufallschance entfallen dafür.

- [x] Skill-Baum: 8 Bereiche, 86 Skills, unumkehrbar, Punkte aus Level-ups, Missionen, Belohnung und Arbeit
- [x] Jobportal mit KI-Stellen (2 je Firma, Stufen und Mindest-Skills), Bewerbung mit Gehaltswunsch und Satz
- [x] KI-Firmen nehmen sofort an, zahlen gedeckelt; Nachverhandeln, Ablehnen, Zurückziehen
- [x] Arbeitsvertrag mit symbolischer Unterschrift, danach enden alle anderen Bewerbungen
- [x] Jobkarte mit Gehalt, Leistung (× KI-Kraft), bezahlten Stunden, Gehaltserhöhung und Kündigung
- [x] Tägliche Belohnung als 7-Tage-Kalender, Profilbilder, Visitenkarte mit 3D-Effekt, öffentliche Spielerseite
- [x] Oberfläche und Demo-Modus, Playwright `careers.spec.ts`
- [x] Datenbank: Tabellen, RPCs, Lohnlauf aus der Firmenkasse, Arbeitgeber-RPCs, Fixtures, Test 60
- [ ] Arbeitgeber-Oberfläche für Spielerfirmen (mit M4)

**Abhängigkeiten:** M2 (Level, XP, Missionen, Benachrichtigungen), M1 (Quartalsabschluss für die Gehaltsabrechnung).

**Vor dem Start zu entscheiden:** Fragen 1, 21.

### Daten/Backend

- [ ] Jobbörse mit Stellen bei den 15 KI-Firmen in den Stufen Praktikant, Junior, Senior, Teamleitung, C-Level
      (Level 2, 5, 12, 20, 25)
- [ ] Job annehmen und kündigen als RPC
- [ ] Gehaltsabrechnung beim Quartalsabschluss, höchstens 12 bezahlte Stunden pro Tag, über das Systemkonto `payroll`
- [ ] Berufserfahrung je Arbeitsstunde, Beförderung bei Schwellen (+10 bis 20 %)
- [ ] Gehaltsverhandlung einmal pro Woche
- [ ] Jobwechsel setzt den Beförderungsfortschritt zurück
- [ ] Arbeitsaufgaben: Erzeugung alle paar Stunden, Bewertung serverseitig, 50 bis 150 XP plus Bonus
- [ ] Analystenberichte mit Kurszielen (Level 7)
- [ ] XP je Arbeitsstunde (40)

### Simulation

- [ ] Aufgabengeneratoren für Analyst (Quartalszahlen schätzen), Vertrieb (bestes von 3 Kundenprofilen),
      Finanzen (zwei Kreditangebote)
- [ ] Bewertungsfunktion je Aufgabentyp. Die Lösung entsteht aus echtem Spielzustand, nicht aus festen Fragen.
- [ ] Erfolgschance der Gehaltsverhandlung aus Erfahrung, Leistung und Firmenlage
- [ ] Analystenkursziele: fairer Wert plus Fehler, bewusst manchmal falsch

### UI

- [ ] Jobbörse mit gesperrten Stufen und Level-Hinweis
- [ ] Jobkarte mit Gehalt, Erfahrung und Beförderungsfortschritt
- [ ] Drei Aufgaben-Oberflächen, jede in 20 bis 60 Sekunden lösbar, mit Ergebnisanzeige
- [ ] Gehaltsverhandlung als kurzer Dialog mit sichtbarer Erfolgschance
- [ ] Analystenrating auf der Aktien-Detailseite
- [ ] Erfolge der Kategorie Karriere

### Tests

- [ ] Vitest: Gehaltsdeckel 12 Stunden, Beförderungsschwellen, Verhandlungschance, Bewertung der Aufgaben,
      Verteilung der Analystenfehler
- [ ] Datenbanktest: Gehalt wird je Quartal genau einmal gebucht
- [ ] Playwright: Job annehmen, Aufgabe lösen, XP erhalten

### Abnahmekriterien

- Ein Spieler mit Level 2 kann die Praktikantenstelle annehmen, Junior-Stellen sind sichtbar gesperrt.
- Nach einem Quartal (Vorspulen) ist das Gehalt auf dem Konto und in der Historie als Gehalt ausgewiesen.
- Über einen ganzen Tag werden höchstens 12 Stunden bezahlt.
- Eine Arbeitsaufgabe erscheint, lässt sich in unter einer Minute lösen und gibt je nach Qualität 50 bis 150 XP.
- Nach genug Arbeitsstunden erfolgt eine Beförderung mit höherem Gehalt.
- Die Gehaltsverhandlung ist einmal pro Woche möglich und danach gesperrt.
- Ab Level 7 zeigt die Aktien-Detailseite ein Kursziel.

### Hauptrisiko

Arbeitsaufgaben werden nach wenigen Tagen eintönig. Gegenmittel: Aufgaben aus dem echten Marktzustand
erzeugen, sodass Marktkenntnis hilft, und lieber drei gute Typen als viele flache.

### Abschluss

- [ ] Deploy auf Vercel
- [ ] Tests der Karrierelogik grün
- [ ] Changelog-Notiz „M3“

---

## M4 Unternehmen

**Ziel:** Ab Level 10 gründen Spieler ein Unternehmen, treffen Quartalsentscheidungen und konkurrieren in der
gemeinsamen Branchennachfrage mit KI-Firmen und miteinander, bis hin zur Insolvenz.

**Abhängigkeiten:** M2 (Level, Ledger-Konten, Benachrichtigungen), M1 (Quartalsabschluss, Unternehmenssimulation
der KI-Firmen). M3 ist empfohlen, weil sonst das Geld für die Gründung langsam zusammenkommt.

**Vor dem Start zu entscheiden:** Fragen 6, 9, 14.

**Erster Schritt umgesetzt (ADR-055 bis ADR-057, `PLAYER_COMPANIES.md`):**

- [x] Garagen-Startup ab Level 3 und Kleinunternehmen ab Level 10, Gründung mit Name, Idee, Branche, Farbe
- [x] Startup-Modell: verborgene Marktgröße, S-Kurve der Bekanntheit, Qualität aus Skills, Kapazität aus Leistung
- [x] KI-Kräfte zum Festpreis, Marketing-Budget, Einzahlen und Entnehmen, Wachsen zum Kleinunternehmen
- [x] Arbeitgeber-Oberfläche: Stellen, Bewerbungen (annehmen, ablehnen, Gegenangebot), Team (Erhöhung, Entlassung)
- [x] Firmenwert zählt zum Vermögen und zur Reichenliste
- [x] Spielergetriebene, schnellere Märkte (ADR-056), langsamere erste Level (ADR-055)
- [ ] Gewinnabhängiger Lohn mit Bonus, Insolvenz mit Privathaftung, Finanzierungsrunden, GmbH/AG, Firmenchat

### Daten/Backend

- [ ] Gründung als RPC: Kleinunternehmen (Level 10, 15.000 €), GmbH (Level 20, 75.000 €), AG vor IPO
      (Level 25, 300.000 €)
- [ ] Firmenkonto im Ledger, Kapitalobergrenze für private Einlagen
- [ ] Umwandlung in die nächste Stufe, Erweiterung auf 20 Mitarbeiter ab Level 18
- [ ] Quartalsentscheidungen speichern (Produkt, Preis, Marketing, Personal, Finanzen), gültig ab dem nächsten Abschluss
- [ ] Vollständiger Quartalsabschluss für Spielerfirmen: Umsatz, Kosten, Gewinn, Marktanteil, Bericht
- [ ] KI-Mitarbeiter: Bewerberpool je Quartal, einstellen, entlassen, befördern, Gehälter, Abwerben durch KI-Firmen
- [ ] Führungspositionen CFO, CTO, COO, Vertriebsleitung
- [ ] Kredite: Zins = Leitzins + Risikoaufschlag, Rahmen nach Stufe (250.000 €, 2 Mio. €)
- [ ] Insolvenz nach 2 ungedeckten Quartalen, Gründungssperre, Rettungsübernahme durch eine KI-Firma
- [ ] Cap Table (in M4 nur der Gründer)
- [ ] Speicherung und Prüfung der Pixel-Logos (Größe, Palette)
- [ ] 500 XP je Firmenquartal mit Gewinn, Firmenmeilensteine

### Simulation

- [ ] Gemeinsame Branchennachfrage mit `attractiveness = quality^1.2 × awareness^0.8 / price^1.5`
- [ ] Kapazität aus Mitarbeitern mit Einarbeitungszeit
- [ ] Produktentwicklung über mehrere Quartale
- [ ] Marketing mit sinkendem Grenznutzen (doppeltes Budget etwa +40 % Bekanntheit)
- [ ] Fixkosten je Stufe (2.000 €, 10.000 €, 40.000 €), variable Kosten
- [ ] Mitarbeitermodell: Skill 1 bis 10, Loyalität, Eigenschaften, Kündigung
- [ ] Wirkung der Führungspositionen
- [ ] Entscheidungslogik der KI-Firmen, die auf Preise der Spieler reagiert
- [ ] Branchenbesonderheiten (Rohstoffpreis bei Energie, Lohnkosten bei Logistik)

### UI

- [ ] Gründungsassistent: Branche → Name → Pixel-Logo-Editor → Farbe → Rechtsform → Finanzierung → Zusammenfassung
- [ ] Pixel-Logo-Editor 16×16 mit Palette, Stift, Radierer, Füllen, Spiegeln, Rückgängig
- [ ] Firmen-Dashboard: Umsatz, Gewinn, Cash, Burn-Rate, Marktanteil gegen Konkurrenz
- [ ] Abteilungen mit Quartalsentscheidungen und Vorschau der Kosten
- [ ] Mitarbeiter und Bewerber
- [ ] Kreditdialog mit Zins und Rahmen
- [ ] Quartalsberichte mit Verlauf
- [ ] Warnungen vor Insolvenz, Insolvenz-Ablauf
- [ ] Firmenfarbe färbt Firmenseite und Chart-Akzent
- [ ] Erfolge der Kategorie Unternehmen (soweit ohne IPO erreichbar)

### Tests

- [ ] Vitest: Marktanteile summieren zu 1. Preissenkung einer Firma senkt den Umsatz der anderen.
      Kapazitätsgrenze. Marketing-Grenznutzen. Insolvenzbedingung. Kreditzins.
- [ ] Vitest: Simulation über 40 Quartale mit Standardentscheidungen bleibt stabil (keine Firma wächst
      unbegrenzt, KI-Firmen gehen nicht reihenweise pleite)
- [ ] Datenbanktest: Quartalsabschluss ist idempotent und verarbeitet jede Firma genau einmal
- [ ] Playwright: Gründungsassistent bis zur fertigen Firma

### Abnahmekriterien

- Ein Spieler unter Level 10 sieht im Unternehmen-Tab, was ihm fehlt. Ab Level 10 startet der Assistent.
- Nach dem Assistenten existiert die Firma mit eigenem Logo. 15.000 € sind vom Privatkonto abgebucht.
- Das Logo erscheint in Listen und auf der Firmenseite.
- Nach einem Quartalsabschluss gibt es einen Bericht mit Umsatz, Kosten, Gewinn und Marktanteil.
- Senkt der Spieler den Preis deutlich, steigt sein Marktanteil im nächsten Quartal, und der einer KI-Firma
  der Branche sinkt sichtbar.
- Ein neu eingestellter Mitarbeiter bringt erst nach der Einarbeitung volle Kapazität.
- Verdoppeltes Marketingbudget bringt erkennbar weniger als doppelte Bekanntheit.
- Eine Firma, die 2 Quartale ihre Kosten nicht deckt, wird insolvent. Der Gründer kann danach 3 Tage nicht gründen.
- Zwei Spielerfirmen in derselben Branche nehmen sich gegenseitig Marktanteile ab.

### Hauptrisiko

Balancing der Unternehmenssimulation: eine dominante Strategie (z. B. immer der niedrigste Preis) oder
Spielerfirmen, die KI-Firmen in wenigen Quartalen verdrängen. Gegenmittel: Simulationsläufe mit festen
Strategien als Tests, Kapazitätsgrenze und Fixkosten als Bremse, Exponenten in `game_config` änderbar.

Zweites Risiko: Umfang. M4 ist der größte Meilenstein. Er kann nach dem Dashboard geteilt werden in M4a
(Gründung, Simulation, Entscheidungen) und M4b (Mitarbeiter, Kredite, Insolvenz).

### Abschluss

- [ ] Deploy auf Vercel
- [ ] Tests der Unternehmenssimulation grün
- [ ] Changelog-Notiz „M4“

---

## M5 Sozial

**Ziel:** Spieler arbeiten füreinander, beteiligen sich aneinander und bekommen mit, was die anderen tun.
Daraus entstehen Kooperation und Konflikte.

**Abhängigkeiten:** M4 (Firmen, Cap Table, Mitarbeiter), M3 (Jobs, Gehalt, Erfahrung).

**Vor dem Start zu entscheiden:** Fragen 1, 3, 23.

### Daten/Backend

- [ ] Jobangebote zwischen Spielern: anbieten, annehmen, ablehnen, kündigen
- [ ] Führungsrollen mit Rechten: CFO darf Liquidität und Kredite verwalten, Vertriebsleitung Kampagnen und
      Preisaktionen
- [ ] Aktienoptionen mit Vesting über 4 Quartale
- [ ] Vorteile der Spielerfirma: XP 1,5×, Erfahrung 2×, Erfolgsbonus nach Firmengewinn
- [ ] Business Angels: Angebote, Annahme, Cap Table. KI-Business-Angels als Ersatz. Spieler ab Level 15.
- [ ] Freundesliste, Freundes-Feed aus Spielereignissen
- [ ] Insider-Regel: Vorabsicht der Quartalszahlen, Sperrfenster 2 Stunden, KI-Finanzaufsicht mit Strafe und
      Reputationsverlust
- [ ] Reputation als Wert je Spieler (die volle Wirkung folgt in M6)
- [ ] Abwerben von Mitarbeitern zwischen Spielerfirmen
- [ ] Rettungsübernahme durch einen Spieler

### Simulation

- [ ] Doppelte Produktivität von Spieler-Mitarbeitern
- [ ] Bewertung einer privaten Firma für Business-Angel-Runden
- [ ] Angebotslogik der KI-Business-Angels
- [ ] Entdeckungswahrscheinlichkeit der Finanzaufsicht
- [ ] Vesting-Berechnung

### UI

- [ ] Jobbörse zeigt Stellen bei Spielerfirmen mit ihren Vorteilen
- [ ] Angebots-Postfach für Job-, Business-Angel- und Übernahmeangebote
- [ ] Ansicht für Führungsrollen in fremden Firmen mit den erlaubten Entscheidungen
- [ ] Cap Table mit mehreren Anteilseignern
- [ ] Freundes-Feed auf der Startseite, Profile anderer Spieler
- [ ] Sperrfenster-Hinweis in der Order-Maske für Insider
- [ ] Globale Suche nach Spielern und Firmen

### Tests

- [ ] Vitest: Vesting, Entdeckungswahrscheinlichkeit, Produktivität, Bewertung
- [ ] Datenbanktest: Ein CFO kann nur die erlaubten Aktionen der fremden Firma ausführen. Ein Spieler ohne
      Rolle kann nichts ändern.
- [ ] Datenbanktest: Vorabzahlen sind nur für Mitarbeiter der Firma lesbar
- [ ] Playwright mit zwei Accounts: Jobangebot senden und annehmen

### Abnahmekriterien

- Spieler A bietet Spieler B eine Stelle an. B nimmt an und erscheint als Mitarbeiter in A's Firma.
- B als CFO kann einen Kredit für A's Firma aufnehmen, aber keine Preise ändern.
- B bekommt Gehalt und sieht seine Optionen mit Vesting-Fortschritt.
- B sieht die Quartalszahlen vor der Veröffentlichung und kann im Sperrfenster nicht regulär mit der Aktie
  handeln (relevant ab M6, in M5 mit privaten Anteilen prüfbar).
- Ein Business-Angel-Angebot verändert nach Annahme den Cap Table, das Geld liegt auf dem Firmenkonto.
- Ohne andere Spieler bekommt eine Firma ein Angebot von einem KI-Business-Angel.
- Der Feed zeigt Ereignisse der Freunde (großer Gewinn, Gründung, Jobwechsel).
- B kann kündigen und bei einer Konkurrenzfirma anfangen. A wird benachrichtigt.

### Hauptrisiko

Mit 4 Spielern kommen die sozialen Mechaniken zu selten vor oder verlangen gleichzeitige Anwesenheit.
Gegenmittel: Alles läuft asynchron über Angebote mit Frist, und jede Rolle hat einen KI-Ersatz.

Zweites Risiko: Rechte in fremden Firmen sind eine neue Angriffsfläche. Gegenmittel: Rollenprüfung in jedem
RPC und eigene Datenbanktests dafür.

### Abschluss

- [ ] Deploy auf Vercel
- [ ] Tests der Vesting-, Insider- und Rechte-Logik grün
- [ ] Changelog-Notiz „M5“

---

## M6 Börsengang

**Ziel:** Spielerfirmen gehen über Prospekt und Bookbuilding an die Börse, werden wie KI-Aktien gehandelt und
stehen danach unter Beobachtung durch Reputation, Guidance und Hauptversammlung.

**Abhängigkeiten:** M4 (Firmen mit Historie, CFO), M5 (Cap Table mit mehreren Eignern, Reputation, Insider-Regel),
M1 (Handel, Indexfonds, NEXA 30).

**Vor dem Start zu entscheiden:** Fragen 5, 12, 13, 15.

### Daten/Backend

- [ ] IPO-Checkliste: 4 Quartale Historie, Mindestumsatz, positive Reputation, CFO, Level 25
- [ ] Prospekt mit Umsatzprognose für 4 Quartale, Mittelverwendung in Prozent, Lock-up (Standard 4 Quartale),
      Anteil ausgegebener Aktien
- [ ] Bookbuilding: Preisspanne der KI-Emissionsbank, Zeichnungsfrist 1 Quartal, Zeichnung durch Spieler und KI-Fonds
- [ ] Zuteilung und Erstnotiz bei Überzeichnung, geplatzter IPO bei Unterzeichnung
- [ ] Begrenzung der Zeichnung durch neue Accounts
- [ ] Listing: Die Spielerfirma wird ein handelbares Instrument mit Tick, Kerzen und Orderbuch
- [ ] Lock-up technisch gesperrt
- [ ] Automatische Prüfung der Prospektangaben
- [ ] Guidance je Quartal, Reputation aus allen Faktoren der Tabelle in `GAME_DESIGN.md`, Abschnitt 10
- [ ] Dividende mit Ex-Tag und Auszahlung zum Quartalsende (auch für KI-Firmen), Aktienrückkauf, Kapitalerhöhung
- [ ] Hauptversammlung: Abstimmung über Dividende und Abberufung des CEO (> 50 %)
- [ ] Aufnahme in den NEXA 30 mit Kauf durch Indexfonds
- [ ] 5.000 XP für einen erfolgreichen IPO
- [ ] Ausübung gevesteter Optionen in handelbare Aktien

### Simulation

- [ ] Preisspanne aus Fundamentaldaten und Reputation
- [ ] Zeichnungsnachfrage der KI-Fonds
- [ ] Reputationsfaktor 0,6 bis 1,4 im fairen Wert
- [ ] Reputationsänderung je Ereignis (Guidance-Abweichung, Lock-up, Dividende, Kapitalerhöhung, Mittelverwendung)
- [ ] Verwässerung bei Kapitalerhöhung
- [ ] Index-Neuzusammensetzung und Nachfrageschub bei Aufnahme
- [ ] Stimmverhalten der KI-Aktionäre

### UI

- [ ] IPO-Checkliste mit Fortschritt im Firmen-Dashboard
- [ ] Prospekt-Assistent
- [ ] Zeichnungsseite mit Preisspanne, Countdown und Zeichnungsstand
- [ ] Inszenierung der Erstnotiz
- [ ] Aktien-Detail für Spielerfirmen: Gründer, Reputation, Cap Table, Prospekt-Erfüllung
- [ ] Guidance-Eingabe und Anzeige der Trefferquote
- [ ] Dialoge für Dividende, Rückkauf, Kapitalerhöhung
- [ ] Hauptversammlung mit Abstimmung
- [ ] Filter „nur Spielerfirmen“ und Dividende, Markierung in Gewinner- und Verliererlisten
- [ ] Erfolge „Glockenschläger“, „Index-Aufsteiger“ und weitere

### Tests

- [ ] Vitest: Preisspanne, Zuteilung bei Über- und Unterzeichnung, Reputationsregeln, Verwässerung,
      Index-Neuzusammensetzung
- [ ] Datenbanktest: Die Summe der Aktien im Cap Table stimmt vor und nach dem IPO. Der Emissionserlös liegt
      vollständig auf dem Firmenkonto. Verkauf im Lock-up schlägt fehl.
- [ ] Playwright mit zwei Accounts: Prospekt anlegen, zeichnen, nach der Erstnotiz handeln

### Abnahmekriterien

- Die Checkliste zeigt jederzeit, welche Voraussetzung fehlt. Der IPO lässt sich erst starten, wenn alle erfüllt sind.
- Während der Zeichnungsfrist können andere Spieler zeichnen. Der Stand ist sichtbar.
- Bei Überzeichnung wird die Aktie handelbar, der Gründer erhält 5.000 XP, und der Feed meldet den IPO.
- Bei Unterzeichnung platzt der IPO, Zeichner bekommen ihr Geld zurück, und die Reputation des Gründers sinkt.
- Der Gründer kann seine Aktien im Lock-up nicht verkaufen.
- Verfehlt der Gründer seine Guidance um mehr als 30 %, sinkt die Reputation sichtbar, und der Kurs reagiert.
- Eine Dividende kommt zum Quartalsende bei allen Aktionären an, auch bei KI-Aktien.
- Eine Kapitalerhöhung senkt den Anteil der Altaktionäre im Cap Table.
- Wird eine Spielerfirma in den NEXA 30 aufgenommen, gibt es ein Event, und der Kurs steigt.
- Ein IPO gelingt auch, wenn kein anderer Spieler zeichnet.

### Hauptrisiko

Ausnutzbare Regeln rund um den IPO: Spieler zeichnen gegenseitig, um Kurse zu treiben, oder die
KI-Nachfrage macht jeden IPO zum sicheren Gewinn. Gegenmittel: KI-Nachfrage strikt an Fundamentaldaten und
Reputation, Zeichnungsgrenzen, Simulationsläufe mit absichtlich schlechten Firmen.

### Abschluss

- [ ] Deploy auf Vercel
- [ ] Tests der IPO- und Reputationslogik grün
- [ ] Changelog-Notiz „M6“

---

## M7 Risiko

**Ziel:** Short, Hebel, Margin Call, Liquidation und Bankrott funktionieren fair und nachvollziehbar, und
Events wie Pharma-Studien und Zinsentscheide machen den Markt unruhiger.

**Abhängigkeiten:** M1 (Handel, Preis-Impact), M2 (Level-Freischaltungen, Benachrichtigungen). Spieler-IPO-Hype
setzt M6 voraus, ist aber keine technische Abhängigkeit.

**Vor dem Start zu entscheiden:** Fragen 2, 6, 10, 11, 22.

### Daten/Backend

- [ ] Short ab Level 8 mit Sicherheit und Leihgebühr
- [ ] Hebel 2× (Level 12), 5× (Level 18), 10× (Level 30) mit Margin-Konto
- [ ] Finanzierungskosten über Nacht für Hebel- und Short-Positionen
- [ ] Margin-Prüfung in jedem Tick, Warnung bei Annäherung, automatische Liquidation in derselben Transaktion
- [ ] Spielerbankrott: Wiedereinstieg mit 2.500 € (ADR-011), Status „Pleitegeier“, Reputationsverlust
- [ ] Event-Kalender mit geplanten Events: Zinsentscheid, Pharma-Studienergebnis, Ölpreis-Report
- [ ] Zufällige Makro-Events: Branchenkrise, Rohstoffschock, Konjunkturdelle, Tech-Boom
- [ ] Nachrichten aus Events über Textvorlagen
- [ ] Admin: Events von Hand auslösen

### Simulation

- [ ] Liquidationspreis je Position
- [ ] Zentralbank-KI: Leitzins nach Geldmenge, Ankündigung mit Countdown
- [ ] Rotation der Rentenfonds zwischen Aktien und Anleihen
- [ ] Binäres Pharma-Event mit ±50 bis 70 %
- [ ] Ölpreis als Größe mit Wirkung auf Energie (positiv) und Logistik (negativ)
- [ ] Kleinanleger-Herde reagiert auf News-Sentiment
- [ ] Volatilität der Pennystocks bis ±30 % am Tag

### UI

- [ ] Order-Maske mit Short und Hebel, Liquidationspreis und laufenden Kosten vor dem Absenden
- [ ] „Zum Kaufen halten“ für große oder gehebelte Orders
- [ ] Portfolio: offene Hebelpositionen, Liquidationspreis in Rot
- [ ] Margin-Call-Warnung: pulsierender roter Rand, leichtes Schütteln, Warnsound, Benachrichtigung
- [ ] Liquidations- und Bankrott-Ablauf mit klarer Erklärung
- [ ] Event-Leiste mit Countdowns auf der Startseite, Event-Kalender
- [ ] Erfolge „All In“, „Totalverlust“, „Bärenjäger“, „Studienglück“ und weitere

### Tests

- [ ] Vitest: Liquidationspreis für Long und Short je Hebel, Finanzierungskosten, Zentralbankregel,
      Verteilung des Pharma-Events
- [ ] Vitest: Ein Kurssprung über den Liquidationspreis hinaus erzeugt eine definierte Restschuld
- [ ] Datenbanktest: Liquidation und gleichzeitige Spieler-Order auf derselben Position führen nicht zu
      doppeltem Verkauf. Ledger-Summe bleibt 0.
- [ ] Playwright: gehebelte Position öffnen, Liquidationspreis sichtbar

### Abnahmekriterien

- Unter Level 8 ist Short sichtbar gesperrt, ab Level 8 nutzbar. Dasselbe gilt für Hebel 2× ab Level 12.
- Vor dem Absenden einer gehebelten Order steht der Liquidationspreis in der Maske. Danach steht er rot im Portfolio.
- Nähert sich der Kurs dem Liquidationspreis, kommt eine Warnung, auch wenn eine andere Seite offen ist.
- Erreicht der Kurs den Liquidationspreis, wird die Position automatisch geschlossen, und der Spieler wird
  benachrichtigt.
- Eine über Nacht gehaltene Hebelposition zeigt am nächsten Tag Finanzierungskosten in der Historie.
- Ein Short auf eine fallende Aktie bringt Gewinn, auf eine steigende Verlust.
- Ein bankrotter Spieler hat danach 2.500 € und den Status „Pleitegeier“ und kann weiterspielen.
- Ein Zinsentscheid hat einen Countdown. Nach einer Erhöhung fällt der NEXA 30 sichtbar.
- Ein Pharma-Studienergebnis bewegt die betroffene Aktie um 50 bis 70 % nach oben oder unten.

### Hauptrisiko

Fehler bei Margin und Liquidation erzeugen oder vernichten Geld (negative Konten, doppelte Liquidation,
Kurslücken). Gegenmittel: Liquidation ausschließlich im Tick-RPC in einer Transaktion, feste Regel für
Restschulden, Ledger-Prüfung nach jedem Testlauf.

Zweites Risiko: Der 5-Sekunden-Tick macht Liquidationen grob. Gegenmittel: Warnschwelle früh setzen, und die
Ausführung erfolgt zum Tick-Kurs, nicht zum Liquidationspreis.

### Abschluss

- [ ] Deploy auf Vercel
- [ ] Tests der Margin-, Liquidations- und Event-Logik grün
- [ ] Changelog-Notiz „M7“

---

## M8 Feinschliff

**Ziel:** Das Spiel ist für einen mehrwöchigen Freundestest rund: Lebensstil, Zufallsereignisse, Avatar,
Web-Push, Sounds und eine flüssige Oberfläche auf Mittelklasse-Handys.

**Abhängigkeiten:** M0 bis M7.

**Vor dem Start zu entscheiden:** Fragen 18, 19.

### Daten/Backend

- [ ] Lebensstil: Kauf von Rolex (25.000 €), Porsche (150.000 €), Penthouse (1,5 Mio. €), Privatjet
      (20 Mio. €), Insel (100 Mio. €), laufender Unterhalt über das Systemkonto `upkeep`, Penthouse-Bonus
- [ ] Zufallsereignisse: Erbschaft (+5.000 €), Steuerprüfung (−3 % Cash), Headhunter (+30 % Gehalt),
      Tipp aus dem Golfclub (60 % richtig)
- [ ] Avatar-Baukasten: Teile und Freischaltung über Level und Erfolge
- [ ] Profilrahmen und Titel
- [ ] Web-Push: Abonnements, Versand für Tresor voll, Margin Call, Quartalszahlen eigener Aktien, Jobangebot,
      Event startet. Einzeln abschaltbar, Obergrenze pro Tag.
- [ ] Admin-Bereich vollständig: Konfiguration ändern, Events auslösen, Zeit vorspulen, Spieler zurücksetzen
- [ ] Optionale Spielzeit-Statistik
- [ ] Protokoll verdächtiger Muster einsehbar
- [ ] Restliche Erfolge, sodass mindestens 40 erreichbar sind

### Simulation

- [ ] Auslösung der Zufallsereignisse mit Häufigkeitsgrenzen je Spieler
- [ ] Durchsicht des Geldflusses mit echten Alpha-Daten: Quellen gegen Senken, Anpassung der Werte in `game_config`
- [ ] Prüfung des Balancing-Ziels: Zocker gewinnen gelegentlich groß, fundierte Spieler liegen langfristig vorne

### UI

- [ ] Lebensstil-Galerie mit Pixel-Art
- [ ] Avatar-Baukasten (Kopf, Frisur, Outfit, Accessoire)
- [ ] Sounds über Howler für Trade, Tresor, Level-up, Margin Call, Glocke. Global stummschaltbar.
- [ ] Haptik über `navigator.vibrate`, wo verfügbar
- [ ] Pixel-Konfetti und teilbare Gewinnkarte bei großen Gewinnen
- [ ] Shared-Element-Übergang von der Aktienliste zum Detail
- [ ] Tastaturkürzel `B`, `S`, `/`
- [ ] App-Akzentfarbe und Chart-Stil (Kerzen, Linie, Fläche)
- [ ] PWA vollständig: Service Worker, Installationshinweis
- [ ] Durchgang durch alle Seiten: leere Zustände, Skeletons, Fehlerzustände, Kontraste nach WCAG AA
- [ ] Performance: 60 fps bei Kurs-Ticks, Lighthouse Performance ≥ 90 auf Mobilgeräten

### Tests

- [ ] Vitest: Unterhalt, Wahrscheinlichkeiten der Zufallsereignisse, Trefferquote des Golfclub-Tipps
- [ ] Playwright: kritische Flows aller Meilensteine als Regressionssuite
- [ ] Lighthouse-Lauf mobil, Test auf einem echten Mittelklasse-Handy
- [ ] Test mit eingeschaltetem `prefers-reduced-motion` und abgeschalteten Sounds

### Abnahmekriterien

- Ein gekauftes Statussymbol ist im eigenen und im fremden Profil sichtbar. Der Unterhalt wird abgebucht und
  in der Historie ausgewiesen.
- Zufallsereignisse treten auf, sind als solche erkennbar und nirgends kaufbar.
- Der Avatar lässt sich zusammenstellen. Gesperrte Teile zeigen, wie man sie bekommt.
- Die App lässt sich auf dem Handy installieren. Eine Push-Nachricht „Tresor voll“ kommt an und lässt sich
  einzeln abschalten.
- Mit ausgeschalteten Sounds und Animationen bleibt die App vollständig bedienbar.
- Auf einem Mittelklasse-Handy ruckelt die Aktien-Detailseite bei laufenden Ticks nicht.
- Lighthouse mobil zeigt Performance ≥ 90.
- Der Admin kann einen Wert in der Konfiguration ändern, und er wirkt ohne Deploy.
- Vier Freunde spielen eine Woche ohne Eingriff des Admins in die Datenbank.

### Hauptrisiko

Feinschliff hat kein natürliches Ende. Gegenmittel: fester Umfang nach obiger Liste, alles Weitere kommt auf
die Liste „Nach M8“.

Zweites Risiko: Web-Push auf iOS funktioniert nur in der installierten PWA und ist fehleranfällig. Das Spiel
darf nicht davon abhängen. In-App-Benachrichtigungen bleiben der Standardweg.

### Abschluss

- [ ] Deploy auf Vercel als „Freundestest v1“
- [ ] Tests der neuen Logik und Regressionssuite grün
- [ ] Changelog-Notiz „M8“ mit Zusammenfassung aller Meilensteine

---

## Nach M8

Funktionen aus dem Prompt, die zum Spiel gehören, aber in keinem Meilenstein M0 bis M8 stehen. Sie werden
nach dem Freundestest v1 eingeplant (Frage 24).

| Funktion                                                      | Freischaltung | Voraussetzung              |
| ------------------------------------------------------------- | ------------- | -------------------------- |
| Optionen (Calls/Puts)                                         | Level 30      | M7                         |
| Übernahmen und feindliche Übernahmeangebote                   | Level 35      | M6                         |
| Holding: mehrere Firmen gleichzeitig                          | Level 40      | M4                         |
| Hall of Fame, Titel „Börsenlegende“, goldener Profilrahmen    | Level 50      | M2                         |
| Pixel-Logo-Editor in 24×24                                    | –             | M4                         |
| Automatische Multi-Account-Erkennung auf Basis des Protokolls | –             | M8                         |
| Eigener Worker statt Edge Function für den Tick (ADR-004)     | –             | bei wachsender Spielerzahl |
| OAuth-Anmeldung und offene Registrierung (ADR-010)            | –             | nach der Alpha             |

---

## Nicht im MVP

Bewusst ausgeschlossen. Nichts davon wird in M0 bis M8 gebaut. Die mit „nie“ markierten Punkte sind harte
Rahmenbedingungen und auch später ausgeschlossen.

| Thema                                                                           | Status                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Echtgeld, Auszahlung, Kauf von Spielgeld                                        | **nie**                                                   |
| In-App-Käufe mit Einfluss auf Geld, Aktien oder XP                              | **nie**                                                   |
| Bezahlte Zufallsboxen, Countdown-Kaufangebote                                   | **nie**                                                   |
| Kosmetische Käufe                                                               | später denkbar, Architektur lässt es zu                   |
| Chat (mit Moderation)                                                           | später                                                    |
| Fiktive Staaten mit Ausfallrisiko (z. B. „Republik Valdorien, 9 %, Rating CCC“) | später                                                    |
| Rohstoffe als handelbarer Markt                                                 | später. Im MVP ist der Ölpreis nur eine Simulationsgröße. |
| Prestige-System nach Level 50                                                   | später                                                    |
| Zweite Sprache                                                                  | später, i18n ist vorbereitet (ADR-002)                    |
| Native Apps in den Stores                                                       | später, im MVP nur PWA                                    |
| Bruchstücke von Aktien                                                          | später (ADR-003)                                          |
| Öffentliche Registrierung ohne Einladungscode                                   | nach der Alpha (ADR-010)                                  |
| Optionen, Übernahmen, Holding, Hall of Fame                                     | nach M8, siehe oben                                       |
