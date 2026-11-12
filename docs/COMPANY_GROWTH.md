# Unternehmensausbau: Betrieb, Forschung, Wachstum ohne Ende

Konzept für den Ausbau von Spielerfirmen (ADR-072, ADR-073). Ziel des Spielers: das größte Unternehmen der Welt
bauen, wie im echten Leben. **Man wird nie fertig.** Jede Ebene hat unendliche Stufen mit sinkendem Ertrag, Produkte
altern, Märkte sättigen sich, und andere Spieler holen auf.

## Inhalt

1. [Leitideen](#1-leitideen)
2. [Betrieb: stündlich und live](#2-betrieb-stündlich-und-live)
3. [Produkte und Lebenszyklus](#3-produkte-und-lebenszyklus)
4. [Forschung und Entwicklung](#4-forschung-und-entwicklung)
5. [Abteilungen](#5-abteilungen)
6. [Standorte und Märkte](#6-standorte-und-märkte)
7. [Warum man nie fertig wird](#7-warum-man-nie-fertig-wird)
8. [Ranglisten](#8-ranglisten)
9. [Umsetzung in Phasen](#9-umsetzung-in-phasen)

## 1. Leitideen

- **Echtzeit:** Die Firma arbeitet jede Stunde. Umsatz, Kosten und Löhne sieht man live mitlaufen.
- **Ehrliche Löhne:** Spieler und KI-Kräfte werden zur selben Zeit bezahlt, stündlich, und nie mit mehr Geld, als die
  Firma in der Stunde erwirtschaftet hat. Reicht es nicht, sinken alle Löhne im selben Verhältnis (Lohnfaktor).
- **Langsamer Ausbau:** Jede Erweiterung kostet Geld, Zeit und die richtigen Leute. Man schaltet Schritt für Schritt
  frei: erst ein Produkt, dann Forschung, dann weitere Produkte, Abteilungen, Standorte, neue Märkte.
- **Kein Deckel:** Stufen gehen unendlich weiter, jede bringt etwas weniger als die vorige und kostet mehr.
- **Spieler zählen mehr als KI:** KI-Kräfte füllen Lücken; Wachstum und Forschung kommen vor allem von Menschen mit
  Skills (ADR-069, ADR-071).

## 2. Betrieb: stündlich und live

Jede volle Stunde (pg_cron) rechnet der Server für jede Firma eine **Betriebsstunde** ab. Ein Quartal hat 6 Stunden;
der Quartalsbericht fasst die 6 Stunden zusammen (Bekanntheit und Qualität entwickeln sich weiter pro Quartal).

```
Umsatz/h      = Σ Produkte min(Nachfrage/h, Kapazität/h)
Rohertrag/h   = Umsatz/h − Wareneinsatz/h
Lohnsumme/h   = Σ Spielerlöhne/h + Σ KI-Löhne/h
Lohnfaktor    = min(1, Rohertrag/h ÷ Lohnsumme/h)        (nie aus der Rücklage)
Ausgezahlt/h  = Lohnsumme/h × Lohnfaktor                 (Spieler und KI im selben Verhältnis)
Gewinn/h      = Rohertrag/h − Ausgezahlt/h − Fixkosten/h − Marketing/h − Forschung/h
```

- Fixkosten, Marketing und Forschungsbudget zahlt die Firma aus der Kasse. Reicht die Kasse dafür nicht, beginnt die
  Schieflage (Insolvenz wie in ADR-059, gezählt in Stunden statt Quartalen).
- Ein Gewinnbonus (ADR-058) wird weiter am Quartalsende verteilt.
- **Live-Anzeige:** Die Firma zeigt „Umsatz pro Stunde“, „Gewinn heute“ und einen Zähler, der zwischen zwei
  Abrechnungen hochläuft (der Client interpoliert nur die Anzeige, gebucht wird stündlich auf dem Server).

## 3. Produkte und Lebenszyklus

- Eine Firma startet mit **einem Produkt** (ADR-062). Weitere Produkte entstehen durch Forschung (Abschnitt 4).
- Jedes Produkt hat einen eigenen Markt: Marktgröße, Bekanntheit, Qualität, Wachstumsstufen mit Spezialisten.
- **Lebenszyklus:** Einführung → Wachstum → Reife → Rückgang. Ab der Reife sinkt die Nachfrage langsam
  (Veralterung pro Quartal). Eine neue **Version** (Forschung) setzt das Produkt auf „Wachstum“ zurück und hebt die
  erreichbare Qualität. Wer nicht weiterentwickelt, verliert Umsatz.
- **Sättigung:** Ein Markt wächst nicht unendlich. Wer weiter wachsen will, braucht neue Produkte, neue Branchen oder
  neue Märkte (Abschnitt 6).
- **Wettbewerb:** Spieler mit einem Produkt in derselben Nische teilen sich die Nachfrage nach Bekanntheit × Qualität.

## 4. Forschung und Entwicklung

Forschung kostet **Forschungspunkte (FP)**. FP entstehen jede Stunde:

```
FP/h = Σ Mitarbeiter (Forscherleistung aus Skills in Wissenschaft und IT) + Budget-FP(Forschungsbudget/h)
```

Das Budget hat einen abnehmenden Ertrag (doppeltes Budget bringt weniger als doppelt so viele FP). Ohne Menschen mit
passenden Skills bleibt Forschung teuer und langsam.

**Forschungsprojekte** (wählbar, eines läuft gleichzeitig, mit der F&E-Abteilung mehr):

| Projekt                                | Wirkung                                           | Stufen     |
| -------------------------------------- | ------------------------------------------------- | ---------- |
| Neues Produkt (aus der Produktliste)   | zweites, drittes … Produkt der Branche            | je Produkt |
| Neue Version eines Produkts            | Qualitätsgrenze +, Lebenszyklus neu               | unendlich  |
| Prozessoptimierung                     | Wareneinsatz −2 % (abnehmend)                     | unendlich  |
| Automatisierung                        | Kapazität je Leistung +3 % (abnehmend)            | unendlich  |
| Markenbildung                          | Marketing wirkt stärker                           | unendlich  |
| Branchenwechsel (z. B. Tech → Energie) | Produkte einer zweiten Branche werden erforschbar | je Branche |
| Patente                                | kleine Lizenzeinnahmen pro Stunde                 | unendlich  |

Kosten steigen je Stufe um den Faktor 1,6; die Wirkung sinkt je Stufe. Damit gibt es immer ein nächstes Ziel, aber
nie einen Endpunkt.

## 5. Abteilungen

Abteilungen werden mit der Firmengröße freigeschaltet und bringen Sitze und Boni, wenn sie mit passenden Skills besetzt
sind: **Vertrieb** (Nachfrage), **Marketing** (Bekanntheit), **F&E** (Forschungspunkte, parallele Projekte),
**Produktion/Logistik** (Kapazität, Wareneinsatz), **Finanzen** (Zinsen auf die Kasse, günstigere Kapitalerhöhungen),
**Recht** (Patente, Schutz vor Wettbewerbern). Jede Abteilung hat Ausbaustufen ohne Obergrenze.

## 6. Standorte und Märkte

- **Gebäude:** Garage → Laden → Büro (GmbH) → Zentrale (AG) → Campus → Konzernturm. Jede Stufe mehr Plätze und
  Fixkosten (heute bis AG, ADR-067).
- **Standorte:** Zusätzliche Niederlassungen bringen Plätze und Kapazität, kosten Miete; beliebig viele, jede teurer.
- **Märkte:** Deutschland → Europa → Nordamerika → Asien → Welt. Jeder Markt vervielfacht die Marktgröße der Produkte,
  braucht Forschung (Lokalisierung), eine Mindestgröße der Firma und kostet Markteintritt.

## 7. Warum man nie fertig wird

1. Unendliche Forschungsstufen mit steigenden Kosten.
2. Produkte veralten und brauchen neue Versionen.
3. Märkte sättigen sich; Wachstum braucht neue Produkte, Branchen und Märkte.
4. Andere Spieler konkurrieren in denselben Nischen und in der Rangliste.
5. Firmenwert als Ziel: Er wächst mit Gewinn, Produkten und Marktanteil und hat keine Obergrenze.

## 8. Ranglisten

- **Forbes 100:** die 100 reichsten echten Spieler nach Vermögen (ohne KI-Tycoons).
- **Top-Unternehmen:** Spielerfirmen nach Firmenwert, mit Umsatz pro Stunde, Teamgröße, Produkten und Gründer.

## 9. Umsetzung in Phasen

| Phase | Inhalt                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Stündlicher Betrieb, Lohnregel, Live-Anzeige; Forbes 100 und Top-Unternehmen                                                                      |
| A2    | Gewinnhebel (Auftragsarbeit, Preisstrategie, Gewinn-Coach), Markt je Rechtsform, Ausbaustufen ohne Ende, GmbH direkt gründen (ADR-083, umgesetzt) |
| B     | Forschungspunkte, Forschungsprojekte, mehrere Produkte, Versionen und Lebenszyklus                                                                |
| C     | Abteilungen, Standorte, Märkte, weitere Gebäudestufen                                                                                             |
| D     | Wettbewerb in Nischen, Übernahmen, Patente                                                                                                        |
