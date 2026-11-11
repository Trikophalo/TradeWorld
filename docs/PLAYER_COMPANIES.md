# Spielerfirmen: Gründen, führen, einstellen

Konzept nach Vorgabe des Auftraggebers (ADR-057, Punkte 1 bis 3 aus `JOBS_AND_SKILLS.md` §13). Werte in
`src/config/balance.ts`, Abschnitt `startups` (und `company.tiers` für das Kleinunternehmen), Formeln in
`src/lib/sim/startup.ts` mit Tests. Die Datenbank rechnet dieselben Formeln in PL/pgSQL.

Ein Spieljahr dauert einen echten Tag, ein Quartal sechs Stunden. Alle „Jahres“-Werte sind also Werte pro echtem Tag.

## 1. Gründen

| Form             | ab Level | Gründung | Fixkosten pro Quartal | Mitarbeiter (Spieler + KI) |
| ---------------- | -------- | -------- | --------------------- | -------------------------- |
| Garagen-Startup  | 3        | 2.500 €  | 150 €                 | 2                          |
| Kleinunternehmen | 10       | 15.000 € | 2.000 €               | 5                          |

- Gründen: Name (Namensfilter wie bei Spielernamen), eine **Idee** in einem Satz, **Branche** (Tech, Handel, Energie,
  Pharma, Logistik) und **Firmenfarbe**. Das Gründungsgeld geht aus der Privatkasse in die Firmenkasse.
- Eine Firma pro Spieler. Wer gründet, arbeitet in der eigenen Firma und kann keinen anderen Job haben (ADR-045).
- Aus der Garage wird ab Level 10 ein Kleinunternehmen: Der Gründer zahlt die Differenz (12.500 €) in die Firmenkasse.
- Jede Firma bekommt bei der Gründung eine **verborgene Marktgröße** ihrer Nische (Pareto, `ECONOMY.md` §6.2): Die
  Hälfte der Nischen trägt nur ein paar tausend Euro pro Tag, wenige tragen Millionen.

## 2. Ein Quartal

```
Qualität  q ← q + 0,35 × (Ziel − q)          Ziel = 0,25 + 0,75 × S / (S + 20)
                                               S = Skill-Punkte des Teams in den Bereichen der Branche
Bekanntheit a ← a + 0,3 × a × (1 − a) × (0,5 + q)   (Mundpropaganda, S-Kurve)
              + 0,12 × M / (M + H)                    (Marketing M, H = 10 % des Quartalspotenzials, min. 500 €)
              − 0,03 × a
Nachfrage  = Marktgröße / 4 × a × (0,5 + 0,5 q) × Zufall (±10 %)
Kapazität  = Summe der Leistung × 3.000 € (Tech, Pharma) bzw. 2.500 € (andere Branchen)
Umsatz     = min(Nachfrage, Kapazität)
Gewinn     = Umsatz − Wareneinsatz (Branchenmarge) − Fixkosten − KI-Kräfte − Marketing
```

- **Leistung** (ADR-050): KI-Kraft 1,0; Spieler 1,5 + 0,08 × passende Skill-Punkte, höchstens 4,0. Der Gründer zählt
  mit seinen Skills in den Bereichen der Branche (`jobs.sectorBranches`). Ein guter Spieler ersetzt also mehrere
  KI-Kräfte, und Skills in der Branche heben zusätzlich die Qualität.
- **KI-Kräfte** kosten fest 700 € pro Quartal und leisten 1,0, sofort verfügbar.
- **Spieler-Löhne** laufen stündlich aus der Firmenkasse (M2b) und stehen im Quartalsbericht als Lohnkosten.
- **Marketing** stellt der Gründer als Budget pro Quartal ein.
- Geld bleibt im geschlossenen Kreislauf (ADR-041): Umsatz kommt aus dem Haushalts-Topf, Wareneinsatz, Fixkosten,
  Marketing und KI-Kräfte gehen dorthin zurück.

## 3. Wenn das Geld nicht reicht

Kosten werden nur bis zur vorhandenen Kasse bezahlt; der Rest wird als **offene Rechnungen** gebucht, und die KI-Kräfte
werden entlassen. Die Firma ist dann „in Schieflage“. Die Insolvenz mit Privathaftung (ADR-052) folgt in einem
späteren Schritt; bis dahin kann der Gründer Geld einzahlen.

## 4. Was der Gründer sieht und tut

- **Übersicht:** Kasse, Wert der Firma, letzter Quartalsbericht (Nachfrage, Kapazität, Umsatz, Kosten, Gewinn),
  Auslastung, Bekanntheit, Qualität, Verlauf der letzten Quartale.
- **Marktgefühl:** eine Schätzung der Marktgröße als Spanne, die jedes Quartal enger wird und die Wahrheit immer
  enthält.
- **Steuern:** Marketing-Budget, Zahl der KI-Kräfte, Geld einzahlen oder entnehmen, zum Kleinunternehmen wachsen.
- **Stellen:** Stellen ausschreiben (Titel, Stufe, gesuchte Skills, Lohn, Plätze), schließen.
- **Bewerbungen:** Visitenkarte, Passung, Gehaltswunsch und Satz jedes Bewerbers; annehmen, ablehnen, Gegenangebot.
- **Team:** Leistung und Lohn jedes Mitarbeiters, Erhöhungswünsche beantworten, entlassen (ein Gehalt Abfindung).

## 5. Wert und Reichenliste

Wert = Kasse + max(0, Quartalsgewinn × 4) × Branchen-KGV × 0,5. Er zählt zum Vermögen des Gründers und damit für
die Reichenliste; auf der Visitenkarte steht die Firma.

## 6. Ziele für das Balancing (Szenario-Test in `startup.test.ts`)

Über 1.000 Garagen-Startups mit vernünftiger Führung, zehn echte Tage lang:

- 20 bis 45 % gehen das Geld aus (die Gründung ist ein echtes Risiko),
- 45 bis 75 % stehen am Ende mit Gewinn da, meist klein,
- 3 bis 20 % sind ausverkauft und brauchen mehr Leute oder die nächste Firmenform.

## 7. Offen

Finanzierungsrunden und Börsengang (Weg zum Big Player), GmbH und AG, Insolvenz mit Privathaftung, Firmenchat.
