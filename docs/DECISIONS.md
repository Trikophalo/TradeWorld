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

## ADR-032: Unternehmensmärkte nach Firmenstufe — `akzeptiert` (ein Punkt `offen`)

Umsetzung von ADR-031, damit Rivalität auch zwischen kleinen Firmen entsteht:

- **Ein Markt je Stufe:** lokal (Kleinunternehmen), regional (GmbH), national (AG), international (börsennotiert).
  Jeder Markt ist ein fester Anteil der Branchennachfrage (0,18 % / 0,6 % / 2,2 % / 100 %). Innerhalb eines
  Markts gilt unverändert die Formel aus dem Prompt (Attraktivität → Marktanteil → Umsatz, begrenzt durch Kapazität).
- **Etablierte Anbieter:** In den drei kleinen Märkten nimmt ein anonymer Wettbewerber mit fester Qualität und
  Bekanntheit teil. Er braucht keine eigenen Firmenzeilen und kann nicht pleitegehen.
- Die kleinen Märkte wachsen nicht mit der Branche. Wachstum heißt: in die nächste Stufe umwandeln.
- **Preisband entfällt als Balancing-Regel.** Übrig ist nur der Reglerbereich (25 % bis 300 % des Marktpreises);
  den Preis diszipliniert der Wettbewerb. Der Marktpreis ist so kalibriert, dass er der gewinnmaximale Preis ist.
- **Schonfrist statt „2 Quartale“:** Nach dem ersten Quartalsabschluss mit negativer Kasse bleiben 4 Abschlüsse
  (24 Stunden) zur Rettung. Niemand verliert eine gesunde Firma über Nacht. Abweichung vom Prompt (6.7).
- Marketing-Budgets werden wie entschieden ausgegeben, auch ins Minus (führt in die Schonfrist). Die Oberfläche
  warnt, wenn ein Budget die Kasse übersteigt.
- Die Abteilungen Marketing (Werbung bis doppelt so wirksam) und Finanzen (Fixkosten bis −30 %) haben jetzt eine Wirkung.

**Gemessen** (5 Branchen × 12 Seeds × 40 Quartale, Details in `BALANCING.md` Abschnitt 4):
solide geführte Firmen verdienen die Gründung in 14 bis 29 Quartalen zurück und werden nie insolvent;
passive, gierige, Dumping- und überexpandierende Firmen scheitern in praktisch allen Läufen; in einer vollen Nische
gewinnt die am besten geführte Firma, die schwächste verliert.

**Offen, vom Auftraggeber zu bestätigen:**

1. **Preisempfindlichkeit je Branche** statt einheitlich 1,5 wie im Prompt (Handel 2,5, Logistik 2,0, Energie 1,5,
   Tech 1,2, Pharma 1,0). Ohne das gewann im Handel weiterhin der Höchstpreis.
2. **Eine gut geführte AG verdient das 4- bis 8-Fache eines C-Level-Gehalts**, mehr als das Ziel von 1 bis 2×.
   Enger stellen ließe sich das nur, indem der nationale Markt für zwei Spieler-AGs zu klein wird.
3. Die Szenarien rechnen nur mit Mitarbeitern von Skill 5, ohne Kredite und ohne Führungsrollen.

## ADR-033: Schrittweise Offenlegung statt voller Oberfläche — `akzeptiert`

Vorgabe des Auftraggebers: weniger Überladung am Anfang, das Spiel soll sich beim Spielen entfalten.

- `src/config/disclosure.ts` legt fest, ab welchem Level ein Teil der Oberfläche erscheint. Die Komponente
  `<Reveal feature="…">` blendet ihn dann ein.
- Ein neuer Spieler sieht auf der Startseite vier Dinge: Vermögen, Tresor, nächstes Ziel und einige Aktien.
- Der Tab „Firma“ fehlt bis Level 8 und erscheint dann als gesperrte Vorschau (Gründung ab Level 10).
- Das Profil zeigt erreichte Freischaltungen und nur die nächsten zwei Stufen. Der Rest bleibt eine Überraschung.

| Bereich                                                                              | sichtbar ab Level            |
| ------------------------------------------------------------------------------------ | ---------------------------- |
| NEXA-30-Chart, tägliche Missionen, Kennzahlen einer Aktie, Handelshistorie, Karriere | 2 (direkt nach dem Tutorial) |
| Event-Leiste, Nachrichten, Orderbuch                                                 | 3                            |
| Reiter Anleihen und Indizes                                                          | 5                            |
| Tab „Firma“                                                                          | 8                            |

Das ist reine Darstellung. Ob eine Aktion erlaubt ist, entscheiden weiterhin die Freischaltungen in `balance.ts`
und der Server.

## ADR-034: Pflicht-Tutorial mit Maskottchen Finn — `akzeptiert`

Vorgabe des Auftraggebers: geführte, interaktive Einführung direkt nach der ersten Anmeldung, nicht überspringbar,
kurz, mit Pixel-Maskottchen und Sprechblase.

- **Finn, der Börsenfuchs** („Börsenfuchs“ = gewiefter Händler): 16×16-Pixel-Art mit den Zuständen ruhig,
  blinzelnd, sprechend, jubelnd. Die Fliege trägt die Akzentfarbe der App.
- **13 Schritte, etwa zwei Minuten.** Sieben davon verlangen eine echte Aktion: Tresor leeren, zu den Märkten
  wechseln, Aktie öffnen, „Kaufen“ tippen, Order durch Halten bestätigen, Portfolio und Profil öffnen.
  Erklärt wird nur Spielrelevantes: Vermögen, Grundeinkommen, Kurse, Handeln, Portfolio, Level.
- **Nicht überspringbar:** Eine unsichtbare Ebene sperrt alles außer dem markierten Element. Es gibt keinen
  Schließen-Knopf, Escape und Tastenkürzel sind aus. Wer die Seite verlässt oder neu lädt, landet wieder im
  selben Schritt auf der richtigen Seite.
- **Belohnung:** `xpSources.tutorial` (50 XP, mit Alpha-Bonus 100) hebt den Spieler genau auf Level 2.
  Ein Test sichert das ab.
- Schritte stehen als Daten in `src/features/tutorial/steps.ts`, Texte in `messages/de.json`.

**Stand und Einschränkungen**

- Der Fortschritt liegt derzeit je Konto im Browser (`localStorage`). Ab M2 liegen „abgeschlossen“ und die XP
  auf dem Server (RPC `complete_tutorial`), sonst ließe sich das Tutorial auf einem zweiten Gerät wiederholen.
- Der Kauf im Tutorial ist bis M1 eine Vorschau ohne Buchung. Ab M1 ist es ein echter erster Trade.
- Die Sperre wirkt auf Zeiger und Berührung. Mit der Tab-Taste lassen sich andere Elemente weiterhin fokussieren.
- Im Bestätigungsschritt verbirgt die Order-Maske (Dialog) den Rest der Seite vor Screenreadern, also auch
  Finns Hinweis. Die Maske selbst ist beschriftet.

## ADR-035: Spätere Features sind sichtbar, aber gesperrt — `akzeptiert`

Vorgabe des Auftraggebers (präzisiert ADR-033): Was man später freischaltet, sieht man von Anfang an, mit Schloss
und Level. Damit weiß jeder Spieler, worauf er hinarbeitet.

- Der Tab **Firma** ist immer da; Seitenleiste und Tab-Leiste zeigen ein Schloss bis Level 10.
- **Anleihen** stehen als Reiter in den Märkten (Schloss bis Level 5); die Liste ist sichtbar, aber gedimmt, dazu ein
  Fortschrittsbalken bis zur Freischaltung.
- **Limit-Order** steht in der Order-Maske (Schloss bis Level 3); Antippen erklärt, ab wann sie geht.
- Startseite: „Später freischaltbar“ mit den nächsten großen Features. Profil: die vollständige Liste aller Stufen.
- Ein **Level-up-Overlay** mit Finn feiert jeden Aufstieg und zeigt, was neu freigeschaltet ist.
- `src/config/disclosure.ts` blendet nur noch **Info-Panels** stufenweise ein (Index-Chart, Missionen, Nachrichten,
  Orderbuch, Kennzahlen), damit der erste Bildschirm ruhig bleibt.

## ADR-036: Kauf per Geldbetrag, ohne Bruchstücke — `Annahme`

Vorgabe: Statt der Stückzahl kann man den Betrag eingeben, wie bei Neo-Brokern. Umsetzung: Die Order-Maske hat einen
Umschalter **Stück / Betrag**. Beim Betrag kauft das Spiel so viele **ganze** Aktien, wie nach der Gebühr hineinpassen;
der Rest bleibt auf dem Konto, und die Maske sagt das („Das sind 4 Stück“). Beim Verkauf per Betrag werden so viele
Stück verkauft, dass mindestens der Betrag zusammenkommt.

Bruchstücke (Teilaktien) wären die exaktere Lösung, verlangen aber Stückzahlen mit Nachkommastellen in Orders,
Positionen, Lots und Ledger-Texten. Das bleibt eine Option für später, falls kleine Budgets bei teuren Aktien stören.

## ADR-037: Markt läuft komplett in Postgres, Client fragt im Takt ab — `akzeptiert` (ersetzt ADR-004 und ADR-013 für die Alpha)

Der Auftraggeber richtet alles im Browser ein und kann weder Edge Functions deployen noch Secrets setzen. Deshalb:

- Der Markt-Tick ist eine PL/pgSQL-Funktion `market_tick()`, die `pg_cron` alle 5 Sekunden aufruft. Quartalsabschluss
  und Wartung laufen ebenfalls über `pg_cron`. Alles wird über `update-to-latest.sql` im SQL Editor eingespielt.
- Die TypeScript-Simulation in `src/lib/sim` bleibt die getestete Referenz der Formeln; die SQL-Fassung folgt ihr.
- Der Client fragt den Markt alle 5 Sekunden ab (`get_market_snapshot`), das Portfolio alle 15 Sekunden und nach jeder
  Aktion. Bei vier Spielern ist das unkritisch und robuster als Realtime. Realtime bleibt eine spätere Optimierung.
- Ohne Supabase-Zugang läuft eine Offline-Fassung derselben Regeln im Browser (`src/features/game/demo-engine.ts`).

## ADR-038: Level und Trade-XP schon in M1 auf dem Server — `akzeptiert`

Limit-Orders (Level 3) und Anleihen (Level 5) gehören zu M1. Damit sie erreichbar sind, vergibt der Server ab M1
Erfahrungspunkte für Trades (10 XP × Alpha-Faktor, höchstens 30 Trades pro Tag, Mindestwert 100 €, keine XP für
Rückkäufe innerhalb von 10 Minuten) und für das Tutorial, und er prüft die Freischaltungen selbst. Missionen, Login-
Bonus und Erfolge folgen in M2.

## ADR-039: Endlose Level — `akzeptiert`

Vorgabe: Das Spiel darf nicht „durchgespielt“ werden können. Es gibt kein Maximallevel mehr
(`progression.maxLevel` = 10.000 ist nur eine technische Obergrenze). Funktionen schalten bis Level 50 frei, danach
bringt jedes zehnte Level einen Prestige-Titel. Das eigentliche Ziel ist Vermögen (ADR-042). Details: `ECONOMY.md` §7.

## ADR-040: Bruchstücke von Aktien — `akzeptiert` (ersetzt ADR-036)

Vorgabe: Man soll auch „ungerade“ Stückzahlen kaufen können. Stückzahlen von Spielerpositionen, Orders und Trades
werden in Millionstel gespeichert (`*_e6`, `trading.quantityScale`). Beim Kauf per Betrag investiert der Server genau
den Betrag (inklusive Gebühr) zum tatsächlichen Ausführungskurs; beim Verkauf per Betrag verkauft er so viele
Bruchstücke, dass der Betrag zusammenkommt. Mindestorder 1 € (`trading.minOrderValueCents`). Die Aktienzahl einer
Firma (`shares_outstanding`) bleibt ganzzahlig.

## ADR-041: Geschlossener Geldkreislauf — `akzeptiert`

