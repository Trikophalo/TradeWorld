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
- **Grading bei ASP:** kostet 30 % (anfangs 50 %) des aktuellen Werts der Kopie (mindestens 1 €, an die Haushalte) und dauert eine
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
- **Nachtrag Profil und Inventar:** Wunsch des Eigentümers: „Collectibles sollen auch in deinem Inventar sein, wenn
  du sie nicht verkaufen willst, und du kannst sehen, was andere Spieler für Collectibles haben.“ Ein
  übergreifendes Inventar gibt es im Spiel nicht; der Ort für Besitz ist das Profil (wie NFTs und Zuhause).
  `get_player_nexamon(p_nickname, p_limit)` (Migration `20261204005800_nexamon_profile.sql`) liefert dafür die
  Sammlung eines Spielers in Zahlen (Karten, Motive von 231, Wert, Slabs, Zehner), den Stand je Set und je Karte
  die beste Kopie (die wertvollste) mit Anzahl, nach Wert sortiert, höchstens `p_limit` (1 bis 500). Sichtbar
  für jeden angemeldeten Spieler, wie `get_collection` und `get_property` (Profile sind öffentlich; nur
  Investments sind Freunden vorbehalten). Angebote, verlangte Preise und laufende Gradings bleiben privat. Wer
  Nexamon noch nicht freigeschaltet hat, zeigt nichts; ansehen darf man fremde Sammlungen auch unter Level 10, die
  Kartenseiten öffnen sich aber erst ab dann. Auf dem Profil: Abschnitt „Collectibles“ mit den acht wertvollsten
  Karten (Slabs als Slabs) und „Ganze Sammlung ansehen“ (Sheet, je Set, nur lesen); auf dem eigenen Profil dazu
  der Weg zur Sammlung. Der Sammlungs-Tab heißt innen „Deine Sammlung“, sagt, wie viele Karten bleiben und wie
  viele zum Verkauf stehen, und filtert danach. Missionen mit „nexamon“ im Schlüssel führen nach `/nexamon`
  (`src/features/progression/mission-routes.ts`, die erste Zuordnung von Missionen zu Seiten). Demo: erfundene
  Freunde ab Level 10 haben eine feste, aus dem Namen gewürfelte Sammlung, die nur auf dem Profil existiert.
  **Nicht umgesetzt:** Kartenwerte zählen nicht zum Vermögen und zur Rangliste. Das wäre kein kleiner Eingriff
  (`player_net_worth_cents`, `rich_list_entries`, Vermögensverlauf, Demo) und Kartenwerte lassen sich in Grenzen
  bewegen; das braucht eine eigene Entscheidung.
- **Nachtrag Überraschung, Markt-Marke, gemerkte Filter:** (1) Die Benachrichtigung `nexamon_graded` (in der App und
  als Push) verrät die Note nicht mehr: „Paket von ASP“ / „Das versiegelte Paket wartet darauf, dass du es öffnest.“,
  ohne `grade` und `black_label` im Payload (Migration `20261204005960_nexamon_graded_quiet.sql` ersetzt
  `nexamon_finish_gradings()`; die Demo ebenso). Der Feed-Eintrag `nexamon_black_label` (Freunde, Klatsch in den NEXA
  Nachrichten) entfällt beim Abschluss des Gradings: Ob das Paket geöffnet ist, weiß nur das Gerät (`useRevealedSlabs`,
  localStorage), der Server nicht. Ihn erst nach dem Öffnen zu posten, bräuchte ein RPC „Paket geöffnet“; bis dahin
  gibt es keinen Black-Label-Eintrag (Beschriftung und Klatsch-Quelle bleiben bestehen). (2) Kopien im Markt tragen
  im Binder die Marke „Im Markt“ (Preis beim Drüberfahren) und auf der Kartenseite „Im Markt · Preis“. (3) Filter
  von Binder (Set, Seltenheit, Besitz, Sortierung, Verkauf) und Markt (Set, Seltenheit, Verkäufer, Slab, Sortierung)
  und der letzte Tab bleiben je Browser erhalten (`nexa-nexamon-filters` im localStorage, nach der Hydration gelesen,
  unbekannte Werte fallen auf den Standard zurück); ein Tab in der Adresse geht vor.
- **Nachtrag Black Label:** Über der ASP 10 gibt es eine elfte Stufe, das Black Label (Wunsch des Besitzers: „über
  ASP 10, nur 1 % aller Karten, nur im Mint-Zustand, Kartenwert mal 10“).
  - **Regel** (`grading.blackLabel = {condition: "mint", chanceBps: 100, valueBps: 100_000}`): Nur eine Kopie im
    Zustand Mint kann es bekommen, und zwar 1 % ihrer Gradings. Die Chance wird aus der Chance auf eine 10
    herausgenommen (Mint: 1 % Black Label, 89 % 10, 8 % 9, 2 % 8); alle anderen Zustände haben 0 %. Der Slab ist den
    Marktwert der Karte × 10 wert, eine normale 10 bleibt bei × 3. Es bleibt bei **einem** Wurf: Das Black Label
    belegt die obersten 100 von 10 000 Zahlen des Mint-Wurfs (`nexamonRollGrade`, `nexamon_roll_grade`).
  - **Modell:** eine elfte Note, `grade = 11`, keine eigene Spalte. Angezeigt wird „ASP 10 · Black Label“ (auf dem
    Label steht eine 10). So versteht alles, was die Note schon trägt, das Black Label ohne Umbau: Wert der Kopie,
    Angebote, Verkäufe (`nexamon_sales.grade = 11`, Faktor 100 000), KI-Sammler (höchstens 70 % des Slab-Werts wie
    bei jedem Slab), Sofortverkauf (kein Slab), Aufbrechen (`old_grade` 11) und Konto-Reset (der Slab geht mit
    seinem Label an die KI-Händler). Die Tabelle `gradeWeightsBps` und `valueBps` behalten ihre zehn Einträge,
    bestehende Slabs sind unberührt. Verworfen: ein Flag `black_label` neben der Note 10; es hätte jede Stelle, die
    den Wert aus Zustand und Note rechnet, um einen Parameter erweitert.
  - **Server** (Migration `20261204005850_nexamon_black_label.sql`): Prüfung `grade between 1 and 11`,
    `nexamon_roll_grade`, `nexamon_copy_factor_bps`, `nexamon_finish_gradings` (eigener Benachrichtigungstext
    „Black Label!“, Missions-Ereignisse `nexamon_ten` und `nexamon_black_label`, Feed `nexamon_black_label`),
    `get_nexamon_card` liefert `black_labels` neben `graded` (das seine zehn Einträge behält),
    `get_nexamon_market` bekommt den Filter `p_black_label`. Ein Black Label ist Neuigkeit wie ein legendärer Zug:
    Feed der Freunde und Klatsch in NEXA Nachrichten (`feed_item_label`, Liste in `news_show_build`). Neue
    Meilenstein-Mission `m_nexamon_first_black_label` (3.000 XP).
  - **Oberfläche:** schwarzes Label mit silberner Schrift und dem Wort „BLACK LABEL“ (`composeSlab`, Stufe
    `black`), schwarzer Chip (Tokens `--black-label`, `--on-black-label`, `--black-label-edge`, in beiden Themes
    gleich), Zeile in der Chancentabelle des Grading-Sheets (bei Nicht-Mint 0 % mit Hinweis) und auf der
    Kartenseite, eigener Zähler in „Bewertete Kopien je Note“, Marktfilter „Black Label“, deutliche Warnung beim
    Aufbrechen.
  - **Balancing:** Der erwartete Faktor einer Mint-Karte steigt von 2,85 auf 2,92 (0,01 × 10 + 0,89 × 3 + 0,08 ×
    1,6 + 0,02 × 1,2). Weil nur 30 % der Züge Mint sind und nicht jede Karte zu ASP geht, bekommen deutlich weniger
    als 0,3 % aller gezogenen Karten ein Black Label.
- **Nachtrag ASP-Paket und Enthüllung:** Eine bewertete Karte kommt in einem versiegelten Paket zurück (eigenes
  ASP-Design aus dem Pack-Raster, `composeGradingPack`). Der Spieler reißt es wie ein Booster auf (Ziehen, Knopf
  oder Tastatur), dann wird die Note langsam enthüllt (`GradeReveal`): Der Slab steigt mit verdecktem Label auf,
  ein Trommelwirbel läuft, die Note zählt von 1 hoch, mit Pausen, die nach oben länger werden
  (`gradeStepPauseMs`), dann fällt die Abdeckung. Je Ergebnis ein eigener Schluss: unter 8 leise, 8–9 ein
  Glockenklang, 10 Fanfare mit Konfetti und Goldblitz, Black Label mit Verdunkelung, Stempel, weißem Blitz und
  doppeltem Konfetti. Sechs neue Töne (`gradeDrum`, `gradeTick`, `gradeLow`, `gradeGood`, `gradeTen`,
  `blackLabel`). „Überspringen“ springt zum Ergebnis; mit reduzierter Bewegung blendet das Ergebnis nur ein. Nur
  `transform` und `opacity`. Die Note steht längst auf dem Server fest; die Enthüllung ist reine Anzeige. Ob ein
  Paket geöffnet wurde, merkt sich das Gerät wie bisher (`useRevealedSlabs`), erst beim Ergebnis: Wer vorher
  schließt, findet das Paket wieder versiegelt vor. „Alle ohne Show öffnen“ bleibt als Abkürzung.
- **Nachtrag Kartenwert im Booster-Fenster:** In „Das kann drin sein“ zeigt jede Karte bei Hover, Fokus oder Tipp
  Name, Seltenheit und aktuellen Marktwert (aus der ohnehin geladenen Sammlung). Dafür gibt es den neuen Baustein
  `Tooltip` (`src/components/ui/tooltip.tsx`, Radix Tooltip); einen gemeinsamen Tooltip gab es vorher nicht.
- **Nachtrag halbe Noten, seltenere 10, KI-Sammler zum Marktwert, Karten umdrehen beim Öffnen** (Wunsch des
  Besitzers; Migrationen `20261204006000_nexamon_half_grades.sql`, `20261204006010_nexamon_ai_collectors.sql`):
  - **Halbe Noten:** ASP vergibt jetzt 1 bis 8, 8,5, 9, 9,5 und 10 (`grading.grades`, zwölf Stufen), darüber das
    Black Label (11). Gespeichert wird die Note als Zahl in `nexamon_copies.grade` und `nexamon_sales.grade`, jetzt
    `double precision` statt `smallint` (Postgres-`numeric` ist in Tabellen per Strukturtest verboten; 8,5 und 9,5
    sind binär exakt). Alte Slabs bleiben gültig (ganze Noten, 11 = Black Label), keine Datenmigration nötig. Die
    Tabellen `gradeWeightsBps` und `valueBps` haben zwölf Einträge in der Reihenfolge von `grades`;
    `get_nexamon_card.graded` ebenso (zwölf Zähler, Black Labels weiter in `black_labels`). Neue SQL-Funktion
    `nexamon_roll_asp_grade` ersetzt `nexamon_roll_grade` (deren Rückgabetyp `integer` sich nicht ändern ließ, ohne
    dass die idempotenten Kopien älterer Migrationen beim erneuten Einspielen scheitern); `nexamon_grade_index`,
    `nexamon_grade_text` („9,5“). Für die Missionen zählt nur eine echte 10 oder ein Black Label als 10.
  - **Seltenere 10, Black Label auch für Near Mint** (Chance in %, Zeilen summieren je auf 100 %):

    | Note       | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 8,5 | 9   | 9,5  | 10   | BL  |
    | ---------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---- | ---- | --- |
    | Mint       | –   | –   | –   | –   | –   | –   | 5   | 12  | 18  | 30  | 20   | 10   | 5   |
    | Near Mint  | –   | –   | –   | –   | –   | 5   | 12  | 22  | 24  | 24  | 9,5  | 2,5  | 1   |
    | Good       | –   | –   | –   | 7,5 | 12  | 20  | 25  | 17  | 10  | 6   | 2    | 0,5  | –   |
    | Poor       | 8   | 12  | 15  | 20  | 20  | 15  | 7   | 2   | 0,5 | 0,3 | 0,15 | 0,05 | –   |
    | Wertfaktor | 0,3 | 0,4 | 0,5 | 0,6 | 0,7 | 0,8 | 0,9 | 1,2 | 1,4 | 1,7 | 2,3  | 4    | 10  |

    Abweichungen vom ersten Vorschlag: Poor Note 1 hat 8 % statt 7,95 % (sonst ergibt die Zeile nur 99,95 %).
    Das Black Label (vom Besitzer nachgereicht: Mint 5 %, Near Mint 1 %) geht aus der 10 und der 9,5 ab: Mint 10 %
    statt 12 %, 9,5 20 % statt 22 %; Near Mint 10 2,5 % statt 3 %, 9,5 9,5 % statt 10 %.

  - **Gebühr 40 %** (statt 30 %) des Werts der Kopie. Erwarteter Faktor nach dem Grading (gegen den Marktwert der
    Karte) und abzüglich Gebühr: Mint 2,311 − 0,4 = 1,91 (roh 1,0); Near Mint 1,5745 − 0,4 = 1,17 (roh 1,0); Good
    1,026 − 0,36 = 0,67 (roh 0,9); Poor 0,632 − 0,28 = 0,35 (roh 0,7). Im Schnitt lohnt sich Mint deutlich, Near Mint
    knapp, Good und Poor nicht. Es bleibt ein Glücksspiel: Eine Mint-Karte verliert in 17 % der Fälle Geld (8 oder 7),
    eine 8,5 ist genau die Gebühr wert, den großen Teil des Erwartungswerts tragen die 15 % für 10 und Black Label.
    Gegenüber vorher (Mint 2,92) ist der Erwartungswert gesunken, obwohl eine 10 nun 4-fach zählt.
  - **KI-Sammler zum Marktwert:** Ein Angebot zum Wert der Kopie (Marktwert × Zustands- oder Notenfaktor) oder
    darunter kauft die KI immer, beim nächsten Lauf des Minutenjobs: kein Würfel, keine Wochengrenze je Karte, auch
    Slabs zum vollen Wert (die alte Grenze von 70 % für Slabs ist weg, sonst könnten Spieler Slabs nie zu Geld machen).
    Über dem Wert zahlen KI-Sammler einen Aufschlag für gute Ware: roh Poor 0 %, Good 3 %, Near Mint 8 %, Mint 12 %;
    Slabs bis 7: 0 %, 8: 5 %, 8,5: 7 %, 9: 10 %, 9,5: 12 %, 10: 15 %, Black Label 20 %. Knapp über dem Wert kauft die KI
    mit 30 % × (1 + Beliebtheit) je Minute (im Schnitt nach 2 bis 3 Minuten), die Chance fällt bis zum Höchstpreis
    linear auf 20 % davon; darüber nie. Bessere Kopien kommen zuerst dran (höchster Wertfaktor), höchstens 100 Käufe
    je Lauf. Grenzen bleiben das Tagesbudget der Haushalte je Set (300 Booster-Preise) und deren Kontostand.
  - **Gegen Manipulation:** Ein KI-Kauf hebt den Marktwert wie bisher um 0,5 % × Beliebtheit, aber nur, wenn sein
    Preis je Karte im Band ± 25 % um den Wert liegt und die Karte in `buyWindowDays` (1 Tag) weniger als
    `buysPerCardWindow` (6 / 6 / 4 / 3 / 2) gezählte KI-Käufe hatte. Wer weit unter Wert verschleudert, verkauft
    trotzdem, bewegt aber nichts; der Aufschlag (höchstens 20 %) liegt immer im Band, die Tagesgrenzen des Werts
    (+ 15 %) gelten weiter. Die Demo rechnet dasselbe beim Lesen nach.
  - **Oberfläche:** Slab-Label, Chips, Chancentabelle, „Bewertete Kopien je Note“ und die Enthüllung kennen 8,5 und
    9,5 (die Enthüllung zählt 1 … 8, 8,5, 9, 9,5, 10 hoch). Das Verkaufs-Sheet sagt „Zum Marktwert oder darunter kauft
    die KI sofort.“, nennt den Höchstpreis der KI für Zustand oder Note und über dem Wert die mittlere Wartezeit.
    Beim Booster-Öffnen dreht ein Klick (Tipp ohne Bewegung) eine Karte auf die Rückseite und zurück, ebenso in der
    Übersicht am Ende; Taste F oder Enter dreht die Karte mit Fokus. Ziehen und Wegschnippen bleiben.
- **Offen (Balancing):** Die Startpreise machen Booster im Erwartungswert teurer oder billiger als ihren Inhalt, je
  nach Katalog; gebremst wird über die begrenzte KI-Nachfrage und fallende Werte bei wachsendem Angebot. KI-Budget,
  Booster-Takt der KI und Notenfaktoren sind die Stellschrauben.

- **Nachtrag (Slabs bleiben im Umlauf):** Bewertete Kopien (jede Note, halbe Noten und Black Label) verschwinden nie.
  Kauft die KI einen Slab (oder bekommt ihn auf anderem Weg, etwa von einem gelöschten Konto), wird er Lagerbestand
  eines KI-Verkäufers mit einer Haltezeit `ai.slabHold` (1 + 71 · u² Stunden, meist unter einem Tag, manche mehrere
  Tage; `nexamon_copies.ai_hold_until`, Zufall aus der Kopie abgeleitet). Bis dahin ist er nirgends zu sehen. Danach
  listet ihn die KI zum aktuellen Wert plus KI-Aufschlag (`askBps`), spätestens beim nächsten Sechs-Stunden-Reset;
  das Lagerlimit `stockCap` und der Reset entfernen nur noch ungradete Kopien. Die Demo rechnet dasselbe.

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

### Oberfläche der Firmenseite (Nachtrag)

- **Fünf Tabs** in der URL (`/company?tab=…&section=…`): **Dashboard** (Standard: Zu erledigen mit Direktlinks,
  Zahlen der letzten Stunde mit Verlauf der letzten 24 Stunden, laufende Timer, Mira, Büro, acht Faktoren, Lage und
  Nachrichten, Quartal und Verlauf, „Was jeder leistet und kostet“; notiert zusätzlich Kurs, Ruf, laufende Kosten,
  Steuer und Stimmung mit Zonen-Grafik), **Controlling** (alle Hebel in Bereichen zum Aufklappen, notiert dazu
  laufende Kosten, Forschungsbaum 7 × 4, Produkte, Märkte, Anlagen, Zukäufe, Lizenzen und Dividenden),
  **Mitarbeiter** (Zufriedenheit mit Benefits und Aktionen, Stellenplan zum Aufklappen, Leistung je Kopf, Aufgaben,
  Chat daneben ab `lg`), **Buchhaltung** und **Geschäftsrat** (nur notiert; private Firmen sehen ab Level 9 einen
  gesperrten Tab mit Ausblick, `DISCLOSURE.companyListed`).
- **Alte Adressen** und Miras `open`-Ziele bildet `src/features/company/tabs.ts` ab (z. B. `overview` + `books` →
  Buchhaltung, `team`/`tasks`/`chat` → Mitarbeiter). Benachrichtigungen mit dem Link `/company` bekommen dort Tab und
  Abschnitt; `/company?board=<id>` zeigt Aktionären den Geschäftsrat einer fremden Firma (Link auf Firmen- und
  Aktienseite).
- **Leistung je Mitarbeiter:** Das Spiel kennt keinen Kalendermonat; ein Monat sind hier 30 Tage. Kosten: Spieler
  Lohn × höchstens 8 bezahlte Stunden am Tag, KI-Kräfte jede Stunde. Leistung: Umsatz der letzten 24 Stunden × 30,
  geteilt nach dem Anteil an der Produktivität. Reine Client-Rechnung aus vorhandenen Daten
  (`src/features/company/staff-value.ts`), keine neue RPC.
- **Bekanntheit „immer 0 % oder 1 %“:** Am lokalen Postgres nicht nachstellbar. Quartalsabschluss, Antwort
  (`awareness_bps` = Anteil × 10 000) und Anzeige (÷ 10 000) passen zusammen; mit Marketing steigt die Bekanntheit
  von 3 % auf 28 % in zwei Quartalen (Test `a8_company_awareness.sql`). Erklärbar ist der Wert aber durch die
  Regeln: Protest (−3 Punkte) und ein Fehlschlag eines eigenen Zugs (−5 Punkte) ziehen eine Garage von 3 % auf 0,
  der Abschluss hebt auf das Minimum 1 %, und Mundpropaganda wächst proportional zur Bekanntheit (bei 1 % etwa
  +0,2 Punkte je Quartal). Offener Punkt fürs Balancing: Abzüge relativ statt absolut oder ein fester
  Mundpropaganda-Sockel.

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

## ADR-169: Viele neue Themen für die NEXA Nachrichten — `Annahme`

**Kontext:** Der Wunsch: „Bei den News sollen ganz viele neue Themen kommen. Mit den Collectibles, mit dem
Finanzamt, personenspezifisches. Viel Schräges, mit dunklem Humor.“ Die Sendung (ADR-150, ADR-152) kannte bisher
Verlierer, Gewinner, Klatsch aus dem Feed, Firmen, NFTs, Börse, Welt und Abschweifungen.

**Entscheidung:**

- **Themen als Drehbücher.** `src/config/news-topics.ts` hält 46 Themen in fünf Gruppen: Sammelkarten (`cards`:
  seltene Ziehung, teuerster Verkauf, Karte steigt/fällt, ASP-10, schlechte Note, Booster ohne Treffer, wertvollste
  Sammlung, KI-Händler), Finanzamt (`tax`: Verspätungszuschlag, Schätzung, Pfändung, Betriebsprüfung, saubere
  Bücher, Steuerschuld, Durchsagen von Oberamtsrat Griesgram), Börsenfirmen (`corp`: gieriger Gründer,
  Kündigungswelle, Rekorddividende, Aufstand im Geschäftsrat, Stimmung mies/glänzend, Forschung), Personen
  (`person`: schlechtester/bester Trade, Verlierer/Gewinner der Stunde, Miete, Kleiderschrank, Outfit, Battle
  gewonnen/letzter Platz, Missionen neu gewürfelt, Chat-Nachrichten (nur die Zahl), neue Freunde, Anstupsen,
  Schläfer, Rauswurf durch den Gründer, Beförderung, Gründer zahlt sich viel aus, neues Zuhause/Auto) und Schräges
  (`odd`: Nachrufe auf erfundene Depots, Börsenwetter, Werbung, Horoskop, Zuschauerpost, Studien). Jedes Thema hat
  Rahmen, Begründungen, Gesichter, ein Gewicht, einen Ton und die Platzhalter, die es braucht. Sie stehen in
  `newsShow.texts`, `newsShow.moods` und `newsShow.topics.list` und laufen über das bekannte `news_show_pick`.
  Dazu 20 neue Abschweifungen für „ramble“.
- **Auswahl.** `news_show_topics()` sammelt pro Thema höchstens einen Kandidaten aus vorhandenen Tabellen (Booster,
  Kartenverkäufe, Exemplare, Feed, Reichenliste, Trades, Mieten, Accessoires, Battles, Missions-Würfeln, Chats,
  Freundschaften, Stupser, Stundenabschlüsse, Steuerperioden). Gezogen werden `topics.count` (3): erst Themen, die
  in der letzten Sendung nicht liefen, dann Gruppen, die noch fehlen, dann gewichtet per Los. Pro Spieler eine
  Meldung pro Sendung, jede Tatsache einmal (`news_show_used`). Sie landen an den Plätzen `topics.ords` und zählen
  zu `maxSegments` (jetzt 12, gut viereinhalb Minuten). Ohne Daten tragen die sieben Themen ohne Platzhalter.
  Schlechte Nachrichten über Spieler (Personen, Karten) zahlen Schweigegeld wie der Klatsch.
- **Kein Doppel.** Solange Themen an sind, erzählt der alte Klatsch die Feed-Arten, die ein eigenes Thema haben,
  nicht mehr. `topics.count = 0` stellt die alte Sendung wieder her.
- **Neue Arten im Studio.** `cards`, `tax` und `corp` bekommen Icon, Farbe, Bildunterschrift und Standardgesicht;
  die übrigen Themen laufen als `gossip` oder `ramble`. Die Kartennamen kommen als `game_config.nexamon_names` auf
  den Server.
- **Demo.** Die Demo zieht dieselben Themen mit `pickTopics` über erfundene Mitspieler (Freunde zuerst).
- **Grenzen.** Spott nur über das, was im Spiel passiert ist. Keine geschützten Merkmale, keine Beleidigungen über
  den Namen, nichts Sexuelles, keine Gewalt oder Selbstverletzung, keine echten Unglücke. Echte Personen nur in
  Abschweifungen als offensichtlich absurde Gerüchte; sonst erfundene Leute und Ämter. Ein Test prüft alle neuen
  Texte auf Platzhalter und eine kleine Liste verbotener Wörter.

**Folgen:** Mehr Abwechslung pro Sendung, Sammelkarten und Steuern kommen in der Sendung vor. Die Abfrage liest
nur und läuft einmal pro Stunde. Neue Themen brauchen nur einen Eintrag in `news-topics.ts` und, falls sie Daten
brauchen, einen Zweig in `news_show_topics()`.

## ADR-170: Kein Geld aus der eigenen Aktie, NFT-Sammler den ganzen Tag aktiv — `Annahme`

Vorgaben: „Man kann Geld aus seinem Unternehmen auszahlen und dann seine eigene Aktie kaufen, um so die Aktie unendlich
nach oben zu treiben und Geld zu machen.“ und „Die NFTs sollen mehr verkauft werden, die Bots sollen immer wieder was
machen und nicht nur einmal am Tag.“

**Wie der Trick funktionierte (nachgestellt auf der lokalen Datenbank):** Eine frisch gelistete Garagenfirma
(Gründerin 60 %, KI-Anleger 40 % zum Mindestpreis 1 €, Kurs danach 0,40 €). Ein reines Hin und Her lohnt sich nicht:
Entnahme von 300.000 €, Kauf von 30.000 € eigener Aktien (Kurs +10 %, nach einer Stunde +21 %), Verkauf kostet
10.000 bis 12.000 € (ADR-126 wirkt). Das Geld kam aus der **Kapitalerhöhung**: KI-Anleger zeichneten 60 % + 40 % ×
Qualität der neuen Aktien zu 90 % des (hochgetriebenen) Börsenkurses, mindestens 1 €, ganz gleich, was die Firma wert
war. Eine Kapitalerhöhung um 25 % brachte so 250.000 € vom Finanzmarkt in die (leer entnommene) Firmenkasse, für
Aktien, die an der Börse 0,45 € und nach der Erhöhung fair rund 0,20 € wert waren; die Gründerin entnahm das Geld und
konnte von vorn beginnen. Je höher der Kurs
getrieben war, desto mehr zahlte die KI. Dazu hob der eigene Bestand der Gründerin den Anker des Value-Fonds um bis
zu 15 % (Halteprämie), und der Börsengang selbst (KI zahlt den Mindestpreis 1 € für eine Firma, die fast nichts wert
ist) ließ sich sofort entnehmen.

**Entscheidung (Ursache statt Symptom):**

- **KI-Anleger zahlen höchstens den fairen Wert.** Bei einer Kapitalerhöhung zeichnen sie ihren üblichen Anteil nur,
  wenn der Ausgabepreis höchstens `startups.ipo.aiMaxPremiumBps` (100 %) des fairen Werts nach der Erhöhung beträgt:
  (Firmenwert × Reputationsfaktor + neues Geld) / Aktien danach. Darüber zeichnen sie nichts
  (`company_share_offers.ai_factor` 1 oder 0, `issueAiFactor`, `postIssueFairCents`). Ein getriebener Kurs bringt
  damit kein Geld mehr; Mitspieler dürfen weiter zu jedem Preis zeichnen (ihr eigenes Risiko).
- **Eine Kapitalerhöhung höchstens alle 24 Stunden** (`capitalIncreaseCooldownHours`, Fehler
  `capital_increase_cooldown`, NX221).
- **Geld aus Börsengang und Kapitalerhöhung bleibt 72 Stunden in der Firma** (`issueProceedsLockHours`, Fehler
  `issue_proceeds_locked`, NX222). Die Firma darf es ausgeben, der Gründer nicht entnehmen.
- **Insiderregel:** Floss in den letzten 24 Stunden Geld aus der Firma an den Gründer (Entnahme, automatische
  Auszahlung, Dividende), kann er ihre Aktie nicht kaufen (`trading.playerStocks.insiderCooldownHours`, Fehler
  `insider_cooldown`, NX220). Verkaufen geht immer, andere Spieler kaufen wie bisher.
- **Tagesband für Spieleraktien:** Der Kurs einer Spielerfirma bleibt je Tag höchstens 30 % über und 23 % unter dem
  Vortagesschluss (`trading.playerStocks.dailyBandBps`, `playerStockBandE4`). Wer weiter kauft, zahlt beim Kauf den
  vollen Aufschlag, ohne dass der Kurs folgt.
- **Keine Halteprämie aus dem eigenen Bestand:** Die Aktien des Gründers zählen nicht mehr zur Halteprämie des
  Value-Fonds (ADR-056), nur, was Mitspieler halten.
- Verworfen: ein fester Spread oder asymmetrischer Impact (ADR-126 macht das Hin und Her schon teuer, das Geld kam
  nicht von dort) und ein Kaufverbot für Gründer (eigene Aktien kaufen soll mit eigenem Geld möglich bleiben).

**Ergebnis** (`supabase/tests/a9_stock_pump.sql`): Entnahme, Kauf, Kapitalerhöhung, Verkauf kostet die Gründerin
rund 12.000 €, die KI zeichnet bei getriebenem Kurs nichts; 100.000 € Käufe in einer Stunde heben den Kurs nur bis
zum Band (+30 %), der Rückverkauf kostet über 60.000 €; zwei Freunde, die viermal hin und her handeln, verlieren
zusammen rund 3.000 €. Eine faire Kapitalerhöhung (Preis unter dem fairen Wert) findet weiter KI-Anleger.

**NFT-Sammler (ergänzt ADR-163):** Warum sie wie „einmal am Tag“ wirkten: Ihre Angebote galten 24 Stunden, und
höchstens drei Sammler bieten gleichzeitig auf ein NFT. Ein NFT bekam also in den ersten Minuten seine drei Angebote
und danach bis zum nächsten Tag keines mehr. Handel unter Sammlern lief gegen die Tagesgrenze (300) und wurde mit
der Beliebtheit immer schneller (15 → 44 je Stunde mit zwölf Sammler-NFTs, Grenze gegen Nachmittag erreicht);
Auktionen von Spielern bekamen von der KI gar keine Gebote. Jetzt:

- Ein Angebot eines Sammlers gilt `nfts.ai.offerHours` (2) Stunden, danach kommt ein neues (Angebote von Spielern
  weiter 24 Stunden).
- Stundengrenzen: höchstens `maxBuysPerHour` (6) Käufe von Spielern und `trade.perHour` (24) Käufe unter Sammlern je
  Stunde, je Tag 100 und 480. Ein Festpreis bis zum Wert wird weiter mit 25 % je Minute gekauft, also binnen Minuten.
- Sammler bieten in Auktionen (`artwork_auctions.leader_ai`, `artwork_bids.bidder_ai`): je Minute und Auktion mit
  10 % das Mindestgebot, nur solange es höchstens ihre Bewertung ist, höchstens drei Gebote je Minute. Das Geld liegt
  wie bei Spielern im Treuhandkonto und kommt von den Haushalten; wird ein Sammler überboten, geht es zurück. Gewinnt
  er, gehört ihm das NFT und er bietet es mit seinem Aufschlag wieder an.
- **Geld bleibt vernünftig:** Sammler zahlen nie mehr als ihre Bewertung (Prägekosten oder letzter Preis plus Boni),
  und Käufe von Spielern plus ihre Führungen in Spielerauktionen bleiben unter `ai.budgetCentsPerDay` (300.000 €) je
  Berliner Tag (`nft_ai_spent_today`).
- Ergebnis über sechs simulierte Stunden (`supabase/tests/a9b_nft_activity.sql`): der faire Festpreis ist nach
  Minuten verkauft, 24 Käufe unter Sammlern in jeder Stunde, 14 Angebote auf ein zu teures und ein behaltenes NFT
  (vorher 6, alle in der ersten Stunde), Gebote in jeder Stunde; vorher 0.
- Demo: Kapitalerhöhungen rechnen mit demselben KI-Faktor und derselben Sperre; Sammler-Angebote laufen nach zwei
  Stunden aus, der Handel unter Sammlern hat dieselbe Stundengrenze. Insiderregel, Tagesband und Auktionsgebote der
  Sammler gibt es nur auf dem Server (die Demo handelt die eigene Aktie nicht, ihre Auktionen haben eigene Bieter).

## ADR-172: Pack Battles und Live-Öffnen bei den Nexamon-Karten — `Annahme`

**Kontext:** Karten öffnen ist bisher ein Solo-Moment. Gewünscht: zwei Freunde öffnen gegeneinander ein Pack, der
Bessere bekommt alles, und man kann anderen beim Öffnen live zuschauen.

**Entscheidung:**

- **Anwesenheit:** Die Collectibles-Seite ruft alle `presence.pingSeconds` (15 s) `nexamon_lobby(p_allow_watch)`. Wer
  in den letzten `presence.presenceSeconds` (60 s) gefragt hat, steht als Figur (Avatar und Accessoires) auf dem
  kleinen Platz über den Tabs; gezeigt werden Freunde, höchstens `maxPlayers`. Abzeichen „öffnet gerade“ und „im
  Battle“. Die Anwesenheit ist kein Spielzustand und trägt darum keine `request_id` (wie `last_active_at`).
- **Pack Battle:** Herausfordern geht nur gegen einen Freund, der gerade im Tab ist und Nexamon freigeschaltet hat;
  ein Battle pro Spieler gleichzeitig, `battles.cooldownSeconds` zwischen Herausforderungen, `battles.perHour`
  angenommene Battles pro Stunde und Spieler. Die Herausforderung gilt `challengeSeconds` (60 s); bezahlt wird erst
  beim Annehmen. Dann zahlen beide ein Pack (Ledger, an die Haushalte, wie ein Kauf), beide Packs werden in derselben
  Transaktion mit den Regeln von `buy_nexamon_pack` geöffnet (jede Kopie zählt zur Population), und das Ergebnis
  steht sofort fest: höherer Gesamtwert zum Zugzeitpunkt gewinnt, bei Gleichstand die seltenste Einzelkarte, dann
  ein Münzwurf (`coin_seed % 2 = 0` → Herausforderer, Seed gespeichert). Der Gewinner besitzt sofort alle zehn
  Kopien, der Verlierer nichts. Kann der Herausforderer beim Annehmen nicht mehr zahlen, endet das Battle als
  „abgebrochen“ und niemand zahlt; zwischen Bezahlen und Ziehen kann ein Battle nicht abbrechen, eine Erstattung ist
  deshalb nie nötig. Wer während der Enthüllung geht, ändert nichts.
- **Gleichschritt:** Der Server legt die Uhr fest: Start `startDelayMs` nach dem Annehmen, `tearMs` Aufreißen, dann
  je `slotMs` ein Slot auf beiden Seiten. `get_nexamon_battle` liefert die Karten eines Slots erst `leadMs` vor seinem
  Zeitpunkt, Summen und Gewinner erst zur Entscheidung; vorher sieht niemand etwas (auch nicht die Spieler).
  Clients rechnen den Versatz zur Serverzeit aus jeder Antwort und animieren von `starts_at` aus
  (`battleShownSlots`, `src/lib/sim/nexamon-battle.ts`). Polling statt Realtime: 0,7 s im Battle, das reicht für vier
  Spieler und braucht keinen eigenen Kanal.
- **Live-Öffnen:** Jedes gekaufte Pack wird per Trigger auf `nexamon_packs` zu einer Live-Sitzung, außer der
  Öffner hat „Andere dürfen beim Öffnen zuschauen“ ausgeschaltet (Einstellung, Standard an, mit der Anwesenheit zum
  Server). Die Seite des Öffners meldet jede gezeigte Karte (`nexamon_live_progress`); Zuschauer sehen nur, was der
  Öffner schon gesehen hat. Schweigt die Seite `live.staleMs`, kommt alle `fallbackSlotMs` eine Karte dazu. Jedes
  Battle ist ebenfalls live. Zuschauerzahl und Emoji-Reaktionen (`live.reactions`, mit `request_id`, begrenzt).
- **Nachrichten:** Feed-Arten `nexamon_battle_won` und, ab `gossipMinCents`, `nexamon_battle_big`; letztere ist
  Klatsch für die NEXA Nachrichten (Replace-Patch an `news_show_build`).
- **Kartenboni:** Nach dem Übertrag ruft das Battle `nexamon_bonus_recompute(uuid)` für beide Spieler, falls die
  Funktion existiert (kommt parallel).
- **Demo:** Die erfundenen Freunde (ohne welche drei Demo-Sammler) stehen im Tab, nehmen nach 2,5 s an und öffnen
  alle 45 s eines ihrer Packs live; eigene Packs sind live mit zwei erfundenen Zuschauern.

**Offen:** Die gewonnenen Kopien liegen schon während der Enthüllung in der Sammlung des Gewinners; wer dort
nachsieht, kennt das Ergebnis ein paar Sekunden früher.

## ADR-171: Karten-Boni, Sammlungen, „Nur gegradete“ und Black-Label-Hype bei Nexamon — `Annahme`

Vorgaben: „Füg noch hinzu, dass bestimmte Karten bestimmte Account-Boni bringen, das macht es attraktiv, aktiv auf dem
Markt Karten zu kaufen, oder wenn man ein Master-Set hat, kriegt man mehr XP oder mehr Geld oder whatever.“, „Ich will,
dass man in seiner eigenen Sammlung auch nur die gegradeten Karten anzeigen lassen kann … auch bei Freunden.“ und
„Karten mit einem Black Label haben die Chance, random richtig im Preis zu steigen. Das ganze hängt mit der Beliebtheit
und Seltenheit der Karte zusammen.“

**Welche Karten:** jede Ultra Rare, Prisma und Legendary und in jedem Set die Rare Nr. 60, zusammen 54 von 231 Karten
(`nexamon.bonuses.rarities`, `extraNumbers`). Die Art folgt dem Kartentyp, damit sich gezieltes Jagen lohnt:

| Typ            | Bonus-Art      | wirkt in                                              |
| -------------- | -------------- | ----------------------------------------------------- |
| Feuer, Drache  | Auftragserlöse | `task_pay` der eigenen Firma (company_task_resolve)   |
| Wasser         | Tresorzinsen   | `vault_interest` (claim_vault, aus der Staatskasse)   |
| Pflanze        | Tagesbonus     | `daily_bonus` (claim_daily_reward)                    |
| Elektro        | Handels-XP     | XP-Quelle `trade`                                     |
| Psycho, Fee    | Missions-XP    | XP-Quelle `mission`                                   |
| Gestein, Stahl | Gehalt         | `wage_bonus` (accrue_job_salary, aus der Staatskasse) |
| Unlicht        | XP             | jede XP-Quelle                                        |

Die Boni hängen sich an die Stellen, an denen die Verbesserungen (ADR-134) schon wirken: `player_upgrade_bps()` und
`player_xp_bonus_bps()` zählen den Karten-Bonus der passenden Art dazu. Kein neuer Geldweg, keine doppelte Logik.

**Größe:** Rare 0,5 %, Ultra 0,5 %, Prisma 1 %, Legendary 2,5 %, mal Set (Mystic Energy ×1, Super Apex ×1,25,
Prismatic Peak ×1,5). Die beste eigene, nicht angebotene Kopie zählt: Slab ab Note 9 ×1,5, Black Label ×2. Jede Karte
zählt einmal, Duplikate bringen nichts.

**Angebotene Kopien zählen nicht.** Wer verkauft, verliert den Bonus schon beim Einstellen; Karten bei ASP zählen
weiter (sie gehören dem Spieler). So kostet Verkaufen etwas, und Kaufen von anderen lohnt sich.

**Stapeln mit Deckel:** Pro Art wird alles addiert (roh). Bis zur halben Grenze zählt es voll, darüber nur die
Hälfte, nie mehr als die Grenze: XP 10 %, Missions-XP 15 %, Handels-XP 15 %, Gehalt 10 %, Tresorzinsen 15 %,
Tagesbonus 20 %, Auftragserlöse 10 % (`bonuses.caps`, `kneeShareBps` 50 %, `tailBps` 50 %). Alle 231 Karten als Black
Label ergeben zum Beispiel Auftragserlöse roh 47 %, wirksam 10 %.

**Sammlungen** je Set, „besitzen“ heißt wie oben nicht angeboten:

| Sammlung     | Bedingung                                                        | Dauerbonus solange komplett       | einmalig beim ersten Mal     |
| ------------ | ---------------------------------------------------------------- | --------------------------------- | ---------------------------- |
| Typ-Sammlung | alle Karten eines Typs im Set (3 bis 15 Karten)                  | +0,5 % × Set auf die Art des Typs | 3 Booster-Preise, 300 XP     |
| Set komplett | alle 77 Karten                                                   | +2 % × Set auf XP                 | 20 Booster-Preise, 2.500 XP  |
| Master-Set   | alle 77 und jede Prisma und Legendary als eigener Slab ab Note 9 | +1 % × Set auf jede Art           | 75 Booster-Preise, 10.000 XP |

Das Master-Set ist schwer, aber erreichbar: sieben Top-Karten graden lassen, ohne Black Label oder 10 zu verlangen.
Das Geld kommt aus den Haushalten (Ledger-Art `nexamon_set_reward`, so weit sie es haben), die XP über `grant_xp`
(Quelle `nexamon_set`). Die Belohnung gibt es pro Spieler und Sammlung genau einmal
(`nexamon_collection_completions`); wer die Sammlung verliert und wieder vervollständigt, bekommt nur den Dauerbonus
zurück. Die abgeschlossenen Sammlungen stehen als Abzeichen auf dem Profil. Ein Master-Set ist ein Feed-Eintrag und
Klatsch für die NEXA Nachrichten.

**Berechnung:** `nexamon_bonus_recompute(player)` schreibt einen Cache (`nexamon_player_bonuses`), aus dem die
Geld- und XP-Wege lesen. Aufgerufen wird es von verzögerten Constraint-Triggern auf `nexamon_copies` (Besitzer, Note,
Karte) und `nexamon_listings` beim Commit, einmal je Spieler und Transaktion. So deckt es jede Kartenbewegung ab:
Booster, Kauf, Verkauf, Einstellen, Zurücknehmen, Grading, Knacken, KI-Käufe, Konto-Reset und künftige Wege (Pack
Battles). Ein Kauf zeigt dadurch nur den Endzustand, keine „aktiv/weg“-Benachrichtigung dazwischen. Benachrichtigungen
`nexamon_bonus` (Bonus aktiv/weg) und `nexamon_set` (Sammlung komplett), Missionen „Dein erster Karten-Bonus“, „Erste
Typ-Sammlung“, „Ein Set komplett“.

**Oberfläche:** Neuer Tab „Boni“ mit den Summen gegen die Grenzen, den aktiven Karten und dem Fortschritt jeder
Sammlung samt fehlender Karten (Links in den Markt, gefiltert auf die Karte). Kartenseite und Booster-Liste zeigen den
Bonus einer Karte, der Markt markiert Angebote „Bonus fehlt dir noch“.

**„Nur gegradete“:** Schalter in der eigenen Sammlung (gemerkt mit den anderen Filtern in `nexa-nexamon-filters`)
und als dritte Ansicht in der Sammlung anderer Spieler. Gezeigt werden die Slabs nach Note, dann Wert, mit Anzahl,
Zehnen und Black Labels. `get_player_nexamon` liefert dafür `slabs` (alle Slabs, höchstens 500) und
`summary.black_labels`.

**Black-Label-Hype:** Die Black Labels einer Karte haben einen eigenen Faktor (Start ×10 wie bisher). Jede Stunde, je
Karte mit mindestens einem Black Label: erst verliert der Faktor 1 % dessen, was er über ×10 liegt (Halbwertszeit
rund 69 Stunden), dann springt er mit der Chance
`rarityChanceBps × (1 + Beliebtheit) × 3 / (3 + Black Labels − 1)` um 10 bis 60 % (gleichverteilt), höchstens auf ×25.
Grundchance je Stunde: Common 0,05 %, Rare 0,1 %, Ultra 0,25 %, Prisma 0,6 %, Legendary 1,2 %; eine beliebte
Legendary mit nur einem Black Label springt also mit bis zu 2,4 % je Stunde, etwa alle zwei Tage. Der Zufall wird
übergeben (`nexamonHypeStep(factor, chance, u, u2)`), der Job `nexamon_hype_run_due` läuft stündlich (pg_cron
`nexa-nexamon-hype`). Kopienwert, KI-Preise und -Käufe, Angebots-Hinweise, Sammlungs- und Profilwert rechnen mit dem
Faktor der Karte (alle Funktionen, die eine Kopie bewerten, rufen die Form mit Karte auf). Die Kartenseite zeigt den
Faktor, eine „Hype“-Marke nach einem Sprung und den Verlauf. Der Besitzer bekommt eine Benachrichtigung
(`nexamon_hype`), ab +40 % ist der Sprung ein Feed-Eintrag und Klatsch.

**Demo:** dieselben Regeln aus `src/lib/sim/nexamon-bonuses.ts`; Karten-XP und Tresorzinsen der Demo zählen den
Bonus mit, Belohnungen gehen an das Demo-Konto.

## ADR-173: Mehr Minispiele, mehr Geschäftszüge, CEO-Interviews — `Annahme`

Vorgaben: „Mehr Minigames zu den Firmenaufgaben hinzufügen“, „Mehr Firmen-Geschäftszüge hinzufügen“ und „Man soll im
Unternehmen als CEO manchmal Interviews random bekommen. Diese werden dann bei den News ausgespielt. Man kann beim
Interview selber antworten.“

**Minispiele (ergänzt ADR-129, ADR-144):** acht neue Spiele, je mit reiner Bewertung in `src/lib/sim/company-tasks.ts`
und derselben in `company_task_grade()` (Migration 6400), 16 neue Aufgaben in acht Abteilungen:
`memory` (Paare aufdecken, Fehlgriff −5 %), `timing` (Zeiger in der Zone stoppen, wie `slider` bewertet), `diff`
(abweichende Felder antippen, wie `pick`), `quick` (fünf Summen mit drei Antworten), `route` (kürzeste Rundtour über
vier Stationen, jedes Umwegfeld −10 %), `haggle` (drei Verhandlungsrunden: beste Antwort voll, mittlere halb),
`pack` (Wert unter einem Gewichtslimit, Optimum per Brute Force) und `catch` (gute Kacheln antippen, solange sie
auftauchen). Alle Ziele sind Knöpfe (Tastatur, Daumen); Bewegung nur über `transform`/`opacity`, bei reduzierter
Bewegung läuft der Zeiger halb so schnell in groben Schritten. Die Puzzles verraten die Lösung dem Client wie bei
`seq`; das bleibt bewusst so (kleine Beträge, Server bewertet und begrenzt die Zeit).

**Geschäftszüge (ergänzt ADR-127):** 15 neue Züge aus der bestehenden Risikotabelle (safe/normal/risky, Kosten =
Stufenbasis × Faktor 0,7–2,0, Ruhezeit = Dauer × 2), quer durch alle Abteilungen. Neu sind zwei optionale Felder:
`minTier` (ab Kleinunternehmen, GmbH oder AG) und `listedOnly` (nur börsennotiert); `company_moves_state()` blendet
den Rest aus (Migration 6410), `start_company_move()` antwortet dafür `move_unknown`. Neue Züge haben eigene
Erfolgs- und Misserfolgszeilen im Verlauf. Der Erwartungswert bleibt der der Risikostufe (Tabelle in BALANCING).

**CEO-Interviews:** Tabelle `company_interviews` (nur über RPCs), Konfiguration und Fragenpool in
`src/config/interviews.ts` (Serverkonfiguration `interviews`, wie die Skripte der Sendung).

- Anfrage: stündlich würfelt jede aktive Firma (Gründer in den letzten 48 h aktiv) 1/24 ihrer Tageschance:
  25 % + Stufe (0/10/25/40 %) + börsennotiert 30 % + Ereignis 25 % (Skandal in einer Sendung, Kündigungen, Verlust),
  höchstens 90 %; höchstens eine Anfrage in 20 h. Benachrichtigung `company_interview`, Karte „Interviewanfrage“ auf
  dem Dashboard, gültig 6 h.
- Fragen: drei aus 22, davon höchstens zwei zur Lage (Gewinn, Verlust, Börse, Stimmung, Kündigungen, Skandal,
  Größe, allein, bekannt, unbekannt), der Rest allgemein und manche frech. Jede hat drei Schnellantworten (gut,
  mittel, schlecht).
- Antworten: frei (höchstens 240 Zeichen, Wortfilter `text_has_profanity`) oder per Schnellantwort. Die Mini-KI
  bewertet jede Antwort mit −2..+2 (gute und schlechte Wörter, Länge; Schnellantwort +1/0/−1). Summe × 0,6 Punkte
  Bekanntheit, höchstens ±3 Punkte; börsennotiert zusätzlich Ruf × 0,5, höchstens ±3. „Kein Kommentar“ −0,8 Punkte
  (Ruf −0,5), verpasst −1,2 (Ruf −1). Die Wirkung gilt sofort, damit sie nicht davon abhängt, ob die Sendung läuft.
- Sendung: `news_show_interviews()` gibt der nächsten Sendung ein Interview: je Frage ein Segment `interview`
  (Frage, Antwort, bissige Reaktion, Stimmung nach Urteil, Figur des CEO auf dem Schirm) oder ein „kein
  Kommentar“-Segment; `news_show_start()` markiert es einmal als gesendet und legt es im Feed unter Firmen ab.
- Demo: das erste Interview kommt sofort, sobald die Demo-Firma existiert; danach per Zufall wie auf dem Server.
- Annahmen: Claude bewertet Interviews (noch) nicht; die Spalte `judge` ist dafür vorgesehen, die Mini-KI ist
  Rückfallebene und derzeit allein aktiv.

## ADR-176: Firmen-Fehlerberichte, Stärken mit Belohnung, Controlling geordnet — `Annahme`

**Kontext.** Der Besitzer spielt auf dem Live-Server und meldete für seine börsennotierte Firma: Ruf-Graph bewegt sich
nicht, CEO-Auszahlung und Strategie bleiben nach „gespeichert“ auf 0 % bzw. „Normal“, „bringt X €“ im Mitarbeiter-Tab
überall 0 €, Umsatz/Kosten/Gewinn der letzten Stunde fehlen und „Verlauf“ meldet dauerhaft „Noch keine abgeschlossene
Betriebsstunde“. Dazu der Wunsch nach einem Stärken-Diagramm, das lange braucht und sich lohnt, und nach einem
übersichtlicheren Controlling.

**Untersuchung (Live-Pfad).** Komponente → `engine` (`api-company.ts`: `set_company_strategy(p_request_id, p_price_level,
p_contract_work)`, `set_founder_payout(p_request_id, p_bps)` in Basispunkten) → letzte SQL-Definitionen (m4c/m4e plus
die Replace-Patches aus 5400) → `get_my_company()`/`company_state()` → Zod → Anzeige. Mit genau diesen Argumenten auf einer
lokalen Datenbank mit allen Migrationen und zusätzlich einmal `update-to-latest.sql` (so wie der Deploy, Funktionsrümpfe
danach identisch) gilt für eine börsennotierte Firma: Strategie und Auszahlung werden gespeichert und zurückgelesen,
die Stundenabrechnung schreibt Stunden, `listed_company_hours` und bewegt den Ruf (Test `b5_company_bugs2.sql`).
Gemeinsam erklären die Punkte 1, 4 und 5 sich nur durch eine Stundenabrechnung, die für diese eine Firma nicht
durchläuft: Ruf und Stimmung bewegen sich nur in `listed_hour_after()`, „bringt X €“ und „Verlauf“ lesen `hours`.
`player_companies_run_due()` fängt Fehler je Firma ab und schreibt sie nur nach `job_runs` (ADR-168) – im Spiel
war das unsichtbar. Für 2 und 3 gibt es im Code keinen Pfad, der den Wert zurücksetzt; der Client meldete aber
„gespeichert“, ohne die Antwort anzusehen, und Zod ergänzt fehlende Felder still mit `normal`/`0`/`[]`.
Nebenbefund: `a1_company_fixes.sql` und `a8_company_awareness.sql` setzten ein Quartalsende in den letzten 9 bzw. 30
Stunden voraus, das eine frische Datenbank je nach Uhrzeit nicht hat; dann scheiterte `verify_local.sh` und mit ihm
der Deploy-Workflow, ohne dass die Datenbank aktualisiert wurde.

**Entscheidung.**

- `company_state()` liefert `strengths.close_error` (Zeitpunkt, Fehlertext, Anzahl) aus `job_runs`; das Dashboard
  zeigt ihn oben. So ist eine hängende Abrechnung mit der Serverursache sichtbar.
- Strategie und CEO-Auszahlung schreiben die Antwort des Servers sofort in den Cache und melden nur Erfolg, wenn sie den
  gewünschten Wert zeigt, sonst einen Fehler mit dem zurückgemeldeten Wert. Die Auszahlungskarte wird mit dem
  gespeicherten Wert neu aufgebaut.
- a1/a8 prüfen die Quartalsberichte nur, wenn im Fenster ein Quartal endete.
- **Stärken:** sechs Werte statt der acht Diagnosefaktoren (Bekanntheit, Qualität, Lieferfähigkeit, Rendite, Team,
  Finanzen; die acht Faktoren aus ADR-162 bleiben als Erklärung darunter). Jede Stunde rückt jeder Wert um
  `gainPerHour` (2 %) der Lücke zum Stundenwert vor, bei schlechteren Stunden um `decayPerHour` (5 %) zurück: rund
  zehn Tage guter Stunden bis zur obersten Stufe. Belohnung nach dem abgerundeten Schnitt: ab 50 +2 %, 75 +5 %, 90 +10 %,
  98 +15 % auf den Umsatz der Stunde, gezahlt von den Haushalten (geschlossener Geldkreislauf), gebucht als
  „Stärken-Bonus“. Formeln in `src/lib/sim/company-strengths.ts` und identisch in Migration 6600; Werte in
  `companyHealth.strengths`. `companyHealthPayFactor(scores)` (1,00 bis 1,15) dürfen andere Funktionen (Firmen-Minispiele)
  als Lohnfaktor nutzen; die Werte stehen in `get_my_company` unter `strengths.scores`.
- **Controlling** in fünf Bereiche (Verkaufen, Betrieb und Wachstum, Geld, Forschung und Anlagen, Auftritt) mit Kopf
  aus Symbol und einer Zeile Erklärung, je zwei Spalten ab `lg`, Geschäftszüge über volle Breite und eine klebende
  Sprungleiste. Abschnitte und Deep-Links (`tabs.ts`) bleiben; neu ist `strengths`.

**Offen.** Die konkrete Fehlermeldung der Live-Firma ist erst mit dem Deploy sichtbar (Dashboard oder
`select * from job_runs where job_name = 'company_hours'`). Die Demo rechnet die Stärken aus ihren Stunden nach,
zahlt den Bonus aber nicht.

## ADR-179: Running Gags in den NEXA Nachrichten, zuerst „Vulcan Energy bohrt nie“ — `Annahme`

**Kontext:** Der Owner wünscht ein wiederkehrendes Meme: Die Spielerfirma „Vulcan Energy“ kündigt in jeder Sendung
an, mit den Bohrungen zu beginnen, und tut es nie. Der Chat ist genervt, ein paar Hardcore-Fans verteidigen sie.
Das Meme lebt so lange wie die Firma. Eine echte börsennotierte Firma mit ähnlichem Namen existiert.

**Entscheidung:**

- Allgemeiner Mechanismus `newsShow.runningGags.<key>` (Texte und Werte in `src/config/running-gags.ts`):
  `namePattern` (ILIKE, für Vulcan `vulcan energy%`), `chanceBps` (70 %), `ord` (75), Steigerung
  `escalateStart`/`escalatePerEpisode`, Überschriften, Einleitungen, Zeitangaben („bald“, „nach dem nächsten
  Gutachten“ …), 40 Moderationszeilen mit Stimmung (Augenrollen = confused, Seufzen = crying, gespielte Begeisterung
  = shocked), Zusatzzeilen bei Börsengang und Notierung, Chatzeilen (28 genervt, 17 Fans) und drei feste Fan-Namen.
- Server: `news_show_running_gags()` sucht die älteste aktive Spielerfirma (nicht KI, nicht aufgelöst/insolvent)
  mit passendem Namen und baut ein Segment `gag` ohne Wirkung. Tabelle `news_running_gags` zählt je Gag und Firma die
  gesendeten Folgen und merkt sich die letzte Zeile (keine direkte Wiederholung); gezählt wird in `news_show_start()`
  einmal je Sendung. „Tag X ohne Bohrung“ zählt ab Gründung. Eine neu gegründete Firma mit dem Namen beginnt bei
  Folge 1. `news_show_gag_chat()` (aus `news_show_after_start()`) lässt die erfundenen Zuschauer rund um das Segment
  schreiben. Claudes Umschreiben (`store_news_show_script`) lässt Gag-Segmente unverändert.
- Abgrenzung zur echten Firma: Jede Folge beginnt mit „die Spielerfirma … von {founder}“ bzw. „NEXA-Firma“. Keine
  Orte, Personen, Genehmigungen, Finanzen oder Projekte einer echten Firma; ein Texttest prüft Platzhalter und eine
  Liste verbotener Wörter.
- Demo: Schalter `demo.preview` zeigt den Gag mit der erfundenen Firma „Vulcan Energy“ von „Bohr_Boris“, wenn die
  Demo-Firma nicht so heißt; `/dev/ui` hat den Knopf „Running Gag“.
- Bewusst nicht in Changelog und Patchnotes (Überraschung, Wunsch des Owners).

## ADR-174: Cosmic Winds, One of Ones, eigene Seltenheiten je Set, Bulk und Markt nach Sets — `Annahme`

**Kontext:** Der Besitzer wünscht ein viertes Nexamon-Set „Cosmic Winds“ (Monster aus dem Kosmos und
Ereigniskarten wie Galaxien oder Kometen), Pack 5.000 €, 50 Commons, 15 Rares, 15 Ultra Rares, 5 Prismas,
2 Legendaries und eine neue Seltenheit „One of One“: drei Karten, die es im ganzen Spiel nur einmal gibt, 1 in
5.000 Packs, Wert 16 bis 33 Mio. €, für die KI tabu. Dazu: der Markt zeigt erst die Sets, mehrere Kopien lassen sich
auf einmal einstellen, die KI-Angebote wachsen nicht endlos, Bulk lässt sich an das Spiel verkaufen. Ein fünftes Set
(Titans Revenge, ADR-175) bringt eigene Seltenheiten und eine eigene Pack-Zusammensetzung.

**Entscheidung:**

- **Seltenheiten je Set:** `NEXAMON_RARITIES` ist die Liste aller Seltenheiten aller Sets (bisher `common` …
  `legendary`, neu `one_of_one`). Jedes Set erklärt in `NEXAMON_SET_LAYOUT` seine Seltenheiten in Nummernfolge mit
  ihrer Anzahl (die ersten drei Sets 50/10/10/5/2, Cosmic Winds 50/15/15/5/2/3 = 90 Karten). Daraus folgen
  `nexamonSetSize`, `nexamonRarityRange`, `nexamonRarityOfNumber(n, set)` und `nexamonSetRarities`.
  `NEXAMON_RARITY_RANK` ordnet alle Seltenheiten (Sortierung, Abzeichen, Pack-Battle-Gleichstand, Größe der
  Enthüllung); `pnpm db:config` schreibt Rang und Layout nach `game_config.nexamon_rarities`, die Datenbank liest den
  Rang daraus. Kunstgröße, Preisspanne, Popularität, Nachfrage, KI-Bestand, Hype und Boni sind Datensätze je
  Seltenheit; ein neues Set mit eigenen Seltenheiten trägt sie dort ein (TypeScript zeigt jede Stelle).
- **Pack-Zusammensetzung je Set:** Ohne Eintrag gilt die Platz-Tabelle `odds` (Platz 1–3 Common, Platz 4/5
  würfeln) samt One-of-One-Wurf. Mit `packRules[set] = { kind: "tiers", base, tiers: [{ rarity, packs, min, max }] }`
  würfelt jede Stufe (beste zuerst) 1 zu `packs`, bringt dann `min`…`max` Karten von hinten, der Rest ist `base`
  (nie zweimal dieselbe Basis-Karte). Gleiche Regel in `nexamonTierRarities` und in `nexamon_open_pack()`.
- **Cosmic Winds:** Pack 5.000 €, Karten zum 22,5-Fachen der ersten Preisspannen (4,5 × Super Apex), Typ „cosmic“
  (Stern-Symbol, Mitternachtsviolett) mit Bonusart XP („Wissen aus der Ferne“; Dunkel gibt ebenfalls XP),
  Set-Bonusfaktor 1,5. Ereigniskarten (`kind: "event"`) haben keine KP, ein „Ereignis“-Schild statt der KP, einen
  Nachthimmel-Rahmen mit Sternenstaub und eine gestrichelte Linie unter dem Effektnamen; Schaden 0, der Effekt steht
  als Text in der Angriffsplatte.
