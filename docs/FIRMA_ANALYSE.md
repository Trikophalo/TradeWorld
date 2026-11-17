# Firma: Analyse, Fehler und Neuaufbau (ADR-183)

Stand: 17. November 2026. Grundlage: der Code dieses Stands, die letzten Definitionen aller SQL-Funktionen (aus einer
lokalen Datenbank mit allen Migrationen gelesen, nicht aus den Migrationsdateien), Nachstellungen über die echten RPCs
mit den Argumenten des Clients und die Zod-Abbildung mit echten Antworten. Gemeldet von aktiven Spielern:
verschachteltes Layout, „Ruf“ wirkt nicht oder nur teilweise, „Wo es fehlt“ unübersichtlich, „Was jeder leistet“
zeigt Kosten, aber keine Leistung.

## 1. Funktionskarte

Jede Zeile: was es ist, wo es lebt (Oberfläche · API · SQL · Simulation), was es beeinflusst und wovon es abhängt.

| Funktion                    | Oberfläche                                                     | API / Zod                                           | SQL (letzte Definition)                                                                                  | Simulation                                                | hängt ab von                                                                                                                                        | wirkt auf                                                                          |
| --------------------------- | -------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Gründung, Rechtsformen      | `founding.tsx`                                                 | `foundCompany`, `upgradeCompany`                    | `found_company`, `upgrade_company`                                                                       | `startup.ts` (`initialStartup`)                           | Level, Guthaben                                                                                                                                     | Kasse, Fixkosten, Markt (`marketFactorByTier`), Plätze                             |
| Stundenabrechnung           | Dashboard (Zahlen, Verlauf), Statuszeile                       | `get_my_company` → `hours`, `live`                  | `player_companies_run_due` → `player_company_close_hour` → `listed_hour_after`                           | `closeStartupHour`                                        | Nachfrage, Kapazität, Preis, Ereignis, Kampagne, Schwung, Ruf                                                                                       | Kasse, Löhne der Spieler (Jobs), Haushaltskonto, Stärken, Ruf, Bekanntheit, Steuer |
| Quartal                     | Dashboard „Letztes Quartal“, „Verlauf“                         | `last_quarter`, `history`                           | `player_company_close_quarter`                                                                           | `closeStartupQuarter`                                     | Stunden                                                                                                                                             | Qualität, Insolvenz, Bericht, Firmenwert                                           |
| Bekanntheit                 | Statuszeile, Puls, Stärke, Faktor                              | `awareness_bps`, Stunden `awareness_parts`          | `company_awareness_hour` (6900)                                                                          | `awarenessHour`                                           | Marketing, Mundpropaganda, Aufgaben, Kampagnen, Interviews, Züge                                                                                    | Nachfrage                                                                          |
| Qualität                    | Statuszeile, Stärke, Faktor                                    | `quality_bps`                                       | Quartal (`qualityTarget`), Forschung                                                                     | `qualityTarget`                                           | Fähigkeiten im Team, Schulungen, Forschung, Stimmung                                                                                                | Nachfrage, Premium, Ruf (neu)                                                      |
| **Ruf**                     | Statuszeile, Dashboard „Ruf“, Kennzahl (notiert), Geschäftsrat | `reputation` (neu), `get_listed_company.reputation` | `company_reputation_*` (7300), `listed_hour_after`, `listed_reputation_bump`, `company_interview_finish` | `company-reputation.ts`, `listed.ts` (`reputationTarget`) | Qualität, Lieferung, Preis, Löhne, Rechnungen, Krise, Kampagne; notiert: Forschung, Gier, Investitionen, Dividenden, Skandal; Interviews, Finanzamt | Nachfrage (alle), fairer Kurs (notiert), Abstimmverhalten des Streubesitzes        |
| Stärken (6)                 | Dashboard „Stärken und Diagnose“, Statuszeile                  | `strengths`                                         | `company_strengths_*` (6600)                                                                             | `company-strengths.ts`                                    | jede Stunde                                                                                                                                         | Bonus-Umsatz (bis +15 %), Aufgabenlohn (×0,9–1,5)                                  |
| Wo es fehlt (8 Faktoren)    | Dashboard „Stärken und Diagnose“, Mira                         | reine Client-Rechnung                               | –                                                                                                        | `company-health.ts`                                       | letzte Stunde, Schwung, Ereignis                                                                                                                    | Mira-Antworten und -Knöpfe                                                         |
| Was jeder leistet           | Dashboard „Team, Timer und Büro“, Mitarbeiter-Tab              | `hours` (jetzt mit Nachfrage, Kapazität, Löhnen)    | `company_hours_json` (7310)                                                                              | `staff-value.ts`                                          | Stunden, Team, KI-Auslastung                                                                                                                        | Anzeige                                                                            |
| Team, Stellen, Bewerbungen  | Mitarbeiter-Tab                                                | `get_company_team`, `get_company_postings` …        | `player_jobs`, `job_*`                                                                                   | `careers`                                                 | Spieler                                                                                                                                             | Kapazität, Fähigkeiten, Jobs der Spieler, Lohn der Spieler                         |
| KI-Kräfte                   | Mitarbeiter-Tab, Puls, Todo                                    | `hire_ai_workers`, `dismiss_ai_worker`              | `company_ai_utilization_bps`, `company_ai_wage_due_cents`                                                | `aiUtilizationBps`, `aiWageDueCents`                      | Nachfrage                                                                                                                                           | Kapazität, Löhne (nach Auslastung)                                                 |
| Aufgaben, Autopilot         | Mitarbeiter-Tab, Dashboard „Helfer“                            | `get_company_tasks`, `set_company_autopilot`        | `company_tasks_*`, `company_autopilot_run`                                                               | `company-tasks*.ts`                                       | Stärken, Stimmung                                                                                                                                   | Kasse, Schwung, Bekanntheit, Missionen                                             |
| Geschäftszüge, eigene Ideen | Controlling „Verkaufen“                                        | `get_company_moves`, `start_company_move`, Pitches  | `company_moves_state`, `start_company_move`                                                              | `company-moves.ts`                                        | Stufe, Kasse                                                                                                                                        | Bekanntheit, Qualität, Kasse                                                       |
| Marketing, Kampagnen        | Controlling „Verkaufen“, Kampagnen-Leiste                      | `set_company_marketing`, `start_campaign`           | `company_campaign_at`                                                                                    | `campaignDemandFactor`                                    | Kasse                                                                                                                                               | Bekanntheit, Nachfrage, Ruf (neu: Kampagne +3)                                     |
| Preis, Auftragsarbeit       | Controlling „Verkaufen“                                        | `set_company_strategy`                              | `company_price_effect`                                                                                   | `priceEffect`                                             | Qualität                                                                                                                                            | Nachfrage, Umsatz, Bekanntheit, Ruf (neu)                                          |
| Ausbau, Wachstumsstufen     | Controlling „Betrieb und Wachstum“                             | `expand_company`, `upgrade_company`                 | `company_expansion_cost_cents`                                                                           | `expansion*`, `companyStage`                              | Kasse, Fähigkeiten                                                                                                                                  | Markt, Plätze, Grenze der Bekanntheit                                              |
| Kasse, Einzahlen, Entnahme  | Controlling „Geld“                                             | `company_deposit`, `company_withdraw`               | Ledger                                                                                                   | –                                                         | –                                                                                                                                                   | Ruf (notiert: Gier), Reichenliste (Firmenwert)                                     |
| CEO-Auszahlung              | Controlling „Geld“                                             | `set_founder_payout`                                | Stundenabrechnung                                                                                        | `founderPayoutCents`                                      | Gewinn, Deckel des Geschäftsrats                                                                                                                    | Spielerkonto, Ruf (Gier)                                                           |
| Börsengang, Kapitalerhöhung | Controlling „Geld“                                             | `go_public`, `subscribe_offer`                      | `close_due_offers`                                                                                       | `ipo.ts`                                                  | Level, Stufe                                                                                                                                        | Aktie, Kurs, notierte Regeln                                                       |
| Forschung, Produkte, Märkte | Controlling „Forschung und Anlagen“                            | `company_invest`                                    | `listed_*` (5400/5410)                                                                                   | `listed.ts`                                               | Referenzumsatz, Budgets                                                                                                                             | Stundenterme, Ruf (Nachhaltigkeit, Reinvestition)                                  |
| Zufriedenheit, Benefits     | Mitarbeiter-Tab, Dashboard (notiert)                           | `get_listed_company.satisfaction`                   | `listed_satisfaction_target`                                                                             | `listed.ts`                                               | Löhne, Auslastung, Krise, Entlassungen, Gier                                                                                                        | Kapazität, Qualität, Kündigungen, Autopilot                                        |
| Bücher, Steuern, Finanzamt  | Buchhaltung                                                    | `company_books_close`, `company_tax_pay`            | `listed_tax_office`                                                                                      | `listed.ts`                                               | Umsatz der Periode                                                                                                                                  | Staatskasse, Ruf (Strafen), Betriebsprüfung (Ereignis)                             |
| Geschäftsrat, Dividenden    | Geschäftsrat, Controlling „Geld“                               | `board_*`, `company_declare_dividend`               | `board_close_due`                                                                                        | `listed.ts`                                               | Aktien, Ruf                                                                                                                                         | Budgets, Deckel, Preisbindung, Ruf (Dividenden), Aktionäre                         |
| Ereignisse (Krise/Chance)   | Dashboard „Lage und Nachrichten“                               | `get_company_event`                                 | `company_event_hour_effect`                                                                              | `company-events.ts`                                       | Zufall                                                                                                                                              | Nachfrage, Kapazität, Kosten, Löhne (ADR-131), Ruf (neu)                           |
| CEO-Interviews              | Dashboard „Lage“                                               | `get_company_interview`                             | `company_interview_finish`                                                                               | `interviews.ts`                                           | Zufall, Lage                                                                                                                                        | Bekanntheit, Ruf (jetzt jede Firma), NEXA Nachrichten                              |
| Büro, Chat, Mira            | Dashboard, Mitarbeiter-Tab                                     | `get_company_floor`, Chat, Mira                     | –                                                                                                        | `brain.ts`                                                | alles oben                                                                                                                                          | Hebel über bestehende RPCs                                                         |
| Rundherum                   | Missionen, News, Reichenliste, Aktienliste                     | –                                                   | `mission_event`, `feed_post`, `company_news_add`                                                         | –                                                         | Firmenereignisse                                                                                                                                    | XP, Feed, Sendung, Rangliste                                                       |