Vorgabe: Keine Inflation; Geld kommt nur, wenn es woanders geht. Die gesamte Geldmenge (10 Mrd. €) entsteht einmalig
und verteilt sich auf Staatskasse, Finanzmarkt, KI-Tycoons und Haushalte. Danach gibt es keine Geldschöpfung mehr:
Startkapital, Grundeinkommen und Anleihezinsen zahlt die Staatskasse, Steuern und Gebühren fließen dorthin zurück,
Trading-Gewinne kommen aus dem Finanzmarkt-Topf. Das Grundeinkommen sinkt, wenn die Staatskasse leer wird.
Ein Test prüft, dass die Summe aller Konten konstant bleibt. Ersetzt die Geldschöpfung über das Konto `mint`
(ADR-007, ADR-019). Details: `ECONOMY.md` §2.

## ADR-042: Vermögen ist der Punktestand, öffentliche Reichenliste — `akzeptiert`

Vorgabe: Es geht darum, der reichste Mensch zu sein. Eine Live-Reichenliste (Forbes-ähnlich, aber eigener Name und
Look) zeigt alle Spieler mit Spielernamen und 120 erfundene KI-Tycoons (15.000 € bis 400 Mio. €), deren Vermögen in
Aktien der KI-Firmen steckt. Rangwechsel erzeugen Nachrichten. Nettovermögen = Bargeld + Wertpapiere zum
Verkaufskurs + Firmenanteile + Statussymbole − Schulden. Details: `ECONOMY.md` §3 und §4.

## ADR-043: Spielername, Änderung alle 60 Tage, Namensfilter — `akzeptiert`

Vorgabe: Der Anmeldename wird überall angezeigt und ist alle 60 Tage änderbar. Schimpfwörter und verbotene Namen sind
weder für Spieler noch für Firmen möglich. Ein serverseitiger Filter mit Normalisierung (Leetspeak, Sonderzeichen,
Wiederholungen) und Ausnahmen gegen Fehlalarme prüft beim Speichern; eine Vorabprüfung gibt schon beim Tippen
Rückmeldung. Details: `ECONOMY.md` §9.

## ADR-044: Garagen-Startups mit Potenzgesetz — `Konzept` (Umsetzung M4)

Vorgabe: Schon am Anfang soll eine gute Idee zu einer Firma werden können, die etwa einer von tausend zum Big Player
skaliert. Konzept: Garagen-Startup ab Level 3 für 2.500 €, Nischen mit verborgenem, Pareto-verteiltem Potenzial,
S-Kurven-Wachstum, Finanzierungsrunden mit Verwässerung. Zielquoten als Szenario-Tests. Details: `ECONOMY.md` §6.

## ADR-045: Firmen als Clans mit Chat, Mitgliedschaft in genau einer Firma — `Konzept` (Umsetzung M4/M5)

Vorgabe: Eine Firma ist eine Art Clan mit Firmenchat; man arbeitet in höchstens einer Firma gleichzeitig. Ersetzt
„eigene Firma plus eine Nebenrolle“ (spec 7.2). Beteiligungen an mehreren Firmen bleiben erlaubt; die Holding ab
Level 40 bedeutet Besitz mehrerer Firmen, nicht Mitarbeit. Details: `ECONOMY.md` §8.

## ADR-046: Mini-Tutorials bei Freischaltungen — `akzeptiert`

Vorgabe: Wenn ein Level-up etwas Wichtiges freischaltet, erklärt Finn es in einem kurzen, interaktiven Tutorial
direkt nach dem Level-up-Fenster. Die Touren stehen als Daten in `src/features/tutorial/tours.ts`; jede Tour läuft
genau einmal pro Spieler.

## ADR-047: Startgeld der KI-Firmen kommt aus dem Finanzmarkt-Topf — `Annahme`

Die 15 KI-Firmen halten aus dem Seed zusammen 5,34 Mrd. € Kasse. Bei der Genesis (ADR-041) zählt das als eingezahltes
Kapital der Investoren und wird vom Finanzmarkt-Topf (6 Mrd. €) abgezogen. Für den Handel mit Spielern bleiben dort
661 Mio. €. Für eine Alpha mit wenigen Spielern reicht das bei Weitem; der Topf wird beobachtet (`ECONOMY.md` §10).
Alternative, falls nötig: den Anteil `money.allocation.financialMarket` erhöhen und `households` senken.

## ADR-048: Namensfilter lieber zu streng als zu lasch — `akzeptiert`

Der Filter (ADR-043) blockiert auch einige echte Namen, weil sie verbotene Begriffe enthalten: „Nazim“ und „Ignazio“
(nazi), „Nigeria“ (niger), „Lisa88“ (Code 88). „Finn_Mueller“ ist reserviert (Maskottchen). Erlaubt bleiben dagegen
z. B. Klassenbester, Matthias, Analyst, Bastian, Dickmann, Schwanstein, Arsenal. Für Spieler gibt es immer eine
Alternative mit Ziffer oder Unterstrich. Die Liste liegt in der Datenbank und lässt sich ohne App-Update anpassen.

## ADR-049: Bruchstücke, Geldkreislauf, Reichenliste und Missionen in der Datenbank — `akzeptiert`

Umsetzung von ADR-039 bis ADR-043 und der Missionen (Vorgabe des Auftraggebers: viele Wege zu XP, von schnell bis
lang). Stückzahlen in Millionstel, Kauf per exaktem Betrag; Genesis mit einer einzigen Buchung, Münzkonto gesperrt,
keine Systemkasse darf ins Minus; Reichenliste mit 120 KI-Tycoons, Schnappschüssen alle 5 Minuten und Schlagzeilen;
70 Missionsvorlagen in vier Arten, tägliche Anmeldung mit Serie. Verträge und Fehlercodes: `DATA_MODEL.md`,
Abschnitt M2. Geprüft auf einer frischen Datenbank, einer M1-Datenbank und einer Datenbank von vor M1.

## ADR-050: Skill-Baum mit 8 Strängen, unumkehrbar — `akzeptiert`

Vorgabe: riesiger Skill-Baum mit vielen Strängen (IT, Recht, Handwerk …), Mischungen möglich, Skills nicht
zurücknehmbar, Punkte aus Level-ups, Missionen und vor allem Arbeit. Umsetzung: 8 Stränge × 10 Skills in 5 Stufen plus
6 Hybrid-Skills (86 Skills, `src/config/skills.ts`). Arbeit bringt Strang-Punkte im Strang des Jobs, Level-ups und
Missionen freie Punkte. Grundprinzip im ganzen Spiel: mehr Können → mehr Leistung → mehr Gewinn. Details:
`JOBS_AND_SKILLS.md` §1–3.

## ADR-051: Jobportal mit Bewerbung, Gegenangebot und symbolischer Unterschrift — `akzeptiert`

Vorgabe: Stellen von KI-Firmen (Start) und Spielerfirmen (später), kurze Bewerbung mit Gehaltswunsch, Arbeitgeber nimmt
an, lehnt ab oder bietet Gegenangebot, Spieler unterschreibt am Ende symbolisch; mehrere Bewerbungen gleichzeitig.
KI-Firmen nehmen immer an, zahlen aber gedeckelt (höchstens 1,5-facher Stufenlohn). Kündigen sofort gegen ein Gehalt an
die Firma, Entlassen sofort mit einem Gehalt Abfindung, Gehaltserhöhung je nach Skill-Zuwachs. Ersetzt die
Karriereleiter aus ADR-031 als Weg zur Arbeit; die Karrierestufen bleiben als Stufen der Stellen. Details:
`JOBS_AND_SKILLS.md` §4–8.

## ADR-052: Gewinnabhängiger Lohn und Insolvenz mit Privathaftung — `Konzept` (Umsetzung M4)

Vorgabe: Löhne kommen aus der Firmenkasse, sinken automatisch mit dem Gewinn (höchstens auf 50 %) und steigen mit ihm
(20 % des Übergewinns als Bonus). Der Arbeitgeber kann den Vertragslohn nicht senken. Bei Insolvenz wird die Firma
aufgelöst, jeder Mitarbeiter bekommt ein Gehalt Abfindung, der Gründer zahlt Restschulden privat, notfalls über einen
Zwangskredit, der von allen Einnahmen getilgt wird. Ergänzt ADR-032. Details: `JOBS_AND_SKILLS.md` §6, §9.

## ADR-053: Tägliche Belohnung als 7-Tage-Kalender — `akzeptiert`

Vorgabe: Belohnung fürs tägliche Einloggen. 7-Tage-Zyklus mit steigenden XP, Geld aus der Staatskasse und je einem
Skillpunkt an Tag 4 und 7; ein Serien-Schutz pro Woche. Ersetzt den stillen Check-in-Toast durch einen Kalender, der
einmal am Tag aufgeht. Werte: `balance.dailyRewards`.

## ADR-054: Profilbilder als Pixel-Porträts, digitale Visitenkarte — `akzeptiert`

Vorgabe: Profilbild aus einer Reihe von Artworks, Visitenkarte mit Skills, Name und Firmen, leichter 3D-Effekt.
20 prozedurale Pixel-Porträts (keine fremden Grafiken, nur ganzzahlig skaliert), einige ab bestimmten Leveln.
Die Visitenkarte ist für alle Spieler sichtbar und von der Reichenliste aus erreichbar. Der Namensfilter bleibt
bewusst streng (ADR-048 bestätigt).

## ADR-055: Langsamere erste Level — `akzeptiert`

Vorgabe: Am Anfang ging das Leveln zu schnell (nach einem Tag etwa Level 6 bis 7). Level 2 bleibt bei 100 XP, damit
das Tutorial weiter direkt zum ersten Job führt. Danach braucht jedes Level `250 × Level^1,5` XP statt
`100 × Level^1,5`, also das 2,5-Fache. Ein aktiver Spieler erreicht damit am ersten Tag etwa Level 4 und nach einer
Woche etwa Level 10. Der Alpha-Bonus (XP × 2) bleibt.

## ADR-056: Schnelle, starke und spielergetriebene Märkte — `akzeptiert`

Vorgabe: Kurse sollen sich viel stärker und schneller bewegen als im echten Leben, und Spieler sollen sie bestimmen:
Eine Aktie steigt, wenn viele in die Firma investieren und die Firma erfolgreich ist. Umsetzung:

1. **Spieler-Orders wirken in Euro**, nicht im Verhältnis zur Firmengröße: 10.000 € Nettokauf bewegen eine
   Pennystock um 2 %, einen Mittelständler um 0,4 %, einen Bluechip um 0,1 % (`trading.playerImpact`).
2. **Was Spieler halten, stützt den Kurs:** Die Wertfonds akzeptieren den fairen Wert plus einen Aufschlag von bis zu
   60 % für den Wert, den Spieler halten. Kaufen und wieder verkaufen verpufft, Kaufen und Halten bleibt.
3. **KI-Händler werden schwächer, je mehr Spieler handeln:** Rauschen, Trendfolger und Herde werden mit
   `Referenz / (Referenz + Spielerumsatz)` gewichtet, mindestens 15 %. Der Firmenerfolg (fairer Wert) bleibt der Anker.
4. **Mehr Bewegung:** Rauschen × 2,25, Wertfonds folgen neuem fairem Wert dreimal so schnell, Branchennachfrage und
   Überraschungen bei Quartalszahlen doppelt so stark, Zinsentscheid jedes halbe Spieljahr, Anleihen dreimal so
   lebhaft.

Details und Formeln: `SIMULATION.md`, Abschnitt „Spielergetriebene Kurse“; `src/lib/sim/player-influence.ts`.

## ADR-057: Spielerfirmen mit Garagen-Startup, Leistung und KI-Kräften — `akzeptiert`

Vorgabe: Firmen gründen, Arbeitgeber-Oberfläche, Mitarbeiterleistung erzeugt Umsatz und Gewinn. Umsetzung als
kompaktes Startup-Modell statt der vollen Firmensimulation aus M4: S-Kurve der Bekanntheit bis zur verborgenen
Marktgröße, Kapazität aus der Leistung des Teams, Qualität aus den Skills in der Branche, KI-Kräfte zum Festpreis.
Abweichend von `ECONOMY.md` §6.1 darf das Garagen-Startup bis zu zwei Mitarbeiter haben, damit Spieler früh
Arbeitgeber werden. Die Marktgrößen sind auf Spieljahre von einem echten Tag umgerechnet (Faktor 1/10). Details:
`PLAYER_COMPANIES.md`.

## ADR-058: Insolvenz mit Privathaftung und Zwangskredit — `akzeptiert`