- **One of One:** Platz 5 eines Spieler-Packs würfelt zuerst 1 zu `oneOfOne.packs` (5.000); bei Treffer nimmt er unter
  einer Advisory-Sperre eine noch freie One of One des Sets (gleich verteilt), sonst die normale Tabelle. Jede Karte
  steht danach in `nexamon_one_of_ones` (Primärschlüssel je Karte), dazu die Prüfung `population <= 1`: zwei
  gleichzeitige Züge können nie beide gelingen. Sind alle drei weg, ist die Chance 0. Ein Zug postet
  `nexamon_one_of_one` in den Feed (Klatschquelle der Nachrichten), benachrichtigt jeden aktiven Spieler und löst die
  größte Enthüllung des Spiels aus (Abdunkeln, Blitz, langsames „ONE OF ONE“, eigener Klang). Rahmen: Vollbild,
  schwarz-goldener Doppelrahmen mit irisierendem Lauf (Türkis bis Rosé), quer durch die Mitte ein schwarzes Band mit
  „ONE OF ONE“ in großen goldenen Pixelbuchstaben und „1/1“, eigene sehr langsame Folie; Slab-Etikett mit irisierenden
  Linien. Sie zählt für keine Sammlung („Set komplett“ = 87 Karten, Master-Set = 87 plus Prismas und Legendaries
  als Slab ab 9), gibt aber einen Karten-Bonus. Grading und Black Label wie jede Karte, Hype nur für Black Labels.
- **KI und One of Ones:** Die KI zieht, hält und kauft sie nie (`ai.excludedRarities`; Trigger auf
  `nexamon_copies`, Kaufchance 0). Ihr Wert startet beim Katalogwert und bewegt sich nur durch Handel unter Spielern
  (`value.tradeOnlyRarities`: kein Angebot-Nachfrage-Schritt), mit Band und Anti-Manipulation wie sonst. In einem
  Pack Battle geht sie wie jede Karte an den Sieger.
- **Markt nach Sets:** Der Markt zeigt erst eine Kachel je Set (Pack, Zahl der Angebote, günstigstes und teuerstes
  Angebot); danach die Angebote des Sets mit Raw/Graded/Black-Label-Schalter und den übrigen Filtern. Das Set steht in
  der Adresse (`?set=`) und in `nexa-nexamon-filters`; „Alle Sets“ führt zurück.
- **Mehrere Kopien:** `list_nexamon_cards()` stellt n gleiche Kopien (lose im gleichen Zustand oder Slabs der gleichen
  Note, älteste zuerst) zu einem Preis je Stück ein, `unlist_nexamon_cards()` nimmt mehrere zurück; beide laufen über
  die Einzel-RPCs (Limit 30 Angebote, Ratenlimit, Missionen) und sind je Anfrage idempotent.
- **KI-Angebote:** Alle 6 Stunden (`ai.listingResetHours`) verschwinden alle KI-Angebote, der KI-Bestand je Karte
  über `ai.stockCap` wird ausgemustert (neueste zuerst, Slabs zuletzt; gelöscht, damit `nexamon_copies` nicht
  endlos wächst) und die KI stellt ihre üblichen Mengen zum aktuellen Wert neu ein. Die Population bleibt „jemals
  gezogene Kopien“ und zählt ausgemusterte Kopien mit. Die Demo kappt den KI-Bestand schon immer.
- **Bulk:** Bulk sind lose Kopien der Bulk-Seltenheiten ihres Sets (`quickSell.rarities`, je Set
  `quickSell.setRarities`; für Titans z. B. Eisen). Das Spiel kauft sie sofort für den Wert minus 35 % Gebühr
  (`quickSell.bps` 6.500, vorher 50 %), bezahlt von den Haushalten; jede so verkaufte Kopie senkt den Kartenwert um
  `dropBps` wie bisher. Die Sammlung hat dafür einen Bulk-Modus mit Filtern (Set, Seltenheit, Zustand, nur
  Duplikate, 1 behalten, Bonus-Karten behalten, höchstens wert), Mengenwahl je Karte und zwei Wegen: „An das Spiel
  verkaufen“ (`bulk_sell_nexamon`, bis 500 Kopien) oder „Auf den Markt stellen“ (zum Wert oder einem Anteil davon).
- **Platzhalter:** Die Kartendaten von Cosmic Winds kommen aus drei Entwurfsdateien (`cards-cosmic-winds-commons`,
  `-rares-ultras`, `-chase`) in der Form von `cosmic-draft.ts`; `cards-cosmic-winds.ts` übersetzt sie. Bis die echten
  Dateien da sind, stehen dort Platzhalter („Kosmo 12“, „Komet 3“).

**Konsequenzen:** Die Datenbank kennt beliebige Seltenheitsnamen (Prüfung nur auf die Länge). Neue Fehler NX270
(`nexamon_one_of_one_taken`), NX271 (`nexamon_ai_excluded`), NX272 (`nexamon_not_enough`). Migrationen 6500–6540.
Bulk bringt jetzt 65 % statt 50 % des Werts.

**Nachtrag (Note 10 nach Beliebtheit):** Ein Slab mit 10 ist nicht mehr bei jeder Karte das 4-Fache wert, sondern
je nach Beliebtheit der Karte (`popularityBps`, Seltenheit und Population) das 2,5- bis 4-Fache
(`grading.tenFactorRange`), eine 9,5 das 1,8- bis 2,6-Fache (`grading.nineHalfFactorRange`), linear und abgerundet.
Beide Spannen liegen über der Note darunter, darum gilt 8 < 8,5 < 9 < 9,5 < 10 für jede Karte. Das Black Label bleibt
beim eigenen Faktor (mit Hype). Server: `nexamon_grade_factor_bps(grade, card)`, genutzt von
`nexamon_copy_value_cents(..., card)` und vom Verkaufsfaktor; `grading.valueBps` bleibt der Rückfall ohne Karte.
Kartenseite, Grading-Blatt und Desk zeigen die Faktoren der Karte.

## ADR-177: Fünf WASD-Battles, Accessoires und versiegelte Booster als Preise — `Annahme`

- **Wunsch:** fünf neue Minispiele für die News-Battles im WASD-Stil; als Preise auch Accessoires, NFTs und
  Nexamon-Booster, mehrere Booster höchstens 20.000 € wert; gewonnene Booster liegen bei Collectibles und lassen sich
  öffnen. Booster sollen sich auch kaufen und später öffnen lassen.
- **Spiele** (Ganzzahl-Simulation in `src/lib/sim/battle/{zone,tag,tiles,paint,crash}.ts`, gespiegelt in PL/pgSQL,
  Testvektoren in beiden Welten, Werte in `battles.games`):
  - **Goldrausch-Zone:** Münzen in einer goldenen Zone, die Ring für Ring schrumpft (Chebyshev-Radius, alle 8,5 s).
    Man kann sie nicht verlassen; wer beim Schrumpfen draußen steht, ist raus. Zuletzt stehend, dann Münzen.
  - **Bulle und Bär:** Fangen. Der Bär ist schneller (3 statt 4 Takte je Feld), sein Opfer wird Bär und steht kurz
    still. Am kürzesten Bär gewinnt. Geht der Bär, übernimmt der mit den wenigsten Bär-Takten.
  - **Wackelparkett:** Ein verlassenes Feld bricht nach 2 s (später schneller) weg und wächst erst nach 7 s (später
    länger) nach; 1,5 s Stillstand bricht das eigene Feld. Zuletzt stehend.
  - **Farbrausch:** Revier malen. Jedes betretene Feld wird eigenfarbig, Aktion = Farbbombe 3 × 3 (alle 8 s); trifft
    zwei Bomben dasselbe Feld im selben Takt, bleibt es, wie es war (keine Slot-Bevorzugung). Meiste Felder gewinnt.
  - **Crash-Regen:** Wellen roter Warnkreuze (je fünf Felder), 1,5 s später der Einschlag, drei Herzen, Wellen
    werden schneller und größer (abhängig von der Spielerzahl). Zuletzt stehend.
    Alle funktionieren mit 3 bis 10 Spielern (Spawns der Arena, Münz- und Crash-Zahlen wachsen mit der Spielerzahl).
- **Preise:** neue Gewichte `xp 25, money 25, skin 15, nft 15, accessory 15, packs 15`. Gezogen beim Öffnen der Lobby
  und vorher angezeigt.
  - **accessory:** Stufe gewichtet (`selten 60, episch 30, legendär 10`); der Gewinner bekommt ein zufälliges
    Shop-Accessoire dieser Stufe (nie ein Battle-Exklusives), das er noch nicht hat, für 0 €; hat er alle, gibt es Geld.
  - **nft:** unverändert der saubere Weg von ADR-160: ein Galerie-NFT ohne Besitzer und ohne Auktion wechselt per
    `owner_id` zum Gewinner (kein Prägen, keine Buchung); ist keins frei, gibt es Geld.
  - **packs:** versiegelte Booster von höchstens zwei Sets, Summe der Packpreise höchstens `packsCapCents` = 20.000 €,
    höchstens 8 Packs: ein Hauptset (gleichverteilt unter den Sets, die passen) 1..so viele wie passen, mit 50 % der
    Rest im billigsten anderen Set, das noch passt (z. B. „1 × Prismatic Peak + 7 × Mystic Energy“, „3 × Super Apex“,
    „1 × Prismatic Peak“). Preise kommen zur Laufzeit aus `game_config.nexamon`, neue Sets passen automatisch.
    Reine Funktion `pickPackPrize` mit Test, SQL-Spiegel `battle_pick_packs` (gleiche Zufallszahlen, gleiches Ergebnis).
- **Versiegelte Booster:** Tabelle `nexamon_sealed_packs`; Gewinn und Kauf legen Zeilen an, `open_nexamon_sealed_pack`
  ruft die bestehende Zugfunktion `nexamon_open_pack` und legt wie ein Kauf eine Zeile in `nexamon_packs` an (damit
  laufen Population, Live-Öffnen per Trigger, Missionen und Zähler unverändert). `buy_nexamon_pack` bleibt
  unangetastet; `buy_nexamon_sealed_pack` bucht denselben Packpreis mit derselben Buchungsart `nexamon_pack`.
  Öffnen ist einmalig (Zeile gesperrt, `opened_at`), per `request_id` idempotent. Gesperrtes Nexamon: Gewinne kommen
  trotzdem an, Öffnen erst ab der Freischaltung.
- **Oberfläche:** Streifen „Ungeöffnete Booster“ oben im Shop (`sealed-packs.tsx`), „Öffnen“ übergibt den Pack an das
  bestehende Popup mit `PackOpening`; im Pack-Popup „Kaufen und später öffnen“. Die neuen Arenen zeichnet
  `render/arena-five.ts`; Demo mit Bots für alle fünf Spiele und denselben Preisregeln.
- **Annahmen:** Der Demo-Gewinn landet sofort im Demo-Inventar. Ein Battle-Accessoire zählt nicht als Kauf (kein
  Feed-Eintrag für legendäre Käufe).

## ADR-181: Kritiker-Urteil für NFTs und gesprächige Sammler — `Annahme`

**Kontext:** Der Owner wünscht: „Die KI soll bei NFTs erkennen können, ob die Bilder gut aussehen oder nicht. Sie soll
auch mehr Texte in den Chats der NFTs haben.“ Bisher bewerteten die KI-Sammler (ADR-135, ADR-141, ADR-163, ADR-170)
ein NFT nur nach Prägekosten, Likes, Ruf, Alter und Nachfrage; ein Farbklecks war so viel wert wie ein Meisterwerk.
Im Chat schrieben sie nur Angebote, Kauf-, Annahme- und Ablehnungssätze und reagierten nie auf Spieler.

**Entscheidung:**

- **Kritiker-Urteil** 0..100 aus dem Pixelraster, deterministisch und nur auf dem Server: `src/lib/sim/art-quality.ts`
  und gleich in PL/pgSQL (`art_quality`, Migration `…7000`), nur Ganzzahl-Arithmetik, gemeinsame Fälle in
  `supabase/tests/art_quality_cases.inc` (Vitest und `b9_nft_quality.sql` prüfen beide exakt). Neun Teilwerte:
  Bildfüllung (Anteil gemalter Pixel, kein Vollflächen-Klecks), Farbwahl (Zahl der Farben, Streufarben kosten),
  Farbharmonie (Farbtöne in 30°-Fächern, mehr als drei kosten), Kontrast (Helligkeitsspanne), Sauberkeit (Anteil
  einzelner Pixel ohne gleichfarbigen Nachbarn, Zerfaserung in Regionen), Konturen (dunkle Pixel am Rand zur leeren
  Fläche), Komposition (Schwerpunkt nahe der Mitte, Spiegelsymmetrie), Detailreichtum (Farbwechsel zwischen Nachbarn,
  zu wenig und Rauschen kosten), Formen (Pixel mit drei gleichfarbigen Nachbarn). Gewichtet gemittelt, dann mit dem
  schwächsten von Füllung, Farbwahl und Detail gedämpft (ohne die ist es kein Bild). Werte in `nfts.quality`.
- **Kopien:** Signatur = Raster mit Farben in Reihenfolge des ersten Auftretens umbenannt (umgefärbte Kopien sind
  gleich). Gleich wie ein älteres NFT → „exact“, höchstens 5 Punkte; höchstens 2 % der Pixel anders → „near“,
  höchstens 15. Der Server vergleicht beim Prägen gegen alle älteren NFTs (`art_copy_kind`).
- **Wann:** Trigger nach dem Einfügen in `artworks` (Prägen, Galerie), erneut wenn sich die Pixel ändern; die
  Migration bewertet alle vorhandenen NFTs, ältestes zuerst; `nfts_run_due` bewertet bis zu 20 noch unbewertete je
  Minute (Sicherheitsnetz, falls die Konfiguration später kam). Spalten `artworks.quality`, `quality_detail`,
  `quality_sig`. Der Client schickt nur Pixel, nie eine Note.
- **Wirkung auf die Sammler** (`nfts.ai.quality`): Der Bewertungsanker aus Prägekosten bzw. Mindestwert wird mit
  60 % (0 Punkte) bis 140 % (100 Punkte) multipliziert, 50 Punkte = unverändert. Der letzte Verkaufspreis bleibt
  unskaliert, damit sich der Faktor nicht über Weiterverkäufe aufschaukelt. Das bewegt Kaufgrenze, Angebote,
  Auktionsgebote und den fairen Wert im Handel unter Sammlern (Preise driften zur Qualität). Chancen für Kauf,
  Angebot und Handel × 20 % bis 200 % (50 Punkte = 110 %), unter 10 Punkten bietet niemand. Lowball-Angebote
  verschieben sich um (Punkte − 50) / 50 × 15 Prozentpunkte (65–90 % werden bei 100 Punkten 80–100 %, bei 0 Punkten
  50–75 %). Tagesbudget und Stunden-/Tagesgrenzen aus ADR-170 bleiben; Gegenangebote prüfen das Budget.
- **Anzeige:** `artwork_json.quality` = Punkte, stärkster und schwächster Teilwert, Kopie-Flag (die Teilwerte bleiben
  intern). Der Besitzer sieht „Kritiker-Urteil: 82/100 · Stark: Farbharmonie. Schwach: Konturen.“; die Karte im Markt
  zeigt für alle ein kleines Abzeichen „Kritik 82“.
- **Chat** (`nfts.ai.talk`, Migration `…7020`, `src/lib/sim/nft-talk.ts`): 167 neue Zeilen. Angebotstexte folgen dem
  Urteil (Kopie → Kopie-Spott, unter 35 → Spott, ab 75 → Lob oder Kompliment für den besten Teilwert, dazwischen
  Kommentar zum schwächsten oder besten Teilwert oder die alten Zeilen), dazu je Sammler drei Sprüche (25 % Chance).
  Kein Satz wiederholt eine der letzten sechs KI-Zeilen im Chat. Spielernachrichten werden per Schlüsselwort
  eingeordnet (Beleidigung, mehr, weniger, nein, ja, Frage, sonst) und nach einer Minute vom KI-Besitzer oder dem
  Sammler beantwortet, der dort zuletzt schrieb (bis sechs Stunden zurück). Sagt der Besitzer „mehr“ oder „nein“ zu
  einem offenen Sammlerangebot, erhöht der Sammler um 8 % bis höchstens 95 % seiner Bewertung, sonst „letztes Wort“.
  Ein 30 Minuten unbeantwortetes Angebot bekommt mit 30 % eine Erinnerung (einmal). So entstehen Gespräche mit
  mehreren Nachrichten. Ton wie ADR-078: albern, Spott nur über das Bild, nichts über Personen oder Merkmale.
- **Claude:** Für NFTs gibt es keine Edge Function; ein Bild-Urteil per Vision wäre nur ein Bonus und ist bewusst nicht
  gebaut. Alles läuft deterministisch ohne Secrets.
- **Demo:** gleiche Formeln (Urteil, Bewertung, Chancen, Texte, Antworten, Erinnerungen) in
  `src/features/game/demo/artworks.ts`.
- **Tests:** frühere NFT-Tests (`9b`–`a9b`) malen absichtlich gleiche Bilder; sie laufen mit neutralem Kritiker und
  stillen Sammlern, `b9_nft_quality.sql` stellt die echten Werte wieder her.

## ADR-180: Firmen-Überholung – Wirtschaft nach Messung, Autopilot, fünf neue Minispiele, einfaches Dashboard — `Annahme`

**Kontext.** Der Owner (Live-Server): „Die KI-Arbeitskräfte machen nur Minus, man macht generell kaum Umsatz. Alles
ist verworren bei den Tabs. Man gewinnt nie an Bekanntheit.“ Dazu der Wunsch nach einem Auto-Knopf (60 % Erfolg, mit
der Stimmung bis 120 %) und nach neuen Minispielen, die mit den sechs Stärken mehr bringen.

**Messung (vorher).** `scripts/company-harness.ts` (TS, `closeStartupHour` + Quartal) und dieselben vier Firmen auf
einer lokalen Datenbank mit der echten Stundenabrechnung (`player_companies_run_due`, Spielzeit Stunde für Stunde
vorgestellt, Aufgaben tagsüber gelöst). Markt jeweils der Median (u = 0,5: 3.374 €/Spieljahr = Tag).

| Firma (Harness, Stunde 72) | Umsatz €/h | Gewinn €/h | KI-Lohn fällig €/h | KI-Beitrag €/h |   Bekanntheit |
| -------------------------- | ---------: | ---------: | -----------------: | -------------: | ------------: |
| Garage solo, Tech          |         73 |        −54 |                  0 |              0 | 50 % (Deckel) |
| Kleinunternehmen, 3 KI     |        469 |       −417 |                360 |              0 |          70 % |
| GmbH, 8 KI, Marketing      |      2.271 |     −1.422 |                960 |            467 |          85 % |
| AG, 20 KI                  |      7.114 |        144 |              2.400 |          4.351 |          95 % |

Die SQL-Abrechnung (Stufe 0, ohne Fachwissen) bestätigt das: Kleinunternehmen −416 €/h in jeder Stunde, GmbH −1.416,
AG −2.749; die Garage lebte fast nur von Auftragsarbeit (187 von 189 € Umsatz). Die Stundenabrechnung lief für alle
vier Firmen ohne Fehler (`job_runs` leer, `close_error` null); das Geld der Firmen kam fast nur aus Aufgaben.

**Ursachen.**

1. _Kaum Umsatz:_ Die Märkte waren winzig gegenüber der Kapazität. Ein Median-Markt trägt 3.374 €/Tag, also
   141 €/h bei voller Bekanntheit; der Gründer allein schafft 750 €/h. Die Nachfrage lag damit fast immer unter der
   Kapazität des Gründers.
2. _KI-Kräfte nur Minus:_ Jede KI-Kraft kostete 120 €/h, egal ob es Arbeit gab. Weil schon der Gründer die ganze
   Nachfrage bediente, brachten zusätzliche KI-Kräfte nichts (Beitrag 0 €/h), kosteten aber den vollen Lohn; der
   Lohnfaktor kürzte dann alle Löhne auf das Verdiente, und der Verlust blieb bei Fixkosten und Marketing.
3. _Keine Bekanntheit:_ Die Bekanntheit änderte sich nur einmal je Quartal (alle sechs Stunden), dazwischen stand
   sie still. Kampagnen brachten +0,5 bis +2,5 Punkte, Aufgaben und Geschäftszüge nichts. Die Stärke „Bekanntheit“
   rechnete mit 100 % als Ziel; eine Firma mit 5 % Bekanntheit stand dort bei 5 von 100 und rückte nur 2 % der Lücke
   je Stunde vor (aus 0 wurde nach einem Tag 1). Ohne Fachwissen deckelt Stufe 0 bei 50 %.

**Entscheidung.**

- _Markt ×10, Kapazität ×1,5:_ `marketFactorByTier` 10/40/150/400 (statt 1/4/15/40), `capacityCentsPerProductivity`
  Tech/Pharma 450.000, sonst 375.000 je Quartal. GmbH-Fixkosten 3.600 € statt 6.000 € je Quartal.
- _KI-Kräfte nach Auslastung (`aiUtilizationBps`, `aiWageDueCents`):_ Gründer und Spieler bedienen zuerst, die KI-Kräfte
  den Rest. Den vollen Lohn kostet nur der genutzte Teil ihrer Kapazität, mindestens `aiWorkerStandbyBps` (25 %). Eine
  ausgelastete KI-Kraft bringt in jeder Branche mehr, als sie kostet (Kapazität × Bruttomarge > 120 €/h; Test). Ohne
  Nachfrage zeigt das Dashboard „Zu wenig Nachfrage: … stehen still und kosten je 25 % des Lohns“.
- _Bekanntheit jede Stunde (`awarenessHour`):_ Mundpropaganda `growthPerQuarter/6 × a(1−a)(0,5+Qualität)` (0,2),
  Marketing `marketingMaxGain × B/(B+Halb)/6` mit B = Stundenbudget × 6 (0,24; Halbsättigung 1 % des Quartalsmarkts,
  mindestens 500 €), Vergessen `decayPerQuarter/6 × a` (0,12), gedeckelt durch die Stufe. Das Quartal bewegt sie nicht
  mehr. Jede Stunde speichert ihre Teile (`awareness_parts`), das Dashboard sagt „+2,0 durch Marketing“. Gelöste
  Aufgaben +0,2 Punkte sofort (KI und Autopilot +0,1), Kampagnen +2/+4/+8 Punkte. Die Stärke „Bekanntheit“ zählt
  50 % als 100 (`awarenessFull`).
- _Ziele:_ Eine gut geführte Garage verdient nach einem Tag rund 300–450 €/h (Junior-Lohn 300 €/h, Senior 700 €/h),
  ein Kleinunternehmen mit drei KI-Kräften 400–550 €/h, eine GmbH mit acht KI-Kräften gut 1.000 €/h; Verluste gibt es
  in den ersten Stunden, solange die Bekanntheit wächst.
- _Autopilot:_ Schalter im Dashboard (nur Gründer). Jede Minute (`company_tasks_run_due` → `company_autopilot_run`)
  übernimmt er jede offene Aufgabe, die `delayMinutes` (3) gewartet hat, ohne Minispiel. Chance
  `6.000 + 6.000 × Stimmung` bps; Stimmung = Mitarbeiterzufriedenheit (börsennotiert) oder die Stärke „Team“ (privat,
  folgt dem Lohnfaktor). Ab 100 % sicherer Erfolg, der Teil darüber erhöht den Lohn (120 % → ×1,2). Erfolg zahlt 70 %
  eines perfekten Laufs, daneben kostet 30 % des Werts (statt 60 %). Ist niemand aktiv, legt er selbst stündlich eine
  Aufgabe an; höchstens 24 Autopilot-Aufgaben je Berliner Tag. Jede Aufgabe steht in `company_autopilot_log`; ab 7 Uhr
  kommt eine Mitteilung „Autopilot: 14 Aufgaben erledigt“ mit Erfolgen und Betrag. Geschäftszüge übernimmt er nicht.
- _Aufgabenlohn nach Stärken:_ jede gelöste Aufgabe × `9.000 + 6.000 × Gesamtwert/100` bps (0,9× bis 1,5×), linear
  statt der Stufen von `companyHealthPayFactor` (1,00–1,15), damit es spürbar ist.
- _Fünf neue Minispiele (Tippen statt Ziehen):_ Nachbestellen (`restock`), Belege prüfen (`receipts`), Bestes Angebot
  (`offer`), Zahlenreihe (`pattern`), Regal einräumen (`shelf`, 4×4-Sudoku). Bewertung in
  `src/lib/sim/company-tasks-more.ts`, gleich in SQL (`company_task_grade_more`); fünf neue Aufgaben im Katalog.
- _Dashboard:_ oben Zahlen, „Was die letzte Stunde sagt“ (Bekanntheit nach Hebeln, KI-Auslastung, ausverkauft),
  „Zu erledigen“ mit neuen Punkten (Marketing setzen, KI-Kräfte im Leerlauf, ausverkauft, Autopilot), Autopilot,
  Mira, die sechs Stärken. Timer, die acht Faktoren, Teamwert und Büro liegen unter „Erweitert“. Deep Links
  (`health`, `staff-value`) öffnen „Erweitert“.

**Nachher (Harness, Stunde 72, Stufe wie oben):**

| Firma                  | Umsatz €/h | Gewinn €/h | KI-Lohn €/h | KI-Beitrag €/h | KI-Auslastung |   Bekanntheit |
| ---------------------- | ---------: | ---------: | ----------: | -------------: | ------------: | ------------: |
| Garage solo            |        731 |        440 |           0 |              0 |             – | 50 % (Deckel) |
| Kleinunternehmen, 3 KI |      3.516 |        454 |         360 |            820 |         100 % |          70 % |
| GmbH, 8 KI             |      8.906 |      1.135 |         960 |          2.625 |         100 % |          85 % |
| AG, 20 KI              |     28.219 |     15.973 |       2.400 |         19.688 |         100 % |          95 % |

Bekanntheit mit dem vorgeschlagenen Marketing: +2,0 Punkte je Stunde, die Garage von 3 % auf 27 % in zwölf Stunden
(vorher 9,6 %). In SQL (Stufe 0): Garage +370 bis +389 €/h ab Stunde 24, Kleinunternehmen +150 bis +168 €/h.

**Folgen und Annahmen.** Mehr Firmenumsatz fließt aus dem Haushaltskonto; die Abrechnung zahlt nie mehr, als die
Haushalte haben. Das Haushaltskonto ist im Auge zu behalten. Die Garage-Simulation (1.000 Firmen, zehn Tage) zeigt
jetzt unter 5 % Pleiten und über 85 % Gewinn (vorher 20–45 % Pleiten); das Risiko liegt bei den großen Rechtsformen.
Ältere SQL-Tests prüfen die Mechanik weiter mit den alten Zahlen (Vorspann in den Dateien). Die Demo macht alles nach,
den Autopiloten nur, wenn die Seite offen ist.

## ADR-182: Titans Revenge und Yin Yang im Spiel — `Annahme`

**Kontext:** Karten und Pixel-Art zweier neuer Nexamon-Sets lagen als Entwürfe im Repository: Titans Revenge (30
kolossale Titanen, eigene Seltenheiten Iron/Titanium/Diamond/Uranium, Pack 100.000 €, ~90 % Erwartungswert) und
Yin Yang (110 Karten im japanischen Tuschestil, Monster und einsame Krieger, Pack 2.000 €, Werte 10× der ersten
Spannen und ab Ultra × 1,12, Ziehchancen ab Ultra × 0,9). Beide sollen vollständig ins Spiel: Katalog, Shop, Markt,
Popup, Pack Battles, Live-Öffnungen, versiegelte Packs, Demo und Datenbank.

**Entscheidung:**

- **Katalog:** `NEXAMON_SETS` um `titans_revenge` (Präfix `tr`) und `yin_yang` (`yy`); Layouts 15/7/4/4 und
  54/30/16/8/2 (461 Karten in sechs Sets). Neue Seltenheiten `iron`, `titanium`, `diamond`, `uranium` mit Rang 0, 2, 3
  und 5 (Uranium gleichauf mit der One of One: die größte Enthüllung). Preisspannen je Set stehen in
  `NEXAMON_SET_PRICE_RANGE` (Titans aus `titans-draft.ts`, Yin Yang aus `yinyang-draft.ts`). Neue Kartenart
  `warrior` (Krieger): KP wie ein Monster, kleines Schild „KRIEGER“ auf der Vorderseite.
- **Titans-Werte × 1,125:** Mit den Entwurfspreisen lag der Erwartungswert eines Packs bei nur 79,9 % (Sim). Der
  Katalog nimmt jeden Startpreis × 1,125 (`TITAN_VALUE_FACTOR`, auf ganze Euro gerundet); die Spannen wachsen mit.
  Ergebnis 89,9 % zum Startwert, 87,7 % nach Zustandsfaktor (`nexamonExpectedPackValue`, Test im Katalog).
- **Titans-Pack:** `packRules.titans_revenge` = Basis Iron, Stufen Uranium 1/500 (1 Karte), Diamond 1/50 (1),
  Titanium 1/5 (1–2), von hinten gefüllt; Iron im Schnitt 4,68 Karten, praktisch 3 bis 5.
- **Yin-Yang-Pack:** klassische Plätze, aber eine eigene Platz-Tabelle `setOdds.yin_yang` in Teilen von 36.000, damit
  ×0,9 exakt bleibt: Platz 5 Legendary 36, Prisma 405, Ultra 1.350, Platz 4 Ultra 1.350. Der frei gewordene Anteil
  (ab Ultra) geht an die Rare (Platz 4: 9.150, Platz 5: 9.199), die Commons bleiben gleich. Eine stufenweise
  Weitergabe (Legendary → Prisma → Ultra) hätte die mittleren Seltenheiten nicht um genau 10 % gesenkt; gewünscht war
  „ab Ultra je 10 % weniger“. Gleiche Regel in `nexamonSlotOdds(slot, cfg, set)` und `nexamon_slot_rarity(set, …)`.
- **KI:** darf Iron und Titanium halten und anbieten (Startbestand wie Common/Ultra: 6 und 2 Kopien je Karte),
  Diamond nur aus eigenen Packs (kein Startbestand, ~1 in 50 KI-Titans-Packs, dann einmal angeboten, Bestand höchstens
  1), Uranium nie: `ai.excludedRarities` enthält `uranium`. Würfelt ein KI-Pack die Uranium-Stufe, fällt sie weg (die
  nächste Stufe rückt nach hinten, der Rest ist Iron; sonst hätte der KI-Schutz-Trigger den ganzen Lauf abgebrochen). Uranium-Werte bewegen sich wie Legendaries
  (Angebot/Nachfrage, ohne KI-Käufe). Eigene Migration (7200/7210), die KI-Slab-Logik bleibt unberührt.
