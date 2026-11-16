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

**Umsetzung auf dem Server (M5a) und Abweichungen:**

- Wie bei Aktien kostet jeder Krypto-Handel zusätzlich die Ordergebühr (1 €). Beim Kauf ist sie im Betrag enthalten,
  beim Verkauf wird sie vom Erlös abgezogen. Der Kursrutsch (Slippage) wird ohne Ordergebühr gerechnet, mit
  Pool-Gebühr.
- Einstand und Steuer rechnen mit dem genauen Durchschnitt in Cent (keine Lose), weil Kurse unter einem Cent mit vier
  Nachkommastellen zu grob wären. Steuer, Verlusttopf, XP und Missionen wie bei Aktien.
- Die Geldflüsse der KI-Händler werden je Stunde gebucht statt je Tick (sonst 17.000 Buchungen am Tag). Pool-Konto
  plus offene Flüsse ergeben immer das Pool-Geld.
- Coins verbrennen ist eine eigene Aktion: höchstens einmal je Stunde und mindestens 1 % der Team-Coins beim Start
  (`create.burnMinBps`), sonst gäbe winziges Verbrennen Hype für nichts. Fliegt bezahlte Influencer-Werbung auf,
  kostet das 20 Hype und 15 % Kurs (`create.exposedHype`, `create.exposedShock`).
- Ein eingestellter Coin gibt Name und Ticker frei; sein Wertpapier bekommt intern einen Ersatz-Ticker, damit die
  Handelshistorie erhalten bleibt.
- Marktweite Ereignisse stehen einmal im Protokoll (ohne Coin); die Coin-Seite zeigt sie mit an.

## ADR-102: Beim Einloggen klar, was zu tun ist; Firma und Deals erklärt — `akzeptiert`

Vorgabe: Das Spiel ist am Anfang verwirrend, es soll intuitiver sein und beim Einloggen sofort zeigen, was zu tun
ist. Wie eine Firma etwas herstellt und wie Deals funktionieren, versteht man nicht.

- **„Heute dran“** oben auf der Startseite (`src/features/home/today.ts`, getestet):
  - Finn begrüßt nach Tageszeit, mit einem Satz zur wichtigsten Sache oder einem von vier Sätzen je Tageszeit.
  - Darunter höchstens vier Aufgaben in fester Reihenfolge, jede mit einem Tipp erledigt:
    1. Tagesbelohnung, voller Tresor (ab 40 %, ab 90 % dringend), fertige Missionen
    2. Lage in der Firma, Beförderung möglich, Arbeitsaufgabe, Deal-Angebote
    3. neu freigeschaltete Bereiche (noch nicht besucht), erster Job, erste Firma, freie Skillpunkte
    4. der Engpass der Firma
  - Ist nichts offen, zeigt sie den Weg zu den Märkten.
  - Hinter dem Bereich eine Pixel-Stadt, in der langsam Fenster aufleuchten.
- **Firma:** Die Karte „So verdient deine Firma Geld“ zeigt Team → Herstellung → Kunden → Gewinn mit den Zahlen der
  Firma, den Engpass in einem Satz, genau einen Knopf für den nächsten Schritt und kurze Fragen und Antworten.
  - Bis zur ersten abgerechneten Stunde schickt der Server Nullen. Das gilt jetzt als „erste Stunde läuft“ und
    nicht mehr als „ausverkauft“.
- **Deals:** „So funktionieren Deals“ erklärt die drei Arten mit Beispiel und wann sie sich lohnen, den Ablauf in vier
  Schritten und die eigenen Grenzen (Kredite nach Level, Firmen-Deals nach Firmenwert).
- **Missionen:** ein Klemmbrett mit abgehakten Punkten statt des Bullen.

## ADR-103: Achtstundentag, Lohn direkt aufs Konto, Anwesenheit — `akzeptiert`

Vorgabe: Der Lohn soll nicht in den Tresor gehen (der ist bei 800 € voll), man arbeitet 8 Stunden am Tag, wer lange
nicht da ist, verdient weniger, und nach mehr als 5 Tagen ohne Besuch wird man gekündigt.

- Der Lohn ging schon direkt aufs Konto. Die Anzeige „+ Job … pro Stunde“ stand aber unter dem Tresorbetrag. Jetzt
  steht sie getrennt: „Lohn … geht direkt auf dein Konto, nicht in den Tresor.“
- **8 bezahlte Stunden am Tag** (`careers.paidHoursPerDayCap`, auch für die Arbeits-XP). Die Verbesserung
  „Überstunden“ hebt auf 9 und 10 Stunden.
- **Anwesenheit** (`careers.inactivity`, `presencePayBps`): Ab einem Tag ohne Besuch gibt es 75 % Lohn, ab zwei Tagen
  50 %, ab drei Tagen 25 %. Nach fünf Tagen ohne Besuch endet der Job (Benachrichtigung, bei Spielerfirmen auch an
  den Chef). Als Besuch zählt jede Nutzung des Spiels. Die Zeit, in der man weg war, wird beim Zurückkommen mit dem
  gekürzten Satz abgerechnet.
- Die Job-Karte zeigt die Regel und bis wann man spätestens wieder vorbeischauen muss.
- Folge fürs Balancing: Der Lohn sinkt um ein Drittel. Firmen verdienen damit im Verhältnis mehr als Jobs
  (Kleinunternehmen etwa 2 bis 3 Junior-Löhne).

## ADR-104: Organigramm der Firma — `akzeptiert`

Vorgabe: Eine Hierarchie-Ansicht, in der man die Mitarbeiter als Personen sieht, seine Vorgesetzten und die eigene
Position. Größere Firmen bekommen später Vorgesetzte, Manager und mehr.

- Ganz oben der Gründer (CEO), darunter die Ränge Vorstand, Teamleitung, Senior, Junior, Praktikum, unten die
  KI-Kräfte. Jede Person als Pixel-Figur mit Name, Rang und Titel; die eigene Position ist markiert, der direkte
  Vorgesetzte (der nächsthöhere besetzte Rang) hervorgehoben.
- Der Gründer sieht es im Team, Mitarbeiter im Job-Tab. Daten: `get_company_org` (Gründer und Mitarbeiter der Firma).
- Mit mehr Rängen in größeren Firmen wächst das Organigramm von selbst.

## ADR-105: Skills als Pfade, die Karte als zweite Ansicht — `akzeptiert`

Vorgabe: Der Skilltree ist immer noch zu unübersichtlich; schöner und viel intuitiver.

- Die Hex-Karte zeigt 168 Felder auf einmal, mit abgekürzten Namen. Neue Spieler sahen nicht, was sie als Nächstes
  tun sollen. Standard ist jetzt die Ansicht **Pfade**, die Karte bleibt als zweite Ansicht.
- **Jetzt lernbar:** bis zu sechs Skills, die man jetzt lernen kann (oder für die nur Punkte fehlen), die Fächer des
  eigenen Jobs zuerst, dann die günstigen Stufen. Ein Tipp öffnet das Lernfenster.
- **Pfade:** Jeder der acht Bereiche ist eine Karte mit Fortschritt, Punktzahl und den Skills nach Stufen
  (Grundlagen bis Meisterschaft). Jeder Skill zeigt seinen Zustand: gelernt (Haken), lernbar (pulsierender Punkt),
  Punkte fehlen (gestrichelt), gesperrt (Schloss). Gezeigt werden die erreichten Stufen und die nächste; weitere
  Stufen klappen auf Wunsch auf.
- Gesperrte Skills nennen im Lernfenster, welche Nachbarn man zuerst lernen muss.
- Die Regeln bleiben gleich (ADR-061): Felder nahe der Mitte sind offen, alle anderen brauchen einen gelernten
  Nachbarn.

## ADR-106: Keine Nachbörse, die Börse ist rund um die Uhr offen — `akzeptiert`

Vorgabe: Die Nachbörse soll aus.

- Gespielt wird meist abends und nachts. Dann galt bisher die Nachbörse (22 bis 8 Uhr): dreifacher Spread, weniger
  Umsatz, „Nachbörse“ oben in der Leiste. Das bestrafte genau die Zeit, in der die meisten spielen.
- Die Börsenzeiten stehen auf 0 bis 24 Uhr (`time.marketOpenHour`, `time.marketCloseHour`). Server und Demo rechnen
  damit jeden Takt als reguläre Sitzung. Der Handelstag beginnt um Mitternacht.
- Eröffnungs- und Schlussglocke entfallen, solange die Börse nie schließt (beide lägen sonst um Mitternacht).
- Die Mechanik selbst bleibt: Mit anderen Börsenzeiten in der Konfiguration kommen Nachbörse und Glocken zurück
  (Tests prüfen beide Fälle).

## ADR-107: Navigation in Gruppen, gesperrte Bereiche unter „Bald frei“ — `akzeptiert`

Vorgabe: Links sind zu viele Tabs, das wirkt überfordernd. Kürzer und übersichtlicher gliedern; Krypto gehört wie
Aktien zum Investieren.

- Die Seitenleiste zeigt Gruppen mit kleiner Überschrift statt einer langen Spalte: **Investieren** (Portfolio,
  Märkte, Krypto), **Arbeit** (Job, Karriere), **Unternehmen** (Firma, Deals), **Besitz** (Artworks, Grundstück),
  **Du** (Freunde, Verbesserungen).
- Gesperrte Bereiche stehen nicht mehr einzeln mit Schloss in der Liste, sondern gesammelt unter **„Bald frei“** am
  Ende, mit dem nächsten Ziel („Krypto ab Level 10“). Aufgeklappt zeigt der Eintrag alle mit ihrem Level. Damit bleibt
  sichtbar, was kommt (ADR-035), es nimmt aber nur eine Zeile ein. Ein neuer Spieler sieht 7 Einträge statt 13.
- Das Profil liegt auf dem Profilbild oben rechts (jetzt auch am PC) und auf der Level-Karte unten in der Leiste.
- Grundstück hat ein eigenes Symbol (Haus mit Baum und Zaun) statt desselben Hauses wie „Start“.
- Am Handy bleibt die untere Leiste; „Mehr“ ist nach denselben Gruppen geordnet, Gesperrtes steht unter „Bald frei“.

## ADR-108: Grafik-Update „handgemacht“ — `akzeptiert`

Vorgabe: Ein großes grafisches Update. Alles soll schöner aussehen, mehr handgemacht, mehr wie ein Spiel, in das viel
Liebe gesteckt wurde; extrem flüssig und intuitiv, mit vielen Animationen.

**Befund:** Die Oberfläche sah aus wie ein sauberes Dashboard: graue Flächen, weiche runde Karten mit feinen Linien.
Pixel-Art gab es nur in Icons.

**Entscheidung:** Die Bausteine ändern, nicht jede Seite einzeln. Fünf Hebel wirken überall zugleich:

1. **Farbwelt:** dunkel ein blau getönter Nachthimmel, hell warmes Papier; dahinter Punktraster, Akzent-Schimmer und
   aufsteigende Pixel-Stäubchen.
2. **Form:** kleine Ecken, 2-px-Ränder, harte Kanten unter Flächen statt weicher Schatten (`--edge`).
3. **Tasten:** Lichtkante oben, dunkle Kante unten, sinken beim Drücken ein; wichtige Buttons sprühen Funken.
4. **Seitenbanner:** `PageHeader` mit Titel, einem Satz und schwebendem Pixel-Bild auf allen 20 Seiten. Neue Bilder:
   Aktentasche, Häuschen, Herz.
5. **Bewegung:** Seiteninhalte kommen gestaffelt an, Icons hüpfen beim Überfahren, Fortschrittsbalken sind
   segmentiert wie Lebensbalken, das Vermögen glänzt, leere Zustände schweben.

Dazu kommen der **Titelbildschirm** für Anmeldung und Registrierung (Sternenhimmel, Mond, Skyline mit Lichtern, Finn),
ein Akzent-Pixel vor jeder Abschnittsüberschrift, schmale Scrollbalken und eine Münze am Guthaben, die bei jeder
Änderung hüpft.

**Grenzen:** Zahlen bleiben in der glatten Schrift (Lesbarkeit). Animiert wird nur `transform` und `opacity`; mit
„Animationen: Reduziert“ entfallen Dauerschleifen und Funken. Kontraste der Textfarben sind weiter getestet
(`tokens.test.ts`).

## ADR-109: Startseite ruhig und einfach — `akzeptiert`

Vorgabe: Die Startseite überfordert extrem. Sie soll schön und simpel sein, sodass man immer Lust hat, ins Spiel zu
kommen.

**Befund:** Auf der Startseite standen bis zu elf Karten: „Heute dran“ mit vier Aufgaben, Vermögen, Tresor, Missionen,
Rang, Freunde-Feed, Index, Top-Mover, nächstes Ziel, Wochenliga und Termine.

**Entscheidung:** Vier Dinge, die auf einen Bildschirm passen:

1. **Szene:** Finn begrüßt mit einem Satz, daneben groß das Vermögen, darunter die Skyline.
2. **Als Nächstes:** genau eine große Aufgabe mit einem Knopf; höchstens zwei weitere klein unter „Danach“.
3. **Tresor** wie bisher (täglicher Griff).
4. **Drei Kacheln** ab Level 2: Level mit nächster Freischaltung, eigener Rang, Missionen.

Rangliste, Freunde-Feed, Wochenliga, Index, Top-Mover und Termine stehen nicht mehr auf der Startseite. Sie sind auf
ihren Seiten (Ranglisten, Freunde, Märkte, Events) und über Menü und Kacheln einen Tipp entfernt. Der Schulden-Hinweis
erscheint weiter, wenn er nötig ist. `todayTasks` liefert dafür drei statt vier Aufgaben.

## ADR-110: Eigene Spielwährung „Nex“ (NX) — `ersetzt durch ADR-113`

Vorgabe: Das Spiel soll nicht in Euro laufen, sondern eine eigene Währung haben.

**Entscheidung:** Die Währung heißt **Nex**, geschrieben **NX** hinter dem Betrag („5.000 NX“, „1,2 Mio. NX“).
Ein eigener Name macht klar, dass es Spielgeld ist, und passt zum Arbeitstitel. Das Kürzel besteht aus zwei
Buchstaben, damit es auch in der Pixel-Schrift sauber aussieht; ein eigenes Sonderzeichen gäbe es dort nicht.

- **Werte bleiben 1:1.** Aus 1 € wird 1 NX. Kein Betrag, kein Preis und kein Balancing-Wert ändert sich.
- **Technik unverändert:** Geld bleibt `bigint` in Hundertsteln (`*_cents`), Kurse in `*_e4`. Die Hundertstel haben
  keinen eigenen Namen; angezeigt wird „12,50 NX“.
- **Client:** Name und Kürzel stehen einmal in `src/config/app.ts` (`CURRENCY`). `src/lib/format.ts` setzt das Kürzel
  ein; alle Texte in `messages/de.json` nennen NX. Eingabefelder nehmen „NX“ und weiterhin „€“ hinter der Zahl an.
- **Server:** `format_eur`, `format_eur_short`, `mission_text` und `crypto_event_text` schreiben „NX“ (die
  Funktionsnamen bleiben, damit kein Aufrufer bricht). Die Migration ersetzt das Euro-Zeichen einmalig in allen
  gespeicherten Texten (Freischaltungen, Erfolge, Nachrichten, Benachrichtigungen, Firmen-Chat). Das Ledger bleibt
  unangetastet (nur anhängen), ebenso die Profile der Spieler.
- **Stablecoin:** „Euro-Stabil“ (EUS) heißt jetzt „Eins-Stabil“ und ist an 1 NX gebunden. Das Kürzel bleibt.
- **Ältere Dokumente** (Game Design, Balancing, frühere ADRs) nennen Beträge noch in €. Sie gelten 1:1 in NX.

## ADR-111: Freundescode — `akzeptiert`

Vorgabe: Wer Freunde ins Spiel holt, bekommt einen Code. Tragen die Freunde ihn im Profil unter „Freundescode“ ein,
bekommen sie einmalig 5.000.

**Entscheidung:**

- **Der Code** ist `NEXA-` plus der feste Spieler-Tag (ADR-085), zum Beispiel `NEXA-K7Q2`. Er braucht keine eigene
  Spalte, bleibt bei einer Namensänderung gleich und lässt sich vorlesen (keine 0/O, 1/I). Eingaben wie
  `nexa k7q2`, `#K7Q2` oder nur `K7Q2` gelten auch.
- **Einlösen** im Profil, genau **einmal pro Konto**, nie der eigene Code. Der Bonus beträgt
  `social.friendCode.bonusCents` (5.000 €) und kommt wie jede Belohnung aus der Staatskasse (ADR-041); bei einem
  offenen Zwangskredit greift der übliche Einbehalt. Die Aktion ist idempotent (`request_id`), der Bonus eine
  Ledger-Buchung.
- **Wer geworben hat**, bekommt eine Benachrichtigung („… ist mit deinem Code dabei“) und sieht im Profil, wie viele
  Freunde den Code eingetragen haben. Geld bekommt nur der neue Spieler, so wie vorgegeben; das hält auch den Anreiz
  klein, sich mit Zweitkonten selbst zu beschenken. Zwei Freunde dürfen gegenseitig ihre Codes einlösen.
- **Kein Zeitlimit:** Auch wer schon länger spielt, kann einmal einen Code eintragen. Ein Konto-Neustart setzt das
  nicht zurück.
- **Sichtbarkeit:** Die Karte „Freundescode“ steht im Profil von Anfang an (kein `<Reveal>`), denn neue Spieler
  brauchen sie am ersten Tag.
- **Demo-Modus:** Es gibt keine anderen Spieler; zum Ausprobieren gilt der Code `NEXA-F7NN` von Finn.
- Fehler: `friend_code_unknown` (NX104), `friend_code_self` (NX105), `friend_code_used` (NX106).

## ADR-113: Euro als Standard, Dollar oder NX zur Wahl — `akzeptiert`

Vorgabe: Die Währung soll doch Euro sein. Man kann aber auch Dollar oder NX auswählen. Das ersetzt ADR-110, in dem
NX die einzige Währung war.

**Entscheidung:** Die Währung ist eine **Anzeige-Einstellung** je Spieler (Profil → Einstellungen → Währung):
Euro (Standard), Dollar oder Nex. Es ändert sich nur das Zeichen hinter dem Betrag („5.000 €“, „5.000 $“,
„5.000 NX“). Es gibt keinen Wechselkurs: Alle Spieler sehen dieselben Zahlen, Ranglisten und Preise bleiben
vergleichbar, und am Geldsystem ändert sich nichts.

- **Ort der Einstellung:** `currency` im Einstellungs-Store (`localStorage`, wie Thema und Akzentfarbe), also je
  Gerät. Die Auswahl steht in `CURRENCIES` in `src/config/app.ts`.
- **Beträge:** `src/lib/format.ts` kennt das gewählte Zeichen (`setDisplayCurrency`) und setzt es in `formatMoney`,
  `formatMoneyShort` und `formatPrice` ein. Das Zahlenformat bleibt deutsch.
- **Texte:** In `messages/de.json` und in allen Texten des Servers (Nachrichten, Missionen, Benachrichtigungen,
  Firmen-Chat) stehen Beträge mit „€“. Der Client tauscht das Zeichen an zwei Stellen: `<Providers>` reicht die
  Texte mit getauschtem Zeichen weiter, und `engine` (`src/features/game/store.ts`) schickt jede Antwort von Server
  oder Demo durch `localizeMoneyDeep`. Mit Euro passiert nichts.
- **Erster Bildaufbau:** Server und erster Client-Render zeigen den Standard. Sobald die Einstellungen geladen sind,
  wird alles unter `<Providers>` einmal mit dem gewählten Zeichen neu aufgebaut (wie beim Umschalten). Seiten, die
  Beträge zeigen, sind dafür Client-Komponenten; die Spielregeln wurden entsprechend umgestellt.
- **Server:** Die Migration nimmt ADR-110 zurück: `format_eur`, `format_eur_short`, `mission_text` und
  `crypto_event_text` schreiben wieder „€“, gespeicherte Beträge mit „NX“ werden zurückgeschrieben (nur Zahl plus
  „NX“ als ganzes Wort; Fehlercodes wie NX104 und Kürzel bleiben).
- **Eingaben:** Betragsfelder nehmen „€“, „$“ und „NX“ hinter der Zahl an.
- Der Stablecoin EUS behält den neutralen Namen „Eins-Stabil“.

## ADR-114: Registrierung ohne Einladungscode — `akzeptiert`

Vorgabe: Der Einladungscode bei der Anmeldung soll weg. Das ersetzt den Einladungscode aus ADR-010; E-Mail, Passwort
und die Bestätigung „mindestens 18 Jahre“ bleiben.

- Das Registrierungsformular fragt keinen Code mehr ab.
- `handle_new_user()` verlangt nur noch dann einen Code, wenn `game_config.auth.inviteRequired` ausdrücklich auf
  `true` steht (Standard jetzt `false`). So lässt sich die Tür bei Bedarf wieder schließen, ohne neuen Code.
- Die Tabellen `invite_codes` und `invite_code_redemptions` bleiben. Der Freundescode (ADR-111) ist davon unabhängig.
- Schutz vor Mehrfachkonten sind jetzt E-Mail-Bestätigung, Login-Ereignisse und die Limits für neue Konten.

## ADR-115: Skills der Reihe nach, Karte immer sichtbar — `akzeptiert`

Vorgabe: Skills soll man chronologisch lernen, dort wo es Sinn ergibt: Programmierung erst, wenn man die
IT-Grundlagen beherrscht. Bei den Skills soll immer die Karte zu sehen sein, und sie soll besser aussehen; die
Farbstreifen gefallen nicht.

**Reihenfolge (ersetzt die Nachbar-Regel aus ADR-061):**

- Jeder Skill nennt in `src/config/skills.ts` seine **Voraussetzung** (`requires`). Gelernt werden kann er erst, wenn
  sie gelernt ist. Nur die acht Grundlagen brauchen nichts. Vorher reichte irgendein gelerntes Nachbarfeld, und
  Felder nahe der Mitte waren immer offen, auch Programmierung ohne IT-Grundlagen.
- Die Voraussetzung ist immer ein Nachbarfeld desselben Bereichs, das früher kommt (niedrigere Stufe, sonst gleiche
  Stufe weiter innen), und inhaltlich gewählt: IT-Grundlagen → Programmierung → Datenanalyse → Machine Learning.
- Kombi-Skills zwischen zwei Bereichen, die beide berühren, brauchen je einen Skill aus beiden (FinTech: DevOps und
  Handel; Wirtschaftsrecht: Datenschutz und Treasury; E-Commerce: Suchmaschinenoptimierung und Luftfracht).
- Server (`skill_reachable`), Demo und Oberfläche rechnen gleich. Schon gelernte Skills bleiben, egal in welcher
  Reihenfolge sie gelernt wurden. Schulungen durch den Arbeitgeber bleiben davon unberührt.
- Kosten, Punkte und Bereichswerte ändern sich nicht.

**Seite:**

- Die Karte steht immer auf der Seite; die Umschaltung „Pfade / Karte“ entfällt. Daneben die acht Bereiche, darunter
  „Jetzt lernbar“.
- Karte neu gezeichnet: keine Farbstreifen mehr. Felder sind Kacheln mit Kante und Abstand; gesperrte sind ruhig und
  grau mit einem Hauch Bereichsfarbe, lernbare haben einen farbigen Rand, gelernte sind gefüllt. Dünne, neutrale
  Verbindungen zwischen den Kacheln zeigen die Reihenfolge. Die Stufe steht als kleine Punkte am Fuß der Kachel.
- Namen werden nicht mehr abgeschnitten: Lange Wörter tragen in `messages/de.json` weiche Trennstellen (`\u00ad`),
  die Karte bricht dort in bis zu drei Zeilen um.
- Das Detailblatt zeigt die Voraussetzung (antippbar, mit Haken wenn gelernt) und was der Skill freimacht.

## ADR-116: Live-Datenbank in kleinen Schritten aktualisieren — `akzeptiert`

**Anlass:** Mit vier Spielern online hing das Spiel minutenlang. Zwei Ursachen: Die Rangliste brauchte im
Minuten-Job 30 Sekunden (behoben mit Index und Rang aus der Momentaufnahme), und jedes Datenbank-Update spielte die
komplette Historie (über 2 MB SQL) in einer Transaktion neu ein und hielt dabei Sperren.

**Entscheidung:** Die GitHub Action ruft `scripts/apply-updates.sh` auf. Das Skript merkt sich in
`nexa_meta.applied_updates`, welche Dateien aus `supabase/updates/` schon eingespielt sind, und spielt nur neue ein,
jede in einer eigenen kurzen Transaktion mit Wiederholung bei Deadlock. Danach schreibt es Spielkonfiguration und
Stammdaten. `update-to-latest.sql` bleibt für den SQL Editor und für neue Projekte.

Das Schema `nexa_meta` ist kein Teil der API und enthält keine Spieldaten.

## ADR-117: Nur noch Sofort-Orders — `akzeptiert`

Vorgabe: Man soll keine Limits mehr setzen können, auch das Tutorial dazu entfällt.