Umsetzung von ADR-052 für Spielerfirmen. Eine Firma mit offenen Rechnungen ist „in Schieflage“; nach 4 Quartalsabschlüssen
in Folge (ein echter Tag) wird sie aufgelöst. Reihenfolge: Die Firmenkasse zahlt offene Rechnungen und je Mitarbeiter
ein Gehalt Abfindung; was fehlt, zahlt der Gründer privat; was er nicht hat, wird ein **Zwangskredit** aus dem
Finanzmarkt-Topf, zinsfrei, getilgt durch 50 % jeder privaten Einnahme (Lohn, Bonus, Grundeinkommen, Verkaufserlöse,
tägliche Belohnung, Entnahmen). Danach 3 Tage Gründungssperre. Der Gründer kann seine Firma jederzeit freiwillig
auflösen; dann gilt dieselbe Abrechnung ohne Sperre. Schulden mindern das Vermögen auf der Reichenliste.

## ADR-059: Arbeitsaufgaben als kurze Rechenaufgaben aus dem Job — `akzeptiert`

Alle 3 Stunden bekommt jeder Spieler mit Job eine Aufgabe, die in unter einer Minute lösbar ist. Drei Arten nach dem
ersten gesuchten Bereich des Jobs: Finanzen/Recht vergleichen zwei Kreditangebote, Vertrieb/Logistik/Führung wählen
den profitabelsten von drei Kunden, IT/Handwerk/Wissenschaft schätzen den Quartalsgewinn aus vier Antworten. Die
richtige Antwort folgt aus den gezeigten Zahlen. Richtig und schnell (bis 45 s): 150 XP, richtig: 100 XP,
falsch: 50 XP. Richtig bringt zusätzlich eine Stunde Lohn als Bonus vom Arbeitgeber. Ersetzt die Aufgabenideen aus M3.

## ADR-060: Firmenchat für Gründer und Mitarbeiter — `akzeptiert`

Umsetzung von ADR-045 (Firma als Clan): Gründer und alle aktiven Mitarbeiter einer Spielerfirma teilen einen Chat.
Nachrichten bis 300 Zeichen, Namensfilter gegen Beleidigungen, höchstens 10 pro Minute. Das Spiel schreibt
Systemnachrichten (neues Teammitglied, Kündigung, Entlassung, Quartalsergebnis, Warnung vor Insolvenz). Neu geladen
wird alle paar Sekunden (Polling, wie der Rest des Spiels).

## ADR-061: Skill-Karte aus Hexagons — `akzeptiert`

Vorgabe: Der Skill-Baum wird eine große Karte aus Sechsecken mit den 8 Richtungen von vorher, viel mehr Skills und
Strängen, zoombar und mit der Maus verschiebbar. Umsetzung: Radius 7 um die Mitte, 168 Felder, 21 je Richtung
(Reihenfolge im Uhrzeigersinn: IT, Finanzen, Recht, Führung, Vertrieb, Logistik, Handwerk, Wissenschaft). Die 86
bisherigen Skills behalten ihre Schlüssel, niemand verliert etwas. Lernen darf man ein Feld, wenn es ein Einstiegsfeld
ist (höchstens 2 Felder von der Mitte) oder ein Nachbarfeld schon gelernt ist. Kosten und Punktwert hängen weiter an
der Stufe 1 bis 5, die mit dem Abstand zur Mitte steigt. Ersetzt die Voraussetzungs-Ketten aus ADR-050.

## ADR-062: Produkte, Wachstumsstufen, Schulungen und Stellen mit konkreten Skills — `akzeptiert`

Vorgabe: Wer eine Firma hochskalieren will, braucht die passenden Spezialisten; das Dashboard zeigt, was als Nächstes
fehlt; Mitarbeiter lassen sich teuer schulen, damit sie mehr abdecken. Umsetzung: Jede Branche hat 3 Produkte, jedes
mit 4 Wachstumsstufen aus 1 bis 2 konkreten Skills (z. B. Security-Software: IT-Sicherheit → Softwarearchitektur und
Penetrationstests → Datenschutz und B2B-Vertrieb → Kryptografie und Leadership). Eine Stufe gilt, wenn Gründer oder
Spieler-Mitarbeiter alle Skills dieser und der früheren Stufen können. Jede Stufe hebt die Obergrenze der Bekanntheit
(50 % bis 100 %), die Qualität (+5 %) und die Kapazität des ganzen Teams (+25 %). KI-Kräfte bringen keine Skills.
Schulungen kosten die Firma 2.000 € bis 50.000 € je Stufe des Skills, der Mitarbeiter lernt den Skill dauerhaft (auch
ohne Nachbarfeld) und sein Vertragslohn steigt um 3 % bis 20 %. Stellenausschreibungen können konkrete Skills
verlangen; bewerben kann sich nur, wer sie hat.

## ADR-063: Kündigen ohne Kosten mit einem Tag Frist — `akzeptiert`

Vorgabe: Kündigen kostet nichts mehr, wirkt aber erst nach einem Tag. Bis dahin läuft der Lohn weiter, die Kündigung
lässt sich zurücknehmen. Ersetzt „Kündigen kostet ein Gehalt“ aus ADR-051. Entlassen bleibt sofort mit Abfindung.

## ADR-064: Arbeit läuft automatisch, eigener Job-Tab — `akzeptiert`

Vorgabe: Nicht jeder kann jeden Tag ans Handy; niemand soll deshalb Nachteile haben. Arbeit erledigt sich automatisch,
die Firma verdient an der Leistung, der Spieler bekommt Lohn. Die Arbeitsaufgaben aus ADR-059 entfallen; im neuen
Tab „Job“ arbeitet nur symbolisch eine kleine Pixelfigur. Der Tab zeigt alles über den Arbeitgeber (bei KI-Firmen
auch den Kurs). Das Gehalt pro Stunde steht zusätzlich beim Tresor neben dem Grundeinkommen. KI-Firmen fragen keinen
Gehaltswunsch ab, sie bieten direkt ihr Höchstgehalt. Die Events ziehen von der Startseite in einen eigenen Bereich.

## ADR-065: Firmenlogo aus dem Pixel-Editor — `akzeptiert`

Vorgabe: Gründer zeichnen ihr Logo selbst. 16×16 Raster, bis zu 6 Farben, Werkzeuge Stift, Radierer, Füllen und
Spiegeln. Gespeichert als Raster plus Palette (`src/lib/sim/logo.ts`, die Datenbank prüft dieselben Regeln). Das Logo
ersetzt überall die Farbkachel mit Kürzel. Weil kein Filter Bilder versteht, kann jeder Spieler ein Logo melden; ab
3 Meldungen wird es ausgeblendet, bis der Gründer ein neues zeichnet.

## ADR-066: Sofort kündigen gegen einen Tageslohn; Gründer dürfen nebenbei arbeiten — `akzeptiert`

Vorgabe: Neben der kostenlosen Kündigung mit einem Tag Frist (ADR-063) geht Kündigen auch sofort, gegen einen Tageslohn
(12 Stunden Lohn) an die Firma. Gründer dürfen einen Job haben, sonst gründet jeder und keiner arbeitet. Solange sie
nebenbei arbeiten, zählt ihre Leistung in der eigenen Firma halb. Ab 5 Mitarbeitern (Spieler und KI-Kräfte) arbeitet
der Gründer Vollzeit in der Firma: Sein Job bekommt automatisch die 1-Tages-Kündigung, das Dashboard und der Job-Tab
zeigen es, und neue Verträge sind dann gesperrt. Ersetzt die strenge Regel aus ADR-045 (eine Firma oder ein Job).

## ADR-067: Wachstum über GmbH, Börsengang und Kapitalerhöhung — `akzeptiert`

Vorgabe: Kleine Firmen sollen groß werden können, sobald Kapital von Investoren kommt, die in die Aktie investieren.
Stufen: Garage (2 Mitarbeiter), Kleinunternehmen (5), GmbH (20, aus eigener Tasche ab Level 15 für 60.000 €), AG (100).
Die AG gibt es nur über den Börsengang (ab Level 12, aus Kleinunternehmen oder GmbH): 1 Mio. Aktien, der Gründer
verkauft 10 bis 49 %, Ausgabepreis = Firmenwert / Aktien (mindestens 1 €). 12 Stunden lang zeichnen Spieler zum
Ausgabepreis, das Geld geht in die Firmenkasse; vom Rest übernehmen KI-Investoren 20 % bis 70 % je nach Qualität,
der Rest wird nicht ausgegeben. Danach ist die Aktie normal handelbar (Kurs spielergetrieben, ADR-056; fairer Wert aus
dem Firmenwert je Aktie). Die Aktien des Gründers liegen in seinem Depot. Kapitalerhöhungen geben bis zu 25 % neue
Aktien zu 90 % des Kurses aus, mit derselben Zeichnungsphase.

## ADR-068: Finn erklärt neue Bereiche kurz — `akzeptiert`

Vorgabe: Finn erklärt die wichtigsten Dinge, bei neuen Sachen kurz. Die Job-Tour (Level 2) zeigt Job-Tab und
Skill-Karte, neue Touren bei der Gründungsfreischaltung (Level 3) und beim Börsengang. Beim ersten Besuch neuer
Bereiche (Skill-Karte, Firma, Job-Tab) gibt es 1 bis 2 Sprechblasen. Mehrere fällige Touren laufen nacheinander.

## ADR-069: Firma als eigener Tab, KI-Kräfte über die Stellenausschreibung — `akzeptiert`

Vorgabe: Die Firma bekommt einen eigenen Tab in der Leiste links (Desktop; auf dem Handy bleibt es bei 6 Tabs, die
Firma ist dort über Karriere erreichbar). KI-Kräfte stellt man über „Stelle ausschreiben“ ein, indem man statt Spielern
die KI wählt. Sie kosten Lohn und lassen die Firma im Schnitt langsamer wachsen als echte Spieler: Leistung 1,0 statt
mindestens 1,5, keine Skills für Wachstumsstufen, und die erreichbare Qualität sinkt mit ihrem Anteil am Team um bis
zu 30 % (`startups.aiQualityPenalty`).

## ADR-070: Spiel zurücksetzen und Konto löschen — `akzeptiert`

Vorgabe: Spieler können von vorn anfangen oder ihr Konto löschen. Beides steht im Profil unter „Neu anfangen“ und
verlangt, den eigenen Namen einzutippen und den Knopf gedrückt zu halten (`reset_account`, `delete_account`; der Server
prüft den Namen, Fehler `confirm_mismatch`). Zurücksetzen behält Konto, Name, Profilbild und Einstellungen; alles
Spielerische geht zurück auf den Start einer Neuanmeldung, Finns Tutorial beginnt erneut. Eine eigene Firma wird wie
beim freiwilligen Auflösen beendet, ihr Team verliert den Job. Löschen macht dasselbe und entfernt danach das Konto,
der Name wird wieder frei. Das Hauptbuch bleibt ausgeglichen: Restguthaben werden gegen ein Systemkonto gebucht statt
gelöscht. Im Demo-Modus gibt es nur „zurücksetzen“ (neuer Demo-Spieler).

Umsetzung: Restguthaben gehen per Buchung an die Staatskasse, das Startkapital wird neu ausgezahlt (`restart_capital`).
Buchungen und Trades sind unveränderlich und überleben ein gelöschtes Konto als anonyme UUID-Referenz; dafür entfallen
die Fremdschlüssel von Hauptbuch, Orders, Positionen und Trades auf `players`, die Konten bleiben mit Saldo 0 eingefroren.
Trades vor einem Reset bleiben gespeichert, `get_my_portfolio` zeigt nur die danach (`player_private.account_reset_at`).
Offene Zeichnungsangebote der eigenen Firma werden vor dem Auflösen abgerechnet. Bekannte Grenze: Admins mit Einträgen
in `admin_actions` können ihr Konto nicht löschen.

## ADR-071: Firmenansicht als Firmenzentrale, KI-Kräfte pro Wachstumsplatz, Schulungen ab 5 — `akzeptiert`

Vorgabe: Die Firmenansicht war unübersichtlich und „kalt“. Neu:

- **Firmenzentrale:** Kopf mit Pixel-Gebäude je Stufe (Garage, Laden, Büro, Turm), Logo, Name, Idee, Kennzahlen als
  Plaketten und einer Stempeluhr bis zum Quartalsabschluss.