## 2. Gefundene Fehler und Ungereimtheiten

### 2.1 Ruf (gemeldet: „funktioniert nicht oder nur teilweise“)

Nachgestellt auf einer lokalen Datenbank mit allen Migrationen (eine Kleinunternehmen-Firma und eine notierte Firma,
Stunden über `player_company_close_hour`, Abfrage über `get_my_company` und `get_listed_company`).

1. **Zwei getrennte Werte, einer davon tot.** `profiles.reputation` (Spieler, Spec 6.6) wird nirgends verändert,
   `reputation_events` bleibt leer. Der Firmenruf liegt nur in `listed_companies.reputation`. Ursache: der Ruf kam erst
   mit ADR-167, nur für notierte Firmen.
2. **Private Firmen haben keinen Ruf.** Keine Spalte, keine Regel, keine Wirkung. Interviews rechneten für sie den
   Ruf ausdrücklich auf 0 (`company_interview_finish`, `interviewEffects(…, listed)`).
3. **Notierte Firmen stehen still bei 50.** Das Ziel bestand nur aus Basis 50, Forschung (Nachhaltigkeit), Gier,
   Reinvestition, Dividenden und Skandal. Eine ordentlich geführte Firma ohne Auszahlung, Dividende oder Investition
   hat in jeder Stunde Ziel 50: Der Wert bleibt exakt 50 und der Graph flach – „wirkt nicht“. Gute Qualität,
   ausverkaufte Stunden, unbezahlte Löhne oder Krisen hatten keinen Einfluss.