- Die Order-Maske kennt keine Order-Art mehr: Jede Order wird sofort zum Marktpreis ausgeführt.
- Finns Tour zu Limit-Orders (Level 3), die Freischaltung „Limit-Order“ und die Missionen dazu sind entfernt.
- Der Server lehnt neue Limit-Orders von Spielern ab, solange `game_config.trading.limitOrders` auf `false` steht
  (`locked`). Die Order-Engine bleibt vollständig und getestet; der Schalter holt die Funktion zurück.
- Bereits wartende Limit-Orders bleiben im Buch, bis sie ausgeführt oder storniert werden.

Dazu zwei kleine Korrekturen der Bedienung: Das Mausrad zoomt auf der Skill-Karte nur noch die Karte (die Seite
scrollt nicht mit), und der Betrags-Regler zieht das Order-Fenster nicht mehr zur Seite.

## ADR-118: Zeit im Rang läuft schnell — `akzeptiert`

Vorgabe: „12 Stunden im Rang gearbeitet“ dauert zu lange; eine Stunde soll wie ein Tag zählen.

Eine bezahlte echte Stunde zählt als 24 Stunden im Rang (`careers.promotion.rankHoursPerRealHour`). Die Anforderungen
(12, 36, 72, 120 Stunden) bleiben stehen, sind aber nach 30 Minuten, 1,5, 3 und 5 Stunden bezahlter Arbeit erfüllt.
Gezählt werden weiter bezahlte echte Minuten (`player_jobs.rank_minutes`); der Faktor wird beim Vergleich auf dem
Server und bei der Anzeige angewendet. Lohn, Arbeitspunkte und der Achtstundentag ändern sich nicht.

## ADR-119: Aktien-News mit Vorlauf — `akzeptiert`

Vorgabe: Es soll Aktien-News geben, mit denen man vorhersehen kann, in was man investieren sollte.

- Alle `stockNews.everyMinutes` (12) Minuten bekommt eine gelistete Aktie eine Meldung mit Richtung („Analysten heben
  den Daumen für …“, „… warnen vor …“) und Stärke (leicht, spürbar, deutlich).
- Nach einer Vorlaufzeit von 10 bis 40 Minuten bewegt sich der Kurs um 3 bis 12 % in die genannte Richtung
  (`event_price_shock`, wie bei angekündigten Ereignissen). Nicht jede Meldung trifft ein: 75 %
  (`stockNews.reliabilityBps`). Wer liest, hat einen Vorteil, aber kein sicheres Geld.
- Die Märkte-Seite zeigt die Meldungen als „Börsen-News“: offene zuerst mit erwarteter Zeit, danach ob sie
  eingetroffen sind und wie stark. Ein Tipp führt zur Aktie; dort steht die Meldung auch bei den Nachrichten.
- Der Plan einer Meldung (ob sie eintrifft, wie stark genau) bleibt auf dem Server (`stock_tips`, ohne Client-Rechte).
- Ein eigener Cron-Job (`nexa-stock-news`, jede Minute) erledigt das, damit der Minuten-Job kurz bleibt.
- Das Geld bleibt im geschlossenen System: Gewinne aus Tipps zahlt die Gegenseite am Markt.

## ADR-120: Spieler bewegen Kurse deutlich stärker, kürzere Kündigungsfrist — `akzeptiert`

Vorgaben: Aktive Spieler sollen viel stärker beeinflussen, wie sich eine Aktie entwickelt. Kündigen soll nicht mehr
einen echten Tag dauern: eine Stunde warten (ein Tag im Spiel) oder ein Tagesgehalt zahlen und sofort gehen.

- **Kurseinfluss** (`trading.playerImpact`): 10.000 € Nettokauf bewegen einen Pennystock um 10 % (vorher 2 %), einen
  Mittelwert um 2 % (0,4 %), einen Blue Chip um 0,5 % (0,1 %). Die Halteprämie steigt von 60 auf 90 %, die Grenze
  je Takt von 3 auf 10 %, damit ein großer Kauf sofort sichtbar wird. Die Grenze je Order (15 %) bleibt.
- **Kündigen:** `jobs.quitNoticeHours` ist 1. Sofort kündigen gegen einen Tageslohn gab es schon und bleibt.
- **Portfolio:** Die Positionen lassen sich nach Wert oder nach Branche sortieren.
- **Visitenkarte:** Die Spalten richten sich nach der Breite der Karte, nicht des Bildschirms; in der schmalen
  Spalte der Karriere-Seite steht alles untereinander und Namen brechen um, statt gestaucht zu werden.

## ADR-121: Freunde sehen die Investments — `akzeptiert`

Vorgabe: Auf dem Profil soll man sehen, in welche Aktien usw. Freunde investiert haben und wie viel.

Das Profil zeigt die Karte „Investments“: jede Position mit Wert und Anteil am Depot, die größte zuerst. Sichtbar ist
das für den Spieler selbst und für angenommene Freunde (`are_friends`). Alle anderen lesen nur, dass es Freunden
vorbehalten ist; Einstandskurse und Gewinne werden nicht gezeigt.

## ADR-122: Markt-Takt alle 10 Sekunden — `akzeptiert`

Anlass: Mit sechs Spielern auf der kleinsten Supabase-Größe waren CPU und Disk-IO-Budget erschöpft; das Spiel lud
immer wieder. Der Takt schreibt Kurse, Kerzen und Quotes aller Aktien und Coins.

`time.tickSeconds` und `crypto.tickSeconds` sind 10 statt 5, der Cron-Job `nexa-market-tick` läuft alle 10 Sekunden.
Die Simulation skaliert Schwankung und Abklingen mit dem Intervall, die Tagesschwankung bleibt gleich. Der Client
fragt den Markt im selben Takt ab. Damit halbieren sich Schreibzugriffe des Takts und Marktabfragen der Spieler.

## ADR-123: Weniger Rechenlast pro Spieler — `akzeptiert`

Anlass: Mit sechs Spielern war die Datenbank (Micro) mit Rechnen ausgelastet, nicht mit Schreiben: Die Marktübersicht
wurde bei jeder Abfrage jedes Spielers neu gebaut (rund 0,5 s), die Minuten-Aufgabe hielt ihre Sperren rund 13 s.

- `get_market_snapshot()` baut die Übersicht einmal pro Takt und legt sie in `market_snapshot_cache`; weitere Abfragen
  desselben Takts lesen sie. Neue Listungen, Namen, Farben und Logos leeren den Zwischenspeicher sofort.
- Die Minuten-Aufgabe läuft als fünf kurze Cron-Jobs (`run_due_part`: core, companies, jobs, art, social), jede in
  eigener Transaktion. `run_due_jobs()` bleibt für Tests und manuelles Nachholen.
- Der Client fragt das eigene Depot alle 30 statt 15 Sekunden ab, Missionen jede Minute, Firmen-Chat und Kunstwerk
  alle 10 Sekunden; nach eigenen Aktionen wird sofort neu geladen.
- Messung statt Vermutung: Das Schreiben war mit rund 70 KB WAL pro Takt kein Engpass, deshalb werden Kerzen und
  Kursverlauf nicht seltener geschrieben.

## ADR-124: Vermögensverlauf im Portfolio — `akzeptiert`

Das Portfolio zeigt das eigene Vermögen über 24 Stunden oder 7 Tage, aus den Momentaufnahmen der Rangliste
(`get_my_net_worth_history`, alle paar Minuten, 8 Tage aufbewahrt).

## ADR-125: Jede Firma lässt sich ansehen — `akzeptiert`

`/companies/[id]` zeigt jede Firma, KI oder Spieler: Gründer, Team, Produkt und Ausbaustufe, Umsatz und Gewinn des
letzten Quartals (KI: letzte vier Quartale), Wert und Aktie. Kasse, Schulden und Pläne bleiben intern. Erreichbar
über die Firmen-Rangliste und die Aktienseite. Das Organigramm ist für alle Spieler offen.

## ADR-126: Eine Order zahlt ihre eigene Kursbewegung — `akzeptiert`

Anlass: Seit ADR-120 hebt ein Kauf den Kurs im nächsten Takt stark an (10.000 € bei einem Pennystock um rund 10 %),
der Käufer zahlte aber nur den alten, viel kleineren Aufschlag. „Kaufen, einen Takt warten, verkaufen" brachte so
sicheren Gewinn.

Für Aktien rechnet der Ausführungspreis jetzt mit derselben Spieler-Tiefe wie der Takt (`playerImpact`): Eine Order
zahlt im Schnitt die Hälfte der Bewegung, die sie auslöst; wer gleich wieder verkauft, zahlt die Hälfte seiner eigenen
Bewegung nach unten. Ein Hin und Her kostet Spread, Gebühren und etwas Schlupf. Wer eine Aktie hält, die andere
kaufen, verdient weiter. Test `supabase/tests/94_no_round_trip_profit.sql`.

## ADR-127: Geschäftszüge statt Auftragsprinzip — `akzeptiert`

Anlass: Mit Firmen Geld zu verdienen hing fast nur an Stellschrauben, die erst nach einer Spielstunde wirken (Preis,
Werbung, Auftragsarbeit an oder aus). Das war schwer zu verstehen und fühlte sich passiv an. Gewünscht: viele aktive
Wege zum Gewinn, die immer zum Produkt der Firma passen.

Entscheidung:

- **Geschäftszüge** (`src/config/company-moves.ts`, zur Laufzeit `game_config.companyMoves`): 6 Züge für jede Firma
  (Wochenmarkt, Lokalzeitung, Team-Workshop, Großeinkauf, Investoren-Pitch, Steuerprüfung) und 6 eigene für jedes
  der 15 Produkte, zum Beispiel Klinik-Express für Kurierdienste, Penetrationstest für eine Bank bei Sicherheitssoftware oder
  Solarpark auf einer Wiese für Solar. Zusammen 96 Züge.
- Jeder Zug bringt **Geld**, **Bekanntheit** oder **Qualität**, ist **sicher**, **normal** oder **riskant** und dauert
  15 bis 60 Minuten. Kosten: Grundpreis der Stufe (Garage 1.000 €, Kleinunternehmen 4.000 €, GmbH 15.000 €,
  AG 60.000 €) mal Faktor des Zugs, bezahlt aus der Firmenkasse.
- **Chance und Auszahlung** nach Risiko: sicher 90 % für 120 %, normal 70 % für 150 %, riskant 40 % für 260 % der
  Kosten. Daneben gibt es 50 %, 30 % oder 10 % zurück. Im Schnitt bringt ein Zug 10 bis 14 % Gewinn; Bekanntheit und
  Qualität steigen bei Erfolg um 2, 4 oder 8 Prozentpunkte.
- **Team-Know-how zählt:** Jeder gelernte Skill der Belegschaft im Bereich des Zugs (zum Beispiel Logistik für den
  Klinik-Express) hebt die Chance um 3 Punkte, höchstens 25, insgesamt höchstens 95 %.
- **Plätze:** Garage 1, Kleinunternehmen 2, GmbH 3, AG 4 Züge gleichzeitig. Nach einem Zug ruht er doppelt so lange,
  wie er lief. So lohnt es sich, verschiedene Züge zu nutzen.
- Nur die Gründerin oder der Gründer startet Züge (`start_company_move`, idempotent). Abgerechnet wird jede Minute
  (`company_moves_run_due`, Cron `nexa-company-moves`); Geld fließt als Ledger-Buchung von und zu den Haushalten,
  höchstens so viel, wie die Haushalte haben. Das Ergebnis steht im Firmenchat.
- **Auftragsarbeit** läuft jetzt immer automatisch (`contract_work = true`), der Schalter ist weg. Sie bleibt ein
  stiller Grundertrag für freie Kapazität.

Folgen: Firmen haben einen aktiven Takt im Minutenbereich, passend zu ihrem Produkt. Mit 4 Spielern hat jeder seine
eigenen Züge; nichts davon nimmt anderen etwas weg. Tests: `supabase/tests/95_company_moves.sql`,
`src/features/game/demo/company-moves.test.ts`, `e2e/company-growth.spec.ts`.

## ADR-128: Firmen in jedem Bereich der Skill-Karte — `akzeptiert`

Anlass: Bisher begann kein Produkt mit Recht, Finanzen oder Führung. Wer diese Bereiche gelernt hatte, fand keine
passende Firma.

Entscheidung: Sechs neue Produkte in den bestehenden Branchen, damit jeder der acht Bereiche ein Einstiegsprodukt hat:

| Branche  | Produkt               | Einstieg (Stufe 1)         |
| -------- | --------------------- | -------------------------- |
| Tech     | Online-Rechtsberatung | Recht: Vertragsrecht       |
| Tech     | Banking-App           | Finanzen: Buchhaltung      |
| Handel   | Franchise-Kette       | Führung: Teamführung       |
| Energie  | Stromhandel           | Finanzen: Investment       |
| Pharma   | Zulassungsberatung    | Recht: Vertragsrecht       |
| Logistik | Umzugsservice         | Führung: Projektmanagement |

Jedes bekommt sechs eigene Geschäftszüge (ADR-127), zum Beispiel die Sammelklage gegen eine Airline oder den Flügel
in den dritten Stock. Beim Gründen zeigt jedes Produkt, in welchem Bereich es beginnt.

Keine neue Branche: Branchen hängen an Börse, KI-Firmen und Nachfrage. Neue Produkte brauchen nur Konfiguration
(`startups.products`) und Texte; der Server liest sie aus `game_config`. Test in
`supabase/tests/95_company_moves.sql`.

Nebenbei: `53_m1_bonds_vault.sql` legt die Laufzeit von NXB01 im Test fest. Vorher hing die Zahl der Kupons von
der Uhrzeit ab, und zwischen etwa 2 und 8 Uhr scheiterte die Prüfung (auch im Workflow vor dem Datenbank-Update).

## ADR-129: Firmenaufgaben mit Minispielen, Vorgesetzte und ein News-Tab — `akzeptiert`

Vorgabe: Mit mehreren Spielern sollen Firmen viel lebendiger werden. Mehr Wege, mit Mitarbeitern umzugehen, eine
echte Hierarchie (Vorgesetzte sind für Praktikanten verantwortlich und delegieren), viele Aufgaben, die immer zum
Produkt passen und für den Erfolg wichtig sind. KI erledigt delegierte Aufgaben, aber langsamer. Fehler kosten Geld
und stehen in den Firmen-News. Dazu ein News-Tab mit lustigen und börsenrelevanten Meldungen.

**Aufgaben** (`src/config/company-tasks.ts`, `game_config.companyTasks`):

- 92 Aufgaben: 8 für jede Firma (Rechnungen sortieren, Schichtplan, Vertrag prüfen …) und 4 eigene für jedes der 21
  Produkte (Modelabel: T-Shirts in Größe M verpacken, Stoffe nach Kollektion sortieren, Laufsteg-Reihenfolge merken,
  Größen zählen).
- Jede Aufgabe ist ein Minispiel unter einer Minute: **Tippen** (alle passenden Kacheln), **Zählen**, **Sortieren**
  (links oder rechts), **Reihenfolge** (nach Zahlen), **Merken** (Folge aus vier Symbolen) und **Rechnen**. Der Server
  baut das Rätsel, behält die Lösung und bewertet die Antwort; die Zeit läuft ab dem Öffnen.
- Wert nach Stufe (Garage 400 €, Kleinunternehmen 1.500 €, GmbH 5.000 €, AG 20.000 €) mal Faktor der Aufgabe.
  Ab 80 % richtig zahlt die Aufgabe Wert × Anteil in die Firmenkasse. Falsch, zu langsam oder nicht rechtzeitig
  erledigt kostet 60 % des Werts. Jedes Ergebnis wird Firmen-News mit eigener Zeile („Mona Moden macht Minus: Die
  T-Shirts gingen nicht rechtzeitig raus.“). Wer spielt, bekommt XP.
- Neue Aufgaben kommen nur, solange jemand aus der Firma in den letzten 20 Minuten aktiv war: höchstens eine je
  4 Minuten, so viele, dass es zur Teamgröße passt (1 + eine je 2 Köpfe, höchstens 6). Eine schlafende Firma
  verliert so kein Geld.

**Hierarchie und Delegieren:**

- Die Gründerin oder der Gründer legt für jede Person fest, an wen sie berichtet (`player_jobs.supervisor_id`).
  Vorgesetzte haben immer einen höheren Rang, deshalb gibt es keine Kreise.
- Gründer vergeben jede Aufgabe an sich, an jede Person oder an die KI. Mitarbeiter übernehmen offene Aufgaben und
  geben eigene Aufgaben an ihr direktes Team weiter. Ab Senior dürfen sie die KI einsetzen.
- Wer eine Aufgabe bekommt, erhält eine Benachrichtigung.
- **KI-Kräfte** brauchen 12 Minuten, mit jeder Aufgabe, an der sie schon arbeiten, 50 % länger. Sie schaffen es in
  70 % der Fälle (80 % mit passendem Training) und bringen 60 % des Werts. Wird die KI nach der Frist fertig, gilt
  die Aufgabe als verpatzt. Optional übernimmt die KI liegengebliebene Aufgaben 15 Minuten vor der Frist.
- Das Organigramm zeigt, wer an wen berichtet.

**News-Tab** (`/news`): Börsen-Tipps (ADR-119), Firmen-News aller Spielerfirmen (Aufgaben, Rekorde, Börsengänge),
Marktmeldungen und 36 kuriose Meldungen über KI-Firmen, Spieler und die Börse (alle 6 Minuten eine). Filter nach Art.

Abgelöst: Die Arbeitsaufgaben aus ADR-059 bleiben abgeschaltet; die Firmenaufgaben sind ihr Ersatz.
Tests: `supabase/tests/96_company_tasks.sql`, `src/lib/sim/company-tasks.test.ts`, `e2e/company-growth.spec.ts`.

## ADR-130: Missionen aufgeräumt und erweitert, zehn neue KI-Firmen mit eigenen News — `akzeptiert`

**Missionen.** ADR-117 hatte die Limit-Missionen abgeschaltet, aber nur die Metriken `limit_orders_placed` und
`limit_orders_filled`. Vier Vorlagen aus M4a mit der Metrik `limit_order` (schnell, täglich, wöchentlich, Meilenstein)
liefen weiter und waren nicht lösbar. Sie sind jetzt aus; laufende Missionen dieser Art enden, bereits geschaffte
lassen sich noch abholen. Dazu kommen 67 neue Vorlagen:

- Firmenaufgaben (ADR-129): erledigen, fehlerfrei lösen, delegieren. Neue Metriken `task_done`, `task_perfect`,
  `task_delegated`; die neue Voraussetzung `team` gilt für Gründer und Mitarbeiter einer Spielerfirma.
- Geschäftszüge (ADR-127): starten und erfolgreich abschließen (`move_started`, `move_success`, über einen Trigger auf
  `company_moves`).
- Mehr Börse (Käufe und Verkäufe, jede Branche einzeln, Gewinne, breite Depots, große Käufe), Arbeit, Kunst, Zuhause,
  Anleihen sowie Meilensteine bis 500 Trades, Level 30 und 500.000 € Vermögen.
- Wöchentliche Missionen und Meilensteine geben wie bisher einen Fähigkeitspunkt.

**KI-Firmen.** Zehn neue Aktien, zwei je Branche, jede mit eigenem Charakter und anderen Zahlen:

| Kürzel | Firma              | Branche  | Klasse     | Idee                                         |
| ------ | ------------------ | -------- | ---------- | -------------------------------------------- |
| HLX    | Helix Robotik      | Tech     | Midcap     | Haushaltsroboter                             |
| MEM    | Memeland Media     | Tech     | Pennystock | Meme-App, die Aktie macht, was das Netz will |
| LUX    | Glanz & Gloria     | Handel   | Bluechip   | Luxusuhren und Schmuck                       |
| SNK    | Knusperkönig       | Handel   | Pennystock | Chips mit verrückten Sorten                  |
| WND    | Nordbrise Offshore | Energie  | Midcap     | Windparks, Sturm gut, Flaute schlecht        |
| FSN    | Sonnenkern Fusion  | Energie  | Pennystock | Kernfusion im Container                      |
| MTH    | Methusalem Bio     | Pharma   | Pennystock | Pillen gegen das Altern                      |
| PFW    | Pfotenwohl         | Pharma   | Midcap     | Tiermedizin                                  |
| DRN    | Luftpost Drohnen   | Logistik | Pennystock | Paketdrohnen                                 |
| OFR    | Orbitfracht        | Logistik | Midcap     | Raketenstarts und Fracht ins All             |

- Eine Funktion (`ai_companies_add_v2`) legt sie an: auf einer neuen Datenbank aus `seed.sql`, auf der laufenden
  durch die Migration. Sie stehen nicht im NEXA 30, damit Index und Teiler stabil bleiben.
- Startkasse: ein Zehntel der Quartalskosten, vor der Geldschöpfung aus der Münze, danach von den Haushalten.
  Die ersten 15 bekamen ein ganzes Quartal; mehr hätte den Finanzmarkt ausgetrocknet.
- Auf einer laufenden Datenbank beginnen die neuen Kurse ohne Vorgeschichte; der Takt baut sie auf.

**Eigene News.** Das Firmenprofil (ADR-125) zeigt „Neuigkeiten“: Börsenmeldungen zur Firma aus `news_items`
(Quartalszahlen, Tipps) und für jede der 25 KI-Firmen eigene lustige und spannende Geschichten aus dem Firmenalltag
(`messages/de.json`, `aiCompanyNews.<Kürzel>`), drei auf einmal, stündlich wechselnd.

Nebenbei: Der Cache der Marktübersicht (ADR-123) löschte mit `delete` ohne `where`. Supabase lehnt das bei
API-Aufrufen ab (pg-safeupdate), deshalb schlug das Speichern eines Firmenlogos live fehl.
Migration `20261204000300_fix_safe_delete.sql`.

## ADR-131: Krisen, Skandale und fallende Kurse drücken die Löhne — `akzeptiert`

Vorgabe: Skandale und sinkende Aktienkurse sollen direkt die Löhne der Mitarbeiter beeinflussen.

- `company_pay_mood_bps(Firma)` ergibt einen Lohnfaktor, normal 100 %:
  - Offene oder laufende **Krise** einer Spielerfirma: 5 % weniger je Schweregrad (1 bis 3).
  - **Skandal** (Qualitätsskandal, Datenleck, Proteste, Verriss, Streik): weitere 5 % weniger.
  - **Aktie fällt heute** (Spieler- und KI-Firmen an der Börse): Die ersten 3 % sind normale Schwankung. Vom Rest
    geht die Hälfte vom Lohn ab, höchstens 20 %. Beispiel: 13 % im Minus bedeutet 5 % weniger Lohn.
  - Nie unter 60 %.
- Die Lohnabrechnung (`accrue_job_salary`) rechnet ihn bei jeder Auszahlung ein, für Spielerfirmen und KI-Arbeitgeber.
  Mitarbeiter sehen die Kürzung als „Lohnfaktor“ auf ihrer Jobkarte, mit kurzer Erklärung.
- Werte in `BALANCE.wageMood`. Die Datenbank-Tests schalten den Kursanteil am Anfang ab, weil Kurse mit jedem Takt
  schwanken, und prüfen ihn gezielt in `supabase/tests/97_wage_mood.sql`.

## ADR-132: Eigene Strategien, beurteilt von Claude — `akzeptiert`

Vorgabe: Bei Krisen und Chancen soll man selbst schreiben, was die Firma tut („Ich mache einen Imagefilm“). Eine KI
beurteilt die Idee, ein Zufallsfaktor entscheidet. Bei schlechter Bezahlung kann ein Imagefilm als Schönfärberei
nach hinten losgehen. Dasselbe für eigene Geschäftszüge.

- **Eigene Strategie** (bei einer offenen oder laufenden Krise oder Chance) und **eigener Geschäftszug** (Ziel Geld,
  Bekanntheit oder Qualität; teilt sich die Plätze mit den Geschäftszügen). 12 bis 280 Zeichen, Beleidigungen werden
  abgelehnt. Kosten: zwei Kosteneinheiten der Firmen-Lagen beziehungsweise das 1,2-Fache eines Geschäftszugs.
- **Claude urteilt** (Edge Function `strategy-judge`, Modell wie bei der KI-Redaktion, strukturierte JSON-Ausgabe):
  - `fit` (0 bis 100): Wie gut trifft die Idee die Ursache, passend zum Produkt?
  - `backfire` (0 bis 100): Wie wahrscheinlich geht sie nach hinten los (Schönfärberei, Täuschung, Drohungen)?
  - Dazu ein Urteil in einem Satz und je eine Meldung für Erfolg, Verpuffen und Rückschlag.
  - Der Spielertext gilt als Material, nicht als Anweisung. Wer Claude zu einer guten Bewertung überreden will,
    bekommt einen niedrigen `fit`.
  - Die Datenbank prüft Zahlen und Texte und speichert das Urteil nur einmal.
