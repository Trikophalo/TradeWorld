# Balancing

Startwerte, erste Geldfluss-Rechnungen und Inflationsschutz.

> **Quelle der Wahrheit ist [`src/config/balance.ts`](../src/config/balance.ts).** Die Tabellen hier spiegeln die
> Datei zum Zeitpunkt des Schreibens. Bei Abweichungen gilt die Datei bzw. zur Laufzeit die Tabelle `game_config`
> (ADR-009). Jeder Abschnitt von `BALANCE` ist dort eine Zeile mit einem JSON-Dokument. Geldbeträge stehen in der
> Datei als ganze Zahlen in Cent (alle weit unter 2^53) und werden im Code zu `bigint`.

Alle Jahressätze gelten pro **Spieljahr = 1 echter Tag**. Dieser Punkt bestimmt fast alles in diesem Dokument.

Die Rechnungen sind Überschlagsrechnungen mit genannten Annahmen. Geprüft sind bisher nur die Formeln (Unit-Tests)
und einzelne Testläufe der Simulation, nicht das Zusammenspiel mit echten Spielern.

## Inhalt

1. [Startwerte](#1-startwerte)
2. [Geldfluss: Quellen und Senken](#2-geldfluss-quellen-und-senken)
3. [Zeit bis zu den Leveln](#3-zeit-bis-zu-den-leveln)
4. [Unternehmen](#4-unternehmen)
5. [Inflationsschutz](#5-inflationsschutz)
6. [Auffällige Werte aus dem Prompt und Vorschläge](#6-auffällige-werte-aus-dem-prompt-und-vorschläge)
7. [Risiken und Telemetrie für den Freundestest](#7-risiken-und-telemetrie-für-den-freundestest)
8. [Regeln in Spielersprache](#8-regeln-in-spielersprache)

---

## 1. Startwerte

### 1.1 Zeit (`time`)

| Wert            | Start                                          |
| --------------- | ---------------------------------------------- |
| Quartal         | 6 Stunden, 4 Quartale = 1 Spieljahr = 1 Tag    |
| Quartalsgrenzen | 08:00, 14:00, 20:00, 02:00 Uhr (Europe/Berlin) |
| Börsenzeit      | 08:00 bis 22:00 Uhr                            |
| Tick            | 5 Sekunden, 12 Ticks je Runner-Aufruf          |
| Nachbörslich    | Spread ×3, Liquidität ×0,25, Rauschen ×0,5     |
| Kerzen          | 1 min, 5 min, 1 h, dazu Quartal und Spieljahr  |
| Eröffnungsbonus | erste 60 Minuten, XP ×1,5                      |

### 1.2 Grundversorgung (`economy`)

| Wert                         | Start                                                |
| ---------------------------- | ---------------------------------------------------- |
| Startkapital                 | 10 000 €                                             |
| Wiedereinstieg nach Bankrott | 2 500 €, Status „Pleitegeier“ 3 Tage, Reputation −10 |
| Grundeinkommen               | 100 € pro Stunde                                     |
| Tresor                       | fasst 8 Stunden = 800 €                              |

### 1.3 Handel (`trading`)

| Wert                                        | Start                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Ordergebühr                                 | 1 € fix                                                                                  |
| Steuer auf realisierte Gewinne              | 25 %, mit Verlusttopf                                                                    |
| Steuer auf Kupons und Dividenden            | 25 % (Zusatzregel, vom Auftraggeber bestätigt)                                           |
| Halber Spread                               | Bluechip 5 bp, Mittelständler 15 bp, Pennystock 60 bp; bis +20 bp bei extremem Sentiment |
| Preis-Impact                                | 1 % je „Tiefe“, eine Tiefe = 0,2 % des Streubesitzes, linear                             |
| Sofortanteil / Hedge des Marktmachers       | 50 % / 50 %                                                                              |
| Höchster Impact je Order                    | 15 % (Rest wird nicht ausgeführt)                                                        |
| Orderbuch                                   | 10 Stufen je Seite, Abstand 10 bp                                                        |
| Finanzierung bei Hebel                      | Leitzins + 4 % pro Spieljahr auf den Kredit, sekundengenau                               |
| Leihgebühr bei Shorts                       | 1 % / 3 % / 10 % pro Spieljahr (Bluechip / Mittelständler / Pennystock)                  |
| Hebel nach Level                            | ab 1: 1×, ab 12: 2×, ab 18: 5×, ab 30: 10×                                               |
| Leerverkäufe                                | ab Level 8                                                                               |
| Wartungsmarge / Warnschwelle                | 5 % / 7,5 %                                                                              |
| Liquidationsgebühr                          | 0,5 %                                                                                    |
| Wash-Trade-Fenster                          | 300 Sekunden                                                                             |
| Mindestkurs / größte reguläre Tick-Bewegung | 0,0001 € / 3 %                                                                           |

### 1.4 Zentralbank und Anleihen (`centralBank`, `bonds`)

| Wert                    | Start                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| Leitzins                | 3 %, neutral 3 %, Grenzen 0,5 % bis 10 %                              |
| Schritt                 | 25 bp, höchstens 2 Schritte je Entscheidung                           |
| Ziel Geldmengenwachstum | 8 % pro Spieljahr und aktivem Spieler, Toleranzband 4 %               |
| Takt                    | alle 4 Quartale, 1 Quartal vorher angekündigt, Messfenster 4 Quartale |
| Anlaufphase             | 56 Quartale (14 Tage) ohne Entscheidung                               |
| Aktiver Spieler         | Login in den letzten 7 Tagen                                          |
| Anleihen                | Nennwert 100 €, Kupon je Quartal, ab Level 5                          |
| Rendite                 | Leitzins + Aufschlag, begrenzt auf 2 % bis 4 %                        |
| Aufschläge              | 1 Jahr −75 bp, 2 Jahre −50 bp, 5 Jahre −10 bp, 10 Jahre +25 bp        |
| Renditen beim Start     | 2,25 % / 2,50 % / 2,90 % / 3,25 %                                     |

### 1.5 Branchen (`sectors`)

| Branche      | Nachfrage je Quartal (international) | Wachstum je Spieljahr | KGV | Volatilität | Preisexponent | Referenzpreis | Stückkosten | Stück je Skillpunkt | Fixkostenfaktor | Qualität altert je Quartal | Entwicklungsbedarf |
| ------------ | ------------------------------------ | --------------------- | --- | ----------- | ------------- | ------------- | ----------- | ------------------- | --------------- | -------------------------- | ------------------ |
| Tech         | 30 Mio. €                            | 8 %                   | 28  | 1,2         | 1,2           | 50 €          | 11,80 €     | 16,5                | 0,7             | 10 %                       | 2,0                |
| Einzelhandel | 50 Mio. €                            | 2 %                   | 14  | 0,8         | 2,5           | 20 €          | 8,92 €      | 47,6                | 1,0             | 3 %                        | 0,5                |
| Energie      | 36 Mio. €                            | 1,5 %                 | 11  | 1,0         | 1,5           | 80 €          | 19,95 €     | 9,1                 | 1,4             | 3 %                        | 0,6                |
| Pharma       | 28 Mio. €                            | 5 %                   | 22  | 1,4         | 1,0           | 120 €         | 26,85 €     | 7,7                 | 1,2             | 6 %                        | 1,5                |
| Logistik     | 42 Mio. €                            | 3 %                   | 15  | 0,9         | 2,0           | 30 €          | 10,48 €     | 26,8                | 1,1             | 4 %                        | 0,7                |

Empfindlichkeiten:

| Branche      | Öl → Nachfrage | Öl → Kosten | Zins je +100 bp | Konjunktur | Zins → Bewertung |
| ------------ | -------------- | ----------- | --------------- | ---------- | ---------------- |
| Tech         | 0              | 0           | −3 %            | 0,8        | 1,5              |
| Einzelhandel | −0,05          | 0,1         | −1 %            | 0,5        | 0,8              |
| Energie      | 0,8            | 0,3         | −1 %            | 0,6        | 1,0              |
| Pharma       | 0              | 0           | −1 %            | 0,1        | 1,2              |
| Logistik     | 0              | 0,5         | −2 %            | 1,2        | 1,0              |

Kalibrierung (Abschnitt 4.2): Stückkosten und Stück je Skillpunkt sind so gewählt, dass der Referenzpreis der
gewinnmaximale Preis einer kleinen Firma ist und ein gut geführtes Kleinunternehmen in jeder Branche ähnlich viel
verdient. Nettomargen der KI-Firmen in Testläufen über 40 Quartale: Pharma 25 bis 33 %, Tech 20 bis 28 %,
Energie 15 bis 20 %, Logistik 12 bis 18 %, Einzelhandel 9 bis 15 %.

### 1.6 Unternehmen (`company`)

| Wert                | Start                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Attraktivität       | `quality^1.2 × awareness^0.8 / price^e`, `e` je Branche (1,0 bis 2,5; Wert aus dem Prompt: 1,5)                               |
| Märkte              | lokal 0,18 %, regional 0,6 %, national 2,2 % der Branchennachfrage, international 100 % (Abschnitt 4.1)                       |
| Etablierte Anbieter | Qualität 40 / 50 / 55 (lokal / regional / national), Bekanntheit 50 %, verkaufen zum Marktpreis                               |
| Marketing-Exponent  | 0,4854 = log2(1,4): doppeltes Budget → +40 % Bekanntheitsgewinn                                                               |
| Referenzbudget      | 1,5 % der Basisnachfrage des eigenen Markts, gewinnt 5 % der Kunden, die die Firma noch nicht kennen                          |
| Bekanntheit         | Start 8 %, Verfall 10 % je Quartal, höchster Gewinn 15 Punkte je Quartal, mindestens 0,5 %                                    |
| Marketing-Abteilung | Budget zählt bis zu doppelt, halbe Wirkung bei 15 Skillpunkten                                                                |
| Qualität            | Start 30, Skala 1 bis 100; Zielwert aus Entwicklern relativ zur Firmengröße (SIMULATION.md 11.2)                              |
| Vertrieb            | +1 % Attraktivität je Skillpunkt, höchstens +50 %                                                                             |
| Finanz-Abteilung    | senkt Fixkosten um bis zu 30 %, halbe Wirkung bei 15 Skillpunkten                                                             |
| Einarbeitung        | 40 % im ersten, 70 % im zweiten Quartal, danach 100 %                                                                         |
| Preisregler         | 25 % bis 300 % des Referenzpreises (nur Eingabegrenze)                                                                        |
| Körperschaftsteuer  | 15 % auf positiven Quartalsgewinn                                                                                             |
| Insolvenz           | Schonfrist 4 Quartale nach dem ersten Abschluss im Minus; Überziehung zu Leitzins + 10 %; Kurssturz −90 %; Sperre 3 Spieltage |
| Marketingbudget     | wird wie beschlossen ausgegeben, auch wenn die Kasse es nicht trägt                                                           |
| Umwandlung          | 60 % der Gründungskosten der Zielstufe                                                                                        |
| Privates Kapital    | bei Gründung höchstens 2× Gründungskosten, im Wachstum 1× je Spieljahr, nach dem IPO 0                                        |

Firmenstufen (Prompt 6.4; die letzte Zeile ist eine Annahme, der Prompt nennt keine Grenzen nach dem IPO):

| Stufe            | Level | Gründungskosten | Fixkosten je Quartal | Mitarbeiter         | Kreditrahmen | Markt         |
| ---------------- | ----- | --------------- | -------------------- | ------------------- | ------------ | ------------- |
| Kleinunternehmen | 10    | 15 000 €        | 2 000 €              | 5 (ab Level 18: 20) | –            | lokal         |
| GmbH             | 20    | 75 000 €        | 10 000 €             | 20                  | 250 000 €    | regional      |
| AG vor IPO       | 25    | 300 000 €       | 40 000 €             | 100                 | 2 Mio. €     | national      |
| börsennotiert    | 25    | –               | 120 000 €            | 1 000               | 10 Mio. €    | international |

Die Fixkosten werden mit dem Fixkostenfaktor der Branche multipliziert.

### 1.7 IPO, Reputation, Kredite (`ipo`, `reputation`, `loans`)

| Wert                    | Start                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IPO-Voraussetzungen     | Level 25, 4 Quartale Historie, 1 Mio. € Umsatz in 4 Quartalen, Reputation ≥ 50, CFO                                                                                                                    |
| Streubesitz             | 15 % bis 60 %                                                                                                                                                                                          |
| Preisspanne             | fairer Wert −10 %, ±15 %                                                                                                                                                                               |
| Zeichnung               | 1 Quartal; geplatzt unter 100 % Deckung; oberes Ende ab 200 %                                                                                                                                          |
| Lock-up                 | 4 Quartale                                                                                                                                                                                             |
| Reputation              | Start 50, Skala 0 bis 100, Bewertungsfaktor 0,6 bis 1,4                                                                                                                                                |
| Guidance                | eingehalten bis 10 % Abweichung, verfehlt über 30 %                                                                                                                                                    |
| Reputationspunkte       | siehe Tabelle in [SIMULATION.md](./SIMULATION.md#20-reputation)                                                                                                                                        |
| Risikoaufschlag         | 150 bp + 4 bp je fehlendem Reputationspunkt + 150 bp je 1,0 Schulden/Eigenkapital (höchstens 600) + 200 bp bei Verlust − bis 100 bp bei guter Zinsdeckung − 10 bp je CFO-Skill; gesamt 50 bis 1 500 bp |
| Kreditrahmen nach Level | ab 15: 50 000 €, ab 20: 250 000 €, ab 25: 2 Mio. €; mal 0,5 bis 1,5 nach Reputation                                                                                                                    |

### 1.8 Mitarbeiter und Karriere (`employees`, `careers`)

| Wert              | Start                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| Skill             | 1 bis 10; Kapazitätspunkte = Skill^1,1                                                                           |
| Gehalt je Quartal | 185 € × Skill^1,3 (Skill 1: 185 €, Skill 5: 1 499 €, Skill 10: 3 691 €)                                          |
| Echter Spieler    | doppelte Produktivität                                                                                           |
| Loyalität         | Start 70, Kündigung unter 25, −3 je Quartal ohne Gehaltserhöhung, Abwerben ab +20 % Gehalt                       |
| Führung           | COO +1,5 % Kapazität, Vertriebsleitung +2 % Attraktivität, CFO −10 bp Zins, CTO −3 % Entwicklungszeit (je Skill) |
| Bewerberpool      | 6 je Quartal                                                                                                     |
| Insider           | Sperrfenster 2 Stunden, Entdeckung 60 %, Strafe 150 % des Gewinns                                                |
| Optionen          | Vesting über 4 Quartale; höchstens 1 Nebenrolle                                                                  |

| Eigenschaft | Leistung | Gehalt | Loyalitätsverlust |
| ----------- | -------- | ------ | ----------------- |
| `ambitious` | ×1,15    | ×1,0   | ×2,0              |
| `loyal`     | ×1,0     | ×1,0   | ×0,5              |
| `frugal`    | ×1,0     | ×0,9   | ×1,0              |
| `genius`    | ×1,25    | ×1,3   | ×1,2              |
| `easygoing` | ×0,92    | ×0,95  | ×0,7              |
| `mentor`    | ×1,05    | ×1,1   | ×0,8              |

| Jobstufe    | ab Level | Gehalt je Stunde   | je Tag bei 12 h |
| ----------- | -------- | ------------------ | --------------- |
| Praktikant  | 2        | 150 €              | 1 800 €         |
| Junior      | 5        | 300 €              | 3 600 €         |
| Senior      | 12       | 700 €              | 8 400 €         |
| Teamleitung | 20       | 1 300 €            | 15 600 €        |
| C-Level     | 25       | 2 500 € + Optionen | 30 000 €        |

Beförderungen nach 24 / 72 / 168 / 336 Erfahrungsstunden mit +10 / +12,5 / +15 / +20 % (zusammen ×1,71).
Gehaltsverhandlung einmal je Woche: Erfolgschance 30 % plus 0,2 Punkte je Erfahrungsstunde (höchstens 85 %),
+5 bis +12 %. Jobwechsel +15 bis +30 %. Arbeitsaufgabe alle 3 Stunden, Bonus bis zu einem Stundengehalt.

### 1.9 Level (`progression`)

`XP für Level n → n+1 = round(100 × n^1.5)`, höchstens Level 50. **Alpha-Bonus: `xpMultiplier` = 2**, alle XP
zählen doppelt (Entscheidung des Auftraggebers). Die Tabelle zeigt die Grundwerte aus dem Prompt; verdoppelt wird
genau einmal beim Gutschreiben (`scaledXp()`), die Levelkurve bleibt unverändert.

| Quelle                       | XP                         | Grenze                                        |
| ---------------------------- | -------------------------- | --------------------------------------------- |
| Trade                        | 10                         | 30 je Tag, Wash-Trades zählen nicht           |
| Trade mit Gewinn geschlossen | 1 je 100 € Gewinn          | 500 je Trade                                  |
| Arbeitsstunde                | 40 (×1,5 bei Spielerfirma) | 12 Stunden je Tag                             |
| Arbeitsaufgabe               | 50 bis 150                 | –                                             |
| Tägliche Mission             | 200 bis 400                | 3 je Tag                                      |
| Login                        | 50 + 10 je Streak-Tag      | Bonus höchstens 200, 1 Streak-Schutz je Woche |
| Firmenquartal mit Gewinn     | 500                        | –                                             |
| Erfolgreicher IPO            | 5 000                      | –                                             |
| Erfolg                       | 100 bis 10 000             | –                                             |

Freischaltungen (`unlocks`, stabile Schlüssel):

| Level | Schlüssel                                                     |
| ----- | ------------------------------------------------------------- |
| 1     | `market_orders`, `basic_income`                               |
| 2     | `first_job`                                                   |
| 3     | `limit_orders`, `watchlist`                                   |
| 5     | `stop_loss`, `bonds`, `junior_jobs`                           |
| 7     | `analyst_reports`                                             |
| 8     | `short_selling`                                               |
| 10    | `found_small_business`                                        |
| 12    | `leverage_2x`, `senior_jobs`                                  |
| 15    | `small_loan`, `business_angel`                                |
| 18    | `leverage_5x`, `expand_small_business`                        |
| 20    | `found_gmbh`, `loans_250k`, `team_lead_jobs`                  |
| 25    | `ipo`, `c_level_jobs`                                         |
| 30    | `leverage_10x`, `options`                                     |
| 35    | `takeovers`, `hostile_takeovers`                              |
| 40    | `holding`                                                     |
| 50    | `title_market_legend`, `golden_profile_frame`, `hall_of_fame` |

### 1.10 KI-Investoren, Bewertung, Index (`aiInvestors`, `valuation`, `index`)

| Typ             | Anteil am Streubesitz | Reaktionsgeschwindigkeit je Tick | Parameter                                                       |
| --------------- | --------------------- | -------------------------------- | --------------------------------------------------------------- |
| Marktmacher     | 5 %                   | 0,5 % des Inventars              | –                                                               |
| Value-Fonds     | 30 %                  | 0,0167 %                         | volles Signal bei 50 % Fehlbewertung, Totband 1 %               |
| Momentum-Trader | 10 %                  | 0,02 %                           | Trendskala 2 %                                                  |
| Rentenfonds     | 20 %                  | 0,2 % der Lücke                  | −5 % Gewicht je +100 bp Leitzins, +3 % je 100 bp Renditevorteil |
| Indexfonds      | 4 %                   | 0,5 % der Lücke                  | –                                                               |
| Kleinanleger    | 10 %                  | 0,12 %                           | Trendjagd 0,1, Trendskala 2 %                                   |

| Wert                    | Start                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| Rauschen je Tick        | Bluechip 6 bp, Mittelständler 15 bp, Pennystock 45 bp (mal Branchenfaktor)                        |
| Gleitende Durchschnitte | schnell α 0,15, langsam α 0,0165                                                                  |
| Sentiment-Verfall       | 0,19 % je Tick (Halbwertszeit etwa 30 Minuten)                                                    |
| Wachstumsfaktor         | 1 + Umsatzwachstum, 0,6 bis 1,8                                                                   |
| Makrofaktor             | −4 % je +100 bp Leitzins (mal Branchenfaktor), 0,6 bis 1,3                                        |
| Untergrenze             | 50 % des Buchwerts je Aktie                                                                       |
| Analystenziele          | Rauschen 8 %, in 25 % der Fälle dreifach                                                          |
| NEXA 30                 | 30 Werte, Start 1 000 Punkte, Prüfung alle 4 Quartale, 1 Quartal Mindestnotierung, Puffer 3 Ränge |

### 1.11 Events, Lebensstil, Zufall, Missbrauch (`events`, `lifestyle`, `randomEvents`, `abuse`)

| Event              | Start                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Pharma-Studie      | 12 % je Quartal und Firma, 2 Quartale Vorlauf, Erfolg 60 / 50 / 40 % (Bluechip / Mittel / Penny), ±50 bis 70 % |
| Ölpreis-Report     | alle 2 Quartale, Standardabweichung 6 %, 25 % Rückzug zum Normalwert, Index 0,4 bis 2,5                        |
| Konjunktur         | Rauschen 1 % je Quartal, 10 % Rückzug, Index 0,8 bis 1,2                                                       |
| Gewinnüberraschung | Sentiment = 1,5 × Überraschung, höchstens ±0,6                                                                 |
| Branchenkrise      | 3 % je Quartal, −15 % Nachfrage, 3 Quartale                                                                    |
| Rohstoffschock     | 4 % je Quartal, Öl ×1,25 oder ÷1,25                                                                            |
| Konjunkturdelle    | 3 % je Quartal, −8 % Nachfrage, 4 Quartale                                                                     |
| Tech-Boom          | 3 % je Quartal, +20 % Nachfrage, 4 Quartale                                                                    |
| Zinsentscheid      | Sentiment −0,1 je +25 bp                                                                                       |

| Statussymbol | Preis      | Unterhalt je Spieljahr | Bonus         |
| ------------ | ---------- | ---------------------- | ------------- |
| Rolex        | 25 000 €   | 0,5 % = 125 €          | –             |
| Porsche      | 150 000 €  | 1 % = 1 500 €          | –             |
| Penthouse    | 1,5 Mio. € | 1 % = 15 000 €         | +5 Reputation |
| Privatjet    | 20 Mio. €  | 1,5 % = 300 000 €      | –             |
| Insel        | 100 Mio. € | 2 % = 2 Mio. €         | –             |

Wiederverkauf zu 50 % des Preises.

| Zufallsereignis | Wahrscheinlichkeit je Tag | Wirkung                  |
| --------------- | ------------------------- | ------------------------ |
| Erbschaft       | 4 %                       | +5 000 €                 |
| Steuerprüfung   | 4 %                       | −3 % des Cash            |
| Headhunter      | 3 %                       | Angebot mit +30 % Gehalt |
| Golfclub-Tipp   | 6 %                       | stimmt in 60 % der Fälle |

Höchstens ein Ereignis je Spieler und Tag.

| Missbrauchsschutz              | Start                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Rate Limits                    | 20 Orders je Minute, 500 je Tag, 60 Aktionen je Minute                                               |
| Neue Accounts bei Spieler-IPOs | jünger als 7 Tage oder unter Level 5: höchstens 5 % der Zuteilung und 5 000 €                        |
| Verdachtsmuster                | über 50 % des Volumens zwischen zwei Accounts; Geschäfte über 10 000 € mehr als 10 % neben dem Markt |

---

## 2. Geldfluss: Quellen und Senken

Geld entsteht und verschwindet nur über Systemkonten (ADR-007). Für die Geldmenge zählt, was auf Spieler- und
Spielerfirmenkonten liegt.

| Quelle (Systemkonto → Spieler)                                     | Senke (Spieler → Systemkonto)                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Startkapital, Grundeinkommen, Boni (`mint`)                        | Ordergebühren (`fees`)                                                          |
| Gehälter von KI-Firmen, Arbeitsaufgaben (`payroll`)                | Steuern auf Gewinne, Kupons, Dividenden, Firmengewinne (`taxes`)                |
| Kupons und Rückzahlung von Anleihen (`interest`)                   | Spread, Slippage, Verluste gegen die KI (`market`)                              |
| Dividenden der KI-Firmen (`market`)                                | Finanzierungskosten, Leihgebühren, Kreditzinsen (`interest`)                    |
| Kursgewinne beim Verkauf an die KI (`market`)                      | Unterhalt und Kauf von Statussymbolen (`upkeep`)                                |
| Umsatz der Spielerfirmen (Kunden sind die KI-Wirtschaft, `market`) | Gründungs- und Umwandlungskosten, Fixkosten, KI-Gehälter, Produktion, Marketing |
| Erbschaft (`mint`)                                                 | Steuerprüfung (`taxes`)                                                         |

Aktienkäufe von der KI entziehen dem Spielersektor Geld, Verkäufe bringen es zurück. Investiertes Geld zählt also
nicht zur Geldmenge, wohl aber zum Vermögen.

### 2.1 Annahmen der Rechnung

- **Gelegenheitsspieler:** 2 Besuche am Tag, leert den Tresor zweimal (1 600 €), 3 Trades, 2 Arbeitsaufgaben,
  hält 70 % des Vermögens in Aktien und Anleihen.
- **Aktiver Spieler:** verteilt über den Tag online, Tresor verfällt nie (2 400 €), 20 bis 30 Trades,
  5 Arbeitsaufgaben, ist voll investiert und schlägt das Depot etwa einmal am Tag um.
- **Gehalt** läuft passiv für 12 Stunden. Beide Typen bekommen es voll.
- **Erwartete Rendite „Index halten“:** etwa 7 % pro Spieljahr, also pro Tag. Herleitung: Gewinnrendite der
  Branchen 3,6 % (Tech) bis 9,1 % (Energie), im Mittel etwa 5,5 %; davon 60 % Ausschüttung = 3,3 % Dividende;
  dazu Gewinnwachstum mit der Branchennachfrage von 1,5 bis 8 %, im Mittel etwa 3,5 %.
- **Vermögen:** Level 1: 10 000 €. Level 10: 40 000 €. Level 25: 1 Mio. € (Gelegenheitsspieler) bzw. 2 Mio. €
  (aktiv). Die Werte für Level 10 und 25 sind grobe Schätzungen aus den Tageswerten unten.
- Wochenwerte sind das Siebenfache des Tageswerts, ohne Zinseszins.

### 2.2 Je echtem Tag

|                                   | L1 Gelegenheit | L1 aktiv   | L10 Gelegenheit | L10 aktiv  | L25 Gelegenheit | L25 aktiv    |
| --------------------------------- | -------------- | ---------- | --------------- | ---------- | --------------- | ------------ |
| Vermögen                          | 10 000         | 10 000     | 40 000          | 40 000     | 1 000 000       | 2 000 000    |
| **Quellen**                       |                |            |                 |            |                 |              |
| Grundeinkommen                    | 1 600          | 2 400      | 1 600           | 2 400      | 1 600           | 2 400        |
| Job (12 h)                        | –              | –          | 3 600           | 3 600      | 30 000          | 30 000       |
| Arbeitsaufgaben                   | –              | –          | 420             | 1 200      | 3 500           | 10 000       |
| Depotertrag (7 %, Erwartungswert) | 490            | 700        | 1 960           | 2 800      | 49 000          | 140 000      |
| **Summe Quellen**                 | **2 090**      | **3 100**  | **7 580**       | **10 000** | **84 100**      | **182 400**  |
| **Senken**                        |                |            |                 |            |                 |              |
| Ordergebühren                     | 3              | 30         | 3               | 30         | 3               | 30           |
| Spread und Slippage               | 3              | 20         | 5               | 80         | 100             | 4 000        |
| Steuern                           | 60             | 105        | 300             | 500        | 8 300           | 25 000       |
| Unterhalt Statussymbole           | –              | –          | –               | –          | 1 625           | 16 625       |
| **Summe Senken**                  | **66**         | **155**    | **308**         | **610**    | **10 028**      | **45 655**   |
| **Netto je Tag**                  | **+2 024**     | **+2 945** | **+7 272**      | **+9 390** | **+74 072**     | **+136 745** |
| Netto in % des Vermögens          | 20 %           | 29 %       | 18 %            | 23 %       | 7 %             | 7 %          |
| Senken in % der Quellen           | 3 %            | 5 %        | 4 %             | 6 %        | 12 %            | 25 %         |

Anmerkungen zur Tabelle:

- **Level 1** ist ohne Job gerechnet. Level 2 (100 XP) ist in der ersten Sitzung erreicht; der Praktikantenjob
  bringt dann weitere 1 800 € am Tag.
- **Arbeitsaufgaben:** Bonus = ein Stundengehalt × Qualität (0,7 bzw. 0,8).
- **Steuern:** 25 % auf Dividenden und auf den realisierten Teil der Kursgewinne (Gelegenheitsspieler realisiert
  wenig, aktiver Spieler etwa 60 %).
- **Unterhalt:** Gelegenheitsspieler mit Rolex und Porsche, aktiver Spieler zusätzlich mit Penthouse.
- **Nicht enthalten:** Unternehmen (Abschnitt 4), Hebel, Zufallsereignisse (Erwartungswert etwa +200 € am Tag
  aus der Erbschaft, −0,12 % des Cash aus der Steuerprüfung).
- **Hebel als Senke:** Wer 500 000 € Eigenkapital mit 2× hebelt, zahlt auf 500 000 € Kredit 7 % = 35 000 € am Tag.
  Bei 10× wären es auf 4,5 Mio. € Kredit 315 000 € am Tag, also 63 % des Eigenkapitals.

### 2.3 Je Woche

|           | L1 Gelegenheit | L1 aktiv    | L10 Gelegenheit | L10 aktiv   | L25 Gelegenheit | L25 aktiv    |
| --------- | -------------- | ----------- | --------------- | ----------- | --------------- | ------------ |
| Quellen   | 14 600         | 21 700      | 53 100          | 70 000      | 588 700         | 1 276 800    |
| Senken    | 460            | 1 090       | 2 160           | 4 270       | 70 200          | 319 600      |
| **Netto** | **+14 200**    | **+20 600** | **+50 900**     | **+65 700** | **+518 500**    | **+957 200** |

Ein Spieler bleibt nicht eine Woche auf Level 1. Die Spalten zeigen die Größenordnung je Level, nicht einen
Verlauf.

### 2.4 Was die Rechnung zeigt

1. **Die Senken sind schwach.** Auf Level 1 und 10 verschwinden 3 bis 6 % dessen, was hereinkommt. Erst mit
   großem Depot, Steuern und Statussymbolen werden es 12 bis 25 %. Das Vermögen je Spieler wächst mit den
   Startwerten um etwa 20 % am Tag (früh) bis 7 % am Tag (spät).
2. **Das Grundeinkommen ist nur am Anfang wichtig:** rund 77 % der Einnahmen auf Level 1, etwa 20 bis 25 % auf
   Level 10, 1 bis 2 % auf Level 25. Als Sicherheitsnetz passt das.
3. **Ab etwa 100 000 € Vermögen dominiert der Kapitalertrag.** 7 % am Tag verzehnfachen ein Depot in gut einem
   Monat. Das ist die Folge von „realistische Jahresrenditen“ und „ein Jahr = ein Tag“ (Abschnitt 6, Punkt 1).
4. **Die feste Ordergebühr von 1 € ist nur für Level 1 spürbar** (0,1 % bei einem Trade über 1 000 €). Danach ist
   sie keine Senke mehr.
5. **Gelegenheits- und aktive Spieler liegen eng beieinander,** weil Gehalt und Depotertrag passiv laufen. Aktives
   Spielen bringt vor allem XP (Abschnitt 3) und die Chance auf Überrendite.

---

## 3. Zeit bis zu den Leveln

Benötigte Gesamt-XP aus der Kurve:

| Level     | 2   | 3   | 5     | 8     | 10     | 12     | 15     | 18     | 20     | 25      | 30      | 40      | 50      |
| --------- | --- | --- | ----- | ----- | ------ | ------ | ------ | ------ | ------ | ------- | ------- | ------- | ------- |
| XP gesamt | 100 | 383 | 1 703 | 6 143 | 11 106 | 17 916 | 31 998 | 51 216 | 67 135 | 118 809 | 189 029 | 392 197 | 689 513 |

Geschätzte XP je Tag. Grundwerte aus dem Prompt, rechts mit dem Alpha-Bonus (×2):

| Quelle                                            | Gelegenheit    | aktiv                      |
| ------------------------------------------------- | -------------- | -------------------------- |
| Login mit Streak (Mittel der ersten Wochen)       | 150            | 200                        |
| Missionen (2 bzw. 3 von 3, je 300)                | 600            | 900                        |
| Trades (5 bzw. 30)                                | 50             | 300                        |
| Gewinn-XP                                         | 10             | 100, spät 1 000 und mehr   |
| Arbeitsstunden (12 × 40, passiv)                  | 480            | 480 (720 bei Spielerfirma) |
| Arbeitsaufgaben (2 bzw. 5, je 100)                | 200            | 500                        |
| Erfolge (Mittel)                                  | 10             | 100                        |
| **Summe ohne Firma (Grundwert)**                  | **etwa 1 500** | **etwa 2 600**             |
| **Summe ohne Firma mit Alpha-Bonus**              | **etwa 3 000** | **etwa 5 200**             |
| Eigene Firma, 4 Gewinnquartale am Tag (Grundwert) | +2 000         | +2 000                     |
| **Summe mit profitabler Firma mit Alpha-Bonus**   | **etwa 7 000** | **etwa 9 500**             |

Daraus die Tage bis zum Level **mit Alpha-Bonus** (in Klammern ohne Bonus):

| Level | Freischaltung       | Gelegenheit ohne Firma | Gelegenheit mit Firma | aktiv ohne Firma | aktiv mit Firma |
| ----- | ------------------- | ---------------------- | --------------------- | ---------------- | --------------- |
| 2     | Erster Job          | erste Sitzung          | –                     | erste Sitzung    | –               |
| 3     | Limit-Order         | Tag 1                  | –                     | Tag 1            | –               |
| 5     | Anleihen, Stop-Loss | Tag 1 (2)              | –                     | Tag 1 (1)        | –               |
| 8     | Leerverkäufe        | Tag 3 (5)              | –                     | Tag 2 (3)        | –               |
| 10    | Kleinunternehmen    | Tag 4 (8)              | Tag 4 (8)             | Tag 3 (5)        | Tag 3 (5)       |
| 12    | Hebel 2×            | Tag 6 (12)             | Tag 5 (10)            | Tag 4 (7)        | Tag 4 (7)       |
| 15    | Kleinkredit         | Tag 11 (22)            | Tag 7 (14)            | Tag 7 (13)       | Tag 6 (10)      |
| 18    | Hebel 5×            | Tag 18 (35)            | Tag 10 (20)           | Tag 10 (20)      | Tag 8 (14)      |
| 20    | GmbH                | Tag 23 (45)            | Tag 12 (24)           | Tag 13 (26)      | Tag 9 (17)      |
| 25    | IPO                 | Tag 40 (80)            | Tag 20 (39)           | Tag 23 (46)      | Tag 15 (28)     |
| 30    | Hebel 10×, Optionen | Tag 64 (126)           | Tag 30 (59)           | Tag 37 (73)      | Tag 22 (43)     |
| 50    | Börsenlegende       | etwa Tag 230           | etwa Tag 100          | etwa Tag 135     | etwa Tag 75     |

**Bewertung:**

- **Mit dem Alpha-Bonus passt der Takt zu einem Freundestest von drei bis vier Wochen.** Firmengründung nach
  3 bis 4 Tagen, GmbH nach 9 bis 23 Tagen, IPO nach 15 bis 40 Tagen.
- **Die frühen Freischaltungen kommen jetzt sehr schnell:** Level 5 am ersten Tag, Leerverkäufe am zweiten oder
  dritten. Das ist für die Alpha gewollt (alles soll getestet werden), für einen späteren Release aber zu schnell.
  Dann `xpMultiplier` zurück auf 1.
- **„Mit Firma“ heißt jetzt: mit einer Firma, die Gewinn macht.** Nach Abschnitt 4 schafft das nur, wer sie
  ordentlich führt. Ein Kleinunternehmen braucht 2 bis 6 Quartale bis zum ersten Gewinnquartal; ein passiver
  Gründer bekommt diese XP praktisch nie. Die Sorge aus dem ersten Bericht (2 000 XP am Tag „ohne etwas zu tun“)
  ist damit kleiner, die Quelle bleibt aber die größte im Spiel (mit Bonus 4 000 XP am Tag).
  **Vorschlag** (nicht umgesetzt, Wert aus dem Prompt): 500 XP nur für das erste Gewinnquartal des Tages,
  weitere 100.
- **Gewinn-XP** ist früh bedeutungslos (10 000 € Depot, 1 XP je 100 € Gewinn) und spät sehr ergiebig (500 XP ab
  50 000 € Gewinn je Trade). Die Grenze von 30 Trades am Tag gilt laut Prompt nur für die 10 XP je Trade.
  **Vorschlag:** Gewinn-XP ebenfalls auf einen Tageswert begrenzen.
- **Arbeits-XP läuft passiv.** 480 XP am Tag (mit Bonus 960) ohne Zutun sind ein Drittel der XP eines
  Gelegenheitsspielers. Das ist gewollt (Offline-Fortschritt), sollte aber bekannt sein.

---

## 4. Unternehmen

Leitsatz des Auftraggebers: **„Ein Unternehmen muss sich rentieren, aber nicht jeder darf erfolgreich werden.“**
Dieser Abschnitt beschreibt, wie das Modell das erreicht, und belegt es mit Läufen des Szenario-Werkzeugs
`src/lib/sim/company-scenarios.ts`. Alle Zahlen unten stammen aus diesem Werkzeug (5 Branchen × 12 Seeds,
je 40 Quartale = 10 echte Tage) und werden in `company-scenarios.test.ts` als Trefferquoten geprüft.

### 4.1 Der Mechanismus: ein Markt je Firmenstufe

Im ersten Entwurf verkauften alle Firmen einer Branche in denselben Topf von 30 Mio. € und mehr. Ein
Kleinunternehmen bediente davon 0,05 %. Es stand nie im Wettbewerb, die beste Strategie war „Preis ans obere
Ende“, und ein Preisband musste als versteckte Grenze die Arbeit des Wettbewerbs erledigen.

Jetzt hat jede Firmenstufe ihren eigenen Markt (`company.segments`):

| Markt         | Firmenstufe      | Größe (Anteil an der Branchennachfrage) | Beispiel Tech je Quartal | etablierte Anbieter           |
| ------------- | ---------------- | --------------------------------------- | ------------------------ | ----------------------------- |
| lokal         | Kleinunternehmen | 0,18 %                                  | 54 000 €                 | Qualität 40, Bekanntheit 50 % |
| regional      | GmbH             | 0,6 %                                   | 180 000 €                | Qualität 50, Bekanntheit 50 % |
| national      | AG vor IPO       | 2,2 %                                   | 660 000 €                | Qualität 55, Bekanntheit 50 % |
| international | börsennotiert    | 100 %                                   | 30 Mio. €                | die KI-Konzerne selbst        |

- **Innerhalb eines Markts gilt unverändert die Formel aus dem Prompt** (Attraktivität, Marktanteil,
  Kapazitätsgrenze, Abschnitt 6.2).
- **Etablierte Anbieter:** In den drei kleinen Märkten gibt es bereits Konkurrenz. Sie ist als ein namenloser
  Wettbewerber modelliert, der zum Marktpreis verkauft und unbegrenzt liefern kann. Dafür braucht es keine
  zusätzlichen KI-Firmen in der Datenbank.
- **Die kleinen Märkte wachsen nicht mit dem Branchentrend.** Sie spüren Konjunktur, Ölpreis, Zinsen und Events,
  aber wer dauerhaft wachsen will, muss die nächste Stufe gründen. Der internationale Markt wächst weiter.
- **Die Marktgröße passt zur Mitarbeitergrenze:** Ein voll besetztes, gut geführtes Unternehmen kann etwa ein
  Drittel seines Markts bedienen. Zwei gute Firmen passen hinein, bei drei wird es eng, vier sind zu viele.
  Das ist die Rivalität zwischen den vier Freunden, auch solange ihre Firmen winzig sind.
- **Beim Stufenwechsel** nimmt die Firma ihre Kunden mit: Die Bekanntheit wird auf den größeren Markt
  umgerechnet (`awarenessAfterTierChange`), 30 % lokal entsprechen 9 % regional.

### 4.2 Preise regelt der Wettbewerb, nicht mehr ein Preisband

Zwei Änderungen machen das Preisband überflüssig:

1. **Preisempfindlichkeit je Branche** (`sectors.*.priceExponent`). Der Exponent 1,5 aus dem Prompt bleibt der
   Mittelwert, aber Kunden reagieren je Branche verschieden stark: Einzelhandel 2,5, Logistik 2,0, Energie 1,5,
   Tech 1,2, Pharma 1,0. Das war im ersten Bericht als Vorschlag offen und ist jetzt umgesetzt, weil der
   Einzelhandel sonst keine „kleinen Margen, Preiskriege“ hat und dort der Höchstpreis gewann.
2. **Der Referenzpreis ist der gewinnmaximale Preis.** Bei Exponent `e` ist für eine kleine Firma der beste Preis
   `(e + 1) / e × (Stückkosten + Produktionslohn je Stück)`. Stückkosten und Kapazität je Skillpunkt sind so
   gewählt, dass dabei genau der Referenzpreis herauskommt (ein Test prüft das auf 3 %). Wer teurer ist, verliert
   mehr Kunden, als die höhere Marge bringt. Wer billiger ist, verschenkt Marge.

Übrig ist nur ein weiter Regler: 25 % bis 300 % des Referenzpreises (`company.priceBand`). Er verhindert
Tippfehler, steuert aber nichts. Der „gierige“ Gründer unten setzt immer 300 % und geht daran zugrunde.

Die etablierten Anbieter und die KI-Firmen geben Kostenänderungen (Ölpreis) eins zu eins weiter
(`marketPriceCents`). Wer seinen Preis bei steigenden Kosten nicht anpasst, verliert Marge.

### 4.3 Die Gründertypen im Szenario-Werkzeug

| Typ                 | Verhalten                                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **solide**          | passt Personal an die Nachfrage an (stellt ein über 95 % Auslastung, entlässt unter 75 %), gleichmäßiges Marketing in Höhe des Referenzbudgets, stellt so viele Entwickler ein, dass die Qualität 10 Punkte über den etablierten Anbietern liegt, gibt Kosten im Preis weiter |
| **passiv**          | Startteam, Referenzpreis, kein Marketing, keine Entwicklung, ändert nie etwas                                                                                                                                                                                                 |
| **gierig**          | Startteam, immer Höchstpreis (300 %), kein Marketing, keine Entwicklung                                                                                                                                                                                                       |
| **Preisdrücker**    | verkauft 5 % über den eigenen variablen Kosten, macht Marketing, stellt Produktion ein, sobald ausverkauft                                                                                                                                                                    |
| **Überexpandierer** | stellt sofort bis zur Mitarbeitergrenze ein und gibt das Zehnfache des Referenzbudgets für Marketing aus                                                                                                                                                                      |
| **mittelmäßig**     | wie solide, aber keine zusätzlichen Entwickler, 40 % des Marketings, passt den Preis nie an, entlässt nie                                                                                                                                                                     |
| **schlampig**       | stellt sofort bis zur Grenze Produktion ein, 25 % zu teuer, 20 % des Marketings                                                                                                                                                                                               |

Startbedingungen: Ein Kleinunternehmen beginnt mit drei eingearbeiteten Produktionsmitarbeitern (Skill 5),
Qualität 30, Bekanntheit 8 % und 15 000 € Betriebskapital. GmbH und AG beginnen als umgewandelte Firma der Stufe
darunter: deren volles Team, Qualität 10 Punkte über den Etablierten des alten Markts, mitgenommene Bekanntheit,
Betriebskapital in Höhe der Gründungskosten. „Amortisation“ heißt: Der aufgelaufene Gewinn nach Steuern deckt die
Gründungskosten der Stufe. „Gewinn je Quartal am Ende“ ist der Mittelwert der letzten 8 Quartale.

### 4.4 Ergebnisse: Kleinunternehmen (Gründungskosten 15 000 €)

Median über 12 Seeds je Branche, ein Unternehmen allein in seinem lokalen Markt:

| Gründertyp      | Branche      | Gewinn kumuliert (€) | Gewinn je Quartal am Ende (€) | Amortisation im Quartal | amortisiert | insolvent | Insolvenz im Quartal (Median / frühestes) |
| --------------- | ------------ | -------------------- | ----------------------------- | ----------------------- | ----------- | --------- | ----------------------------------------- |
| solide          | Tech         | 42.758               | 1.190                         | 17                      | 100 %       | 0 %       | – / –                                     |
| solide          | Einzelhandel | 48.613               | 1.312                         | 15                      | 100 %       | 0 %       | – / –                                     |
| solide          | Energie      | 47.322               | 1.335                         | 16                      | 100 %       | 0 %       | – / –                                     |
| solide          | Pharma       | 53.482               | 1.688                         | 18                      | 100 %       | 0 %       | – / –                                     |
| solide          | Logistik     | 45.851               | 1.241                         | 16                      | 100 %       | 0 %       | – / –                                     |
| passiv          | Tech         | -36.831              | –                             | –                       | 0 %         | 100 %     | 10 / 10                                   |
| passiv          | Einzelhandel | -34.657              | –                             | –                       | 0 %         | 100 %     | 12 / 11                                   |
| passiv          | Energie      | -37.137              | –                             | –                       | 0 %         | 100 %     | 10 / 10                                   |
| passiv          | Pharma       | -37.266              | –                             | –                       | 0 %         | 100 %     | 9 / 9                                     |
| passiv          | Logistik     | -35.338              | –                             | –                       | 0 %         | 100 %     | 11 / 11                                   |
| gierig          | Tech         | -41.289              | –                             | –                       | 0 %         | 100 %     | 8 / 8                                     |
| gierig          | Einzelhandel | -43.507              | –                             | –                       | 0 %         | 100 %     | 7 / 7                                     |
| gierig          | Energie      | -44.707              | –                             | –                       | 0 %         | 100 %     | 7 / 7                                     |
| gierig          | Pharma       | -39.864              | –                             | –                       | 0 %         | 100 %     | 7 / 7                                     |
| gierig          | Logistik     | -43.316              | –                             | –                       | 0 %         | 100 %     | 7 / 7                                     |
| Preisdrücker    | Tech         | -30.523              | –                             | –                       | 0 %         | 100 %     | 12 / 11                                   |
| Preisdrücker    | Einzelhandel | -25.571              | –                             | –                       | 0 %         | 100 %     | 9 / 9                                     |
| Preisdrücker    | Energie      | -29.235              | –                             | –                       | 0 %         | 100 %     | 8 / 8                                     |
| Preisdrücker    | Pharma       | -26.396              | –                             | –                       | 0 %         | 100 %     | 9 / 9                                     |
| Preisdrücker    | Logistik     | -27.242              | –                             | –                       | 0 %         | 100 %     | 9 / 9                                     |
| Überexpandierer | Tech         | -25.323              | –                             | –                       | 0 %         | 100 %     | 9 / 8                                     |
| Überexpandierer | Einzelhandel | -69.757              | –                             | –                       | 0 %         | 100 %     | 6 / 6                                     |
| Überexpandierer | Energie      | -47.692              | –                             | –                       | 0 %         | 100 %     | 6 / 6                                     |
| Überexpandierer | Pharma       | -18.313              | –                             | –                       | 0 %         | 100 %     | 8 / 7                                     |
| Überexpandierer | Logistik     | -57.699              | –                             | –                       | 0 %         | 100 %     | 6 / 6                                     |

Mehrere Spielerfirmen im selben lokalen Markt:

| Aufstellung       | Branche      | Gründer        | Gewinn kumuliert (€) | Gewinn je Quartal am Ende (€) | Amortisation im Quartal | insolvent |
| ----------------- | ------------ | -------------- | -------------------- | ----------------------------- | ----------------------- | --------- |
| vier verschiedene | Tech         | solide         | 33.832               | 1.190                         | 25                      | 0 %       |
| vier verschiedene | Tech         | mittelmäßig    | -30.369              | –                             | –                       | 100 %     |
| vier verschiedene | Tech         | schlampig      | -45.996              | –                             | –                       | 100 %     |
| vier verschiedene | Tech         | passiv         | -40.003              | –                             | –                       | 100 %     |
| vier verschiedene | Einzelhandel | solide         | 42.245               | 1.312                         | 20                      | 0 %       |
| vier verschiedene | Einzelhandel | mittelmäßig    | -24.040              | –                             | –                       | 100 %     |
| vier verschiedene | Einzelhandel | schlampig      | -45.127              | –                             | –                       | 100 %     |
| vier verschiedene | Einzelhandel | passiv         | -36.122              | –                             | –                       | 100 %     |
| vier verschiedene | Energie      | solide         | 38.319               | 1.335                         | 23                      | 0 %       |
| vier verschiedene | Energie      | mittelmäßig    | -22.243              | –                             | –                       | 100 %     |
| vier verschiedene | Energie      | schlampig      | -48.307              | –                             | –                       | 100 %     |
| vier verschiedene | Energie      | passiv         | -38.742              | –                             | –                       | 100 %     |
| vier verschiedene | Pharma       | solide         | 44.008               | 1.688                         | 23                      | 0 %       |
| vier verschiedene | Pharma       | mittelmäßig    | -31.919              | –                             | –                       | 100 %     |
| vier verschiedene | Pharma       | schlampig      | -51.066              | –                             | –                       | 100 %     |
| vier verschiedene | Pharma       | passiv         | -41.751              | –                             | –                       | 100 %     |
| vier verschiedene | Logistik     | solide         | 39.149               | 1.241                         | 21                      | 0 %       |
| vier verschiedene | Logistik     | mittelmäßig    | -23.738              | –                             | –                       | 100 %     |
| vier verschiedene | Logistik     | schlampig      | -46.375              | –                             | –                       | 100 %     |
| vier verschiedene | Logistik     | passiv         | -39.683              | –                             | –                       | 100 %     |
| zwei solide       | Tech         | solide (jeder) | 34.579               | 1.190                         | 24                      | 0 %       |
| zwei solide       | Einzelhandel | solide (jeder) | 43.706               | 1.312                         | 19                      | 0 %       |
| zwei solide       | Energie      | solide (jeder) | 39.670               | 1.335                         | 21.5                    | 0 %       |
| zwei solide       | Pharma       | solide (jeder) | 32.461               | 1.688                         | 29.5                    | 0 %       |
| zwei solide       | Logistik     | solide (jeder) | 40.510               | 1.241                         | 20                      | 0 %       |
| drei solide       | Tech         | solide (jeder) | -1.435               | 777                           | –                       | 33 %      |
| drei solide       | Einzelhandel | solide (jeder) | 14.839               | 1.238                         | –                       | 0 %       |
| drei solide       | Energie      | solide (jeder) | -17.732              | 886                           | –                       | 75 %      |
| drei solide       | Pharma       | solide (jeder) | -22.878              | –                             | –                       | 100 %     |
| drei solide       | Logistik     | solide (jeder) | 8.340                | 1.044                         | –                       | 8 %       |
| vier solide       | Tech         | solide (jeder) | -22.851              | –                             | –                       | 100 %     |
| vier solide       | Einzelhandel | solide (jeder) | -20.036              | –                             | –                       | 100 %     |
| vier solide       | Energie      | solide (jeder) | -23.546              | –                             | –                       | 100 %     |
| vier solide       | Pharma       | solide (jeder) | -32.346              | –                             | –                       | 100 %     |
| vier solide       | Logistik     | solide (jeder) | -20.751              | –                             | –                       | 100 %     |

### 4.5 Ergebnisse: GmbH (Gründungskosten 75 000 €)

| Gründertyp      | Branche      | Gewinn kumuliert (€) | Gewinn je Quartal am Ende (€) | Amortisation im Quartal | amortisiert | insolvent | Insolvenz im Quartal (Median / frühestes) |
| --------------- | ------------ | -------------------- | ----------------------------- | ----------------------- | ----------- | --------- | ----------------------------------------- |
| solide          | Tech         | 332.744              | 10.322                        | 16                      | 100 %       | 0 %       | – / –                                     |
| solide          | Einzelhandel | 270.348              | 9.580                         | 20                      | 100 %       | 0 %       | – / –                                     |
| solide          | Energie      | 148.334              | 6.237                         | 29                      | 100 %       | 0 %       | – / –                                     |
| solide          | Pharma       | 418.644              | 14.890                        | 16                      | 100 %       | 0 %       | – / –                                     |
| solide          | Logistik     | 156.901              | 6.349                         | 28                      | 100 %       | 0 %       | – / –                                     |
| passiv          | Tech         | -128.636             | –                             | –                       | 0 %         | 100 %     | 26 / 25                                   |
| passiv          | Einzelhandel | -103.228             | –                             | –                       | 0 %         | 100 %     | 19 / 19                                   |
| passiv          | Energie      | -114.905             | –                             | –                       | 0 %         | 100 %     | 13 / 13                                   |
| passiv          | Pharma       | -132.533             | –                             | –                       | 0 %         | 100 %     | 19 / 19                                   |
| passiv          | Logistik     | -108.589             | –                             | –                       | 0 %         | 100 %     | 17 / 16                                   |
| gierig          | Tech         | -127.281             | –                             | –                       | 0 %         | 100 %     | 14.5 / 14                                 |
| gierig          | Einzelhandel | -148.412             | –                             | –                       | 0 %         | 100 %     | 10 / 10                                   |
| gierig          | Energie      | -150.113             | –                             | –                       | 0 %         | 100 %     | 10 / 10                                   |
| gierig          | Pharma       | -142.199             | –                             | –                       | 0 %         | 100 %     | 12 / 12                                   |
| gierig          | Logistik     | -142.899             | –                             | –                       | 0 %         | 100 %     | 10 / 10                                   |
| Preisdrücker    | Tech         | -127.122             | –                             | –                       | 0 %         | 100 %     | 11 / 11                                   |
| Preisdrücker    | Einzelhandel | -144.810             | –                             | –                       | 0 %         | 100 %     | 9 / 9                                     |
| Preisdrücker    | Energie      | -156.460             | –                             | –                       | 0 %         | 100 %     | 8 / 8                                     |
| Preisdrücker    | Pharma       | -149.775             | –                             | –                       | 0 %         | 100 %     | 9 / 9                                     |
| Preisdrücker    | Logistik     | -150.753             | –                             | –                       | 0 %         | 100 %     | 9 / 9                                     |
| Überexpandierer | Tech         | -114.963             | –                             | –                       | 0 %         | 100 %     | 9 / 9                                     |
| Überexpandierer | Einzelhandel | -273.902             | –                             | –                       | 0 %         | 100 %     | 6 / 6                                     |
| Überexpandierer | Energie      | -208.655             | –                             | –                       | 0 %         | 100 %     | 6 / 6                                     |
| Überexpandierer | Pharma       | -93.408              | –                             | –                       | 0 %         | 100 %     | 12 / 9                                    |
| Überexpandierer | Logistik     | -235.943             | –                             | –                       | 0 %         | 100 %     | 6 / 6                                     |

| Aufstellung       | Branche      | Gründer        | Gewinn kumuliert (€) | Gewinn je Quartal am Ende (€) | Amortisation im Quartal | insolvent |
| ----------------- | ------------ | -------------- | -------------------- | ----------------------------- | ----------------------- | --------- |
| vier verschiedene | Tech         | solide         | 277.279              | 10.322                        | 20                      | 0 %       |
| vier verschiedene | Tech         | mittelmäßig    | -3.633               | 28                            | –                       | 0 %       |
| vier verschiedene | Tech         | schlampig      | -188.967             | –                             | –                       | 100 %     |
| vier verschiedene | Tech         | passiv         | -126.692             | –                             | –                       | 100 %     |
| vier verschiedene | Einzelhandel | solide         | 220.058              | 9.578                         | 24.5                    | 0 %       |
| vier verschiedene | Einzelhandel | mittelmäßig    | 71.453               | 3.165                         | –                       | 0 %       |
| vier verschiedene | Einzelhandel | schlampig      | -184.628             | –                             | –                       | 100 %     |
| vier verschiedene | Einzelhandel | passiv         | -127.154             | –                             | –                       | 100 %     |
| vier verschiedene | Energie      | solide         | 118.885              | 6.237                         | 33                      | 0 %       |
| vier verschiedene | Energie      | mittelmäßig    | -85.725              | -2.241                        | –                       | 42 %      |
| vier verschiedene | Energie      | schlampig      | -198.572             | –                             | –                       | 100 %     |
| vier verschiedene | Energie      | passiv         | -134.436             | –                             | –                       | 100 %     |
| vier verschiedene | Pharma       | solide         | 147.117              | 6.843                         | 30.5                    | 0 %       |
| vier verschiedene | Pharma       | mittelmäßig    | -65.490              | -2.460                        | –                       | 8 %       |
| vier verschiedene | Pharma       | schlampig      | -197.103             | –                             | –                       | 100 %     |
| vier verschiedene | Pharma       | passiv         | -141.221             | –                             | –                       | 100 %     |
| vier verschiedene | Logistik     | solide         | 138.086              | 6.349                         | 30.5                    | 0 %       |
| vier verschiedene | Logistik     | mittelmäßig    | -4.627               | 456                           | –                       | 0 %       |
| vier verschiedene | Logistik     | schlampig      | -179.745             | –                             | –                       | 100 %     |
| vier verschiedene | Logistik     | passiv         | -134.164             | –                             | –                       | 100 %     |
| zwei solide       | Tech         | solide (jeder) | 112.311              | 5.341                         | 32.5                    | 0 %       |
| zwei solide       | Einzelhandel | solide (jeder) | 146.661              | 7.369                         | 30.5                    | 0 %       |
| zwei solide       | Energie      | solide (jeder) | 65.841               | 4.901                         | –                       | 8 %       |
| zwei solide       | Pharma       | solide (jeder) | 46.466               | 2.820                         | –                       | 0 %       |
| zwei solide       | Logistik     | solide (jeder) | 106.322              | 6.002                         | 35                      | 0 %       |
| drei solide       | Tech         | solide (jeder) | -70.798              | -480                          | –                       | 42 %      |
| drei solide       | Einzelhandel | solide (jeder) | -67.058              | -472                          | –                       | 33 %      |
| drei solide       | Energie      | solide (jeder) | -92.266              | –                             | –                       | 100 %     |
| drei solide       | Pharma       | solide (jeder) | -88.409              | –                             | –                       | 100 %     |
| drei solide       | Logistik     | solide (jeder) | -88.703              | –                             | –                       | 100 %     |
| vier solide       | Tech         | solide (jeder) | -90.617              | –                             | –                       | 100 %     |
| vier solide       | Einzelhandel | solide (jeder) | -93.952              | –                             | –                       | 100 %     |
| vier solide       | Energie      | solide (jeder) | -109.123             | –                             | –                       | 100 %     |
| vier solide       | Pharma       | solide (jeder) | -109.710             | –                             | –                       | 100 %     |
| vier solide       | Logistik     | solide (jeder) | -100.170             | –                             | –                       | 100 %     |

### 4.6 Ergebnisse: AG vor IPO (Gründungskosten 300 000 €)

| Gründertyp      | Branche      | Gewinn kumuliert (€) | Gewinn je Quartal am Ende (€) | Amortisation im Quartal | amortisiert | insolvent | Insolvenz im Quartal (Median / frühestes) |
| --------------- | ------------ | -------------------- | ----------------------------- | ----------------------- | ----------- | --------- | ----------------------------------------- |
| solide          | Tech         | 1.417.102            | 50.648                        | 16.5                    | 100 %       | 0 %       | – / –                                     |
| solide          | Einzelhandel | 1.707.739            | 61.187                        | 16                      | 100 %       | 0 %       | – / –                                     |
| solide          | Energie      | 1.347.144            | 51.624                        | 19.5                    | 100 %       | 0 %       | – / –                                     |
| solide          | Pharma       | 1.080.963            | 34.026                        | 17                      | 100 %       | 0 %       | – / –                                     |
| solide          | Logistik     | 1.361.000            | 47.986                        | 18                      | 100 %       | 0 %       | – / –                                     |
| passiv          | Tech         | -513.242             | –                             | –                       | 0 %         | 100 %     | 26 / 25                                   |
| passiv          | Einzelhandel | -424.974             | –                             | –                       | 0 %         | 100 %     | 19 / 19                                   |
| passiv          | Energie      | -459.621             | –                             | –                       | 0 %         | 100 %     | 13 / 13                                   |
| passiv          | Pharma       | -543.537             | –                             | –                       | 0 %         | 100 %     | 19 / 18                                   |
| passiv          | Logistik     | -438.164             | –                             | –                       | 0 %         | 100 %     | 17 / 16                                   |
| gierig          | Tech         | -503.538             | –                             | –                       | 0 %         | 100 %     | 14 / 14                                   |
| gierig          | Einzelhandel | -602.087             | –                             | –                       | 0 %         | 100 %     | 10 / 10                                   |
| gierig          | Energie      | -618.740             | –                             | –                       | 0 %         | 100 %     | 10 / 10                                   |
| gierig          | Pharma       | -585.929             | –                             | –                       | 0 %         | 100 %     | 12 / 11                                   |
| gierig          | Logistik     | -583.180             | –                             | –                       | 0 %         | 100 %     | 10 / 10                                   |
| Preisdrücker    | Tech         | -505.195             | –                             | –                       | 0 %         | 100 %     | 11 / 11                                   |
| Preisdrücker    | Einzelhandel | -569.263             | –                             | –                       | 0 %         | 100 %     | 9 / 9                                     |
| Preisdrücker    | Energie      | -623.690             | –                             | –                       | 0 %         | 100 %     | 8 / 8                                     |
| Preisdrücker    | Pharma       | -597.877             | –                             | –                       | 0 %         | 100 %     | 9 / 9                                     |
| Preisdrücker    | Logistik     | -596.889             | –                             | –                       | 0 %         | 100 %     | 9 / 9                                     |
| Überexpandierer | Tech         | -311.324             | 3.630                         | –                       | 0 %         | 58 %      | 11 / 9                                    |
| Überexpandierer | Einzelhandel | -922.485             | –                             | –                       | 0 %         | 100 %     | 6 / 6                                     |
| Überexpandierer | Energie      | -678.940             | –                             | –                       | 0 %         | 100 %     | 6 / 6                                     |
| Überexpandierer | Pharma       | -439.994             | –                             | –                       | 0 %         | 100 %     | 8 / 8                                     |
| Überexpandierer | Logistik     | -788.382             | –                             | –                       | 0 %         | 100 %     | 6 / 6                                     |

| Aufstellung       | Branche      | Gründer        | Gewinn kumuliert (€) | Gewinn je Quartal am Ende (€) | Amortisation im Quartal | insolvent |
| ----------------- | ------------ | -------------- | -------------------- | ----------------------------- | ----------------------- | --------- |
| vier verschiedene | Tech         | solide         | 565.076              | 24.672                        | 29                      | 0 %       |
| vier verschiedene | Tech         | mittelmäßig    | -147.987             | -4.323                        | –                       | 17 %      |
| vier verschiedene | Tech         | schlampig      | -912.592             | –                             | –                       | 100 %     |
| vier verschiedene | Tech         | passiv         | -514.189             | –                             | –                       | 100 %     |
| vier verschiedene | Einzelhandel | solide         | 497.528              | 21.789                        | 32                      | 0 %       |
| vier verschiedene | Einzelhandel | mittelmäßig    | 258.941              | 12.435                        | –                       | 0 %       |
| vier verschiedene | Einzelhandel | schlampig      | -875.638             | –                             | –                       | 100 %     |
| vier verschiedene | Einzelhandel | passiv         | -499.973             | –                             | –                       | 100 %     |
| vier verschiedene | Energie      | solide         | 464.570              | 47.360                        | 36                      | 0 %       |
| vier verschiedene | Energie      | mittelmäßig    | -434.913             | –                             | –                       | 100 %     |
| vier verschiedene | Energie      | schlampig      | -973.193             | –                             | –                       | 100 %     |
| vier verschiedene | Energie      | passiv         | -551.000             | –                             | –                       | 100 %     |
| vier verschiedene | Pharma       | solide         | 439.895              | 26.177                        | 36                      | 0 %       |
| vier verschiedene | Pharma       | mittelmäßig    | -382.241             | -19.520                       | –                       | 92 %      |
| vier verschiedene | Pharma       | schlampig      | -1.052.719           | –                             | –                       | 100 %     |
| vier verschiedene | Pharma       | passiv         | -539.058             | –                             | –                       | 100 %     |
| vier verschiedene | Logistik     | solide         | 205.829              | 16.842                        | –                       | 0 %       |
| vier verschiedene | Logistik     | mittelmäßig    | -141.363             | -1.856                        | –                       | 17 %      |
| vier verschiedene | Logistik     | schlampig      | -897.253             | –                             | –                       | 100 %     |
| vier verschiedene | Logistik     | passiv         | -513.736             | –                             | –                       | 100 %     |
| zwei solide       | Tech         | solide (jeder) | 120.859              | 8.843                         | –                       | 0 %       |
| zwei solide       | Einzelhandel | solide (jeder) | 190.514              | 11.370                        | –                       | 0 %       |
| zwei solide       | Energie      | solide (jeder) | -123.437             | 2.591                         | –                       | 17 %      |
| zwei solide       | Pharma       | solide (jeder) | -3.753               | 5.111                         | –                       | 0 %       |
| zwei solide       | Logistik     | solide (jeder) | -53.899              | 4.915                         | –                       | 0 %       |
| drei solide       | Tech         | solide (jeder) | -309.613             | -3.758                        | –                       | 50 %      |
| drei solide       | Einzelhandel | solide (jeder) | -314.811             | -3.746                        | –                       | 67 %      |
| drei solide       | Energie      | solide (jeder) | -380.439             | –                             | –                       | 100 %     |
| drei solide       | Pharma       | solide (jeder) | -357.905             | –                             | –                       | 100 %     |
| drei solide       | Logistik     | solide (jeder) | -372.508             | –                             | –                       | 100 %     |
| vier solide       | Tech         | solide (jeder) | -382.862             | –                             | –                       | 100 %     |
| vier solide       | Einzelhandel | solide (jeder) | -382.789             | –                             | –                       | 100 %     |
| vier solide       | Energie      | solide (jeder) | -424.689             | –                             | –                       | 100 %     |
| vier solide       | Pharma       | solide (jeder) | -406.327             | –                             | –                       | 100 %     |
| vier solide       | Logistik     | solide (jeder) | -417.270             | –                             | –                       | 100 %     |

### 4.7 Ziele und Trefferquoten

Jede Zeile ist ein Test in `company-scenarios.test.ts`. Die Quote ist der Anteil der 60 Läufe je Stufe
(5 Branchen × 12 Seeds), in denen das Ziel erreicht wurde.

| Ziel                                                                                                | Kleinunternehmen             | GmbH                  | AG                    |
| --------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------- | --------------------- |
| Solide: nie insolvent, Kasse nie im Minus                                                           | 100 %                        | 100 %                 | 100 %                 |
| Solide: Gründungskosten amortisiert bis Quartal 32                                                  | 100 % (Quartal 15 bis 18)    | 100 % (15 bis 29)     | 100 % (14 bis 24)     |
| Solide: Gewinn je Quartal am Ende                                                                   | 1 190 bis 1 688 €            | 6 236 bis 15 773 €    | 30 955 bis 61 521 €   |
| … als Vielfaches des Jobs der Stufe (Junior 900 €, Teamleitung 3 900 €, C-Level 7 500 € je Quartal) | 1,3- bis 1,9-fach            | 1,6- bis 4,0-fach     | 4,1- bis 8,2-fach     |
| Passiv: nie amortisiert, Verlust                                                                    | 100 %                        | 100 %                 | 100 %                 |
| Passiv: bis Quartal 16 insolvent oder in den Quartalen 9 bis 16 dauerhaft im Verlust                | 100 %                        | 100 %                 | 100 %                 |
| Passiv: insolvent innerhalb von 40 Quartalen                                                        | 100 % (frühestens Quartal 9) | 100 % (frühestens 13) | 100 % (frühestens 13) |
| Passiv: Kasse frühestens im Minus                                                                   | Quartal 5                    | Quartal 9             | Quartal 9             |
| Gierig: Verlust und insolvent bis Quartal 16                                                        | 100 % (Quartal 7 bis 8)      | 100 % (10 bis 15)     | 100 % (10 bis 14)     |
| Preisdrücker: Verlust, nie amortisiert                                                              | 100 %                        | 100 %                 | 100 %                 |
| Preisdrücker: Marktanteil am Ende gegen passiv                                                      | 23 % gegen 4 %               | 17 % gegen 6 %        | 22 % gegen 6 %        |
| Überexpandierer: Verlust, nie amortisiert                                                           | 100 %                        | 100 %                 | 100 %                 |
| Überexpandierer: insolvent                                                                          | 100 % (ab Quartal 6)         | 100 % (ab Quartal 6)  | 92 % (ab Quartal 6)   |
| Volle Nische: der solide Gründer ist der Beste und im Plus                                          | 100 %                        | 100 %                 | 98 %                  |
| Volle Nische: der solide Gründer amortisiert                                                        | 100 %                        | 98 %                  | 70 %                  |
| Volle Nische: passiv und schlampig machen Verlust, schlampig wird insolvent                         | 100 %                        | 100 %                 | 100 %                 |
| Volle Nische: mittelmäßig im Plus                                                                   | 0 %                          | 38 %                  | 22 %                  |
| Zwei solide Firmen im selben Markt: beide im Plus                                                   | 100 %                        | 98 %                  | 55 %                  |
| Drei solide Firmen: im Plus                                                                         | 52 %                         | 0 %                   | 0 %                   |
| Vier solide Firmen: im Plus                                                                         | 0 %                          | 0 %                   | 0 %                   |

Die Quoten sind hoch, weil die Zufallseinflüsse auf ein einzelnes Unternehmen (Nachfragerauschen 2 bis 4 %,
Makro-Events mit je 3 bis 4 % je Quartal) kleiner sind als die Unterschiede zwischen den Strategien. Das Ergebnis
hängt an der Führung, nicht am Glück.

**Was erreicht ist:**

- Ein gut geführtes Kleinunternehmen zahlt die Gründungskosten nach etwa 4 echten Tagen zurück und bringt danach
  etwa das 1,3- bis 1,9-fache eines Junior-Gehalts. Die ersten Quartale sind schwach oder negativ
  (Einarbeitung, Bekanntheit aufbauen).
- GmbH und AG amortisieren in einem ähnlichen Zeitraum (4 bis 7 Tage).
- Alle vier „falschen“ Strategien scheitern in jeder Branche und auf jeder Stufe.
- In einer vollen Nische gewinnt der beste Gründer, die schwächsten verlieren ihr Geld.
- Niemand wird über Nacht ruiniert: Zwischen dem ersten Abschluss im Minus und der Insolvenz liegen immer
  mindestens 4 Quartale (Abschnitt „Schonfrist“ in SIMULATION.md 13).

**Was nicht oder nur teilweise erreicht ist:**

- **AG: Der Dauergewinn ist höher als „1- bis 2-faches Jobeinkommen“.** Eine gut geführte AG verdient 31 000 bis
  62 000 € je Quartal, das 4- bis 8-fache eines C-Level-Gehalts. Die Amortisation liegt trotzdem bei 14 bis
  24 Quartalen, weil der Aufbau von 20 auf 100 Mitarbeiter anfangs 20 000 bis 60 000 € Verlust je Quartal
  kostet. Bei gleicher Amortisationszeit auf allen Stufen (Gründungskosten 1 : 5 : 20) müsste der Gewinn etwa
  1 : 5 : 20 sein, tatsächlich ist er etwa 1 : 7 : 37. Ursache: Ein Kleinunternehmen muss von 5 Stellen 1 bis 2
  an Entwickler geben, eine AG braucht anteilig weniger Verwaltung. Stellschrauben, falls das zu viel ist:
  `company.segments.national.demandShare` senken oder `incumbentQuality` erhöhen. Beides macht aber den
  nationalen Markt für zwei Spieler-AGs noch enger (schon jetzt sind nur in 55 % der Läufe beide im Plus).
- **Kleinunternehmen: Amortisation eher am schnellen Rand** (Quartal 15 bis 18 statt 16 bis 32). In einer vollen
  Nische sind es 20 bis 25 Quartale.
- **Überexpandierer auf AG-Stufe in Tech:** In 5 von 12 Läufen überlebt die Firma mit Verlust, weil der
  nationale Tech-Markt die 100 Mitarbeiter trägt. Amortisiert hat sie nie.
- **Vier gleich gute Firmen gehen alle unter.** Das liegt an den starren Regeln der Testgründer: Keiner gibt
  nach. Echte Spieler werden vorher ausweichen (andere Branche, Preis, Übernahme).
- **Nur Skill-5-Mitarbeiter, keine Kredite, keine Führungskräfte** im Szenario. Bessere Mitarbeiter und ein COO
  erhöhen den Gewinn, das ist nicht vermessen.

### 4.8 Abteilungen

| Abteilung   | Wirkung                                                                                     | Lohnt sich ab                         |
| ----------- | ------------------------------------------------------------------------------------------- | ------------------------------------- |
| Produktion  | Kapazität in Stück                                                                          | immer                                 |
| Entwicklung | hält die Qualität; Bedarf wächst mit der Firmengröße und ist in Tech und Pharma am höchsten | immer (Tech, Pharma: 2 von 5 Stellen) |
| Vertrieb    | +1 % Attraktivität je Skillpunkt, höchstens +50 %                                           | GmbH                                  |
| Marketing   | jeder Werbe-Euro zählt bis zu doppelt (halbe Wirkung bei 15 Skillpunkten)                   | GmbH, sobald das Budget groß ist      |
| Finanzen    | senkt die Fixkosten um bis zu 30 % (halbe Wirkung bei 15 Skillpunkten)                      | AG (40 000 € Fixkosten)               |

Marketing und Finanzen sind neu. Bei einem Kleinunternehmen spart ein Finanz-Mitarbeiter etwa 170 € Fixkosten
und kostet 1 499 € Gehalt, bei einer AG sparen fünf etwa 8 000 € und kosten 7 500 €.

### 4.9 KI-Firmen

Die 15 KI-Firmen verkaufen im internationalen Markt. In 8 Seeds über je 40 Quartale, mit und ohne Makro-Events,
wurde keine insolvent, und keine hatte je eine Nettomarge unter 2 % (Test in `quarter.test.ts`). Die Qualität
bleibt je Größe verschieden, weil der Entwicklerbedarf jetzt mit der Firmengröße wächst: Wer anteilig mehr
Entwickler beschäftigt, hält dauerhaft die höhere Qualität (im Test 64 / 53 / 41). Marktanteile im Testlauf nach
40 Quartalen: etwa 45 / 34 / 21 %.

---

## 5. Inflationsschutz

### 5.1 Messung

Die Geldmenge wird aus dem Ledger gelesen, nicht geschätzt:

```
M = Σ Guthaben aller Spielerkonten und Spielerfirmenkonten
Wachstum = (M_heute / aktive Spieler_heute) / (M_vor 4 Quartalen / aktive Spieler_damals) − 1
```

Die Salden der Systemkonten zeigen zusätzlich, **woher** das Wachstum kommt: `mint`, `payroll`, `interest` und
`market` als Quellen, `fees`, `taxes`, `upkeep` als Senken. Diese Aufschlüsselung je Quartal ist die wichtigste
Telemetrie des Spiels.

### 5.2 Die drei Mechanismen

**Zentralbank.** Wächst die Geldmenge je Spieler um mehr als 12 % pro Spieljahr (Ziel 8 % + Band 4 %), erhöht die
Bank den Leitzins um 25 bis 50 bp je Entscheidung. Das wirkt so:

| Wirkung einer Erhöhung um 100 bp              | Größe                                |
| --------------------------------------------- | ------------------------------------ |
| Faire Werte aller Aktien sinken (Makrofaktor) | −4 %, Tech −6 %, Einzelhandel −3,2 % |
| Rentenfonds schichten in Anleihen um          | etwa −5 % Kursdruck, vorübergehend   |
| Hebel, Kredite, Überziehung werden teurer     | +1 Prozentpunkt pro Spieljahr        |
| Branchennachfrage sinkt                       | −1 bis −3 %                          |
| Anleiherenditen steigen                       | +100 bp, aber höchstens bis 4 %      |

Die Zentralbank dämpft also Vermögenspreise und Kredit. Sie entzieht kaum Geld direkt. Höhere Zinsen zahlen
Sparern sogar mehr aus. Dass die Anleiherendite bei 4 % endet, begrenzt diesen Gegeneffekt.

**Steuern.** 25 % auf realisierte Gewinne, Kupons und Dividenden, 15 % auf Firmengewinne. Die Steuer ist die
einzige Senke, die von selbst mit dem Vermögen wächst. Verluste werden nie erstattet.

**Unterhalt und Statussymbole.** Kaufpreise sind einmalige, große Senken (Insel: 100 Mio. €), der Unterhalt von
0,5 bis 2 % am Tag eine dauerhafte. Fixkosten, Gründungskosten und Finanzierungskosten wirken genauso.

### 5.3 Reicht das?

Nach der Rechnung in Abschnitt 2 nicht für stabile Preise: Das Vermögen je Spieler wächst mit den Startwerten um
7 bis 20 % am Tag. Das Spiel hat aber auch kein Preisniveau im üblichen Sinn. Aktienkurse folgen den Gewinnen der
KI-Firmen, nicht der Geldmenge der Spieler. Inflation zeigt sich nur dort, wo Spieler untereinander handeln
(Spieler-IPOs, Business Angels, Gehälter für Spieler-Mitarbeiter) und an **festen Preisen**, die mit der Zeit
bedeutungslos werden (Gründungskosten, Statussymbole, Ordergebühr, Grundeinkommen).

Die Anlaufphase der Zentralbank (14 Tage) ist deshalb nötig: In den ersten Tagen wächst die Geldmenge je Spieler
um 20 % und mehr am Tag, nur weil die Basis 10 000 € beträgt. Ohne Anlaufphase stünde der Leitzins nach zwei
Wochen bei 10 % und hätte die fairen Werte der Tech-Aktien um 40 % gedrückt, ohne dass etwas schiefläuft.

**Vorschläge für stärkere Senken**, falls der Test zu viel Geld zeigt (keiner ist umgesetzt):

1. Ordergebühr `max(1 €, 0,1 % des Orderwerts)`. Damit bleibt die Gebühr auf jedem Level spürbar.
2. Feste Preise an einen Preisindex koppeln (Geldmenge je Spieler relativ zum Start): Gründungskosten,
   Statussymbole, Unterhalt. Das ist echter Inflationsschutz, weil die Senken mitwachsen.
3. Anleihen je Spieler und Level begrenzen oder die Rendite mit der gezeichneten Menge sinken lassen.
4. Unterhalt der Statussymbole erhöhen. 1 % am Tag ist wenig gegen 7 % Kapitalertrag.

---

## 6. Auffällige Werte aus dem Prompt und Vorschläge

Kein Wert aus dem Prompt wurde stillschweigend geändert. Wo eine Zusatzregel eingeführt oder ein Wert nach
Entscheidung ersetzt wurde, steht es dabei. Entschieden ist außerdem: Die Zinssätze bleiben wie im Prompt (Punkt 1).

| #   | Wert aus dem Prompt                                                             | Problem                                                                                                                                                    | Vorschlag                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Anleihen 2 bis 4 %, Leitzins 3 %, „1 Spieljahr = 1 Tag“                         | Jahressätze gelten pro echtem Tag. Risikolos 2,25 bis 3,25 % **am Tag** verdoppeln Geld in etwa 30 Tagen, Aktien mit 7 % in 10 Tagen.                      | So lassen und beobachten, denn die Preisleiter der Statussymbole (bis 100 Mio. €) setzt genau dieses Wachstum voraus. Alternative: Zinsen und Dividenden je Quartal durch 4 teilen **und** die Zeitachse der Preise anpassen. Entscheidung vor M1 nötig. **Entschieden: Die Zinssätze bleiben vorerst wie im Prompt.** |
| 2   | Ordergebühr 1 € fix                                                             | Ab Level 5 bedeutungslos.                                                                                                                                  | Anteilige Komponente (Abschnitt 5.3).                                                                                                                                                                                                                                                                                  |
| 3   | 500 XP je Firmenquartal mit Gewinn                                              | Bis 2 000 XP am Tag (mit Alpha-Bonus 4 000), größte XP-Quelle. Seit dem neuen Firmenmodell bekommt sie nur, wer die Firma tatsächlich in den Gewinn führt. | Auf das erste Gewinnquartal je Tag begrenzen oder an Mindestgewinn koppeln. Nicht umgesetzt.                                                                                                                                                                                                                           |
| 4   | Gewinn-XP 1 je 100 €, höchstens 500 je Trade                                    | Ohne Tagesgrenze, mit großem Depot bis 15 000 XP am Tag möglich.                                                                                           | Tagesgrenze, etwa 1 500 XP.                                                                                                                                                                                                                                                                                            |
| 5   | Level 20 und 25                                                                 | Für einen Test mit 4 Freunden spät (2,5 bis 11 Wochen).                                                                                                    | **Entschieden:** `xpMultiplier` = 2 für die Alpha (Abschnitt 3).                                                                                                                                                                                                                                                       |
| 6   | Insolvenz nach 2 Quartalen                                                      | 2 Quartale sind 12 echte Stunden. Wer schläft, kann morgens insolvent sein.                                                                                | **Umgesetzt:** Schonfrist von 4 Quartalen (24 Stunden) nach dem ersten Abschluss im Minus (`company.insolvency.graceQuarters`). Der Wert 2 aus dem Prompt ist damit ersetzt.                                                                                                                                           |
| 7   | Attraktivitätsformel                                                            | Größenunabhängig: Eine winzige Firma stand nie im Wettbewerb und setzte Höchstpreise.                                                                      | **Umgesetzt:** ein Markt je Firmenstufe mit etablierten Anbietern (Abschnitt 4.1). Das Preisband als Balancing-Regel ist entfallen.                                                                                                                                                                                    |
| 8   | Preisexponent 1,5 für alle Branchen                                             | „Einzelhandel: kleine Margen, Preiskriege“ entstand so nicht, und im Einzelhandel gewann der Höchstpreis.                                                  | **Umgesetzt:** Exponent je Branche (Einzelhandel 2,5, Logistik 2,0, Energie 1,5, Tech 1,2, Pharma 1,0), Referenzpreis als gewinnmaximaler Preis (Abschnitt 4.2). Bitte bestätigen, da es vom Wert im Prompt abweicht.                                                                                                  |
| 9   | Pharma-Studien ±50 bis 70 %                                                     | Gilt laut Prompt für alle Pharmafirmen. Ein Bluechip, der an einem Ereignis 60 % verliert, zieht den NEXA 30 um mehrere Prozent.                           | Bewegung nach Größe staffeln (Bluechip ±15 bis 25 %, Mittelständler ±30 bis 45 %, Pennystock ±50 bis 70 %). Nicht umgesetzt.                                                                                                                                                                                           |
| 10  | Anleiherendite „2 bis 4 %“                                                      | Als harte Grenze umgesetzt. Über 4,75 % Leitzins reagieren Anleihen nicht mehr auf Zinsentscheide.                                                         | Akzeptieren (begrenzt den Gegeneffekt in 5.2) oder Korridor an den Leitzins hängen.                                                                                                                                                                                                                                    |
| 11  | Kleinunternehmen ohne Kreditrahmen, aber „Kleinkredit bis 50 000 € ab Level 15“ | Unklar, ob Privat- oder Firmenkredit.                                                                                                                      | Umgesetzt als Kreditrahmen der Firma nach Level des Gründers. Privatkredite gibt es nicht.                                                                                                                                                                                                                             |
| 12  | AG vor IPO: 100 Mitarbeiter                                                     | Keine Angabe für die Zeit nach dem IPO.                                                                                                                    | **Bestätigt:** Stufe „börsennotiert“ mit 1 000 Mitarbeitern, 120 000 € Fixkosten und dem internationalen Markt.                                                                                                                                                                                                        |
| 13  | Jobgehalt passiv, 12 h am Tag                                                   | Kein Unterschied zwischen aktiven und passiven Spielern beim Einkommen. C-Level bringt 30 000 € am Tag ohne Zutun.                                         | Gewollt (Offline-Fortschritt). Falls zu passiv: Teil des Gehalts an erledigte Arbeitsaufgaben koppeln.                                                                                                                                                                                                                 |
| 14  | Hebelkosten „über Nacht“                                                        | Mit Abrechnung zu einem Stichtag wäre Hebel tagsüber gratis.                                                                                               | Umgesetzt als sekundengenauer Auflauf. 10× kostet 2,6 % des Eigenkapitals je Stunde.                                                                                                                                                                                                                                   |
| 15  | Steuerprüfung −3 % Cash                                                         | Trifft nur, wer Cash hält.                                                                                                                                 | Auf das Gesamtvermögen beziehen oder so lassen (Anreiz zu investieren).                                                                                                                                                                                                                                                |

---

## 7. Risiken und Telemetrie für den Freundestest

| Risiko                                     | Woran man es erkennt                                                   | Kennzahl                                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Geld wächst zu schnell**                 | Statussymbole und Gründungen werden beiläufig                          | Geldmenge und Vermögen je Spieler pro Tag; Flüsse der Systemkonten je Quartal; Verhältnis Senken zu Quellen (Ziel: über 20 %) |
| **Risikoloser Zinseszins schlägt Spielen** | Spieler parken alles in Anleihen                                       | Anteil Anleihen am Vermögen; Rendite je Spieler nach Anlageklasse                                                             |
| **Zocken lohnt sich im Mittel**            | Hebel- und Pennystock-Spieler führen die Liga dauerhaft an             | Tagesrendite je Spieler gegen Umschlag, Hebelnutzung und Pennystock-Anteil; Anteil liquidierter Positionen                    |
| **Analyse lohnt sich nicht**               | Kaufen unter fairem Wert bringt nichts                                 | Rendite von Käufen nach Abstand zum fairen Wert (intern auswertbar); Zeit bis zum Schließen einer Lücke                       |
| **Kurse wirken tot oder chaotisch**        | Flache Charts oder ständige Sprünge                                    | Tagesvolatilität je Größenklasse (Ziel 5 / 13 / 40 %); Abstand Kurs zu fairem Wert; Anteil der Ticks am Circuit Breaker       |
| **Markt lässt sich bewegen**               | Ein Spieler treibt einen Pennystock und verkauft teuer an Freunde      | Preis-Impact je Spieler und Aktie; Gewinn aus eigenen Orderfolgen; Handel zwischen Freunden neben dem Marktpreis              |
| **Trendfolger schaukeln sich auf**         | Kurse laufen ohne Nachricht weg                                        | Schleifenverstärkung aus der Konfiguration (Test); Autokorrelation der Tick-Renditen                                          |
| **Unternehmen zu lukrativ oder unmöglich** | Alle gründen sofort oder niemand überlebt                              | Gewinn je Quartal und Stufe gegen die Werte aus Abschnitt 4.7; Amortisationsquartal; Anteil insolventer Firmen; Auslastung    |
| **Preise kleben an einer Grenze**          | Spielerfirmen stehen dauerhaft bei 300 % oder 25 % des Referenzpreises | Verteilung der Preise relativ zum Referenzpreis je Markt; Attraktivitätsanteil gegen tatsächlichen Anteil                     |
| **Ein Markt ist zu eng oder zu weit**      | Jede Firma eines Markts macht Verlust, oder jede Gewinn                | Zahl der Spielerfirmen je Branche und Markt; Anteil der etablierten Anbieter am Umsatz; Gewinn je Firma gegen Rang im Markt   |
| **KI-Firmen kippen**                       | Ein Bluechip wird insolvent oder wächst endlos                         | Marge, Cash und Marktanteil der 15 KI-Firmen je Quartal; Qualität (läuft sie bei allen gegen denselben Wert?)                 |
| **XP zu schnell oder zu langsam**          | Level 10 am zweiten Tag oder Frust vor Level 20                        | XP je Tag und Quelle je Spieler; Tage bis Level 5, 10, 15, 20                                                                 |
| **Passive XP dominieren**                  | Level steigen ohne Spielzeit                                           | Anteil von Arbeitsstunden und Firmenquartalen an den XP                                                                       |
| **Schonfrist wird nicht bemerkt**          | Firma weg, obwohl 24 Stunden Zeit war                                  | Zeit zwischen erstem Abschluss im Minus und Reaktion des Gründers; Anteil der Insolvenzen ohne jede Aktion in der Schonfrist  |
| **Zentralbank überdreht**                  | Leitzins läuft an eine Grenze                                          | Leitzins und gemessenes Geldmengenwachstum je Entscheidung                                                                    |
| **Pharma-Sprünge verzerren den Index**     | NEXA 30 springt um mehrere Prozent                                     | Indexbewegung an Studientagen; Gewicht der Pharma-Bluechips                                                                   |
| **Nachbörslicher Handel wird ausgenutzt**  | Große Orders nachts, Rückkauf am Morgen                                | Spielerumsatz und Impact nach Sitzung; Gewinn aus Positionen über die Börsenöffnung                                           |
| **Steuer-Asymmetrie frustriert**           | Spieler mit Verlusten fühlen sich bestraft                             | Größe der Verlusttöpfe; gezahlte Steuer je Spieler                                                                            |

**Mindest-Telemetrie ab M1/M2:** eine Tabelle mit Tageswerten je Spieler (Vermögen, Cash, XP nach Quelle,
Umschlag, gezahlte Gebühren und Steuern, Hebel) und eine mit Quartalswerten der Wirtschaft (Flüsse der
Systemkonten, Geldmenge, Leitzins, Volatilität und Abstand zum fairen Wert je Aktie). Beide sind reine
Auswertungen des Ledgers und der Tick-Tabellen.

**Offene Kalibrierung**, die nur mit Simulationsläufen über Wochen zu klären ist: Anfangswerte der 15 KI-Firmen
(Aktienzahl, Streubesitz, Startkurs passend zum fairen Wert), Stärke der Sentiment-Schocks, Qualitätsmodell
(aktuell laufen die KI-Firmen einer Branche langfristig auf dieselbe Qualität zu), Wirkung der Abteilungen
Marketing und Finanzen.

---

## 8. Regeln in Spielersprache

Vorlagen für die Hilfetexte im Spiel. Jede Regel hat (a) einen Text, wie er in der Oberfläche stehen kann,
(b) die Stelle, an der der Spieler sie sieht, und (c) die Konfigurationsschlüssel dahinter. **Jede Zahl in den
Texten ist aus `balance.ts` berechnet**; die Rechnung steht dabei, damit die Texte bei geänderten Werten
nachgezogen werden können. Beispiele nennen Tech oder Einzelhandel, die Regel gilt für alle Branchen.

### 8.1 Wie eine Firma Geld verdient

**Kunden**

- (a) „Deine Firma teilt sich die Kunden ihres Markts mit allen anderen Anbietern. Im lokalen Tech-Markt geben
  die Kunden rund 54.000 € im Quartal aus; holst du ein Viertel davon, sind das 13.500 € Umsatz.“
- (b) Unternehmen → Dashboard, Kachel „Marktanteil“ (eigener Anteil, Anteil der Konkurrenz, Marktgröße);
  Quartalsbericht, Zeile „Umsatz“.
- (c) `sectors.tech.baseDemandCentsPerQuarter` × `company.segments.local.demandShare`
  (30 Mio. € × 0,18 % = 54.000 €); Formel `company.attractiveness`.

**Preis**

- (a) „Kunden vergleichen: Wer bei gleicher Qualität teurer ist als die anderen, verliert Kunden. Im Einzelhandel
  schauen sie sehr genau auf den Preis: Beim doppelten Preis bleibt dir nur etwa ein Sechstel deiner
  Anziehungskraft. In der Pharmabranche ist es die Hälfte.“
- (b) Preisregler in den Quartalsentscheidungen, mit Vorschau „erwarteter Marktanteil“ und Markierung des
  Marktpreises; Quartalsbericht, Zeile „Preis im Vergleich zum Markt“.
- (c) `sectors.*.priceExponent` (Einzelhandel 2,5: 2^2,5 = 5,7; Pharma 1,0: 2^1 = 2);
  `sectors.*.costStructure.referencePriceCents`; Reglergrenzen `company.priceBand` (25 % bis 300 %).

**Qualität**

- (a) „Bessere Produkte ziehen mehr Kunden an. Qualität kommt von deinen Entwicklern, und sie veraltet: In der
  Tech-Branche verliert ein Produkt mit Qualität 50 ohne Entwickler 5 Punkte im Quartal. Je größer deine Firma
  wird, desto mehr Entwickler brauchst du für dieselbe Qualität.“
- (b) Dashboard, Kachel „Qualität“ mit Pfeil (steigt/fällt) und dem Wert der etablierten Anbieter;
  Abteilung Entwicklung.
- (c) `sectors.tech.costStructure.qualityAdjustmentRate` (10 % von 50 = 5 Punkte), `developmentIntensity`;
  `company.quality.*`; `company.segments.*.incumbentQuality` (lokal 40).

**Bekanntheit**

- (a) „Nur wer dich kennt, kann bei dir kaufen. Ohne Werbung vergessen dich die Kunden: Jedes Quartal verlierst
  du ein Zehntel deiner Bekanntheit. Mehr Budget hilft, aber immer weniger: Das doppelte Budget bringt nur etwa
  40 % mehr.“
- (b) Marketing-Regler in den Quartalsentscheidungen mit Vorschau der Bekanntheit; Dashboard, Kachel
  „Bekanntheit“; Quartalsbericht, Zeile „Marketing“.
- (c) `company.marketing.awarenessDecayPerQuarter` (10 %), `diminishingReturnsExponent` (log2 von 1,4),
  `referenceBudgetShareOfSegmentDemand`, `gainAtReferenceBudget`, `initialAwareness` (8 %).

**Kapazität**

- (a) „Du kannst nur verkaufen, was deine Produktion schafft. Ein Tech-Mitarbeiter mit Skill 5 stellt rund
  97 Stück im Quartal her. Neue Mitarbeiter brauchen zwei Quartale Einarbeitung: erst 40 %, dann 70 % der vollen
  Leistung.“
- (b) Dashboard, Kachel „Auslastung“ (verkauft / möglich); Mitarbeiterliste mit Einarbeitungsbalken.
- (c) `employees.skillCapacityExponent` (5^1,1 = 5,87 Punkte) × `sectors.tech.costStructure.capacityUnitsPerSkillPoint`
  (16,5) = 96,9 Stück; `company.onboardingRamp` (0,4 und 0,7).

**Abteilungen**

- (a) „Produktion stellt her, Entwicklung hält die Qualität, Vertrieb gewinnt Kunden. Marketing-Mitarbeiter
  machen jeden Werbe-Euro wirksamer (bis doppelt so wirksam), Finanz-Mitarbeiter drücken die Fixkosten um bis zu
  30 %. Die letzten beiden lohnen sich erst bei größeren Firmen.“
- (b) Unternehmen → Abteilungen, je Abteilung eine Zeile „Wirkung dieses Quartal“.
- (c) `company.sales.*`, `company.marketing.departmentMaxBoost` (1 = +100 %),
  `company.finance.maxFixedCostReduction` (0,3).

### 8.2 Warum eine Firma scheitern kann

- (a) „Gehälter und Fixkosten laufen jedes Quartal, ob Kunden kommen oder nicht. Ein Kleinunternehmen mit drei
  Mitarbeitern kostet rund 6.500 € im Quartal. Wer nichts tut, wird vergessen, sein Produkt veraltet, und die
  Kasse läuft leer.“
- (b) Dashboard, Kachel „Burn-Rate“ (Kosten je Quartal und Quartale, die die Kasse noch reicht);
  Quartalsbericht, Block „Kosten“.
- (c) `company.tiers[small_business].fixedCostCentsPerQuarter` (2.000 €) + 3 × Gehalt Skill 5
  (`employees.salaryBaseCentsPerQuarter` × 5^1,3 = 1.499 €) = 6.497 €, im Einzelhandel
  (`fixedCostMultiplier` 1,0).

Dazu vier kurze Warnhinweise für Tooltips, jeder belegt durch die Szenarien in Abschnitt 4:

| Fehler             | Text                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Nichts tun         | „Ohne Werbung und Entwicklung verliert deine Firma jedes Quartal Kunden.“                       |
| Zu teuer           | „Ein hoher Preis bringt nur etwas, wenn Qualität und Bekanntheit ihn tragen.“                   |
| Zu billig          | „Wer knapp über den eigenen Kosten verkauft, gewinnt Kunden, aber kein Geld für Fixkosten.“     |
| Zu schnell wachsen | „Neue Mitarbeiter kosten sofort das volle Gehalt, leisten aber erst nach zwei Quartalen alles.“ |

### 8.3 Märkte

- (a) „Jede Firmenstufe hat ihren eigenen Markt: Kleinunternehmen verkaufen lokal, GmbHs regional, AGs national
  und börsennotierte Firmen international gegen die großen Konzerne. In jedem Markt gibt es schon etablierte
  Anbieter. Lokale, regionale und nationale Märkte wachsen nicht von selbst: Wer größer werden will, muss die
  nächste Stufe gründen.“
- Zahlenbeispiel: „Der regionale Tech-Markt ist mit 180.000 € im Quartal gut dreimal so groß wie der lokale
  (54.000 €). Deine Kunden nimmst du mit: 30 % Bekanntheit im lokalen Markt sind 9 % im regionalen.“
- (b) Unternehmen → Dashboard, Kopfzeile „Markt: lokal · Tech“; Marktanteils-Diagramm mit den Balken „Du“,
  „andere Spielerfirmen“, „etablierte Anbieter“; Umwandlungsdialog mit Vorschau der neuen Bekanntheit.
- (c) `company.segments.{local,regional,national,international}`: `tier`, `demandShare`
  (0,18 % / 0,6 % / 2,2 % / 100 %), `growsWithSector`, `incumbentQuality`, `incumbentAwareness`;
  Umrechnung 30 % × 0,18 / 0,6 = 9 %.

### 8.4 Körperschaftsteuer

- (a) „Auf den Gewinn deiner Firma zahlst du jedes Quartal 15 % Steuer. Bei 2.000 € Gewinn sind das 300 €.
  Macht die Firma Verlust, zahlt sie nichts.“
- (b) Quartalsbericht, Zeile „Körperschaftsteuer“ zwischen „Gewinn vor Steuern“ und „Gewinn“.
- (c) `company.corporateTaxBps` (1500).

### 8.5 Steuer auf Kursgewinne, Dividenden und Zinsen

- (a) „Von jedem realisierten Kursgewinn gehen 25 % an den Staat: Bei 1.000 € Gewinn sind das 250 €. Verluste
  merkt sich dein Verlusttopf und verrechnet sie mit späteren Gewinnen: Hast du vorher 400 € verloren, zahlst du
  nur auf 600 € Steuer, also 150 €. Erstattet wird nichts.“
- (a) Dividenden und Zinsen: „Auch von Dividenden und Anleihezinsen behält der Staat 25 % ein: Von 100 €
  Dividende kommen 75 € bei dir an. Der Verlusttopf gilt hier nicht.“
- (b) Order-Maske beim Verkauf („voraussichtliche Steuer“); Handelshistorie, Spalte „Steuer“; Portfolio, Kachel
  „Verlusttopf“; Dividenden- und Kupongutschrift als zwei Zeilen (brutto, Steuer).
- (c) `trading.capitalGainsTaxBps` (2500), `trading.incomeTaxOnCouponsAndDividendsBps` (2500).

### 8.6 Firmenstufen

- (a) „Es gibt vier Stufen. Jede höhere erlaubt mehr Mitarbeiter und öffnet einen größeren Markt, kostet aber
  mehr Fixkosten.“

| Stufe            | ab Level                | Gründung  | Fixkosten je Quartal | Mitarbeiter                | Markt         |
| ---------------- | ----------------------- | --------- | -------------------- | -------------------------- | ------------- |
| Kleinunternehmen | 10                      | 15.000 €  | 2.000 €              | bis 5 (ab Level 18 bis 20) | lokal         |
| GmbH             | 20                      | 75.000 €  | 10.000 €             | bis 20                     | regional      |
| AG               | 25                      | 300.000 € | 40.000 €             | bis 100                    | national      |
| Börsennotiert    | 25, nach dem Börsengang | –         | 120.000 €            | bis 1.000                  | international |

- (a) Umwandlung: „Du kannst deine Firma in die nächste Stufe umwandeln. Das kostet 60 % der Gründungskosten der
  neuen Stufe, für eine GmbH also 45.000 €. Team, Qualität und Kunden behältst du.“
- (a) Börsennotiert: „Nach dem Börsengang gehört deine Firma auch ihren Aktionären. Sie darf bis zu
  1.000 Mitarbeiter haben und tritt im internationalen Markt gegen die großen KI-Konzerne an. Privates Geld
  kannst du dann nicht mehr einschießen, nur noch über eine Kapitalerhöhung.“
- (a) Fixkosten: „Die Fixkosten hängen auch von der Branche ab: In der Energiebranche sind sie 40 % höher, in
  Tech 30 % niedriger.“
- (b) Gründungsassistent, Schritt „Rechtsform“ (Vergleichstabelle); Dashboard, Kachel „Nächste Stufe“;
  IPO-Checkliste.
- (c) `company.tiers[*]`, `company.smallBusinessExpansion`, `company.conversionFeeBps` (6000: 75.000 € × 60 %),
  `company.founderCapital`, `sectors.*.costStructure.fixedCostMultiplier` (Energie 1,4, Tech 0,7).

### 8.7 Insolvenz und Schonfrist

- (a) „Ist die Kasse deiner Firma am Quartalsende im Minus, beginnt eine Schonfrist von 4 Quartalen, das sind
  24 Stunden. Bringst du die Kasse in dieser Zeit wieder ins Plus (Kosten senken, Geld einschießen, Kredit), ist
  alles gut. Ist sie beim vierten Abschluss danach immer noch im Minus, ist die Firma insolvent.“
- (a) Kosten der Schonfrist: „Solange die Kasse im Minus ist, zahlst du Überziehungszinsen: beim aktuellen
  Leitzins 13 % im Jahr, also 32,50 € je Quartal auf 1.000 € Minus.“
- (a) Folgen: „Bei einer Insolvenz ist die Firma weg, deine Reputation sinkt um 30 Punkte, und du darfst
  3 Tage lang keine neue Firma gründen.“
- (b) Roter Balken auf dem Unternehmens-Dashboard mit Countdown („noch 3 Quartalsabschlüsse“);
  Benachrichtigung beim ersten Abschluss im Minus und vor dem letzten (Pflicht, einzeln nicht abschaltbar);
  Quartalsbericht, Zeile „Kasse“ mit Warnzeichen.
- (c) `company.insolvency.graceQuarters` (4), `overdraftSpreadBps` (1000) + `centralBank.startRateBps` (300)
  = 13 % pro Spieljahr, geteilt durch 4 Quartale = 3,25 %; `reputation.deltas.insolvency` (−30);
  `company.insolvency.foundingLockoutGameDays` (3). Im Quartalsbericht der Simulation:
  `uncoveredQuarters`, `graceQuartersLeft`.

### 8.8 XP-Bonus der Alpha

- (a) „Während der Alpha zählen alle Erfahrungspunkte doppelt: Eine Arbeitsstunde bringt 80 statt 40 XP. So
  kommst du in der Testphase schneller an alle Funktionen.“
- (b) Profil, neben dem XP-Balken ein Abzeichen „Alpha ×2“; jede XP-Einblendung zeigt den verdoppelten Wert.
- (c) `progression.xpMultiplier` (2) × `progression.xpSources.workHour.xp` (40). Angewendet wird der Faktor genau
  einmal beim Gutschreiben (`scaledXp()` in `src/lib/sim/progression.ts`).

## Nachtrag M1: Kalibrierung der Kursbewegung

Der Datenbank-Tick wurde über einen simulierten Tag (17 280 Ticks) eingestellt. Mit den Rauschwerten aus
`aiInvestors.tickNoiseBps` allein schwankten Blue Chips um 8 bis 15 % am Tag. Der Faktor
`aiInvestors.tickNoiseScale = 0.2` bringt die Tagesspannen auf:

| Klasse      | Tagesspanne im Mittel | Einzelwerte   | Größte Entfernung zum fairen Wert |
| ----------- | --------------------- | ------------- | --------------------------------- |
| Blue Chips  | 2,6 bis 3,1 %         | 1,6 bis 5,0 % | unter 3 %                         |
| Mittelstand | 6 bis 7 %             | 3,5 bis 9,1 % | unter 7 %                         |
| Pennystocks | 16 bis 19 %           | 10 bis 25 %   | unter 14 %                        |
| NEXA 30     | 0,9 bis 1,8 %         |               |                                   |

Der Faktor gilt in der TypeScript-Simulation (`src/lib/sim/tick.ts`) und im Datenbank-Tick gleichermaßen.
Weitere seit M1 genutzte Schlüssel: `trading.maxOrderQuantity`, `progression.xpSources.trade.minOrderValueCents`,
`economy.vaultMinClaimCents`, `company.aiPolicy.revenueNoisePersistence`, `company.aiPolicy.costNoiseShare`,
`valuation.lossMakerRevenueElasticity`.