- **Drei Abteilungen** statt fünf Tabs: Übersicht, Team, Chat.
  - Das Team bündelt Stellenplan (Sitze für Gründer, Spieler, KI-Kräfte und freie Plätze), Bewerbungen,
    Ausschreibungen und ganz unten die Weiterbildung.
- **Übersicht:** Wachstumspfad als Zeitleiste mit Sitzen, Quartalsbilanz als Beleg, Verlauf um eine Nulllinie,
  Markt als Blockanzeigen, „Chefbüro“ mit Marketing, Team, Kasse und nächstem Gebäude. Lohnfaktor und Auflösen liegen
  eingeklappt darunter.
- **KI-Kräfte können für einen Skill des Wachstumspfads eingestellt werden** (`hire_ai_workers` mit `p_skill`,
  `dismiss_ai_worker`).
  - Sie besetzen den Platz; dort steht dann „KI-Kraft“ statt „fehlt“, und die Stufe zählt.
  - Das ändert ADR-069 an einer Stelle: KI-Kräfte bringen jetzt Skills für Wachstumsstufen, aber nur einen
    pro KI-Kraft.
  - Langsamer als mit Spielern bleibt es trotzdem durch die niedrigere Leistung und den Qualitätsabschlag.
- **Schulungen** gibt es erst ab 5 Leuten im Team (Spieler und KI-Kräfte, ohne Gründer;
  `startups.training.fromEmployees`).
  - Der Server lehnt sie vorher mit `training_locked` ab.
- **Große Beträge:** Große Beträge werden kurz angezeigt (`formatMoneyShort`: „15k €“, „1,2 Mio. €“, abgerundet), der
  genaue Betrag steht im Tooltip.

## ADR-072: Stündlicher Betrieb, Lohnregel und Live-Umsatz — `akzeptiert`

Firmen verdienen laufend, nicht nur am Quartalsende.

- Jede Stunde rechnet der Server eine Betriebsstunde ab (docs/COMPANY_GROWTH.md, Abschnitt 2).
- Spieler und KI-Kräfte werden in derselben Abrechnung bezahlt, nie mit mehr Geld, als die Stunde erwirtschaftet hat.
  Reicht es nicht, sinken alle Löhne im selben Verhältnis.
- Der Umsatz läuft in der Anzeige live mit.

## ADR-073: Unternehmensausbau ohne Ende — `vorgeschlagen`

Konzept in docs/COMPANY_GROWTH.md: Forschungspunkte und Forschungsprojekte, mehrere Produkte mit Versionen und
Lebenszyklus, Abteilungen, Standorte und Märkte, Wettbewerb in Nischen. Alle Ebenen haben unendliche Stufen mit
steigenden Kosten und sinkendem Ertrag. Ziel des Spielers ist das größte Unternehmen. Umsetzung in Phasen A–D.

## ADR-074: Ranglisten „Forbes 100“ und Top-Unternehmen, Missionen-Knopf, leichtere Einstiegs-Skills — `akzeptiert`

- **Ranglisten** (früher „Reichenliste“) haben drei Ansichten:
  - **Forbes 100:** die 100 reichsten echten Spieler.
  - **Alle:** mit den KI-Tycoons.
  - **Top-Unternehmen:** Spielerfirmen nach Firmenwert, wahlweise mit den KI-Firmen nach Börsenwert
    (`get_company_ranking`).
- **Missionen-Knopf:** In der Kopfleiste steht immer ein Knopf zu den Missionen. Ein blauer Punkt zeigt, dass
  eine Belohnung abholbereit ist.
- **Leichtere Einstiegs-Skills:** Wachstumsstufen fragen am Anfang einfache Skills ab. Stufe n verlangt
  höchstens Skill-Stufe n + 1, Stufe 1 also Spezialisierung (Stufe 2) statt Expertise. Ein Test prüft das für
  alle Produkte.
- **Skill-Karte:**
  - Beim Hovern erscheint eine Infokarte (Bereich, Stufe, lernbar oder nicht).
  - Der Mauszeiger zoomt zur eigenen Position, Verschieben und Zoomen gleiten weich.
  - Lernbare Felder pulsieren leicht.
  - Bereiche lassen sich in der Übersicht hervorheben und anspringen.

## ADR-075: Firma als eigener Tab auch auf dem Handy, Profil in der Kopfleiste, Gründer auf der Visitenkarte — `akzeptiert`

- **Firma:** „Firma gründen“ steht nicht mehr unter Karriere. Die Firma hat überall einen eigenen Tab.
- **Profil:** Auf dem Handy liegt das Profil als Avatar in der Kopfleiste, damit es bei sechs Tabs bleibt.
- **Visitenkarte:**
  - Sie nennt „Gründer:in von …“.
  - Wer keinen anderen Job hat, ist in der eigenen Firma als Gründer:in angestellt („Gründer:in bei …“).
- **Bewerbungen:** Vor dem Annehmen lässt sich die Visitenkarte des Bewerbers öffnen; von dort kann man direkt annehmen.
- **Betrieb (Client und Demo zu ADR-072):**
  - Firmen rechnen stündlich ab.
  - Der Kopf der Firma zeigt Umsatz und Gewinn heute live, dazu den Umsatz und Gewinn pro Stunde und wie weit
    die Löhne gedeckt sind.
  - KI-Kräfte kosten 120 € pro Stunde.

## ADR-076: Logo nur einmal, verbotene Symbole gesperrt — `akzeptiert`

- **Einmalig:** Das Firmenlogo wird einmal festgelegt, direkt nach der Gründung, mit Gedrückthalten. Danach lässt es
  sich nicht mehr ändern (`logo_locked`).
  - Ausnahme: Ein Logo, das nach Meldungen ausgeblendet wurde, darf neu gezeichnet werden.
- **Verbotene Symbole:** `hasForbiddenSymbol` (src/lib/sim/logo.ts, getestet) sucht Hakenkreuz-Muster in jeder
  Farbe und in der ganzen Zeichnung, gespiegelt, gedreht und 1- bis 3-fach skaliert, mit einem Fehlpixel Toleranz.
  - Der Editor sperrt das Speichern, der Server lehnt mit `logo_forbidden` ab.
  - Meldungen bleiben die zweite Verteidigungslinie für alles, was ein Muster nicht erkennt.

## ADR-077: Datenbank-Updates automatisch per GitHub Action — `akzeptiert`

Das Kopieren in den SQL Editor war mühsam. Die Action `.github/workflows/supabase-update.yml` läuft bei jedem Push mit
Datenbank-Änderungen:

1. Sie prüft das Schema auf einer frischen, lokalen Postgres-Datenbank (`verify_local.sh`, auch im Modus „ältere
   Datenbank“).
2. Nur wenn alles grün ist, spielt sie `update-to-latest.sql` auf Supabase ein. Die Datei ist idempotent.

Zugang über das Repository-Secret `SUPABASE_DB_URL` (Session-Pooler-Verbindung), das nur der Besitzer in GitHub
einträgt. Ohne Secret wird nur geprüft. Die Teile unter `supabase/sql-editor/` bleiben als Weg von Hand.

Umsetzung Server (M3i):

- **Betriebsstunde:** `player_company_close_hour` rechnet jede volle Stunde ab und mit `player_companies_run_due`
  bis zu 48 Stunden nach. Spieler werden in derselben Abrechnung über `accrue_job_salary` bezahlt; Jobs bei KI-Firmen
  bezahlt `accrue_salaries` in ganzen Stunden.
- **Quartalsabschluss:** Er bucht kein Geld mehr. Er fasst die Stunden zum Bericht zusammen, bewegt Bekanntheit und
  Qualität und verteilt den Bonus (20 % des positiven Quartalsgewinns).
- **Lohnfaktor:** Der alte Quartals-Mindestlohnfaktor (50 %) entfällt; es gilt die stündliche Regel.

## ADR-078: Firmenseite mit Banner, großem Logo, Büro und Firmenkasse — `akzeptiert`

Vorgabe: Die Firmenseite wirkte unübersichtlich, statisch und langweilig.

- **Banner:** Ein Pixel-Banner (48 × 12, bis 6 Farben) steht über der Seite und lässt sich jederzeit neu zeichnen
  (`set_company_banner`). Er wird auf verbotene Symbole geprüft wie das Logo.
  - Er wird ganzzahlig skaliert, höchstens 8-fach; die Seiten füllt seine erste Farbe.
- **Logo:** Es sitzt groß (6-fach) wie ein Siegel auf dem Banner.
- **Büro:** Alle Mitarbeitenden stehen als Pixel-Figuren im Büro.
  - Spieler mit Schreibtisch, KI-Kräfte als Roboter.
  - Alle tragen ein T-Shirt in der Firmenfarbe mit dem verkleinerten Logo (`staffFigure`, `shrinkLogo`, getestet).
  - Sie wippen leicht, jede Figur in ihrem eigenen Rhythmus; bei reduzierter Bewegung stehen sie still.
  - Freie Plätze sind leere Tische.
- **Firmenkasse:** Eine eigene Karte zeigt die Kasse live, das eigene Privatgeld, die letzten Stunden als Balken und
  zwei große Knöpfe „Einzahlen“ / „Entnehmen“.
  - Das Formular zeigt den Fluss Privat ↔ Firma mit dem Stand vorher und nachher und hat Schnellbeträge
    (10 %, 25 %, 50 %, Alles).

## ADR-079: Pixel-Editor als großes Fenster in der Mitte — `akzeptiert`

Logo- und Banner-Editor öffnen sich nicht mehr seitlich, sondern als großes Fenster in der Mitte (`Modal`, Radix
Dialog, nur Opacity und Scale). Beide nutzen denselben `PixelEditor`:

- große Zeichenfläche links, Werkzeuge rechts (Stift, Linie, Füllen, Radierer)
- Farben, Spiegeln, Rückgängig (auch Strg+Z), Vorschau
- **Malen mit gedrückter linker Maustaste:** Zwischen zwei Mauspositionen werden alle Felder gefüllt
  (`cellsBetween`, Bresenham, getestet), auch schnelle Striche haben keine Lücken.
- Die rechte Maustaste radiert, das Feld unter dem Zeiger ist markiert.

## ADR-080: Artworks – Pixel-Kunst, Auktionen, Sammlungen — `akzeptiert`

Vorgabe: Geld soll freiwillig ausgegeben werden. Kunstwerke sind die erste solche Senke. Konzept und Schnittstelle:
`docs/ARTWORKS.md`.

- **Tab „Artworks“:** freigeschaltet ab Level 8, Finn erklärt ihn kurz bei der Freischaltung und beim ersten Besuch.
- **Galerie:** 36 Werke des Spiels, erzeugt von `scripts/gen-artworks.ts`. Die Galerie versteigert 4 pro Tag.
- **Eigene Werke:**
  - 32 × 32 Pixel, 16 Farben, im großen Editor gemalt.
  - Das erste kostet 15.000 €, jedes weitere das Doppelte.
- **Einzigartig:** Jedes Werk gibt es einmal, mit Nummer (`ART-0042`), Urheber und Label
  „NEXA-Galerie“ oder „von Spieler“.
- **Auktionen:**
  - Gebote mindestens 5 % über dem aktuellen.
  - Das Geld des Führenden liegt auf einem Treuhandkonto.
  - Gebote in den letzten 2 Minuten verlängern die Auktion.
  - 10 % Gebühr an die Haushalte.
- **Wert:** Der Wert ist der letzte Preis und zählt zum Vermögen.
- **Beliebtheit:** Likes und Bieter heben ein Werk an, das Alter senkt es.
- **Marktplatz:** sortierbar nach beliebt, teuerste, neueste und endet bald, filterbar nach Herkunft.
- **Ranglisten und Profile:** Größte Sammlungen, Teuerste Kunstwerke; die Sammlung steht im Spielerprofil.
- **Demo:** KI-Sammler (die Tycoons) bieten alle zehn Minuten mit.
- **Navigation:** Auf dem Handy hat die Tab-Leiste jetzt sieben Tabs mit kurzen Beschriftungen („Depot“,
  „Kunst“). Die vollen Namen stehen als `aria-label`.

## ADR-081: Viel mehr Missionen — `akzeptiert`