- **Ohne Claude** (kein Schlüssel, keine Antwort binnen 90 Sekunden) urteilt die **Mini-KI**: passende Stichwörter je
  Lage oder Ziel heben `fit`, riskante Wörter wie „Imagefilm“, „Werbung“, „leugnen“ heben `backfire`.
- **Würfel** nach 20 Minuten (Lage) oder 30 Minuten (Zug):
  - Chance = 10 % + `fit` × 0,8 %, höchstens 90 %.
  - Scheitert die Idee, geht sie mit `backfire` % nach hinten los, sonst verpufft sie.
- **Folgen:**
  - Erfolg bei einer Lage: Die Lage gilt als gelöst; je besser die Idee, desto stärker gemildert (35 % bis 85 %).
  - Erfolg bei einem Zug: Geld zahlt das 1,3- bis 2,5-Fache der Kosten. Bekanntheit oder Qualität steigen um 2 bis
    8 Punkte.
  - Rückschlag: 5 Punkte Bekanntheit weg, bei einer Lage zahlt die Firma die Kosten noch einmal.
  - Verpuffen: Bei einem Zug kommen 20 % der Kosten zurück.
  - Jedes Ergebnis steht mit Claudes Text in Firmen-News, Firmenchat und News-Tab.
- Werte in `src/config/pitches.ts` (`game_config.pitches`).
- Tests: `supabase/tests/98_strategy_pitches.sql`, `src/features/game/demo/pitches.test.ts`, `e2e/company-growth.spec.ts`.
- **Kosten für Claude:** ein Aufruf je eingereichter Idee, mit niedrigem Aufwand.
- **Einrichtung:** dieselbe wie in ADR-091 (`ANTHROPIC_API_KEY` als GitHub-Secret); der Workflow spielt
  `strategy-judge` mit ein.

## ADR-133: Protestkampagnen gegen Firmen, Quartalsbericht oben — `akzeptiert`

Vorgabe: Spieler sollen Kampagnen gegen andere Unternehmen starten können (Hetzkampagnen und so weiter). Dafür müssen
viele mitmachen, auch die KI, und nur ganz selten hat das echte Auswirkungen.

- Vier feste Arten: Boykott-Aufruf, Shitstorm, Petition, Protestmarsch. Kein freier Text, damit niemand andere
  Spieler beleidigen kann. Ziel kann jede Firma sein, nur nicht die eigene oder der eigene Arbeitgeber.
- Starten kostet 500 €, Mitmachen ist kostenlos (ab Level 4). Je Ziel läuft höchstens eine Kampagne, jeder Spieler
  startet höchstens eine in 6 Stunden. Die Zielfirma sieht die Kampagne.
- **Viele müssen mitmachen:** 20 Unterstützer. KI-Unterstützer kommen von selbst dazu (jede Minute mit 30 %, ein bis
  zwei), aber höchstens 16. Den Rest müssen Spieler stellen. Ohne Ziel nach 6 Stunden schläft die Kampagne ein.
- **Selten mit Wirkung:** Am Ziel wirkt die Kampagne nur mit 6 % plus 3 % je mitmachendem Spieler, höchstens 35 %.
  Dann fällt der Kurs einer börsennotierten Firma um 1,5 bis 4,5 %, eine Spielerfirma verliert zudem 3 Punkte
  Bekanntheit. Sonst verpufft sie. Beides wird zur Marktmeldung im News-Tab.
- Werte in `src/config/protests.ts` (`game_config.protests`). Tabellen und RPCs heißen „protest“, weil „campaign“
  schon die Werbekampagnen (ADR-083) bezeichnet. Test `supabase/tests/99_protests.sql`.

Dazu: Der letzte Quartalsabschluss steht im Firmen-Dashboard jetzt ganz oben, gleich unter der Produktion.

### Nachtrag zu ADR-130: Gewinne passend zu den Startkursen

Mehrere der zehn neuen KI-Firmen starteten weit über dem Wert, den ihre Gewinne hergeben (fairer Wert = Gewinn je
Aktie × Branchen-KGV): Knusperkönig zu 0,74 € bei etwa 0,31 € fairem Wert, Memeland 0,51 € statt 0,19 €, Nordbrise
und Orbitfracht etwa 40 % zu hoch. Die Simulation zieht Kurse zum fairen Wert, also fielen diese Aktien laufend, und
wer kaufte, verlor. Migration `20261204000900_fix_new_ai_fundamentals.sql` setzt ihre Kosten so, dass der Startkurs
genau dem Branchen-KGV entspricht, und stellt den fairen Wert aller zehn auf den Startkurs zurück. Firmen mit Verlust
(Sonnenkern, Methusalem, Luftpost) bleiben spekulativ wie die bisherigen Pennystocks mit Verlust.

## ADR-134: Mehr Verbesserungen — `akzeptiert`

Vorgabe: Viel mehr Verbesserungen, um mehr Geld zu machen, XP zu verdienen, den Tresor zu erweitern und vieles mehr,
mindestens 20 neue.

- **22 neue Verbesserungen** und zwei weitere Tresorstufen. Jede wirkt auf dem Server, an genau einer Stelle (siehe
  `docs/DATA_MODEL.md`, Nachtrag ADR-134). Werte in `src/config/upgrades.ts` (`game_config.upgrades`), Formeln in
  `src/lib/sim/upgrades.ts`.
- **Freischalten über die Zeit:** Erste Stufen ab Level 1 bis 18, jede weitere Stufe einige Level später (ADR-100).
  Die letzte Stufe jeder Verbesserung ist spätestens mit Level 30 erreichbar.
- **Geschlossenes Geldsystem:** Zusatzgeld kommt aus der Staatskasse (Tresorzinsen, Lohnbonus, tägliche Belohnung;
  nur so viel, wie sie hat) oder von den Haushalten (Firmenaufgaben, Geschäftszüge), nie aus dem Nichts. Rabatte
  senken nur, was an die Haushalte fließt. Firmen-Verbesserungen zählen für den Gründer der Firma.
- **Die Seite** zeigt die Verbesserungen in fünf Abschnitten (Tresor und Einkommen, Job und Karriere, Erfahrung, Deine
  Firma, Leben und Märkte) mit gekauften Stufen je Abschnitt. Gesperrte Karten zeigen, ab welchem Level es weitergeht.
- **Demo:** listet und verkauft alle Verbesserungen; XP, Tresor, tägliche Belohnung, Lohnbonus, Firmenaufgaben und
  Geschäftszüge rechnen mit. Lohnschutz, Strategien, Krisenkosten, Kampagnen und Protest wirken nur auf dem Server.

| Schlüssel        | Name                 | Wirkung je Stufe                                                 | Stufen | Ab Level (je Stufe) | Preise                  |
| ---------------- | -------------------- | ---------------------------------------------------------------- | ------ | ------------------- | ----------------------- |
| `vault`          | Tresor (erweitert)   | +2 h Platz, jetzt 8 statt 6 Stufen (bis 24 h)                    | 8      | 1, 3, …, 13, 15     | 3.000 € bis 384.000 €   |
| `vault_xl`       | Panzertresor         | +4 h Platz (zusätzlich zum Tresor, bis 36 h)                     | 3      | 14, 20, 26          | 100.000 € bis 400.000 € |
| `vault_interest` | Tresorzinsen         | +5 % obendrauf beim Leeren des Tresors (Staatskasse)             | 4      | 3, 6, 9, 12         | 5.000 € bis 78.125 €    |
| `daily_bonus`    | Stammgast            | +25 % Geld aus der täglichen Belohnung                           | 3      | 2, 6, 10            | 2.500 € bis 22.500 €    |
| `wage_bonus`     | Gehaltsverhandlung   | +5 % Lohnbonus auf jede Lohnzahlung (Staatskasse)                | 3      | 3, 8, 13            | 6.000 € bis 54.000 €    |
| `wage_shield`    | Krisenfester Vertrag | −25 % der Lohnkürzung durch Krisen und Kurse (ADR-131)           | 3      | 6, 11, 16           | 8.000 € bis 50.000 €    |
| `trader`         | Börsenprofi          | +10 % XP aus Handel                                              | 3      | 1, 4, 7             | 2.000 € bis 12.500 €    |
| `early_bird`     | Frühaufsteher        | +20 % XP aus täglicher Belohnung und Check-in                    | 3      | 1, 5, 9             | 1.500 € bis 13.500 €    |
| `mission_hunter` | Missionsjäger        | +10 % XP aus Missionen                                           | 3      | 2, 6, 10            | 3.000 € bis 18.750 €    |
| `teamplayer`     | Teamplayer           | +15 % XP aus Aufgaben (Firmen- und Arbeitsaufgaben)              | 3      | 6, 10, 14           | 8.000 € bis 50.000 €    |
| `balance_sheet`  | Bilanzprofi          | +15 % XP aus Quartalsgewinn und Börsengang der eigenen Firma     | 3      | 9, 14, 19           | 15.000 € bis 93.750 €   |
| `ambition`       | Ehrgeiz              | +5 % auf alle XP                                                 | 3      | 18, 24, 30          | 100.000 € bis 400.000 € |
| `task_pay`       | Auftragsprofi        | +10 % Geld für erledigte Firmenaufgaben (Haushalte)              | 3      | 7, 11, 15           | 10.000 € bis 62.500 €   |
| `task_safety`    | Fehlerkultur         | −25 % Strafe für verpatzte oder verpasste Firmenaufgaben         | 3      | 7, 12, 17           | 6.000 € bis 37.500 €    |
| `crisis_manager` | Krisenmanager        | −10 % Kosten für Schritte bei Krisen und Chancen und Strategien  | 3      | 7, 12, 17           | 10.000 € bis 62.500 €   |
| `move_luck`      | Glückshand           | +3 % Erfolgschance der Geschäftszüge (höchstens 95 %)            | 3      | 8, 12, 16           | 12.000 € bis 75.000 €   |
| `ad_agency`      | Werbeagentur         | −10 % auf Marketing-Kampagnen                                    | 3      | 9, 13, 17           | 12.000 € bis 75.000 €   |
| `dealmaker`      | Dealmaker            | +10 % Auszahlung gelungener Geld-Geschäftszüge (Haushalte)       | 3      | 10, 15, 20          | 20.000 € bis 125.000 €  |
| `ai_turbo`       | KI-Turbo             | −15 % Zeit der KI-Mitarbeiter für Firmenaufgaben                 | 3      | 11, 15, 19          | 15.000 € bis 93.750 €   |
| `ai_precision`   | KI-Feinschliff       | +5 % Erfolgschance der KI-Mitarbeiter (höchstens 95 %)           | 3      | 12, 17, 22          | 20.000 € bis 125.000 €  |
| `strategist`     | Strategieberater     | +4 % Erfolgschance eigener Strategien (höchstens `maxChanceBps`) | 3      | 13, 18, 23          | 25.000 € bis 156.250 €  |
| `move_tempo`     | Taktgeber            | −15 % Pause, bis ein Geschäftszug wieder bereit ist              | 3      | 16, 21, 26          | 40.000 € bis 250.000 €  |
| `activist`       | Aktivist             | +5 % Wirkungschance eigener Kampagnen gegen Firmen (ADR-133)     | 3      | 4, 10, 16           | 4.000 € bis 25.000 €    |

- Die XP-Verbesserungen nennen ihre XP-Quellen in `xpSources`; `grant_xp` addiert alle passenden Boni, bevor es
  rundet. Neue XP-Verbesserungen brauchen darum keinen neuen Code.
- Boni und Rabatte rechnen mit `apply_bps` („half even“). Rabatte und Boni sind je Verbesserung auf 100 % begrenzt.
- Tests: `supabase/tests/9a_more_upgrades.sql` (XP, Tresor, Lohn, tägliche Belohnung, Firmenaufgaben,
  Geschäftszüge, Kampagnen, Strategien, Protest, Ledger-Prüfung), `src/lib/sim/upgrades.test.ts`,
  `src/lib/sim/company-tasks.test.ts`, `e2e/upgrades-deals.spec.ts`.

## ADR-135: NFTs statt Artworks: Lizenzgebühren, KI-Sammler, Angebots-Chat — `akzeptiert`

Vorgabe: Artworks heißen jetzt NFTs. Selbst welche zu machen soll sich lohnen: Der Macher bekommt bei jedem
Weiterverkauf einen Anteil, auch wenn ihm das NFT nicht mehr gehört. Die KI kauft NFTs von Spielern, aber nur zu guten
Preisen. Unter jedem NFT gibt es einen Chat mit Preisangeboten, in dem auch die KI schreibt. Es soll ein größeres Ding
werden, bei dem mehr Leute mitmachen. Ersetzt den offenen Wunsch „KI-Sammler kaufen deine Kunstwerke, machen aber
Gegenangebote und zahlen sehr wenig“.

- **Nur die Texte heißen NFT.** Tabellen, RPCs und die Route `/artworks` bleiben (kein riskantes Umbenennen),
  `/nfts` leitet dorthin. Der Code eines NFTs lautet jetzt `NFT-0042`. Es bleiben Pixel-Bilder mit Spielgeld, keine
  Blockchain und kein Echtgeld.
- **Lizenzgebühr:** Bei jedem Verkauf, bei dem der Macher weder Verkäufer noch Käufer ist (Auktion, Festpreis,
  angenommenes Angebot, KI-Kauf, Verkauf der Galerie), gehen 10 % des Preises an den Macher. Sie kommen aus dem Erlös:
  Der Verkäufer bekommt Preis − 10 % Gebühr − 10 % Lizenz. Eigene Ledger-Art `artwork_royalty`, Benachrichtigung,
  Summe am NFT („Lizenzgebühren verdient“), im Atelier, auf dem Profil und in der neuen Rangliste „Top-Macher“.
- **Prägen lohnt sich:** Jedes weitere NFT kostet das 1,5-Fache statt das Doppelte, das Prägen bringt XP, und die
  KI-Sammler bewerten ein NFT nie unter seinen Prägekosten.
- **Festpreis:** Der Besitzer stellt ein NFT zu einem Preis ein, jeder kann sofort kaufen. Eine Auktion beendet den
  Festpreis.
- **KI-Sammler** (acht feste Namen, Geld der Haushalte, geschlossener Kreislauf): Sie bewerten ein NFT mit
  Prägekosten oder letztem Preis (der höhere, mindestens 1.000 €), +4 % je Like (bis 40), +3 % je früherem Verkauf von
  NFTs desselben Machers (bis 10), +1 % je Tag Alter (bis 30). Ein Festpreis bis zu diesem Wert wird mit 25 % pro
  Minute gekauft, höchstens 20 Käufe am Tag. Liegt er darüber, schreiben sie mit 8 % pro Minute ein Lowball-Angebot
  (65–90 % des Werts) in den Chat; NFTs ohne Festpreis bekommen selten eins. Was sie gekauft haben, bieten sie für
  125 % ihres Werts wieder an; Angebote ab 105 % nehmen sie an, kleinere lehnen sie im Chat ab. Ihre NFTs versteigert
  die Galerie nicht.
- **Angebots-Chat:** Unter jedem NFT, 1 bis 200 Zeichen durch den Wortfilter, höchstens 6 Nachrichten pro Minute.
  Ein Angebot reserviert kein Geld (es gilt 24 Stunden); beim Annehmen muss der Bieter zahlen können, sonst ist es
  ungültig. Ein neues Angebot ersetzt das eigene alte. Der Besitzer bekommt eine Benachrichtigung und nimmt mit einem
  Tipp an; alle anderen offenen Angebote enden, der Chat vermerkt den Verkauf.
- **Mehr Leute:** Sortierungen „Neu geprägt“ und „Heiß begehrt“ (meiste Angebote) sowie „Zum Verkauf“, neun neue
  Missionen (Chat, Angebote, Festpreis, Kauf, Verkauf, Lizenzgebühren; Wochen- und Meilenstein-Missionen mit einem
  Skillpunkt).
- Werte in `src/config/nfts.ts` (`game_config.nfts`), Formeln in `src/lib/sim/nfts.ts`. Test
  `supabase/tests/9b_nfts.sql`. Der Demo-Modus spielt dasselbe: KI-Sammler halten von Anfang an einige NFTs, antworten
  sofort auf Angebote und reagieren sofort auf einen Festpreis.

## ADR-136: Finns Touren auf dem Server, NFT-Details am Handy als Sheet — `akzeptiert`

**Kontext:** Finns kurze Touren (ADR-046) merkte sich nur der Browser (`localStorage`). In einem privaten Fenster oder
auf einem zweiten Gerät startete jede Tour wieder von vorn. Das große NFT-Fenster (Modal) war am Handy zu hoch, der
Chat darunter kaum erreichbar.

**Entscheidung:**

- Tabelle `player_seen_tours (player_id, tour_key)`, ohne Client-Rechte. RPCs `get_seen_tours()` und
  `mark_tour_seen(p_request_id, p_tour)` (von Natur aus idempotent: eine Tour gilt einmal als gesehen).
- Beim Laden holt das Tutorial die Liste vom Server, bevor es den Status verlässt („loading“), und mischt sie mit der
  des Browsers. Jede neu gesehene Tour geht nebenbei an den Server; Touren, die der Browser schon vorher kannte,
  werden einmal nachgereicht. Fällt der Server aus, bleibt die Browser-Liste gültig.
- Der Fortschritt mitten im ersten Tutorial bleibt im Browser; ob es fertig ist, wusste der Server schon vorher.
- Die NFT-Details öffnen unter 1024 px als Bottom-Sheet (Tastatur, sichere Ränder), darüber als großes Fenster.

## ADR-137: Patchnotes in der Leiste, erzeugt aus dem Changelog — `akzeptiert`

**Kontext:** Spieler erfuhren von Änderungen nur zufällig. `CHANGELOG.md` beschreibt jede Änderung schon auf Deutsch,
war im Spiel aber nicht zu sehen. Eine zweite, von Hand gepflegte Liste würde schnell veralten.

**Entscheidung:**

- **Eine Quelle:** `CHANGELOG.md`. `pnpm patchnotes` (`scripts/gen-patch-notes.ts`) liest sie mit
  `src/features/patch-notes/changelog.ts` und schreibt `src/config/patch-notes.generated.ts` (mit Prettier
  formatiert). Jede `## `-Überschrift ist eine Version (ein Datum am Ende wie `(2026-12-01)` wird erkannt), jeder
  Spiegelstrich ein Eintrag mit fettem Titel (`**Titel:**`) und Text, andere Absätze sind Hinweise der Version.
  Fett bleibt, Backticks und ADR-Verweise fallen weg, denn Spieler lesen die ADRs nicht.
- **Reihenfolge:** Die Datei wächst nach unten, also stehen Versionen und Einträge umgekehrt, das Neueste oben.
- **Prüfung:** `changelog.test.ts` vergleicht die erzeugte Datei mit dem Changelog. Wer den Changelog ändert und
  `pnpm patchnotes` vergisst, bekommt einen roten Test.
- **IDs:** Version als Slug, Eintrag als Slug plus FNV-1a-Hash seines Texts. Neue Einträge ändern alte IDs nicht;
  wird ein Eintrag umformuliert, gilt er wieder als neu.
- **Knopf in der Leiste:** Zeitung (`NEWSPAPER`) neben der Glocke, aussehen und Zustände wie der Missionen-Knopf
  (ADR-102), Beschriftung erst ab `xl`. Ab Level 2 (`DISCLOSURE.topbarPatchNotes`), also nicht im Tutorial.
  Damit bei 390 px nichts aus der Leiste rutscht, zeigt die Leiste unter `sm` nur noch die Münze statt „NEXA“
  (`<Wordmark compact />`); der Link heißt weiter „NEXA“.
- **Blauer Punkt:** Der Browser merkt sich die ID des neuesten gesehenen Eintrags (`nexa-patch-notes-seen`, erst nach
  der Hydration gelesen). Ist der neueste Eintrag ein anderer, leuchtet der Punkt. Öffnen setzt ihn zurück; solange
  das Fenster offen ist, tragen die Einträge seit dem letzten Blick einen blauen Punkt. Ohne gemerkte ID (erster
  Besuch, Eintrag entfernt) leuchtet nur der Knopf, einzelne Einträge werden nicht markiert. Nur eine Bequemlichkeit,
  daher kein Server.
- **Fenster:** Am Handy Bottom-Sheet, ab 1024 px ein mittiges Fenster (wie ADR-136). Versionen als Akkordeon, nur
  die neueste offen; geschlossene rendern nichts, die lange Liste bleibt schnell.

## ADR-138: Mira – die Firma läuft über einen Chat mit KI, die Übersicht klappt auf — `akzeptiert`

**Kontext:** Der Firmen-Tab war eine lange Liste aus Karten und Knöpfen. Spieler sollen mehr mitdenken und Aufgaben an
ihr Team vergeben, statt nur Knöpfe zu drücken. Die Übersicht war zu unübersichtlich.

**Entscheidung:**

- **Mira**, die KI-Assistentin, ist der erste Tab der Firma (und erscheint für Angestellte über dem Aufgabenbrett).
  Sie meldet neue Aufgaben, eine Krise oder Chance, freie Plätze für Geschäftszüge und wartende Bewerbungen, je
  einmal, und wägt ab: Wer hat Zeit (offene Aufgaben je Person), schafft die KI die Frist, was bringt ein Zug bei der
  Kasse (Erwartungswert je Minute). Der beste Weg trägt „Tipp“, riskante sind markiert.
- **Befehle im Chat:** „Gib das Packen an Anna“, „Inventur macht die KI“, „Das mache ich selbst“, „Alles an Anna“,
  „Starte den Wochenmarkt“, „KI automatisch an“, „Was steht an?“. Der Browser versteht sie (Wortstämme der
  Aufgaben- und Zugnamen, Spitznamen, „KI“, „ich“). Fehlt die Person oder die Aufgabe, fragt Mira zurück. Ist die Wahl
  riskant (jemand hat schon zwei offene Aufgaben, die KI ist zu langsam), fragt sie nach und nennt die bessere Wahl.
- **Freier Text** geht an Claude (Edge Function `company-assistant`, `claude-opus-5-5`, geringer Aufwand,
  JSON-Schema). Claude schlägt höchstens drei Aktionen vor; der Browser prüft sie gegen den aktuellen Stand und zeigt
  sie als Knöpfe. Nichts passiert ohne Tipp, und jede Aktion läuft über die bestehenden RPCs. Der Server bleibt die
  Autorität. Eine eigene Strategie für eine Krise oder einen Geschäftszug schreibt man direkt in den Chat; sie geht an
  die Jury aus ADR-132.
- `company_assistant_context(p_text)` liefert Claude Firma, Team, Aufgaben, Züge und Lage und zählt den Aufruf:
  höchstens 20 pro Spieler und Stunde (`companyAssistant.claudePerHour`, Fehler NX126 `assistant_busy`). Ohne
  Schlüssel oder über dem Limit antwortet die Mini-Mira im Browser mit Beispielen.
- Das Gespräch bleibt, solange die App offen ist; nach einem Neuladen meldet Mira den aktuellen Stand neu.
- **Übersicht zum Aufklappen:** sieben Bereiche (Quartal & Kasse, Geschäftszüge, Lage & Nachrichten, Verlauf,
  Produktion & Wachstum, Gewinn-Hebel, Chefbüro) mit einer Zeile Zusammenfassung. Offen ist am Anfang nur „Quartal &
  Kasse“; der Browser merkt sich, was offen ist. Sprünge (z. B. vom Gewinn-Coach ins Chefbüro) öffnen den Bereich.
- Finns Firmen-Tour zeigt jetzt auf Mira statt auf den Wachstumspfad.
- Nebenbei: Die JSON-Schemas der Edge Functions `strategy-judge` und `company-writer` enthielten Grenzen
  (`minimum`, `maxLength`, `minItems`), die strukturierte Ausgaben nicht kennen; die Grenzen prüft jetzt nur noch zod.

## ADR-139: Mira denkt weiter – freie Aufträge (einer pro Stunde), Plan, Analyse, Rückmeldungen — `akzeptiert`

**Kontext:** Mira (ADR-138) konnte Befehle ausführen und Vorschläge machen. Sie soll eine wirklich starke Assistentin
sein, und freie Aufträge an sie sollen selten und wertvoll sein.

**Entscheidung:**

- **Freier Auftrag:** Die Gründerin schreibt frei, was die Firma tun soll („Wir machen eine Rabattaktion für
  Stammkunden“). Mira liest das Ziel heraus (Geld, Bekanntheit, Qualität), schätzt die Chance, warnt bei
  Schönfärberei und setzt den Auftrag nach einem Tipp um. Technisch ist das die eigene Idee aus ADR-132 (Jury aus
  Claude oder Mini-KI, dann Würfel). **Pro Firma und Stunde nur einer** (`pitches.orderCooldownMinutes`, Fehler NX127
  `order_cooldown`); es zählt nur ein Auftrag, der wirklich gestartet wurde. Ist er gesperrt, nennt Mira die Wartezeit
  und bietet fertige Geschäftszüge an. Aufgaben vergeben und fertige Züge bleiben unbegrenzt.
- **Plan:** „Verteil alle Aufgaben“ verteilt alle offenen Aufgaben auf einmal: das Dringendste zuerst, je an die Person
  mit den wenigsten Aufgaben, die KI nur, wenn sie die Frist trotz ihrer Schlange schafft. Ein Tipp führt den Plan aus.