- **Boni (ADR-171):** Titanium, Diamond und Uranium geben Boni wie Ultra, Prisma und Legendary (0,5 / 1 / 2,5 %),
  Iron keinen. Set-Faktor Titans 1,75 (teuerstes Pack), Yin Yang 1,5. Die Deckel und das Knie bleiben, also kann
  kein Set die Grenzen sprengen; Rare Nr. 60 von Yin Yang gibt wie überall einen Bonus.
- **Sammlungen:** Set komplett heißt bei Titans alle 30 Karten (inklusive der vier Uranium); Master-Set zusätzlich jede
  Diamond und Uranium als eigener Slab ab Note 9 (`masterRarities` um `diamond`, `uranium`). Bei Yin Yang wie bei den
  klassischen Sets (Prismas und Legendaries). Neu für alle Sets: ein Typ mit weniger als drei Karten im Set ist keine
  Sammlung (`sets.type.minCards`; die klassischen Sets haben je Typ mindestens drei, Titans dagegen Typen mit einer
  Iron-Karte). Eine Belohnungs-Pack zählt bei Titans 10.000 € statt 100.000 € (`sets.rewardPackCents`), sonst hätte
  eine billige Typ-Sammlung 300.000 € gezahlt (im SQL-Test aufgefallen). Typ 30.000 €, Set komplett 200.000 €,
  Master 750.000 €.
- **Missionen:** „Rare oder besser“ zählt nach Rang ≥ 1 (Iron zählt nicht), „Ultra oder besser“ nach Rang ≥ 2
  (Titanium, Diamond, Uranium, One of One). Marktfilter nimmt jede bekannte Seltenheit.
- **Bulk:** `quickSell.setRarities.titans_revenge = ["iron"]`; Yin Yang wie gehabt Common und Rare.
- **Aussehen:** Iron im klassischen Rahmen aus dunklem, rostigem Eisen mit Nieten und Funken; Titanium als
  Ausbruch-Rahmen aus gebürstetem Silberblau; Diamond als Vollbild mit Kristallfacetten und Prisma-Funkeln; Uranium
  als Vollbild, das zurücktritt (schwarzer Rand, grüner Schein, nur Name und Fuß als feste Platten), damit das
  riesige Auge wirkt. Folien: Funken (Iron), gebürstet (Titanium), Facetten mit starkem Glitzer (Diamond), pulsierender
  grüner Schein (Uranium). Yin (yy-109) und Yang (yy-110) tragen den Legendary-Rahmen in Tusche statt Gold, schwarz
  und weiß, mit gespiegelten Eckpunkten und dem roten Siegel. Packs: Titans als massive, genietete Panzerplatte mit
  Titanen-Silhouette und glühendem Auge; Yin Yang schwarz-weiß auf Reispapier mit Tuschebergen, großem Ensō samt
  Yin-Yang und einem roten Siegel als einziger Farbe. Set-Symbole: Titanenauge, Yin-Yang. Uranium hat einen eigenen
  Enthüllungston (`pull-uranium.wav`: Geigerzähler, dann ein glühender Akkord); Diamond nutzt den Legendary-Ton.

**Folgen:** Erwartungswerte (Startwerte): Titans 89.901 € je Pack (89,9 %), Yin Yang 4.453 € (222,7 %). Titans ist
das einzige Set, das im Mittel Geld kostet; der Reiz liegt in Uranium (1 in 500, 9,6–39,4 Mio. €). Der Shop-Hinweis
„Raten gelten für alle Sets“ gilt nur noch für die klassischen Sets; die Ratenkarte erklärt die beiden neuen.

**Nachtrag (Wünsche des Besitzers am Starttag):**

- **Erscheinungstermin:** `sets.<set>.releaseAt` (UTC). Titans Revenge und Yin Yang erscheinen am 17.11.2026 um
  17:30 Uhr Berliner Zeit (16:30 UTC). Vorher lehnt der Server Kauf, Mehrfachkauf, versiegelte Packs, Pack Battles,
  das Öffnen und Preis-Gutschriften des Sets ab (`nexamon_set_not_released`, NX310); KI-Packs ziehen nichts, die KI
  bekommt ihren Startbestand erst beim ersten Abgleich nach dem Termin (der Katalog-Hash enthält die erschienenen Sets).
  Der Shop zeigt „Neu ab 17:30“ mit Countdown, das Popup die Karten als Vorschau. Die Demo hält sich an dieselbe Zeit.
- **Ankündigung in den Nachrichten:** `newsShow.announcements` (`at`, `releaseAt`, `sets` mit Karte, Stimmung,
  Überschrift, Text). Genau eine Sendung bringt einen Eintrag: die, deren Sendestunde (volle Stunde von Entwurfszeit
  - 30 Minuten) bei `at` beginnt. `news_announcements_aired` merkt sich diese Stunde; ein neu gebauter Entwurf derselben
    Sendung bekommt die Segmente wieder (er ersetzt den alten), jede andere Stunde nie. Segmentart „release“ mit Ord 1
    (ganz vorn), auf dem Studio-Bildschirm das Pack und eine Karte (Uranium-Auge, Yin). Claudes Umschreiben lässt die
    Segmente unverändert, wie die Running Gags. Die SQL-Tests der Sendung leeren die Liste, damit sie nicht von der Uhr
    abhängen.
- **Mehrere Packs auf einmal:** `buy_nexamon_packs(p_request_id, p_set, p_count)`, 1 bis `packs.maxPerBuy` (10), jedes
  Pack über `buy_nexamon_pack` mit abgeleiteter Request-ID (Zahlung, Ziehung, Missionen, Ratenlimit je Pack), alles oder
  nichts, idempotent. Das Popup hat eine Anzahl mit Gesamtpreis; danach „Pack 2 von 5“, „Nächstes Pack“, nach 4 s
  automatisch weiter, „Alle aufdecken“ zeigt eine Zusammenfassung aller restlichen Packs.
- **Live-Öffnen geht weiter:** Startet das nächste Pack eines Spielers (gekauft, versiegelt oder aus einem Mehrfachkauf),
  solange seine Live-Sitzung läuft oder höchstens `live.continueSeconds` (30) nach ihrem Ende, hängt es an diese
  Sitzung (`nexamon_live.queue`, `pack_no`). Ist das gezeigte Pack ganz aufgedeckt, wechselt sie sofort, sonst sobald
  der Öffner eine Karte des nächsten meldet oder, ohne Meldungen, wenn das gezeigte nach dem Ersatztempo durch ist und
  `lingerMs` vorbei sind. Zuschauer behalten Live-ID und Zuschauerzählung und sehen „Pack 2“. Die Demo macht es nach
  (eigene Packs; der erfundene Freund öffnet zwei Packs in einer Sitzung).

## ADR-183: Firma-Überarbeitung – Ruf für jede Firma, robuste Stunde, „Was jeder leistet“ wie die Abrechnung, flacher Aufbau — `Annahme`

**Kontext.** Aktive Spieler melden: Die Firma ist zu verschachtelt, der Ruf wirkt nicht oder nur teilweise, „Wo es
fehlt“ ist unübersichtlich, „Was jeder leistet“ zeigt Kosten, aber 0 € Leistung. Zusätzlich hing der Live-Deploy
stundenlang an Migration 6600, sodass neuer Client-Code gegen eine alte Datenbank lief. Volle Analyse mit
Funktionskarte: `docs/FIRMA_ANALYSE.md`.

**Befunde (nachgestellt über die echten RPCs auf einer lokalen Datenbank, Client-Abbildung mit echten Antworten).**

1. _Ruf:_ nur `listed_companies.reputation` (notiert), `profiles.reputation` wird nie bewegt. Private Firmen hatten
   keinen Ruf, Interviews rechneten ihn für sie auf 0. Das Ziel notierter Firmen kannte nur Basis, Forschung, Gier,
   Reinvestition, Dividenden und Skandal: Eine ordentlich geführte Firma ohne Auszahlung und Dividende stand exakt bei
   50, der Graph flach. Der Börsengang setzte den Ruf auf 50.
2. _Stunde:_ `listed_hour_after` (Finanzamt, Geschäftsrat, Meldungen, Missionen, fairer Kurs) lief ohne eigene
   Fehlerbehandlung am Ende der Stundenabrechnung. Ein Fehler dort rollte die ganze Stunde der Firma zurück: keine
   Stunde, kein Ruf, „Verlauf“ leer, „bringt 0 €“ (die Meldungen aus ADR-176). Auf Live fehlte ohne 6600 auch die
   Anzeige `close_error`.
3. _„Was jeder leistet“:_ Leistung nur aus den letzten Stunden, ohne Stunde also überall 0 €. Aufgeteilt nach
   Produktivität, obwohl seit ADR-180 Gründer und Spieler zuerst bedienen und KI-Kräfte nur den Rest; KI-Kräfte mit
   vollem Lohn statt nach Auslastung, Spieler mit 8 h statt dem gezahlten Lohn.
4. _„Wo es fehlt“:_ Rechnung richtig, Darstellung unklar (keine Skala, keine Erklärung, kein Was-tun, eingeklappt).
5. _Aufbau:_ bis zu drei Ebenen (Tab → Gruppe → Akkordeon → Karte), 17 Akkordeons, Tutorial-Ziele teils eingeklappt,
   Chat auf dem Handy vor dem Team.

**Entscheidung.**

- **Ruf für jede Firma** (Migration 7300, `src/lib/sim/company-reputation.ts`, Werte `companyHealth.reputation`):
  `player_companies.reputation` für alle, notierte Firmen spiegeln `listed_companies.reputation` (die Quelle aller
  notierten Regeln bleibt). Jede Stunde: Ziel = 50 (notiert: das Aktionärsziel aus ADR-167) + Qualität (−5 bei 0,
  neutral bei 40 %, +10 bei 100 %) + Lieferfähigkeit (−8 × unbedienter Anteil) + Preis (günstig +2, Premium unter der
  Mindestqualität −6) + Löhne (−10 × unbezahlter Anteil) + offene Rechnungen (−6) + Krise (−3 je Stufe) + Kampagne
  (+3), auf 0 … 100 begrenzt; der Wert rückt 8 % der Lücke vor. Nachfrage × (1 + 0,2 × (Ruf − 50) / 50) jetzt auch für
  private Firmen (`listed_hour_effect`, `closeStartupHour.reputationDemandFactor`). Die Stunde speichert Wert, Ziel und
  Treiber (`player_company_hours.reputation*`), `company_state.reputation` liefert sie mit 48 Stunden Verlauf.
  Interviews wirken auf jede Firma (`company_interview_finish`, `interviewEffects`), der Börsengang behält den Ruf
  (`listed_ensure`), Einmaländerungen halten beide Werte gleich (`company_reputation_bump`).
- **Robuste Stunde:** jeder Nebenschritt von `listed_hour_after` in einem eigenen Block; ein Fehler wird als Warnung in
  `job_runs` (`company_hour_step`) vermerkt, steht auf dem Dashboard (`company_state.close_warnings`) und verschwindet
  mit der nächsten guten Stunde. Die Stunde selbst bleibt verbucht.
- **„Was jeder leistet“** (Migration 7310, `staff-value.ts`): `company_hours_json` liefert Nachfrage, Kapazität,
  Stärken-Bonus, KI-Auslastung und gezahlte Löhne; der Client teilt wie die Abrechnung (Menschen zuerst, KI-Kräfte den
  Rest, Auftragsarbeit nach freier Kapazität, Bonus mit den Verkäufen) und nimmt die gezahlten Löhne. Ältere Server
  ohne diese Felder: nach Auslastung, dann nach Produktivität.
- **„Wo es fehlt“:** acht Faktoren und Logik unverändert; Netzdiagramm mit Skala und farbigen Werten, Legende,
  Gesamtwert, größter Hebel mit „Was tun“, Liste nach möglichem Gewinn, je Faktor: was er misst, Grund in Zahlen, was zu
  tun ist, Bezug zur Stärke, möglicher Gewinn, Mira.
- **Aufbau:** Statuszeile unter dem Firmenschild (Zustand, Bekanntheit, Qualität, Ruf, Stärken, je mit „i“). Jeder Tab
  in flache Abschnitte mit Symbol, Titel und Zweck (`FirmSection`, `SubSection`), klebende Sprungleiste
  (`SectionNav`), keine Akkordeons mehr (der Store `sections.ts` entfällt). Kennzahlen und Marketing mit „i“-Erklärung
  (`InfoTip` über die vorhandene Tooltip-Komponente). Deep Links und Mira-Ziele führen auf dieselben Stellen
  (`tabs.ts`), `data-tour` bleibt.
- **Tests:** `company-reputation.test.ts`, `staff-value.test.ts`, `interviews.test.ts`, SQL `c3_firma_qa.sql`, E2E
  `firma-qa.spec.ts`; ältere SQL-Tests, die exakte Nachfragezahlen prüfen, setzen `demandMaxEffect` des Rufs auf 0
  (Vorspann in den Dateien).

**Offen.** Ob auf Live eine Firma an einem Nebenschritt scheiterte, zeigt nach dem Deploy
`select * from job_runs where job_name in ('company_hours', 'company_hour_step')`. `profiles.reputation` (Spieler-Ruf
aus Spec 6.6) bleibt unbenutzt.

## ADR-184: Aktuelle Umsätze an der Börse — `Annahme`

**Kontext.** Der Besitzer wünscht: „Auch an der Börse sollen bei den Unternehmen die aktuellen Umsätze stehen.“

**Entscheidung.** Neue Lese-RPC `get_stock_revenue(p_ticker)` (Migration 7400, nur neue Funktionen, für angemeldete
Spieler). Spielerfirmen: aus `player_company_hours` Umsatz der letzten abgeschlossenen Stunde, Umsatz und Gewinn der
letzten 24 h, die 24 h davor je Stunde auf gleich viele Stunden umgerechnet (Trendpfeil), Ruf und Bekanntheit.
KI-Firmen: letzter veröffentlichter Quartalsbericht (mit Spieljahr und Quartal), das Quartal davor für den Trend.
Nur diese Summen verlassen den Server; Bekanntheit und Qualität zeigt die Firmenseite (ADR-051) schon heute allen.
Marktliste: eine Zeile „Umsatz 24 h … €“ bzw. „Umsatz Quartal … €“ mit Pfeil; Detailseite: Karte „Geschäftszahlen“
mit kleinem Balkenverlauf (24 Stunden bzw. 8 Quartale). Sichtbar ab Level 2 (`stockFigures`), wie die Kennzahlen.

**Folgen.** Eine Anfrage für die ganze Liste (2 min frisch). Im Demo-Modus sind die KI-Quartale aus der Größe abgeleitet.

## ADR-185: Mira liest Fakten statt Vermutungen – Prüfung aller Regeln, Knöpfe nur, wenn sie gehen, mehr Fragen — `Annahme`

**Kontext.** Der Owner: „Mira sagt manchmal Sachen, die nicht stimmen, sie schickt dich manchmal wohin, wo es nichts
zu tun gibt. Mira liegt oft sehr falsch. Sie muss viel mehr Kapazität haben.“ Seit ADR-138 sind die Firma
(ADR-176 Stärken, ADR-180 Wirtschaft und Autopilot, ADR-183 Ruf und flacher Aufbau) und die Tabs (`tabs.ts`) stark
umgebaut worden; Miras Regeln (`assistant/brain.ts`) lasen aber nur Aufgaben, Züge, die acht Faktoren und die
Börsendaten, und ihre Links zeigten noch auf die alten Bereiche.

**Prüfung (jede Regel gegen das heutige Spiel).** Geprüft wurden Bedingung (Einheiten bps/Prozent/Anteil, Cent/Euro,
von ADR-176/180/183 ersetzte Felder, privat/börsennotiert, Demo/Live), Text und Ziel (gibt es die Stelle, ist die
Aktion dort jetzt möglich).

|   # | Regel                                          | Urteil                       | Befund und Änderung                                                                                                                                                                                                    |
| --: | ---------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Aufgabe melden und beraten (`adviseTask`)      | falscher Text                | „voller Wert“ ohne den Stärken-Lohnfaktor (ADR-180, 0,9× bis 1,5×); KI-Chance ohne den Bonus einer passend geschulten KI-Kraft. Jetzt beides wie auf dem Server.                                                       |
|   2 | Warnung bei überlasteter Person (`warningFor`) | ok                           | –                                                                                                                                                                                                                      |
|   3 | Krise/Chance melden                            | ok                           | Link „Lage“ bleibt.                                                                                                                                                                                                    |
|   4 | Geschäftszüge vorschlagen                      | falsche Bedingung            | „Freier Auftrag“ stand auch während der Stunde Pause da und scheiterte. Jetzt nur, wenn einer starten kann.                                                                                                            |
|   5 | Freier Auftrag (`orderTurn`)                   | ok                           | –                                                                                                                                                                                                                      |
|   6 | Bewerbungen                                    | veraltet                     | Link auf den ganzen Mitarbeiter-Tab; jetzt direkt „Bewerbungen“.                                                                                                                                                       |
|   7 | Ruhe und Beispiele                             | ok                           | Um „Was soll ich tun?“, „Lagebericht“, „Warum Verlust?“/„Mehr Umsatz?“ erweitert.                                                                                                                                      |
|   8 | Plan für alle Aufgaben                         | ok                           | –                                                                                                                                                                                                                      |
|   9 | Analyse                                        | ok                           | Jetzt mit Lagebericht in Zahlen; Knöpfe geprüft.                                                                                                                                                                       |
|  10 | Dringende Aufgaben                             | ok                           | –                                                                                                                                                                                                                      |
|  11 | Ergebnisse                                     | ok                           | –                                                                                                                                                                                                                      |
|  12 | Schwächster Faktor (Briefing)                  | ok                           | Knöpfe, die schon ein Rat zeigt, fallen weg.                                                                                                                                                                           |
|  13 | Hebel Marketing                                | falscher Text                | „über das ganze Quartal“ – seit ADR-180 wirkt Marketing jede Stunde. Jetzt mit „+Y Punkte je Stunde“.                                                                                                                  |
|  14 | Hebel Kampagne                                 | falscher Text                | Erfolgsmeldung verwies auf die „Übersicht“ (gibt es nicht mehr); jetzt Controlling › Marketing.                                                                                                                        |
|  15 | Hebel Preis                                    | falsche Bedingung            | Preisbindung des Geschäftsrats (börsennotiert) ignoriert; der Knopf scheiterte.                                                                                                                                        |
|  16 | Hebel Auftragsarbeit                           | ok                           | –                                                                                                                                                                                                                      |
|  17 | Hebel KI-Kräfte einstellen                     | falsche Bedingung            | Freie Plätze nicht geprüft (`employee_limit`).                                                                                                                                                                         |
|  18 | Hebel KI-Kräfte entlassen                      | ok                           | –                                                                                                                                                                                                                      |
|  19 | Hebel Fähigkeit (KI-Kraft mit Fähigkeit)       | falsche Bedingung            | Schon abgedeckte Fähigkeit nicht geprüft (`skill_already_covered`).                                                                                                                                                    |
|  20 | Hebel Schulung                                 | toter Link                   | Schulungen gibt es erst ab Teamgröße und nur mit Spielern im Team (in der Demo nie); jetzt nur dann.                                                                                                                   |
|  21 | Hebel Ausbau                                   | toter Link                   | Ziel „business“ (Betrieb), der Ausbau liegt unter „Ausbau“; jetzt dort und, wenn die Kasse reicht, direkt als Knopf.                                                                                                   |
|  22 | Hebel Rechtsform                               | toter Link                   | Ziel „boss“ = Marketing-Regler; jetzt „Ausbau“ und nur, wenn die nächste Rechtsform möglich ist.                                                                                                                       |
|  23 | Hebel Aufgaben (Plan, selbst, KI automatisch)  | ok                           | Autopilot (ADR-180) als eigener Knopf ergänzt.                                                                                                                                                                         |
|  24 | Hebel Krise                                    | falscher Text                | „Krise in der Übersicht ansehen“; jetzt „Lage im Dashboard“.                                                                                                                                                           |
|  25 | Hebel Einzahlen                                | ok                           | –                                                                                                                                                                                                                      |
|  26 | Hebel Geschäftszug                             | ok                           | –                                                                                                                                                                                                                      |
|  27 | Bücher (börsennotiert)                         | ok                           | –                                                                                                                                                                                                                      |
|  28 | Steuer                                         | ok                           | –                                                                                                                                                                                                                      |
|  29 | Stimmung                                       | ok                           | –                                                                                                                                                                                                                      |
|  30 | Geschäftsrat                                   | ok                           | –                                                                                                                                                                                                                      |
|  31 | Forschung                                      | ok                           | –                                                                                                                                                                                                                      |
|  32 | Gier (Auszahlungen)                            | falscher Text, falscher Link | „kostet schon −4 % Nachfrage“ (Vorzeichen) und „kostet“, obwohl der Ruf über 50 noch hebt; Link auf die Dividende statt auf die CEO-Auszahlung. Jetzt eigener Text über 50, Betrag ohne Vorzeichen, zuerst Auszahlung. |
|  33 | „Kein Knopf“-Antwort                           | veraltet                     | „Schau in der Übersicht“; jetzt Dashboard › „Wo es fehlt“.                                                                                                                                                             |
|  34 | Beschriftung von Links (`describeAction`)      | falscher Text                | Jeder Link außer dem Team hieß „Fertige Wege ansehen“; jetzt je Ziel („Zu Ausbau und Rechtsform“ …).                                                                                                                   |
|  35 | Vorschläge von Claude (`validActions`)         | falsche Bedingung            | Nur die Rolle geprüft; jetzt dieselbe Prüfung wie jeder Knopf.                                                                                                                                                         |

**Ergebnis:** 16 von 35 Regeln waren falsch: 3 tote Links (Schulung, Ausbau, Rechtsform), 5 falsche Bedingungen
(Auftrag in der Pause, Preisbindung, freie Plätze, abgedeckte Fähigkeit, Claude-Vorschläge), 6 falsche Texte
(Aufgabenwert und KI-Chance, Marketing je Quartal, Kampagne, Krise, Gier samt Link, Linkbeschriftung) und 2 veraltete
Ziele (Bewerbungen, „Übersicht“). Gemeinsame Ursache: Mira kannte Geld, Stunde,
Bekanntheit, Ruf, Stärken und Autopilot nicht und prüfte nie, ob ein Knopf gerade geht.

**Entscheidung.**

- **Fakten** (`assistant/facts.ts`, `companyFacts`): ein typisierter Schnappschuss aus denselben Abfragen wie die
  Seite: Kasse und freie Kasse, offene Rechnungen, Reichweite der Kasse, letzte Stunde (Umsatz, Kosten nach Posten,
  Gewinn, Lohnfaktor), 24 Stunden, Nachfrage gegen Kapazität, KI-Auslastung und Kräfte ohne Arbeit samt Ersparnis
  (`aiWageDueCents`), Bekanntheit mit Deckel und Hebeln der letzten Stunde, Marketing-Vorschlag und was er je Stunde
  bringt (Formel aus `awarenessHour`/`marketingGain`, an der echten Marketing-Wirkung der letzten Stunde geeicht),
  Qualität, Preis und Preisbindung, Ruf mit Treibern und Nachfragewirkung, Stärken mit nächster Bonusstufe, Diagnose,
  Team und freie Plätze, Ausbau/Rechtsform/Börsengang, Kampagne, Aufgaben und Schwung, Autopilot, Züge, freier
  Auftrag, Krise, Interview, Börsendaten (Stimmung, Steuer, Bücher, Rat). Einheiten: Cent, bps, Punkte 0–100.
- **Regeln** (`assistant/advisor.ts`): 19 Regeln über die Fakten (Rechnungen offen, Kasse reicht nur Stunden,
  Verlust, KI-Kräfte im Leerlauf, Marketing zu niedrig, Marketing am Deckel, Auftragsarbeit, besserer Preis, Premium
  ohne Qualität, ausverkauft, Kampagne, Ausbau, Rechtsform, Autopilot, Ruf, Stärken-Bonus, fehlende Fähigkeit,
  Interview, Börsengang). Jede rechnet mit den Formeln des Spiels aus, was sie je Stunde bringt (z. B. Auftragsarbeit
  = freie Kapazität × 25 % × 30 % Marge; Kampagne = Mehrnachfrage bis zur freien Kapazität × Rohertrag, nur wenn das
  mehr ist als die Kosten) und nennt die Zahl. Alarme zuerst, sonst nach Euro je Stunde; von selbst meldet Mira
  alle Alarme und die zwei besten Ratschläge (`companyAssistant.advice`).
- **Nur Knöpfe, die gehen** (`actionEnabled`): jede Aktion wird gegen die Fakten geprüft wie der Server (Kasse,
  Plätze, Pause, Preisbindung, laufende Kampagne, unveränderte Werte). Ein Rat ohne gültigen Knopf wird nicht
  gezeigt; Briefings, Antworten und Claude-Vorschläge laufen durch dieselbe Prüfung.
- **Links:** `open` trägt nur noch eine Abschnitts-ID aus `tabs.ts` (`CompanySection`); `sectionAvailable` blendet
  Börsen-Abschnitte und Schulungen aus, wenn es sie nicht gibt. Neue IDs `applications`, `interview`.
- **Fragen:** „Warum mache ich Verlust?“, „Wie mache ich mehr Umsatz?“ (Engpass Nachfrage oder Kapazität), „Was soll
  ich als Nächstes tun?“, „Lagebericht“, „Was bringt der Ruf?“, „Was bringen die Stärken?“, „Lohnen sich meine
  KI-Kräfte?“, „Autopilot an/aus“ und Fragen dazu, „Erklär mir …“ zu jedem Faktor (Bekanntheit mit Hebeln der
  Stunde). „Wie läuft die Firma?“ beginnt mit dem Lagebericht.
- **Claude** (`company-assistant`): bekommt die Fakten als `<fakten>` (Euro und Punkte, höchstens 120 Werte) und die
  Regel, keine Zahl zu erfinden und „Das weiß ich nicht“ zu sagen, was dort fehlt. Ohne Schlüssel antwortet die
  deterministische Mira auf alle Fragen oben selbst.

**Tests.** `advisor.test.ts`: jede Regel mit Fakten, die sie wahr und falsch machen, und ihren Zahlen; jeder
angebotene Knopf ist für seine Fakten möglich; jeder Abschnitt aus `tabs.ts` ist ein Element der Seite; jeder Link
Miras hat eine Beschriftung und ist sichtbar; Fragen und Antworten; alle Textschlüssel existieren. E2E
`mira-advice.spec.ts` (Demo): Lagebericht, „Was soll ich tun?“, der erste Vorschlag läuft ohne Fehler.

**Folgen.** Die Ratschläge sind Schätzungen „ca. je Stunde“ auf der letzten Stunde; die Marktgröße ist verborgen
(Mitte der Spanne, geeicht mit der letzten Stunde). `game_config` hat neue Werte unter `companyAssistant.advice`
(Seeds neu erzeugt, keine Migration).

## ADR-189: Die Vorschau ist die Ausführung, große Orders zu fairem Preis ohne Größengrenze — `Annahme`

Vorgabe des Besitzers: „Wenn man Aktien verkauft, bekommt man manchmal nur die Hälfte. Ich habe gerade für über 100k
verkauft und nur 50k bekommen. Beim Kaufen ist der Fehler auch ab einer bestimmten Zahl.“ Umsatzzeile:
„58.877,583251 × 0,8489 € · Gebühr 1,00 € · G/V −46.202,24 €“; die Order-Maske zeigte vorher über 100.000 €.

**Ursache (nachgestellt auf der lokalen Datenbank, `supabase/tests/c7_order_fill.sql`, Abschnitt B):**

- Die Order-Maske rechnete **Stückzahl × Geld-/Briefkurs** (58.877,58 × 1,63 € ≈ 96.000 €) und kannte die
  Kursauswirkung nicht.
- Der Server füllt seit ADR-126 entlang der Spieler-Tiefe: Für Pennystocks (alle Spieleraktien) bewegen 1.000 € den
  Kurs um 1 % (`playerImpact.depthCentsPer100Bps.penny`). Eine Order zahlt im Schnitt die halbe eigene Bewegung.
  96.000 € bewegen den Kurs um 96 %, der Durchschnitt liegt also 48 % unter dem Geldkurs: 1,63 € → 0,848 €,
  Erlös 49.916 € (Live: 0,8489 €, 49.981 €). Es gab **keine Grenze**: `maxImpactBpsPerOrder` stand in der
  Konfiguration, galt aber nur in der alten TS-Schätzung, nicht in `place_order`. Ab rund 200.000 € wäre der Kurs bis
  auf den Mindestpreis gefallen.
- Der Kauf hat dasselbe Problem nach oben (100.000 € in eine Spieleraktie: Ø +50 %). Der Kurs vor dem Verkauf war also
  nicht schon gefallen; **die Order selbst** hat ihn von 1,63 € auf 0,85 € im Schnitt gedrückt.
- Nicht die Ursache: Steuer (25 % nur auf Gewinne, Gründeraktien werden nicht anders besteuert; beim Verkauf mit
  Verlust 0 €), das Tagesband aus ADR-170 (begrenzt den Takt-Kurs, nicht die Ausführung) und die Buchung (der Verkäufer
  bekommt genau Brutto − Gebühr − Steuer auf `player_cash`, die Gebühr geht an den Staat).

**Entscheidung** (mit dem Wunsch des Besitzers: „Man soll generell von Aktien so viele auf einmal kaufen wie man will
… keine Sperre bei 100k. So viel kaufen und verkaufen, wie man mag.“):

- **Ein Plan für Vorschau und Ausführung:** `market_order_plan()` (SQL) = `planMarketOrder()`
  (`src/lib/sim/order-fill.ts`). `quote_order(ticker, side, menge | betrag)` liefert ihn samt Gebühr und Steuer
  (FIFO-Lose, Verlusttopf wie `execute_fill`) für die Maske; `place_order` führt bei Sofort-Orders genau diesen Plan
  aus. Beträge werden entlang des Preispfads gelöst (Bisektion), ein Kauf gibt nie mehr als den Betrag aus.
- **Fairer Preispfad statt Grenze:** Die n-te Aktie bewegt den Kurs um `min(a × n, maxTickReturnBps)`. Kleine Orders
  zahlen wie bisher die halbe eigene Bewegung (ADR-126). Mehr als ein Takt den Kurs bewegen kann (10 %,
  `trading.maxTickReturnBps`), kann auch eine Order ihn nicht bewegen; darüber hinaus füllt jede weitere Aktie zum
  gesättigten Preis. Eine Order zahlt so im Schnitt höchstens knapp 10 %, egal wie groß. Ein Hin und Her lohnt sich
  weiter nicht: der Takt hebt den Kurs höchstens um dieselben 10 %, die der Käufer schon im Schnitt fast bezahlt hat
  (Test „a round trip never earns the own move“).