Die Missionen decken jetzt mehr Bereiche ab: Handel, Recherche, Tagesbonus, Limit-Orders, Anleihen, Kunst (Herzen,
Gebote, eigenes Werk, Versteigern), Jobs, Skills und Firma, über schnelle, tägliche, wöchentliche und
Meilenstein-Missionen. Kunst-Missionen erscheinen erst mit der Freischaltung. Der Server-Katalog steht in
`mission_templates`, der Demo-Katalog in `src/features/game/demo/missions.ts`.

## ADR-082: Grundstück – Zuhause kaufen, einrichten, Garage — `akzeptiert`

Vorgabe: ein eigenes Zuhause als großes, freiwilliges Ziel zum Geldausgeben und Herzeigen. Regeln und Schnittstelle:
`docs/PROPERTY.md`.

- **Tab „Grundstück“:** ab Level 4. Fünf Stufen von der Wohnung (25.000 €) bis zur Luxus-Villa (15 Mio. €), mit
  wachsender Fläche.
- **Umziehen:**
  - Die alte Bleibe wird zur Hälfte angerechnet.
  - Alle Möbel kommen ins Inventar, die Autos bleiben in der Garage.
- **Möbel:**
  - 65 Stücke in 10 Kategorien und 5 Preisklassen (25 € bis 1,5 Mio. €), von oben gezeichnet
    (`scripts/gen-furniture.ts`).
  - Teppiche liegen unter den Möbeln, sonst keine Überlappung.
  - Drehen um 90°.
- **Großer Einrichtungs-Editor:**
  - Aus dem Inventar wählen, auf freie Felder setzen, auswählen, drehen, verschieben, wegräumen.
  - Wandfarbe frei wählen; Böden einmal kaufen.
- **Garage:** ab dem Haus, mit 14 Autos ausgedachter Marken (9.000 € bis 7,5 Mio. €), angelehnt an Kleinwagen bis
  Supersportler. Echte Markennamen meiden wir aus rechtlichen Gründen.
- **Herzeigen und Vermögen:**
  - Auf jedem Spielerprofil sieht man Zuhause und Garage.
  - Im Vermögen zählen die Bleibe mit 50 %, Möbel, Böden und Autos mit 40 % (so viel bringt ein Verkauf).
- **Handy:** Die Leiste unten hat sechs Tabs und „Mehr“. Unter „Mehr“ liegen Kunst, Grundstück, Profil, Missionen
  und Ranglisten. Finn zeigt bei neuen Bereichen auf „Mehr“, wenn der Tab dort liegt.

## ADR-083: Mehr Wege zum Gewinn, Wachstum ohne Grenze — `akzeptiert`

Vorgabe: Viele Firmen machen nur Minus, und es ist unklar, warum. Spieler sollen mehr Hebel haben. Die gleiche
kleine Firma soll zum Riesen wachsen können. Wer später einsteigt, soll größer anfangen können. Nach oben gibt es
keine Grenze. Werte stehen in `BALANCE.startups`, Formeln in `src/lib/sim/startup.ts`.

- **Auftragsarbeit:**
  - Ein Teil der freien Kapazität (25 %) wird als Auftrag an andere Firmen verkauft, mit fester Bruttomarge (30 %).
  - Standardmäßig an.
  - Eine junge Garage deckt damit ihre Fixkosten. Eine KI-Kraft trägt sich damit aber nicht: Ihr Lohn verlangt
    echte Nachfrage.
- **Preisstrategie:**

  | Strategie | Preis | Nachfrage | Mundpropaganda |
  | --------- | ----- | --------- | -------------- |
  | Günstig   | × 0,8 | × 1,35    | × 1,5          |
  | Normal    | × 1   | × 1       | × 1            |
  | Premium   | × 1,3 | × 0,75    | × 0,7          |
  - Günstig lohnt sich zum Bekanntwerden.
  - Premium lohnt sich mit guter Qualität. Unter 50 % Qualität halbiert Premium die Nachfrage.

- **Gewinn-Coach:**
  - Eine Karte im Unternehmen nennt den Engpass: zu wenig bekannt, Kapazität voll, KI-Kräfte zu teuer, Werbung zu
    hoch, Fixkosten.
  - Dazu nennt sie den passenden nächsten Schritt.
  - Die Regeln stehen in `src/features/company/coach.ts`.
- **Größere Rechtsform, größerer Markt:**
  - Die verborgene Marktgröße wird je Rechtsform vervielfacht: Garage × 1, Kleinunternehmen × 4, GmbH × 15,
    AG × 40.
  - Ein Upgrade lässt also dieselbe Firma wachsen.
- **Größer gründen:**
  - Ab Level 15 kann man direkt eine GmbH gründen.
  - Wer größer gründet, startet bekannter: Garage 3 %, Kleinunternehmen 8 %, GmbH 20 %.
  - Die AG bleibt dem Börsengang vorbehalten.
- **Börsengang früher:** ab Level 6, schon aus der Garage.
- **Ausbaustufen ohne Ende:**
  - Ab der GmbH kauft die Firma aus ihrer Kasse Ausbaustufen.
  - Jede Stufe bringt +10 Plätze, +10 % Kapazität und +50 % Markt (neue Regionen, neue Kunden).
  - Jede Stufe erhöht die Fixkosten um 25 % der Grundkosten.
  - Stufe n kostet 100.000 € × 1,8ⁿ.
  - Es gibt keine letzte Stufe. Die Kosten wachsen schneller als der Nutzen, deshalb wird Wachstum immer
    schwerer, hört aber nie auf.
- **Bestehende Firmen** behalten ihre Marktgröße. Sie profitieren sofort von Auftragsarbeit und vom Faktor ihrer
  Rechtsform.

## ADR-084: Freunde — `akzeptiert`

Vorgabe: Freunde hinzufügen und über sie ihre Profile sehen. Mitarbeiter in der Firma anklicken und ihr Profil
öffnen.

- **Anfragen:**
  - Auf jedem Spielerprofil steht „Als Freund hinzufügen“.
  - Der andere nimmt an oder lehnt ab.
  - Schickt der andere selbst schon eine Anfrage, macht eine Gegenanfrage die Freundschaft sofort.
- **Seite „Freunde“** (unter „Mehr“ und auf dem eigenen Profil):
  - Freunde mit Level und Link zum Profil.
  - Offene Anfragen an mich, mit Annehmen und Ablehnen.
  - Eigene, noch offene Anfragen.
- **Entfernen:** Eine Freundschaft lässt sich jederzeit lösen. Eine eigene Anfrage lässt sich zurückziehen.
- **Mitarbeiter:** Figuren im Büro und Plätze im Team öffnen das Profil des Spielers. KI-Kräfte haben kein
  Profil.
- **Server:** RPCs `get_friends`, `send_friend_request`, `respond_friend_request`, `remove_friend` auf der
  bestehenden Tabelle `friendships`.

## ADR-085: Spieler-Tag, Namen ohne Doppelgänger, Spielersuche — `akzeptiert`

Vorgabe: Spielernamen sollen einzigartig sein. Jeder Spieler hat einen kleinen Tag, über den man ihn oben in der
Suche findet.

- **Namen:**
  - Groß- und Kleinschreibung zählten schon vorher nicht ("Mira" = "mira").
  - Neu: Auch Doppelgänger sind gesperrt. Ziffern als Buchstaben, Umlaute und Unterstriche zählen nicht. "M1ra" und
    "Mi_ra" sind also vergeben, wenn es "Mira" gibt.
  - Verschiedene Namen bleiben verschieden: "Mira2" ist frei, "Matthias" und "Mathias" sind zwei Namen.
  - Das gilt für neue Namen und Umbenennungen. Bestehende Namen bleiben, wie sie sind.
  - Regel: `nameKey` in `src/lib/player-tag.ts`, auf dem Server `name_violation`.
- **Tag:**
  - Jeder Spieler bekommt einmal einen Tag aus vier Zeichen, z. B. `#K7Q2`. Er bleibt auch nach einer Umbenennung
    gleich.
  - Die Zeichen sind ohne 0/O und 1/I, damit man ihn vorlesen und abtippen kann.
  - Der Tag steht auf der Visitenkarte, in der Freundesliste, in der Suche und auf dem eigenen Profil (zum
    Kopieren).
- **Suche oben:**
  - Findet Aktien und Spieler in einer Liste.
  - Spieler ab zwei Zeichen: über den Namen (genaue Treffer zuerst, dann Anfang, dann Teil) oder direkt über den
    Tag, mit oder ohne `#`.
  - Höchstens acht Spieler pro Suche.
- **Freunde:** Eine Anfrage geht auch per Tag.

## ADR-086: Tresor zum Öffnen, automatische CEO-Auszahlung — `akzeptiert`

Vorgabe: Der eigene Tresor soll viel schöner sein. Man soll ihn öffnen können und dort mit einer schönen
Geld-Animation alle Einnahmequellen sehen, dynamisch und lebendig. Als CEO soll man sich automatisch einen Anteil vom
Gewinn auszahlen können.

- **Tresor:**
  - Eine große Pixel-Tresortür mit goldenem Rad. Ein Tipp öffnet sie: Sie schwingt in den Angeln auf (3D-Drehung),
    und Münzen springen heraus.
  - Innen liegt Gold: Barren als Pyramide und Münzstapel, mehr, je voller der Tresor ist. Dazu ein goldenes Leuchten.
  - Der volle Tresor leuchtet.
  - Geöffnet zeigt er „Deine Einnahmequellen“: Grundeinkommen, Job und CEO-Auszahlung, jeweils pro Stunde. Jede Quelle
    hat einen Geldstrom: Ein Balken zeigt ihren Anteil, und ein Lichtpunkt läuft ständig darüber. Oben steht die
    Summe pro Stunde. Ein Tipp auf eine Quelle führt zu Job oder Firma.
  - „Tresor leeren“ bleibt wie bisher: Die Münzen fliegen ins Guthaben. Mit reduzierter Bewegung blendet die Tür nur
    über, und die Ströme stehen still.
- **CEO-Auszahlung:**
  - Im Unternehmen wählt der Gründer 0 bis 100 % in 5-%-Schritten.
  - Nach jeder Stunde mit Gewinn geht dieser Anteil vom Gewinn automatisch aufs Privatkonto.
  - Die Auszahlung ist nur aus freiem Geld möglich: Offene Rechnungen werden zuerst bezahlt. Eine Verlust-Stunde
    zahlt nichts.
  - Gebucht wird wie eine Entnahme. Der Gewinn der Firma bleibt gleich, die Kasse sinkt. Bei offenen Zwangskrediten
    wird wie bei jeder Entnahme ein Teil einbehalten.
  - Die Firmenkarte zeigt die letzte Stunde und die Summe von heute. Der Tresor zeigt sie als Einnahmequelle.
  - Offen: Bei börsennotierten Firmen geht die Auszahlung wie jede Entnahme ganz an den Gründer. Eine Dividende für
    alle Aktionäre wäre ein eigenes Feature.
- Regeln: `founderPayoutCents`, `isValidFounderPayout` in `src/lib/sim/startup.ts`; Server `set_founder_payout` und
  `player_company_close_hour` (Migration M4e).

## ADR-087: Tägliche Belohnung als Schatztruhen im Pixel-Stil — `akzeptiert`

Vorgabe: Das Fenster der täglichen Belohnung soll schöner werden, weniger nach Standard-Oberfläche aussehen und zum
Pixel-Stil passen.

- **Truhen:**
  - Jeder Tag ist eine Pixel-Truhe. Tag 7 ist eine große goldene „Schatz“-Truhe über die ganze Breite.
  - Die Truhe von heute hüpft und funkelt. Beim Öffnen springt der Deckel auf, und Münzen fliegen heraus.
  - Abgeholte Tage zeigen offene, leere Truhen.
- **Pixel-Rahmen:** eckige Kanten, 2-px-Rand und ein harter Stufen-Schatten wie bei Knöpfen alter Konsolenspiele.
- **Belohnungen** als kleine Pixel-Symbole: Stern für XP, Münze für Geld, Edelstein für einen Skillpunkt.
- **Serien-Leiste:** Flamme, sieben Pixel-Kästchen für die Woche und ein Schild für den Serien-Schutz.
- **Layout:** drei Spalten auf Handy und Desktop. Mit reduzierter Bewegung stehen Truhen und Funken still.

## ADR-088: Freundes-Feed, Applaus und Benachrichtigungen — `akzeptiert`

