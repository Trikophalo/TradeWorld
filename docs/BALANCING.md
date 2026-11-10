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

---

## 1. Startwerte

### 1.1 Zeit (`time`)

| Wert | Start |
|---|---|
| Quartal | 6 Stunden, 4 Quartale = 1 Spieljahr = 1 Tag |
| Quartalsgrenzen | 08:00, 14:00, 20:00, 02:00 Uhr (Europe/Berlin) |
| Börsenzeit | 08:00 bis 22:00 Uhr |
| Tick | 5 Sekunden, 12 Ticks je Runner-Aufruf |
| Nachbörslich | Spread ×3, Liquidität ×0,25, Rauschen ×0,5 |
| Kerzen | 1 min, 5 min, 1 h, dazu Quartal und Spieljahr |
| Eröffnungsbonus | erste 60 Minuten, XP ×1,5 |

### 1.2 Grundversorgung (`economy`)

| Wert | Start |
|---|---|
| Startkapital | 10 000 € |
| Wiedereinstieg nach Bankrott | 2 500 €, Status „Pleitegeier“ 3 Tage, Reputation −10 |
| Grundeinkommen | 100 € pro Stunde |
| Tresor | fasst 8 Stunden = 800 € |

### 1.3 Handel (`trading`)

| Wert | Start |
|---|---|
| Ordergebühr | 1 € fix |
| Steuer auf realisierte Gewinne | 25 %, mit Verlusttopf |
| Steuer auf Kupons und Dividenden | 25 % (Annahme, im Prompt nicht geregelt) |
| Halber Spread | Bluechip 5 bp, Mittelständler 15 bp, Pennystock 60 bp; bis +20 bp bei extremem Sentiment |
| Preis-Impact | 1 % je „Tiefe“, eine Tiefe = 0,2 % des Streubesitzes, linear |
| Sofortanteil / Hedge des Marktmachers | 50 % / 50 % |
| Höchster Impact je Order | 15 % (Rest wird nicht ausgeführt) |
| Orderbuch | 10 Stufen je Seite, Abstand 10 bp |
| Finanzierung bei Hebel | Leitzins + 4 % pro Spieljahr auf den Kredit, sekundengenau |
| Leihgebühr bei Shorts | 1 % / 3 % / 10 % pro Spieljahr (Bluechip / Mittelständler / Pennystock) |
| Hebel nach Level | ab 1: 1×, ab 12: 2×, ab 18: 5×, ab 30: 10× |
| Leerverkäufe | ab Level 8 |
| Wartungsmarge / Warnschwelle | 5 % / 7,5 % |
| Liquidationsgebühr | 0,5 % |
| Wash-Trade-Fenster | 300 Sekunden |
| Mindestkurs / größte reguläre Tick-Bewegung | 0,0001 € / 3 % |

### 1.4 Zentralbank und Anleihen (`centralBank`, `bonds`)

| Wert | Start |
|---|---|
| Leitzins | 3 %, neutral 3 %, Grenzen 0,5 % bis 10 % |
| Schritt | 25 bp, höchstens 2 Schritte je Entscheidung |
| Ziel Geldmengenwachstum | 8 % pro Spieljahr und aktivem Spieler, Toleranzband 4 % |
| Takt | alle 4 Quartale, 1 Quartal vorher angekündigt, Messfenster 4 Quartale |
| Anlaufphase | 56 Quartale (14 Tage) ohne Entscheidung |
| Aktiver Spieler | Login in den letzten 7 Tagen |
| Anleihen | Nennwert 100 €, Kupon je Quartal, ab Level 5 |
| Rendite | Leitzins + Aufschlag, begrenzt auf 2 % bis 4 % |
| Aufschläge | 1 Jahr −75 bp, 2 Jahre −50 bp, 5 Jahre −10 bp, 10 Jahre +25 bp |
| Renditen beim Start | 2,25 % / 2,50 % / 2,90 % / 3,25 % |

### 1.5 Branchen (`sectors`)

| Branche | Nachfrage je Quartal | Wachstum je Spieljahr | KGV | Volatilität | Referenzpreis | Stückkosten | Stück je Skillpunkt | Fixkostenfaktor | Qualitätsverfall je Quartal |
|---|---|---|---|---|---|---|---|---|---|
| Tech | 30 Mio. € | 8 % | 28 | 1,2 | 50 € | 15 € | 17 | 0,6 | 3 |
| Einzelhandel | 60 Mio. € | 2 % | 14 | 0,8 | 20 € | 14 € | 100 | 1,0 | 0,5 |
| Energie | 50 Mio. € | 1,5 % | 11 | 1,0 | 80 € | 48 € | 22 | 2,0 | 0,5 |
| Pharma | 25 Mio. € | 5 % | 22 | 1,4 | 120 € | 36 € | 8 | 1,5 | 1,5 |
| Logistik | 35 Mio. € | 3 % | 15 | 0,9 | 30 € | 19,50 € | 60 | 1,2 | 1 |

Empfindlichkeiten:

| Branche | Öl → Nachfrage | Öl → Kosten | Zins je +100 bp | Konjunktur | Zins → Bewertung |
|---|---|---|---|---|---|
| Tech | 0 | 0 | −3 % | 0,8 | 1,5 |
| Einzelhandel | −0,05 | 0,1 | −1 % | 0,5 | 0,8 |
| Energie | 0,8 | 0,3 | −1 % | 0,6 | 1,0 |
| Pharma | 0 | 0 | −1 % | 0,1 | 1,2 |
| Logistik | 0 | 0,5 | −2 % | 1,2 | 1,0 |

Die Stückzahl je Skillpunkt ist so gewählt, dass ein Produktionspunkt zum Referenzpreis in jeder Branche etwa
600 bis 700 € Rohertrag je Quartal bringt. Daraus ergeben sich in Testläufen diese Nettomargen der KI-Firmen:
Tech 17 bis 27 %, Pharma 20 bis 30 %, Energie 10 bis 17 %, Logistik 5 bis 13 %, Einzelhandel 5 bis 10 %.

### 1.6 Unternehmen (`company`)

| Wert | Start |
|---|---|
| Attraktivität | `quality^1.2 × awareness^0.8 / price^1.5` |
| Marketing-Exponent | 0,4854 = log2(1,4): doppeltes Budget → +40 % Bekanntheitsgewinn |
| Referenzbudget | 1 % der Basisnachfrage der Branche, bringt 0,5 Prozentpunkte Bekanntheit je Quartal |
| Bekanntheit | Start 0,02 %, Verfall 2 % je Quartal, höchster Gewinn 3 Punkte je Quartal |
| Qualität | Start 30, Skala 1 bis 100, höchster Gewinn 10 je Quartal, halbe Wirkung bei 15 Entwicklungs-Skillpunkten |
| Vertrieb | +1 % Attraktivität je Skillpunkt, höchstens +50 % |
| Einarbeitung | 40 % im ersten, 70 % im zweiten Quartal, danach 100 % |
| Preisband | von 40 % des Referenzpreises bis Stückkosten + 1,5 × Referenzmarge |
| Körperschaftsteuer | 15 % auf positiven Quartalsgewinn (Annahme, im Prompt nicht geregelt) |
| Insolvenz | nach 2 nicht gedeckten Quartalen; Überziehung zu Leitzins + 10 %; Kurssturz −90 %; Sperre 3 Spieltage |
| Marketingbudget | höchstens 50 % des Cash |
| Umwandlung | 60 % der Gründungskosten der Zielstufe |
| Privates Kapital | bei Gründung höchstens 2× Gründungskosten, im Wachstum 1× je Spieljahr, nach dem IPO 0 |

Firmenstufen (Prompt 6.4; die letzte Zeile ist eine Annahme, der Prompt nennt keine Grenzen nach dem IPO):

| Stufe | Level | Gründungskosten | Fixkosten je Quartal | Mitarbeiter | Kreditrahmen |
|---|---|---|---|---|---|
| Kleinunternehmen | 10 | 15 000 € | 2 000 € | 5 (ab Level 18: 20) | – |
| GmbH | 20 | 75 000 € | 10 000 € | 20 | 250 000 € |
| AG vor IPO | 25 | 300 000 € | 40 000 € | 100 | 2 Mio. € |
| börsennotiert | 25 | – | 120 000 € | 1 000 | 10 Mio. € |

Die Fixkosten werden mit dem Fixkostenfaktor der Branche multipliziert.

### 1.7 IPO, Reputation, Kredite (`ipo`, `reputation`, `loans`)