4. **Eine fehlerhafte Nebenaufgabe kostete die ganze Stunde.** `listed_hour_after` lief am Ende der Stundenabrechnung
   ohne eigene Fehlerbehandlung (Finanzamt, Geschäftsrat, Meldungen, Missionen, fairer Kurs). Jeder Fehler dort rollte
   die ganze Stunde dieser Firma zurück: keine Stunde in `player_company_hours`, kein Ruf, keine Stimmung, „Verlauf“
   leer, „bringt 0 €“. Das deckt sich mit den Live-Meldungen aus ADR-176 und den jetzigen. Auf Live kam hinzu, dass
   der Deploy stundenlang an Migration 6600 hing: Damit fehlte auch `strengths.close_error`, die einzige Anzeige
   einer hängenden Abrechnung.
5. **Börsengang setzt den Ruf zurück** (`listed_ensure` startet mit 50). Mit einem Ruf für alle wäre das ein Verlust.

### 2.2 „Was jeder leistet“ zeigt Kosten, aber 0 € Leistung

Nachgestellt mit echten Antworten von `get_my_company` und `get_company_team` (drei Stunden, drei KI-Kräfte) durch
`staffValue` aus `staff-value.ts`.

1. **Ohne abgeschlossene Stunde ist alles 0.** Die Leistung kam nur aus `hours` (letzte 24 Stunden). Fehlen sie
   (neue Firma, oder eine Stundenabrechnung, die auf dem Server scheitert, siehe 2.1.4), steht bei jedem „bringt 0 €“,
   während die Kosten aus den Lohnsätzen weiter angezeigt werden. Genau das gemeldete Bild.