- **Analyse:** „Wie läuft die Firma?“ zeigt Quote und Ertrag der Aufgaben, die Quote der KI, verfallene Aufgaben,
  Auslastung des Teams, Kasse und Geschäftszüge, mit dem passenden nächsten Schritt.
- **Rückmeldungen:** Mira meldet von selbst, wie Aufgaben, Geschäftszüge und Aufträge ausgegangen sind (mit dem
  Urteil der Jury), und schlägt Alarm, wenn eine offene Aufgabe in 10 Minuten verfällt.
- **Claude:** bekommt die letzten acht Nachrichten als Gedächtnis, die letzten Ergebnisse, das letzte Quartal und den
  Stand der Aufträge; mittlerer Denkaufwand; ein genauerer Leitfaden (Erwartungswert, Fristen, Auslastung, ehrliche
  Einschätzung von Ideen). Neue Aktion `order`. Ohne Schlüssel erkennt die Mini-Mira Aufträge an der Form des Satzes.

## ADR-140: Firmen-Minispiele lösbar durch Nachdenken, nicht durch Raten — `akzeptiert`

**Kontext:** Bei einigen Sortier-Aufgaben war die richtige Seite nicht herleitbar (warum ist „Miete Mai“ bezahlt,
„Strom Mai“ aber offen?). Beim Ordnen kamen alle Werte aus 1 bis 99, also Schichten um „73 Uhr“ oder Käse mit
97 Monaten Reifezeit.

**Entscheidung:**

- Jede Sortier-Aufgabe nennt ihre Regel in der Anleitung („Bis einschließlich April ist alles bezahlt“, „Häufig heißt:
  öfter als 1 von 100“, „Ware aus der EU ist zollfrei“). Begriffe, die nur Fachleute zuordnen können, sind ersetzt.
- Jede Ordnen-Aufgabe hat einen eigenen, realistischen Wertebereich (`companyTasks.tasks[].range`, z. B. Schichtbeginn
  6 bis 22 Uhr, Reifezeit 2 bis 36 Monate). Server (`company_task_puzzle()`) und Demo nutzen ihn gleich.
- Zählen, Antippen, Rechnen und Merken waren schon herleitbar und bleiben, wie sie sind.

## ADR-141: Ein lebendiger NFT-Markt – KI-Sammler handeln untereinander, Beliebtes wird teurer — `akzeptiert`

**Kontext:** Die KI-Sammler (ADR-135) kauften nur von Spielern und boten dann an. Ohne Spieler bewegte sich nichts;
Beliebtheit zählte nur über Likes.

**Entscheidung:**

- **Nachfrage:** Offene Angebote (verschiedene Bieter) und Verkäufe der letzten 7 Tage erhöhen, was die Sammler zahlen
  (`nfts.ai.demand`, je gedeckelt), zusätzlich zu Likes, Ruf und Alter. Prüft ein Sammler das Angebot eines Bieters,
  zählt dessen eigenes Angebot nicht mit; sonst würde ein Angebot den Preis hochtreiben, den man schlagen muss.
- **Handel unter Sammlern:** Jede Minute kauft ein anderer Sammler ein NFT, das ein Sammler hält, mit einer Chance,
  die mit Likes, Angeboten und Verkäufen steigt (`nfts.ai.trade`). Ein neues NFT bleibt mindestens 30 Minuten beim
  Käufer; höchstens 2 Händel pro Minute und 30 am Tag. Danach bietet der Käufer es wieder an.
- **Preis:** Ziel des Käufers ist der faire Wert (Prägekosten oder Mindestwert mal Boni, ohne letzten Preis) mal
  Geschmack (85 bis 125 %); der Preis geht die Hälfte des Weges vom letzten Preis dorthin. So schwanken Preise nach oben
  und unten, statt endlos zu steigen. Das Geld bleibt bei den Haushalten; der Schöpfer bekommt die Lizenzgebühr.
- Verkäufe unter Sammlern sind Art `ai` mit `seller_ai` und zählen nicht zum Tageslimit der Käufe von Spielern.
- Nebenbei: Nach einem Verkauf setzt ein Sammler seinen Preis erst, nachdem die offenen Angebote geschlossen sind.
- Mira trägt das Schild „Assistentin“ statt „KI“.

## ADR-142: Mehr Missions-XP auf höheren Levels; einmal bei einem echten Spieler arbeiten — `akzeptiert`

**Kontext:** Missionen zahlten auf jedem Level gleich viel XP, während die Level immer mehr XP brauchen. Spieler sollen
außerdem einmal bei der Firma eines anderen Spielers arbeiten (Multiplayer).

**Entscheidung:**

- Missions-XP wachsen mit dem Level: mal `min(8, 1 + 0,15 × (Level − 1))` (Level 10: ×2,35, Level 30: ×5,35), festgelegt
  beim Verteilen der Mission (`progression.missionXpScalePerLevel` / `missionXpScaleMax`). Vorlagen mit
  `params.fixedXp` behalten ihre XP.
- Neuer Meilenstein `m_work_for_player`: einen Job bei der Firma eines anderen echten Spielers annehmen. 1250 Basis-XP,
  mit dem globalen Multiplikator 2500 XP, fest. Er kommt vor allen anderen Meilensteinen (Kette 0), sobald Jobs
  freigeschaltet sind, damit ihn jeder bekommt. Metrik `player_job`: Jobstart bei einer Spielerfirma oder jede dort
  gearbeitete Stunde (so zählt er auch für alle, die schon bei jemandem arbeiten). Im Demo-Modus gibt es keine anderen
  Spieler, dort fehlt er.

## ADR-143: Großes Pop-up, wenn dir eine Aufgabe zugewiesen wird — `akzeptiert`

**Kontext:** Bekam ein Mitarbeiter eine Aufgabe delegiert (ADR-129), kam nur eine stille Benachrichtigung in der
Glocke. Das wurde übersehen.

**Entscheidung:** Der Server benachrichtigt den Empfänger schon (type_key `company_task`). Zusätzlich zeigt der Client
ein großes, zentrales Pop-up (`DelegatedTaskOverlay`, in der App-Hülle neben dem Level-up-Overlay), sobald eine neue,
ungelesene `company_task`-Benachrichtigung auftaucht. „Jetzt ansehen“ führt zum Job-Tab, „Später“ schließt es.
Bereits gezeigte Pop-ups merkt sich der Browser (`localStorage`, nach der Hydration gelesen), damit es nach einem
Neuladen nicht wiederkommt. Rein clientseitig; keine Schema-Änderung.

## ADR-144: Firmen-Minispiele zum Anfassen – Schieben, Drehen, Zuordnen, Weg finden — `akzeptiert`

**Kontext:** Die Firmenaufgaben (ADR-129) waren fast nur Tippen und Eintippen. Spieler wollten Spiele, bei denen man
Dinge verschiebt, wie bei einem Captcha, und die trotzdem durch Hinsehen und Nachdenken lösbar sind (ADR-140), nie
durch Raten.

**Entscheidung:**

- **Vier neue Spiele** (`companyTasks.games`), jedes vom Server aus Rätsel und Lösung bewertet, Teilpunkte in
  Basispunkten:
  - **Einpassen (`slider`):** Drei Teile in ihre sichtbare Lücke ziehen (Bahn 0 bis 100). Innerhalb von
    `tolerance` (3) volle Punkte, innerhalb der dreifachen Toleranz die Hälfte, der Durchschnitt zählt.
  - **Drehen (`rotate`):** Drei Räder (8 Stufen à 45°) drehen, bis der Pfeil auf die Markierung zeigt; Ziehen am Rad
    oder Pfeiltasten. Jedes Rad startet mindestens zwei Stufen daneben. Eine Stufe daneben zählt halb.
  - **Zuordnen (`match`):** Sechs Karten in drei Boxen ziehen; die Regel steht in der Anleitung („Rechnungen zu
    Finanzen …“). Je Box zwei von drei Karten der Gruppe, gemischt. Bewertet wird je Karte.
  - **Weg finden (`path`):** Auf einem 5×5-Feld mit 6 bis 9 Hindernissen den kürzesten Weg vom linken zum rechten
    Rand ziehen. Die Hindernisse erzwingen immer einen Umweg von mindestens 2 Schritten. Der kürzeste Weg gibt volle
    Punkte, jeder Schritt mehr kostet `stepBps` (10 %), ein unterbrochener Weg gibt nichts.
- Die Lösung trägt alles, was die Bewertung braucht (Toleranz, Stufen, Feld, kürzeste Länge), so bleibt
  `company_task_grade()` unveränderlich. Breitensuche in `company_task_path_length()` und `shortestPath()`.
- **25 neue Aufgaben** mit diesen Spielen: vier für jede Firma, eine je Produkt. Bestehende Schlüssel bleiben
  unverändert (Verlauf und offene Aufgaben hängen daran).
- **Sortieren** ist jetzt Ziehen: Karte auf den Stapel ziehen oder wischen; die Knöpfe bleiben als Ersatz zum Tippen
  und für die Tastatur. **Rechnen** hat zusätzlich Knöpfe −100 … +100.
- Bedienung mit Pointer Events (Maus, Finger, Stift), Karten folgen per `transform`; jedes Spiel geht auch mit
  Tippen oder Tastatur. Migration `20261204001600_task_games.sql`, Test `supabase/tests/9f_task_games.sql`.

## ADR-145: Spielerfirmen in der Aktienliste, beliebte Aktien zuerst — `akzeptiert`

**Vorgabe:** Börsennotierte Firmen von Spielern sollen dort stehen, wo die KI-Aktien stehen. Aktien, die oft
aufgerufen werden und in die viel investiert wird, stehen weiter oben. Beim Sortieren lassen sich nur Spielerfirmen
anzeigen.

**Entscheidung:**

- **Eine Liste:** Die Märkte-Seite zeigt KI- und Spieleraktien zusammen (`company_kind` aus `get_market_snapshot`,
  schon seit ADR-067 im Snapshot). Spieleraktien tragen das Schild „Spieler“ in der Zeile und auf der Detailseite und
  öffnen ihre Detailseite wie jede andere Aktie. Im Demo-Modus steht die eigene börsennotierte Firma ebenso in der
  Liste und ist handelbar; sie zählt nicht zum NEXA 30.
- **Sortierung:** „Beliebt“ (Standard), „A–Z“, „Bewegung“ und „Spieler“. „Spieler“ ist ein Filter in der Reihenfolge
  „Beliebt“; ohne Spielerfirma erklärt ein leerer Zustand, warum die Liste leer ist. Gleichstand: größerer Börsenwert,
  dann Name (`comparePopularity`).
- **Beliebtheit:** Score = Aufrufe × 1 + Investoren × 20 + ⌊√(investierte Euro) × 0,2⌋ über die letzten 3 Tage
  (`marketPopularity`, `popularityScore`). Investoren sind verschiedene Käufer (Kauf-Trades und Zeichnungen). Die
  Wurzel hält einen einzelnen Großanleger davon ab, viele kleine zu überstimmen.
- **Aufrufe zählen günstig und schwer manipulierbar:** Öffnet ein Spieler eine Aktienseite, ruft der Client
  `record_security_view` auf. Gezählt wird je Spieler und Aktie höchstens alle 30 Minuten, höchstens 200 am Tag; die
  eigene Firma zählt für den Gründer nie (Aufrufe und Käufe). Gespeichert wird nur ein Zähler je Aktie und Tag und
  eine Marke je Spieler und Aktie.
- **Kosten bei vielen Spielern:** Der Score wird nicht pro Abfrage berechnet. Der Bau des Snapshots (einmal pro Takt,
  ADR-123) rechnet ihn höchstens alle 5 Minuten neu, über einen Index-Bereich je Aktie, und liest ihn sonst mit einem
  Join aus `security_popularity`.

## ADR-146: Börsengang in höchstens 10 Minuten — `akzeptiert`

**Vorgabe:** Die Zeichnung zum Börsengang soll deutlich einfacher werden und innerhalb von 10 Minuten möglich sein.
Wer die Aktien voll hat, ist an der Börse.

**Entscheidung:**

- **Zeitfenster:** Die Zeichnung (Börsengang und Kapitalerhöhung) läuft höchstens `startups.ipo.subscriptionMinutes`
  = 10 Minuten statt 12 Stunden (ersetzt diesen Teil von ADR-067).
- **Voll heißt börsennotiert:** Nimmt eine Zeichnung die letzte Aktie, schließt das Angebot sofort und die Firma ist an
  der Börse, ohne auf den Minutenjob zu warten.
- **Nicht voll:** Am Ende des Fensters geht die Firma trotzdem an die Börse, mit dem, was gezeichnet wurde; der Rest
  wird nicht ausgegeben, der Gründer behält also mehr. Das ist die spielerfreundliche Variante: kein Scheitern, keine
  Rückbuchungen, und das Geld der Zeichner ist sofort in Aktien angelegt. Ein Auffüllen durch die KI auf 100 % hätte
  viel Geld aus dem Finanzmarkt in Spielerfirmen geschoben.
- **KI-Investoren zeichnen mit:** Ihr Anteil `aiTakeShare(Qualität)` (20 bis 70 % des Angebots) kommt gleichmäßig über
  das Fenster dazu, jede Minute ein Stück, nie mehr als frei ist, bezahlt über das Hauptbuch aus dem Finanzmarkt-Topf.
  So bewegt sich der Fortschrittsbalken auch ohne andere Spieler, und Spieler können den Rest schneller füllen.
- **Ein Tipp zum Zeichnen:** Auf der Märkte-Seite steht jedes Angebot mit Balken (Spieler und KI) und Countdown.
  Zeichnen geht mit festen Beträgen (`startups.ipo.quickAmountsCents`: 100 €, 1.000 €, 10.000 €) oder „Rest“; kein
  Eingabefeld, kein zweites Fenster. Jede Zeichnung trägt eine `request_id`. Gründer zeichnen nicht mit und sehen
  stattdessen einen Hinweis.
- **Demo:** Dieselben Regeln: 10 Minuten, die KI-Investoren zeichnen über das Fenster, danach ist die Firma an der
  Börse und steht in der Aktienliste. „Quartal jetzt abschließen“ beendet eine laufende Zeichnung weiter sofort.

## ADR-147: „Firma auflösen“ deutlich sichtbar — `akzeptiert`

**Kontext:** Das Auflösen der Firma steckte im Chefbüro in einem zugeklappten Bereich „Lohnfaktor und Auflösen“ und
war kaum zu finden.

**Entscheidung:** Der Knopf „Firma auflösen“ steht jetzt in einer eigenen, immer sichtbaren „Gefahrenzone“ im Chefbüro
(roter Rahmen, kurzer Hinweis, was passiert). Der Lohnfaktor bleibt im kleinen aufklappbaren Bereich. Rein
oberflächlich; keine Server-Änderung.

## ADR-148: Gelöste Aufgaben steigern den Gewinn langfristig (Schwung) — `akzeptiert`

**Kontext:** Firmen-Aufgaben (ADR-129) zahlten nur einmalig. Gutes Spielen sollte sich langfristig und wachsend
auszahlen.

**Entscheidung:** Jede Firma hat einen „Schwung“ (`player_companies.task_momentum`, Start 1), einen Nachfrage-Multiplikator
auf alles andere. Jede gelöste Aufgabe hebt ihn (mehr bei perfekten Runs, weniger wenn die KI sie macht), eine
verpatzte oder verfallene senkt ihn. Er driftet jede Betriebsstunde zurück Richtung 1
(`companyTasks.momentum.decayPerHourBps`), deckelt bei +60 % (`maxBps`). Mehr Nachfrage heißt mehr Umsatz, der
Ausbau und mehr Personal finanziert, die mehr Aufgaben lösen – gutes Spiel verstärkt sich also selbst. Server
(`company_task_momentum_apply`, in `company_task_resolve`; Abbau und Multiplikator in `player_company_close_hour`)
und Demo (`closeStartupHour` mit `taskMomentum`) rechnen gleich. Angezeigt im Aufgabenbrett als „Schwung +X %“.

## ADR-149: Börsengang in höchstens einer Stunde, mehr KI-Investoren und schneller — `akzeptiert`

**Kontext:** Der Börsengang aus ADR-146 dauerte höchstens 10 Minuten; die KI-Investoren zeichneten nur 20 bis 70 %
und gleichmäßig verteilt. Gewünscht: bis zu einer Stunde Zeit, mehr KI-Investoren, die schneller einsteigen.

**Entscheidung:**

- Zeichnungsfenster höchstens 60 Minuten (`startups.ipo.subscriptionMinutes`). Sind alle Aktien gezeichnet, ist die
  Firma sofort an der Börse (unverändert, ADR-146).
- KI-Investoren nehmen 60 bis 100 % des Angebots (`aiTakeBase` 0,6 + `aiTakePerQuality` 0,4 × Qualität); eine
  Firma mit Top-Qualität füllen sie bis zum Ende allein.
- Sie kommen früh: Anteil nach dem Zeitanteil t = 1 − (1 − t)^`aiPace` (3): nach 10 Minuten etwa 42 %, zur Hälfte
  87,5 % ihres Teils. Server (`share_offer_ai_topup`) und Demo (`aiSubscribedE6`) rechnen gleich.

## ADR-150: NEXA Nachrichten – stündliche Live-Sendung mit Mr. Doodle Dangle — `akzeptiert`

**Kontext:** Gewünscht ist ein großes, wiederkehrendes Ereignis, auf das sich alle freuen: einmal pro Stunde Nachrichten
wie im Fernsehen, mit einem Sprecher im Pixel-Art-Studio, Live-Chat, bösen und lustigen Meldungen über Spieler und
ihre Firmen, und mit echten, großen Folgen für Kurse, Firmen und Aufgaben.

**Entscheidung:**

- **Sendung zur vollen Stunde.** Der Entwurf entsteht 10 Minuten vorher (`news_show_build`). Die Sendung findet nur
  statt, wenn ein echter Spieler zuschaut: Sie startet mit dem ersten Zuschauer zur vollen Stunde oder bis zu
  10 Minuten danach (`waitMinutes`); ohne Zuschauer verfällt sie, und nichts passiert. Erst beim Start greifen alle
  Folgen, einmal. Jeder Zuschauer errechnet den Stand aus der Startzeit des Servers, alle sehen dasselbe.
- **Beiträge (höchstens 7):** der Verlierer des Tages (größter Vermögensverlust, bekommt ein Trostpflaster von
  500 € aus den Haushalten), ein bis zwei Spielerfirmen mit Skandal oder Hype (Bekanntheit ±10 bis 25 %, Schwung,
  Aktie ±8 bis 20 %), zwei KI-Aktien (±6 bis 18 %), eine ganze Branche (±4 bis 10 %) oder der Wert aller offenen
  Firmen-Aufgaben (±20 bis 40 %), der Gewinner des Tages, und zum Schluss Mr. Doodle Dangles Geheimtipp (ein Hinweis
  mit Vorlauf wie in ADR-119, trifft zu 70 % ein). Wer genannt wird, bekommt eine Benachrichtigung; die Meldungen
  stehen danach im News-Feed.
- **Keine Wiederholungen:** Die Mini-KI baut jeden Text aus Rahmen × Anlass (`newsShow.texts`, über 400 Kombinationen)
  und merkt sich, was sie benutzt hat (`news_show_used`): Jede Kombination kommt einmal, bevor sich etwas wiederholt.
  Wer in der letzten Sendung vorkam, kommt nicht sofort wieder dran.
- **Claude** (Edge Function `news-anchor`, sobald ein Schlüssel hinterlegt ist) schreibt den Entwurf vor der Sendung
  in Mr. Doodle Dangles Ton um, passend zur Idee und Branche jeder Firma. Die Folgen legt weiterhin der Server fest;
  Claude ändert nur Schlagzeile und Text. Ein Aufrufer pro Sendung (`news_show_claim_script`).
- **Ton:** derb, schadenfroh, übertrieben, aber nur über das, was im Spiel passiert ist (verzocktes Spielgeld,
  gefloppte Firmen). Nichts über echte Eigenschaften von Menschen, keine echten Personen oder Marken.
- **Kein Wissensvorsprung:** Die Folgen greifen beim Start, bevor der Sprecher sie vorliest. Wer zuschaut, kann also
  nicht vor einem Kurssprung risikolos handeln; den Vorsprung gibt nur der Geheimtipp am Ende.
- **Live-Chat** neben dem Fernseher: 200 Zeichen, Emojis, Wortfilter, höchstens 10 Nachrichten pro Minute; Zuschauerzahl.
- **Markierung:** Der News-Tab zeigt „Gleich“ (5 Minuten vorher) und „Live“ (ab der vollen Stunde, solange eine
  Sendung starten oder laufen kann). Die letzte Sendung lässt sich 55 Minuten lang noch einmal ansehen.
- Der Demo-Modus spielt dasselbe mit erfundenen Zuschauern im Chat; ein Demo-Knopf startet eine Sendung sofort.

## ADR-151: Börsengang – voll oder Geld zurück, Auszahlung erst nach dem Börsenstart — `akzeptiert`

- **Treuhand statt Firmenkasse.** Zeichnungen von Spielern gehen auf das Systemkonto `offer_escrow`
  (`company_share_offers.escrow_cents`), nicht mehr in die Firmenkasse. KI-Investoren werden während der Zeichnung nur
  gezählt und zahlen erst beim Erfolg. Der Gründer kann vor dem Börsenstart also nichts davon ausgeben oder auszahlen.
- **Voll oder gar nicht.** Ein Börsengang braucht am Ende `startups.ipo.minFillBps` (10 000 = alle) der angebotenen
  Aktien, Spieler und KI zusammen. Dann geht das Geld in einer Buchung an die Firma, und sie ist gelistet (sofort,
  sobald alles gezeichnet ist, ADR-146). Sonst platzt er (`status 'failed'`): Jeder Spieler bekommt seinen Betrag
  vollständig zurück, die Firma bleibt `private` und darf es jederzeit wieder versuchen.
- **Warum das spannend ist:** KI-Investoren übernehmen 60 % plus 40 % × Qualität (ADR-149). Nur eine Top-Firma wird
  allein von der KI voll; alle anderen brauchen Mitspieler, die den Rest zeichnen. Der Dialog zeigt beide Anteile.
- **Kapitalerhöhung:** gibt weiterhin aus, was gezeichnet wurde, aber auch dieses Geld wartet bis zum Ende.
- **Sonderfälle:** Wird die Firma während der Zeichnung aufgelöst, platzt das Angebot beim nächsten Minutenlauf und
  alle bekommen ihr Geld zurück. Setzt ein Zeichner sein Konto zurück, fällt sein Betrag an den Staat, nicht an die
  Firma. Angebote, die beim ersten Einspielen dieses Updates offen sind, enden nach den alten Regeln.
- **Benachrichtigung** `ipo_result` (Pflicht) an alle Zeichner und den Gründer: geglückt oder geplatzt mit Betrag.
- **Demo:** Erfundene Mitspieler zeichnen bis zu `demoPlayersShare` (35 %); mit schlechter Qualität platzt es auch dort.

## ADR-152: NEXA Nachrichten 2 – persönliche Meldungen, NFTs, Abschweifungen, Gesichter, Zuschauer im Chat — `akzeptiert`

- **Gesichter:** Jeder Beitrag trägt ein `mood` (neutral, shocked, crying, laughing, angry, smug, confused, proud),
  zufällig aus `newsShow.moods` je Skript; Claude darf ein anderes wählen. Das Studio zeigt Mimik und spielt einen
  Laut dazu. Der Vorspann (12 Sekunden) ist eine kleine Montage über Mr. Doodle Dangle.
- **Persönliche Meldungen (`gossip`, zwei je Sendung):** aus dem, was Spieler in den letzten 24 Stunden getan haben:
  Feed-Einträge (Level, Beförderung, Job, Auto, Haus, Deal, Coin, Rug Pull, geplatzter Kredit), geplatzter
  Börsengang, verlorener Job, seit Tagen nicht gesehen, Erster oder Letzter der Reichenliste. Gute Nachrichten gibt es
  mit vergiftetem Lob, schlechte gnadenlos und mit 100 € Schmerzensgeld. Jede Tatsache wird einmal erzählt
  (Schlüssel `fact:…` in `news_show_used`, gesetzt beim Start der Sendung).
- **NFT-Meldung (`nft`):** der teuerste Verkauf der letzten 24 Stunden mit Titel, Künstler, Käufer und Preis.
- **Abschweifung (`ramble`, 70 % der Sendungen):** zur Hälfte das Gerücht, eine Person des öffentlichen Lebens habe
  in eine Aktie investiert (die Aktie steigt um 3 bis 9 %, Spielerfirmen bevorzugt), sonst reiner Unsinn ohne Folgen.
- **Reihenfolge:** Menschen zuerst (Verlierer, Meldung, Firma, NFT, Gewinner, Meldung, Firma, Abschweifung, Welt),
  die KI-Aktie zuletzt, der Geheimtipp am Ende; höchstens 10 Beiträge, nur noch eine KI-Aktie.
