# Entscheidungen und Annahmen (ADRs)

Kurze Architecture Decision Records. Jede Entscheidung hat einen Status
(`akzeptiert`, `Annahme` = von Claude getroffen und vom Auftraggeber noch zu bestätigen, `offen`).
Neue Entscheidungen unten anhängen, alte nicht umschreiben, sondern mit einem neuen ADR ablösen.

Quelle aller Anforderungen: [`ORIGINAL_PROMPT.md`](./ORIGINAL_PROMPT.md).

---

## ADR-001: Keine Rückfragen, sondern dokumentierte Annahmen — `Annahme`

Der Prompt ist detailliert genug. Statt Rückfragen wurden die offenen Punkte als Annahmen
entschieden (ADR-004, -006, -010, -011, -014, -015, -016). Alle sind reversibel, solange M1 nicht begonnen hat.

## ADR-002: Stack wie vorgegeben, mit aktuellen Hauptversionen — `akzeptiert`

Next.js 16 (App Router, Turbopack, `cacheComponents`), React 19, TypeScript strict, Tailwind CSS 4,
Radix UI, Motion, Lightweight Charts 5, Zustand, TanStack Query, Supabase, Zod 4, Howler, Vitest, Playwright.
Paketmanager: **pnpm**.

Abweichungen/Präzisierungen:

- **Tailwind 4 ist CSS-first.** Es gibt keine `tailwind.config.ts`; die Tokens stehen als CSS-Variablen in
  `src/styles/tokens.css` und werden über `@theme inline` in `src/app/globals.css` zu Utilities.
- **shadcn/ui als Muster, nicht als CLI.** Wir nutzen die Radix-Primitives (`radix-ui`), `vaul` (Bottom Sheet)
  und `sonner` (Toasts) direkt und stylen sie komplett selbst. So bleibt kein fremdes Standard-Styling im Projekt.
- **Schriften** kommen aus den npm-Paketen `@fontsource-variable/inter` und `@fontsource/silkscreen`
  (beide OFL) und werden damit selbst gehostet, ohne Zugriff auf Google-Server zur Build- oder Laufzeit.
- **i18n:** `next-intl` ohne Locale-Präfix in der URL. Texte liegen in `messages/de.json`. Eine zweite Sprache
  ist später nur eine weitere JSON-Datei plus Locale-Erkennung.

## ADR-003: Geld in Cent, Kurse in Zehntausendstel Euro — `akzeptiert`

- **Geldbeträge:** `bigint` in Cent (`*_cents`). In TypeScript als `bigint` bzw. beim Transport als String.
- **Kurse:** `bigint` mit fester Skalierung **1 € = 10 000** (`*_e4`, vier Nachkommastellen).
  Grund: Pennystocks unter 1 € brauchen feinere Schritte als 1 Cent (bei 0,20 € wäre ein Cent-Schritt 5 %).
  Vier Stellen reichen für Renditen, Zinsen und Anleihekurse und bleiben exakt.
- **Orderwert:** `value_cents = round_half_even(quantity × price_e4 / 100)`. Gerundet wird genau einmal,
  beim Übergang von Kurs zu Geld. Die Rundungsdifferenz trägt das Systemkonto „Markt“.
- **Sätze** (Zinsen, Steuern, Gebühren in Prozent): Basispunkte als `integer` (`*_bps`, 1 bp = 0,01 %).
- **Stückzahlen:** ganze Aktien als `bigint`. Keine Bruchstücke im MVP.
- **Simulationsgrößen ohne Geldcharakter** (Qualität, Bekanntheit, Sentiment, Attraktivität): `double precision`
  bzw. `number`. Das Verbot von Floats gilt für Geld, nicht für Modellgrößen.

## ADR-004: Markt-Tick als Edge Function im Minuten-Loop — `Annahme`

Vorgabe: Tick alle 5 bis 10 Sekunden, serverseitig.

**Entscheidung:** `pg_cron` ruft einmal pro Minute über `pg_net` die Edge Function `tick-runner` auf.
Diese läuft etwa 60 Sekunden und führt alle **5 Sekunden** einen Tick aus (12 Ticks pro Aufruf):