- **Keine Größengrenze:** Jede Menge wird ganz ausgeführt; `trading.maxOrderQuantity` ist nur noch eine technische
  Schranke (1 Mrd. Stück). Grenzen sind allein Guthaben, Depotbestand und der freie Bestand der Aktie (ADR-153,
  `limited_by = 'supply'` mit `unfilled_quantity_e6`, in Vorschau und Ergebnis).
- **Tagesband (ADR-170):** Keine Aktie einer Spielerfirma wird jenseits des Bands ausgeführt; die Order wird trotzdem
  ganz ausgeführt, Aktien jenseits des Bands zum Bandpreis (nie über dem Geld- bzw. unter dem Briefkurs). Bei
  ±100 %/−50 % und höchstens 10 % Bewegung je Order greift das nur, wenn der Kurs schon am Band steht.
- **Die Maske zeigt den Plan:** Ø Ausführungskurs, Kursauswirkung (±%), „Du erhältst ca. X €“ / „Du zahlst ca. X €“.
  Ab 5 % Kursauswirkung (`trading.highImpactWarnBps`) ein Warnhinweis mit dem genauen Betrag; bestätigt wird mit dem
  Halteknopf erst, wenn der Plan da ist. Limit-Orders bleiben unverändert (im Spiel ausgeblendet, ADR-117).
- Verworfen: eine Grenze je Order mit Teilausführung (erster Entwurf; der Besitzer will beliebig große Orders), die
  Spieler-Tiefe allgemein erhöhen (Pumpen würde wieder billig), nur warnen ohne fairen Preis.

**Zahlen vorher/nachher** (Geldkurs 1,63 €, `c7_order_fill.sql`):

| Order                                   | vorher                               | nachher                                                  |
| --------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| Verkauf 58.877,58 Stück Spieleraktie    | Ø 0,848 €, 49.916 €; Maske: 96.000 € | ganz, Ø 1,4755 € (−9,5 %), ca. 86.870 €, Maske = Buchung |
| Kauf 100.000 € Pennystock               | Ø +50 %                              | ganz, Ø knapp +9,5 %                                     |
| Kauf 100.000 € Blue Chip                | Ø +2,4 %                             | unverändert, Kursauswirkung +4,9 % angezeigt             |
| Kauf 1.000.000 € Spieleraktie/Blue Chip | Ø weit über +100 % bzw. +25 %        | ganz, Ø knapp +10 % bzw. +9 %                            |

Folgen: Große Positionen lassen sich in einem Zug handeln und kosten höchstens rund 10 % Kursauswirkung. Mit 4 Spielern
zählt der ausstehende Spielerfluss des Takts für alle zusammen. Tests: `src/lib/sim/order-fill.test.ts`,
`supabase/tests/c7_order_fill.sql`, `e2e/order-fill.spec.ts`.

**Entschädigung:** Die Verkäufe mit großer Kursauswirkung findet auf Live (nur lesend):

```sql
select t.executed_at, p.nickname, s.ticker, t.quantity_e6 / 1e6 as stueck, t.price_e4 / 1e4 as kurs,
       q.prev_close_e4 / 1e4 as vortag, t.gross_cents / 100.0 as brutto, t.fee_cents / 100.0 as gebuehr,
       t.tax_cents / 100.0 as steuer, t.realized_pnl_cents / 100.0 as gv,
       (select e.amount_cents / 100.0 from public.ledger_entries e
          join public.ledger_accounts a on a.id = e.account_id
         where e.transaction_id = t.ledger_transaction_id and a.owner_player_id = o.player_id
           and a.kind = 'player_cash') as gutschrift
  from public.trades t
  join public.orders o on o.id = t.order_id
  join public.profiles p on p.id = o.player_id
  join public.securities s on s.id = o.security_id
  left join public.security_quotes q on q.security_id = s.id
 where o.side = 'sell' and t.gross_cents >= 1000000
 order by t.executed_at desc
 limit 50;
```

## ADR-188: Bekanntheit neu – ein Wert, eine Regel, sichtbare Obergrenze, jede Änderung gebucht — `Annahme`

**Kontext.** Der Besitzer: „Die Bekanntheit ist immer noch verbuggt … Mach die Bekanntheit nochmal neu.“ Screenshot:
„Stärke Bekanntheit“ 4/100 nach drei Stunden, die Diagnose zeigt gleichzeitig „Bekanntheit 49 %, nötig wären 77 %“,
und nichts, was man tut, scheint sie zu bewegen.

**Ursachen (im Code und auf einer lokalen Datenbank nachgestellt).**

1. _Versteckte Obergrenze:_ `stages.awarenessCaps` deckelte eine Garage ohne Fachwissen bei 50 %, ohne dass es irgendwo
   stand. Bei 49 % brachte Marketing nichts mehr; die Diagnose verlangte trotzdem 77 % (sie rechnete den Bedarf gegen
   die Kapazität, nicht gegen die Grenze), also eine Forderung, die niemand erfüllen konnte.
2. _Starker Verfall gegen festes Marketing:_ ADR-180 nahm jede Stunde 2 % des Werts weg und gab Marketing als festen
   Betrag. Eine Firma mit wenig Budget pendelte sich irgendwo ein, ohne Werbung verlor sie rund 40 % am Tag; mehr
   Budget half nur bis zur versteckten Grenze.
3. _Stärke lief der Bekanntheit hinterher:_ Die Stärke „Bekanntheit“ startete bei 0 und rückte 2 % der Lücke je Stunde
   vor (Ziel 100 × a / 50 %). Drei Stunden nach dem Start standen 4/100 neben 49 % Bekanntheit.
4. _Viele Schreiber, keine Spur:_ Kampagnen (mit dem Stufendeckel), gelöste Ereignisse, Interviews, Geschäftszüge,
   eigene Züge, Proteste und die Nachrichtensendung schrieben `player_companies.awareness` jeder auf eigene Art, ohne
   oder mit anderem Deckel und ohne Protokoll. Nur Aufgaben erschienen als „extra“ in der Stunde.

**Entscheidung: ein Modell (`src/lib/sim/awareness.ts`, gleich in SQL).**

- _Ein Wert_ je Firma (`player_companies.awareness`, 0 … 1). Nachfrage, Börsenwert, Stärken, Diagnose, Mira und
  Nachrichten lesen dasselbe Feld.
- _Obergrenze_ `awarenessCap(tier, stage, expansion)` = Rechtsform (Garage 60 %, Kleinunternehmen 70 %, GmbH 80 %,
  AG 90 %) + 5 Punkte je Fachwissen-Stufe + 3 Punkte je Ausbaustufe, höchstens 100 %. Sie steht auf der Seite mit
  ihrer Herleitung („60 % als Garage, +5 für Stufe 1, +0 für Ausbaustufe 0“).
- _Jede Stunde_ (`awarenessHour`, SQL `company_awareness_step`):
  Marketing `rate × (Grenze − a)` mit `rate = 6 % × q / (q + H)` (q = Stundenbudget × 6, H = max(500 €, Markt/4 ×
  1 %)): das vorgeschlagene Budget schließt 3 % der Lücke je Stunde, doppeltes Budget weniger als doppelt so viel.
  Mundpropaganda `0,8 % × a × (1 − a/Grenze) × (0,5 + Qualität) × Preisstrategie × bedienter Anteil × (0,5 +
Ruf/100)`. Vergessen `0,4 % × (a − 2 %)` je Stunde, Untergrenze 2 %. Über der Grenze (z. B. ein Fachmann ging) nur
  Vergessen, kein harter Sprung.
- _Einzelne Ereignisse_ gehen alle durch `company_awareness_add(firma, quelle, delta)`: Zuwachs bis zur Grenze, Verlust
  bis zur Untergrenze. Aufgaben +0,5 Punkte (KI und Autopilot die Hälfte), Kampagnen +3/+6/+12 (Flyer/Online/TV),
  Geschäftszüge, Interviews, Nachrichten, eigene Züge, Proteste und Ereignisse mit ihren bisherigen Werten.
- _Ein Protokoll:_ `company_awareness_log` (Firma, Stunde, Quelle, Summe) nimmt jede Änderung auf, auch die drei Teile
  der Stunde (Vergessen nimmt eine Rundung an den Grenzen mit, damit die Summe stimmt). `get_company_awareness()`
  liefert Wert, Grenze und Herleitung, Stärke, die letzte Stunde nach Quellen, „seitdem“ und 24 Stunden Verlauf; die
  Stunde selbst speichert ihre Quellen in `awareness_parts.sources`. Baustein `AwarenessBreakdown`
  (`src/features/company/awareness/`) zum Einhängen auf der Firmenseite.
- _Stärke und Diagnose:_ Die Stärke „Bekanntheit“ ist `100 × a / Grenze` und folgt mit 25 % der Lücke je Stunde (in
  beide Richtungen, `awarenessFollowPerHour`); die übrigen fünf Stärken bleiben langsam. Die Diagnose misst gegen
  `min(Bedarf, Grenze)` und nennt die Grenze („erreichbar wären 60 % (Obergrenze 60 %)“), an der Grenze heißt es
  „Mehr geht jetzt nicht … steigt mit Stufe, Ausbau und Rechtsform“.
- _Umstellung (Migration 7730, einmal):_ Jede aktive Firma behält ihren Stand relativ zur Grenze: `a / alte
Stufengrenze × neue Grenze` (eine Garage bei 49 % von 50 % steht danach bei 59 % von 60 %), gebucht als „rescale“;
  die Stärke wird auf `100 × a / Grenze` gesetzt. `public.data_migrations` verhindert eine Wiederholung.

**Messung (Garage, Median-Markt 33.700 €/Jahr, Qualität 50 %, vorgeschlagenes Marketing 500 €/Quartal, Bekanntheit in
%, `src/lib/sim/awareness.test.ts` „harness“).**

| Stunde | ohne Marketing | vorgeschlagenes Marketing | Marketing + 1 Aufgabe/h + Flyer täglich |
| -----: | -------------: | ------------------------: | --------------------------------------: |
|      0 |            3,0 |                       3,0 |                                     3,0 |
|      1 |            3,0 |                       4,7 |                                     8,1 |
|      3 |            3,1 |                       8,0 |                                    12,2 |
|      6 |            3,1 |                      12,7 |                                    17,9 |
|     12 |            3,2 |                      20,8 |                                    27,8 |
|     24 |            3,5 |                      33,0 |                                    42,4 |
|     48 |            4,0 |                      46,1 |                                    58,5 |
|     72 |            4,5 |                      51,2 |                                    59,8 |
|     96 |            5,1 |                      53,2 |                                    59,8 |
|    168 |            7,1 |                      54,3 |                                    59,8 |

Doppeltes Budget: 38,7 % nach 24 h, 55,1 % nach 96 h. Die Stärke „Bekanntheit“ bei 49 % von 60 %: 47/100 nach drei
Stunden, 82/100 nach einem Tag (vorher, mit 49 % von 50 %: 6/100 und 37/100). Auf einer lokalen Datenbank (`c6_awareness.sql`): sechs
abgeschlossene Stunden mit vorgeschlagenem Marketing heben eine neue Garage von 3 % auf rund 12,7 %, ohne Marketing
bleibt sie bei gut 3 %.

**Folgen.** `stages.awarenessCaps` ist nur noch Anzeige (Garage je Stufe), `companyHealth.strengths.awarenessFull`
entfällt. `company_awareness_hour` (6 Argumente) ist gelöscht, `company_awareness_boost` ist ein Aufruf von
`company_awareness_add(…, 'tasks', …)`. Die Quartalsabrechnung bewegt die Bekanntheit nicht (wie seit ADR-180).

**Offen.** Die Firmenseite (andere Baustelle) hängt `AwarenessBreakdown` ein; `growth-path.tsx` liest weiter die
Anzeige-Grenzen der Garage.

## ADR-199: Talente – 15 Stellen, Talentmarkt, Abwerben und Mit-Geschäftsführung — `Annahme`

**Kontext.** Wunsch des Inhabers: „Man soll nun auch echte Leute mit Namen einstellen können statt KI, aber auch vom
Spiel. Diese haben hohe Ansprüche, bringen aber auch hohen Umsatz. Man braucht jetzt weitere Branchen im Unternehmen …
15 Stellen und jeweils einen Mitarbeitermarkt … man kann sie von anderen Spieler-Unternehmen abwerben … Wenn was
nicht passt, kündigen sie.“ Nachtrag: „Die neuen Mitarbeiter stehen in der Hierarchie auch weiter oben als die KI und
können auch Mit-Geschäftsführer werden und Entscheidungen treffen.“

**Entscheidung.**

- **Talente sind Spielfiguren, keine Spieler.** KI-Kräfte (ADR-180) und Spieler-Mitarbeiter (`player_jobs`) bleiben
  unverändert. KI-Firmen beschäftigen keine Talente.
- **15 Stellen, je eine pro Firma, ab der Gründung** (unabhängig von Rechtsform und Ausbau; bessere Talente verlangen
  aber eine höhere Rechtsform). Unbesetzte Stellen stehen als Lücke im Raster.

  | Stelle        | Wirkung (Junior → Legende, neutrale Persönlichkeit)  |
  | ------------- | ---------------------------------------------------- |
  | Vertrieb      | Nachfrage +3 … +19,5 %                               |
  | Marketing     | Bekanntheit +0,12 … +0,78 Punkte je Stunde           |
  | Kundenservice | Nachfrage +2 … +13 %                                 |
  | Strategie     | Nachfrage +2,2 … +14,3 %                             |
  | Produktion    | Kapazität +3 … +19,5 %                               |
  | Logistik      | Kapazität +2 … +13 %                                 |
  | IT            | Kapazität +2,2 … +14,3 %                             |
  | Betriebsarzt  | Kapazität +1,5 … +9,75 % (weniger Krankheit, Stress) |
  | Einkauf       | Wareneinsatz −1,2 … −7,8 %                           |
  | Controlling   | Fixkosten −2,2 … −14,3 %                             |
  | Buchhaltung   | Fixkosten −1,5 … −9,75 %                             |
  | Wissenschaft  | Qualität +0,7 … +4,6 Punkte                          |
  | Qualität      | Qualität +0,5 … +3,3 Punkte                          |
  | Recht         | Ruf +0,04 … +0,26 je Stunde (weniger Skandale)       |
  | Personal (HR) | Zufriedenheit aller anderen Talente +0,6 … +3,9 %/h  |

  Deckel der Summe: Nachfrage +35 %, Kapazität +35 %, Wareneinsatz −15 %, Fixkosten −25 %, Qualität +8 Punkte,
  Bekanntheit +0,6 Punkte/h, Ruf +0,3/h, Zufriedenheit +6 %/h. „Umsatz und Aktie steigen immens“: eine voll besetzte
  Firma mit Spitzenleuten verdient ein Vielfaches, aber begrenzt; der Kurs folgt über den fairen Wert
  (`listed_hour_after`), Bekanntheit nur über `company_awareness_add`, Ruf über `company_reputation_bump`.

- **Talentmarkt:** 44 Talente je Stelle (660), deterministisch erzeugt (`src/config/talents.ts`, eigener LCG, kein
  `Math.random`), eindeutige, erfundene deutsche Namen, Pixel-Porträt aus `avatars.ts`, zwei Eigenschaften aus 13
  (Ehrgeizig, Loyal, Diva, Teamplayer, Workaholic, Nachteule, Familienmensch, Sportlich, Vorsichtig, Risikofreudig,
  Führungskraft, Perfektionist, Idealist), Stufe Junior/Profi/Senior/Experte/Legende (14/12/10/6/2 je Stelle). Der Pool
  geht mit `pnpm db:config` nach `game_config.talents.pool`; `talents_ensure()` legt die Zeilen an. Freie Talente sind
  an einem Berliner Tag zu 65 % „auf dem Markt“ (Hash aus Schlüssel und Tag), Gekündigte machen 12 Stunden Pause.
  Angestellte Talente sieht jeder mit Arbeitgeber.
- **Forderungen:** Lohn je Stunde (Stufe × Stelle × Eigenschaften, ganze Euro), Benefits (Homeoffice, Firmenwagen,
  Bonus, Weiterbildung, Mitspracherecht, Büro-Ausstattung – braucht Ausbau ≥ 1 –, Fitness, Gleitzeit; je Stufe 0–3
  plus Wünsche der Eigenschaften), Ruf mindestens, Bekanntheit mindestens, Rechtsform mindestens (Senior
  Kleinunternehmen, Experte GmbH, Legende AG) und eine freie Kasse für 12 Stunden Lohn und Benefits. Benefits kosten
  einen Anteil des Lohns (0–15 %).
- **Einstellen:** `talent_offer` prüft alle Forderungen (`talentOfferChecks`, dieselbe Liste live im Angebot).
  Erfüllt → sofort angestellt, sonst `demands_not_met`. Eine Stelle hat genau ein Talent (`seat_taken`).
- **Abwerben** (nur von Spielerfirmen): Das Angebot muss alle Forderungen erfüllen und die Stundenkosten des jetzigen
  Vertrags um 15 % plus Loyalität der Eigenschaften (Loyal +25 %, Familienmensch +10 %, Diva −10 % …) übertreffen.
  Dann entsteht ein offener Abwerbeversuch; der Chef bekommt eine Benachrichtigung und kann 15 Minuten nachbessern
  (`talent_counter`: mindestens so teuer wie das Abwerbeangebot, Zufriedenheit +10 %). Sonst wechselt das Talent,
  wenn der Abwerber alle Forderungen noch erfüllt und die Stelle frei ist. Je Talent ein Versuch zur Zeit.
- **Jede volle Stunde seit Einstellung** (`talents_run_due`, Cron jede Minute): Lohn + Benefits über das Ledger
  (Firmenkasse → Haushalte, Summe 0, offene Rechnungen zuerst); reicht die Kasse nicht, wird nichts gebucht und das
  Talent wird unzufrieden. Zufriedenheit: +2,5 % wenn alles erfüllt, sonst −25 % (unbezahlt), −8 % (Ruf zu niedrig),
  −4 % (Bekanntheit), −6 % (Benefits fehlen), mal Empfindlichkeit der Eigenschaften, plus HR. Unter 35 %: Warnung an den
  Chef; bei 10 % Kündigung, die Wirkung endet sofort.
- **Hierarchie:** Talente leiten ihre Stelle, KI-Kräfte berichten an sie (Anzeige im Stellenraster und Talentblatt).
  Im Organigramm (ADR-104, `get_company_org`, für alle Spieler offen) stehen die Talente als eigene Ebene unter den
  Spieler-Rängen und über den KI-Kräften, Mit-Geschäftsführer zuerst und markiert; gezeigt werden nur Name, Porträt,
  Stelle und Stufe (kein Lohn, keine Zufriedenheit). Migration `20261204010200_talents_after_clone.sql` kopiert dafür
  die letzte Fassung aus 0100 (Aufgaben); sie läuft nach Klon und Jobs (ADR-206, 9800/9810), deren neu geschriebene
  Team- und Jobfunktionen keine Talent-Logik tragen.
- **Mit-Geschäftsführung:** ab Senior (Führungskraft ab Profi), höchstens 2 je Firma, Lohn ≥ Forderung × 1,3 und
  Mitspracherecht. Befugnis „Beraten“ (nur Empfehlungen) oder „Entscheiden“ mit Tagesbudget (≤ 100.000 €). Einmal je
  Stunde: auf ein offenes Ereignis nach 30 Minuten eine Strategie wählen (vorsichtig = höchste Abmilderung,
  risikofreudig = wenigste Schritte, sonst Abmilderung je Schritt), den bestehenden Autopiloten einschalten (ADR-180;
  nicht erneut, wenn der Chef das zurückgenommen hat) und die günstigste lernbare Fertigkeit (ADR-194, gleiche Regeln
  und Buchung) im Restbudget kaufen (vorsichtig: höchstens die Hälfte). Jede Entscheidung steht mit Namen im Verlauf,
  in den Firmennachrichten und als Benachrichtigung; Strategie und Autopilot kann der Chef rückgängig machen
  (`talent_undo_decision`), Käufe nicht. Preise, Marketing und Bewerbungen entscheidet die Mit-GF vorerst nicht.
- **Schnittstelle:** `listed_hour_effect` (vollständige Kopie der Fassung aus 8300) multipliziert
  `talents_hour_effect` ein; `player_company_close_hour` bleibt unangetastet. Die Mit-GF hängt am Haken
  `talents_coceo_run` (8900 leer, 8910 befüllt).
- **Oberfläche:** Mitarbeiter-Tab, Abschnitt „Stellen & Talente“ (Offenlegung `companyTalents`, Stufe 3) mit
  Umschalter Stellen/Talentmarkt, Talentblatt, Angebotsblatt mit Live-Prüfung, Mit-GF-Einstellungen und Verlauf;
  Kachel auf dem Dashboard; Mira nennt unzufriedene Talente und leere Stellen.

**Folgen.** Neue Talente nur anhängen (Schlüssel bleiben). Mit vier Spielern konkurrieren alle um dieselben 660
Talente; die 30 Legenden sind knapp und werden abgeworben. Talentlöhne stehen nicht in `player_company_hours`, sondern
als eigene Buchung „Talent: Name“; der Gewinn der Stunde zeigt sie nicht. Die Demo kennt Markt, Einstellen und Mit-GF,
aber keine Löhne, keine Zufriedenheit und kein Abwerben.

**Nachtrag: viel steilere Löhne** (Eigentümer: „Die Stellen und Talente sollen viel teurer nach oben werden.
Wirklich viel teurer.“). Grundlohn je Stunde jetzt 60 / 300 / 1.500 / 8.000 / 40.000 € (vorher 40 / 90 / 200 / 420 /
900 €), etwa × 5 je Stufe. Benefits (Anteil am Lohn), Kassendeckung (12 h), Mit-GF-Aufschlag (+30 %), Abwerben und
Nachbessern hängen am Lohn und steigen von selbst mit; ihre Sätze bleiben. Gemessen mit `scripts/talent-value.ts`
(Harness von ADR-209 mit Reibung, Tabelle in `docs/BALANCING.md`): Eine Produktion-Legende bringt bei 10 Mio. €
Firmenwert etwa 27.000 € Gewinn je Stunde, bei 100 Mio. € und 1 Mrd. € etwa 53.000 € – bei rund 45.000–60.000 € Kosten
rechnet sie sich nur für sehr große Firmen und auch dort knapp; Junior und Profi lohnen sich für alle. Angestellte
Talente: Ihre Forderung steigt sofort (`talents_ensure` gleicht den Pool jetzt auch bei geändertem Inhalt ab, md5 in
`talent_pool_sync`), der alte Vertrag gilt aber 24 Stunden weiter (`raiseGraceHours`); der Chef bekommt eine
Benachrichtigung, das Stellenraster zeigt „Fordert mehr Lohn“ mit Frist. Danach verliert das Talent je Stunde 15 %
Zufriedenheit (`satisfaction.underpaidBps`, mal Empfindlichkeit) und kündigt nach wenigen Stunden, bis der Chef mit
„Gehalt anpassen“ (`talent_raise`: mindestens die Forderung, Mit-GF + 30 %, alle geforderten Benefits, keine
Kassendeckung) einen neuen Vertrag schließt. Begründung: Sofort teurer wäre für unvorbereitete Firmen ein Schock
(große Talente zahlen sich nicht mehr aus, die Kasse leert sich unbemerkt), Bestandsschutz bis zur nächsten
Verhandlung würde alte Legenden auf ewig billig halten. „Gehalt anpassen“ steht auch ohne Anlass im Talentblatt
(Benefits nachreichen). Migration `20261204010800_talent_wages_steep.sql`, Tests `e4_talents.sql` (6b) und
`talents.test.ts`.

## ADR-195: KI-Sammler kaufen auch teure Karten zum Marktwert — `Annahme`

**Kontext.** Wunsch des Inhabers: „Die KI muss auch teure Karten zu Marktpreis kaufen.“ Angebote um 1,5 Mio. € zum
Marktwert blieben liegen. Ursachen im Minutenjob `nexamon_run_due` (seit Migration 6010):

- Jeder KI-Kauf zählte gegen das Tagesbudget je Set (`ai.dailyBudgetPacks` × Booster-Preis: 60.000 € in Mystic Energy,
  300.000 € in Super Apex, 600.000 € in Yin Yang). Eine Karte über diesem Budget wurde nie gekauft, auch nicht zum Wert.
- Über dem Wert kaufte die KI mit 30 % × (1 + Beliebtheit) je Minute, Black Label bis + 20 %: zu oft und zu weit.
- Nur 500 zufällige Angebote je Lauf, faire Angebote ohne Vorrang.

**Entscheidung.** Migration 8500 (Kopie in `updates/`):

- Zum Wert der Kopie oder darunter (derselbe Wert wie in der Oberfläche, mit Karte) kauft die KI im nächsten
  Minutenlauf, egal wie teuer. Diese Käufe zählen gegen kein Budget; Grenze ist nur das Geld der Haushalte. Faire
  Angebote kommen in jedem Lauf zuerst.
- Über dem Wert höchstens + `ai.maxPremiumBps` (15 %), weiter begrenzt durch den Aufschlag nach Zustand oder Note.
  Chance je Minute `ai.buyChanceBps` (1 %) × (`ai.buyChanceMinShareBps` 4 % + Rest × Beliebtheit), also 0,04 %
  (unbeliebte Karte) bis 1 % (beliebteste), linear fallend bis auf `atMaxChanceBps` (20 %) davon am Höchstpreis. Nur diese Käufe
  prüfen das Tagesbudget je Set (die Summe aller KI-Käufe des Sets am Tag).
- Unverändert: nie die eigenen Angebote der KI, nie `ai.excludedRarities` (One of One, Uran bleiben unter Spielern,
  ADR-174/182), Sperre noch nicht erschienener Sets und die Slab-Haltezeit der KI (ADR-185), `nexamon_sell` mit
  `request_id` je Angebot (kein Doppelkauf), Ledger-Summe 0 über das Haushaltskonto.

**Geldmenge.** Die tägliche KI-Ausgabe ist höchstens `dailyBudgetPacks` × Booster-Preis je Set für Aufschläge plus
die Summe aller Angebote zum fairen Wert; sie wächst also mit fair angebotenen Karten. Die Spieler bekommen dafür nur,
was die Karte wert ist (abzüglich 5 % Gebühr), und eine Karte ist danach weg vom Spielermarkt.

**Folgen.** `nexamonAiBuyChanceBps` und `nexamonAiPremiumBps` (TS) gelten wie in SQL; die Demo prüft das Budget nur
über dem Wert. SQL-Test `d3_ai_buys_expensive.sql`.

## ADR-196: Frisch gezogene Karten sofort an das Spiel, Bulk-Gebühr 20 % — `Annahme`

**Kontext.** Wunsch des Inhabers: Bulk soll mit nur 20 % statt 35 % Gebühr verkauft werden können. Außerdem soll man
nach jedem Pack-Opening oder Pack Battle die gezogenen Karten direkt für 90 % des Marktwerts an das Spiel verkaufen
können.

**Entscheidung.**

- Bulk an das Spiel (ADR-174): `quickSell.bps` 8 000, also 20 % Gebühr. Nur Konfiguration, der Server liest den Wert
  aus `game_config`; Wertabschlag je Kopie (`dropBps`) unverändert.
- Neuer RPC `instant_sell_nexamon(p_request_id, p_copy_ids)` (Migration 8600): verkauft genau die frisch gezogenen
  Kopien für `instantSell.payoutBps` (9 000 = 90 %) ihres Werts samt Zustand, je Kopie kaufmännisch „half even“
  gerundet, jede Seltenheit. Erlaubt nur für eigene, rohe Kopien aus einem Pack (`source = 'pack'`: Einzelkauf,
  Mehrfachkauf, versiegeltes Pack, gewonnenes Pack Battle), höchstens `instantSell.windowSeconds` (900 s) nach dem
  Ziehen, nie bewertet, nicht angeboten und nie verkauft (keine Zeile in `nexamon_sales`), aus einem erschienenen Set.
  Sonst `nexamon_not_sellable`. Bezahlt wie Bulk von den Haushalten über das Ledger (`nexamon_sale`, Schlüssel
  `nexamon:instant:<spieler>:<request>`), idempotent, höchstens `maxPerCall` Kopien und `callsPerMinute` Aufrufe.
- Marktwirkung wie Bulk: jede Kopie senkt den Kartenwert um `quickSell.dropBps`, Verkaufsart `quick`, nie als Handel
  gezählt. Die Kopie geht an einen KI-Händler; Seltenheiten, die die KI nicht halten darf (`ai.excludedRarities`:
  One of One, Uranium), gehen in den Tresor des Spiels (`ai_owner = instantSell.vaultOwner`). Der KI-Wächter lässt
  genau diesen Besitzer zu, die KI bietet sie nie an (`listedPerCard` 0) und `nexamon_ai_reset()` mustert sie nie aus.
- „Nie angeboten“ prüft der Server über das aktuelle Angebot und die Verkaufshistorie; ein angebotenes und wieder
  zurückgenommenes Exemplar innerhalb der 15 Minuten bleibt verkaufbar (es gibt keine Angebotshistorie).
- Oberfläche: Unter jeder Pack-Zusammenfassung und beim Gewinner eines Pack Battles die Karte „Sofort an das Spiel
  (90 %)“ mit „Alle für {Betrag} an das Spiel verkaufen“ (gedrückt halten, mit One of One länger und mit Warnung) und
  „Einzeln verkaufen“ (kleine Knöpfe je Karte, ein One of One fragt noch einmal). Die Summen zeigen die Werte beim
  Ziehen; der Server rechnet mit dem aktuellen Wert. Beim Battle findet der Client die Kopien über Karte und Nummer in
  der eigenen Sammlung. Big-Pull-Nachrichten (ADR-190) entstehen beim Ziehen und bleiben unberührt.

**Folgen.** Packs lohnen sich mit sofortigem Ausstieg zu 90 % fast immer bis zum Erwartungswert; der Abschlag von
10 % und der Wertabschlag je Kopie bleiben die Senke. Die Fehlermeldung `nexamon_not_sellable` nennt beide Regeln.

## ADR-194: Fertigkeiten der Spielerfirmen, freigeschaltet durch den Skilltree — `Annahme`

**Kontext.** Wunsch des Inhabers: Im Unternehmen soll es die Sektion „Fertigkeiten“ geben. Man fördert dort Dinge wie
„Daten analysieren“, braucht dafür aber die passende Fähigkeit im Skilltree (z. B. „Datenanalyse“). Zu jedem Bereich
des Skilltrees gibt es Fertigkeiten; sie heben Gewinn und damit den Aktienkurs.