- **Ton (ändert ADR-150):** Mr. Doodle Dangle ist ein Assi mit Krawatte und teilt deutlich härter aus. Über Spieler
  weiterhin nur wegen dessen, was im Spiel passiert ist; nichts über Herkunft, Geschlecht, Religion, Sexualität,
  Behinderung, Aussehen, Alter oder Familie. Echte Personen des öffentlichen Lebens dürfen nur in Abschweifungen
  vorkommen, als offensichtlich absurde Satire und als Gerücht aus lächerlicher Quelle; keine Behauptungen über
  Straftaten, Gesundheit oder Privatleben, keine Privatpersonen.
- **Zuschauer im Chat:** Erfundene Zuschauer mit Alltagsnamen (`newsShow.chat.bots`) schreiben während der Sendung:
  empört über den Sprecher, als glühende Fans oder über den, der gerade dran ist. Ihre Zeilen entstehen beim Start
  für die ganze Sendung, jede mit ihrer Uhrzeit, und erscheinen erst dann (`news_show_after_start`).
- **Live-Chat:** feste Höhe, scrollt innen, springt bei neuen Nachrichten ans Ende.

## ADR-153: Aktien haben einen Bestand — `akzeptiert`

- **Problem:** Der Markt verkaufte beliebig viele Aktien. Ein Spieler hielt 1,004 Mio. Aktien einer Firma mit 1 Mio.
- **Regel:** Ein Kauf bekommt höchstens den freien Bestand: Aktien der Firma (`companies.shares_outstanding`) minus
  alles, was Spieler halten, minus die offenen Reste ihrer Kauforders (`security_free_float_e6`). Ist nichts mehr
  frei, scheitert der Kauf mit `no_shares_left` (NX129); eine größere Order bekommt genau den Rest. Käufer derselben
  Aktie kommen nacheinander dran (Sperre auf dem Wertpapier), der Bestand kann nicht überverkauft werden.
- **Mehr Aktien** gibt es nur über den Gründer: Kapitalerhöhung (ADR-067). Verkäufe geben Aktien wieder frei.
- Gilt für alle Aktien (KI-Firmen haben 15 bis 100 Mio. Stück, dort spielt es praktisch keine Rolle), nicht für
  Anleihen und Krypto. Bestehende Depots über dem Bestand bleiben; sie sperren nur weitere Käufe, bis genug verkauft ist.

## ADR-154: Missionen sind immer machbar — `akzeptiert`

- `mission_doable(spieler, vorlage, metrik)` prüft, ob eine Mission noch zu schaffen ist: Einstellen und Stellen
  ausschreiben nur mit freiem Platz in der eigenen Firma; „erste …“-Meilensteine (KI-Kraft, Stellenanzeige, Fähigkeit,
  Geschäftszug, Trade, NFT, Anleihe) nur, wenn man es noch nie getan hat; Bleibe kaufen nur ohne Bleibe, umziehen nur
  unter der höchsten Stufe, Auto nur mit freiem Garagenplatz, Möbel nur mit Bleibe.
- `missions_assign` verteilt nur machbare Missionen. Aktive Schnell- und Meilenstein-Missionen ohne Fortschritt, die
  unmöglich geworden sind, verfallen und machen Platz.
- „Kauf dir ein Grundstück“ (`m_home_first`): einmalig, feste 2.500 Basis-XP (mit dem XP-Faktor 5.000), als erster
  Meilenstein, sobald Grundstücke freigeschaltet sind.

## ADR-155: Accessoires für die Pixelfigur, Freunde-Platz und Anstupsen — `akzeptiert`

- **Figur:** Neben dem Porträt (ADR-054) hat jeder Spieler eine Ganzkörperfigur (24×32) in den Farben seines
  Porträts (Haut, Haare, Outfit, Akzent). Sie zeigt Profil, Freunde-Platz und Kleiderschrank.
- **Accessoires:** 51 Teile in sechs Slots (Kopf, Gesicht, Kostüm, Hand, Haustier, Rücken), vom Luftballon
  (150 €) bis zur Goldkrone (5 Mio. €), in vier Seltenheiten. Jede Seltenheit ist teurer als jedes Teil der Stufe
  darunter; Gewöhnliches kostet weniger als ein Zehntel des Startkapitals, Legendäres ab 750.000 € als Statussymbol.
  Manche Teile brauchen ein Level. Katalog in `src/config/accessories.ts`, Pixel-Art als Daten in
  `src/components/pixel/accessories.ts`; Paletteneinträge `$s`, `$h` … übernehmen die Farben des Trägers.
- **Kauf:** einmal je Teil, bezahlt an die Haushalte wie Möbel (`lifestyle_purchase`), kein Wiederverkauf, zählt nicht
  zum Vermögen. Gekauftes wird sofort angezogen. Getragen wird höchstens ein Teil je Slot; gezeichnet von hinten nach
  vorn (Rücken, Figur, Kostüm, Gesicht, Kopf, Hand, Haustier), die haltende Hand liegt über dem Gegenstand.
  Anprobieren geht ohne Kauf, nur in der Ansicht. Legendäre Käufe erscheinen im Freundes-Feed.
- **Getrennt von `cosmetic_items`:** Die alten kosmetischen Tabellen sind ausdrücklich ohne Geldbezug (Freischaltung
  über Level und Erfolge); Accessoires kosten Spielgeld und bekommen eigene Tabellen.
- **Freunde-Platz:** Oben auf `/friends` (über den Reitern) stehen alle Freunde als angezogene Figuren auf einem
  gepflasterten Platz mit Brunnen, Bäumen, Laternen und Bänken; über Online-Freunden ein grünes „online“, sie hüpfen
  leicht (nicht bei reduzierten Animationen). Ein Tipp auf die Figur öffnet das Profil. Viele Freunde brechen in
  Zeilen um und scrollen innerhalb des Platzes.
- **Anstupsen:** 👉 auf dem Platz oder auf dem Profil eines Freundes. Nur unter Freunden, denselben Freund erst nach
  10 Minuten wieder, höchstens 30 Stupser in 24 Stunden. Der Freund bekommt die Benachrichtigung „… hat dich
  angestupst! 👉“ mit Link auf das Profil; sie lässt sich in den Einstellungen abschalten.
- **Demo:** Ohne Mitspieler startet die Demo weiter ohne Freunde; ein gespeicherter Demo-Zustand (`friendList`) kann
  erfundene Freunde mitbringen (Tests, Vorführung).

## ADR-156: Das Büro mit allen Figuren und Sprechblasen — `akzeptiert`

- **Wo:** Auf der Job-Seite (`/job`) eines Angestellten und auf der Firmenseite des Gründers steht das Büro
  (`OfficeScene`): Gründer und alle aktiven Angestellten als angezogene Pixelfiguren (ADR-155) am Schreibtisch, mit
  Namen. KI-Kräfte bleiben Roboter im Firmen-T-Shirt, freie Plätze (nur beim Gründer) bleiben leere Tische. Viele
  Leute brechen in zentrierte Zeilen um und scrollen innerhalb des Büros, nie seitwärts.
- **Anwesenheit:** Wer in den letzten `social.onlineMinutes` (10) aktiv war, wippt leicht und hat einen grünen Punkt;
  die anderen sind gedimmt und schlafen („zzz“). Ein Tipp auf eine Figur öffnet das Profil.
- **Sprechblasen:** Unter dem Büro „Sag was ins Büro …“. Das schreibt in den Firmenchat (`post_company_message`,
  dieselben Regeln, Filter und Limits), es gibt keinen zweiten Kanal. Die neueste eigene Nachricht jedes Mitglieds
  steht `startups.chat.bubbleSeconds` (120) lang als Pixel-Sprechblase über seiner Figur; Systemzeilen bekommen
  keine. Abgefragt wird wie beim Chat alle 10 Sekunden; die Blase verschwindet nach der Uhr des Geräts.
- **Server:** `get_company_floor()` liefert Firma (Name, Farbe, Art, Logo), `chat`, `ai_workers`, `bubble_seconds`
  und `members` (Spitzname, Porträt, getragene Accessoires, Rolle, Jobtitel, online, ich, letzte Nachricht), nie IDs.
- **KI-Arbeitgeber:** Wer bei einer KI-Firma arbeitet, sieht dort die Mitspieler mit Job bei derselben Firma (höchstens
  `startups.chat.floorMaxMembers`, 24, online zuerst), aber ohne Eingabe und ohne Blasen: Den Firmenchat gibt es nur
  in Spielerfirmen (ADR-060), und ein Chat mit Hunderten Fremden wäre etwas anderes.
- **Auch anderswo:** Organigramm und Teamliste zeigen Kollegen am eigenen Arbeitsplatz als angezogene Figur statt
  Porträt (Daten aus demselben Aufruf).
- **Demo:** Der Gründer sieht sich selbst mit seiner Blase. Bei einem KI-Arbeitgeber stehen drei erfundene Kollegen
  mit Accessoires (fest aus dem Namen abgeleitet) daneben, eine schläft; in jedem Blasenfenster sagt einer von ihnen
  etwas. Ihr Profil lässt sich öffnen.

- **Nachtrag (zweite Kollektion):** 74 neue Teile, zusammen 125, in zwölf Themen-Sets (Piraten, Raumfahrt, Ritter,
  Zauberei, Küche, Rockstar, Sport, Tierisch, Feiertage, Büro & Börse, Völlig absurd, Prunk & Protz); `set` ist ein
  optionales Feld nur für die Gruppierung. Neue fünfte Seltenheit „Mythisch“ (Farbe `loss` mit Verlauf), eine je Slot,
  150 bis 900 Mio. € ab Level 35 bis 50, erscheint wie Legendäres im Feed. Alle Preise grob verdreifacht (gewöhnlich,
  450 bis 2.800 €, jedes Teil mit dem Startkapital bezahlbar) bis verzehnfacht (legendär 7,5 bis 75 Mio. €), selten
  6.000 bis 77.000 €, episch 0,2 bis 1,75 Mio. €. Der Kleiderschrank bekommt Suche, Filter nach Slot und Seltenheit,
  Sortierung nach Preis oder Seltenheit, „Nur bezahlbare“ und die Ansicht „Nach Sets“. Der Server liest Preise aus
  `game_config`, eine Migration war nicht nötig. Pixel-Art der neuen Teile in `src/components/pixel/accessories-second.ts`.

## ADR-157: Studiopublikum und Spieler im Bild bei den NEXA Nachrichten — `akzeptiert`

- **Publikum:** Unter dem Fernseher steht ein Studiopublikum auf einem Sofa: alle, die die Sendung gerade schauen
  (`news_show_viewers` der letzten 20 Sekunden), als angezogene Figur (ADR-155). Man sieht sich selbst („Du“), dann
  Freunde (Herz), dann die anderen, nach Namen sortiert, damit niemand herumspringt. Der Server schickt höchstens
  `newsShow.audience.max` (12) Spieler; wer nicht auf die Bühne passt, steht als „+N“ daneben. Auf dem Handy rücken
  die Figuren zusammen, nichts scrollt waagerecht.
- **Erfundene Zuschauer** (ADR-152) kommen ins Studio, sobald sie schreiben, und bleiben `botMinutes` (8) lang. Sie
  bekommen ein Porträt und bis zu drei Accessoires aus dem Katalog, abgeleitet aus dem Namen (Hash, gemischt nach
  Fisher-Yates): Dieselbe Person sieht überall und bei jedem gleich aus. Sie zählen bei „x schauen zu“ mit. Der Chat
  markiert ihre Zeilen (`bot`).
- **Sprechblasen:** Wer im Live-Chat schreibt, bekommt zusätzlich eine Pixel-Sprechblase über seiner Figur,
  `bubbleSeconds` (6) lang. Höchstens `bubblesAtOnce` (2) zugleich auf eigenen Höhen mit Stiel zum Sprecher; weitere
  warten, aber nicht länger als `bubbleMaxDelaySeconds` (12), danach steht die Zeile nur im Chat. Eine neue Zeile
  derselben Person ersetzt ihre Blase sofort. Alles folgt aus Chat und Serveruhr, also sehen alle dasselbe.
- **Spieler im Bild:** Geht es in einer Meldung um einen Spieler (Pleite, Gewinner, Klatsch, Skandal und Hype seiner
  Firma, Künstler eines NFTs), zeigt der Themenbildschirm hinter Mr. Doodle Dangle dessen Figur mit Bildunterschrift
  („Pleitegeier“, „Gewinner der Stunde“, „Gesucht“ auf Steckbrief-Papier, „Held der Stunde“, „Gesichtet“, „Künstler
  der Stunde“). Der Server liest das Aussehen beim Abruf (`player_figure_json`), es ist also immer das aktuelle;
  Spieler-IDs verlassen den Server nie.
- **Wiederverwendbar:** `src/components/ui/figure-bubble.tsx` (`SpeechBubble`, `FigureBubble`) für Figuren, die
  sprechen; `player_figure_json(p_player)` als gemeinsamer SQL-Baustein für das Aussehen eines Spielers.
- **Demo:** Der Demo-Spieler steht im Publikum, Online-Freunde aus `friendList` schauen mit und schreiben ab und zu,
  erfundene Zuschauer kommen dazu; in Meldungen über den Spieler steht seine Figur im Bild. Dabei behoben: Die
  erfundenen Zuschauer der Demo schrieben nie, weil ihre nächste Zeile stets in der Zukunft lag.

## ADR-158: Wohnwert und Vermieten – Mieter wohnen sichtbar im eigenen Grundstück — `Annahme`

- **Wohnwert (0–100):** reine Formel aus der Einrichtung (`src/lib/sim/rentals.ts`, gleiche Rechnung in
  `home_wohnwert()`). Sechs Teile: **Wert** 30 (Katalogpreise der aufgestellten Stücke gegen 20 % des Kaufpreises der
  Stufe; eine Villa braucht also viel mehr als eine Wohnung), **Vielfalt** 20 (verschiedene Kategorien, voll ab 7),
  **Füllung** 20 (Anteil der Bodenfläche unter Möbeln: voll zwischen 30 % und 55 %, darunter anteilig, darüber
  abnehmend bis 0 bei 85 %, denn Mieter brauchen Platz zum Laufen), **Ebenen** 10 (5 für einen Teppich, 5 für etwas
  auf einer Ablage), **Stil** 10 (Anteil der Stücke in der häufigsten Möbelstufe, voll erst ab 6 Stücken),
  **Boden** 10 (Laminat 0 bis Gold 10). Gezählt wird nur Aufgestelltes; der Makler-Rabatt ändert nichts. Der
  Raum-Editor zeigt den Wohnwert der gerade bearbeiteten Einrichtung live mit den Teilen und den drei Tipps, die am
  meisten bringen.
- **Kein zweites Grundstück:** Erwogen wurden zusätzliche Mietobjekte als Anlage. Das hieße mehrere Grundrisse, einen
  Editor je Objekt und ein Inventar je Objekt. Entschieden: Jeder Spieler behält **ein** Grundstück und vermietet
  darin **Plätze** (WG-Prinzip, der Besitzer wohnt weiter dort): Wohnung 1, Apartment 2, Haus 3, Villa 4,
  Luxusvilla 6. Ein Umzug nach oben bringt mehr Plätze; die Mietverhältnisse ziehen mit.
- **Angebot:** Ab dem Grundstücks-Level (8) mit eigener Bleibe. Der Besitzer wählt **pro Stunde** oder **pro Tag**
  und einen Preis je Platz. Richtmiete je Platz und Stunde bei Wohnwert 100: 30 € (Wohnung), 60 €, 150 €, 400 €,
  1.000 € (Luxusvilla). Die faire Miete steigt linear von 20 % der Richtmiete (Wohnwert 0) bis 100 % (Wohnwert 100).
  Erlaubt sind 5 % der Richtmiete (mindestens 1 €) bis 150 % der fairen Miete; ein Tag kostet 24 Stunden. Der Preis
  gilt für neue Mieter; laufende Verträge behalten ihren Preis. Das Angebot lässt sich schließen, laufende Verträge
  bleiben.
- **KI-Mieter:** zahlen aus dem Systemkonto der Haushalte (wie der Gegenpart beim Möbelkauf). Unter Wohnwert 25
  zieht niemand ein. Sonst würfelt der Server je freiem Platz alle 60 Minuten (beim Öffnen sofort):
  Chance = 60 % × Wohnwert/100 × (2 − Preis/fair), höchstens 100 %. Eine schöne, günstige Wohnung ist also sofort
  voll, eine teure, karge findet niemanden. KI-Mieter bleiben 1 bis 5 Tage (in ganzen Perioden) und ziehen aus,
  wenn der Wohnwert bei einer Zahlung unter 25 gefallen ist. Ihre Namen kommen aus einer festen Liste, ihr Aussehen
  (Porträt-Farben und bis zu drei Accessoires) folgt stabil aus dem Namen.
- **Zahlung:** im Voraus je Periode, sofort beim Einzug und danach zu jedem Periodenbeginn, als Ledger-Buchung vom
  Mieter (Spieler oder Haushalte) an den Besitzer (Art `rent`); ein offener Zwangskredit des Besitzers behält wie bei
  Lohn seinen Anteil ein. Der Job `rentals_run_due()` läuft jede Minute (pg_cron `nexa-rentals`) und holt
  verpasste Perioden nach.
- **Laufzeit:** mindestens 24 Stunden. Kündigen können Mieter und Besitzer jederzeit; der Vertrag endet am ersten
  Periodenende, das mindestens 12 Stunden entfernt ist und nach der Mindestlaufzeit liegt. Bezahlt ist immer bis
  dahin, erstattet wird nichts. Kann ein Spieler eine fällige Miete nicht zahlen, endet der Vertrag sofort.
- **Was Spieler-Mieter bekommen:** Sie **wohnen** dort: Ihre Grundstücksseite zeigt das gemietete Zuhause mit allen
  Mitbewohnern, ihr Profil „wohnt bei …“, und sie laufen dort als ihre angezogene Figur herum. Dazu
  **Wohlfühl-XP** je bezahlter Stunde: 5 Basis-XP × Wohnwert/100 (mit dem XP-Faktor bis 10 XP je Stunde). Möbel
  stellen dürfen sie nicht: Die Einrichtung bleibt Sache des Besitzers. Ein Spieler mietet höchstens einen Platz
  zur Zeit, nie im eigenen Zuhause; mieten geht auch ohne eigene Bleibe (günstiger Einstieg ab Level 8).
- **Sehen:** Im Zimmer (eigene Ansicht, Profil eines anderen, Mietmarkt) laufen alle Mieter als Pixelfiguren mit
  Namensschild von freiem Feld zu freiem Feld (nur Feldern ohne Möbel; Teppiche sind begehbar). Bewegung nur über
  `transform`, bei reduzierten Animationen stehen sie still an einem festen Platz.
- **Mietmarkt** (`/property/rentals`): offene Angebote anderer Spieler mit freiem Platz, nach Wohnwert sortiert,
  höchstens 30. Jede Karte zeigt das Zimmer mit seinen Bewohnern, Stufe, Wohnwert, Preis, freie Plätze und die Figur
  des Besitzers. Einmieten per Halten.
- **Meldungen:** Neuer Mieter (Besitzer), Mieter zieht aus und Vertrag beendet (beide Seiten, mit Grund), einmal am
  Tag die Mieteinnahmen des Vortags. Mietet ein Spieler eine Villa oder Luxusvilla, steht das im Freundes-Feed.
- **Missionen:** erstes Angebot und erster Mieter (Meilensteine), Wohnwert 60 und 90 (Meilensteine), Miete
  einnehmen (täglich, wöchentlich), zur Miete wohnen (Meilenstein). `mission_doable` verlangt dafür eine Bleibe bzw.
  ein freies Angebot.
- **Grenzen für 4 Spieler und viele KI-Mieter:** Plätze je Stufe (höchstens 6 je Zuhause), ein KI-Wurf je Angebot und
  Stunde, höchstens 30 Angebote im Mietmarkt, Zahlungen werden 30 Tage aufbewahrt. Konto zurücksetzen beendet alle
  Verträge des Spielers (als Mieter mit Nachricht an den Besitzer) und löscht Angebot und Mieter.
- **Demo:** Die Demo rechnet dieselben Formeln im Browser, würfelt beim Anschauen nach und bringt drei erfundene
  Vermieter mit eingerichteten Wohnungen für den Mietmarkt mit.

## ADR-159: Schwerere Missionen mit dem Level, Missionen für die neuen Funktionen — `akzeptiert`

- Gezählte Tages- und Wochenmissionen (und Schnellmissionen ab 2) skalieren ihr Ziel mit
  `1 + progression.missionCountScalePerLevel (0,04) × (Level − 1)`, höchstens `missionCountScaleMax` (3). Geldziele und
  XP behalten ihre eigene Skalierung (ADR-142). Ziele mit begrenzter Auswahl (`distinct`) skalieren nicht.
- Neue Metriken über Trigger, ohne RPCs umzuschreiben: `accessory_bought`, `accessory_legendary`, `accessory_worn`,
  `friend_poke`, `news_chat`, `company_chat`. `mission_doable` kennt ihre Voraussetzungen.
- 19 neue Vorlagen; neue Meilensteine stehen in der Kette hinter den bisherigen.

## ADR-160: News-Battles – Minispiele unter Zuschauern, eines gewinnt — `akzeptiert`

**Kontext:** Wer die NEXA Nachrichten offen hat, soll gegen die anderen Zuschauer antreten können: ab 3 bis
höchstens 10 Spieler, ein Minispiel, nur einer gewinnt, und der Gewinner bekommt etwas, das sich lohnt. Spieler
steuern ihre angezogene Pixelfigur (ADR-155) mit WASD, Pfeiltasten oder einem Joystick auf dem Handy.

**Entscheidung:**

- **Lobby auf dem News-Tab.** Wer die Seite offen hat, zählt als Zuschauer (`news_show_viewers`, auch über
  `get_battle`) und kann beitreten oder gehen. Ab `battles.minPlayers` (3) läuft ein Countdown
  (`countdownSeconds`, 30 s); bei `maxPlayers` (10) oder am Ende des Countdowns startet das Battle. Wer 15 s nicht mehr
  in der Lobby gesehen wurde, fliegt raus; fällt die Lobby unter 3, hält der Countdown an. Es gibt immer genau ein
  offenes oder laufendes Battle; ist es vorbei, öffnet die nächste Lobby. Battles laufen jederzeit, nicht nur während
  der Sendung. Mr. Doodle Dangle kommentiert in der Lobby und im Spiel und meldet Start und Sieger im Live-Chat der
  Sendung (`news_show_messages`, Texte in `battles.doodle`).
- **Server entscheidet:** Spiel (beim Start, nicht zweimal hintereinander dasselbe), Preis (beim Öffnen der Lobby,
  dort sichtbar), Zufallszahl `seed`, Startzeit. Ein Spieler ist in höchstens einem Battle.
- **Echtzeit-Spiele: deterministischer Lockstep mit Eingaben beim Server.** Alle Aktionsspiele sind reine
  Ganzzahl-Simulationen auf einem Kachelraster mit 20 Takten pro Sekunde (`src/lib/sim/battle`). Was zählt, sind nur
  die Eingaben: ein Zeichen pro Takt und Spieler (Richtung, Aktion). Jeder Client schickt seine Eingaben alle 250 ms an
  `battle_input` und bekommt die der anderen zurück; über Supabase Realtime (Broadcast-Kanal `battle:<id>`) gehen sie
  zusätzlich sofort an die Mitspieler, damit die Vorhersage stimmt. Ein Takt ist endgültig, sobald seine Frist
  (`graceMs`, 1 s nach dem Takt) vorbei ist; was bis dahin fehlt, gilt als „keine Eingabe“ (`x`). Eingaben lassen sich
  nicht nachträglich ändern, nicht für die Zukunft vorab senden und nicht mehr als 20 pro Sekunde abgeben. Den Sieger
  rechnet der Server aus: Dieselbe Simulation steht als PL/pgSQL in der Datenbank (`battle_sim_*`) und rechnet das
  Spiel aus allen Eingaben nach. Testvektoren mit gleichen Zufallseingaben prüfen TypeScript und SQL gegeneinander.
  Clients zeigen den letzten endgültigen Stand plus eine Vorhersage bis jetzt und rechnen sie in jedem Bild neu.
  - Warum so: Ein Server-Takt per RPC (jeder Zug ein Aufruf) wäre bei 10 Spielern mit 5 bis 20 Aufrufen pro Sekunde
    und Spieler zu träge und zu teuer, Edge Functions kann der Betreiber nicht ausrollen (ADR-037). Gemeldete Punkte
    oder Positionen ließen sich fälschen. Hier kann ein Betrüger höchstens gut spielen (ein Bot mit Menschentempo)
    und seine Eingaben bis zu 1 s nach den anderen wählen; für Spielgeld reicht das.
  - Wer 4 s lang keine Eingaben schickt (80 Takte `x` hintereinander) oder geht, scheidet aus. Bleibt nur einer übrig,
    gewinnt er sofort.