2. **Falsche Aufteilung seit ADR-180.** Die Leistung wurde nach dem Anteil an der Produktivität verteilt. Seit ADR-180
   bedienen Gründer und Spieler zuerst, KI-Kräfte nur den Rest. Eine untätige KI-Kraft bekam trotzdem Umsatz
   gutgeschrieben, Gründer und Spieler zu wenig.
3. **Falsche Kosten.** KI-Kräfte zählten immer mit vollem Lohn (120 €/h), bezahlt wird aber nach Auslastung
   (mindestens 25 %) und mit dem Lohnfaktor. Spieler zählten mit 8 Stunden am Tag statt mit dem tatsächlich gezahlten
   Lohn.
4. **Stärken-Bonus und Auftragsarbeit** wurden nicht der Kapazität zugeordnet, die sie erzeugt hat.

### 2.3 „Wo es fehlt“ (Dashboard → Erweitert)

Die Rechnung (acht Faktoren, ADR-162) ist korrekt; die Darstellung war das Problem: Netzdiagramm ohne Skala, Werte
nur klein in Grau, Statusfarben nur an den Punkten, acht kleine Karten im Zweierraster ohne Reihenfolge, keine
Erklärung, was ein Faktor misst oder was zu tun ist, kein Bezug zu den sechs Stärken, und das Ganze unter „Erweitert“
eingeklappt.

### 2.4 Aufbau und Bedienung

- Bis zu drei Ebenen verschachtelt: Tab → Gruppe → aufklappbarer Bereich → Karte mit innerer Karte. Das Dashboard
  hatte „Erweitert“, „Lage & Nachrichten“, „Quartalszahlen“ und „Verlauf“ als Akkordeons; Controlling 13 Akkordeons.