Vorgabe: Beim Öffnen soll man sehen, was die Freunde erlebt haben. Das soll zum täglichen Vorbeischauen motivieren,
ohne Druck.

- **Feed:**
  - Der Server schreibt Einträge selbst, wenn etwas passiert:
    - jedes 5. Level und große Gewinne (ab 1.000 € und 15 %)
    - Firmen gegründet, gewachsen, an der Börse, ausgebaut
    - Kunstwerke ersteigert oder gemalt
    - Umzüge und teure Autos, neue Jobs
    - Serien-Meilensteine (7, 30, 100, 365 Tage), Liga-Sieg, neue Freundschaften
  - Die Einträge entstehen über Trigger an den Tabellen, damit keine große Funktion umgeschrieben werden musste.
  - Man sieht die eigenen Einträge und die der Freunde, nach 30 Tagen werden sie gelöscht.
  - Der Text entsteht im Client aus Art und Daten.
- **Applaus:** Ein Herz unter jedem Eintrag. Der andere bekommt eine Benachrichtigung, pro Eintrag und Person nur
  einmal.
- **Benachrichtigungen:**
  - Eine Glocke oben zeigt die Zahl der ungelesenen. Ein Tipp öffnet die Liste. Was man gesehen hat, gilt nach
    kurzer Zeit als gelesen.
  - Neue Arten: Applaus, überboten bei einer Auktion, neue Bewerbung, Ergebnis der Wochenliga, Ereignis im Depot,
    Lage in der eigenen Firma.
  - Jede Art lässt sich abschalten.
- **Freunde-Bereich:** Tabs „Neuigkeiten“, „Wochenliga“, „Freunde“. Auf der Startseite stehen die letzten drei
  Einträge.

## ADR-089: Wochenliga mit Pokalen — `akzeptiert`

- Eine Saison läuft von Montag 0 Uhr bis Montag 0 Uhr (Berlin).
- **Gewertet wird der Zuwachs des Vermögens in Prozent seit Saisonstart.** Freies Geld zählt nicht als Leistung:
  Grundeinkommen aus dem Tresor und Bargeld aus der täglichen Belohnung werden herausgerechnet. Lohn und
  CEO-Auszahlungen zählen, sie sind erarbeitet.
- Kleine Vermögen werden mit mindestens 10.000 € gerechnet, damit wenige Euro nicht hunderte Prozent ergeben.
- Der Stand wird alle 10 Minuten neu berechnet. Man sieht „Freunde“ oder „Alle“ und „Diese Woche“ oder
  „Letzte Woche“.
- **Saisonende:**
  - Die ersten drei bekommen Gold, Silber und Bronze.
  - Die Pokale stehen auf der Visitenkarte.
  - Alle Teilnehmer bekommen ihre Platzierung als Benachrichtigung.
  - Der Sieger steht im Feed.
- Ein Konto-Reset löscht auch die Pokale.

## ADR-090: Angekündigte Ereignisse — `akzeptiert`

Vorgabe: Termine mit Ankündigung, zu denen man zurückkommt, ohne Kauf-Countdowns. Die Formeln aus der Simulation
(`src/lib/sim/events.ts`, `central-bank.ts`) laufen jetzt auf dem Server.

- **Börsenglocke:** täglich 8 und 22 Uhr.
- **Quartalszahlen:**
  - Die drei größten KI-Firmen berichten am Ende jedes Quartals: besser, schwächer oder wie erwartet, mit der
    Gewinnveränderung.
  - Der Kurseffekt kam schon vorher aus dem Quartalsabschluss. Das Ereignis macht ihn sichtbar und angekündigt.
- **Pharma-Studien:**
  - Jede börsennotierte KI-Pharmafirma kann pro Quartal eine Studie bekommen. Sie wird zwei Quartale vorher
    angekündigt.
  - Erfolg oder Misserfolg bewegt den Kurs um 50 bis 70 %.
  - Der fiktive faire Wert und die gleitenden Durchschnitte ziehen mit. So holen Fonds und Trendfolger den Sprung
    nicht zurück.
  - Wer die Aktie hält, bekommt eine Benachrichtigung.
  - Spielerfirmen haben keine Studien.
- **Zinsentscheid:**
  - Alle zwei Quartale, nach einer Anlaufzeit von 14 Tagen.
  - Gemessen wird das Geldmengenwachstum pro aktivem Spieler: Geld der Spieler und ihrer Firmen, ohne KI-Firmen.
  - Ohne Vergleichswert bleibt der Zins gleich. Die Formel würde sonst „0 % Wachstum“ annehmen und senken.
  - Eine Zinsänderung bewegt die Stimmung aller Aktien.
- **Anzeige:** Die Seite „Events“ zeigt „Demnächst“ und „Die letzten 24 Stunden“. Termine zur selben Zeit stehen in
  einer Zeile. Die Startseite zeigt die nächsten drei.

## ADR-091: Firmen-Lagen (Krisen und Chancen), Gegenmaßnahmen, Firmen-News und KI-Redaktion — `akzeptiert`

Vorgabe:

- Unternehmer erleben Zufallsereignisse, die ihr Geschäft und ihre Aktie bewegen, höchstens eines am Tag.
- Probleme lassen sich nicht mit einem Klick lösen. Die Lösungen sind verschieden aufwendig.
- Firmen-News sehen Gründer und Mitarbeiter.
- Texte und Ereignisse passen zu dem, was die Firma herstellt. Dafür versteht eine kleine KI die Firmenbeschreibung.

- **Lagen:**
  - 15 Arten im Katalog `src/config/company-events.ts`:
    - 10 Krisen: Regulierung, Sondersteuer, Lieferengpass, Qualitätsskandal, Datenleck, Preiskampf, Streik,
      Protest, Patentklage, Verriss
    - 5 Chancen: Viral-Trend, Großauftrag, Auszeichnung, Förderprogramm, Partnerschaft
  - Jede Firma würfelt einmal am Tag (60 %). Zwischen zwei Lagen liegen mindestens 22 Stunden. Neue Firmen haben
    6 Stunden Ruhe.
  - Schwere 1 bis 3 vervielfacht die Wirkung.
- **Wirkung** (`src/lib/sim/company-events.ts`):
  - Lagen verändern Nachfrage, Kapazität oder Kosten in der stündlichen Abrechnung.
  - Eine Krise wirkt bis zur Frist schon zu 25 %, danach voll, bis sie gelöst oder vorbei ist.
  - Eine Chance wirkt nur, wenn man sie nutzt.
  - Börsennotierte Firmen: Die Aktie fällt bei einer Krise und erholt sich, wenn sie gelöst wird. Bei einer Chance
    steigt sie.
- **Gegenmaßnahmen:**
  - Jede Lage hat zwei bis vier Strategien, z. B. Lobbyarbeit, Produktion anpassen oder Aussitzen.
  - Eine Strategie ist eine Kette von Schritten. Jeder Schritt kostet Geld aus der Firmenkasse (mit der
    Firmengröße skaliert) und dauert Stunden. Manche brauchen eine Mindestzahl an Leuten oder binden Kapazität.
  - Jeder Schritt kann scheitern. Know-how des Teams im passenden Skill-Bereich (Recht, Vertrieb, Wissenschaft …)
    erhöht die Chance, Schwere senkt sie.
  - Gescheiterte Schritte lassen sich zum halben Preis wiederholen. Ein Strategiewechsel verwirft den
    Fortschritt.
  - Wer bis zur Frist teilweise fertig ist, bekommt einen Teil der Wirkung.
  - Lohnende Strategien geben einmalig Bekanntheit oder Qualität.
- **Firmen-News:**
  - Jede Lage und jeder Schritt erzeugt eine Meldung, ebenso Gründung, Wachstum, Ausbau, Börsengang, neue
    Mitarbeiter und Rekordstunden.
  - Der Gründer sieht sie im Unternehmen, Mitarbeiter im Job-Tab, zusammen mit der aktuellen Lage (nur lesend).
- **Mini-KI** (`src/lib/company-story.ts`, `src/config/company-lexicon.ts`):
  - Erkennt aus Name und Beschreibung eine von 33 Produktfamilien, z. B. Energy-Drinks oder Toilettenpapier.
  - Das Produktwort nimmt sie aus dem Satz des Spielers.
  - Sie füllt die Textbausteine mit passenden Rohstoffen, Steuern, Vorschriften, Risiken, Trends, Kunden und
    Kritikern.
  - Steuer und Rohstoff passen zusammen („Taurin-Steuer“ und „Taurin“).
  - Unbekannte Produkte behalten das Wort des Spielers und bekommen Begriffe aus der Branche.
- **KI-Redaktion (optional, Claude):**
  - Die Edge Function `company-writer` lässt Claude einmal pro Firma ein Wortprofil schreiben und zu jeder Lage
    Schlagzeile, Meldung und Auslöser. Das ergibt quasi unendlich viele Varianten.
  - Claude schreibt nur Text. Zahlen, Chancen und Preise kommen immer aus der Datenbank.
  - Die Datenbank prüft Länge und gesperrte Begriffe und überschreibt nichts.
  - Die Firmenbeschreibung gilt im Prompt als Spielermaterial, nicht als Anweisung.
  - Modell und Einstellungen:
    - Modell: `claude-opus-5-5` mit niedrigem Aufwand und strukturierter JSON-Ausgabe.
    - Lehnt das Modell eine Anfrage ab, übernimmt automatisch ein anderes (Server-Fallback).
  - Kosten: ein Aufruf pro Firma und einer pro Lage, also höchstens ein paar Cent am Tag für vier Spieler.
    `claude-haiku-5-5` wäre deutlich günstiger, wenn gewünscht.
  - Ohne Schlüssel antwortet die Funktion `not_configured`, und die Mini-KI schreibt alle Texte.
- **Einrichtung der KI-Redaktion** (einmalig, alles in GitHub unter Settings → Secrets and variables → Actions):
  1. `SUPABASE_ACCESS_TOKEN`: ein persönlicher Zugriffstoken aus dem Supabase-Dashboard (Account → Access Tokens).
  2. `SUPABASE_PROJECT_REF`: die Projekt-ID (steht in der Supabase-URL hinter `/project/`).
  3. `ANTHROPIC_API_KEY`: ein API-Schlüssel aus der Claude-Konsole.
  4. Beim nächsten Push spielt die GitHub Action die Funktion ein und hinterlegt den Schlüssel als
     Funktions-Secret. Er erscheint nie im Log.

## ADR-092: Handy: Inhalt scrollt im Spiel, nicht im Browser; Installations-Hinweis — `akzeptiert`

Problem: Im Handy-Browser kamen Tipps auf die untere Navigation manchmal nicht an. Ist die Seite gescrollt, blendet
der Browser (vor allem Safari am iPhone) seine Leisten aus. Ein Tipp in den unteren Bildschirmbereich holt sie
zurück, statt den Knopf zu drücken.

- **Unter 1024 px** scrollt nur der Spielinhalt (`#scroll-root` in der App-Hülle). Die Seite selbst steht still,
  deshalb klappen die Browserleisten nicht mehr ein, und der erste Tipp unten zählt. Auf dem Desktop bleibt das
  normale Seitenscrollen.
- Beim Seitenwechsel springt der Inhalt nach oben (`ScrollReset`).
- Schon vorher gesetzt: `touch-action: manipulation` (keine Doppeltipp-Verzögerung), keine Tipp-Hervorhebung, kein
  Überscroll-Ziehen.
- **Als App installieren:** Im Handy-Browser zeigt die Startseite einmal einen Hinweis, bis er weggeklickt wird.
  Android bekommt den Installations-Dialog, iPhones die zwei Schritte über „Teilen“. Als installierte App läuft
  NEXA im Vollbild, ganz ohne Browserleisten.

## ADR-093: Verbesserungen für Spielgeld — `akzeptiert`

Vorgabe: Spieler sollen Dinge für Geld verbessern können, etwa die Tresorgröße und ein wenig das Grundeinkommen.