- **Quiz, Schätzen, Reaktion: vollständig auf dem Server.** Richtige Antworten, Lösungswerte und Glockenzeiten
  liegen nur in `battles.plan` (nie an den Client); Antworten zählen mit der Serverzeit, die erste zählt. Die
  Reaktionszeit misst der Server vom ersten Zeigen der Glocke an diesen Spieler bis zum Druck (inklusive Netz; ein
  Frühstart scheidet aus).
- **Spiele (9, je 30 bis 90 s, 3 bis 10 Spieler, ein Sieger):** Kurssturz (Boden aus Kerzen bricht in Wellen weg,
  Stillstehen lässt die Kachel reißen, Letzter gewinnt), Bullenreiten (Bullen stürmen über Reihen und Spalten,
  3 Herzen), Geldregen (Münzen und Goldbarren fangen, fallende Bären betäuben und kosten Münzen), Sumo am Parkett
  (rempeln, der Ring schrumpft), Giftaktie (heiße Kartoffel: wer sie beim Knall hält, fliegt), Aktie pumpen (Tippen
  nur bei Grün, Tippen im Crash kostet ein Viertel), Börsenquiz (2 Herzen, schnell und richtig zählt mehr), Schätz den
  Kurs (echte Kurse und Schätzfragen, am nächsten dran gewinnt), Die Glocke (Reaktionsduell, Frühstart raus, der
  Langsamste raus). Gleichstand entscheidet das Spiel selbst (Rempler, früher erreicht, Fehler); erst danach das Los
  aus dem `seed`.
- **Preise (`battles.prizes`):** dicke XP (`grant_xp`, Quelle `battle`), Geld von den Haushalten (Ledger, Art
  `battle_prize`), ein exklusives Accessoire, das es nur hier gibt (`battles.accessories`, `exclusive`, kein Preis;
  `buy_accessory` lehnt es mit `accessory_exclusive` ab; der Sieger bekommt eines, das er noch nicht hat), oder ein NFT
  aus der Galerie ohne Besitzer (in der Lobby reserviert; ist es weg, ein anderes, sonst Geld). XP und Geld wachsen
  mit der Spielerzahl. Höchstens `dailyPrizeCap` (3) Gewinne mit Preis pro Spieler und Tag; danach gibt es nur noch
  die Ehre. Benachrichtigung `battle_won`, Feed-Eintrag `battle_won`, Nachricht im Live-Chat.
- **Missionen:** Battle mitspielen, Battle gewinnen, 10 Battles gewinnen (`mission_event` aus den RPCs,
  Metriken `battle_join` und `battle_win`).
- **Demo:** Erfundene Gegner treten bei, spielen mit einfachen Bots (Schatten meiden, Münzen jagen, rempeln) und
  beantworten Quizfragen; der Demo-Modus kann jedes Spiel gezielt starten.
- **Nachtrag (Inhaber):** Pro voller Stunde startet genau `lobby.perHour` (1) Battle mit Preis nach der Sendung (zuerst 3, dann auf Wunsch 1). Danach öffnet bis zur nächsten vollen Stunde keine Lobby (`battles_started_this_hour`, Migration 4800). `get_battle()` liefert `played_this_hour`, `per_hour`, `next_round_at`.

**Nachtrag: zehn weitere Spiele (19 insgesamt).** Gleiches Fairness-Modell wie oben: Aktionsspiele als Ganzzahl-
Simulation im Lockstep mit SQL-Spiegel (`20261204004900_battle_sims_more.sql`, Testvektoren TS/SQL), Rundenspiele mit
geheimen Lösungen in `battles.plan` und Serverzeit (`20261204004910_more_battle_games.sql`). Jedes Spiel steht in
`battles.weights` (Auswahl wie bisher gewichtet, nie zweimal hintereinander), dauert 30 bis 90 s und hat einen Sieger.

- **Bärenjagd** (`bear`): Bären kommen nacheinander aus der Höhle in der Mitte und laufen auf den nächsten Spieler zu
  (die größere Entfernung zuerst, um Säulen und andere Bären herum; Gleichstand per Los aus dem `seed`). Wer erwischt
  wird oder mit dem Bären die Kachel tauscht, ist raus; der Bär frisst danach kurz. Bären werden schneller.
- **Dividenden-Dash** (`dash`): Münzen erscheinen auf freien Kacheln (Ort aus dem `seed`), wer zuerst draufsteht,
  kassiert; jede fünfte zählt doppelt. Mit Aktion in jemanden laufen ist ein Tackle (kurz betäubt, Abklingzeit). Wer
  zuerst 15 hat, gewinnt, sonst die meisten. Wollen mehrere dieselbe freie Kachel, bekommt sie der mit weniger
  Dividenden, dann das Los (`walkContested`): Ohne diese Regel blockieren sich vier Spieler um eine Münze für immer.
- **Margin Call** (`margin`): Grüne Felder leuchten auf freien Kacheln auf, dann kommt der Gong; wer nicht darauf
  steht, ist raus. Drei Aufwärmrunden mit Reservefeldern, danach eins weniger als Spieler, die Zeit bis zum Gong
  schrumpft. Schafft es niemand, fliegt niemand. Umkämpfte Kachel: Los. Gleichstand: wer näher dran war.
- **Fahrstuhl zum Mond** (`elevator`): Der Bildschirm klettert immer schneller einen Chart hinauf; jede dritte Reihe
  ist ein Kerzenbalken mit Lücken (weiter oben weniger). Wer unten aus dem Bild fällt, ist raus; danach zählt die
  Höhe.
- **Laserschranke** (`laser`): Strahlen fegen nach einer Warnung über Reihen und Spalten, manche mit Lücke.
  Ausweichen geht nicht, nur springen: ein neuer Druck auf Aktion, dann eine kurze Pause (Gedrückthalten springt
  nicht erneut). Drei Herzen.
- **Bullen-Rodeo** (`rodeo`): Der Bulle bockt für alle gleich in eine Richtung (aus dem `seed`); zählt nur ein
  neuer Druck im Fenster. Richtig gibt die restlichen Takte als Punkte, falsch oder zu spät kostet Halt, außer alle
  lagen daneben. Die Fenster schrumpfen.
- **Tresorknacker** (`vault`): Code aus drei verschiedenen Ziffern 1 bis 6, nur der Server kennt ihn. Jeder Versuch
  geht über `battle_answer` (`p_choice` = die Ziffern) in `battle_guesses`, die Antwort (an der richtigen Stelle /
  woanders) rechnet der Server. Höchstens 8 Versuche, nach dem Knacken keine mehr; Punkte nach Zeit und Versuchen.
- **Ticker-Tippen** (`ticker`): Firmenname, sechs Tickersymbole auf dem Laufband (gelistete Aktien, sonst
  `battles.tickers`); die erste Antwort zählt, falsch kostet Punkte.
- **Mehr oder Weniger** (`higher`): Chart mit Trends (eine Bewegung hält mit `trendPct` %), der Client sieht ihn nur
  bis zur aktuellen Kerze; höher oder tiefer, falsch kostet ein Herz (nicht wenn alle falsch liegen).
- **Wer bietet mehr?** (`auction`): Jeder hat 1.000 Taler Spielgeld; geheime Gebote, höchstens das Restgeld (prüft
  der Server). Das höchste Gebot (bei Gleichstand das frühere) bekommt die Punkte des Loses und zahlt; die meisten
  Punkte gewinnen, dann das meiste Restgeld. Gebote erst nach dem Zuschlag sichtbar.
- **Umsetzung:** Bestehende Funktionen werden per `replace` ergänzt (`battle_plan`, `battle_round_ms`,
  `battle_rounds_eval`, `battle_rounds_json`, `battle_answer`, `battle_is_tick`), damit parallele Änderungen daran
  erhalten bleiben; neu sind `battle_plan_more`, `battle_rounds_eval_more`, `battle_round_extra`,
  `battle_answer_more`. Werte in `battles.games.*`, Bots der Demo spielen alle zehn mit Können-Streuung.

## ADR-161: Wohnbonus, Möbelpreise nach Zuhause, Einrichtung im Wert, freie Mietpreise — `Annahme`

Wunsch: Wer wohnt, bekommt Bonus-XP und Bonus-Geld, mehr in größeren Wohnungen; die Einrichtung wird teurer, je größer
die Wohnung, und steigert ihren Wert; die Miete legt der Besitzer selbst fest.

- **Wohnbonus jede Stunde** (`src/lib/sim/living.ts`, gleiche Rechnung in `living_bonus_owner()`/`_tenant()`): Wer ein
  eigenes Zuhause hat oder zur Miete wohnt, bekommt Geld und XP. Voller Bonus des Besitzers bei Wohnwert 100 je
  Stunde: Wohnung 20 € und 3 Basis-XP, Apartment 50 € und 4, Haus 120 € und 6, Villa 300 € und 8, Luxusvilla 800 € und
  10 XP (mit dem Alpha-Faktor doppelt). Bei Wohnwert 0 gibt es 40 %, linear bis 100 % bei Wohnwert 100: Größe und
  Einrichtung zählen beide.
- **Mieter** bekommen 50 % des Bonus des Zuhauses, in dem sie wohnen, als Geld aber **höchstens ihre Miete je
  Stunde**. So lohnt Mieten für den Bonus allein nie, und ein Freundschaftspreis von 1 € bringt keinen Villa-Bonus
  auf Kosten der Haushalte. Die Wohlfühl-XP aus ADR-158 bleiben dazu.
- **Ein Bonus je Spieler und Stunde:** Wer ein eigenes Zuhause hat und woanders mietet, bekommt den besseren der beiden
  (mehr Geld, dann mehr XP, bei Gleichstand das eigene). Gezahlt wird nur an Spieler, die in den letzten 3 Tagen
  gespielt haben (`last_active_at`); so sammeln verlassene Konten nichts an, wie der Tresor mit seiner Kappe.
- **Auszahlung:** Job `living_bonus_run_due()` jede Minute (pg_cron `nexa-living-bonus`), bezahlt die laufende Stunde
  einmal je Spieler (`living_bonus_payments`, Primärschlüssel Spieler + Stundenbeginn), verpasste Stunden eines
  ausgefallenen Jobs werden nicht nachgeholt. Geld als Ledger-Buchung `living_bonus` von den Haushalten auf das Konto
  (haben die Haushalte zu wenig, nur XP); ein Zwangskredit behält wie bei Lohn und Miete seinen Anteil ein. XP über
  `grant_xp` mit der Quelle `home_living`. Ein eigener Job und kein Teil von `run_due_part`, damit Miete, Löhne und
  ihre Tests unberührt bleiben. Einmal am Tag eine Meldung „Wohnbonus gestern“ statt einer je Stunde.
- **Fairness:** Der Bonus läuft rund um die Uhr, Lohn höchstens 8 Stunden am Tag. Eine Wohnung bringt höchstens 480 €
  am Tag (weniger als ein Praktikantentag, 1.200 €), eine Luxusvilla 19.200 € (ein C-Level-Tag sind 20.000 €). Bezogen
  auf den Kaufpreis ist das 1,9 % (Wohnung) bis 0,13 % (Luxusvilla) am Tag: ein Bonus fürs Wohnen, keine Anlage, die
  die Miete (ADR-158) oder das Grundeinkommen (100 € je Stunde im Tresor) überholt.
- **Möbelpreise nach Zuhause:** Möbel kosten den Katalogpreis × Faktor des Zuhauses, in dem der Käufer beim Kauf wohnt:
  Wohnung (und ohne Bleibe) ×1, Apartment ×1,25, Haus ×1,5, Villa ×2, Luxusvilla ×3. Der Makler-Rabatt geht davon ab.
  Jedes Stück merkt sich diesen Listenpreis (`player_furniture.list_cents`, alte Stücke: Katalogpreis), der Wohnwert
  zählt ihn statt des Katalogpreises. Erwogen: eigene Möbellinien je Stufe (viel Pixel-Art, kein Mehrwert) und ein
  Faktor auf den Wohnwert nach dem aktuellen Zuhause (dann lohnte es, in der Wohnung billig zu kaufen und mitzunehmen).
  So misst der Wert-Teil des Wohnwerts weiter Geld gegen den Kaufpreis der Stufe, und wer billig vor dem Umzug kauft,
  spart Geld, bekommt aber weniger Wohnwert.
- **Einrichtung im Wert des Zuhauses:** Aufgestellte Möbel gehören zum Zuhause und zählen mit 60 % des bezahlten
  Preises (statt 40 % im Inventar) im Wert des Zuhauses, also im Vermögen und in der Reichenliste
  (`player_property_value_cents`). Der Wiederverkauf bleibt bei 40 %, der Umzug rechnet weiter nur das Zuhause an
  (Möbel ziehen mit). Die Grundstücksseite zeigt „davon Einrichtung“.
- **Freie Mietpreise:** Die Spanne aus ADR-158 (5 % der Richtmiete bis 150 % der fairen Miete) entfällt. Der Besitzer
  gibt den Preis je Platz frei ein, mindestens 1 € je Stunde (24 € je Tag), höchstens 100.000 € je Stunde als
  Sicherheitsgrenze. Die faire Miete bleibt als Hinweis und Schnellwahl (½, fair, 1,5×, 2×). KI-Mieter reagieren wie
  bisher: Chance × (2 − Preis/fair), ab dem doppelten fairen Preis zieht keiner mehr ein. Spieler sehen den Preis im
  Mietmarkt und entscheiden selbst; laufende Verträge behalten ihren Preis.
- **Sehen:** Grundstück: Karte „Wohnbonus: +X € und +Y XP pro Stunde“ mit dem, was ihn erhöht (Wohnwert 100, größeres
  Zuhause, eigenes statt gemietetes). Tresor: Einnahmequelle „Wohnbonus“. Möbelhaus: Preise für das eigene Zuhause
  mit dem Faktor.
- **Demo:** rechnet dieselben Formeln, zahlt beim Anschauen die laufende Stunde und holt verpasste Stunden bis zu
  3 Tage nach (wie der Server, der aktive Spieler auch offline bezahlt).

## ADR-162: Firmen-Gesundheit – acht Punkte, wo es fehlt, mit Mira angehen — `Annahme`

Wunsch: Bei Firmen soll immer grafisch zu sehen sein, wo es noch fehlt, damit man keinen Verlust macht (Bekanntheit,
Menge, Image …), acht sinnvolle Punkte, die man mit Mira angehen kann.

- **Rechnung** (`src/lib/sim/company-health.ts`, rein, getestet): `companyHealth(company, cfg, extras)` baut die letzte
  Betriebsstunde aus `MyCompany` nach (Nachfrage, Kapazität, Umsatz, Wareneinsatz, Löhne, Fixkosten, Marketing wie
  `closeStartupHour`) und zerlegt die Nachfrage in Bekanntheit, Qualität, Preis, Ereignis, Kampagne und Schwung. So
  lässt sich jeder Punkt einzeln „reparieren“ und die Stunde neu rechnen. Ohne erste Stunde dient die Mitte der
  Marktschätzung als Marktgröße (`estimated`). Kein Server-Feld nötig: Alles steht schon in `MyCompany`, im
  Aufgaben-Schwung (`CompanyTasks.momentum`) und im aktuellen Ereignis.
- **Die acht Punkte** (Wert 0–100, Status gut ≥ 80, ok ≥ 60, schwach ≥ 35, sonst kritisch; Grenzen in
  `companyHealth` der Balance):
  1. **Bekanntheit:** Nachfrage gegen Kapazität. Wert = Bekanntheit / nötige Bekanntheit, um die Kapazität zu füllen
     (höchstens die Grenze der Stufe). An der Grenze hilft nur die nächste Stufe.
  2. **Menge:** ausverkauft: Kapazität / Nachfrage, Fix = so viele KI-Kräfte, wie Plätze frei sind (sonst wachsen);
     Leerlauf: 1 − (Gewinn aus Auftragsarbeit oder Entlassen untätiger KI-Kräfte) / (Löhne + Fixkosten).
  3. **Qualität:** Qualität / Ziel (70 %); Premium unter 50 % Qualität ist kritisch.
  4. **Image:** Ruhe 85, laufende Kampagne 100, Krise 85 − 3 × größter Einbruch (Nachfrage, Kapazität oder Kosten,
     beim offenen Ereignis der volle drohende Effekt); eine offene Chance zeigt den möglichen Gewinn.
  5. **Preis:** die drei Preisstufen durchgerechnet; Wert = Rohertrag jetzt / Rohertrag der besten Stufe.
  6. **Team:** Minimum aus Lohnquote der Stunde und 40 + 60 × Anteil der abgedeckten Fähigkeiten der nächsten Stufe;
     Fix = nächste Stufe (Kapazität, Qualität, Grenze der Bekanntheit) gegen die Löhne der fehlenden Kräfte.
  7. **Kasse:** offene Rechnungen ≤ 25 (je nach verbleibenden Quartalen bis zur Insolvenz), bei Verlust Reichweite
     der Kasse gegen 48 h, knappe Reserve 70; Marketing an der Grenze der Stufe gilt als verpufft (Fix = Marketing 0).
  8. **Schwung:** 40 + 60 × (Schwung − 1) / (Ziel − 1), Ziel = halbes Maximum (+30 %).
- **Kosten eines Punktes:** `impactCents` = Gewinn der nachgerechneten Stunde mit behobenem Punkt minus Gewinn jetzt
  (ab 1 €/h). Der teuerste Punkt ist „Hier verlierst du am meisten“; kostet nichts Geld, der mit dem kleinsten Wert.
  Zusätzlich liefert jeder Punkt `levers`: konkrete Schritte (Marketing-Budget, Kampagne, Preis, Auftragsarbeit,
  KI-Kräfte einstellen/entlassen, Fähigkeit besetzen, schulen, ausbauen, Aufgaben, Krise, Einzahlung, Geschäftszug).
- **Grafik:** oben in der Übersicht immer sichtbar: Netzdiagramm mit acht Achsen (reines SVG, Tokens, Einblenden über
  `scale`/`opacity`), der schwächste Punkt markiert, darunter acht Balken mit Status-Farbe, Grund in Zahlen und
  möglichem Gewinn pro Stunde. Auf dem Mira-Tab eine kleine Fassung.
- **Mira:** Jeder Punkt hat „Mit Mira angehen“: Der Mira-Tab öffnet sich und die Frage („Wie steigere ich die
  Bekanntheit?“) geht wie getippt hinein. `healthTopic` erkennt solche Fragen, `healthTurn`/`healthSteps` antworten
  mit Grund, möglichem Gewinn und bis zu vier Knöpfen. Neue Mira-Aktionen nutzen nur bestehende RPCs
  (`setCompanyMarketing`, `setCompanyStrategy`, `startCampaign`, `hireAiWorkers`, `dismissAiWorker`), nur für die
  Gründerin. Ihr Briefing meldet den schwächsten Punkt von selbst, sobald er schwach oder kritisch ist (einmal je
  Punkt und Status), die Analyse nennt den Gesamtwert.
- **Grenzen:** Die Rechnung ist eine Momentaufnahme der letzten Stunde (mit deren Zufall), keine Prognose. Langfristige
  Effekte (Bekanntheit wächst über Quartale, Budget-Preise beschleunigen Mundpropaganda) zählen nicht in den Gewinn.

## ADR-163: Lebendigerer NFT-Markt — `akzeptiert`

- Bis zu `nfts.ai.maxOpenAiOffers` (3) verschiedene KI-Sammler dürfen gleichzeitig ein offenes Angebot auf dasselbe
  NFT haben; wer schon bietet, wird nicht noch einmal gewählt (`nft_free_collector`). Bisher war es eines pro NFT.
- Mehr Bewegung über die Konfiguration: Angebote auf behaltene NFTs 0,8 % → 4 % je Minute, auf zu teuer
  angebotene 8 % → 15 %; Handel unter Sammlern 0,6 % → 2,5 % je Minute (höchstens 40 %), Haltezeit 30 → 10 Minuten,
  6 Käufe je Lauf, 300 je Tag; KI kauft bis zu 60 Spieler-NFTs am Tag (vorher 20).

## ADR-164: Chats mit Freunden – Direktchats und Gruppen — `Annahme`

- **Wunsch:** Wer auf Freunde geht, soll mit Freunden schreiben und Gruppen mit mehreren Freunden gründen können.
- **Ort:** ein vierter Tab „Chats“ auf `/friends` (Liste links, Unterhaltung rechts ab `lg`; am Handy entweder Liste
  oder Unterhaltung). `/friends?tab=chats&chat=<id>` öffnet eine Unterhaltung direkt, auch aus der Benachrichtigung.
  Einstieg auch über 💬 an jeder Figur auf dem Freunde-Platz, in der Freundesliste und „Nachricht“ im Profil.
  Sichtbar ab Level 2 wie die Freunde (`DISCLOSURE.friendChats`).
- **Direktchats** nur zwischen angenommenen Freunden, einer je Paar (`friend_chats.direct_key`). Endet die
  Freundschaft, bleibt der Chat lesbar, aber Schreiben scheitert mit `chat_read_only` (NX158); die Oberfläche zeigt
  einen Hinweis statt des Eingabefelds. Ein geöffneter Direktchat ohne Nachricht erscheint nur bei dem, der ihn
  geöffnet hat.
- **Gruppen:** Name wie andere Namen gefiltert (getrimmt, einfache Leerzeichen, `social.chat.groupNameMinLength` bis
  `groupNameMaxLength` = 3 bis 30 Zeichen, keine Steuerzeichen, Schimpfwortfilter `text_has_profanity`), aber nicht
  eindeutig und ohne Reservierungen (anders als Firmennamen). `groupMinMembers` (2) bis `groupMaxMembers` (20)
  Mitglieder **einschließlich** des Gründers, höchstens `maxGroupsPerDay` (10) neue Gruppen am Tag. Der Gründer ist
  Admin. Jedes Mitglied darf **eigene** Freunde hinzufügen (die Freundschaft gilt zu dem, der hinzufügt, nicht zu allen);
  nur der Admin benennt um und nimmt Mitglieder heraus. Wer dazukommt, sieht die Nachrichten ab seinem Beitritt
  (`since_id`). Geht der Admin, wird das am längsten dabei gewesene Mitglied Admin; wer als Letzter geht, schließt die
  Gruppe (alles wird gelöscht). Beitritt, Umbenennen, Entfernen und Verlassen stehen als Systemzeilen im Chat.
- **Nachrichten:** höchstens `maxMessageLength` (300) Zeichen, `maxMessagesPerMinute` (12) je Spieler über alle Chats,
  Schimpfwortfilter wie im Firmenchat. Emojis wie im Nachrichten-Chat (`social.chat.emojis`).
- **Server-Autorität:** drei interne Tabellen ohne Rechte für Clients; alles über RPCs mit `request_id`.
  `mark_chat_read` hat wie `mark_notifications_read` keine `request_id`: es setzt nur die eigene Lesemarke und ist
  von Natur aus idempotent. Antworten enthalten Nicknames, Tags und Figuren, nie Spieler-IDs; Chat-IDs sind sichtbar.
  Fremde Chats und unbekannte IDs ergeben beide `chat_unknown` (NX157).
- **Live:** Die offene Unterhaltung fragt alle `pollOpenSeconds` (4) nach, Liste und Abzeichen alle
  `pollIdleSeconds` (30). Zusätzlich schickt der Client nach dem Senden über Supabase Realtime (Broadcast, wie die
  News-Battles) ein leeres „Neu!“ an `friend-chat:<id>`; wer den Chat offen hat, holt sofort nach. Der Ping trägt
  keinen Inhalt, Lesen läuft immer über `get_chat` mit Mitgliedsprüfung. Kein `postgres_changes` auf die
  Nachrichten-Tabelle, damit keine Spieler-IDs (`author_id`) an Clients gehen.
- **Benachrichtigung** `friend_chat` (abschaltbar, Push an): eine ungelesene je Chat und Empfänger, wie beim
  Firmenchat; `mark_chat_read` markiert sie als gelesen. Abzeichen mit der Zahl ungelesener Nachrichten am
  Freunde-Eintrag der Seitenleiste, im „Mehr“-Menü und am Tab „Chats“.
- **Missionen:** Metrik `friend_chat` über einen eigenen Trigger (`friend_chat_mission_events`), Schnellmission
  „Schreib einem Freund“ und Tagesmission „Schreib {target} Nachrichten an Freunde“; `mission_doable` verlangt einen
  Freund.
- **Konto zurücksetzen:** Direktchats des Spielers verschwinden ganz, aus Gruppen tritt er aus (neuer Admin folgt),
  seine eigenen Zeilen werden gelöscht.
- **Demo:** Die erfundenen Freunde (ADR-155) antworten mit 70 % Wahrscheinlichkeit (auf Fragen immer) nach 2 bis
  6 Sekunden mit einem kurzen, albernen Satz (`src/config/friend-chat.ts`); in neuen Gruppen meldet sich jemand.
- Fehler: `chat_unknown` NX157, `chat_read_only` NX158, `chat_not_admin` NX159, `chat_group_full` NX160,
  `chat_group_too_small` NX161, `chat_already_member` NX162; außerdem `not_friends`, `name_*`, `rate_limited`.