**Entscheidung.**

- **Neun Fertigkeiten, mindestens eine je Bereich** (`src/config/company-skills.ts`, Laufzeit `game_config`
  „companySkills“), je fünf Stufen. Jede Stufe nennt genau eine Fähigkeit des Bereichs, nie leichter als die vorige:

  | Fertigkeit              | Bereich      | Stufen brauchen                                                                  | Wirkung je Stufe     |
  | ----------------------- | ------------ | -------------------------------------------------------------------------------- | -------------------- |
  | Daten analysieren       | IT           | Datenanalyse, Machine Learning, Datenbanken, KI, Big Data                        | Nachfrage +1 %       |
  | Prozesse automatisieren | IT           | Programmierung, DevOps, Cloud, Testing, IT-Meister                               | Kapazität +1,5 %     |
  | Kosten im Griff         | Finanzen     | Buchhaltung, Controlling, Budgetierung, Corporate Finance, Finanz-Meister        | Fixkosten −2 %       |
  | Verträge verhandeln     | Recht        | Vertragsrecht, Steuerrecht, Gesellschaftsrecht, Kapitalmarktrecht, Recht-Meister | Wareneinsatz −1 %    |
  | Handwerk & Fertigung    | Handwerk     | Mechanik, Ingenieurwesen, Fertigung, CNC, Handwerk-Meister                       | Qualität +0,6 Punkte |
  | Kampagnen schärfen      | Vertrieb     | Marketing, Marke, SEO, Growth, Vertrieb-Meister                                  | Nachfrage +1 %       |
  | Team führen             | Management   | Teamführung, Personal, Agil, Betrieb, Management-Meister                         | Kapazität +1 %       |
  | Forschen & Testen       | Wissenschaft | Physik, Labor, Statistik, Werkstoffe, Wissenschaft-Meister                       | Qualität +0,6 Punkte |
  | Lieferkette optimieren  | Logistik     | Einkauf, Supply Chain, Strategie, Global, Logistik-Meister                       | Wareneinsatz −1 %    |

- **Wer die Fähigkeit haben muss:** der Gründer **oder** ein Spieler mit aktivem Job in der Firma
  (`company_held_skills`). Geprüft wird beim Lernen; eine gelernte Stufe bleibt, auch wenn der Mitarbeiter geht.
- **Kosten:** Firmengeld 1 000 / 3 000 / 8 000 / 20 000 / 50 000 € je Stufe (Ledger Firmenkasse → Haushalte, Summe 0,
  offene Rechnungen zuerst), dazu Schulung 1 / 2 / 4 / 8 / 12 Spielstunden; bis dahin zählt die Stufe eine niedriger.
  Während einer Schulung keine weitere Stufe derselben Fertigkeit (`locked`).
- **Wirkung in der Abschlussstunde:** `company_skills_hour_effect` liefert gedeckelte Faktoren; `listed_hour_effect`
  (vollständig neu definiert, sonst unverändert) multipliziert sie in seine Terme (Nachfrage, Kapazität, Wareneinsatz,
  Fixkosten, Qualität). `player_company_close_hour` bleibt unangetastet. Mehr Gewinn hebt über den bestehenden Pfad
  (`listed_hour_after`, fairer Wert) den Kurs börsennotierter Firmen; kein direkter Kursschreiber. Bekanntheit und Ruf
  bewegen Fertigkeiten nicht.
- **Deckel je Art:** Nachfrage +10 %, Kapazität +10 %, Wareneinsatz −8 %, Fixkosten −10 %, Qualität +0,05.
- **Oberfläche:** Bereich „Fertigkeiten“ in der Karte „Wachstum“ (Controlling, ADR-187), `Reveal` mit `companySkills`
  (Level 3). Kachel auf dem Dashboard führt dorthin. Gesperrte Stufe nennt die fehlende Fähigkeit mit Link
  `/career/skills?skill=<key>`; im Skilltree zeigt jede Fähigkeit, welche Fertigkeit sie freischaltet. Mira kennt die
  gelernten Stufen und weist auf eine jetzt lernbare Fertigkeit hin.

**Folgen.** Ein voll ausgebauter Betrieb verdient spürbar, aber begrenzt mehr (alle Deckel zusammen grob +20 bis
+30 % Gewinn je Stunde, je nach Kostenstruktur). Mit vier Spielern: Mitarbeiter mit passenden Fähigkeiten werden für
Gründer wertvoller. Die Demo bildet Lernen und Preise nach, die Wirkung rechnet nur der Server.

## ADR-193: News-Aktionen aus der Live-Show — `Annahme`

**Kontext.** Der Owner: „Es soll bei den News immer mal wieder eine Aktion kommen“: Booster eines Sets 15 Minuten
20 % günstiger, ein kostenloses NFT für jeden oder eine Steuererklärung, die Firmenbesitzern 10 % vom Umsatz bringt.

**Entscheidung.**

- _Auslosung:_ Ein Trigger `news_shows_promo` (BEFORE UPDATE, wenn eine Show von `scheduled` auf `aired` geht) statt
  eines Textersatzes in `news_show_start()`: Mit `newsPromos.chanceBps` (3 400, etwa jede dritte Show) gibt es eine
  Aktion, nie dieselbe Art zweimal hintereinander, höchstens eine gleichzeitig. Sie beginnt mit der Show und läuft
  `durationMinutes` (15). Mr. Doodle Dangle liest sie als letztes Segment (`kind = 'promo'`) vor, der Newsfeed behält
  sie, jeder in den letzten 7 Tagen aktive Spieler bekommt einmal die Benachrichtigung `news_promo`. Gleiche Regel in
  TS (`src/lib/sim/news-promos.ts`).
- _Booster-Rabatt:_ ein zufälliges **veröffentlichtes** Set mit Preis. `buy_nexamon_pack` und
  `buy_nexamon_sealed_pack` (vollständig neu definiert, Stand nach 7240) nehmen den Preis aus
  `news_promo_pack_price()`: Preis × (10 000 − 2 000) / 10 000, kaufmännisch „half even“. Mehrfachkauf läuft über
  `buy_nexamon_pack`. Pack Battles behalten ihren Einsatz. Der Shop zeigt den alten Preis durchgestrichen und ein
  Abzeichen mit der Restzeit.
- _Gratis-NFT:_ `create_artwork` (vollständig neu definiert) erlässt die Prägegebühr beim ersten NFT eines Spielers in
  der Aktion (`news_promo_claims`); das NFT behält seinen normalen Prägewert. Es zählt wie jedes NFT für den Preis des
  nächsten.
- _Steuererklärung:_ Wer eine aktive eigene Firma gründete, gibt in der Aktion einmal ein kleines Formular ab
  (Zahlen ansehen, Richtigkeit bestätigen, unterschreiben). Erstattung = 10 % des **Verkaufsumsatzes**
  (`player_company_hours.revenue_cents`) aller eigenen aktiven Firmen in den letzten 24 abgeschlossenen Stunden,
  höchstens 50.000 €, aus der Staatskasse (`treasury`) als Buchung `tax_refund` (Summe 0, `request_id` idempotent).
  KI-Firmen haben keinen Gründer und zählen nie. Ohne Firma, ohne Umsatz oder bei leerer Staatskasse gibt es nichts.
- _Anzeige:_ Abschnitt im News-Tab mit Restzeit (Offenlegung `newsPromo`, ab Stufe 2), ein Toast je Aktion für alle,
  die online sind, mit Link zum Ort, die Steuererklärung auch im Firmen-Dashboard.
- _Keine Kauf-Countdowns:_ Der Timer zeigt, wann ein Spielereignis mit Spielgeld endet, wie bei Auktionen. Es gibt
  kein Echtgeld, keine Kaufaufforderung am Timer, keine Wiederholungen, kein Druckton; die Texte sind neutral
  („Endet in“), der Witz geht nur über Spielereignisse.

**Folgen.** Neue Tabellen `news_promos` und `news_promo_claims`, RPCs `get_news_promo` und `file_news_tax_return`,
Benachrichtigungstyp `news_promo`, Konfiguration `newsPromos` in `src/config/news-promos.ts`. Die Show-Tests schalten
die Auslosung ab (`9i`), `d1_news_promos.sql` prüft sie. Der Demo-Modus kennt keine Aktionen.

## ADR-190: Große Nexamon-Züge sind Nachrichten für alle — `Annahme`

**Kontext.** Der Owner: „Wenn einer eine Karte über 100k wert zieht, bekommen alle die Benachrichtigung.“

**Entscheidung.** Ein Trigger nach dem Einfügen in `nexamon_copies` (statt die lange `nexamon_open_pack()` per
Textersatz zu flicken) erkennt jeden Zug eines Spielers aus einem Pack (gekauft, mehrere, versiegelt, Pack Battle):
Wert zum Zugzeitpunkt (Kopie inkl. Zustand) über `nexamon.bigPullNotifyCents` (100.000 €) → Benachrichtigung
`nexamon_big_pull` an alle anderen aktiven Spieler, Feed-Eintrag für die Freunde. One of Ones melden sich schon selbst
(keine Doppelung), die KI nie. Höchstens eine Rundmeldung je Zieher in `bigPullNotifySeconds` (60 s); mehrere große
Züge derselben Transaktion (eine Öffnung, ein Mehrfachkauf) werden zu einer Nachricht („… hat 2 Karten über
100.000 € gezogen, darunter …“) zusammengefasst.

**Folgen.** Neue Tabelle `nexamon_big_pull_broadcasts`, neuer Benachrichtigungstyp (abschaltbar), Feed-Art
`nexamon_big_pull`. Test `supabase/tests/c8_big_pull.sql`.

## ADR-192: Pack Battles mit mehreren Packs und bis zu vier Spielern — `Annahme`

**Kontext.** Der Owner: „Man soll beim Pack Battle auch mehrere Packs auswählen können. Man soll das sogar mit bis zu 4
spielen.“ Bisher (ADR-172) forderte ein Spieler genau einen Freund zu genau einem Pack heraus; gezahlt wurde erst beim
Annehmen.

**Entscheidung.**

- _Lobby statt Herausforderung:_ `create_nexamon_pack_battle(request_id, sets[], size, invite[])` legt ein Battle mit
  einer Pack-Reihe (1 bis `nexamon.packBattle.maxPacks` = 10 Packs, beliebige veröffentlichte Sets, Reihenfolge wie
  gewählt) für `size` Spieler (2 bis `maxPlayers` = 4) an. Der Einsatz pro Spieler ist die Summe der Packpreise.
  Eingeladene Freunde bekommen eine Benachrichtigung; jeder Freund des Gastgebers sieht die offene Lobby im
  Collectibles-Tab (`nexamon_lobby.open_battles`) und kann mit `join_nexamon_pack_battle` beitreten.
- _Zahlen beim Platznehmen:_ Wer sich setzt, zahlt sofort auf das neue Treuhandkonto `nexamon_battle_escrow`. So kann
  niemand zwischen Beitritt und Start pleitegehen, und der Abbruch ist eine einfache Rückbuchung. Beim Start geht der
  Einsatz an die Haushalte (wie beim Packkauf). Absage durch den Gastgeber (`cancel_nexamon_battle`) oder eine Lobby,
  die nach `packBattle.lobbySeconds` (120 s) nicht voll ist, bucht jedem Platz den vollen Einsatz zurück (Trigger auf
  den Statuswechsel, ein Schlüssel je Platz, Summe 0). Abgelaufene Lobbys räumt der Cron-Job `nexa-nexamon-pack-battles`
  und jeder Lobby-Aufruf ab.
- _Start, wenn voll:_ Der letzte Platz startet das Battle sofort. Jeder öffnet dieselbe Reihe Pack für Pack
  (`nexamon_open_pack`, Missionen, große Züge melden sich wie bisher). Die gemeinsame Uhr läuft je Pack: Reißen
  (`tearMs`), dann eine Karte je `slotMs`, danach das nächste Pack (`multiRevealAt`); bei einem Pack ist das genau der
  alte Ablauf.
- _Gewinner wie bisher:_ höchster Gesamtwert über alle Packs; Gleichstand unter den Besten: deren seltenste Karte; dann
  der Münzwurf `coin_seed % Anzahl` unter den noch Gleichen in Sitzreihenfolge (bei zwei Spielern identisch mit
  `decideBattle`). Der Gewinner bekommt alle Karten aller Plätze.
- _Daten:_ `nexamon_battles` bekommt `mode` (`duel`/`multi`), `size`, `packs`, `winner_seat`; `opponent_id` darf leer
  sein, solange die Lobby wartet. Neue Tabellen `nexamon_battle_seats` und `nexamon_battle_invites`. Die alten RPCs
  (`challenge_`/`respond_nexamon_battle`) bleiben für Duelle unverändert; `respond` lehnt Lobby-Battles ab. Die
  Oberfläche nutzt nur noch die Lobby (auch das Duell „1 Pack, 2 Spieler“). Die KI tritt nie bei.
- _Oberfläche:_ Pack-Auswahl mit Hinzufügen, Verschieben, Entfernen und laufender Summe, Spielerzahl 2/3/4, Einladen
  von Freunden; Lobby mit bis zu vier Plätzen; Live-Aufdeckung Pack für Pack mit laufender Summe je Spieler (Handy: 2×2,
  ab `lg` nebeneinander), Ergebnis mit Rangliste.

**Folgen.** Fehler `nexamon_battle_full` NX311 und `nexamon_battle_joined` NX312. Ein Battle mit zehn Packs dauert gut
zwei Minuten. Das Stundenlimit `battles.perHour` und die Abklingzeit gelten pro gestartetem Battle wie bisher. Test
`supabase/tests/c9_pack_battle_multi.sql`, Formeln in `src/lib/sim/nexamon-battle.ts`.

## ADR-186: Mehr Schiebe- und Sehaufgaben, weniger Rechnen und Tippen bei den Firmenaufgaben — `Annahme`

**Kontext.** Der Owner: „Weniger Rechen- und Schreibaufgaben bitte bei den Unternehmensaufgaben. Mehr Schiebe- und
Sehaufgaben.“ Bisher zog `company_tasks_run_due()` jede passende Aufgabe gleich wahrscheinlich (allgemeine Aufgaben etwas
seltener). Gemessen mit `taskMix` über den alten Katalog: je Produkt 39–47 % Rechnen und Tippen (`math`, `quick`,
`receipts`, `offer`, `pattern`, `pack`, `restock`, `count`, `order`, `haggle`), 21–25 % Ziehen.

**Entscheidung.**

- _Art je Spiel:_ `TASK_GAME_KINDS` in `src/config/company-tasks.ts` ordnet jedes Spiel `calc` (Rechnen, Zahlen, Lesen
  und Tippen), `drag` (Schieben, Ziehen, Drehen) oder `visual` (Hinsehen, Finden, Merken) zu.
- _Gewicht je Aufgabe:_ `companyTasks.mix`: Gewicht = `kindWeight` (calc 1, drag 4, visual 3) × 2 für Aufgaben des
  eigenen Produkts (× 1 für allgemeine). `taskWeight()` schreibt es als `weight` in jeden Katalogeintrag
  (`game_config`). Server (`company_tasks_run_due`, Migration 7620) ordnet nach `-ln(1 − random()) / weight` und nimmt
  die erste: Aufgabe i kommt mit Wahrscheinlichkeit Gewicht_i / Summe. Die Demo zieht genauso (`pickWeightedTask`).
  Einträge ohne Gewicht zählen 1. Keine Aufgabe wurde gestrichen; Rechenaufgaben bleiben, nur seltener.
- _Neue Mischung (je Produkt, `taskMix`):_ Rechnen und Tippen 10–14 % (Ziel höchstens 20 %, Test
  `maxCalcShareBps`), Ziehen 53–61 %, Sehen 27–36 %. Der Autopilot legt seine eigene Aufgabe weiter gleichverteilt an; er
  spielt kein Minispiel, die Mischung betrifft dort nur den Namen in der Liste.
- _Neun neue Spiele (Ziehen und Sehen)_, Bewertung in `src/lib/sim/company-tasks-visual.ts`, gleich in SQL
  (`company_task_puzzle_visual`, `company_task_grade_visual`, Migration 7600; `company_task_puzzle` und
  `company_task_grade` vollständig neu in 7610):
  - `tiles` Schiebepuzzle 3 × 3, 14 Schiebezüge gemischt (nie direkt zurück), mindestens 5 Teile falsch. Der Server
    spielt die Züge nach (ungültiger Zug: 0), jedes Teil am Platz zählt ein Achtel.
  - `bins` acht Kisten in drei Farben und drei Formen, nach Farbe oder Form (würfelt das Rätsel) ins Regal.
  - `untangle` sechs Punkte auf einem 6 × 6-Raster, ein Ring plus zwei Sehnen, die sich kreuzungsfrei legen lassen;
    die Punkte starten vertauscht mit mindestens zwei Kreuzungen. Jedes Paar Kabel ohne gemeinsamen Punkt, das sich
    berührt, kostet 20 % (ganzzahlig exakt).
  - `odd` drei Runden mit 16 gleichen Waren (Karton, Flasche, Dose, Glas) und einer fehlerhaften.
  - `rebuild` vier Waren auf einem 3 × 3-Regal, 5 s zu sehen, dann aus dem Gedächtnis zurückstellen; jede Ware höchstens
    einmal.
  - `align` vier Bauteile aus sechs Formen auf die Station mit dem passenden Umriss (sechs Stationen).
  - `pipes` 4 × 4 Rohre (gerade, Bogen) drehen; durchgehend von links nach rechts: 100 %, sonst der Anteil richtig
    gedrehter Rohre der Route × 50 %. Mindestens vier Rohre der Route stehen falsch, die Leitung ist anfangs offen.
  - `sizes` sechs Pakete (30–100 %, mindestens 8 Punkte Abstand) ohne Zahlen von klein nach groß ziehen.
  - `conveyor` zehn Waren in drei Sorten laufen über ein Band (alle 2,4 s eine, 5,6 s lang); richtige Kiste +1,
    falsche −1, verpasst 0.
    30 neue Aufgaben: je Spiel eine für alle Firmen und je Produkt eine eigene (alle 21 Produkte), quer durch die
    Abteilungen. Texte in `companyTasks.items`.
- _Bedienung:_ Handy zuerst, Ziele mindestens 44 px; jedes Ziehen geht auch als Tippen-dann-Tippen, mit Tastatur
  (Pfeiltasten beim Entwirren, Knöpfe sonst). Töne `tap`, `blip`, `toggle`. Bewegung nur über `transform` und
  `opacity`; bei reduzierter Bewegung kein Layout-Gleiten, das Band läuft 1,4-mal langsamer in groben Schritten.
- _Geheim bleibt:_ Wie bei den älteren Spielen verrät das Rätsel teils die Lösung (Farbe der Kiste, Umriss); die
  kreuzungsfreie Anordnung (`untangled`) und die Rohr-Route bleiben in der Lösung auf dem Server.
- _Gleiche Bewertung:_ 138 geteilte Fälle in `supabase/tests/task_games_visual_cases.inc` (TS-Test und
  `c5_task_games_visual.sql`); der SQL-Test zieht außerdem 300 Aufgaben für eine Modefirma (Rechnen höchstens 20 %).
- _Update-Datei:_ Die Kopie von 6920 setzt den Check `company_tasks_game_check` nur noch, solange er `conveyor` nicht
  kennt (wie die Kopie von 6400 für `restock`), sonst schlügen Zeilen der neuen Spiele fehl.

**Folgen.** Die neuen Spiele dauern etwas länger (40–90 s); die Zeitgrenzen stehen in `companyTasks.games`. Wer lieber
rechnet, bekommt Rechenaufgaben weiter, nur seltener. Neue Spiele brauchen eine Art in `TASK_GAME_KINDS`, sonst schlägt
der Mix-Test fehl.

## ADR-187: Firma übersichtlicher – Dashboard nur Zahlen, eine Liste „Zu erledigen“, zusammengeführte Karten — `Annahme`

**Kontext.** Wunsch des Inhabers: Die Aufgaben im Unternehmen seien verstreut, man scrolle ewig, vor allem im
Controlling (am PC rund 13 000 px). Das Dashboard soll nur Zahlen und Grafiken zeigen, ein Klick darauf führt zum
Hebel. „Stärken der Firma“ und „Wo es fehlt“ zeigten dieselben Namen mit sehr unterschiedlichen Zahlen in zwei
Netzdiagrammen und wirkten widersprüchlich.

**Entscheidung.** Nur Darstellung, keine Funktion entfernt, keine SQL-Änderung.

- **Dashboard:** Kennzahl-Kacheln, Timer-Chips, Grafiken, „Stärken & Schwächen“. Jede Kachel und Grafik verlinkt über
  `tabs.ts` auf die Stelle, an der der Wert beeinflusst wird, mit Hinweis „Beeinflussen in Tab → Ort“ (`DashLink`,
  `ChartLink`, `useWhere`). Autopilot, Mira, Aufgaben, Lage, Interview, Ereignis, Büro und „Was jeder leistet“
  ziehen um.
- **Stärken & Schwächen:** `HealthPanel` bekommt optional die Stärken: ein Diagramm (acht Diagnose-Punkte), je Zeile
  „Jetzt“ und getrennt „Langfristige Stärke x/100“ mit nächster Bonusstufe; Image und Schwung nur als Diagnose. Die
  Zuordnung ist die bestehende (`STRENGTH_OF`): Menge → Lieferfähigkeit, Preis → Rendite, Kasse → Finanzen. Zahlen
  kommen unverändert aus der API.
- **Zu erledigen** (`todo-center.tsx`): alle fälligen Dinge als eine Liste nach Dringlichkeit (Dringend, Bald, Wenn
  Zeit ist), eine Zeile je Punkt mit Frist und „Öffnen“, oben im Tab Mitarbeiter neben dem Autopiloten. Der
  Mitarbeiter-Tab zählt die Punkte, die dort erledigt werden; das Dashboard zeigt die Gesamtzahl als Kachel.
- **Zusammengeführte Karten** (`MergedCard`): eine Karte, ein Kopf, ein Umschalter (Segmented) zwischen Ansichten.
  Controlling: Angebot & Produktion, Marketing, Geld, Wachstum, Marke & Firma. Mitarbeiter: Team (Team & Plätze,
  Stimmung, Wert). Jede Ansicht behält ihre alte Abschnitts-ID; ein Link (Adresse oder `announceFocus`) schaltet die
  Karte vor dem Scrollen um.
- **Mira** als Panel (Sheet) mit Knopf neben den Tabs auf jedem Tab; `section=mira` öffnet es. Die Logik in
  `assistant/` bleibt unverändert; das Tour-Ziel `assistant` sitzt am Knopf.
- **Links:** `tabs.ts` kennt alle alten IDs (auch `group-sell`, `group-run`, `group-listed`, `reputation-mood`,
  `team-value`, `assist`) und führt sie zur neuen Karte und Ansicht; `tabs.test.ts` prüft, dass jede alte ID auf eine
  vorhandene Karte desselben Tabs führt und jeder Link zur selben Stelle zurückführt.

**Folgen.** Inhalte einer Karte, die nicht gewählt ist, sind nicht im DOM; E2E-Tests wählen die Ansicht vorher
(`showPane` in `e2e/company-helpers.ts`). Die Beschreibungen und „i“-Erklärungen aus ADR-183 bleiben.

## ADR-191: Wachstum & Ausbau als ein Weg, aufklappbare Listen — `Annahme`

**Kontext.** Wunsch des Inhabers: „Wachstum“ (die vier Stufen des Produkts, ADR-062/071) und der endlose „Ausbau“
(ADR-083) standen als zwei Karten untereinander, beide mit „Stufe“; Spieler meldeten Kollisionen beim
fortlaufenden Ausbauen (Ausbau „zurückgesetzt“ oder blockiert nach einem Stufenwechsel). Außerdem sollen
„Geschäftszüge“, „Bewerbungen“ und „Was jeder leistet“ auf- und zuklappbar sein.

**Ursache der Kollision.** Plätze einer Spielerfirma sind `maxEmployees(Rechtsform) + employeesPerLevel × Ausbaustufe`
(`company_max_employees`). `upgrade_company` (neue Rechtsform) und der Abschluss des Börsengangs (`ipo_escrow`)
schrieben aber den reinen Rechtsform-Wert in die Kopie `companies.max_employees`. Die Ausbaustufe selbst blieb
erhalten (Markt, Kapazität, Fixkosten und Kosten der nächsten Stufe rechneten richtig weiter), doch alles, was die
Spalte liest (Firmenprofil, öffentliche Sichten, die Missionen „einstellen“), sah nach dem Wechsel weniger Plätze;
die Einstellungsprüfung zählte dagegen über die Funktion. Ergebnis: Ausbau „weg“ in der Anzeige, Missionen blockiert,
widersprüchliche Platzzahlen. Doppelt gezählt wurde nichts; Markt ist Rechtsform × (1 + Bonus × Stufe), jede Stufe
einmal.

**Entscheidung.**

- Migration 7350 (mit Kopie in `updates/`): Trigger `company_seats_sync` und `company_seats_guard` halten
  `companies.max_employees` immer gleich `company_max_employees`, egal wer schreibt; bestehende Firmen werden
  repariert. `company_growth_path(company)` liefert den ganzen Weg (Stufe, Ausbaustufe, Schritt, nächstes Ziel,
  nächste Kosten, Plätze). SQL-Test `c4_growth_path.sql`. Regeln und Belohnungen beider Systeme unverändert.
- Oberfläche: eine Karte „Wachstum & Ausbau“ (`growth-expansion.tsx`) mit einem durchgehenden Weg: Stufe 1–4, danach
  Ausbau 1, 2, … ohne Ende; darunter die offenen Plätze der Stufe und der nächste Ausbau. `progress.ts` zählt beides
  als einen Schritt (Test daneben). Die Rechtsform steht direkt darunter.
- `FoldBlock`: Kopf als Knopf mit `aria-expanded`, zugeklappt eine kurze Zusammenfassung (Anzahl), Zustand je
  Spieler in `localStorage` (nach der Hydration), Einblenden nur über `opacity`/`transform` mit Motion-Tokens. Ein
  Link auf die Stelle klappt sie für diesen Besuch auf. „Was jeder leistet“ startet ab sechs Personen zugeklappt.

## ADR-197: Grundeinkommen stark verbesserbar — `Annahme`

**Kontext.** Der Besitzer will das Grundeinkommen in den Verbesserungen stark und günstig ausbauen können; bisher drei
Stufen mit je +10 % (höchstens +30 %).

**Entscheidung.** `upgrades.income`: 12 Stufen, je +50 % (`perLevel` 5 000 bps, höchstens +600 %, also das
Siebenfache, 700 € je Stunde), freigeschaltet ab Level 3 alle 2 Level (3, 5, …, 25; letzte Stufe bis Level 30 wie
bei allen Verbesserungen), Preis 3.000 € · 1,5^Stufe (bis rund 259.500 €). Der Server liest alles aus `game_config`
(`upgrade_cost_cents`, `upgrade_stage_level`, `player_basic_income_cents_per_hour`), daher keine Migration.

**Folgen.** Bei zwei Tresor-Leerungen am Tag (16 Stunden) bringt jede Stufe +800 € am Tag: Stufe 1 lohnt sich nach
4 Tagen, Stufe 12 nach etwa 11 Wochen. Das Geld bleibt geschlossen (ADR-041): Käufe fließen in die Staatskasse, die
das Grundeinkommen zahlt; leert sie sich unter das Ziel (`basicIncome.treasuryTargetCents`, 250 Mio. €), sinkt der
Faktor bis `minFactor` 0,25. Bei vier Spielern auf Stufe 12 sind das höchstens rund 45.000 € am Tag, weit unter dem Ziel.

## ADR-198: Mint-Karten werden bei ASP in 40 % der Fälle eine 10 — `Entscheidung (Eigentümer)`

**Kontext.** Der Eigentümer wünscht: „Mint-Karten sollen eine 40 % Chance auf ASP 10 haben.“ Bisher wurde ein
Mint-Grading in 15 % der Fälle eine 10 oder besser (10 % 10, 5 % Black Label).

**Entscheidung.** `grading.gradeWeightsBps.mint` wird `[0, 0, 0, 0, 0, 0, 200, 500, 1 000, 2 300, 2 000, 4 000]`:
7 = 2 %, 8 = 5 %, 8,5 = 10 %, 9 = 23 %, 9,5 = 20 %, 10 oder besser 40 %. Die Black Label bleibt bei 5 % aller
Mint-Gradings, eine reine 10 also 35 %. Die anderen Zustände bleiben unverändert. Der Server liest die Tabelle aus
`game_config` (`pnpm db:config`), es braucht keine Migration; die Oberfläche zeigt die Chancen aus der Konfiguration.

**Folgen.** Der erwartete Faktor eines Mint-Gradings steigt von 2,311 auf 2,969 des Kartenwerts, nach der Gebühr
(0,4) von 1,91 auf 2,57: im Schnitt + 157 % statt + 91 %. Geld verliert ein Mint-Grading nur noch bei 7 oder 8
(7 % statt 17 %). Mint-Grading ist damit klar profitabel, das ist gewollt. Der KI-Aufschlag für rohe Mint-Karten
(`premiumBps.mint`, 12 %) bleibt; wer eine Mint-Karte zieht, gradet sie lieber, als sie roh an die KI zu verkaufen.
Mehr 10er bringen mehr Slabs mit hohem Wert in Umlauf; Marktwert und KI-Käufe für Slabs (`gradePremiumBps`) bleiben
und sind zu beobachten.

## ADR-202: Flachere Levelkurve, mehr Missions-XP, Missionen ohne Wiederholung und ohne Sackgasse — `Entscheidung (Eigentümer)`

**Kontext.** Der Eigentümer: „Die XP-Kurve ist zu schwer, es dauert viel zu lange, aufzusteigen. Entweder mehr XP aus
Missionen oder eine flachere Kurve, aber nicht ZU leicht.“ Und: „Mehr Abwechslung bei den Missionen, man bekommt
sehr oft dieselben. Nie einen Spieler mit einer Mission festsetzen.“ Gemessen (`src/lib/sim/level-pace.ts`,
docs/BALANCING.md 3.2) brauchte ein aktiver Spieler 45 Tage bis Level 40, davon 19 für 30 → 40. Missionen wurden
gewichtet zufällig gezogen; nur offene und in den letzten 24 Stunden gezogene schnelle Missionen waren gesperrt,
tägliche konnten jeden Tag wiederkommen. Unmöglich gewordene Missionen wurden nur bei schnellen Missionen und
Meilensteinen ohne Fortschritt ersetzt.