| Wert | Start |
|---|---|
| IPO-Voraussetzungen | Level 25, 4 Quartale Historie, 1 Mio. € Umsatz in 4 Quartalen, Reputation ≥ 50, CFO |
| Streubesitz | 15 % bis 60 % |
| Preisspanne | fairer Wert −10 %, ±15 % |
| Zeichnung | 1 Quartal; geplatzt unter 100 % Deckung; oberes Ende ab 200 % |
| Lock-up | 4 Quartale |
| Reputation | Start 50, Skala 0 bis 100, Bewertungsfaktor 0,6 bis 1,4 |
| Guidance | eingehalten bis 10 % Abweichung, verfehlt über 30 % |
| Reputationspunkte | siehe Tabelle in [SIMULATION.md](./SIMULATION.md#20-reputation) |
| Risikoaufschlag | 150 bp + 4 bp je fehlendem Reputationspunkt + 150 bp je 1,0 Schulden/Eigenkapital (höchstens 600) + 200 bp bei Verlust − bis 100 bp bei guter Zinsdeckung − 10 bp je CFO-Skill; gesamt 50 bis 1 500 bp |
| Kreditrahmen nach Level | ab 15: 50 000 €, ab 20: 250 000 €, ab 25: 2 Mio. €; mal 0,5 bis 1,5 nach Reputation |

### 1.8 Mitarbeiter und Karriere (`employees`, `careers`)

| Wert | Start |
|---|---|
| Skill | 1 bis 10; Kapazitätspunkte = Skill^1,1 |
| Gehalt je Quartal | 185 € × Skill^1,3 (Skill 1: 185 €, Skill 5: 1 499 €, Skill 10: 3 691 €) |
| Echter Spieler | doppelte Produktivität |
| Loyalität | Start 70, Kündigung unter 25, −3 je Quartal ohne Gehaltserhöhung, Abwerben ab +20 % Gehalt |
| Führung | COO +1,5 % Kapazität, Vertriebsleitung +2 % Attraktivität, CFO −10 bp Zins, CTO −3 % Entwicklungszeit (je Skill) |
| Bewerberpool | 6 je Quartal |
| Insider | Sperrfenster 2 Stunden, Entdeckung 60 %, Strafe 150 % des Gewinns |
| Optionen | Vesting über 4 Quartale; höchstens 1 Nebenrolle |

| Eigenschaft | Leistung | Gehalt | Loyalitätsverlust |
|---|---|---|---|
| `ambitious` | ×1,15 | ×1,0 | ×2,0 |
| `loyal` | ×1,0 | ×1,0 | ×0,5 |
| `frugal` | ×1,0 | ×0,9 | ×1,0 |
| `genius` | ×1,25 | ×1,3 | ×1,2 |
| `easygoing` | ×0,92 | ×0,95 | ×0,7 |
| `mentor` | ×1,05 | ×1,1 | ×0,8 |

| Jobstufe | ab Level | Gehalt je Stunde | je Tag bei 12 h |
|---|---|---|---|
| Praktikant | 2 | 150 € | 1 800 € |
| Junior | 5 | 300 € | 3 600 € |
| Senior | 12 | 700 € | 8 400 € |
| Teamleitung | 20 | 1 300 € | 15 600 € |
| C-Level | 25 | 2 500 € + Optionen | 30 000 € |

Beförderungen nach 24 / 72 / 168 / 336 Erfahrungsstunden mit +10 / +12,5 / +15 / +20 % (zusammen ×1,71).
Gehaltsverhandlung einmal je Woche: Erfolgschance 30 % plus 0,2 Punkte je Erfahrungsstunde (höchstens 85 %),
+5 bis +12 %. Jobwechsel +15 bis +30 %. Arbeitsaufgabe alle 3 Stunden, Bonus bis zu einem Stundengehalt.

### 1.9 Level (`progression`)

`XP für Level n → n+1 = round(100 × n^1.5)`, höchstens Level 50, globaler Faktor `xpMultiplier` = 1.

| Quelle | XP | Grenze |
|---|---|---|
| Trade | 10 | 30 je Tag, Wash-Trades zählen nicht |
| Trade mit Gewinn geschlossen | 1 je 100 € Gewinn | 500 je Trade |
| Arbeitsstunde | 40 (×1,5 bei Spielerfirma) | 12 Stunden je Tag |
| Arbeitsaufgabe | 50 bis 150 | – |
| Tägliche Mission | 200 bis 400 | 3 je Tag |
| Login | 50 + 10 je Streak-Tag | Bonus höchstens 200, 1 Streak-Schutz je Woche |
| Firmenquartal mit Gewinn | 500 | – |
| Erfolgreicher IPO | 5 000 | – |
| Erfolg | 100 bis 10 000 | – |

Freischaltungen (`unlocks`, stabile Schlüssel):

| Level | Schlüssel |
|---|---|
| 1 | `market_orders`, `basic_income` |
| 2 | `first_job` |
| 3 | `limit_orders`, `watchlist` |
| 5 | `stop_loss`, `bonds`, `junior_jobs` |
| 7 | `analyst_reports` |
| 8 | `short_selling` |
| 10 | `found_small_business` |
| 12 | `leverage_2x`, `senior_jobs` |
| 15 | `small_loan`, `business_angel` |
| 18 | `leverage_5x`, `expand_small_business` |
| 20 | `found_gmbh`, `loans_250k`, `team_lead_jobs` |
| 25 | `ipo`, `c_level_jobs` |
| 30 | `leverage_10x`, `options` |
| 35 | `takeovers`, `hostile_takeovers` |
| 40 | `holding` |
| 50 | `title_market_legend`, `golden_profile_frame`, `hall_of_fame` |

### 1.10 KI-Investoren, Bewertung, Index (`aiInvestors`, `valuation`, `index`)

| Typ | Anteil am Streubesitz | Reaktionsgeschwindigkeit je Tick | Parameter |
|---|---|---|---|
| Marktmacher | 5 % | 0,5 % des Inventars | – |
| Value-Fonds | 30 % | 0,0167 % | volles Signal bei 50 % Fehlbewertung, Totband 1 % |
| Momentum-Trader | 10 % | 0,02 % | Trendskala 2 % |
| Rentenfonds | 20 % | 0,2 % der Lücke | −5 % Gewicht je +100 bp Leitzins, +3 % je 100 bp Renditevorteil |
| Indexfonds | 4 % | 0,5 % der Lücke | – |
| Kleinanleger | 10 % | 0,12 % | Trendjagd 0,1, Trendskala 2 % |

| Wert | Start |
|---|---|
| Rauschen je Tick | Bluechip 6 bp, Mittelständler 15 bp, Pennystock 45 bp (mal Branchenfaktor) |
| Gleitende Durchschnitte | schnell α 0,15, langsam α 0,0165 |
| Sentiment-Verfall | 0,19 % je Tick (Halbwertszeit etwa 30 Minuten) |
| Wachstumsfaktor | 1 + Umsatzwachstum, 0,6 bis 1,8 |
| Makrofaktor | −4 % je +100 bp Leitzins (mal Branchenfaktor), 0,6 bis 1,3 |
| Untergrenze | 50 % des Buchwerts je Aktie |
| Analystenziele | Rauschen 8 %, in 25 % der Fälle dreifach |
| NEXA 30 | 30 Werte, Start 1 000 Punkte, Prüfung alle 4 Quartale, 1 Quartal Mindestnotierung, Puffer 3 Ränge |

### 1.11 Events, Lebensstil, Zufall, Missbrauch (`events`, `lifestyle`, `randomEvents`, `abuse`)

| Event | Start |
|---|---|
| Pharma-Studie | 12 % je Quartal und Firma, 2 Quartale Vorlauf, Erfolg 60 / 50 / 40 % (Bluechip / Mittel / Penny), ±50 bis 70 % |
| Ölpreis-Report | alle 2 Quartale, Standardabweichung 6 %, 25 % Rückzug zum Normalwert, Index 0,4 bis 2,5 |
| Konjunktur | Rauschen 1 % je Quartal, 10 % Rückzug, Index 0,8 bis 1,2 |
| Gewinnüberraschung | Sentiment = 1,5 × Überraschung, höchstens ±0,6 |
| Branchenkrise | 3 % je Quartal, −15 % Nachfrage, 3 Quartale |
| Rohstoffschock | 4 % je Quartal, Öl ×1,25 oder ÷1,25 |
| Konjunkturdelle | 3 % je Quartal, −8 % Nachfrage, 4 Quartale |
| Tech-Boom | 3 % je Quartal, +20 % Nachfrage, 4 Quartale |
| Zinsentscheid | Sentiment −0,1 je +25 bp |

| Statussymbol | Preis | Unterhalt je Spieljahr | Bonus |
|---|---|---|---|
| Rolex | 25 000 € | 0,5 % = 125 € | – |
| Porsche | 150 000 € | 1 % = 1 500 € | – |
| Penthouse | 1,5 Mio. € | 1 % = 15 000 € | +5 Reputation |
| Privatjet | 20 Mio. € | 1,5 % = 300 000 € | – |
| Insel | 100 Mio. € | 2 % = 2 Mio. € | – |

Wiederverkauf zu 50 % des Preises.

| Zufallsereignis | Wahrscheinlichkeit je Tag | Wirkung |
|---|---|---|
| Erbschaft | 4 % | +5 000 € |
| Steuerprüfung | 4 % | −3 % des Cash |
| Headhunter | 3 % | Angebot mit +30 % Gehalt |
| Golfclub-Tipp | 6 % | stimmt in 60 % der Fälle |

Höchstens ein Ereignis je Spieler und Tag.

| Missbrauchsschutz | Start |
|---|---|
| Rate Limits | 20 Orders je Minute, 500 je Tag, 60 Aktionen je Minute |
| Neue Accounts bei Spieler-IPOs | jünger als 7 Tage oder unter Level 5: höchstens 5 % der Zuteilung und 5 000 € |
| Verdachtsmuster | über 50 % des Volumens zwischen zwei Accounts; Geschäfte über 10 000 € mehr als 10 % neben dem Markt |

---

## 2. Geldfluss: Quellen und Senken

Geld entsteht und verschwindet nur über Systemkonten (ADR-007). Für die Geldmenge zählt, was auf Spieler- und
Spielerfirmenkonten liegt.

| Quelle (Systemkonto → Spieler) | Senke (Spieler → Systemkonto) |
|---|---|
| Startkapital, Grundeinkommen, Boni (`mint`) | Ordergebühren (`fees`) |
| Gehälter von KI-Firmen, Arbeitsaufgaben (`payroll`) | Steuern auf Gewinne, Kupons, Dividenden, Firmengewinne (`taxes`) |
| Kupons und Rückzahlung von Anleihen (`interest`) | Spread, Slippage, Verluste gegen die KI (`market`) |
| Dividenden der KI-Firmen (`market`) | Finanzierungskosten, Leihgebühren, Kreditzinsen (`interest`) |
| Kursgewinne beim Verkauf an die KI (`market`) | Unterhalt und Kauf von Statussymbolen (`upkeep`) |
| Umsatz der Spielerfirmen (Kunden sind die KI-Wirtschaft, `market`) | Gründungs- und Umwandlungskosten, Fixkosten, KI-Gehälter, Produktion, Marketing |
| Erbschaft (`mint`) | Steuerprüfung (`taxes`) |

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

| | L1 Gelegenheit | L1 aktiv | L10 Gelegenheit | L10 aktiv | L25 Gelegenheit | L25 aktiv |
|---|---|---|---|---|---|---|
| Vermögen | 10 000 | 10 000 | 40 000 | 40 000 | 1 000 000 | 2 000 000 |
| **Quellen** | | | | | | |
| Grundeinkommen | 1 600 | 2 400 | 1 600 | 2 400 | 1 600 | 2 400 |
| Job (12 h) | – | – | 3 600 | 3 600 | 30 000 | 30 000 |
| Arbeitsaufgaben | – | – | 420 | 1 200 | 3 500 | 10 000 |
| Depotertrag (7 %, Erwartungswert) | 490 | 700 | 1 960 | 2 800 | 49 000 | 140 000 |
| **Summe Quellen** | **2 090** | **3 100** | **7 580** | **10 000** | **84 100** | **182 400** |
| **Senken** | | | | | | |
| Ordergebühren | 3 | 30 | 3 | 30 | 3 | 30 |
| Spread und Slippage | 3 | 20 | 5 | 80 | 100 | 4 000 |
| Steuern | 60 | 105 | 300 | 500 | 8 300 | 25 000 |
| Unterhalt Statussymbole | – | – | – | – | 1 625 | 16 625 |
| **Summe Senken** | **66** | **155** | **308** | **610** | **10 028** | **45 655** |
| **Netto je Tag** | **+2 024** | **+2 945** | **+7 272** | **+9 390** | **+74 072** | **+136 745** |
| Netto in % des Vermögens | 20 % | 29 % | 18 % | 23 % | 7 % | 7 % |
| Senken in % der Quellen | 3 % | 5 % | 4 % | 6 % | 12 % | 25 % |

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

| | L1 Gelegenheit | L1 aktiv | L10 Gelegenheit | L10 aktiv | L25 Gelegenheit | L25 aktiv |
|---|---|---|---|---|---|---|
| Quellen | 14 600 | 21 700 | 53 100 | 70 000 | 588 700 | 1 276 800 |
| Senken | 460 | 1 090 | 2 160 | 4 270 | 70 200 | 319 600 |
| **Netto** | **+14 200** | **+20 600** | **+50 900** | **+65 700** | **+518 500** | **+957 200** |

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

| Level | 2 | 3 | 5 | 8 | 10 | 12 | 15 | 18 | 20 | 25 | 30 | 40 | 50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| XP gesamt | 100 | 383 | 1 703 | 6 143 | 11 106 | 17 916 | 31 998 | 51 216 | 67 135 | 118 809 | 189 029 | 392 197 | 689 513 |

Geschätzte XP je Tag:

| Quelle | Gelegenheit | aktiv |
|---|---|---|
| Login mit Streak (Mittel der ersten Wochen) | 150 | 200 |
| Missionen (2 bzw. 3 von 3, je 300) | 600 | 900 |
| Trades (5 bzw. 30) | 50 | 300 |
| Gewinn-XP | 10 | 100, spät 1 000 und mehr |
| Arbeitsstunden (12 × 40, passiv) | 480 | 480 (720 bei Spielerfirma) |
| Arbeitsaufgaben (2 bzw. 5, je 100) | 200 | 500 |
| Erfolge (Mittel) | 10 | 100 |
| **Summe ohne Firma** | **etwa 1 500** | **etwa 2 600** |
| Eigene Firma, 4 Gewinnquartale am Tag | +2 000 | +2 000 |
| **Summe mit profitabler Firma (ab Level 10)** | **etwa 3 500** | **etwa 4 750** |

Daraus die Tage bis zum Level:

| Level | Freischaltung | Gelegenheit ohne Firma | Gelegenheit mit Firma | aktiv ohne Firma | aktiv mit Firma |
|---|---|---|---|---|---|
| 2 | Erster Job | erste Sitzung | – | erste Sitzung | – |
| 3 | Limit-Order | Tag 1 | – | Tag 1 | – |
| 5 | Anleihen, Stop-Loss | Tag 2 | – | Tag 1 | – |
| 8 | Leerverkäufe | Tag 5 | – | Tag 3 | – |
| 10 | Kleinunternehmen | Tag 8 | Tag 8 | Tag 5 | Tag 5 |
| 12 | Hebel 2× | Tag 12 | Tag 10 | Tag 7 | Tag 7 |
| 15 | Kleinkredit | Tag 22 | Tag 14 | Tag 13 | Tag 10 |
| 18 | Hebel 5× | Tag 35 | Tag 20 | Tag 20 | Tag 14 |
| 20 | GmbH | Tag 45 | Tag 24 | Tag 26 | Tag 17 |
| 25 | IPO | Tag 80 | Tag 39 | Tag 46 | Tag 28 |
| 30 | Hebel 10×, Optionen | Tag 126 | Tag 59 | Tag 73 | Tag 43 |
| 50 | Börsenlegende | über 1 Jahr | etwa Tag 200 | etwa Tag 265 | etwa Tag 150 |

**Bewertung:**

- **Früh passt es.** Die ersten Freischaltungen kommen in den ersten Minuten und Tagen, Level 10 nach 5 bis
  8 Tagen. Kein Wert aus dem Prompt macht den Einstieg zu langsam oder zu schnell.
- **Spät ist es für einen Freundestest lang.** GmbH nach 2,5 bis 6,5 Wochen, IPO nach 4 bis 11 Wochen. Wer im
  Test den IPO (M6) erleben will, braucht eine Abkürzung. **Vorschlag:** `xpMultiplier` für den Test auf 2 setzen
  (IPO für Aktive nach etwa 2 Wochen) oder die Admin-Zeitvorspulung nutzen. Die Kurve selbst bleibt unverändert.
- **Das Firmenquartal mit Gewinn ist die größte XP-Quelle im Spiel:** bis zu 2 000 XP am Tag, ohne etwas zu tun,
  auch für eine winzige Firma mit 1 € Gewinn. Es entscheidet fast allein, ob Level 25 nach 28 oder 46 Tagen
  erreicht wird. **Vorschlag** (nicht umgesetzt, Wert aus dem Prompt): 500 XP nur für das erste Gewinnquartal
  des Tages, weitere 100; oder an eine Mindestgröße des Gewinns koppeln.
- **Gewinn-XP** ist früh bedeutungslos (10 000 € Depot, 1 XP je 100 € Gewinn) und spät sehr ergiebig (500 XP ab
  50 000 € Gewinn je Trade, bei 2 Mio. € Depot sind das 2,5 % Kursbewegung). Die Grenze von 30 Trades am Tag gilt
  laut Prompt nur für die 10 XP je Trade. **Vorschlag:** Gewinn-XP ebenfalls auf einen Tageswert begrenzen.
- **Arbeits-XP läuft passiv.** 480 XP am Tag ohne Zutun sind ein Drittel der XP eines Gelegenheitsspielers.
  Das ist gewollt (Offline-Fortschritt), sollte aber bekannt sein.

---

## 4. Unternehmen

Werte aus Testläufen von `closeQuarter` über 24 Quartale mit 3 KI-Firmen je Branche und einem frisch gegründeten
Kleinunternehmen (3 Mitarbeiter Produktion, 1 Entwicklung, 1 Vertrieb, alle Skill 5, 1 000 € Marketing je Quartal):

| | Preis = Referenzpreis | Preis am oberen Rand des Preisbands |
|---|---|---|
| Umsatz je Quartal | 15 000 bis 35 000 € | 20 000 bis 50 000 € |
| Gehälter (5 × 1 499 €) | 7 495 € | 7 495 € |
| Fixkosten | 1 200 bis 4 000 € (je Branche) | 1 200 bis 4 000 € |
| Gewinn nach Steuern je Quartal | −3 000 bis +700 € | +2 000 bis +5 300 € |
| Gewinn je Tag | etwa 0 € | 8 000 bis 21 000 € |

- Zum Referenzpreis trägt sich ein Kleinunternehmen gerade so. Gewinn entsteht durch **Preissetzungsmacht**
  (Qualität und Bekanntheit erlauben höhere Preise) und durch Größe.
- Ein gut geführtes Kleinunternehmen bringt etwa das Zwei- bis Fünffache eines Junior-Gehalts (3 600 € am Tag),
  bei 15 000 € Gründungskosten. Der Gewinn liegt in der Firma; die Ausschüttung kostet noch einmal 25 %.
- Wer den Preis nicht anpasst, wenn der Ölpreis steigt, geht in Logistik und Energie binnen weniger Tage
  insolvent. Das ist im Testlauf passiert und gewollt.
- GmbH und AG sind grob das Vier- bzw. Zwanzigfache. Für eine AG mit 100 Mitarbeitern heißt das eine
  Größenordnung von 100 000 € Gewinn je Quartal. Diese Hochrechnung ist nicht simuliert.

### Boutique-Preise: warum es ein Preisband gibt

Die Marktanteilsformel aus dem Prompt ist größenunabhängig. Eine Firma mit 5 Mitarbeitern kann 0,05 % einer
Branche mit 30 Mio. € Nachfrage bedienen. Ihr Anteil nach Attraktivität ist schnell größer, denn wegen des
Marketing-Exponenten von 0,49 kauft ein Hundertstel des Budgets eines Bluechips ein Zehntel von dessen
Bekanntheitsgewinn. Eine ausgelastete Firma erhöht dann rational den Preis, bis die Nachfrage zur Kapazität passt.
Ohne Grenze lag das Optimum im ersten Entwurf beim Drei- bis Sechsfachen des Marktpreises und brachte einem
Kleinunternehmen 20 000 bis 80 000 € Gewinn je Quartal.

Gegenmaßnahmen in den Startwerten:

1. **Preisband** (`company.priceBand`): höchstens Stückkosten + 1,5 × Referenzmarge. Über die Marge statt über
   den Preis definiert, damit Branchen mit hohem Wareneinsatz (Einzelhandel) nicht mehr Spielraum haben als Tech.
2. **Niedrige Startbekanntheit** (0,02 %) und langsamer Aufbau (Verfall nur 2 % je Quartal): Eine neue Firma ist
   anfangs durch Nachfrage begrenzt, nicht durch Kapazität.
3. **Niedrige Produktivität je Skillpunkt:** Zum Referenzpreis deckt der Rohertrag gerade die Gehälter.

Das Preisband ist eine Zusatzregel, die nicht im Prompt steht. Die saubere Alternative wäre ein Preisexponent je
Branche (Abschnitt 6, Punkt 8).

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

| Wirkung einer Erhöhung um 100 bp | Größe |
|---|---|
| Faire Werte aller Aktien sinken (Makrofaktor) | −4 %, Tech −6 %, Einzelhandel −3,2 % |
| Rentenfonds schichten in Anleihen um | etwa −5 % Kursdruck, vorübergehend |
| Hebel, Kredite, Überziehung werden teurer | +1 Prozentpunkt pro Spieljahr |
| Branchennachfrage sinkt | −1 bis −3 % |
| Anleiherenditen steigen | +100 bp, aber höchstens bis 4 % |

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

Kein Wert aus dem Prompt wurde stillschweigend geändert. Wo eine Zusatzregel eingeführt wurde, steht es dabei.

| # | Wert aus dem Prompt | Problem | Vorschlag |
|---|---|---|---|
| 1 | Anleihen 2 bis 4 %, Leitzins 3 %, „1 Spieljahr = 1 Tag“ | Jahressätze gelten pro echtem Tag. Risikolos 2,25 bis 3,25 % **am Tag** verdoppeln Geld in etwa 30 Tagen, Aktien mit 7 % in 10 Tagen. | So lassen und beobachten, denn die Preisleiter der Statussymbole (bis 100 Mio. €) setzt genau dieses Wachstum voraus. Alternative: Zinsen und Dividenden je Quartal durch 4 teilen **und** die Zeitachse der Preise anpassen. Entscheidung vor M1 nötig. |
| 2 | Ordergebühr 1 € fix | Ab Level 5 bedeutungslos. | Anteilige Komponente (Abschnitt 5.3). |
| 3 | 500 XP je Firmenquartal mit Gewinn | Bis 2 000 XP am Tag passiv, größte XP-Quelle. | Auf das erste Gewinnquartal je Tag begrenzen oder an Mindestgewinn koppeln. |
| 4 | Gewinn-XP 1 je 100 €, höchstens 500 je Trade | Ohne Tagesgrenze, mit großem Depot bis 15 000 XP am Tag möglich. | Tagesgrenze, etwa 1 500 XP. |
| 5 | Level 20 und 25 | Für einen Test mit 4 Freunden spät (2,5 bis 11 Wochen). | `xpMultiplier` 2 im Test. |
| 6 | Insolvenz nach 2 Quartalen | 2 Quartale sind 12 echte Stunden. Wer schläft, kann morgens insolvent sein. | 4 Quartale, oder Benachrichtigung nach dem ersten nicht gedeckten Quartal als Pflicht vor M4. |
| 7 | Attraktivitätsformel | Größenunabhängig, lädt zu Boutique-Preisen ein (Abschnitt 4). | Preisband ist als Zusatzregel umgesetzt. Bitte bestätigen. |
| 8 | Preisexponent 1,5 für alle Branchen | „Einzelhandel: kleine Margen, Preiskriege“ entsteht so nur über die Kostenstruktur. Die optimale Marge einer kleinen Firma ist in jeder Branche gleich (`1 / (e + 1)` = 40 % des Preises). | Exponent je Branche: Einzelhandel 2,0, Logistik 1,6, Energie 1,5, Tech 1,2, Pharma 1,0. Nicht umgesetzt. |
| 9 | Pharma-Studien ±50 bis 70 % | Gilt laut Prompt für alle Pharmafirmen. Ein Bluechip, der an einem Ereignis 60 % verliert, zieht den NEXA 30 um mehrere Prozent. | Bewegung nach Größe staffeln (Bluechip ±15 bis 25 %, Mittelständler ±30 bis 45 %, Pennystock ±50 bis 70 %). Nicht umgesetzt. |
| 10 | Anleiherendite „2 bis 4 %“ | Als harte Grenze umgesetzt. Über 4,75 % Leitzins reagieren Anleihen nicht mehr auf Zinsentscheide. | Akzeptieren (begrenzt den Gegeneffekt in 5.2) oder Korridor an den Leitzins hängen. |
| 11 | Kleinunternehmen ohne Kreditrahmen, aber „Kleinkredit bis 50 000 € ab Level 15“ | Unklar, ob Privat- oder Firmenkredit. | Umgesetzt als Kreditrahmen der Firma nach Level des Gründers. Privatkredite gibt es nicht. |
| 12 | AG vor IPO: 100 Mitarbeiter | Keine Angabe für die Zeit nach dem IPO. | Stufe „börsennotiert“ mit 1 000 Mitarbeitern und 120 000 € Fixkosten als Annahme. |
| 13 | Jobgehalt passiv, 12 h am Tag | Kein Unterschied zwischen aktiven und passiven Spielern beim Einkommen. C-Level bringt 30 000 € am Tag ohne Zutun. | Gewollt (Offline-Fortschritt). Falls zu passiv: Teil des Gehalts an erledigte Arbeitsaufgaben koppeln. |
| 14 | Hebelkosten „über Nacht“ | Mit Abrechnung zu einem Stichtag wäre Hebel tagsüber gratis. | Umgesetzt als sekundengenauer Auflauf. 10× kostet 2,6 % des Eigenkapitals je Stunde. |
| 15 | Steuerprüfung −3 % Cash | Trifft nur, wer Cash hält. | Auf das Gesamtvermögen beziehen oder so lassen (Anreiz zu investieren). |

---

## 7. Risiken und Telemetrie für den Freundestest

| Risiko | Woran man es erkennt | Kennzahl |
|---|---|---|
| **Geld wächst zu schnell** | Statussymbole und Gründungen werden beiläufig | Geldmenge und Vermögen je Spieler pro Tag; Flüsse der Systemkonten je Quartal; Verhältnis Senken zu Quellen (Ziel: über 20 %) |
| **Risikoloser Zinseszins schlägt Spielen** | Spieler parken alles in Anleihen | Anteil Anleihen am Vermögen; Rendite je Spieler nach Anlageklasse |
| **Zocken lohnt sich im Mittel** | Hebel- und Pennystock-Spieler führen die Liga dauerhaft an | Tagesrendite je Spieler gegen Umschlag, Hebelnutzung und Pennystock-Anteil; Anteil liquidierter Positionen |
| **Analyse lohnt sich nicht** | Kaufen unter fairem Wert bringt nichts | Rendite von Käufen nach Abstand zum fairen Wert (intern auswertbar); Zeit bis zum Schließen einer Lücke |
| **Kurse wirken tot oder chaotisch** | Flache Charts oder ständige Sprünge | Tagesvolatilität je Größenklasse (Ziel 5 / 13 / 40 %); Abstand Kurs zu fairem Wert; Anteil der Ticks am Circuit Breaker |
| **Markt lässt sich bewegen** | Ein Spieler treibt einen Pennystock und verkauft teuer an Freunde | Preis-Impact je Spieler und Aktie; Gewinn aus eigenen Orderfolgen; Handel zwischen Freunden neben dem Marktpreis |
| **Trendfolger schaukeln sich auf** | Kurse laufen ohne Nachricht weg | Schleifenverstärkung aus der Konfiguration (Test); Autokorrelation der Tick-Renditen |
| **Unternehmen zu lukrativ oder unmöglich** | Alle gründen sofort oder niemand überlebt | Gewinn je Quartal und Stufe; Anteil insolventer Firmen; Preis relativ zum Band (kleben alle am oberen Rand?); Auslastung |
| **Boutique-Preise** | Spielerfirmen stehen dauerhaft am Höchstpreis | Verteilung der Preise im Band; Attraktivitätsanteil gegen tatsächlichen Anteil |
| **KI-Firmen kippen** | Ein Bluechip wird insolvent oder wächst endlos | Marge, Cash und Marktanteil der 15 KI-Firmen je Quartal; Qualität (läuft sie bei allen gegen denselben Wert?) |
| **XP zu schnell oder zu langsam** | Level 10 am zweiten Tag oder Frust vor Level 20 | XP je Tag und Quelle je Spieler; Tage bis Level 5, 10, 15, 20 |
| **Passive XP dominieren** | Level steigen ohne Spielzeit | Anteil von Arbeitsstunden und Firmenquartalen an den XP |
| **Insolvenz über Nacht** | Firma weg nach dem Aufwachen | Zeit zwischen erstem nicht gedecktem Quartal und Reaktion des Gründers |
| **Zentralbank überdreht** | Leitzins läuft an eine Grenze | Leitzins und gemessenes Geldmengenwachstum je Entscheidung |
| **Pharma-Sprünge verzerren den Index** | NEXA 30 springt um mehrere Prozent | Indexbewegung an Studientagen; Gewicht der Pharma-Bluechips |
| **Nachbörslicher Handel wird ausgenutzt** | Große Orders nachts, Rückkauf am Morgen | Spielerumsatz und Impact nach Sitzung; Gewinn aus Positionen über die Börsenöffnung |
| **Steuer-Asymmetrie frustriert** | Spieler mit Verlusten fühlen sich bestraft | Größe der Verlusttöpfe; gezahlte Steuer je Spieler |

**Mindest-Telemetrie ab M1/M2:** eine Tabelle mit Tageswerten je Spieler (Vermögen, Cash, XP nach Quelle,
Umschlag, gezahlte Gebühren und Steuern, Hebel) und eine mit Quartalswerten der Wirtschaft (Flüsse der
Systemkonten, Geldmenge, Leitzins, Volatilität und Abstand zum fairen Wert je Aktie). Beide sind reine
Auswertungen des Ledgers und der Tick-Tabellen.

**Offene Kalibrierung**, die nur mit Simulationsläufen über Wochen zu klären ist: Anfangswerte der 15 KI-Firmen
(Aktienzahl, Streubesitz, Startkurs passend zum fairen Wert), Stärke der Sentiment-Schocks, Qualitätsmodell
(aktuell laufen die KI-Firmen einer Branche langfristig auf dieselbe Qualität zu), Wirkung der Abteilungen
Marketing und Finanzen.