## ADR-165: Nexamon – Sammelkarten mit Boostern, Grading und Kartenmarkt — `Annahme`

- **Wunsch:** Sammelkarten wie im echten Leben: Booster ziehen, seltene Karten jagen, bei „ASP“ bewerten lassen und
  an einem Markt handeln, an dem Knappheit und Nachfrage den Wert bestimmen. Alles mit Spielgeld über das Ledger.
- **Freischaltung:** Level 10 (`progression.unlocks` Schlüssel `nexamon`, `DISCLOSURE.nexamon`); der Server prüft es
  bei jeder schreibenden Aktion (`nexamon_locked`).
- **Katalog:** drei Sets mit je 77 Karten (50 Common, 10 Rare, 10 Ultra Rare, 5 Prisma Illustration Rare,
  2 Legendary Illustration Rare) in `src/config/nexamon`. `pnpm db:config` schreibt Schlüssel, Set, Nummer,
  Seltenheit und Startpreis nach `game_config.nexamon_cards`, die Regeln (`src/config/nexamon-rules.ts`) nach
  `game_config.nexamon`. `nexamon_sync()` legt daraus `nexamon_cards` an und zieht Änderungen nach (idempotent, über
  einen Hash des Katalogs): Der Startpreis folgt immer dem Katalog, der Marktwert nur, solange er sich noch nie
  bewegt hat.
- **Booster:** „Nexamon: Mystic Energy“ 200 €, „Nexamon: Super Apex“ 1.000 €, „Nexamon: Prismatic Peak“ 10.000 €,
  je 5 Karten. Das Geld geht an die Haushalte (wie Accessoires), aus deren Topf auch die KI-Sammler zahlen.
  Höchstens 20 Booster je Spieler und Minute.
- **Ziehungsraten (exakt, Nenner 3600):** Platz 1 bis 3 immer Common. Platz 4 würfelt Ultra 150/3600 (1/24),
  Rare 900/3600 (1/4), sonst Common (2550/3600). Platz 5 würfelt Legendary 4/3600 (1/900), Prisma 45/3600 (1/80),
  Ultra 150/3600 (1/24), Rare 900/3600 (1/4), sonst Common (2501/3600). Im Erwartungswert je Booster also Rare 1/2,
  Ultra 1/12, Prisma 1/80, Legendary 1/900 und 3 bis 5 Commons, immer vorn. Innerhalb einer Seltenheit ist jede
  Karte des Sets gleich wahrscheinlich; die Commons eines Boosters sind verschieden. Liegt in Platz 4 etwas
  Besseres als in Platz 5, bleibt es so (Platz 5 ist der „Hit-Platz“, nicht sortiert).