- **Fünf Verbesserungen** (`src/config/upgrades.ts`, Formeln in `src/lib/sim/upgrades.ts`), jede mit Stufen:

  | Verbesserung   | Wirkung je Stufe                             | Stufen | Preise                       | ab Level |
  | -------------- | -------------------------------------------- | ------ | ---------------------------- | -------- |
  | Tresor         | +2 Stunden Platz (8 h → 20 h)                | 6      | 3.000 € bis 96.000 € (× 2)   | 1        |
  | Grundeinkommen | +10 % (höchstens +30 %, also nur etwas)      | 3      | 4.000 €, 12.000 €, 36.000 €  | 3        |
  | Weiterbildung  | 1 Arbeitsstunde weniger je Fachpunkt (6 → 3) | 3      | 8.000 €, 24.000 €, 72.000 €  | 2        |
  | Überstunden    | +1 bezahlte Arbeitsstunde am Tag (12 → 14)   | 2      | 20.000 €, 60.000 €           | 5        |
  | Rhetorik-Kurs  | +5 % Beförderungschance bei KI-Chefs         | 3      | 10.000 €, 25.000 €, 62.500 € | 5        |

- Preis der nächsten Stufe: Grundpreis × Faktor^Stufe, auf ganze Euro gerundet.
- Das Geld geht an die Staatskasse, aus der das Grundeinkommen kommt (geschlossener Geldkreislauf, ADR-041).
- Die Seite **Verbesserungen** zeigt je Verbesserung „jetzt → danach“, die Stufen als Pixel-Balken und den Preis.
  Der Tresor verlinkt dorthin („Tresor vergrößern“), die Skillpunkt-Erklärung auf „Weiterbildung“.
- Der Treasury-Faktor des Grundeinkommens (ADR-041) gilt weiter, auch für die verbesserte Rate.
- Ein größerer Tresor zahlt keine Stunden nach, in denen er schon voll war: Er behält, was drin ist, und füllt sich
  von da an weiter.

## ADR-094: Karriereleiter und Beförderung — `akzeptiert`

Vorgabe: Man soll intuitiv verstehen, wie das Gehalt steigt. Mit mehr Skills steigt die Chance auf eine Beförderung,
der Chef befördert, der Lohn steigt. Es muss klar sein, welche Skills man braucht.

- **Ränge:** Praktikant → Junior → Senior → Teamleitung → C-Level, innerhalb desselben Jobs.
- **Anforderungen für den nächsten Rang** (`careers.promotion`, `src/lib/sim/promotion.ts`):
  - das Level des Rangs (5, 12, 20, 25),
  - im **Hauptfach** des Jobs (erste Anforderung der Stelle) die Punktzahl des Rangs (2, 6, 12, 20),
  - ab Teamleitung zusätzlich die halbe Punktzahl in Management (außer der Job ist schon Management),
  - gearbeitete Stunden im aktuellen Rang: 12, 36, 72, 120.
- **KI-Chef:** Sind alle Anforderungen erfüllt, fragt man den Chef. Er sagt mit 40 % Ja, plus 8 % je Punkt über der
  Anforderung im Hauptfach, plus Rhetorik-Kurs, höchstens 90 %. Bei Nein geht die nächste Frage nach 24 Stunden.
  Mehr Skills heißen also direkt eine bessere Chance.
- **Spieler-Chef:** Die Anfrage landet beim Chef (Benachrichtigung, Team-Liste). Er befördert oder lehnt ab, und er
  kann jeden befördern, der die Anforderungen erfüllt, auch ohne Anfrage. Die Anforderungen sind dieselben, damit
  „Was brauche ich für Senior?“ überall dieselbe Antwort hat.
- **Neuer Lohn:** mindestens +15 % und mindestens der Grundlohn des neuen Rangs (bei KI-Chefs genau das, Spieler-Chefs
  dürfen mehr zahlen). Danach beginnen Stunden und die Basis für Gehaltserhöhungen neu.
- **Anzeige:** Im Job-Tab eine Karriereleiter mit allen Rängen. Der nächste Rang zeigt jede Anforderung mit Haken oder
  Fortschritt und einem „So schaffst du das“-Hinweis (z. B. „Lerne IT-Skills auf der Skill-Karte“). Dazu eine Karte
  „So steigt dein Gehalt“: Beförderung, Gehaltserhöhung (je neuem Punkt im Fach bis 3 %, alle 7 Tage), Bonus und
  Arbeitsaufgaben.
- Beförderungen erscheinen im Freunde-Feed.
- Bei KI-Chefs übernimmt der Job mit dem neuen Rang auch dessen Anforderungen und Lohnobergrenze, sonst wären weitere
  Gehaltserhöhungen gedeckelt. Eine offene Gehaltsanfrage verfällt mit der Beförderung.
- Bestehende Jobs bekommen ihre bisher bezahlten Minuten als Stunden im Rang gutgeschrieben, höchstens so viele, wie
  der nächste Rang braucht.
- Die alten, nie gebauten Werte `promotionSteps`, `negotiation` und `jobSwitch` entfallen.

## ADR-095: Skillpunkte erklärt — `akzeptiert`

Vorgabe: Es soll klarer werden, wie man Skillpunkte bekommt.

- Die Skill-Karte zeigt eine Karte **„So bekommst du Skillpunkte“** mit dem Fortschritt jeder Quelle:
  - **Level-Aufstieg:** +1 freier Punkt, mit XP-Balken bis zum nächsten Level.
  - **Arbeit:** alle 6 Arbeitsstunden (mit Weiterbildung weniger) +1 Fachpunkt in den Fächern des Jobs, mit
    Fortschritt je Fach. Ohne Job ein Hinweis auf die Jobbörse.
  - **Tagesbelohnung:** Tag 4 und Tag 7 der Serie, mit „noch n Tage“.
  - **Missionen** mit Skillpunkt-Belohnung.
  - **Schulung durch den Chef** (Spielerfirmen ab 5 Leuten): Der Chef zahlt, man lernt einen Skill direkt.
- Freie Punkte passen überall, Fachpunkte nur in ihrem Fach. Das steht in einem Satz darunter.
- Darunter **„Was bringen Skills?“:** mehr Produktivität, höhere Löhne bei KI-Firmen, Gehaltserhöhungen,
  Beförderungen und Stellen mit Anforderungen.

## ADR-096: Gewinnwege für Firmen — `akzeptiert`

Vorgabe: Als Unternehmer ist nicht klar, wie man Gewinn macht. Es braucht mehr Möglichkeiten und Erklärungen, intuitiv,
aber nicht jeder soll extrem erfolgreich werden.

- Die Firmenseite bekommt **„Gewinnwege“**: eine Liste aller Hebel mit einem Satz Erklärung, dem Stand der eigenen
  Firma (aktiv, möglich, gesperrt ab …) und einer **Schätzung in €/Stunde** aus den Zahlen der letzten Stunde.
  - Hebel: Preisstrategie, Auftragsarbeit, Team und KI-Kräfte, Marketing-Kampagne (neu, ADR-097), Lieferverträge
    (neu, ADR-098), Teilhaber (neu, ADR-098), Ausbau und Aufstieg, Börsengang.
  - Die Schätzung rechnet mit derselben Formel wie die Abrechnung: Mehr Nachfrage bringt nur etwas, wenn Kapazität
    frei ist; mehr Kapazität nur, wenn Kunden warten. So sieht man, warum etwas hilft oder nicht.
- Oben ein **Engpass-Satz** aus Nachfrage und Kapazität: „Dir fehlen Kunden“, „Dir fehlen Leute“ oder „ausgeglichen“.
- Nicht jeder wird reich: Kampagnen haben Glück im Ergebnis, Verträge brauchen verlässliche Partner, Märkte sind
  begrenzt, und viele Hebel kosten erst Geld.

## ADR-097: Marketing-Kampagnen — `akzeptiert`

- Drei Kampagnen (`startups.campaigns`, `src/lib/sim/campaigns.ts`):

  | Kampagne | Dauer | Preis                           | Nachfrage | Bekanntheit dauerhaft |
  | -------- | ----- | ------------------------------- | --------- | --------------------- |
  | Flyer    | 24 h  | 2 Stunden der letzten Nachfrage | +25 %     | +0,5 Prozentpunkte    |
  | Online   | 48 h  | 6 Stunden                       | +40 %     | +1 Prozentpunkt       |
  | TV-Spot  | 72 h  | 18 Stunden                      | +70 %     | +2,5 Prozentpunkte    |

- Mindestpreis 200 €. Bezahlt wird aus der Firmenkasse.
- Die Wirkung wird beim Start einmal gewürfelt: Glück zwischen 0,4 und 1,6, mal Qualität (halb fest, halb nach
  Qualität). Die Resonanz (schwach, ordentlich, stark) sieht man sofort.
- Eine Kampagne zur Zeit. Sie hebt die Nachfrage in der stündlichen Abrechnung; die Bekanntheit steigt beim Start
  (gedeckelt wie immer durch die Firmenstufe).
- Lohnt sich nur mit freier Kapazität. Die Gewinnwege-Schätzung zeigt das vor dem Kauf.

## ADR-098: Vertrauen und Deals unter Spielern — `akzeptiert`

Vorgabe: Viel soll über Vertrauen zwischen Spielern laufen.

- **Drei Deals per Handschlag** (`src/config/deals.ts`, `src/lib/sim/deals.ts`), ab Level 4:
  - **Kredit:** Ein Spieler leiht einem anderen Geld, mit Zinsen für die ganze Laufzeit (bis 30 %), 1 bis 30 Tage.
    Höchstens 20.000 € je Level des Verleihers. Zur Fälligkeit zieht der Server einmal ein, was frei auf dem Konto
    liegt. Was fehlt, ist überfällig. Nach 7 Tagen gilt der Kredit als geplatzt. Zurückzahlen geht jederzeit, auch
    später; der Verleiher kann den Rest erlassen.
  - **Liefervertrag** (Firma an Firma): Der Lieferant stellt freie Kapazität bereit, bis zu einer Menge je Stunde.
    Ist der Käufer ausverkauft, produziert der Lieferant die fehlende Ware; der Käufer verkauft sie zu seinem Preis
    und zahlt je Stück die vereinbarte Gebühr. Beide gewinnen, wenn die Gebühr zwischen den Herstellkosten des
    Lieferanten und dem Preis des Käufers liegt; die Vertragsmaske zeigt beide Margen. Optional eine Anzahlung
    (bis 50 % des Höchstbetrags), aus der die Gebühren zuerst bezahlt werden. Endet der Vertrag vorzeitig, bleibt
    der Rest der Anzahlung beim Lieferanten.
  - **Teilhaber:** Ein Spieler gibt einer Firma Geld und bekommt dafür einen Anteil an jeder Gewinnstunde (bis 30 %,
    alle Teilhaber zusammen bis 50 %), für eine feste Zeit. Teilhaber werden vor der Gründer-Auszahlung bedient.
    Der Gründer kann die Beteiligung vorzeitig beenden, das Geld bleibt dann in der Firma.
- **Angebote:** an einen bestimmten Spieler (Name oder Tag) oder offen an alle auf der Deal-Börse. Offene Angebote
  gelten 48 Stunden. Geld fließt erst, wenn jemand annimmt.
- **Vertrauen** (0 bis 100, Start 50): Pünktlich zurückgezahlt +4, später +2, überfällig −6, geplatzt −12,
  Vertrag erfüllt +3, zu wenig geliefert −4, Vertrag gebrochen −12, Verleihen +1, Erlassen +2.
  Stufen: Riskant, Wackelig, Unbeschrieben, Verlässlich, Felsenfest. Das Vertrauen steht auf der Visitenkarte und
  an jedem Angebot. Gebrochene Verträge und geplatzte Kredite erscheinen im Freunde-Feed.
- Der Server erzwingt, was er kann (Gebühren, Gewinnanteile, Einzug zur Fälligkeit). Das Wort halten muss man selbst:
  Darum geht es beim Vertrauen.
- **Vermögen:** Laufende Deals zählen im Vermögen, in der Reichenliste und in der Wochenliga mit. Der Verleiher hält,
  was noch offen ist, der Leihende schuldet es (auch geplatzt). Eine Beteiligung zählt beim Teilhaber und als Schuld
  der Firma, linear abgeschrieben über die Laufzeit. Eine unverbrauchte Anzahlung gehört dem Käufer. So macht ein
  Kredit unter Freunden niemanden reicher als die Zinsen.