- Tutorial- und Mira-Ziele (`assistant`, `company-moves`, `growth`, `listing`) lagen zum Teil in zugeklappten
  Bereichen.
- Mitarbeiter-Tab auf dem Handy: der Chat stand vor dem Team.
- Viele wichtige Werte ohne Erklärung (Kennzahlen, Marketing-Regler, Bekanntheit, Qualität).

### 2.5 Weitere Befunde der QA

- `MoodCard` und die neue Rufkarte hätten dieselbe Element-ID `reputation` gehabt (jetzt `mood`).
- Die Demo rechnete den Ruf nur für notierte Firmen und Interviews nur mit Ruf für notierte Firmen (gleich behoben).
- Bekannter, nicht von dieser Arbeit verursachter Flake: `a9b_nft_activity.sql` („collectors trade among themselves
  every hour“) scheiterte im ersten lokalen Lauf zufallsbedingt (Stunde 0 ohne Handel).

## 3. Lösungen

- **Ruf für jede Firma** (Migration 7300, `src/lib/sim/company-reputation.ts`, Werte in
  `companyHealth.reputation`): `player_companies.reputation` für alle; notierte Firmen spiegeln
  `listed_companies.reputation`. Jede Stunde: Ziel = 50 (notiert: das bisherige Aktionärsziel) + Qualität (−5 … +10,
  neutral 40 %) + Lieferfähigkeit (bis −8) + Preis (günstig +2, Premium ohne Qualität −6) + Löhne (bis −10) + offene
  Rechnungen (−6) + Krise (−3 je Stufe) + Kampagne (+3); der Wert rückt 8 % der Lücke vor. Wirkung: Nachfrage
  ±20 % (auch privat), fairer Kurs wie bisher. Stunde speichert Wert, Ziel und Treiber; Interviews wirken auf jede
  Firma; der Börsengang behält den Ruf.
- **Stundenabrechnung robust:** Jeder Nebenschritt von `listed_hour_after` in einem eigenen Block; Fehler gehen als
  Warnung nach `job_runs` (`company_hour_step`) und stehen auf dem Dashboard, die Stunde bleibt verbucht.
- **„Was jeder leistet“:** `company_hours_json` liefert Nachfrage, Kapazität, Stärken-Bonus, KI-Auslastung und gezahlte
  Löhne; `staffValue` teilt wie die Abrechnung (Menschen zuerst, KI den Rest, Auftragsarbeit nach freier Kapazität)
  und nimmt die gezahlten Löhne.
- **„Wo es fehlt“:** gleiche acht Faktoren und Logik; Netzdiagramm mit Skala und farbigen Werten, Legende,
  Gesamtwert, „größter Hebel“ mit „Was tun“, Liste nach möglichem Gewinn sortiert, je Faktor: was er misst, Grund in
  Zahlen, was zu tun ist, Bezug zur Stärke, möglicher Gewinn, Mira.

## 4. Neuer Aufbau (nur Darstellung, keine Funktion entfernt)

- **Kopf** (alle Tabs): Firmenschild mit Kasse, Wert, Umsatz und Gewinn heute, Live-Leiste und neu eine
  **Statuszeile**: Zustand in einem Wort („Gewinn in der letzten Stunde“, „Offene Rechnungen“, „Abrechnung hängt“ …)
  und Bekanntheit, Qualität, Ruf, Stärken, je mit „i“-Erklärung.