- **Population:** Jede gezogene Karte (Spieler, KI, Startbestand der KI) erhöht die Population ihrer Karte um 1;
  jede Kopie trägt ihre Nummer („#17“). Die Population jeder Karte ist für alle sichtbar.
- **Zustand** jeder Kopie: Poor 2 %, Good 18 %, Near Mint 50 %, Mint 30 %. Ab Good ist die Kopie den Marktwert wert,
  jede Stufe unter Good kostet 5 % (Poor: 95 %). Geändert mit Migration 5900: Poor 70 %, Good 90 %, Near Mint und Mint 100 %. Es bleibt bei den vier genannten Stufen.
- **Marktwert:** einer je Karte (nicht je Kopie), geführt als Kurs (`value_e4` = Euro × 10 000), damit auch
  Karten für 1 € sich in kleinen Schritten bewegen. Wert einer Kopie in Cent = Marktwert × Zustandsfaktor, im Slab
  Marktwert × Notenfaktor; hier wird einmal gerundet (kaufmännisch „half even“). Der Marktwert bewegt sich auf zwei
  Wegen:
  1. **Verkäufe.** Ein Verkauf zählt nur, wenn sein Preis je Karte (Preis ÷ Zustands- oder Notenfaktor) höchstens
     25 % vom Marktwert entfernt ist. Dann wandert der Wert 20 % des Weges zum Preis, höchstens 2 % je Verkauf.
     Aufwärts wird mit der Beliebtheit der Karte skaliert (mindestens 25 %). Kauft ein KI-Sammler das Angebot eines
     Spielers (nur bis zum Marktwert), steigt der Wert um 0,5 % × Beliebtheit. Der Sofortverkauf an die KI senkt ihn
     um 0,25 % je Kopie.
  2. **Angebot gegen Nachfrage**, einmal je Stunde und Karte: Nachfrage (Kopien) = Wunschmenge × (popRef +
     Startbestand) ÷ (popRef + Population) + 0,5 × Käufe der letzten 7 Tage (höchstens 10). Angebot = Kopien, die zu
     einem plausiblen Preis (höchstens Wert + 25 %) angeboten werden. Druck = (Nachfrage − Angebot) ÷ Wunschmenge,
     zwischen −1 und +1. Der Wert steigt um Druck × 0,3 % × Beliebtheit oder fällt um Druck × 0,3 %. Die
     Wunschmenge ist das, was die KI zu Beginn anbietet (Common 4, Rare 3, Ultra 2, Prisma 1, Legendary 1): Eine
     neue Karte steht still. Wer die angebotenen Kopien aufkauft und hortet, verknappt das Angebot und treibt den
     Wert, aber spürbar nur bei beliebten Karten; wer viele Kopien einstellt, drückt ihn.
  - **Beliebtheit** (0 bis 100 %) = Seltenheit (Common 5 %, Rare 15 %, Ultra 40 %, Prisma 70 %, Legendary 90 %) +
    30 % × popRef ÷ (popRef + Population), mit popRef 2000 / 800 / 150 / 30 / 4. Seltene Karten mit kleiner
    Population sind am beliebtesten.
  - **Grenzen:** nie unter 20 % des Startpreises, nie über Startpreis × (3 + 0,02 je Tag seit dem ersten Zug +
    0,005 je gezähltem Verkauf), höchstens ×20. Je Berliner Tag höchstens +15 % und −20 % gegenüber dem ersten Wert
    des Tages.
- **Gegen Manipulation:** Absurde Angebote zählen weder als Angebot (über Wert + 25 %) noch als Verkauf (außerhalb
  des Bandes); die KI kauft sie nie. Zwischen denselben zwei Spielern zählt je Karte nur ein Verkauf in 24 Stunden,
  je Käufer und Karte höchstens 3 am Tag. Zwei Freunde können den Wert so höchstens um 2 % am Tag schieben und
  zahlen dafür jedes Mal 5 % Gebühr; dazu kommen Tagesgrenze und Deckel. Wer die erste Legendary zieht
  (Population 1), sieht den Wert langsam steigen (höchstens bis zum Deckel), bis die KI nachzieht.
- **KI-Verkäufer** (Karten-Kalle, Booster-Berta, Holo-Hanna, Sammel-Sven): besitzen zum Start je Karte 6 Commons,
  4 Rares, 2 Ultras, je Set nur von den zwei günstigsten Prismas eine Kopie und **keine** Legendary. Sie bieten je
  Karte höchstens 4 / 3 / 2 / 1 / 0 Kopien gleichzeitig an, immer zu Wert der Kopie + 10 % (die Preise folgen dem
  Marktwert); der Rest wartet im Bestand. Die KI öffnet selbst Booster (Mystic Energy 4, Super Apex 2, Prismatic
  Peak 1 je Stunde, ohne Buchung, weil Haushalte an Haushalte zahlen würden); ihre Karten erhöhen die Population und
  gehen in ihren Bestand. Legendarys behält sie; je Stunde und Karte geht mit 0,2 % eine davon in den Verkauf.
- **KI-Sammler kaufen** Angebote von Spielern nur bis zum Wert der Kopie (Slabs bis 70 % des Slab-Werts), mit 3 %
  × (1 + Beliebtheit) je Minute, höchstens 2 / 3 / 3 / 2 / 1 Kopien je Karte in 7 Tagen und je Set und Tag höchstens
  für 300 Booster-Preise. Bezahlt wird aus dem Haushaltstopf; die Kopie geht in den KI-Bestand.
- **Sofortverkauf:** Rohe Commons und Rares gehen auf Wunsch sofort für 50 % ihres Werts an die KI (bis zu 50
  Kopien je Aufruf), damit niemand hundert Massenkarten einzeln einstellen muss. Bessere Karten gehen über den Markt.
- **Markt:** einzelne Kopien zum frei gewählten Preis (0,10 € bis 1 Mrd. €), höchstens 30 offene Angebote und 30
  Ein-/Ausstellungen je Minute. Der Verkäufer zahlt 5 % Gebühr an die Haushalte; der Erlös eines KI-Verkäufers geht
  ganz dorthin. Kaufen prüft den gesehenen Preis (`nexamon_price_changed`).
- **Grading bei ASP:** kostet 50 % des aktuellen Werts der Kopie (mindestens 1 €, an die Haushalte) und dauert eine
  Stunde Echtzeit; höchstens 10 Kopien gleichzeitig. Die Note 1 bis 10 wird am Ende gewürfelt. Verteilung in
  Basispunkten (Note 1 bis 10): Poor 500/1000/1500/2000/2000/1500/1000/400/90/10, Good
  0/0/0/500/800/1200/2000/2500/2000/1000, Near Mint 0/0/0/0/0/100/400/1000/2500/6000, Mint
  0/0/0/0/0/0/0/200/800/9000. Eine 10 gibt es also bei Good zu 10 %, Near Mint zu 60 %, Mint zu 90 %, Poor zu 0,1 %
  (der Eigentümer schrieb zweimal „Near Mint 90 %“; das zweite meint Mint). Notenfaktoren: 1 bis 10 =
  0,3 / 0,4 / 0,5 / 0,6 / 0,7 / 0,8 / 0,9 / 1,2 / 1,6 / 3. Mit 8 bis 10 ist die Karte immer mehr wert als
  vorher, darunter weniger. Slabs werden mit ihrer Note gehandelt; es bleibt bei einem Marktwert je Karte.
  **Slab aufbrechen** gibt die rohe Karte mit ihrem Zustand zurück, ohne Erstattung; sie darf erneut zu ASP.
- **Tabellen** (alle intern, RLS ohne Policies): `nexamon_cards`, `nexamon_copies`, `nexamon_listings`,
  `nexamon_sales`, `nexamon_packs`, `nexamon_value_points`, `nexamon_set_state`, `nexamon_meta`.
- **RPCs:** `get_nexamon`, `buy_nexamon_pack`, `get_nexamon_collection`, `get_nexamon_card`, `get_nexamon_market`,
  `list_nexamon_card`, `unlist_nexamon_card`, `buy_nexamon_listing`, `sell_nexamon_to_ai`, `grade_nexamon_card`,
  `crack_nexamon_slab`; Job `nexamon_run_due()` jede Minute (fertige Gradings, KI-Booster, KI-Käufe, KI-Angebote,
  Wertlauf). Fertige Gradings werden auch beim Lesen des Spielers abgeschlossen, damit die Stunde ohne Cron stimmt.
- **Drumherum:** Benachrichtigungen `nexamon_sale` und `nexamon_graded`, Feed `nexamon_pull` für eine Legendary (auch
  als Klatsch in den NEXA Nachrichten), Missionen (erster Booster, 10 Booster, erste Rare, erste Ultra, erster
  Verkauf, erste 10). Konto zurücksetzen: Angebote enden, laufende Gradings verfallen, die Kopien gehen an die KI
  (die Population bleibt wahr).
- **Demo:** dieselben Regeln aus `src/lib/sim/nexamon.ts` (`src/features/game/demo/nexamon.ts`), mit einem
  Spieler und den KI-Verkäufern. Zeit vergeht beim Benutzen: fällige Gradings, KI-Booster, KI-Käufe und der
  stündliche Wertschritt werden bei jedem Aufruf nachgeholt. Der KI-Bestand ist dort auf 12 Kopien je Karte
  begrenzt (die Population zählt trotzdem jeden Zug), und die KI bietet in der Demo nie eine Legendary an.
- **KI und Slabs:** Kauft die KI einen Slab, liegt er in ihrem Bestand und kommt wie jede andere Kopie wieder in
  den Verkauf, sobald ein Angebotsplatz der Karte frei ist (dann zum Slab-Wert + 10 %).
- Fehler: `nexamon_locked` NX163, `nexamon_unknown` NX164, `nexamon_not_owner` NX165, `nexamon_listed` NX166,
  `nexamon_not_listed` NX167, `nexamon_price_changed` NX168, `nexamon_listing_limit` NX169, `nexamon_grading`
  NX170, `nexamon_not_raw` NX171, `nexamon_not_graded` NX172, `nexamon_not_sellable` NX173, `nexamon_own_listing`
  NX174, `nexamon_grading_limit` NX175; außerdem
  `insufficient_funds`, `rate_limited`, `invalid_argument`.
- **Nachtrag Preise:** Prismatic Peak kostet 10.000 € statt 5.000 €; dafür sind alle Karten dieses Sets das
  1,5-Fache wert (Startpreise im Katalog, Set-Faktor 37,5). Migration `20261204005500_nexamon_peak_prices.sql`
  (gleich in `supabase/updates/`) hebt in einer bestehenden Datenbank einmalig Startpreis, Marktwert,
  Tagesreferenz und Wertverlauf der Karten dieses Sets um das 1,5-Fache und zieht die KI-Angebote nach, weil
  `nexamon_sync()` den Marktwert bewegter Karten nicht anfasst (Marke `nexamon_meta.peak_scaled_at`). Angebote von
  Spielern behalten ihren Preis.
- **Offen (Balancing):** Die Startpreise machen Booster im Erwartungswert teurer oder billiger als ihren Inhalt, je
  nach Katalog; gebremst wird über die begrenzte KI-Nachfrage und fallende Werte bei wachsendem Angebot. KI-Budget,
  Booster-Takt der KI und Notenfaktoren sind die Stellschrauben.

## ADR-166: Bezahlbare Missionen und einmal am Tag neu würfeln — `Annahme`

Wunsch des Owners: Missionen sperren oft aus, weil sie mit dem aktuellen Geld kaum zu schaffen sind oder man erst
eine KI-Kraft feuern müsste, um wieder eine einzustellen. Missionen soll man einmal an einem echten Tag neu würfeln
können.

- **Bezahlbar (`mission_affordable`, von `mission_doable` zuerst gefragt, ADR-154):** Schnelle, tägliche und
  wöchentliche Missionen werden nur verteilt, wenn das Geld dafür da ist. **Meilensteine sind Sparziele** und bleiben,
  wie weit sie auch weg sind (ein verfallener Meilenstein käme nie wieder). Werte in `progression.missionAfford`.
- **Geldziele werden gekappt statt gestrichen (`mission_money_cap`):** Das gewürfelte, mit dem Level skalierte Ziel
  wird bei der Zuteilung auf volle Euro gekappt. Erst wenn die Kappe unter dem Mindestziel läge, gibt es die Mission
  gar nicht.

  | Metrik                                           | Bezug                       | Kappe                                                   | Mindestziel                  |
  | ------------------------------------------------ | --------------------------- | ------------------------------------------------------- | ---------------------------- |
  | `buy_value` (ein Kauf für X, auch „großer Kauf“) | Bargeld                     | 50 % (`buyShareBps`)                                    | 20 € (`minBuyTargetCents`)   |
  | `trade_value` (Handelsvolumen)                   | Bargeld + offene Positionen | schnell 50 %, Tag 100 %, Woche 300 % (`volumeShareBps`) | 20 €                         |
  | `realized_profit` mit Geldziel                   | Bargeld + offene Positionen | schnell 1 %, Tag 2 %, Woche 10 % (`profitShareBps`)     | 5 € (`minProfitTargetCents`) |

  Volumen und Gewinn richten sich nach allem, was sich handeln lässt: Wer voll investiert ist, kann verkaufen.
  Beispiel: Level 10, 300 € Bargeld, „Kaufe für 1.400 €“ wird zu „Kaufe für 150 €“; mit 30 € gibt es sie nicht.

- **Käufe: das Billigste muss bezahlbar sein.** Gezählt wird das Mindestziel der Vorlage; bei Wochenmissionen nur
  die Hälfte (`weeklyCountShareBps`), der Rest lässt sich in der Woche verdienen.

  | Metrik                                                                                                                                                                 | Regel                                                                                                                 |
  | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
  | `buy`, `buy_sector`, `bond_bought`, `sectors_bought`                                                                                                                   | mindestens 10 € Bargeld (`minCashCents`); Bruchteile machen jedes Papier bezahlbar                                    |
  | `company_deposit`                                                                                                                                                      | mindestens 10 € Bargeld                                                                                               |
  | `accessory_bought`                                                                                                                                                     | die n billigsten Teile, die man noch nicht hat und tragen darf, kosten zusammen höchstens das Bargeld                 |
  | `furniture_bought`                                                                                                                                                     | n × billigstes Möbel zum eigenen Preis (Zuhause-Stufe, Makler-Rabatt)                                                 |
  | `art_bid`, `art_won`                                                                                                                                                   | eine offene, fremde Auktion, deren Mindestgebot das Bargeld deckt                                                     |
  | `nft_bought`                                                                                                                                                           | ein gelistetes NFT oder eine Auktion in Reichweite des Bargelds                                                       |
  | `nft_offer`                                                                                                                                                            | Bargeld ≥ Mindestangebot (`nfts.minOfferCents`)                                                                       |
  | `ai_worker_hired`                                                                                                                                                      | keine offenen Löhne, und die Firmenkasse deckt die Löhne aller KI-Kräfte samt der neuen für 6 Stunden (`aiWageHours`) |
  | `move_started`, `move_success`                                                                                                                                         | n × billigster Geschäftszug aus der Firmenkasse                                                                       |
  | `job_posted`, `task_delegated`, `task_*`, `battle_*`, Chats, Stupser, Tresor, Likes, `sell`, `trade`, `distinct_security`, `skill_learned`, `check_in`, `work_hours` … | kostet nichts: keine Geldprüfung                                                                                      |
  | `home_bought`, `home_upgraded`, `home_rented`, `car_bought`, `accessory_legendary`, `art_painted`, `net_worth`, `art_collection_value`                                 | nur Meilensteine: Sparziele, keine Geldprüfung                                                                        |
  | `rent_earned`, `nft_royalty`, `art_sold`, `profitable_hour`                                                                                                            | Einnahmen, kein Kauf: keine Geldprüfung (strukturelle Regeln aus ADR-154/158 gelten weiter)                           |

  Nexamon-Packs haben noch keine Missionsvorlage.

- **Nie erst feuern:** Einstell-Missionen verlangen wie bisher einen freien Platz (ADR-154) und jetzt zusätzlich eine
  Firma, die sich die Kraft leisten kann.
- **Schnelle Missionen ohne Fortschritt**, die unbezahlbar geworden sind, verfallen bei der nächsten Zuteilung und
  machen Platz (wie in ADR-154). Tägliche und wöchentliche bleiben stehen; dafür gibt es das Würfeln.
- **Neu würfeln (`reset_missions(p_request_id)`):** ersetzt alle **offenen** schnellen, täglichen und wöchentlichen
  Missionen durch neue, auch solche mit Teilfortschritt (der Client fragt vorher nach). Erledigte, noch nicht abgeholte
  Missionen und alle Meilensteine bleiben. `progression.missionResetsPerDay` (1) Mal je Berliner Kalendertag, gezählt in
  `mission_resets`. Ist nichts offen, kommt `mission_reset_nothing` und der Versuch ist nicht verbraucht.
- **Nicht gleich dieselben:** Getauschte Zeilen bekommen `player_missions.reset_at`, zählen nicht mehr für die
  Tages- und Wochenplätze und ihre Vorlage ruht 20 Stunden. Danach darf sie wiederkommen (dieselbe Zeile wird frisch
  vergeben), damit die Wochenmissionen bei täglichem Würfeln nicht ausgehen.
- **Antwort:** `get_my_missions` und `reset_missions` liefern dieselbe Form, dazu `reset_available` und
  `next_reset_at` (nächste Mitternacht in Berlin, sobald verbraucht); `reset_missions` zusätzlich `replaced`.
- **Oberfläche:** Karte „Passt gerade nichts?“ über den Missionen mit „Missionen neu würfeln“, Nachfrage im Sheet,
  Lade- und Erfolgszustand, Ton, Hinweis „Heute schon gewürfelt. Morgen wieder, in …“ mit Countdown.
- **Demo:** dieselbe Regel (einmal je Berliner Tag, getauschte Vorlagen ruhen bis zum nächsten Tag). Die Demo-Ziele
  stehen fest im Titel und werden darum nicht gekappt: Zu große Geldmissionen werden nicht angeboten
  (`affordableFor`).
- Fehler: `mission_reset_used` NX176, `mission_reset_nothing` NX177.

## ADR-167: Börsennotierte Spielerfirmen – Forschung, Mitarbeiterzufriedenheit, Ruf, Geschäftsrat, Buchhaltung und Steuern — `Annahme`

Wunsch: Sobald eine Firma an der Börse ist, soll sie viel tiefer und realistischer werden: viel mehr Ausgaben und Wege
zu wachsen (damit Kapital von außen Sinn ergibt), ein Ruf, der unter gierigen Gründern leidet, Mitarbeiterzufriedenheit,
die Geld kostet, ein Geschäftsrat der Großaktionäre, Buchhaltung und Steuern mit Finanzamt. **Alles hier gilt nur,
solange `companies.phase = 'listed'`**; private Firmen bleiben so einfach wie bisher (jede Funktion liefert für sie den
neutralen Wert, jede RPC den Fehler `not_listed`). Regeln rein in `src/lib/sim/listed.ts` (getestet), dieselben in
PL/pgSQL (`listed_*`), alle Werte in `src/config/listed.ts` → `game_config.listed`.

### 1. Betriebsstunde bleibt die Basis

Die Stunde (`closeStartupHour`, `player_company_close_hour`) bekommt für notierte Firmen sechs Terme und einen
Kostenblock, sonst ändert sich nichts:

- Bekanntheit der Stunde = min(1, Bekanntheit + `awarenessAdd`), Qualität der Stunde = Qualität + `qualityAdd` (0…1);
  beide wirken auch auf die Preisregel (Premium braucht Qualität).
- Nachfrage × `demandFactor` = (1 + Nachfrage-Effekte) × (1 + Markt-Effekte) × Ruf-Faktor.
- Kapazität × `capacityFactor` = max(0,1; 1 + Kapazitäts-Effekte) × Stimmungs-Faktor.
- Wareneinsatz × `cogsFactor` = max(0,5; 1 − Margen-Effekte), Fixkosten × `fixedFactor` = max(0,5; 1 + Fixkosten-Effekte).
- Laufende Kosten (Produkte, Regionen, Maschinen, Zukäufe, Lizenzen, Benefits, Steuerberater) werden nach den
  Fixkosten aus der Kasse an die Haushalte gebucht, je Kategorie eine Buchung (`company_costs`, `metadata.cat`), und
  zählen in `fixed_cents` und damit in den Gewinn der Stunde. Reicht die Kasse für einen Posten nicht, **pausiert** er
  (keine Wirkung, keine Schulden) und läuft weiter, sobald er wieder bezahlt wird.
- So bleiben `player_company_hours`, die Firmen-Gesundheit (ADR-162) und alle Zahlen der Firmenseite erklärbar:
  Umsatz − Wareneinsatz − Löhne − Fixkosten − Marketing = Gewinn.

**Größe der Firma:** Preise folgen dem Referenzumsatz = Durchschnittsumsatz je Stunde der letzten 24 Betriebsstunden,
mindestens 200 €. Einmalpreis = max(Mindestpreis, `costHours` × Referenzumsatz) × `costGrowth`^Stufe (+ Betrag je Kopf),
laufend = `upkeepBps` des Referenzumsatzes je Stufe und Stunde (+ Betrag je Kopf und Stunde). Kleine Garagen-AGs zahlen
die Mindestpreise, große Firmen entsprechend mehr; die Wirkungen sind Prozente und wachsen mit.

### 2. Mehr Ausgaben, mehr Wege zu wachsen (66 Posten, ein Mechanismus)

Ein Katalog (`listed.items`), eine Tabelle (`company_investments`), eine RPC (`company_invest`). Jeder Posten hat
Art, Zweck (für Budgets des Geschäftsrats), Preis, Dauer, Voraussetzungen, laufende Kosten und Wirkung:

| Art                            | Posten                                                                                                                                                                                        | Preis (Stunden Referenzumsatz / Minimum)                             | Dauer            | Wirkung                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------ |
| Forschung, 7 Zweige × 4 Stufen | Qualität, Effizienz, Marke, Automatisierung, Logistik, Nachhaltigkeit, Finanzen                                                                                                               | 6 h / 1.000 € · 18 h / 5.000 € · 48 h / 25.000 € · 120 h / 150.000 € | 1 · 3 · 8 · 24 h | dauerhaft, keine laufenden Kosten; Stufe 4 braucht Stufe 2 eines Nachbarzweigs |
| Produkte (6)                   | Zweitprodukt, Sparlinie, Premium-Linie, Abo, Fanartikel, Großkunden-Lösung                                                                                                                    | 8–80 h / 2.000–60.000 €                                              | 2–16 h           | Nachfrage +4 % … +30 %, laufend 1–5 % des Referenzumsatzes; einstellbar        |
| Regionen (5)                   | Süddeutschland → DACH → Europa → Nordamerika → Asien                                                                                                                                          | 20–200 h / 6.000–300.000 €                                           | 4–36 h           | Markt +10 % … +50 %, laufend 2–6 %                                             |
| Maschinen (3, mehrstufig)      | Maschinenpark (5), Rechenzentrum (3), Showroom (3)                                                                                                                                            | 10–14 h, × 1,6–1,8 je Stufe                                          | 2–3 h            | Kapazität, Marge, Bekanntheit je Stufe                                         |
| Zukäufe (3)                    | Kleinhirn KI, Datenkrake GmbH, Robo-Butze                                                                                                                                                     | 90–130 h / 80.000–120.000 €                                          | 6–8 h            | Kapazität +10 %, Nachfrage +15 %, Marge +6 %                                   |
| Lizenzen (3)                   | Patent, Marke, Export (Voraussetzung für Europa)                                                                                                                                              | 10–15 h                                                              | 1–2 h            | Qualität +5 Punkte, Nachfrage +6 %                                             |
| Benefits (14)                  | Obstkorb, Kaffeeflatrate, Tischkicker, Bürohund, Massagesessel, Jobrad, Fitnessstudio, Homeoffice, Weiterbildung, Feelgood-Manager, Betriebsrente, Betriebskita, Bonusprogramm, Viertagewoche | 0–5.000 € einmalig                                                   | sofort           | Zufriedenheit +2 … +10, laufend 0,10–9 € je Kopf und Stunde                    |
| Aktionen (4)                   | Pizza für alle, Teamevent, Firmenfeier, Sonderbonus                                                                                                                                           | 50–1.000 € + 15–500 € je Kopf                                        | sofort           | Zufriedenheit springt um 3 … 15, Wartezeit 6–72 h                              |

Forschungs-Wirkungen je Zweig (Summe aller vier Stufen): Qualität +28 Punkte und Nachfrage +4 %; Effizienz Marge
+18 %, Kapazität +5 %; Marke Bekanntheit +15 Punkte, Nachfrage +8 %; Automatisierung Kapazität +45 %, Marge +3 %;
Logistik Kapazität +3 %, Marge +3 %, Markt +15 %, Fixkosten −5 %; Nachhaltigkeit Ruf +13, Zufriedenheit +3, Marge +1 %,
Nachfrage +5 %; Finanzen Steuersatz −4 Punkte, Fixkosten −3 %, Marge +3 %. Ein kompletter Zweig kostet mindestens
181.000 €, bei 5.000 € Umsatz je Stunde 960.000 €: Das ist der Grund für Kapitalerhöhungen.

Einstellen (`company_invest_stop`): Produkte, Regionen, Lizenzen und Benefits können beendet werden (kein Geld zurück;
ein gestrichener Benefit kostet sofort so viele Zufriedenheitspunkte, wie er brachte). Forschung, Maschinen und Zukäufe
bleiben.

### 3. Ruf: Wer sich immer selbst auszahlt, verliert Kunden

`listed_companies.reputation` (0–100, Start 50) wandert jede Stunde 8 % des Abstands zu einem Ziel:

- Ziel = 50 + Forschung (Nachhaltigkeit) − **Gier** + **Reinvestition** + **Dividenden** − Skandal (5).
- Gier: Auszahlungsquote = (CEO-Auszahlungen + Entnahmen der letzten 24 h) / max(Gewinn der letzten 24 h, 5 % des
  Umsatzes). Bis 30 % frei, darüber linear bis −35 Punkte bei 100 %.
- Reinvestition: einmalige Investitionen (Abschnitt 2) der letzten 24 h / Gewinn; +12 Punkte ab 50 %.
- Dividenden: Ausschüttungen der letzten 24 h / Gewinn; +12 Punkte ab 20 %, dazu +1 je Tag in Folge mit Dividende
  (höchstens +6).
- Wirkung: Nachfrage × (1 + 0,20 × (Ruf − 50) / 50), also −20 % … +20 %; der faire Aktienkurs (`fair_value_e4`)
  × (1 + 0,25 × (Ruf − 50) / 50), stündlich und beim Quartalsabschluss. Strafen des Finanzamts senken den Ruf
  einmalig um 3 / 6 / 8 Punkte.
- Beispiel: Wer dauerhaft 50 % auszahlt, landet bei Ruf 40 (Nachfrage −4 %); wer alles auszahlt, bei 15 (−14 %) und
  die Zufriedenheit sinkt um weitere 10 Punkte. Wer 20 % als Dividende ausschüttet und investiert, kommt auf 74+
  (Nachfrage +10 %).

**Dividenden** (`company_declare_dividend`, neu): Der Gründer (oder ein Beschluss des Geschäftsrats) schüttet einen
Gesamtbetrag aus der freien Kasse aus, höchstens einmal je Berliner Tag und höchstens 50 % der freien Kasse. Jeder
Spieler mit Aktien bekommt Betrag × eigene Aktien / alle Aktien (abgerundet, Buchung `dividend` Firmenkasse →
Spielerkonto), der Rest steht dem KI-Streubesitz zu und geht an das Systemkonto `market`. Der Gründer bekommt seinen
Anteil wie jeder Aktionär.

### 4. Mitarbeiterzufriedenheit

`listed_companies.satisfaction` (0–100, Start 60: die erste Stunde nach dem Börsengang ist neutral), jede Stunde 15 % des Abstands zum Ziel, Verlauf in
`listed_company_hours`:

- Ziel = **50** (Basis, also unter Grün: ohne Ausgaben sinkt sie dorthin) + Benefits (höchstens +40) − unbezahlte
  Löhne (bis −25 mit dem Lohnfaktor) − Lohnkürzung durch Krise oder Kurssturz (bis −10, ADR-131) − Überlast (ab 95 %
  Auslastung linear bis −12 bei 150 %) oder Leerlauf (unter 35 %: −4) − Krise (4 je Schwere, Skandal +6) −
  Entlassungen (3 je entlassener KI-Kraft oder gekündigtem Spieler, höchstens 15, verblasst 8 % je Stunde) − Gier
  (bis −10, wie beim Ruf) + Erfolg (Gewinnstunde +3, Verluststunde −3).
- Zonen: **grün ab 60**, gelb 35–60, **rot unter 35**. Unter Grün sinken Kapazität (bis −30 % bei 0) und Qualität
  (bis −15 Punkte bei 0) linear; von 60 bis 90 gibt es bis zu +6 % Kapazität.
- Im roten Bereich kündigt alle 3 Stunden eine KI-Kraft von selbst (zählt nicht als Entlassung). Angestellte Spieler
  werden nicht hinausgeworfen, sie bekommen höchstens einmal am Tag eine Benachrichtigung „Stimmung im Keller“. Ab 3
  Kündigungen an einem Tag gibt es die Meldung „Kündigungswelle“.
- Beispiel: Gewinnstunde (+3) + Obstkorb, Kaffee, Homeoffice (+11) = 64, grün. Bei 20 Köpfen kostet das 38 € je
  Stunde (bei 2.400 € Löhnen).

### 5. Geschäftsrat

- **Einberufen** (`board_propose`): jeder Spieler mit **mehr als 20 %** aller Aktien der Firma (der Gründer mit
  seinem eigenen Paket zählt genauso). Höchstens 2 offene Anträge je Firma, 6 Stunden Pause je Antragsteller.
- **Antragsarten:** `earmark` (Betrag der Firmenkasse für einen Zweck reservieren: Forschung, Produkte, Ausbau,
  Benefits, Marketing; höchstens 80 % der Kasse), `release` (Budget wieder freigeben), `dividend` (Gesamtbetrag
  ausschütten), `payout_cap` (CEO-Auszahlung für N Tage auf X % deckeln), `withdraw_ban` (Entnahmen N Tage verbieten),
  `price_level` (Preisstrategie N Tage festlegen), `debt` (offene Steuern und Rechnungen bis zu einem Betrag sofort
  begleichen). N höchstens 7 Tage.
- **Abstimmung** (`board_vote`): 12 Stunden, nach Aktien. Stimmberechtigt ist jeder Spieler mit Aktien; es zählt der
  Bestand beim Auszählen. Der Antragsteller stimmt automatisch zu. Der **KI-Streubesitz enthält sich**, außer der
  Ruf ist unter 40: Dann stimmt er bei `payout_cap`, `withdraw_ban` und `dividend` mit Ja (Aktionärsschutz gegen
  gierige Gründer). Beschlussfähig ab 30 % aller Aktien an abgegebenen Stimmen, angenommen bei mehr Ja als Nein.
  Hat eine Seite mehr als die Hälfte aller Aktien, endet die Abstimmung sofort.
- **Bindend:** Reserviertes Geld (`company_budgets`) zählt nicht zur freien Kasse: `company_withdraw`, die
  automatische CEO-Auszahlung, Gewinnanteile stiller Teilhaber und Dividenden können es nicht anfassen, und
  `company_invest` darf für einen Posten nur das Budget seines Zwecks und die freie Kasse nutzen (Budget zuerst;
  laufende Benefit-Kosten zehren zuerst das Benefit-Budget auf). Löhne, Wareneinsatz, Fixkosten und Steuern gehen
  vor: Sinkt die Kasse unter die Reserve, schrumpft, was vom Budget noch ausgegeben werden kann. Der Deckel wirkt in
  `set_founder_payout` (Fehler `payout_capped`) und in der Stunde, das Verbot in `company_withdraw`
  (`withdraw_blocked`), die Preisbindung in `set_company_strategy` (`strategy_locked`).
- Benachrichtigung `board` an alle Aktionäre bei Antrag und Ergebnis; Verlauf der Anträge in `get_company_board`.
  Ein Beschluss gegen die Stimme (oder ohne die Stimme) des Gründers erscheint als „Aufstand im Geschäftsrat“ im Feed.

### 6. Buchhaltung und Steuern

- **Kontobuch** (`get_company_accounting`): alle echten Buchungen des Firmenkontos, in Kategorien: Umsatz,
  Wareneinsatz, Löhne, Fixkosten, Forschung, Produkte, Ausbau, Benefits, Steuerberater, Sonstiges (betrieblich) sowie
  Kapital, Auszahlung, Dividende, Steuer, Strafe, Umbuchung (nicht betrieblich); Tagessummen und Einzelposten.
- **Bücher machen** (`company_books_close`): einmal je Berliner Tag, sobald seit dem letzten Abschluss Umsatz
  gebucht wurde. Die Periode reicht vom letzten Abschluss bis jetzt. Der Server zeigt die Aufstellung und drei Belege
  (z. B. „Rechnung Obstkorb“), der Spieler ordnet jeden einer Kategorie zu. Alle drei richtig: 5 % Rabatt auf die
  Steuer („saubere Bücher“); Fehler kosten nichts außer dem Rabatt. Ein Klick, 20 Sekunden.
- **Körperschaftsteuer:** 15 % (Forschung senkt bis 11 %, nie unter 8 %) auf den **betrieblichen Gewinn der
  Periode nach Verlustvortrag**. Investitionen aus Abschnitt 2 sind Betriebsausgaben und mindern die Steuer;
  Auszahlungen, Dividenden, Steuern und Strafen nicht. Fällig binnen 24 Stunden (`company_tax_pay`, auf Wunsch gleich
  beim Abschluss), Buchung `tax` an die Staatskasse (`treasury`).
- **Finanzamt** (stündlich): 30 h nach Beginn einer Periode mit Umsatz Erinnerung; nach 42 h Verspätungszuschlag
  (0,5 % des Umsatzes der Periode, mindestens 50 €, Ruf −3); nach 60 h **Schätzung**: Das Finanzamt macht die Bücher
  selbst, setzt mindestens 25 % Marge an, ignoriert den Verlustvortrag, schlägt 25 % auf die Steuer auf, Ruf −6, und
  schickt eine **Betriebsprüfung** (Firmen-Ereignis `tax_audit`, Krise, ADR-091). Steuer nicht bezahlt: nach der
  Frist 5 % Säumniszuschlag, nach weiteren 24 h Vollstreckung (10 % Zuschlag, Einzug aus der Kasse, soweit vorhanden,
  Ruf −8, Betriebsprüfung). Alle Strafen als `fine` an die Staatskasse.
- **Steuerberater** (`company_tax_advisor`): kostet je Stunde max(40 €, 1 % des Referenzumsatzes), macht die Bücher
  täglich von selbst, zahlt die Steuer sofort (soweit die freie Kasse reicht) und holt 8 % Rabatt heraus. Angestellte
  Spieler als Buchhalter sind nicht umgesetzt (offener Punkt).
- **Fair:** Beispiel 5.000 € Umsatz und 1.000 € Gewinn je Stunde: 24.000 € Tagesgewinn → 3.600 € Steuer (3.420 € mit
  sauberen Büchern), 15 % des Gewinns. Eine 25.000-€-Forschung an dem Tag: Gewinn 0, keine Steuer, 1.000 €
  Verlustvortrag. Wer zwei Tage nichts macht, zahlt etwa 600 € Zuschlag; nach 60 h bei 20 % echter Marge rund ein
  Drittel mehr Steuer plus Zuschlag. Nie ruinös, aber spürbar.

### 7. Rundherum

- **Mira** (`brain.ts`, `listedBriefings`): erinnert an offene Bücher, fällige Steuern, schlechte Stimmung, offene
  Abstimmungen, fertige Forschung und gierige Auszahlungen; Aktionen Bücher öffnen, Steuer zahlen, günstigsten Benefit
  buchen, Aktion starten, Tab öffnen.
- **Missionen:** 26 neue Vorlagen (Voraussetzung `listed`), Metriken `research_started`, `research_done`,
  `product_launched`, `region_opened`, `benefit_added`, `team_action`, `satisfaction_green` (Stunden im grünen
  Bereich), `dividend_paid`, `dividend_cents`, `books_done`, `books_streak`, `tax_paid`, `board_motion`, `board_vote`,
  `audit_survived`, `listed_invested`.
- **Nachrichten:** Feed-Arten `tax_penalty`, `tax_audit`, `greedy_founder`, `mass_quit`, `record_dividend`,
  `board_revolt`, `research_done` mit Texten in `feed_item_label`; die ersten sechs stehen in der Klatsch-Quelle von
  `news_show_build` (die ersten vier als „schlechte“ Nachricht).
- **Auflösung und Konto zurücksetzen:** Vor der Auflösung zahlt die Firma offene Steuern aus der Kasse, offene Anträge
  enden, Budgets verfallen; die Tabellen hängen an `companies`/`profiles` (`on delete cascade`).
- **Demo:** dieselben Regeln lokal (`demo/listed.ts`), der Geschäftsrat mit einem erfundenen Großaktionär.
- **Fehler:** `not_listed` NX190, `item_unknown` NX191, `item_locked` NX192, `item_running` NX193, `budget_reserved`
  NX194, `withdraw_blocked` NX195, `payout_capped` NX196, `strategy_locked` NX197, `books_nothing` NX198,
  `tax_nothing_due` NX199, `dividend_limit` NX200, `board_no_right` NX201, `board_motion_unknown` NX202, `board_limit`
  NX203, `board_not_shareholder` NX204.

### Bewusste Vereinfachungen

- Reserviert statt eigenes Konto: Budgets sind Vormerkungen auf der Firmenkasse, kein zweites Ledger-Konto. Vorteil:
  Firmenwert, Auflösung und alle bestehenden Buchungen bleiben unverändert.
- Produkte sind generische Linien mit eigener Nachfrage, keine zweite Simulation mit eigenem Markt.
- Die Quartalsregeln (Wachstum der Bekanntheit, Qualitätsziel) bleiben unberührt; Effekte wirken in der Stunde.
- Stimmrecht nach aktuellem Bestand beim Auszählen, kein Stichtag; Leerverkäufe und Hebel zählen nicht.

## ADR-168: Firmen-Fehlerbehebungen – robuste Stundenabrechnung, sichtbare Timer, echte Fehlertexte — `Annahme`

- **Anlass:** Meldungen vom Live-Server (GmbH): „Wo es fehlt“ zeigt falsche Werte, Ausbau trotz GmbH gesperrt, Banner
  lässt sich nicht setzen, „die erste Betriebsstunde läuft“ ohne Ende, keine Cooldowns an Geschäftszügen, kein Timer
  an Kampagnen.
- **Befund am lokalen Postgres (voller Stand und älterer Stand + `update-to-latest.sql`, Funktionen identisch):**
  `upgrade_company` → `can_expand`/`expand_company`, `set_company_strategy`, `set_company_banner` mit 1, 6, 7 und 16
  Farben und der Stundenabschluss arbeiten korrekt, auch für eine zur GmbH umgewandelte Firma; die Zod-Schemas nehmen
  die Antworten an. Diese drei Meldungen ließen sich nicht nachstellen. Nachstellbar sind die Folgen einer
  ausbleibenden Stundenabrechnung: Ohne Zeile in `player_company_hours` (Zeilen älter als sieben Tage werden gelöscht)
  ist `live` im Client `null`; dann steht dauerhaft „Die erste Betriebsstunde läuft“ und „Wo es fehlt“ rechnet mit
  Schätzwerten aus der Markt-Spanne, die um Größenordnungen neben den echten Stundenwerten liegen können.
- **Schwachstellen im Server, die genau das auslösen:** (1) `player_companies_run_due()` schloss alle Firmen in
  einer Transaktion ab; ein Fehler bei einer einzigen Firma (Löhne, Beteiligungen, Ereignisse, Missionen …) rollte die
  Abrechnung aller Firmen zurück, jede Minute aufs Neue. (2) Der Quartalsbericht einer Firma wartete auf den
  Quartalsabschluss des Marktes (`run_due_part('core')`); hing dieser, blieben alle Firmen an der Quartalsgrenze
  stehen. (3) Ein Rückstau nach einem Ausfall wurde in einem Lauf nachgeholt und konnte in den Statement-Timeout laufen.
- **Entscheidung (Migration 5300):** Subtransaktion je Firma mit Vermerk in `job_runs` (`company_hours`), Bericht
  ohne Abhängigkeit vom Markt-Quartal, älteste Firmen zuerst und höchstens 600 Stunden je Lauf.
  `company_expansion_cost_cents` ist gedeckelt (vorher `bigint out of range` ab Stufe 47, was jede COMPANY-Antwort
  sprengte). `company_moves_state` liefert `rest_minutes`.
- **Client:** Geschäftszüge zeigen „Wieder möglich in mm:ss“ als eigene Fläche mit Balken, die Pause vorab („Danach
  n Min. Pause“) und am Knopf; Kampagnen zeigen „Läuft noch hh:mm:ss“ mit Balken, dazu eine Zeile über den
  Abteilungen. Timer rechnen gegen die Serverzeit (`clockSkewMs` aus dem Markt-Snapshot, ab einer Minute Abweichung),
  damit eine falsch gehende Geräteuhr keine Pause versteckt. Ohne abgerechnete Stunde bei einer Firma, die älter als
  zwei Stunden ist, steht „Die Stundenabrechnung steht aus“ statt der ersten Betriebsstunde; „Wo es fehlt“ nennt
  Schätzwerte oben als solche. Unbekannte Serverfehler zeigen ihren Text („Der Server meldet: …“) statt eines
  Hinweises auf die Verbindung (`GameError.detail`).
- **Offen:** Die Ursache auf dem Live-Server ist ohne Zugriff nicht belegt. Nach dem Einspielen zeigt
  `select * from job_runs where job_name = 'company_hours'` eine hakende Firma samt Fehlertext; Banner- oder
  Ausbau-Fehler nennen dem Spieler jetzt den Grund.
- Tests: `supabase/tests/a1_company_fixes.sql`, Fixtures `get_my_company_gmbh_upgraded`, `set_company_banner_16_colours`,
  `start_company_move_resting`, `api.test.ts`, `routes.test.ts`, `server-clock.test.ts`, E2E für beide Timer.

- **Oberfläche:** eine Seite `/nexamon` mit vier Reitern (Shop, Sammlung, Markt, ASP), die in der Adresse stehen
  (`?tab=`, am Markt zusätzlich `?view=mine` und `?card=<Schlüssel>`), und eine eigene Seite je Karte
  `/nexamon/<Schlüssel>` zum Verlinken (Sammlung, Markt, Feed). In der Navigation heißt der Eintrag „Collectibles“
  (unter „Besitz“, im Handy unter „Mehr“); vor Level 10 zeigt die Seite einen Ausblick (`DISCLOSURE.nexamon`,
  `<Reveal>`).
  - **Shop:** zuerst die Booster der drei Sets, jedes mit eigenem Motiv, Alufolien-Glanz und Riffelnaht oben und
    unten; sie kippen in 3D zum Zeiger (`TiltPack`, mit „Reduziert“ flach). Dazu Preis, eigener Fortschritt
    (x von 77) und geöffnete Booster; darunter die Ziehungsraten für Platz 4 und 5 als Tabelle direkt aus
    `nexamonSlotOdds` und die Zustands-Chancen.
  - **Booster-Fenster:** Ein Klick auf ein Booster öffnet ein Fenster (Handy: ganzer Bildschirm). Oben stehen Preis
    und Guthaben, darunter alle 77 Karten des Sets nach Seltenheit mit der Ziehungsrate je Seltenheit und den
    eigenen Karten in Farbe. **Bezahlt wird nur mit dem Knopf „Kaufen · Preis“**, nie durch eine Geste: Eine
    Wischbewegung darf kein Geld kosten, und der Server bucht ohnehin vor dem Ziehen. Erst danach liegt das Booster
    zum Aufreißen da.
  - **Aufreißen:** oben an der gestrichelten Linie drücken und quer ziehen; der Streifen hebt sich mit dem Finger,
    die Folie knistert, nach 70 % der Breite ist er ab (`tearProgress`), vorher fällt er zurück. Für Tastatur und
    wer nicht ziehen kann gibt es „Ohne Ziehen aufreißen“; mit „Reduziert“ entfällt die Show. Das Ergebnis liegt bis
    zur Übersicht im `localStorage` (`nexa-nexamon-pending-pack`), damit ein geschlossenes Fenster oder ein Neuladen
    nur die Animation unterbricht („Ungeöffnetes Booster“ im Shop). „Überspringen“ zeigt die Übersicht sofort,
    „Noch eins · Preis“ ist der nächste ausdrückliche Kauf.
  - **Töne** (8-Bit, `pnpm sounds`, folgen der Ton-Einstellung): `packCrinkle` beim Ziehen, `packTear` beim Abriss,
    `cardFlick` für jede weggezogene Karte, `cardShow` für eine Common und steigend `pullRare`, `pullUltra`,
    `pullPrisma`, `pullLegendary`.
  - **Sammlung:** alle 231 Karten in Nummernfolge, fehlende grau; eine Kachel zeigt die beste eigene Kopie, im Slab
    als Slab, mit Zähler bei Doppelten. Filter (Set, Seltenheit, Meine/Fehlt/Doppelt) und Sortierung laufen im
    Client über die eine Antwort von `get_nexamon_collection`.
  - **Karte:** kippbare Karte (Handy Faktor 4, PC Faktor 5), Wert mit Verlauf im vorhandenen `PriceChart`,
    Population, Slabs je Note, eigene Kopien mit ihren Aktionen. Jede Aktion erklärt vorher im Sheet, was sie
    kostet und bringt: Verkaufspreis mit Gebühr und Erlös (Vorschlag ist der Wert), Sofortverkauf mit den 50 %,
    Grading mit Gebühr, Dauer und der Chancentabelle des Zustands, Aufbrechen mit dem Hinweis „keine Erstattung“.
  - **Markt:** Filter, Sortierung und Seiten rechnet der Server; die eigenen Angebote kommen aus der Sammlung.
    Kaufen bestätigt den gesehenen Preis; bei `nexamon_price_changed` oder `nexamon_not_listed` schließt das Fenster
    mit einem Hinweis, und die Liste wird neu gelesen.
  - **ASP-Schalter:** laufende Gradings mit Countdown, zurückgekehrte Slabs liegen verdeckt, bis man sie aufdeckt
    (einmal je Slab, gemerkt im `localStorage`; Ton nach Note, Konfetti bei einer 10, mit „Reduziert“ nur
    Überblenden). Als Verlauf dienen die eigenen Slabs: Eine Liste vergangener Gradings liefert der Server nicht.
  - **Kartentext:** Name und Attacke enden vor der Zahl rechts daneben. Zu lange Texte werden erst gestaucht (bis
    68 %), dann kleiner gesetzt; die Breiten der Pixelschrift stehen dafür als Tabelle in
    `src/features/nexamon/lib.ts`, ein Test prüft alle 231 Karten.
  - **Benachrichtigungen** tragen vom Server alle den Link `/nexamon`; der Client führt `nexamon_graded` zum
    ASP-Schalter und `nexamon_sale` zu den eigenen Angeboten. Der Feed-Eintrag `nexamon_pull` verlinkt die Karte.