- **Abrechnung (Migration M4j):**
  - Die Gründer-Auszahlung rechnet mit dem Gewinn nach den Teilhabern, sonst leerten 100 % Auszahlung plus
    Teilhaber jede Stunde die Firmenkasse.
  - Kann der Käufer eine Lieferung nicht bezahlen, schrumpft sie; gebraucht zählt dann nur der bezahlte Teil, damit
    der Lieferant nicht als unzuverlässig gilt.
  - Wird eine Firma aufgelöst, gelten ihre laufenden Lieferverträge und Beteiligungen als vom Gründer gebrochen.
  - Beim Neustart eines Kontos zahlt der Spieler zuerst seine Kredite zurück, soweit sein Geld reicht; dann
    verschwinden seine Deals und sein Vertrauensverlauf.
  - Grenze: Liefervertrag-Erlöse zählen nicht zum Stundengewinn, aus dem Teilhaber und Gründer bezahlt werden.

## ADR-099: Reihenfolge der Freischaltungen — `akzeptiert`

Vorgabe: Erst Jobs, dann Artworks, dann Firmen, dann Grundstücke. Nichts allzu spät, aber für manches soll man etwas
grinden.

| Level | Neu                                                          | etwa nach (aktiver Spieler) |
| ----- | ------------------------------------------------------------ | --------------------------- |
| 2     | erster Job (Ende des Tutorials)                              | Minuten                     |
| 3     | Limit-Orders, Watchlist                                      | erste Stunde                |
| 4     | **Artworks** (vorher 8)                                      | erster Tag                  |
| 5     | Stop-Loss, Anleihen, Junior-Jobs                             | erster Tag                  |
| 6     | **Garagen-Startup** (vorher 3)                               | zweiter Tag                 |
| 7     | Deals unter Spielern (vorher 4), Analystenberichte           | dritter Tag                 |
| 8     | **Grundstück** (vorher 4), Leerverkäufe                      | vierter bis fünfter Tag     |
| 9     | Börsengang der eigenen Firma (vorher 6 bzw. 25 in der Liste) | knapp eine Woche            |
| 10    | Kleinunternehmen, **Kryptowährungen** (neu, ADR-101)         | etwa eine Woche             |
| 14    | **eigene Kryptowährung** (neu, ADR-101)                      | etwa zwei Wochen            |
| 15    | GmbH (Liste jetzt passend zur Gründungsregel)                | etwa drei Wochen            |

- Die Werte stehen in `progression.unlocks`, `startups.garage.minLevel`, `startups.ipo.minLevel`, `deals.minLevel`
  und den Wohnungsstufen (`property.tiers`: Wohnung ab 8, Apartment ab 11). Der Server liest sie aus `game_config`.
- Wer eine Funktion schon genutzt hat, behält sie: Bestehende Firmen, Wohnungen und Deals bleiben, auch wenn das Level
  jetzt höher liegen müsste. Neu gründen, kaufen oder anbieten geht erst ab dem neuen Level.

## ADR-100: Verbesserungen mit Level-Stufen, drei Möbel-Ebenen, eindeutige Namen, Deals mit der Firma — `akzeptiert`

- **Verbesserungen nach Level** (`src/config/upgrades.ts`): Jede weitere Stufe braucht ein höheres Spieler-Level
  (Stufe n ab `minLevel + (n − 1) · levelStep`), z. B. Tresor ab Level 1, 3, 5, 7, 9, 11. Fünf neue Verbesserungen:

  | Verbesserung    | Wirkung je Stufe                        | Stufen | ab Level  |
  | --------------- | --------------------------------------- | ------ | --------- |
  | Mentor          | +10 % XP aus Arbeitsstunden             | 3      | 4, 8, 12  |
  | Kunststudio     | −10 % Kosten für ein neues Artwork      | 3      | 4, 7, 10  |
  | Effizienz-Coach | −5 % Fixkosten der eigenen Firma        | 3      | 6, 10, 14 |
  | Makler-Kontakte | −5 % auf Wohnungen, Möbel, Böden, Autos | 3      | 8, 12, 16 |
  | Hardware-Wallet | −25 % Pool-Gebühren beim Krypto-Handel  | 2      | 10, 15    |

- **Drei Ebenen beim Einrichten** (`src/lib/sim/property.ts`): Boden (Teppiche), Möbel, und neu **obendrauf**:
  kleine Dinge wie Lampen, Vasen, Laptop, Pokal oder Goldbarren stehen auf Tischen, Theken, Schreibtischen,
  Nachttischen und Kommoden (Möbel mit Ablagefläche). Ein Ding obendrauf muss ganz auf Ablageflächen stehen, je
  Kachel eines. Neu im Katalog: Nachttisch, Sideboard, Kommode, Bartheke und 18 Dinge für obendrauf.
- **Eindeutige Namen:** Firmen, Artworks und Kryptowährungen haben eindeutige Namen (Groß- und Kleinschreibung,
  Umlaute und ähnlich aussehende Zeichen zählen gleich, wie bei Spielernamen). Gründet jemand eine neue Firma, wird
  die alte aufgelöst (nach Bestätigung, wie beim Schließen), und ihr Name ist wieder frei.
- **Deals mit der Firma:** Deals schalten zusammen mit der ersten Firma frei (Level 6). Lieferverträge (ihre
  höchstmöglichen Kosten) und Beteiligungen dürfen höchstens halb so groß sein wie der Wert der Firma dahinter,
  mindestens aber 50.000 €. Große Deals kommen also mit einer wertvollen Firma. Kredite bleiben an das Level gebunden.

## ADR-101: Kryptowährungen — `akzeptiert`

Vorgabe: Kryptos ab einem Level, viel volatiler und schneller als Aktien, mehr Stablecoins und Shitcoins, mehr Risiko
und mehr Chancen. Eigene Währung mit Pixel-Logo, eine zur Zeit. Ein durchdachtes Konzept für die Entwicklung einer
Währung und Zufallsereignisse für den Kurs.

**Markt** (`src/config/crypto.ts`, `src/lib/sim/crypto.ts`):

- Handel ab Level 10, eigene Währung ab Level 14. Kryptos laufen rund um die Uhr, ohne Börsenzeiten.
- Jeder Coin hat einen **Liquiditätspool** (konstantes Produkt, x · y = k). Kaufen legt Geld in den Pool und nimmt
  Coins heraus, deshalb bewegt jeder Kauf den Kurs, kleine Pools viel stärker (Slippage). Die Pool-Gebühr (0,05 %
  bei Stablecoins bis 1 % bei Shitcoins) bleibt im Pool. Kein Hebel, keine Leerverkäufe, 25 % Steuer auf Gewinne
  wie bei Aktien.
- Der Markt (KI-Händler) handelt alle 5 Sekunden gegen die Pools. Ihr Geld kommt aus dem Finanzmarkt-Topf des
  geschlossenen Geldkreislaufs.
- **15 Coins** in vier Klassen (alle Namen erfunden):

  | Klasse      | Coins                                                         | Tagesschwankung | folgt dem Markt |
  | ----------- | ------------------------------------------------------------- | --------------- | --------------- |
  | Stablecoins | Euro-Stabil, Nexa-Stable, Algostabil, Goldtaler               | 0,2 %           | nein            |
  | Große       | Kryptaler, Nebula Chain, Quantor                              | 6 %             | Beta 1          |
  | Altcoins    | Flux, Orbit, Synapse                                          | 14 %            | Beta 1,3        |
  | Shitcoins   | Hamsterrakete, Mondkeks, Laserfrosch, Turbobrezel, Pixelpudel | 40 %            | Beta 1,6        |

  Zum Vergleich: Blue-Chip-Aktien schwanken um etwa 3 % am Tag.

- **Krypto-Wetter:** Der ganze Markt ist in einer Phase (Bullenmarkt +3 %/Tag, seitwärts, Bärenmarkt −3 %/Tag), die
  ein bis drei Tage dauert. Coins folgen ihr mit ihrem Beta, Stablecoins gar nicht.
- **Stablecoins** werden zum Kurs von 1 € zurückgezogen (Goldtaler: Goldpreis). Selten verlieren sie ihre Bindung
  (Depeg); Algostabil, ein algorithmischer Stablecoin, doppelt so hart.
- Stürzt ein Shitcoin nach einem Rug Pull unter 0,0002 €, ist er tot. Nach 24 Stunden ersetzt ihn ein neuer
  Shitcoin mit frischem Namen. Wer noch Coins hält, verliert sie.

**Zufallsereignisse** (einmal je Coin und Stunde gewürfelt, Wirkung als Kurssprung):

| Ereignis               | trifft                 | Wirkung                         | eigene Coins: wahrscheinlicher mit … |
| ---------------------- | ---------------------- | ------------------------------- | ------------------------------------ |
| Hack                   | Alt, Shit, eigene      | −30 … −60 %, Pool verliert 20 % | weniger Technik (Audit hilft)        |
| Bug im Smart Contract  | Alt, Shit, eigene      | −8 … −22 %                      | weniger Technik                      |
| Influencer-Post        | Alt, Shit, eigene      | +28 … +230 %                    | mehr Hype                            |
| Listing an einer Börse | Alt, Shit, eigene      | +22 … +80 %                     | mehr Technik und Nutzen              |
| Delisting-Gerücht      | Alt, Shit, eigene      | −10 … −30 %                     | weniger Technik und Nutzen           |
| Wal kauft / verkauft   | alle außer Stablecoins | ±10 … ±40 %                     | mehr Hype (Kauf)                     |
| Partnerschaft          | Große, Alt, eigene     | +10 … +42 %                     | mehr Nutzen                          |
| FUD (Angstmache)       | alle außer Stablecoins | −5 … −26 %                      | weniger Hype                         |
| Netzwerk-Upgrade       | Große, Alt             | +5 … +22 %                      |                                      |
| Depeg                  | Stablecoins            | −3 … −33 %                      |                                      |
| Meme-Welle             | ganzer Markt           | Shitcoins +22 … +120 %          |                                      |
| Regulierung            | ganzer Markt           | −5 … −22 %                      |                                      |
| Rug Pull               | KI-Shitcoins           | −92 … −99 %                     |                                      |

**Eigene Kryptowährung** (eine zur Zeit je Spieler):

1. **Gründen** (25.000 €): eindeutiger Name, Ticker (3 bis 5 Buchstaben, frei unter allen Wertpapieren), Pixel-Logo
   16 × 16 wie bei Firmen. Die Währung startet im Entwurf.
2. **Entwickeln:** Drei Werte von 0 bis 100 bestimmen den Kurs:
   - **Technik** (Sicherheit): Smart Contract programmieren (6 h, 2.000 €, 50 % Erfolg plus 3 % je IT-Skillpunkt,
     +15), Security-Audit (24 h, 15.000 €, sicher, +35), Bugfix (3 h, 1.000 €, +5). Technik verfällt nicht und
     macht den Kurs ruhiger (bis halbe Schwankung).
   - **Hype** (Community): Community aufbauen (4 h, 500 €, +10), Influencer bezahlen (2 h, 8.000 €, +35,
     15 % Risiko, dass es auffliegt). Hype verfällt um 3 % je Stunde (halbiert sich in einem Tag).
   - **Nutzen**: Partnerschaft (12 h, 6.000 €, +20), Staking einführen (12 h, 5.000 €, +15), beides erst nach dem
     Start. Nutzen verfällt langsam (0,5 % je Stunde).
   - Eine Aktion läuft zur Zeit.
3. **Starten** (ab Technik 20): Der Gründer wählt den Startkurs (0,01 €, 0,10 €, 1 € oder 10 €), legt mindestens
   5.000 € Liquidität in den Pool und behält 10 bis 50 % der Coins als Team-Anteil. Ab dann handeln alle.
4. **Kurs:** Tagestrend = 20 % × Hype + 8 % × Nutzen − 6 % (ohne Pflege fällt jede Währung), dazu Krypto-Wetter,
   Zufall und Ereignisse. Spieler bewegen den Kurs mit jedem Kauf und Verkauf über den Pool.
5. **Vertrauen:** Verkauft der Gründer mehr als 20 % seines Team-Anteils innerhalb von 24 Stunden, ist das ein
   **Rug Pull**: −20 Vertrauen, Hype fällt auf 0, und alle Freunde sehen es im Feed. Token verbrennen (+8 Hype) zeigt
   dagegen, dass der Gründer an seine Währung glaubt.
6. **Einstellen:** Der Gründer kann die Währung einstellen. Der Pool wird nach Coins an alle Halter ausgezahlt,
   der Gründer bekommt seinen Teil wie alle. Danach sind Name und Ticker frei, und er kann eine neue Währung gründen.