**Entscheidung.**

1. **Kurve und Missions-XP:** `progression.xpBase` 250 → 200 (jedes Level ab 2 braucht 20 % weniger XP, Level 1 → 2
   bleibt 100), `missionXpScalePerLevel` 0,15 → 0,18 (Kappe ×8 unverändert). Ein aktiver Spieler steigt je Abschnitt
   1,27- (Level 1 → 5) bis 1,42-mal (30 → 40) so schnell auf, insgesamt ×1,40 (45 → 32 Tage bis Level 40). Der Test
   hält jeden Abschnitt zwischen ×1,25 und ×1,45.
2. **Niemand verliert ein Level:** Die Gesamt-XP jedes Levels fallen nur. `raise_levels_after_curve_change()` hebt
   jedes Profil einmal auf das Level seiner XP, mit freien Skillpunkten und Freischaltungen, und senkt nie.
   Freischaltungen, `minLevel` der Verbesserungen und die Prüfungen aus ADR-115/134 hängen am Level und bleiben;
   sie kommen nur früher.
3. **Ziehung ohne Wiederholung** (`progression.missionDraw`, SQL `missions_assign`, TypeScript
   `src/lib/sim/mission-draw.ts` für die Demo): Eine Vorlage, die unter den letzten 12 (schnell), 9 (täglich) bzw.
   6 (wöchentlich) Ziehungen ihrer Art ist, kommt nur, wenn sonst nichts machbar ist; danach kommen Vorlagen in der
   Abkühlzeit (48 Stunden, 4 Tage, 3 Wochen), am liebsten frische. Zählt eine offene Mission schon dieselbe Metrik,
   rutscht die Vorlage eine halbe Stufe nach hinten. Die Plätze werden so immer gefüllt. Innerhalb einer Stufe
   gewichtet: Missionen freigeschalteter Bereiche ×1,5, eines in den letzten 5 Leveln freigeschalteten Bereichs
   zusätzlich ×2,5. Jede Ziehung bekommt `draw_seq` und `drawn_at`.
4. **Nie unmöglich:** Gezogen wird nur, was `mission_doable` erlaubt (Level, Freischaltung, Voraussetzung, Geld, Lage
   der Welt). Offene Missionen werden bei jedem Blick geprüft: ohne Fortschritt ersetzt, sobald sie nicht mehr
   machbar sind; mit Fortschritt, sobald die Voraussetzung fehlt (keine Firma, kein Job). Das gilt jetzt auch für
   tägliche und wöchentliche Missionen. Meilensteine werden nur ohne Fortschritt ersetzt und dürfen später mit ihrem
   Fortschritt wiederkommen.
5. **Einzeltausch:** `skip_mission` tauscht einmal am Berliner Tag (`missionSkipsPerDay`) eine offene schnelle,
   tägliche oder wöchentliche Mission kostenlos gegen eine andere, zusätzlich zum Neuwürfeln aller (ADR-166).
   Meilensteine nicht.
6. **52 neue Missionen** über die Metriken `crypto_trade`, `crypto_buy`, `crypto_distinct`, `crypto_created`,
   `short_opened`, `watchlist_add`, `nexamon_quick_sold`, `nexamon_grading_sent`, `pack_battle_join`, `news_promo`,
   `campaign_started`, `company_skill`, `upgrade_bought`, `work_task_done`, `daily_reward`, `feed_react` sowie die
   bisher ungenutzten `art_painted` (Prägen), `nexamon_bought`, `nexamon_listed`. Gezählt wird über Trigger auf den
   Tabellen, keine RPC wird umgeschrieben (auch nicht die Verbesserungen und der Tresor, die parallel umgebaut
   werden). Zählungen, die nicht mit dem Level wachsen sollen (Kampagnen, Fertigkeiten, Verbesserungen, Packs),
   tragen `params.fixedCount`.

**Folgen.** Bei einem neuen Spieler auf Level 1 sind 27 schnelle Vorlagen machbar; im SQL-Test kommt über 120
Ziehungen keine innerhalb von 12 Ziehungen wieder, über 12 Tage keine tägliche innerhalb von 3 Tagen. Ein Spieler auf
Level 16 mit Firma bekommt in 120 Ziehungen über 50 verschiedene Vorlagen. Mehr XP und mehr erledigbare Missionen
beschleunigen auch die Wirtschaft etwas (Missionen zahlen nur XP). Die Werte der Ziehung stehen in der
Konfiguration; wird der Katalog kleiner als die Sperrliste, wiederholt sich die älteste Ziehung zuerst.

## ADR-201: Der Tresor wächst mit dem Spieler, Festgeld, aufklappbare Verbesserungen — `Annahme`

**Kontext.** Wunsch des Inhabers: Der Tresor sei „im späteren Spiel nutzlos, die Beträge lächerlich klein“, und die
Seite „Verbesserungen“ sei zu lang; die Gruppen sollen sich auf- und zuklappen lassen.

**Befund.** Das Grundeinkommen war bisher fest 100 € je Stunde, verbesserbar über `income` (ADR-197, bis 700 €),
`vault`/`vault_xl` (bis 36 Stunden) und `vault_interest` (+20 %), gedämpft vom Staatskassen-Faktor (ADR-041). Selbst
voll ausgebaut bringt der Tresor auf Level 30 rund 20.000 € am Tag; ein Spieler auf Level 25 verdient dann aber 84.000
bis 182.000 € am Tag (BALANCING 2.2), überwiegend aus Lohn und Depot. Ohne Verbesserungen sind es 1.600 bis 2.400 €
am Tag, also 1 bis 2 %.

**Entscheidung.** Zwei Hebel, die mit dem Fortschritt wachsen, ohne das geschlossene Geldsystem zu verlassen:

1. **Level-Bonus** (`vault.levelBonusBps` 800, `vault.levelBonusMaxLevel` 40): Das Grundeinkommen im Tresor (mit den
   Verbesserungen) steigt je Level über 1 um 8 %, bis Level 40 (×4,12); danach ändert es sich nicht mehr. Gerundet wird
   einmal „half even“, der Staatskassen-Faktor kommt danach. `vault_status` rechnet es ein, `claim_vault`, Portfolio,
   „Tresor voll“ und alle anderen Leser übernehmen es unverändert. Wer ein Level aufsteigt, bekommt die neue Rate
   für alles, was gerade im Tresor liegt (wie bei der Staatskasse; die Verbesserung `income` dagegen rechnet beim Kauf
   ab, ADR-093).
2. **Festgeld im Tresor** (`vault.deposits`), ab Level 5: Bargeld für 1, 3 oder 7 Tage fest anlegen, Zinsen 1,5 %,
   5 % oder 14 % (also 1,5 %, 1,67 % und 2 % am Tag). Alle offenen Anlagen zusammen höchstens 25.000 € × Level, höchstens
   drei gleichzeitig, mindestens 1.000 €. Das Geld bleibt dem Spieler: Es liegt auf seinem Konto `player_reserve`
   (zählt zum Vermögen und zur Geldmenge wie reservierte Orders). Bei Fälligkeit kommt es mit den Zinsen zurück; die
   Zinsen zahlt die Staatskasse (× Staatskassen-Faktor, so weit sie das Geld hat, `state_pay_partial`; ein offener
   Zwangskredit behält seinen Anteil ein). Vorzeitig auflösen geht jederzeit, dann ohne Zinsen. Fällige Anlagen holt
   der Spieler selbst ab, Zinsen laufen danach nicht weiter. Ein Zurücksetzen des Kontos verwirft offene Anlagen (das
   Geld ist mit `account_wipe` schon an die Staatskasse gegangen).

Die Zinsen liegen bewusst unter dem erwarteten Depotertrag (etwa 7 % am Tag, BALANCING 2.1), sind aber sicher und
gedeckelt: ein Platz für Geld, das gerade nicht arbeiten soll, kein Ersatz für die Börse. Keine Steuer auf die Zinsen
(wie beim Grundeinkommen); der Deckel je Level hält sie klein gegen das Vermögen später Spieler.

Nicht gewählt: Zinsen auf den Tresorinhalt (er ist höchstens 36 Stunden Grundeinkommen, Zinsen darauf wären winzig),
Serien-Bonus für regelmäßiges Leeren (belohnt Pflicht statt Fortschritt), Bänder nach Vermögen (Reiche bekämen mehr
Staatsgeld).

**Zahlen** (alle Verbesserungen gekauft, die das Level erlaubt; zwei Leerungen am Tag, also 24 Stunden gezählt, wenn
der Tresor mindestens 12 Stunden fasst; Staatskasse voll; ohne Nexamon-Bonus):

| Level | Grundeinkommen | Tresor | Tresorzinsen | vorher je Stunde / Tag | nachher je Stunde / Tag | Festgeld höchstens | Festgeld je Tag (7 Tage) |
| ----- | -------------- | ------ | ------------ | ---------------------- | ----------------------- | ------------------ | ------------------------ |
| 5     | 200 €          | 14 h   | +5 %         | 200 € / 5.040 €        | 264 € / 6.653 €         | 125.000 €          | bis 2.500 €              |
| 15    | 450 €          | 28 h   | +20 %        | 450 € / 12.960 €       | 954 € / 27.475 €        | 375.000 €          | bis 7.500 €              |
| 30    | 700 €          | 36 h   | +20 %        | 700 € / 20.160 €       | 2.324 € / 66.931 €      | 750.000 €          | bis 15.000 €             |

Ohne jede Verbesserung (8 Stunden, zwei Leerungen = 16 Stunden): Level 5 1.600 → 2.112 €, Level 15 1.600 → 3.392 €,
Level 30 1.600 → 5.312 € am Tag.

**Geldsystem.** Bei vier Spielern auf Level 30 mit vollem Ausbau und vollem Festgeld zahlt die Staatskasse höchstens
rund 330.000 € am Tag, 0,13 % ihres Ziels von 250 Mio. €. Leert sie sich, sinken Grundeinkommen und Festgeld-Zinsen
mit dem Faktor (bis 0,25), Zinsen werden nur gezahlt, so weit Geld da ist. Das Festgeld selbst schafft kein Geld: Es
wandert nur zwischen zwei Konten des Spielers.

**Oberfläche.** Der geöffnete Tresor zeigt unter den Einnahmequellen „Das bringt dein Tresor“: Grundeinkommen,
Level-Bonus, gegebenenfalls Staatskasse, Rate im Tresor, voller Tresor, Tresorzinsen und „am Tag, wenn du rechtzeitig
leerst“. Darunter „So bringt er mehr“: nächstes Level, die nächste Stufe von Grundeinkommen, Tresor, Panzertresor und
Tresorzinsen (mit Gewinn je Stunde und Preis oder „ab Level …“, Link auf die Verbesserungen) und Festgeld. Ab Level 5
(`disclosure.vaultDeposits`) folgt das Festgeld mit Betrag, Laufzeit, Vorschau, laufenden Anlagen, „Abholen“ und
„Auflösen“ (gedrückt halten). Die Untertitelzeile nennt Rate und vollen Tresor.

Die Seite „Verbesserungen“ zeigt die fünf Gruppen als aufklappbare Abschnitte (`CollapsibleSection`, Radix
Collapsible, `aria-expanded`): zugeklappt „3/30 gekauft · nächste ab 4.000 €“ (oder „nächste ab Level …“, „alles
gekauft“) und eine Marke „2 jetzt kaufbar“. Beim ersten Besuch sind die Gruppen offen, in denen jetzt etwas kaufbar
ist; das bleibt für den Besuch so, auch wenn man die letzte bezahlbare Stufe kauft. Die eigene Wahl merkt sich der
Browser je Spieler (`nexa-folds:upgrades:<name>`, erst nach der Hydration gelesen).

**Technik.** Migration `20261204009300_vault_level_deposits.sql` (Kopie in `updates/`): `vault_level_factor_bps`,
`vault_status` neu (neue Felder `income_cents_per_hour`, `level`, `level_factor_bps`, `cap_hours`), Tabelle
`vault_deposits`, RPCs `get_vault_deposits`, `open_vault_deposit`, `close_vault_deposit`, Trigger auf
`player_private.account_reset_at`. Formeln in `src/lib/sim/vault.ts` mit Tests, Demo in `demo/vault-deposits.ts`.
SQL-Test `e0_vault_level_deposits.sql`.

## ADR-205: Pack-Battle-Modi „Umgekehrt“ und „Twist“ — `Entscheidung (Eigentümer)`

**Kontext.** Der Eigentümer wünscht mehr Optionen im Pack Battle (ADR-192): „Eine Einstellung, bei der der Spieler mit
den schlechtesten Pulls gewinnt“ und einen Twist-Modus: „Nach jedem Pack wird der ganze ausgepackte Wert eines Spielers
zufällig mit einem anderen getauscht, reines Chaos, ein Glücksspiel im Glücksspiel.“ Außerdem sollen die letzten zwei
Karten jedes Packs in der Live-Ansicht spannender aufgehen.

**Entscheidung.**

- _Umgekehrt (`reverse`):_ Der niedrigste Gesamtwert gewinnt. Gleichstand gespiegelt: unter den Niedrigsten gewinnt,
  wessen seltenste Karte am wenigsten selten ist, dann der Münzwurf `coin_seed % Anzahl` in Sitzreihenfolge.
- _Twist (`twist`):_ Jeder Platz hält einen „Haufen“. Pack für Pack legt jeder seine eigenen Karten dieses Packs auf
  seinen Haufen, danach werden die Haufen aller Plätze zufällig permutiert: Platz i übernimmt den Haufen von Platz
  `perm[i]` (die Karten wandern für den Seltenheits-Gleichstand mit). Das gilt nach jedem Pack, auch nach dem letzten.
  Entschieden wird über die Haufen; der Gewinner bekommt weiter alle Karten aller Plätze, gezogen bleibt gezogen
  (Anzeige: groß der gehaltene Wert, klein „gezogen …“).
- _Zufall:_ Uniform über alle n! Reihenfolgen, auch „nichts bewegt sich“ (bei zwei Spielern also ein Münzwurf je Pack,
  die Ansicht zeigt dann „Kein Tausch“). Eigener Seed `twist_seed` (random() beim Start); die Permutation von Runde k:
  `x = (seed mod (2³¹−1) + k · 7919) mod (2³¹−1)`, dreimal `x = x · 48271 mod (2³¹−1)`, `x mod n!` als Lehmer-Code
  (`nexamon_battle_twist_perm` = `twistPermutation`, gleiche Testvektoren in TS und SQL). Alle Twists werden beim Start
  in `twists` gespeichert; reproduzierbar aus dem Seed, der ab der Entscheidung sichtbar ist.
- _Beides zusammen:_ erlaubt; nach allen Twists gewinnt der niedrigste Haufen.
- _Gemeinsame Uhr:_ Ein Twist-Battle spielt nach jedem Pack, eine Kartenzeit nach dessen letzter Karte,
  `packBattle.twistMs` (3,2 s) lang den Twist, dann reißt das nächste Pack. Karte g zeigt bei
  `start + p · tear + (g−1) · slot + (p−1) · twist` (p = Pack), der Twist nach Pack k bei
  `start + k · (tear + 5 · slot) + (k−1) · twist`. Der Server gibt Karten und Twists erst `leadMs` vorher heraus
  (`nexamon_battle_json`), alle Clients spielen im Gleichschritt.
- _Geld:_ Einsatz, Treuhand, Start und Rückbuchungen bleiben wie ADR-192; Modi ändern keinen Betrag.
- _Oberfläche:_ Zwei Schalter „Twist“ und „Umgekehrt“ im Eröffnen-Sheet mit Regeltext; Badges in Lobby, Banner,
  Live-Liste und Battle-Kopf; Einladung und Startnachricht nennen den Modus („· Modus: Twist + Umgekehrt“), der Feed
  hängt ihn an. In der Live-Ansicht erscheint nach jedem Pack „Twist!“ mit den Tauschen („Lena ↔ Max“, bei Ringen
  „Lena → Max → Ida → Lena“), die Plätze wackeln, die Werte kippen um und zeigen „von Max“. Rangliste und Summen
  nach gehaltenem Wert, bei Umgekehrt aufsteigend.
- _Spannung bei den letzten zwei Karten:_ `battleRevealTier`: Glühen für jede der letzten zwei Karten, Blitz ab Rare,
  Wackeln ab Ultra, Funken ab Prisma; die letzte Karte eines Packs eine Stufe stärker. Dazu ein Wertzähler unter der
  Karte und ab Stufe 3 der Ton `battleImpact`. Eigenständig in der Battle-Ansicht (`battle-reveal-fx.tsx`), getrennt
  vom `RareReveal` der Pack-Öffnung; nur `transform`/`opacity`, bei reduzierter Bewegung nur Glühen und Wert.

**Folgen.** Ein Twist-Battle dauert je Pack 3,2 s länger. Die Lockstep-Prüfungen in `c9_pack_battle_multi.sql` und
`d7_battle_modes.sql` rechnen die erwartete Kartenzahl aus `server_time` und `starts_at` derselben Antwort und
hängen so nicht mehr an der Maschinenlast. Test `supabase/tests/d7_battle_modes.sql`, Formeln in
`src/lib/sim/nexamon-battle.ts` (Tests `nexamon-battle-modes.test.ts`).

## ADR-207: Titans Revenge – Diamond 30 % mehr wert, Uranium so viel weniger, dass der Erwartungswert bleibt — `Entscheidung (Eigentümer)`

**Kontext.** Der Eigentümer wünscht: „Im Set Titans Revenge sollen die Diamond etwas besser werden vom Wert, aber
dafür Uranium etwas schlechter, aber so, dass der Erwartungswert gleich bleibt.“ Ein Pack (100.000 €) bringt im
Schnitt 1/50 Diamond und 1/500 Uranium; der Erwartungswert lag bei 89.901,25 € (89,9 %, ADR-182).

**Entscheidung.** Neuer Faktor je Seltenheit `TITAN_REBALANCE_FACTOR` (`src/config/nexamon/titans-draft.ts`) auf die
Startpreise nach `TITAN_VALUE_FACTOR`: Diamond × 1,3, Uranium × u, Iron und Titanium × 1. u folgt aus den Zahlen des
Katalogs: 0,3 × 597.375 € / 50 = (1 − u) × 22.078.125 € / 500, also u = 1 − 3 × 597.375 / 22.078.125 = 0,918828
(auf sechs Stellen). Die Verhältnisse der Karten innerhalb einer Seltenheit bleiben; die Spannen
(`NEXAMON_SET_PRICE_RANGE`) wachsen bzw. schrumpfen mit. Erwartungswert nachher 89.901,26 € (die Rundung auf ganze
Euro macht 0,4 Cent).

Live wirkt das über Migration `20261204009900`: einmal (Marke `nexamon_titans_rebalance_207` in `data_migrations`)
werden Startpreis, Marktwert, Tagesreferenz und Wertgeschichte jeder Diamond-Karte × 13/10, jeder Uranium-Karte
× 918 828/1 000 000 genommen (neue interne Funktion `nexamon_scale_card_values`). Relativ statt absolut, damit die
bisherige Marktbewegung jeder Karte erhalten bleibt. Kopien und Slabs folgen von selbst (Kartenwert × Zustand bzw.
Grade-Faktor). KI-Angebote werden neu bepreist; Angebote von Spielern behalten ihren Preis, weil der Besitzer ihn
gewählt hat (er kann ihn jederzeit ändern). Verkäufe der Vergangenheit bleiben, wie sie waren. Danach wird der
Katalog-Hash geleert, damit der nächste `nexamon_sync()` die Startpreise genau auf den Katalog legt – egal ob Sync
oder Migration zuerst läuft.

**Folgen.** Diamond-Ziehungen fühlen sich besser an (im Mittel 776.588 € statt 597.375 €), der Uranium-Jackpot ist
im Mittel 20,3 statt 22,1 Mio. € wert. Der Erwartungswert zu Startpreisen bleibt auf den Cent; zu Marktwerten ändert
er sich nur, wenn Diamond und Uranium sich seit dem Start unterschiedlich bewegt haben, um 3.584,25 € × (d − v)
(BALANCING.md). Angebote von Spielern für Diamond sind nach der Umstellung eher günstig, für Uranium eher teuer; das
regelt der Markt. Einzelwerte in `docs/BALANCING.md`.

## ADR-206: Klon mit eigenem Job, Lohn nach Skills, Gewinnbeteiligung und Mitarbeiteraktien — `Annahme`

**Kontext.** Der Eigentümer wünscht: Ab Level 20 kann man einen Klon von sich erschaffen, der sich bei anderen Firmen
bewirbt, damit man neben der eigenen Firma woanders arbeiten kann. Jobs sollen bei vielen Skills deutlich besser
zahlen. Ab Senior gibt es einen kleinen Anteil am Gewinn, mit dem Rang steigend bis höchstens 5 %, und für gute Arbeit
ab und zu Aktien der Firma. Die Nachricht brach mitten im Satz ab („Passe deine Stellenanzeigen so an, dass du …“);
angenommen ist: Stellenanzeigen zeigen Skill-Passung, erwarteten Lohn, Gewinnbeteiligung und Aktien-Chance, damit man
vergleichen kann, und Gründer können ihre Anzeigen damit zuschneiden. Nicht zu verwechseln mit den „Talenten“
(NPC-Angestellte der Firmen, eigener ADR): Hier geht es um den Spieler, der bei Firmen arbeitet.

**Entscheidung.**

- **Klon** (`jobs.clone`): ab Level 20, einmal pro Spieler, kostet einmalig 25 000 € (an die Staatskasse, Ledger).
  Der Klon hat einen eigenen Job-Platz: eine zweite Zeile in `player_jobs` mit `is_clone = true` und der `player_id`
  des Besitzers. Ein aktiver Job je Spieler **und** Halter (eindeutiger Index `player_jobs_active_holder_uq`).
  - Er bewirbt sich bei KI- und Spielerfirmen über dieselben Abläufe: `clone_apply_for_job`, `clone_sign_contract`,
    `clone_quit_job` (mit Frist oder sofort), `clone_cancel_quit`, `clone_request_raise`, `clone_request_promotion`.
    Die Wrapper setzen die Transaktions-Einstellung `nexa.acting_clone`, die Job-RPCs lesen `job_acting_clone()` und
    arbeiten dann auf dem Job des Klons. So gibt es keine zweite Kopie der Regeln.
  - Nie in der eigenen Firma (`clone_own_company`), nie in derselben Firma wie der Spieler selbst
    (`clone_same_company`). Gründer dürfen über den Klon also eine Firma führen **und** einen Job haben: Die Vollzeitregel
    (ADR-066) und der halbe Gründer-Beitrag bei einem Nebenjob gelten nur für den eigenen Job, nicht für den des Klons.
  - Er arbeitet automatisch wie jeder Job (ADR-064). Lohn, Gewinnbeteiligung und Aktien gehen an den Besitzer. Er hat
    seine eigenen 8 bezahlten Stunden am Tag, sammelt Erfahrung, Rang-Stunden, XP und Bereichspunkte wie ein Job und
    richtet sich nach der Anwesenheit des Besitzers (ADR-103): Wer lange weg ist, verliert Lohn und nach fünf Tagen
    auch den Job des Klons. Im Team erscheint er als „Klon von …“, ebenso auf der Visitenkarte und im Job-Tab.
  - Ein Kontoneustart behält den Klon; nutzbar ist er erst wieder ab Level 20 (kündigen geht immer).
- **Lohn nach Skills** (`jobs.skillPay`): Faktor = 1 + 3 % je Punkt in den geforderten Bereichen (je Bereich bis 40
  gezählt) + 0,5 % je gelerntem Skill insgesamt, höchstens das Dreifache. Ersetzt die alte KI-Lohndecke (1 + 3 % je
  Treffer-Punkt, der Treffer-Score endet beim Doppelten der Anforderung, höchstens ×1,5). Spielerfirmen verhandeln
  weiter frei; das Jobportal zeigt ihnen den „Marktwert“ (Stufenlohn × Faktor) als Vergleich.

  | Beispiel (Grundlohn)                                      | vorher              | nachher                  |
  | --------------------------------------------------------- | ------------------- | ------------------------ |
  | Praktikum (150 €), 3 Skills, Score 0                      | 150 €/Std.          | 152,25 €/Std.            |
  | Senior IT (700 €), IT 12, 15 Skills                       | 952 €/Std. (×1,36)  | 1 004,50 €/Std. (×1,435) |
  | Senior IT (700 €), IT 30, 40 Skills                       | 952 €/Std. (×1,36)  | 1 470 €/Std. (×2,1)      |
  | Teamleitung IT (1 300 €), IT 40, Management 20, 60 Skills | 1 950 €/Std. (×1,5) | 3 900 €/Std. (×3)        |

- **Gewinnbeteiligung** (`jobs.rewards`): Senior 0,5 %, Teamleitung 2 %, C-Level 5 % vom Gewinn des Arbeitgebers,
  darunter nichts. Gründer können in einer Anzeige bis zu 3 % drauflegen (`set_job_posting_perks`), zusammen höchstens
  5 %. Gezahlt wird nur bei Gewinn, aus der Firmenkasse an den Spieler (Ledger, Summe 0), nie mehr als die Kasse hat.
  - Spielerfirmen: nach jeder abgerechneten Stunde (Trigger auf `player_company_hours`), nach der CEO-Auszahlung. Alle
    Beteiligungen einer Stunde zusammen höchstens 25 % des Stundengewinns (gleichmäßig gekürzt).
    Beispiel Garage mit 818,75 € Stundengewinn: Senior 4,09 €, C-Level 40,94 € je Stunde.
  - KI-Firmen: mit jeder Lohnzahlung (Trigger auf `salary_payouts`). Der Gewinn eines Konzerns ist riesig, darum zählt
    der Gewinn einer Abteilung von 50 Leuten: Jahresgewinn / 4 / Quartalsstunden × 50 / Mitarbeiter, höchstens die
    Hälfte des Lohns. Beispiel Vulcan Energy (470 Mio. € Jahresgewinn, 21 000 Leute): 46 600 € Abteilungsgewinn je
    Stunde, Senior 233 €/Std., C-Level bis 2 331 €/Std. (gedeckelt auf den halben Lohn).
- **Mitarbeiteraktien**: Chance je bezahlter Stunde guter Arbeit (der Spieler war da, die Firma macht Gewinn):
  Junior 1 %, Senior 3 %, Teamleitung 5 %, C-Level 8 %, in Anzeigen bis zu 5 % mehr. Der Wurf ist deterministisch
  (Hash aus Job und Stunde), dieselbe Stunde würfelt nie zweimal. Ein Paket ist 4 Stunden Vertragslohn wert und wird von
  der Firma bezahlt.
  - Börsennotiert (KI-Firmen und Spieler-AGs): ganze Aktien aus dem freien Bestand (ADR-153) zum letzten Kurs; die Firma
    zahlt den Gegenwert an den Markt, dem die freien Aktien gehören. Die Zahl der Aktien wächst dadurch nie, gehaltene
    Aktien bleiben unter `shares_outstanding`.
  - Nicht notiert (oder nichts frei): „Phantomaktien“, der Wert wird bar ausgezahlt (`stock_grant_cash`).
  - Erwartungswert Senior: 3 % × 4 Stunden = + 12 % auf den Lohn.
- **Stellenanzeigen**: Das Jobportal zeigt für jede Stelle den Lohn-Aufschlag durch Skills, bei Spielerfirmen den
  Marktwert, die Gewinnbeteiligung, die Aktien-Chance und ob die Firma etwas drauflegt. Mit Klon gibt es oben den
  Umschalter „Bewerben für: Mich / Meinen Klon“; Bewerbungen und Verträge gelten je Halter.

**Folgen.** Ab Level 20 kann ein Spieler zwei Löhne beziehen; das ist gewollt und kostet einmal 25 000 €. Gut
ausgebildete Spieler verdienen bei KI-Firmen bis zum Dreifachen des Stufenlohns, Gewinnbeteiligung und Aktien kommen
dazu. Spielerfirmen zahlen Beteiligungen aus ihrem Gewinn; die Quartalsberichte (aus `player_company_hours`) zeigen sie
nicht als Kosten. Die Funktionen `job_state`, `sign_contract`, `apply_for_job`, `get_job_board`, `quit_job`,
`cancel_quit`, `request_raise`, `request_promotion`, `get_employer`, `company_full_time_check`,
`player_company_team`, `get_player_card` und einige Leser sind in Migration 9810 neu geschrieben (Stand 9800).

## ADR-203: Ranglisten – ein Wert je Firma, ein Vermögen aus allen Teilen — `Entscheidung (Eigentümer)`

**Kontext.** Der Eigentümer: „Top-Unternehmen sagt, meine Firma ist 3 Mio. wert, die Firmenseite sagt 49,4 Mio.“
Die Suche nach allen Stellen, an denen Firmenwert und Vermögen berechnet wurden, fand vier Formeln:

| Stelle                                             | vorher                                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Firmenseite (`company_state.value_cents`)          | `company_value_cents`: Kasse − offene Löhne + 4 × Quartalsgewinn × KGV × 0,5, auch an der Börse                       |
| Top-Unternehmen (`get_company_ranking`)            | an der Börse Aktien × letzter Kurs, privat `company_value_cents`                                                      |
| Firmenprofil (`get_company_profile`)               | an der Börse `security_quotes.market_cap_cents` (zu anderen Zeiten, teils aus dem fairen Wert geschrieben)            |
| Forbes 100, Alle, Liga (`rich_list_entries`)       | eigene Firma mit `company_value_cents`, **auch an der Börse**, plus die Aktien des Gründers im Depot: doppelt gezählt |
| Visitenkarte, Missionen (`player_net_worth_cents`) | ohne Börsenfirma (nur die Aktien), also anders als Forbes 100                                                         |
| Startseite (Client)                                | Konto + Depot + Firma − Schulden, ohne NFTs, Zuhause, Deals                                                           |

Nexamon-Karten, der Tresor und Geld für gezeichnete Aktien (Treuhand, ADR-151) zählten nirgends. Die 3 Mio. gegen
49,4 Mio. sind der Börsenwert einer börsennotierten Firma gegen ihren Ertragswert.

**Entscheidung.**

- **Ein Wert je Firma, überall:** `company_worth_cents(firma)`. An der Börse (Phase `listed` mit Kurs) der
  Börsenwert = alle Aktien × letzter Kurs, privat der Firmenwert `company_value_cents`. Ihn zeigen Top-Unternehmen,
  die Firmenseite (Kachel „Börsenwert“ bzw. „Wert“, darunter bei Börsenfirmen der Ertragswert), das Firmenprofil und
  das Vermögen des Gründers. `company_worth_json` liefert Wert, Grundlage (`market_cap` | `company_value`),
  Ertragswert, Kurs und Aktienzahl.