- **Jeder Tab** besteht aus flachen **Abschnitten** mit Symbol, Titel und einer Zeile Zweck; darunter Karten. Eine
  **klebende Sprungleiste** markiert den Abschnitt im Blick. Nichts klappt mehr zu.
  - Dashboard: Zu erledigen · Zahlen (Kennzahlen mit Erklärung, 24 Stunden, Puls, Quartal, Verlauf) · Helfer
    (Autopilot, Mira) · Stärken und Diagnose (Stärken, „Wo es fehlt“) · Ruf (und notiert Stimmung) · Team, Timer und
    Büro · Lage und Nachrichten.
  - Controlling: Verkaufen · Betrieb und Wachstum · Geld · Forschung und Anlagen (notiert) · Auftritt; jeder Block
    mit Zweck und aktuellem Stand als Marke.
  - Mitarbeiter: Zufriedenheit (notiert) · Team und Stellen · Was jeder leistet · Firmenaufgaben · Firmenchat
    (Handy zuletzt, ab `lg` daneben).
  - Buchhaltung: Bücher und Steuern · Kontobuch. Geschäftsrat mit Kopf und Zweck.
- Deep Links (`tabs.ts`), Mira-Ziele und Benachrichtigungen führen auf dieselben Stellen; `data-tour`-Ziele bleiben.

## 5. Aufbau seit ADR-187 (übersichtlicher, weniger Scrollen)

Der Aufbau aus Abschnitt 4 gilt weiter für Kopf, Abschnitte und Sprungleiste. Neu:

- **Dashboard = nur Zahlen und Grafiken.** Kennzahlen als Kacheln (Kasse, Umsatz, Kosten, Gewinn je Stunde,
  Bekanntheit, Qualität, Ruf, notiert Zufriedenheit, Aktienkurs, laufende Kosten, Steuer, Zu erledigen), darunter die
  laufenden Timer als kleine Chips. Grafiken: 24 Stunden, letzte Stunde, Ruf, notiert Stimmung, Quartal, Verlauf.
  Jede Kachel und jede Grafik führt dorthin, wo der Wert beeinflusst wird („Beeinflussen in Controlling → Marketing“,
  bei Maus beim Überfahren und Fokus, am Handy immer sichtbar).
- **Stärken & Schwächen in einer Ansicht:** ein Netzdiagramm (die acht Punkte von „Wo es fehlt“), jede Zeile ein
  Thema mit „Jetzt“ (Diagnose der letzten Stunde) und, klar getrennt, „Langfristige Stärke x/100“ mit der nächsten
  Bonusstufe. Image und Schwung gibt es nur als Diagnose. Der Kopf zeigt Gesamtwert, langfristige Stärke Ø mit Bonus
  und Gewinn pro Stunde. Beide Berechnungen sind unverändert.
- **Mitarbeiter:** oben **Zu erledigen** (alles Fällige als eine Liste nach Dringlichkeit: Bücher, Steuern,
  Abstimmungen, Krisen und Chancen, Interview-Anfragen, offene Rechnungen, Bewerbungen, Aufgaben, Hinweise der letzten
  Stunde) neben dem Autopiloten, dann Aufgaben, **Lage & Ereignisse** (Lage, Interview, Ereignis, Nachrichten) und eine
  **Team-Karte** mit Umschalter: Team & Plätze (mit Büro) · Stimmung (notiert) · Wert des Teams. Firmenchat daneben.
- **Controlling in fünf Karten** mit Umschalter statt Stapel: Angebot & Produktion (Preise & Strategie · Produktion),
  Marketing (Budget & Kampagnen · Geschäftszüge), Geld (Kasse & Auszahlung · Kapital & Börse · Dividenden),
  Wachstum (Ausbau & Rechtsform · Forschung · Produkte & Märkte, dort je Art umschaltbar), Marke & Firma. Innerhalb
  einer Ansicht zwei Spalten ab `lg`. Am PC etwa 13 000 px → 4 500 px Seitenhöhe.
- **Mira** ist ein eigenes Panel, der Knopf steht neben den Tabs auf jedem Tab (`data-tour="assistant"`).
- **Links:** Jede alte Abschnitts-ID führt weiter an die richtige Stelle; eine Karte schaltet beim Ankommen auf die
  passende Ansicht (`COMPANY_GROUPS`, `groupOf`, `placeOf` in `tabs.ts`, geprüft in `tabs.test.ts`).