1. Zustand lesen (ein RPC, ein Roundtrip),
2. neuen Zustand mit den reinen Funktionen aus `src/lib/sim` berechnen,
3. über den RPC `apply_market_tick(jsonb)` in **einer** Transaktion schreiben
   (Kurse, Ticks, Kerzen, fällige Limit-/Stop-Orders),
4. Snapshot per Realtime **Broadcast** an alle Clients senden.

Ein Lease in `sim_runtime` (Postgres Advisory Lock + Ablaufzeit) verhindert doppelte Runner.

Warum nicht die Alternativen:

| Variante                                             | Problem                                                                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pg_cron` im Sekundenintervall + PL/pgSQL-Simulation | Simulation wäre in SQL statt TypeScript: nicht mit Vitest testbar, nicht mit der Client-Vorschau teilbar                                      |
| `pg_cron` alle 5 s → Edge Function                   | Etwa 520 000 Aufrufe pro Monat, das sprengt das Supabase-Free-Kontingent (500 000). Der Minuten-Loop braucht etwa 43 000                      |
| Eigener Worker (Fly, Railway)                        | Zusätzliche Infrastruktur. Sinnvoll, sobald viele Spieler da sind: Der Runner ist so gebaut, dass er unverändert als Node-Prozess laufen kann |

Geldkritische Logik (Order annehmen, ausführen, buchen) bleibt in **PL/pgSQL-Funktionen** in der Datenbank.
Die TypeScript-Simulation bestimmt Kurse und KI-Verhalten, bucht aber selbst nie Spielergeld.

## ADR-005: KI-Investoren als aggregierter Orderfluss, nicht als Einzelorders — `Annahme`

Jeder KI-Investortyp erzeugt pro Tick und Aktie einen **Netto-Nachfragedruck** (Stück), der über die
Preis-Impact-Funktion auf den Kurs wirkt. Bestände der KI-Investoren werden aggregiert je Typ und Aktie geführt.
Das Orderbuch zeigt synthetische Marktmacher-Stufen rund um den Mittelkurs plus die echten Limit-Orders der Spieler.
Spieler handeln gegen diese Quotes und gegeneinander.

Grund: Tausende Einzelorders pro Tick wären teuer und brächten spielerisch nichts. Der aggregierte Ansatz liefert
dieselben sichtbaren Effekte (Liquidität, Trends, Übertreibung, Zinsrotation) deterministisch und testbar.

## ADR-006: Spielzeit an Berliner Wanduhr, Quartale um 08, 14, 20 und 02 Uhr — `Annahme`

- 1 Quartal = 6 Stunden, 4 Quartale = 1 Spieljahr = 1 echter Tag.
- Quartalsgrenzen: **08:00, 14:00, 20:00, 02:00** (Europe/Berlin). Damit fallen drei von vier Abschlüssen in
  die Börsenzeit, und das erste Quartal des Tages beginnt mit der Eröffnungsglocke.
- Quartale sind explizite Zeilen in `game_quarters` mit `starts_at`/`ends_at`. Bei Zeitumstellung ist ein
  Quartal einmalig 5 bzw. 7 Stunden lang. Spielzeit wird nie aus der Uhrzeit „ausgerechnet“, sondern aus dieser Tabelle gelesen.
- Der Admin kann über einen Zeitversatz in `sim_runtime` vorspulen (Tests).

## ADR-007: Doppelte Buchführung als Ledger — `akzeptiert`

Drei Tabellen: `ledger_accounts`, `ledger_transactions`, `ledger_entries`. Jede Transaktion hat mindestens zwei
Buchungszeilen, deren Summe 0 ergibt (per Constraint-Trigger geprüft). Einträge sind unveränderlich
(kein `UPDATE`/`DELETE`, Korrektur nur per Gegenbuchung). Der Kontostand in `ledger_accounts.balance_cents` ist ein
per Trigger mitgeführter Cache und jederzeit aus den Einträgen rekonstruierbar.

Systemkonten machen Quellen und Senken sichtbar: `mint` (Grundeinkommen, Boni), `payroll`, `fees`, `taxes`,
`market` (Gegenpartei der KI), `upkeep`, `interest`. Daraus speist sich die Geldmengenmessung der Zentralbank.

## ADR-008: Server-Autorität über RPCs, Client nur mit Leserechten — `akzeptiert`

- RLS auf allen Tabellen. Clients haben **keine** direkten Schreibrechte auf spielrelevante Tabellen.
- Jede Spieleraktion ist ein `SECURITY DEFINER`-RPC (`place_order`, `claim_vault`, …) mit Zod-validierter
  Eingabe im Client und erneuter Prüfung in der Funktion.
- Jede schreibende Aktion nimmt eine `request_id` (UUID vom Client) und ist damit idempotent.
- Geldbewegungen sperren das betroffene Konto (`SELECT … FOR UPDATE` in fester Reihenfolge), um Race Conditions
  und Deadlocks zu vermeiden.
- Öffentliche Daten laufen über Views im Schema `public`, die nur unkritische Spalten zeigen.
- Simulationsinterna (fairer Wert, Sentiment, KI-Bestände) liegen in Tabellen, die nur `service_role` lesen darf.
  Sonst könnten Spieler den Kursanker einfach auslesen.

## ADR-009: Balancing zentral und zur Laufzeit änderbar — `akzeptiert`

`src/config/balance.ts` enthält alle Startwerte, typisiert und ohne Abhängigkeiten. Daraus erzeugt
`pnpm db:config` die Seed-Datei für die Tabelle `game_config` (ein JSON-Dokument je Bereich). Zur Laufzeit gilt
die Tabelle, die der Admin ändern kann; `balance.ts` ist Standardwert und Typdefinition.

## ADR-010: Anmeldung mit E-Mail und Passwort, geschlossene Alpha per Einladungscode — `Annahme`

Supabase Auth mit E-Mail + Passwort. Registrierung verlangt einen Einladungscode (Tabelle `invite_codes`) und
die Bestätigung „Ich bin mindestens 18 Jahre alt“. Für vier Freunde ist das die einfachste Lösung ohne
E-Mail-Versand-Limits von Magic Links. OAuth kann später ergänzt werden.

## ADR-011: Startkapital 10 000 € — `Annahme`

Der Prompt nennt kein Startkapital. 10 000 € erlauben vom ersten Moment an sinnvolle Trades, während das
Grundeinkommen (800 € pro vollem Tresor) spürbar bleibt. Wiedereinstieg nach Bankrott: 2 500 €.

## ADR-012: Reine Simulationsfunktionen in `src/lib/sim` — `akzeptiert`

`src/lib/sim` und `src/config/balance.ts` enthalten nur reines TypeScript ohne npm-Abhängigkeiten, ohne
Pfad-Aliase und mit relativen Importen inklusive `.ts`-Endung. Damit läuft derselbe Code in Next.js, in Vitest
und in Supabase Edge Functions (Deno). Zufall kommt immer aus einem übergebenen, seedbaren Generator,
nie aus `Math.random()`. So sind Ticks reproduzierbar und testbar.

## ADR-013: Echtzeit über einen Broadcast-Kanal, gebündelt im Client — `akzeptiert`

Der Runner sendet pro Tick **eine** Nachricht auf `market:ticks` mit allen geänderten Kursen.
Private Ereignisse (Order ausgeführt, XP, Margin Call) kommen über `postgres_changes` auf der
Tabelle `notifications`, gefiltert per RLS. Der Client schreibt eingehende Ticks in einen Zustand-Store und
rendert höchstens einmal pro Animation-Frame.

## ADR-014: Die 15 KI-Unternehmen — `Annahme`

| Branche       | Bluechip                      | Mittelständler            | Pennystock                 |
| ------------- | ----------------------------- | ------------------------- | -------------------------- |
| Tech/Software | KlarSoft AG (`KLS`)           | Pixelwerk Studios (`PXW`) | QuantenSprung Labs (`QSL`) |
| Einzelhandel  | Brotzeit Handel AG (`BRZ`)    | Kaufrausch Märkte (`KFR`) | Fundgrube Discount (`FGD`) |
| Energie       | Volta Energie AG (`VLT`)      | Rheinkraft Werke (`RKW`)  | SolarFuchs (`SFX`)         |
| Pharma        | NeuroPharm AG (`NPH`)         | Alpenmed (`ALM`)          | GenoVita Biotech (`GNV`)   |
| Logistik      | Nordlicht Logistik AG (`NDL`) | Eilbote Express (`EBX`)   | Frachtpilot (`FPT`)        |

Alle Namen sind frei erfunden. Vor einem öffentlichen Release ist eine Markenrecherche nötig.

## ADR-015: Demo-Modus ohne Supabase-Zugangsdaten — `Annahme`

Fehlen `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`, startet die App im Demo-Modus:
alle Seiten sind ohne Anmeldung sichtbar und zeigen Beispieldaten aus `src/lib/demo`. So lässt sich die
Oberfläche prüfen und auf Vercel als Vorschau deployen, bevor ein Supabase-Projekt existiert.
Mit gesetzten Variablen sind alle Spielseiten geschützt.

## ADR-016: Arbeitstitel „NEXA“ — `Annahme`

Der Name steht nur an einer Stelle (`src/config/app.ts` und `messages/de.json`) und im Leitindex „NEXA 30“.

## ADR-017: Zugriffsmodell: spaltenreine Tabellen und `security_invoker`-Views — `akzeptiert`

Jede Tabelle hat genau eine Sichtbarkeitsklasse (`public_read`, `owner_read`, `custom`, `admin_read`, `internal`).
Gemischte Konzepte sind in mehrere Tabellen geteilt (z. B. `profiles` / `player_private` / `player_settings`,
`companies` / `company_state`). Öffentliche Sichten sind `security_invoker`-Views, es gibt keine Definer-Views.
Die Migration bricht ab, wenn eine Tabelle keine Klasse hat. Details in [`DATA_MODEL.md`](./DATA_MODEL.md).

## ADR-018: Standardmäßig geschlossen — `akzeptiert`

Die erste Migration entzieht `anon` und `authenticated` die Standardrechte von Supabase und `PUBLIC` das
Ausführungsrecht auf Funktionen. `anon` hat im Schema `public` keinerlei Rechte. Direkt schreibbar sind für
Spieler nur sieben eng begrenzte Stellen (Einstellungen, Watchlist, Lesemarken, Benachrichtigungs-Einstellungen,
Push-Abos). Admins lesen über RLS, schreiben aber nur über `admin_*`-RPCs; der erste Admin wird per SQL eingetragen.

## ADR-019: Ledger-Erweiterungen — `akzeptiert`

Zusätzlich zu ADR-007: je Spieler ein Reservekonto (`player_reserve`) für in Orders, IPO-Zeichnungen und Margin
gebundenes Geld; Systemkonten `bank`, `fines`, `economy`; Buchungszeilen nur in derselben Transaktion wie ihr
Kopf; `ledger_audit()` und `money_supply_cents()` für Prüfung und Zentralbank. Fachliche Fehler haben eigene
SQLSTATE-Codes `NX001` bis `NX009`, die der Client auf Texte abbildet.

## ADR-020: Spielkalender: Spieltag von 08:00 bis 08:00 Uhr — `Annahme`

Ein Spieltag (= ein Spieljahr) beginnt mit der Eröffnungsglocke um 08:00 Uhr Berlin. Die Epoche wird beim ersten
Aufruf von `ensure_game_quarters()` festgelegt. Davon getrennt wechseln **Tageslimits** (XP-Limits, Streak,
Missionen) um 00:00 Uhr Berlin.

## ADR-021: Kursdaten: Tagespartitionen und Aufbewahrungsfristen — `Annahme`

`price_ticks` ist nach Tag partitioniert und wird 3 Tage aufbewahrt. Kerzen: 1 min 7 Tage, 5 min 30 Tage,
1 h, Quartal und Jahr dauerhaft. `run_maintenance()` räumt täglich auf.

## ADR-022: Quartalsabschluss als eigener, stündlicher Runner — `Annahme`

Neben dem `tick-runner` (jede Minute) plant `pg_cron` einen `quarter-runner` (stündlich), der fällige Quartale
abschließt. Die Trennung hält den Tick schlank und macht den Abschluss unabhängig wiederholbar. URL und Secret
der Edge Functions liegen im Supabase Vault; ohne Konfiguration tun die Jobs nichts.

## ADR-023: Feste IDs für KI-Firmen — `akzeptiert`

Geseedete KI-Firmen und ihre Wertpapiere haben deterministische UUIDs (`md5('nexa:company:' || ticker)::uuid`),
damit Seeds, Tests und Demo-Daten dieselben Schlüssel verwenden.

## ADR-024: Registrierungsvertrag — `akzeptiert`

`supabase.auth.signUp` sendet in `options.data`: `invite_code`, `age_confirmed: true` und optional `nickname`
(3 bis 20 Zeichen, `A-Z a-z 0-9 _`). Der Trigger `handle_new_user()` prüft Code und Altersbestätigung, vergibt bei
belegtem Namen ein Zahlensuffix und bucht das Startkapital aus `game_config` → `economy.startingCapitalCents`.
Ein falscher Einladungscode kommt derzeit als allgemeiner Fehler zurück; eine genauere Meldung ist für M1 notiert.
Die mitgelieferten Einladungscodes in `seed.sql` sind Platzhalter und müssen vor dem Freundestest ersetzt werden.

## ADR-025: Kursbildung: linearer Preis-Impact, Value-Fonds als Anker — `Annahme`

- **Preis-Impact ist linear** in der Ordergröße: Eine „Markttiefe“ (0,2 % des Streubesitzes) bewegt den Kurs um 1 %.
  Linear heißt: Eine Order in viele kleine zu zerlegen bringt keinen Vorteil.
- Der Einfluss einer Spielerorder wirkt zur Hälfte sofort auf den Mittelkurs; die andere Hälfte baut der
  Marktmacher über rund 200 Ticks ab.
- Es gibt keinen eigenen Rückstellterm zum fairen Wert. Die Rückkehr entsteht durch den Value-Fonds. Die
  Verstärkung der Trendfolger muss unter 1 bleiben (ein Test erzwingt das), sonst schaukeln sich Kurse auf.
- KI-Aktivität skaliert mit der Liquidität der Handelsphase (nachbörslich weniger).
- Kurse werden stochastisch gerundet, damit Pennystocks nicht am Mindestkurs kleben.

## ADR-026: Unternehmenssimulation: Präzisierungen — `Annahme`

- Nachfrage, die eine Firma wegen ihrer Kapazität nicht bedienen kann, geht nach Attraktivität an die übrigen
  Firmen der Branche und verfällt erst, wenn alle ausgelastet sind.
- Branchennachfrage wird in Euro geführt (Stück = Umsatz / Preis).
- Makro-Events werden beim Quartalsabschluss angekündigt und wirken ab dem Folgequartal auf die Nachfrage.
- Guidance wird in beide Richtungen geprüft (auch deutliches Übertreffen kostet, damit niemand tiefstapelt).
- Finanzierungskosten für Hebel und Shorts laufen sekundengenau auf, es gibt keinen Stichzeitpunkt zum Umgehen.
- Der „Kleinkredit“ ab Level 15 ist eine Kreditlinie der Firma, abhängig vom Level des Gründers. Privatkredite
  gibt es nicht.

## ADR-027: Ergänzungen gegenüber dem Prompt — `akzeptiert` (mit Auflage, siehe ADR-029)

Die Simulation enthält Dinge, die der Prompt nicht nennt. Sie sind konfigurierbar und können entfallen:

| Ergänzung                                                         | Grund                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Preisband für Stückpreise                                         | Die Attraktivitätsformel ist skalenfrei; ohne Band verdienen Kleinstfirmen mit Boutique-Preisen unrealistisch viel |
| 15 % Unternehmenssteuer                                           | Zusätzliche Geldsenke                                                                                              |
| 25 % Abgeltung auch auf Kupons und Dividenden                     | Gleichbehandlung mit Kursgewinnen, Geldsenke                                                                       |
| Stufe „börsennotiert“ (bis 1000 Mitarbeiter, 120 000 € Fixkosten) | Der Prompt definiert Größen nur bis zur AG vor dem IPO                                                             |
| `progression.xpMultiplier` (Standard 1)                           | Stellschraube für das Lerntempo im Freundestest                                                                    |

## ADR-028: Zinsniveau pro Spieljahr bleibt vorerst wie im Prompt — `akzeptiert`

Ein Spieljahr dauert einen echten Tag. Die Vorgaben „Leitzins 3 %“ und „Anleihen 2 bis 4 %“ bedeuten damit
risikolose 2 bis 4 % **pro echtem Tag**. Nach der ersten Geldflussrechnung (`BALANCING.md`, Abschnitt 6) wächst
das Vermögen je Spieler damit um 7 bis 20 % pro Tag, und die Senken fangen nur einen kleinen Teil ab.
Die Werte stehen unverändert wie im Prompt in `balance.ts`. **Vor M1 ist zu entscheiden**, ob das so gewollt ist
oder ob Zinsen und Renditen skaliert werden (z. B. Obergrenze für Anleihen je Spieler oder ein niedrigeres Zinsniveau).

**Entscheidung des Auftraggebers:** Die Werte bleiben vorerst. Die Geldmenge wird im Freundestest beobachtet
(`money_supply_snapshots`); die Stellschrauben aus `BALANCING.md` bleiben als Reserve.

## ADR-029: Jede Regel muss in Spielersprache erklärbar sein — `akzeptiert`

Vorgabe des Auftraggebers zu ADR-027: Steuern, Preisregeln, Rechtsformen und ähnliche Regeln bleiben, müssen aber
für Spieler verständlich sein. Daraus folgt:

- Jede Regel hat einen Erklärtext aus ein bis zwei Sätzen ohne Formel, mit einem Zahlenbeispiel.
  Die Texte stehen in `messages/de.json` unter `rules`, die Zahlen kommen zur Laufzeit aus `balance.ts`.
- Die Seite **Spielregeln** (`/profile/rules`) zeigt alle Regeln gesammelt. Wo eine Regel wirkt, steht sie als
  eigene Zeile (z. B. „Unternehmenssteuer“ im Quartalsbericht, „Steuer“ in der Order-Abrechnung).
- Eine Regel, die sich so nicht erklären lässt, wird vereinfacht oder gestrichen. Versteckte Deckel sind keine
  zulässige Balancing-Methode.

## ADR-030: XP-Multiplikator 2 für die Alpha — `akzeptiert`

`progression.xpMultiplier = 2`. Alle XP-Quellen zählen doppelt, die Tageslimits gelten für die Zahl der Aktionen,
nicht für die XP. Im Spiel steht das als „Alpha-Bonus: doppelte XP“.

## ADR-031: Unternehmen müssen sich lohnen, aber nicht jeder darf Erfolg haben — `akzeptiert`

Vorgabe des Auftraggebers. Zielbild für das Balancing der Unternehmenssimulation:

| Führung                                                                                                      | Erwartetes Ergebnis                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Solide (Personal passend zur Nachfrage, stetiges Marketing, Investition in Qualität, Preis folgt den Kosten) | Gründungskosten in etwa 4 bis 8 echten Tagen zurückverdient, danach Gewinn in der Größenordnung des ein- bis zweifachen Jobeinkommens der Stufe |
| Passiv (nichts tun)                                                                                          | Verliert langsam Geld, nach etwa 2 bis 4 Tagen unrentabel oder insolvent, aber nie über eine einzige Nacht                                      |
| Gierig (Höchstpreis ohne Qualität) oder Dumping                                                              | Unrentabel                                                                                                                                      |
| Überexpansion                                                                                                | Fixkosten und Einarbeitung führen zur Pleite                                                                                                    |
| Mehrere Spielerfirmen in derselben Nische                                                                    | Die am besten geführte verdient klar, die schwächste verliert                                                                                   |

Die Ziele sind als Szenario-Tests in `src/lib/sim` festgeschrieben; Mechanik und Messwerte stehen in
`SIMULATION.md` und `BALANCING.md`.