- **Ein Vermögen aus allen Teilen:** `player_wealth_parts(spieler | null)` mit Bargeld (alle eigenen Konten), Depot
  (offene Positionen zum Geldkurs, ohne die eigene Börsenfirma), eigene Firma (privat `company_worth_cents`, an der
  Börse die eigenen Aktien zum letzten Kurs, also derselbe Kurs wie der Börsenwert), Nexamon-Karten (ohne Note) und
  Slabs (mit Note, Black Labels mit Hype) zum Marktwert, NFTs zum letzten Verkaufspreis, Zuhause, Möbel, Autos, Böden
  zum Wiederverkaufswert, Tresor (was Leeren auszahlen würde), Treuhand (Geld offener Zeichnungen), Deals (ADR-098) und
  Schulden (negativ). Vermögen = Summe. `player_net_worth_cents`, `rich_list_entries` (Forbes 100, Alle,
  Schnappschüsse, Rang-Missionen, Vermögensverlauf) und die Startseite lesen nur noch das. Nicht gezählt: Accessoires
  (kein Wiederverkauf), ungeöffnete Booster und Einsätze laufender Spiele.
- **Je Liste eine dokumentierte Regel**, in der App unter „Wie wird gerechnet?“: Forbes 100 = echte Spieler nach
  Vermögen; Alle = dazu die KI-Tycoons (Bargeld + Aktien zum Geldkurs); Top-Unternehmen = `company_worth_cents`,
  „Spielerfirmen“ oder „Mit KI-Firmen“, dazu ein Branchenfilter (der Platz bleibt der Platz in der ganzen Liste).
- **Bewegung gegenüber gestern:** Rangliste wie bisher aus `rich_list_snapshots`; Top-Unternehmen neu aus
  `company_rank_snapshots` (alle `richList.companySnapshotMinutes` = 30 Minuten, pg_cron `nexa-company-ranking`,
  `richList.snapshotKeepDays` = 8 Tage). Pfeile für Plätze, Prozent für den Wert. Jede Zeile von Forbes 100 nennt die
  Hauptquelle des Vermögens (größter Teil: Bargeld, Aktien, Firma, Nexamon, NFTs, Immobilien).
- **Eigene Position:** hervorgehoben in der Liste, sonst unten angeheftet (Spieler und Firma), dazu die Karte
  „So setzt sich dein Vermögen zusammen“ (`get_my_net_worth`).
- **Wochenliga:** zählt alle Teile außer dem Tresor (Grundeinkommen ist geschenktes Geld, ADR-089). Die laufende
  Saison wurde einmal umgestellt: Der Start verschiebt sich um das, was die neue Rechnung ändert, das Wachstum bleibt.
- **Zwischenspeicher:** Forbes 100 und Alle rechnen bei jedem Abruf neu (alle 15 Sekunden), die Schnappschüsse dienen
  nur den Pfeilen; damit ist der eigene Wert in der Liste immer derselbe wie auf Firmenseite, Karte und Startseite.

**Folgen.** Gründer börsennotierter Firmen verlieren in Forbes 100 den doppelt gezählten Ertragswert; Sammler mit
wertvollen Karten steigen. Die Pfeile und die 24-h-Prozente zeigen einen Tag lang auch diesen Sprung; die
„Größter Gewinner“-Meldung des Tages kann davon betroffen sein. Der Tresor wächst sekündlich, darum friert
`tests.vault_quiet` ihn in SQL-Tests ein, die Vermögen über mehrere Anweisungen vergleichen. Liegt der Börsenkurs weit
unter dem Ertragswert (wie beim Eigentümer: 3 Mio. gegen 49,4 Mio.), zeigt die Firmenseite das jetzt offen; ob der
Kurs einer Spieler-AG zu langsam zum fairen Wert findet, ist eine eigene Frage. SQL-Test `d9_toplists.sql`.

## ADR-200: Firmenlogo für 50.000 € neu zeichnen — `Entscheidung (Eigentümer)`

**Kontext.** Der Eigentümer: „Man soll das Profilbild vom Unternehmen für 50.000 € neu machen können.“ Bisher stand
das Logo nach dem ersten Zeichnen fest (ADR-076); nur ein nach Meldungen ausgeblendetes Logo durfte ersetzt werden.

**Entscheidung.**

- Der **Gründer** kann das Logo seiner aktiven Firma jederzeit neu zeichnen, für `startups.logoRedrawCents`
  (50.000 €) aus der **Firmenkasse** (frei = Kasse − offene Rechnungen). Buchung Firmenkasse → Staatskasse
  (`company_costs`, Summe 0), Schlüssel je Anfrage, also idempotent.
- Dieselben Prüfungen wie beim ersten Logo: `logo_valid` und `logo_has_forbidden_symbol` (`logo_forbidden`).
- Höchstens einmal je `startups.logoRedrawCooldownHours` (24 h), sonst `locked`. Gespeichert in
  `player_companies.logo_redrawn_at`.
- `logo_version` steigt: Meldungen gegen das alte Logo zählen nicht mehr, ein ausgeblendetes Logo ist wieder sichtbar.
- Neuigkeit `logo_redrawn` („… verkündet: {Firma} hat ein neues Logo.“), mit dem neuen Logo als Symbol.
- Oberfläche: Controlling → Marke & Firma, Knopf „Logo neu zeichnen · 50.000 €“ statt des gesperrten „Logo
  zeichnen“. Der Editor startet mit dem jetzigen Logo, „Weiter“ erst nach einer Änderung, dann ein Bestätigungs-Sheet
  mit alt und neu, Preis und Pause. In der Pause ein Countdown, bei zu wenig Geld ein Hinweis.
- `get_logo_redraw(firma)` liefert Preis, Pause und den nächsten möglichen Zeitpunkt. Ein eigenes RPC statt eines
  Feldes in `company_state`, weil eine spätere Migration (`toplists`) `company_state` neu schreibt.

**Folgen.** Das Logo bleibt etwas Bleibendes (der Preis ist spürbar, aber für eine laufende Firma erreichbar), ein
Fehlgriff ist nicht mehr für immer. Das erste Logo bleibt kostenlos.

## ADR-204: Große Momente bei Packs und ASP, Ergebnis vieler Packs, neuer Boni-Tab — `Entscheidung (Eigentümer)`

**Kontext.** Der Eigentümer wünscht vier Dinge an der Sammelkarten-Oberfläche: Der Tab „Boni“ ist eine lange Liste
und soll übersichtlicher werden, ohne dass etwas verloren geht. Sind die letzten zwei Karten eines selbst geöffneten
Packs sehr selten, soll das Aufdecken ein echter Dopamin-Moment sein. Das Ergebnis von zehn auf einmal aufgedeckten
Packs verlangt viel Scrollen, bis man den Gesamtwert sieht. Und das Paket von ASP soll beim Öffnen deutlich mehr
Spannung aufbauen, vor allem bei einer 10 und dem Black Label. Alles ist reine Oberfläche; der Server bleibt unberührt.

**Entscheidung.**

- **`RareReveal`** (`src/features/nexamon/components/rare-reveal.tsx`) ist ein wiederverwendbarer Baustein (auch für
  die Ansicht der Pack Battles): Die Karte liegt verdeckt, ihr Glanz in der Farbe der Seltenheit schimmert heraus;
  sobald `play` wahr wird, bebt sie immer stärker, Glanz und ein neuer 8-Bit-Klang (`revealCharge`, „pnpm sounds“)
  steigen an, dann dreht sie sich um: Blitz über den ganzen Bildschirm (`ScreenFlash`), Pixel-Konfetti in den Farben
  der Seltenheit, ein Banner und der Wert, der hochzählt (`useRollUp`), dazu Vibration (`jackpot`). Die Stufe
  (`revealTier`): Ultra/Titanium 1, Prisma/Diamond 2, Legendary 3, One of One/Uranium 4; eine Karte im Wert von
  mindestens zehn Packs (`BIG_PULL_FACTOR`) steigt eine Stufe. Aufladen 0,75 s bis 2,1 s. Common und Rare bleiben
  beim bisherigen Aufdecken. Das sind Darstellungswerte, keine Spielwerte, daher in `lib.ts` statt `balance.ts`.
- **Pack-Opening:** Nur die letzten zwei Plätze bekommen den großen Moment (`finaleSlots`). Die Karte darüber
  gleitet langsamer weg; während des Aufladens wirft ein Wischen oder eine Taste die Karte nicht, sondern kürzt das
  Warten ab. Der Glanz des Stapels und der One-of-One-Moment folgen nach dem Umdrehen.
- **ASP-Paket:** Der Slab steigt verdeckt auf und dreht sich zum Zählen um; ein Scanner läuft über das verdeckte
  Etikett, jeder Schritt lässt den Slab zucken (ab 8,5 auch Vibration). Ist die Note erreicht, hält das Etikett den
  Atem an: bei einer 10 1,4 s mit Herzschlag und Aufladeklang, beim Black Label 2,8 s, während der ganze Bildschirm
  schwarz wird. Danach: 9/9,5 Funken, 10 goldener Blitz und Konfetti in zwei Wellen, Black Label weißer Lichtstreif,
  ein Sturm aus schwarz-goldenem Konfetti in drei Wellen, zwei Blitze und der große Stempel. Der Wert zählt vom
  rohen Kartenwert zum Slab hoch („Wert ×3,2“). „Überspringen“ steht schon vor dem Aufreißen bereit.
- **Viele Packs („Alle aufdecken“):** `MultiPackSummary` zeigt oben, beim Scrollen festgeheftet, Gewinn oder
  Verlust groß in Grün oder Rot, Wert, Preis, Karten und Neue; darunter die drei besten Treffer, alle Karten als
  kompaktes Raster nach Wert (Filter je Seltenheit), den Wert je Pack zum Aufklappen und den Sofortverkauf
  (ADR-196) für alle Karten. Die Berechnung steckt in `summarizePacks` (`view.ts`, getestet).
- **Boni:** Ringe für die sieben Bonus-Arten gegen ihre Grenze (Gold, wenn gedeckelt), die Regel zum Aufklappen,
  „Als Nächstes“ mit den drei Sammlungen, die am nächsten am Ziel sind (samt fehlender Karten), die aktiven
  Bonus-Karten und auf Wunsch die fehlenden, darunter jedes Set zusammengeklappt (das mit dem meisten Fortschritt
  offen) mit Set komplett, Master-Set und den Typ-Sammlungen als Kacheln mit Ring.
- Mit reduzierter Bewegung (System oder Einstellung „Animationen“) entfallen Beben, Blitz, Konfetti und Abdunkeln;
  Karte und Note stehen sofort da, Banner und Wert ohne Hochzählen. Es bewegen sich nur `transform` und `opacity`.

**Folgen.** Ein großer Treffer kostet in den letzten zwei Plätzen 0,75 bis 2,1 s mehr, ein ASP-Ergebnis bis zu
rund 1,5 s mehr; beides lässt sich abkürzen. Die Pack-Battle-Ansicht kann `RareReveal` mit `play` und `valueCents`
einbinden. Die Übertragung großer Züge an Zuschauer (ADR-172) bleibt unverändert.

## ADR-208: Weltkarte – Standort, Zentrale, Tochterfirmen und Länder-Lobby — `Entscheidung (Eigentümer)`

**Kontext.** Der Eigentümer möchte Firmen ab 10 Mio. € Firmenwert auf einer Weltkarte platzieren: ein Land mit
realistischen Eigenschaften wählen (China billig, aber schwächeres Image; Deutschland teure Arbeit, starkes Image; USA
große Nachfrage, höhere Steuern …), alle Länder unterm Strich gleich gut. Dazu eine ausbaubare Zentrale (pixelig,
gestaltbar), später Tochterfirmen in anderen Ländern und ein Marktführer je Land mit Lobby-Bonus und Standortgebühr.
Alles im neuen Firmen-Tab „Standort“ direkt vor „Buchhaltung“. Parallel entstehen externe Ereignisse und Steuern
(ADR-209); beide teilen einen Vertrag.

**Entscheidung.**

- **Länder** (`src/config/countries.ts`, `game_config.world.countries`): 22 Länder. Je Land Produktionskosten,
  Arbeitskosten, Nachfragepotenzial und Image als Basispunkte gegen 10 000, Steuersatz, politisches Risiko,
  Zollrisiko, Konfliktrisiko (0–100) und Naturgefahren, dazu Kartenposition und Flaggenfarben (Daten).
- **Balance-Prüfung:** `countryScore` gewichtet jeden Vorteil nach seiner Wirkung auf die Stunde (Wareneinsatz 0,5,
  Arbeit 0,3, Nachfrage 1, Image 0,5, Steuern 0,2 je Basispunkt; Risiken je Punkt 4/3/6, je Naturgefahr 120). Jedes
  Land liegt höchstens `balance.tolerance` = 400 Punkte vom Mittel (größte Abweichung heute ≈ 310), und kein Land ist
  in allen Kosten-, Nachfrage- und Steuerwerten das beste (`world.test.ts`).
- **Vertrag mit ADR-209** (Migration 10000, Signaturen fest): Tabelle `company_locations` (company_id, country_key,
  placed_at, hq_tier, hq_style, invested_cents, …), `world_cfg()`, `country_cfg(text) → jsonb`,
  `company_country(uuid) → text`, `country_market_leader(text) → uuid`, `company_is_market_leader(uuid) → boolean`,
  dazu in 10010 `world_tax_rate_bps(uuid)` (Mischsatz aus Zentrale und Töchtern, minus Lobby-Rabatt). Steuern und
  Ereignisse liest ADR-209; diese ADR wendet nur Kosten und Nachfrage an.
- **Freischaltung:** ab `unlockWorthCents` = 10 Mio. € (`company_worth_cents`, ADR-203). Darunter zeigt der Tab die
  Karte mit allen Firmen, die Ländereigenschaften und den Fortschritt.
- **Zentrale:** Bürogebäude 1 Mio. €, dann Bürokomplex 4 Mio., Campus 15 Mio., Tower 60 Mio., Mega-Campus 250 Mio.
  (Firmenkasse → Staatskasse, Ledger). Jede Stufe bringt Plätze (`company_max_employees`), einen Prestige-Aufschlag auf
  die Nachfrage (0 bis 4 %) und einmalig Ruf (`company_reputation_bump`), Bekanntheit (nur über
  `company_awareness_add`) und Zufriedenheit eines Börsenteams; Prestige und Stufe stehen auf dem Firmenprofil. Das
  Gebäude ist Pixel-Art (`src/components/pixel/hq.ts`, eigene Entwürfe), gestaltbar: Fassade, Dach, Schild (8 Farben),
  Dachform, Schmuck, Landesfahne; das Schild trägt die Initialen.
- **Umzug:** 20 % des in die Zentrale gesteckten Geldes, mindestens 0,5 Mio. €, danach 7 Tage Pause; die Stufe bleibt.
- **Tochterfirmen:** ab 50 Mio. € Firmenwert oder ab Bürokomplex, höchstens 4, nie im Land der Zentrale. Gründung
  3 Mio. €, jede weitere × 1,6. Laufend 600 € je Stunde, zu Beginn das Dreifache, über 14 Tage fallend. Eine
  hochgelaufene Tochter macht 15 % des Umsatzes zu den Bedingungen ihres Landes und bringt 5 % Nachfrage aus dem neuen
  Markt; jede weitere nur 60 % davon (abnehmender Ertrag, harte Grenze).
- **Image-Kampagne im Land:** 0,5 % des Firmenwerts (mindestens 200 000 €), +5 % Image dort, höchstens +30 %, verblasst
  um 1 % am Tag, alle 12 Stunden.
- **Länder-Lobby:** Marktführer ist die aktive Spielerfirma mit dem größten `company_worth_cents` unter allen mit
  Zentrale im Land (mindestens 10 Mio. €). Sie zahlt 10 % weniger Steuern und spürt politische Ereignisse 30 % schwächer
  (beides wendet ADR-209 an) und darf eine Standortgebühr bis 3 % des Stundenumsatzes der anderen Spielerfirmen im Land
  verlangen (Änderung höchstens einmal am Tag, alle werden benachrichtigt). Die Gebühr wird in der Stundenabrechnung nur
  aus der freien Kasse gezahlt, nie als offene Rechnung (kein Soft-Lock), und verfällt, sobald jemand anderes führt.
  Ausweg: wachsen oder umziehen. KI-Firmen stehen nur auf der Karte (Land aus ihrer ID), führen nie und kassieren nie.
- **Stundenabrechnung:** `player_company_close_hour` bleibt unverändert. `listed_hour_effect` (volle Kopie aus 8300)
  multipliziert `world_hour_effect` in Nachfrage, Wareneinsatz und Fixkosten; `listed_hour_costs` (volle Kopie aus 5400) bucht vorher `world_hour_costs` (Tochterkosten, Gebühr) für jede Spielerfirma. Fehler darin landen in
  `company_close_warn`, die Stunde läuft weiter. Die Faktoren bleiben zwischen 0,6 und 1,6.
- **Oberfläche:** Tab „Standort“ vor „Buchhaltung“ (`tabs.ts`, alte Links bleiben gültig, neue Ziele `world-hq`,
  `world-lobby`, `world-subsidiaries`, `world-map`), Kachel auf dem Dashboard, Offenlegung `companyWorld` ab Level 9.
  Karte mit Ziehen und Zoomen (Zwei-Finger, Mausrad, Knöpfe; ganzzahlige Stufen), alle Länder zusätzlich als Liste.
  Mira beantwortet Fragen zu Ländern aus der Konfiguration, ohne Claude.

**Folgen.** Ein Spieler hat mit 22 Ländern echte Wahl ohne Pflichtland; wer früh groß wird, kann in seinem Land
kassieren, aber höchstens 3 % und nur so lange er führt. Mit 4 Spielern funktioniert alles, auch wenn alle im selben
Land sitzen. Neue Länder oder Werte ändern nur die Konfiguration; die Balance-Prüfung schlägt Alarm, wenn ein Land
herausragt. Die Gebühr zählt für den Zahler als Fixkosten der Stunde; für den Marktführer ist sie Geld in der Kasse,
kein Umsatz. SQL-Test `e6_world.sql`, Unit-Tests `world.test.ts`, `hq.test.ts`, Mira `assistant/world.test.ts`, E2E
`world-map.spec.ts`.

## ADR-211: Firmenaufgaben laufen weiter, auch wenn eine einzelne Aufgabe scheitert — `Annahme`

**Kontext.** Der Eigentümer meldet: „Firmenaufgaben funktionieren gerade nicht mehr.“ Nachgestellt auf einer lokalen
Datenbank wie live (frisch aufgesetzt und über `update-to-latest.sql`, `scripts/apply-updates.sh` und die
SQL-Editor-Teile von einem Stand vom 26.11. aus, mit offenen Aufgaben aller 32 Spiele): Aufgaben entstehen, die Liste
lädt, jedes Spiel startet und wird bewertet, Abgeben an Mitarbeiter und KI, Autopilot und Fristen laufen. Die
Rätsel-Felder des Servers passen in allen 32 Spielen zu denen der Client-Spiele. Ein Fehler, der nur mit den Daten
live auftritt, ließ sich lokal also nicht erzwingen; die Bauweise erklärt aber, warum er **alle** Firmen trifft:
`company_tasks_run_due()` (Cron jede Minute) erledigte KI-Ergebnisse, Fristen, neue Aufgaben, den Autopilot aller
Firmen und das Aufräumen in einer einzigen Transaktion. Ein einziger Fehler irgendwo (eine Aufgabe, eine Firma) rollte
die ganze Minute zurück – keine neuen Aufgaben, keine KI-Ergebnisse, keine Fristen, für alle, jede Minute, bis die
Ursache weg war. Gesehen wurde der Fehler nirgends (nur in `cron.job_run_details`). Dabei aufgefallen: Eine Aufgabe für
einen Klon (ADR-206) konnte niemand öffnen (der Klon sieht die Aufgabenliste nie) und lief in die Strafe; eine Antwort
ohne Liste (`{}`) bekam bei „Belege prüfen“ und „Regal ordnen“ volle Punkte; eine Aufgabe eines Spiels, das der
geladene Client noch nicht kennt (Server zuerst aktualisiert), ließ die ganze Liste an der Zod-Prüfung scheitern.

**Entscheidung.**

- Jede Aufgabe, jede Firma und jeder Schritt des Minutenlaufs (und des Autopiloten) läuft in einer eigenen
  Untertransaktion. Fehler stehen in `job_runs` (`job_name = 'company_tasks'`, mit Meldung, Schritt und ID) und halten
  die anderen nicht auf; die betroffene Aufgabe wird in der nächsten Minute erneut versucht.
- Aufgaben, deren Empfänger nicht mehr in der Firma ist (gekündigt, entlassen) oder ein Klon ist, sind binnen einer
  Minute wieder offen statt bis zur Frist blockiert. Klone bekommen keine Aufgaben und führen niemanden.
- Fehlt die Liste in der Antwort, gibt es 0 Punkte, wie im TypeScript-Gegenstück.
- Der Client lässt Aufgaben unbekannter Spiele weg und blendet Klone in der Aufgabenliste aus, statt die Antwort zu
  verwerfen.

**Folgen.** Ein künftiger Fehler trifft nur noch die eine Aufgabe oder Firma und ist mit einer Abfrage auf `job_runs`
sichtbar. Der Lauf kostet je Zeile eine Untertransaktion (wenige Aufgaben je Minute). SQL-Test `e3_company_tasks.sql`,
Unit-Test `src/features/game/api-tasks.test.ts`. Die ADR-Nummer ist vorläufig, falls parallel dieselbe vergeben wurde.

## ADR-209: Größe hat ihren Preis – Reibung, Ereignisse von außen, Versicherung, Lobby, Steuerstufen — `Entscheidung (Eigentümer)`

**Kontext.** Der Eigentümer: „Gerade wird man mit einer Firma sehr leicht riesig. Am Anfang soll es so bleiben, in
den hohen Millionen soll es schwerer werden. Milliarden sollen möglich sein, aber nicht so schnell.“ Dazu Ereignisse
„von außen“ mit Gegenmaßnahmen, höhere und progressive Firmensteuern und ein deutlich teurerer Steuerberater.

**Entscheidung.** Werte in `src/config/macro.ts` (`game_config.macro`), `companyEvents` (15 neue Archetypen) und
`listed.taxes`; Formeln in `src/lib/sim/macro.ts`, gespiegelt in Migration `20261204010100_macro_events.sql`.

- **Reibung nach Firmenwert** (`company_worth_cents`, ADR-203), erst ab 30 Mio. €: Marktsättigung (Nachfrage ×
  (30 Mio. / Wert)^0,25) und Verwaltung (+20 % des Umsatzes je Verzehnfachung, höchstens 45 %). Darunter ändert sich
  nichts. Die Wirkung läuft über den einzigen Haken `company_event_hour_effect` (Nachfrage-Faktor und Zusatzkosten),
  `player_company_close_hour` bleibt unangetastet. Alle Zusatzkosten der Stunde (Ereignis, Verwaltung, Prämie) sind
  auf 60 % des Umsatzes gedeckelt: Eine gut geführte Firma geht daran nicht pleite.
- **Ereignisse nach Größe** ab 20 Mio. €: je Verzehnfachung +20 Prozentpunkte Tageschance (höchstens 95 %), 8 Punkte
  weniger Chancen unter den Lagen, schwerere Stufen, externe Archetypen wiegen (1 + Zehnerstufen) mal mehr. Die
  Kosteneinheit der Reaktion ist dann mindestens eine Viertelstunde Umsatz. Kleine Firmen ziehen nie ein externes
  Ereignis; ihr Wurf ist derselbe wie vorher.
- **15 Ereignisse von außen** im bestehenden Krisensystem (Strategien mit bezahlten, zeitlich gebundenen, scheiternden
  Schritten; Mira, eigene Strategien, Kursreaktion, Firmen-News funktionieren ohne Sonderweg): politische Entscheidung
  (große Lobby-Kampagne, vier Schritte mit Risiko), Zölle, Erdbeben, Tsunami, Überschwemmung, Waldbrand,
  Krankheitswelle, Shitstorm, Konflikt in der Region, Rohstoffknappheit, Cyberangriff, Kartellverfahren (ab 500 Mio. €),
  Streik der Gewerkschaft, Währungskrise, Energiepreisschock. Jede ist lösbar und lässt sich aussitzen; Frist und
  Vorlaufzeit sind die Warnung, die Karte „Risiken“ zeigt vorher, was wie wahrscheinlich ist.
- **Länderrisiko** über den Weltkarten-Vertrag (ADR-208): `company_country`, `country_cfg`, `company_is_market_leader`
  werden als neutrale Stubs angelegt, falls die Weltkarte fehlt. Politisches Risiko, Zollabhängigkeit, Kriegsrisiko
  (0..100) und ein schlechtes Image erhöhen die passenden Gewichte; genannte Katastrophen (earthquake → auch Tsunami,
  storm → Überschwemmung und Tsunami, drought → Waldbrand) wiegen × 2,5, die übrigen × 0,4. Marktführer eines Landes
  spüren politische Krisen um `world.lobby.politicalImpactReductionBps` weniger. Ist `world_tax_rate_bps` vorhanden,
  ist sie der Grundsatz der Körperschaftsteuer.
- **Versicherung** (`player_companies.insurance_level`, RPC `set_company_insurance`): Keine / Basis (50 %, 0,4 % vom
  Umsatz) / Voll (80 %, 1,1 %). Die Prämie läuft mit den Zusatzkosten der Stunde; die Deckung wird beim Start eines
  versicherbaren Ereignisses (Katastrophen, Cyberangriff) in die Definition geschrieben (Trigger), eine höhere Stufe
  gilt erst nach 12 Stunden.
- **Lobby** (`player_companies.lobby_level`, höchstens 5): jede gewonnene Lobby-Strategie (`lobby…`) hebt die Stufe
  (Trigger, Firmen-News `lobby_level`). Je Stufe +3,5 Punkte Erfolgschance auf Lobby-Schritte (höchstens 95 %) und
  12 % weniger politische Krisen.
- **Steuern** (nur Börsenfirmen haben Bücher, wie bisher): Stufen auf den Tagesgewinn, auf die Länge der
  Buchungsperiode umgerechnet (öfter abschließen ändert nichts): 15 % bis 100.000 €, darüber +2 %, ab 1 Mio. € +5 %,
  ab 10 Mio. € +8 % (Grenzsatz 30 %). Der Steuerberater kostet 1,5 % des Referenzumsatzes bis 1.000 € je Stunde,
  danach ×2,4 je Verzehnfachung (höchstens 30 %), mindestens 60 € je Stunde. `rate_bps` einer Periode ist der
  effektive Satz.
- **Oberfläche:** Ereigniskarte mit Abzeichen „Von außen“ und „Versicherbar“; Controlling → Wachstum → „Risiken“
  (`RisksCard`, `Reveal companyRisks`): Firmenwert, Tageschance, Sättigung, Verwaltung, Versicherung mit Wartezeit,
  Lobby-Stufe, die wahrscheinlichsten Ereignisse und was mit mehr Wert dazukommt. Demo: „Ereignis von außen“.

**Gemessen** (`scripts/growth-harness.ts`, Median dreier Läufe, vorsichtiger Gründer ohne Börsenhebel):

| Nische                 | Modell  | 10 Mio. € | 100 Mio. € | 1 Mrd. €     |
| ---------------------- | ------- | --------- | ---------- | ------------ |
| Tech, 200.000 €/Jahr   | vorher  | 2,0 Tage  | 22,8 Tage  | 248,9 Tage   |
| Tech, 200.000 €/Jahr   | nachher | 2,0 Tage  | 47,3 Tage  | 603,8 Tage   |
| Pharma, 10 Mio. €/Jahr | vorher  | 3,3 Tage  | 49,4 Tage  | 335,2 Tage   |
| Pharma, 10 Mio. €/Jahr | nachher | 4,3 Tage  | 73,8 Tage  | 1.667,8 Tage |

Von 100 Mio. auf 1 Mrd. € dauert es 2,5- bis 5,6-mal so lange, bis 10 Mio. € praktisch gleich.

**Folgen.** Börsenfirmen mit Forschung, Regionen und Kapitalerhöhungen wachsen schneller als der Gründer des
Werkzeugs; die Verhältnisse gelten, die absoluten Tage nicht. Der Steuerberater lohnt sich nur noch für kleine Firmen
oder Bequeme; der Belegcheck spart ab mittlerer Größe ein Vielfaches. Tests: `src/lib/sim/macro.test.ts`,
`growth.test.ts`, `listed.test.ts`, SQL `e7_macro_events.sql`, E2E „an event from outside“ in
`e2e/company-growth.spec.ts`.

## ADR-212: Flyer für kleine Firmen gedeckelt — `Entscheidung (Eigentümer: „mach, was am besten ist“)`

**Kontext.** Eine Kampagne kostet `costHours` × die Nachfrage der letzten Stunde (ADR-097). Die Nachfrage folgt aus
der Marktgröße, die bei der Gründung zufällig und mit schwerem Rand gezogen wird (`potential_annual_cents`). Etwa
5,6 % der neuen Garagen konnten sich deshalb nicht einmal den billigsten Flyer aus ihren 2.500 € Startkasse leisten,
ausgerechnet die mit dem besten Markt.

**Entscheidung.** Der Flyer einer kleinen Firma kostet höchstens `startups.campaigns.flyerCapCents` (2.000 €).
Klein heißt: Rechtsform in `flyerCapTiers` (Garage) oder Firmenwert (`company_value_cents`) unter
`flyerCapBelowValueCents` (1 Mio. €). Der Deckel gilt vor dem Rabatt der Werbeagentur (`ad_agency`), die also weiter
wirkt. Online, TV und größere Firmen zahlen den normalen Preis; ein billigerer Flyer wird nie teurer.

- Server: neue interne Hilfe `campaign_cap_cents()`, `company_campaign_cost_cents()` (Migration 20261204010500) nimmt
  das Minimum. Diese eine Funktion rechnen `start_campaign()` und `company_campaign_costs()` (Preis auf der
  Kampagnenkarte), Karte und Abbuchung zeigen also denselben Preis. Keine neuen RPCs, keine neuen Fehler.
- Client: `campaignCapCents()` und `companyCampaignCostCents()` in `src/lib/sim/campaigns.ts` für den Demo-Modus.

**Folgen.** Jede neue Garage kann ihre erste Kampagne starten und behält 500 € für Rechnungen. Der Flyer einer Garage
mit großem Markt wird ein gutes Geschäft, das ist gewollt: Er hebt Nachfrage und Bekanntheit nur 24 Stunden lang, und
mit dem Wachstum (Kleinunternehmen und 1 Mio. € Wert) fällt der Deckel weg. Tests: `src/lib/sim/campaigns.test.ts`,
SQL `e9_flyer_cap.sql`.
