# Prompt für Claude Code: Multiplayer-Börsenspiel „NEXA“ (Arbeitstitel)

> **So verwendest du diesen Prompt:** Leg ein leeres Projektverzeichnis an, starte dort Claude Code und füge diesen gesamten Text als erste Nachricht ein. Speichere ihn zusätzlich als `docs/ORIGINAL_PROMPT.md` im Projekt, damit Claude Code später immer darauf zurückgreifen kann.

---

## 0. Deine Rolle und dein Auftrag

Du bist ein erfahrener Senior Full-Stack-Entwickler und Game-Designer mit Schwerpunkt auf:
- Echtzeit-Web-Apps mit React/Next.js und TypeScript
- Wirtschaftssimulationen und Multiplayer-Spielsystemen
- hochwertigem UI/UX-Design im Stil moderner Neo-Broker-Apps, mit Liebe zu Micro-Interactions und Animationen

Wir bauen ein **Multiplayer-Börsen- und Wirtschaftsspiel für den Browser** (PC und Handy), das zuerst mit **4 Freunden** online getestet wird und später auf viele Spieler skalieren soll.

### Dein Auftrag in dieser ersten Phase: STRUKTURIEREN, nicht alles bauen

Baue in dieser Phase **noch nicht das ganze Spiel.** Deine Aufgabe ist es, ein **sauberes, durchdachtes Fundament** zu legen:

1. Lies diesen gesamten Prompt sorgfältig. Stelle mir **zuerst maximal 5 Rückfragen**, falls etwas Wichtiges unklar oder widersprüchlich ist. Triff ansonsten begründete Annahmen und dokumentiere sie.
2. Erstelle die **Projektdokumentation** (siehe Abschnitt 12).
3. Richte das **Projekt-Grundgerüst** ein (Stack, Ordnerstruktur, Linting, Design-Tokens, Basis-Layout mit Navigation).
4. Entwirf das **vollständige Datenbankschema** inkl. Migrations-Dateien und Row Level Security.
5. Entwirf die **Simulationsarchitektur** (Markt-Tick, Quartale, KI-Investoren) als Dokument mit Pseudocode und Typdefinitionen.
6. Lege eine **Roadmap mit Meilensteinen** an und stoppe dann, damit ich die Struktur prüfen kann, bevor Meilenstein 1 umgesetzt wird.

Arbeite schrittweise, committe nach jedem logischen Schritt mit einer aussagekräftigen Commit-Message und fasse am Ende zusammen, was du gemacht hast, welche Annahmen du getroffen hast und was als Nächstes kommt.

---

## 1. Die Spielidee in einem Absatz

Ein Online-Börsensimulator, in dem alle Spieler auf **demselben Markt** handeln. Spieler verdienen Spielgeld (Grundeinkommen und Jobs), traden Aktien und Staatsanleihen (Daytrading oder langfristig, später mit Hebel und Leerverkäufen), steigen über ein **Levelsystem** auf und können ab Level 10 **eigene Unternehmen gründen**, diese wie in einem Manager-Spiel führen (Produkt, Preis, Marketing, Mitarbeiter), sie an die Börse bringen (IPO) und mit anderen Spielern um Marktanteile konkurrieren. Eine vollständige **KI-Wirtschaft** (KI-Firmen, KI-Investoren, Zentralbank, Staatsanleihen) sorgt dafür, dass der Markt schon mit 4 Spielern lebendig wirkt.

**Es ist ein reines Menü- und Dashboard-Spiel.** Keine Spielwelt, keine Karte, keine Figur, die sich bewegt. Das Spielgefühl entsteht durch Zahlen, Charts, Entscheidungen, Events und soziale Dynamik.

---

## 2. Harte Rahmenbedingungen (nicht verhandelbar)

- **Nur Spielwährung.** Kein Echtgeld, keine Auszahlung, **keine In-App-Käufe im MVP.** Spielgeld darf niemals für echtes Geld gekauft werden können (Glücksspielrecht, Store-Richtlinien, USK). Plane die Architektur so, dass später höchstens kosmetische Käufe möglich wären, die keinerlei Einfluss auf Geld, Aktien oder XP haben.
- **Zielgruppe 18+.** Das Spiel enthält simuliertes Zocken (Hebel, Shorts).
- **Server-Autorität:** Alle Geld-, Order-, XP- und Simulationsvorgänge laufen ausschließlich **serverseitig** (Postgres-Funktionen in Transaktionen oder Edge Functions). Der Client zeigt nur an und sendet Absichten. Nie dem Client vertrauen.
- **Geld als Ganzzahlen:** Alle Geldbeträge als `bigint` in **Cent** speichern und rechnen. Keine Floats für Geld. Kurse ebenfalls in Cent (oder mit fester Nachkommastellen-Skalierung, begründe die Wahl).
- **Muss mit 4 Spielern funktionieren:** Kein Feature darf voraussetzen, dass viele Spieler online sind.
- **Alle Balancing-Werte konfigurierbar:** Zahlen in diesem Prompt sind Startwerte. Lege sie zentral ab (z. B. Tabelle `game_config` oder `config/balance.ts`), nicht verstreut im Code.
- **Deutsch als Spielsprache**, aber i18n-fähig aufbauen (Texte nicht hart im Code). Code, Variablen, Kommentare und Datenbank auf **Englisch.**
- **Responsiv:** Handy zuerst gedacht, auf dem PC voll ausgenutzt (mehrspaltige Layouts).

---

## 3. Tech-Stack

Nutze diesen Stack, sofern du keinen starken Grund dagegen hast (dann begründen):

| Bereich | Technologie |
|---|---|
| Framework | **Next.js** (App Router) + **TypeScript** (strict) |
| Styling | **Tailwind CSS** mit eigenen Design-Tokens (CSS-Variablen) |
| UI-Primitives | **Radix UI** bzw. **shadcn/ui** als Basis, vollständig an unseren Stil angepasst |
| Animation | **Motion** (Framer Motion) für Layout-, Übergangs- und Spring-Animationen |
| Charts | **TradingView Lightweight Charts** für Kerzen- und Linien-Charts (Lizenz und Attributionspflicht beachten) |
| Client-State | **Zustand** für UI-State, **TanStack Query** für Server-State |
| Backend | **Supabase**: Postgres, Auth, Realtime, Edge Functions, `pg_cron` |
| Validierung | **Zod** (geteilte Schemas zwischen Client und Server) |
| Sound | **Howler.js** (kurze 8-Bit-Sounds, stummschaltbar) |
| PWA | Installierbar auf dem Handy (Manifest, Icons, Service Worker) |
| Hosting | **Vercel** (Frontend) + Supabase (Backend) |
| Tests | **Vitest** (Simulationslogik, Formeln), **Playwright** (kritische Flows) |
| Qualität | ESLint, Prettier, Husky + lint-staged |

**Supabase-Zugangsdaten:** Verwende `.env.local` mit `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Der `SUPABASE_SERVICE_ROLE_KEY` gehört nur in Server-Umgebungen und niemals in den Client-Code. Lege eine `.env.example` an.

---

## 4. Zeit und Spieltakt

- **1 Spielquartal = 6 echte Stunden** (Standard, konfigurierbar). Also 4 Quartale = 1 Spieljahr pro echtem Tag.
- **Börsenzeiten:** 08:00 bis 22:00 Uhr (Europe/Berlin), mit **Eröffnungs- und Schlussglocke** als Event. Außerhalb: nachbörslicher Handel mit dünnerer Liquidität und größerem Spread.
- **Markt-Tick:** Kurse aktualisieren sich serverseitig in kurzen Intervallen (Ziel: alle 5 bis 10 Sekunden). Schlage die beste Umsetzung vor (z. B. `pg_cron` mit Sekundenintervall, Edge Function, oder ein kleiner Worker) und begründe sie.
- **Kerzen** werden serverseitig aus Ticks aggregiert: 1 min, 5 min, 1 h, 1 Quartal, 1 Spieljahr.
- **Quartalsabschluss** alle 6 Stunden: Unternehmenssimulation, Quartalszahlen, Gehaltsabrechnung, Zinsen, Dividenden.
- **Offline-Fortschritt:** Grundeinkommen, Jobgehalt und Unternehmen laufen weiter, auch wenn niemand online ist.

---

## 5. Die KI-Wirtschaft (Fundament des Markts)

Der Markt wird zu etwa **80 % von KI-Akteuren** getragen. Spieler sind die „großen Fische“, aber nicht nötig, damit sich etwas bewegt.

### 5.1 Staat und Zentralbank
- **Leitzins** (Start: 3 %), angepasst durch die Zentralbank-KI anhand der Geldmenge im Spiel (Inflationsschutz). Zinsentscheide sind **angekündigte Events** mit Countdown.
- **Staatsanleihen** als sicheres Sicherheitsnetz: Laufzeiten 1, 2, 5 und 10 Spieljahre, Rendite 2 bis 4 % (gekoppelt an den Leitzins), immer klar unter der Durchschnittsrendite guter Aktien.
- Steigt der Leitzins, schichten KI-Fonds aus Aktien in Anleihen um, und der Gesamtmarkt fällt (spürbares Makro-Event).
- *Später:* fiktive Staaten mit Ausfallrisiko (z. B. „Republik Valdorien, 9 %, Rating CCC“).

### 5.2 KI-Unternehmen (15 zum Start)
- Werden mit **exakt derselben Simulation** berechnet wie Spielerfirmen (Umsatz, Kosten, Gewinn, Marktanteil).
- Verteilt auf 5 Branchen (je 3), unterschiedliche Größen: Bluechips, Mittelständler, volatile Pennystocks.
- Jede hat einen Namen, ein **Pixel-Logo**, eine Kurzbeschreibung, Kennzahlen und eine Nachrichtenhistorie.
- Beispiele: *Volta Energie AG*, *Brotzeit Handel*, *NeuroPharm*, *KlarSoft*, *Nordlicht Logistik*. Lege alle 15 an.

### 5.3 KI-Investoren
Mehrere Investortypen mit eigener Logik, die zusammen Liquidität und realistische Kursbewegungen erzeugen:

| Typ | Verhalten |
|---|---|
| **Marktmacher** | Stellt immer Kauf- und Verkaufsangebote mit Spread, sorgt für Grundliquidität |
| **Value-Fonds** | Kauft unter dem fairen Wert, verkauft darüber, reagiert langsam |
| **Momentum-Trader** | Springt auf Trends auf, verstärkt Bewegungen |
| **Rentenfonds** | Schichtet je nach Leitzins zwischen Anleihen und Dividendenaktien um |
| **Indexfonds** | Hält die NEXA-30-Aktien nach Marktkapitalisierung; kauft bei Indexaufnahme |
| **Kleinanleger-Herde** | Reagiert emotional auf News und Hype, übertreibt in beide Richtungen |

**Fairer Wert (Kursanker)** einer Aktie, grob:
`fairValue = Gewinn je Aktie × Branchen-KGV × Wachstumsfaktor × Reputationsfaktor (nur Spielerfirmen, 0,6 bis 1,4) × Makrofaktor (Leitzins)`
Dazu kommen Rauschen, Sentiment aus News und der Einfluss echter Spieler-Orders (Preis-Impact abhängig von Ordergröße und Liquidität).

### 5.4 Leitindex NEXA 30
Die 30 größten börsennotierten Firmen nach Marktkapitalisierung (anfangs alle KI-Firmen plus Spielerfirmen). **Aufnahme einer Spielerfirma** ist ein großes Event: Indexfonds müssen kaufen, der Kurs springt.

### 5.5 Nachrichten und Events
- Nachrichten entstehen **aus der Simulation** (Quartalszahlen, Rohstoffpreise, Zinsentscheide, Spieleraktionen) über Textvorlagen mit Variablen.
- **Geplante Events** mit Countdown: Zinsentscheid, Quartalszahlen, Pharma-Studienergebnisse (binär, ±50 bis 70 %), Ölpreis-Report.
- **Zufällige Makro-Events:** Branchenkrise, Rohstoffschock, Konjunkturdelle, Tech-Boom.

---

## 6. Branchen und Unternehmenssimulation

### 6.1 Branchen

| Branche | Charakter | Typisches Risiko |
|---|---|---|
| Tech/Software | Wenig Kapital, langsamer Start, dann explosives Wachstum | Ein Produkt floppt |
| Einzelhandel | Stabil, kleine Margen, Preiskriege | Konkurrent unterbietet |
| Energie | Kapitalintensiv, hängt am Rohstoffpreis | Ölpreis-Event |
| Pharma | Lange Entwicklung, binäre Studienevents | Studie scheitert |
| Logistik | Skaliert über Mitarbeiter und Fuhrpark | Lohnkosten, Konjunktur |

### 6.2 Gemeinsame Nachfrage, das Kernprinzip
Alle Firmen einer Branche (Spieler **und** KI) teilen sich **dieselbe Branchennachfrage.** Pro Quartal:

```
attractiveness = quality^1.2 × awareness^0.8 / price^1.5
marketShare    = own attractiveness / sum(attractiveness aller Firmen der Branche)
revenue        = sectorDemand × marketShare  (begrenzt durch die Produktionskapazität)
```

Die Exponenten sind Startwerte für das Balancing. Senkt ein Spieler den Preis, sinkt der Umsatz seiner Konkurrenten. So entsteht direkte Rivalität ohne Spielkarte.

### 6.3 Quartalsentscheidungen des Gründers (Manager-Ebene)
- **Produkt:** Entwicklung starten oder verbessern (dauert mehrere Quartale, Zeit-Gate), neue Produktlinie
- **Preis:** Marge gegen Marktanteil
- **Marketing:** Budget für Bekanntheit, **sinkender Grenznutzen** (doppeltes Budget bringt etwa +40 % Bekanntheit)
- **Personal:** Einstellen, entlassen, befördern, Gehälter
- **Finanzen:** Kredit, Rücklagen, Dividende, Rückkauf, Kapitalerhöhung (nach IPO)

**Geld allein darf nicht reichen:** Einarbeitungszeit neuer Mitarbeiter, sinkender Grenznutzen, Entwicklungszeiten, Fixkosten bei Überexpansion.

### 6.4 Unternehmensgrößen

| Typ | Level | Gründungskosten | Fixkosten/Quartal | Max. Mitarbeiter | Kreditrahmen |
|---|---|---|---|---|---|
| Kleinunternehmen | 10 | 15.000 € | 2.000 € | 5 | – |
| GmbH | 20 | 75.000 € | 10.000 € | 20 | bis 250.000 € |
| AG (vor IPO) | 25 | 300.000 € | 40.000 € | 100 | bis 2 Mio. € |

- Umwandlung in die nächste Stufe gegen Gebühr und mit Level-Voraussetzung.
- Ab Level 18: Kleinunternehmen auf bis zu 20 Mitarbeiter erweiterbar.
- Dazu variable Kosten: Gehälter, Produktion, Marketing, Zinsen.
- **Kapitalobergrenze:** Der Gründer kann pro Phase nur begrenzt privates Geld einschießen. Wachstum muss aus Umsatz und Investoren kommen.

### 6.5 Die 4 Phasen eines Unternehmens

1. **Gründung (privat):** Branche, Name, Pixel-Logo, Firmenfarbe, Finanzierung (Eigenkapital, Kredit, **Business Angels**: KI oder echte Spieler kaufen vorbörslich Anteile). Cap Table wird geführt.
2. **Operatives Wachstum:** Quartalsentscheidungen, Mitarbeiter, Marktanteile.
3. **IPO:**
   - Voraussetzungen: 4 Quartale Historie, Mindestumsatz, positive Reputation, ein CFO (KI oder Spieler), Level 25.
   - **Prospekt mit verbindlichen, später automatisch geprüften Angaben:** Umsatzprognose der nächsten 4 Quartale, Mittelverwendung in Prozent (Expansion, Personal, Rücklage, Finanzanlagen), Gründer-Lock-up (Standard 4 Quartale), Anteil ausgegebener Aktien.
   - **Bookbuilding:** Eine KI-Emissionsbank schlägt anhand der Zahlen eine Preisspanne vor. Zeichnungsfrist 1 Quartal. KI-Fonds und Spieler zeichnen. Überzeichnet: Preis am oberen Ende. Unterzeichnet: IPO platzt, Reputationsverlust, zurück in Phase 2.
4. **Börsennotiert:** Automatische Quartalszahlen zu festen Zeiten, **Guidance** (Prognose des Gründers für das nächste Quartal, Abweichung beeinflusst Reputation), Dividende, Aktienrückkauf, Kapitalerhöhung (verwässert), später Übernahmen. **Hauptversammlung:** Spieler-Aktionäre stimmen ab (Dividende; Abberufung des CEO bei > 50 %).

### 6.6 Reputation (0 bis 100, pro Gründer, nicht pro Firma)
Steuert den Bewertungsfaktor der KI-Investoren (0,6× bis 1,4×), Kreditzinsen und IPO-Zugang.

| Erhöht | Senkt |
|---|---|
| Prognosen eingehalten | Prognosen verfehlt (z. B. > 30 % Abweichung) |
| Lock-up eingehalten, lange gehalten | Dumping nach dem IPO |
| Verlässliche Dividende | Ständige Kapitalerhöhungen |
| Prospekt-Mittelverwendung eingehalten | Mittel abweichend vom Prospekt verwendet |
| Mitarbeiter bleiben lange | Insider-Verstoß aufgedeckt |

Pump-and-Dump bleibt **möglich**, kostet aber Reputation, die beim nächsten Unternehmen fehlt.

### 6.7 Kredite und Insolvenz
- **Zins = Leitzins + Risikoaufschlag** (Reputation, Verschuldungsgrad, Gewinn).
- Kreditrahmen wächst mit Level und Reputation.
- **Insolvenz:** Wenn 2 Quartale lang die laufenden Kosten nicht gedeckt sind. Die Aktie stürzt ab, Gläubiger bekommen die Reste, der Gründer verliert stark an Reputation und hat 3 Spieltage Gründungssperre.
- **Rettungsübernahme:** Kurz vor der Pleite kann ein anderer Spieler oder eine KI-Firma die Firma günstig übernehmen.

---

## 7. Mitarbeiter

### 7.1 KI-Mitarbeiter
Attribute: Name, Fachgebiet (Entwicklung, Vertrieb, Produktion, Finanzen, Marketing), **Skill 1 bis 10**, Gehalt pro Quartal, **Loyalität** in Prozent, eine **Eigenschaft** (z. B. „Ehrgeizig“: +15 % Leistung, kündigt bei Gehaltsstopp schneller).

- **Normale Mitarbeiter** erhöhen die Kapazität ihrer Abteilung (mit Einarbeitungszeit).
- **Führungspositionen** (CFO, CTO, COO, Vertriebsleitung) schalten Fähigkeiten frei, z. B. senkt ein guter CFO die Kreditzinsen und macht die Guidance-Spanne enger; ein guter CTO verkürzt Entwicklungszeiten.
- **Bewerberpool** wird jedes Quartal neu generiert. **Abwerben** durch Konkurrenten mit höherem Gehalt ist möglich.

### 7.2 Echte Spieler als Mitarbeiter
- Ein Spieler kann in der Firma eines anderen Spielers arbeiten, inklusive **Führungsrollen mit echten Entscheidungen** (CFO verwaltet Liquidität und Kredite, Vertriebsleitung wählt Kampagnen und Preisaktionen).
- Bezahlung: Gehalt plus **Aktienoptionen mit Vesting** (z. B. über 4 Quartale).
- Ein Spieler-Mitarbeiter bringt **doppelte Produktivität** gegenüber einem KI-Mitarbeiter mit gleichem Skill.
- Maximal **1 Nebenrolle** zusätzlich zur eigenen Firma.
- **Insider-Regel:** Mitarbeiter sehen die Quartalszahlen vorab und dürfen in einem Sperrfenster vor der Veröffentlichung (Standard: 2 Stunden) **nicht mit der Aktie handeln.** Verstöße werden von der KI-Finanzaufsicht mit gewisser Wahrscheinlichkeit entdeckt: Strafe plus Reputationsverlust.
- Kündigen, Wechsel zur Konkurrenz und Verrat sind möglich und gewollt (soziales Drama).

---

## 8. Spieler-Einkommen und Karriere

### 8.1 Grundeinkommen
- **100 € pro Stunde**, auch offline.
- Landet in einem **Konto-Tresor**, der **maximal 8 Stunden** fasst; alles darüber verfällt.
- „Tresor leeren“ ist eine befriedigende Aktion mit Animation und Sound.

### 8.2 Jobs

| Stufe | Ab Level | Beispiel | Gehalt/h |
|---|---|---|---|
| Praktikant | 2 | Assistenz bei Brotzeit Handel | 150 € |
| Junior | 5 | Junior-Analyst bei Volta Energie | 300 € |
| Senior | 12 | Senior Sales bei NeuroPharm | 700 € |
| Teamleitung | 20 | Leitung Vertrieb | 1.300 € |
| C-Level | 25 | CFO (Spielerfirmen oder große KI-Firmen) | 2.500 € + Optionen |

- Das Gehalt läuft passiv (höchstens 12 bezahlte Stunden pro Tag).
- **Arbeitsaufgaben** alle paar Stunden (20 bis 60 Sekunden, bringen Bonus und XP), z. B.:
  - *Analyst:* Quartalszahlen einer Firma schätzen
  - *Vertrieb:* aus 3 Kundenprofilen das beste wählen
  - *Finanzen:* zwischen zwei Kreditangeboten entscheiden
- **Gehaltsentwicklung:** Berufserfahrung pro Arbeitsstunde, Beförderungen bei Schwellen (+10 bis 20 %), **Gehaltsverhandlung** einmal pro Woche (Erfolgschance nach Erfahrung, Leistung, Firmenlage), Jobwechsel (meist größtes Plus, setzt Beförderungsfortschritt zurück).

### 8.3 Anreize, bei echten Spielern zu arbeiten

| Vorteil | KI-Firma | Spielerfirma |
|---|---|---|
| XP pro Arbeitsstunde | 1× | 1,5× |
| Erfahrungszuwachs | 1× | 2× |
| Aktienoptionen | Nein | Ja |
| Führungsrollen mit Entscheidungen | Nur C-Level großer Firmen | Ab Teamleitung |
| Vorabwissen Quartalszahlen | Nein | Ja (mit Sperrfrist) |
| Erfolgsbonus | Fix | Steigt mit Firmengewinn |

---

## 9. Levelsystem

### 9.1 XP-Kurve
`XP für Level n → n+1 = round(100 × n^1.5)`
Level 1→2: 100 XP; 10→11: ca. 3.160; 20→21: ca. 8.940; 50: ca. 35.360. Maximal Level 50 (später Prestige möglich).

### 9.2 XP-Quellen (mit Missbrauchsschutz)

| Aktion | XP | Schutz |
|---|---|---|
| Trade ausführen | 10 | Nur die ersten 30 Trades pro Tag; Kauf und Rückverkauf innerhalb weniger Minuten geben keine XP (Wash-Trading) |
| Trade mit Gewinn schließen | +1 je 100 € Gewinn | Max. 500 pro Trade |
| Arbeitsstunde | 40 (×1,5 bei Spielerfirma) | Max. 12 h pro Tag |
| Arbeitsaufgabe | 50 bis 150 nach Qualität | – |
| Tägliche Mission | 200 bis 400 | 3 pro Tag |
| Täglicher Login | 50 + Streak-Bonus | – |
| Firmenquartal mit Gewinn | 500 | – |
| Erfolgreicher IPO | 5.000 | – |
| Erfolg freigeschaltet | 100 bis 10.000 | – |

### 9.3 Freischaltungen

| Level | Freischaltung |
|---|---|
| 1 | Aktien kaufen und verkaufen (Market-Order), Grundeinkommen |
| 2 | Erster Job (Praktikant) |
| 3 | Limit-Order, Watchlist |
| 5 | Stop-Loss, Staatsanleihen mit Laufzeiten, Junior-Jobs |
| 7 | Analystenberichte (Kursziele) |
| 8 | Leerverkäufe (Short) |
| 10 | **Kleinunternehmen gründen** |
| 12 | Hebel 2×, Senior-Jobs |
| 15 | Kleinkredit bis 50.000 €, Business Angel werden |
| 18 | Hebel 5×, Unternehmen auf 20 Mitarbeiter erweitern |
| 20 | GmbH gründen, Kredite bis 250.000 €, Teamleitung |
| 25 | IPO, C-Level-Jobs |
| 30 | Hebel 10×, Optionen (Calls/Puts) |
| 35 | Übernahmen, feindliche Übernahmeangebote |
| 40 | Holding: mehrere Firmen gleichzeitig |
| 50 | Titel „Börsenlegende“, goldener Profilrahmen, Hall of Fame |

Jede Freischaltung wird **groß inszeniert** (Vollbild-Overlay mit Animation, kurze Erklärung, direkte Einstiegsmission wie „Mach deinen ersten Short-Trade“).

---

## 10. Trading-Mechanik

- **Ordertypen:** Market, Limit, Stop-Loss; ab Level 8 Short; ab Level 12 Hebel (2×, später 5× und 10×); ab Level 30 Optionen.
- **Ausführung:** Spieler handeln gegen das Orderbuch aus KI-Marktmacher-Quotes und Spieler-Limit-Orders. Größere Orders verursachen **Slippage** und Preis-Impact.
- **Kosten wie echt:** Ordergebühr (z. B. 1 € fix), Spread, **Finanzierungskosten über Nacht** bei Hebel- und Short-Positionen (Dauerhebel verliert langfristig), Leihgebühr bei Shorts.
- **Steuern:** 25 % auf realisierte Gewinne (mit Verlustverrechnung). Realistisch und gleichzeitig Geldsenke.
- **Margin Call und Liquidation:** Liquidationspreis wird immer angezeigt. Bei Annäherung: Warnung; bei Erreichen: automatische Liquidation.
- **Bankrott des Spielers:** Kein Spielende. Wiedereinstieg mit Grundkapital plus sichtbarem Malus (Status „Pleitegeier“ für einige Tage, Reputationsverlust).
- **Dividenden** mit Ex-Tag, Auszahlung zum Quartalsende.

### 10.1 Zocken und schlau sein: beides belohnen
- **Für Zocker:** Pennystocks (±30 % am Tag), Hebel, Shorts, binäre Pharma-Events, Hype bei Spieler-IPOs.
- **Für Analytiker:** Echte Fundamentaldaten, die die KI-Investoren verwenden, Event-Kalender, Analystenkursziele (manchmal falsch), Branchenzusammenhänge (Ölpreis ↑ → Energie ↑, Logistik ↓), Insiderwissen über Jobs.
- Die Simulation soll so balanciert sein, dass Zocker **gelegentlich groß gewinnen**, fundierte Spieler aber **langfristig vorne liegen.**

---

## 11. Motivation, Belohnungen und Soziales

### 11.1 Belohnungen auf fünf Zeitebenen
- **Sekunden:** Live-Kursticker, Trade-Ausführung mit Animation, Sound und Haptik; XP fliegt in den Balken.
- **Minuten:** Arbeitsaufgabe erledigt, Mission abgehakt, Countdown bis zu Quartalszahlen.
- **Tag:** **Login-Streak** mit wachsendem Bonus (1 Streak-Schutz pro Woche); **3 tägliche Missionen**; **Börsenglocke um 8 Uhr** mit Eröffnungsbonus für die erste Handelsstunde; Tresor leeren.
- **Woche:** **Freundes-Liga** (Ranking nach Portfolio-Wachstum in **Prozent**, damit Neue mithalten können; Platz 1 bekommt einen Titel); Wochen-Challenge; Gehaltsverhandlung.
- **Langfristig:** Level, Firmenmeilensteine (erste 100.000 € Umsatz, erster Gewinn, IPO, **Aufnahme in den NEXA 30**), Hall of Fame.

### 11.2 Erfolge (Beispiele, lege insgesamt mindestens 40 an)
- 🎰 „All In“: 10×-Hebel-Trade mit Gewinn schließen
- 🐺 „Wolf der NEXA“: 100.000 € Gewinn an einem Tag
- 💀 „Totalverlust“: Eine Position liquidiert bekommen
- 💎 „Diamond Hands“: Aktie 14 Tage halten und mit +50 % verkaufen
- 🧠 „Orakel“: 5 Quartalszahlen in Folge richtig geschätzt
- 🏦 „Rentier“: 10.000 € Dividende in einer Woche
- 🔔 „Glockenschläger“: Eigene Firma an die Börse gebracht
- 👑 „Index-Aufsteiger“: Eigene Firma im NEXA 30

Jedes Erfolgsabzeichen bekommt ein eigenes **Pixel-Icon.**

### 11.3 Lebensstil (Statussymbole und Geldsenke)
Kaufbare Statussymbole, sichtbar im Profil, mit **laufenden Unterhaltskosten**, teils mit kleinen Boni:
Rolex (25.000 €), Porsche (150.000 €), Penthouse (1,5 Mio. €, +5 % Reputation), Privatjet (20 Mio. €), eigene Insel (100 Mio. €). Alle als Pixel-Art.

### 11.4 Zufallsereignisse (kostenlos, nie kaufbar)
„Erbschaft: +5.000 €“, „Steuerprüfung: −3 % Cash“, „Headhunter bietet +30 % Gehalt“, „Tipp aus dem Golfclub“ (stimmt in 60 % der Fälle).

### 11.5 Soziales
- **Freundes-Feed** („Ben hat mit Short auf Brotzeit +12.000 € gemacht“, „Anna hat KlarSoft an die Börse gebracht“)
- Freundesliste, Profile ansehen, Portfolios teilweise sichtbar (einstellbar)
- Business-Angel-Angebote, Jobangebote, Übernahmeangebote zwischen Spielern
- *Später:* Chat (mit Moderation)

### 11.6 Benachrichtigungen
Im MVP In-App-Benachrichtigungen. Architektur so anlegen, dass später **Web-Push** (PWA) möglich ist: Tresor voll, Margin Call, Quartalszahlen eigener Aktien, Jobangebot, Event startet. Benachrichtigungen müssen einzeln abschaltbar sein.

### 11.7 Verantwortungsvolles Design (bewusst eingebaut)
Spannung ja, aber ohne Dinge, die Stores oder Behörden problematisch finden: kein Echtgeld im Zock-Kreislauf, keine bezahlten Zufallsboxen, keine manipulativen Countdown-Kaufangebote, Push-Nachrichten optional und gedeckelt, Sounds und Animationen abschaltbar, optionale Statistik zur Spielzeit im Profil.

---

## 12. Design: maximal smooth und professionell

**Das ist einer der wichtigsten Punkte.** Das Spiel muss sich anfühlen wie eine hochwertige, moderne Neo-Broker-App (Referenzgefühl: Trade Republic, Revolut, Robinhood), kombiniert mit **liebevoller Pixel-Art** als Persönlichkeit. Eigene Identität: keine Logos, Namen oder Markenelemente anderer Apps übernehmen.

### 12.1 Stilprinzip
- **Daten bleiben clean:** dunkles Theme als Standard (helles Theme zusätzlich), viel Weißraum, klare Hierarchie, glatte Charts, große Zahlen.
- **Persönlichkeit kommt aus Pixel-Art:** Firmenlogos, Branchen-Icons, Avatare, Abzeichen, Statussymbole, Level-up-Grafiken, Börsenstier und -bär, kleine Pixel-Partikel bei Gewinnen.
- **Schriften:** *Inter* (oder eine vergleichbare, gut lesbare Sans) mit `font-variant-numeric: tabular-nums` für alle Zahlen; eine Pixelschrift wie *Silkscreen* oder *Press Start 2P* (OFL-Lizenz) nur für Überschriften, Labels, Badges und Buttons. Fonts selbst hosten.
- **Farben:** Klare Semantik: Grün = Gewinn, Rot = Verlust, eine markante Akzentfarbe für Aktionen, gedämpfte Grautöne für Flächen. Kontraste nach WCAG AA.
- **Pixel-Art technisch:** Icons als **SVG-Pixelraster-Komponenten** (z. B. `<PixelIcon grid={...} palette={...} />`), `shape-rendering: crispEdges` bzw. `image-rendering: pixelated`, nur in ganzzahligen Vielfachen skalieren.

### 12.2 Design-Tokens
Lege ein vollständiges Token-System an (CSS-Variablen + Tailwind-Konfiguration): Farben (Hintergrund-Ebenen, Text-Ebenen, Akzent, Gewinn, Verlust, Warnung, Rahmen), Typografie-Skala, Abstände (4er-Raster), Radien, Schatten, **Motion-Tokens** (Dauern und Easing-Kurven), z-Index-Ebenen. Erstelle eine **Komponenten-Showcase-Seite** (`/dev/ui`), auf der alle Komponenten und Zustände sichtbar sind.

### 12.3 Animationen und Micro-Interactions (Pflicht)
Jede Interaktion bekommt Feedback. Konkrete Anforderungen:

- **Zahlen:** Kurse und Kontostände **zählen animiert** hoch oder runter (Number Ticker). Bei Kursänderung kurzes **grünes bzw. rotes Aufblitzen** des Werts.
- **Charts:** Sanftes Einblenden, Live-Kerze wächst flüssig, Crosshair mit Tooltip beim Hovern bzw. Wischen, weicher Wechsel zwischen Zeiträumen.
- **Buttons:** Hover (Aufhellen, leichtes Anheben), Press (Scale auf ca. 0,97), Loading-Zustand, Erfolgszustand (kurzer Haken), deaktivierter Zustand. Sichtbare Fokus-Ringe für Tastatur.
- **Karten und Listen:** Hover-Hervorhebung auf dem PC, gestaffeltes Einblenden (Stagger) beim Laden, Layout-Animationen beim Sortieren und Filtern.
- **Navigation:** Flüssige Seitenübergänge, animierter Indikator in der Tab-Leiste, Shared-Element-Übergang von Aktienliste zu Aktien-Detail (Logo und Kurs gleiten an die neue Position).
- **Order-Maske:** Bottom Sheet auf dem Handy (mit Wischgeste schließbar), Modal oder Seitenpanel auf dem PC. **„Zum Kaufen halten“**-Button mit Füllanimation für große oder gehebelte Orders.
- **Trade ausgeführt:** Erfolgsanimation, kurzer 8-Bit-Sound, Haptik (`navigator.vibrate` wo verfügbar).
- **Große Gewinne:** Pixel-Konfetti, teilbare Gewinnkarte.
- **Level-up:** Vollbild-Overlay mit Pixel-Animation, Freischaltungen erscheinen nacheinander.
- **Margin Call:** Roter Rand pulsiert, leichtes Schütteln, Warnsound.
- **XP-Gewinn:** „+40 XP“ fliegt in den XP-Balken, Balken füllt sich mit Easing.
- **Tresor leeren:** Pixel-Münzen fliegen ins Konto.
- **Ladezustände:** Skeleton-Loader in der Form des späteren Inhalts, niemals leere weiße Flächen oder rohe Spinner.
- **Optimistic UI** wo sinnvoll (Watchlist, Einstellungen), mit sauberem Rollback bei Fehlern.
- **Toasts** für Bestätigungen und Fehler, gestapelt, wischbar.
- **Leere Zustände** mit Pixel-Illustration und klarer Handlungsaufforderung.

**Technische Regeln für Smoothness:**
- Standarddauern 150 bis 250 ms für UI, 300 bis 500 ms für größere Übergänge; Springs für physisch wirkende Bewegungen.
- Nur `transform` und `opacity` animieren, Ziel konstant **60 fps**, auch auf Mittelklasse-Handys.
- `prefers-reduced-motion` respektieren und in den Einstellungen Animationen und Sounds abschaltbar machen.
- Echtzeit-Updates bündeln (Throttling), damit Kurs-Ticks die UI nicht überlasten.
- Lighthouse-Ziel: Performance ≥ 90 auf Mobilgeräten.

### 12.4 Layout und Navigation
- **Handy:** Feste untere Tab-Leiste mit 5 Tabs, Safe-Area-Abstände beachten, Daumen-erreichbare Aktionen, Wischgesten.
- **PC:** Seitenleiste links statt Tab-Leiste, mehrspaltige Layouts (z. B. Chart + Orderbuch + Order-Maske nebeneinander), Tastaturkürzel (z. B. `B` kaufen, `S` verkaufen, `/` Suche).
- **Globale Suche** nach Aktien, Spielern, Firmen.

### 12.5 Die 5 Haupt-Tabs

**🏠 Start (Marktübersicht)**
Großer Live-Chart des NEXA 30, eigener Portfoliowert mit Tagesveränderung, **Event-Leiste mit Countdowns**, Top-Gewinner und -Verlierer (Spielerfirmen markiert), Newsticker, Freundes-Feed, Tresor-Status, tägliche Missionen kompakt.

**💼 Portfolio**
Gesamtwert, Cash, investiert, offene Hebelpositionen; Wertverlauf (1 T / 1 W / 1 M / Gesamt); Positionsliste mit Einstand, G/V in € und %, **Liquidationspreis rot** bei Hebelpositionen; Aufteilung als Donut (Aktien, Anleihen, Cash, Branchen); Handelshistorie inkl. Gebühren und Steuern.

**📈 Märkte**
Reiter Aktien, Staatsanleihen, Indizes (später Rohstoffe); Filter nach Branche, Größe, „nur Spielerfirmen“, Top-Mover, Dividende.
**Aktien-Detailseite:** Kerzenchart (1 min bis 1 J, umschaltbar Kerze/Linie), Orderbuch, Kennzahlen (KGV, Umsatz, Marge, Dividendenrendite, Marktkapitalisierung), Analystenrating, News, bei Spielerfirmen: Gründer, Reputation, Cap Table, Prospekt-Erfüllung. Order-Maske mit Ordertypen nach Level.

**🏢 Unternehmen**
Vor Gründung: Gründungsassistent in Schritten (Branche → Name → Pixel-Logo-Editor → Farbe → Rechtsform → Finanzierung → Zusammenfassung) mit animierten Übergängen.
Danach Dashboard: Umsatz, Gewinn, Cash, Burn-Rate, Marktanteil (vs. Konkurrenz), Abteilungen mit Quartalsentscheidungen, Mitarbeiter und Bewerber, Cap Table, IPO-Checkliste mit Fortschritt, Quartalsberichte.

**👤 Karriere / Profil**
Level und XP-Balken, nächste Freischaltung, aktueller Job und Beförderungsfortschritt, Jobbörse, Arbeitsaufgaben, Missionen, Wochen-Challenge, Erfolge, Lebensstil-Galerie, Freundes-Liga, Einstellungen.

### 12.6 Customizing
- **Pixel-Logo-Editor** (16×16, optional 24×24) mit Farbpalette, Stift, Radierer, Füllen, Spiegeln, Rückgängig; Logos erscheinen überall (Listen, Charts, Feed).
- **Firmenfarbe**, die Firmenseite und Chart-Akzent einfärbt
- **Avatar-Baukasten** aus Pixel-Teilen (Kopf, Frisur, Outfit, Accessoire), Teile über Level und Erfolge freischaltbar
- **Profilrahmen und Titel**
- **App-Akzentfarbe**, Hell/Dunkel, Chart-Stil (Kerzen, Linie, Fläche)

---

## 13. Sicherheit und Fairness

- Row Level Security auf **allen** Tabellen; Spieler dürfen nur ihre eigenen privaten Daten lesen. Öffentliche Daten (Kurse, Firmenprofile, Ranglisten) über gezielte Views.
- Alle Geldbewegungen in **einer Ledger-Tabelle** (doppelte Buchführung oder zumindest unveränderliches Transaktionsjournal), damit jeder Kontostand nachvollziehbar und prüfbar ist.
- **Idempotenz** bei Orders (Client-generierte Request-ID), Schutz vor Doppel-Klicks und Race Conditions (Sperren bzw. Serializable-Transaktionen bei Geldbewegungen).
- Rate Limits für Orders und Aktionen.
- Missbrauchsschutz: Wash-Trading-Erkennung (für XP), Begrenzung von Investitionen neuer Accounts in Spieler-IPOs, Logging verdächtiger Muster (für spätere Multi-Account-Erkennung).
- Admin-Bereich (nur für mich): Spielkonfiguration ändern, Events auslösen, Zeit vorspulen (für Tests), Spieler zurücksetzen.

---

## 14. Projektstruktur und Dokumentation

Erstelle in dieser Phase mindestens:

| Datei | Inhalt |
|---|---|
| `CLAUDE.md` | Kurzer Leitfaden für künftige Claude-Code-Sitzungen: Stack, Konventionen, wichtige Befehle, Regeln (Server-Autorität, Cent-Beträge, Tokens statt Hardcode-Farben, Animationsregeln) |
| `docs/GAME_DESIGN.md` | Vollständiges Game-Design-Dokument aus diesem Prompt, sauber gegliedert |
| `docs/ARCHITECTURE.md` | Systemarchitektur, Datenfluss, Echtzeitkonzept, Tick- und Quartalsablauf, Diagramme (Mermaid) |
| `docs/DATA_MODEL.md` | Alle Tabellen mit Feldern, Beziehungen (ER-Diagramm in Mermaid), RLS-Konzept |
| `docs/SIMULATION.md` | Formeln und Pseudocode: Kursbildung, KI-Investoren, fairer Wert, Marktanteil, Quartalsabschluss, Zentralbank, Events |
| `docs/BALANCING.md` | Alle Startwerte, erste Rechnungen zum Geldfluss (Quellen vs. Senken) und Inflationsschutz |
| `docs/DESIGN_SYSTEM.md` | Tokens, Schriften, Komponenten, Motion-Regeln, Pixel-Art-Richtlinien |
| `docs/ROADMAP.md` | Meilensteine mit Aufgaben und Abnahmekriterien |
| `docs/DECISIONS.md` | Getroffene Annahmen und Architekturentscheidungen (kurze ADRs) |
| `.env.example` | Alle benötigten Umgebungsvariablen |

Ordnerstruktur nach Features organisieren (z. B. `features/market`, `features/portfolio`, `features/company`, `features/career`, `features/progression`), geteilte UI in `components/ui`, Pixel-Art in `components/pixel`, Simulationslogik als **reine, testbare Funktionen** in einem eigenen Paket bzw. Ordner (`lib/sim`), damit sie sowohl serverseitig laufen als auch per Vitest getestet werden kann.

---

## 15. Roadmap (Vorschlag, bitte verfeinern)

| Meilenstein | Inhalt | Ergebnis |
|---|---|---|
| **M0 Fundament** | Projekt-Setup, Tokens, Komponenten-Showcase, Layout mit 5 Tabs, Auth, DB-Schema, Seed-Daten | Leere, aber schöne und navigierbare App |
| **M1 Markt** | 15 KI-Firmen, Markt-Tick, Kerzen, KI-Investoren (vereinfacht), Staatsanleihen, NEXA 30, Aktien-Detail, Kaufen/Verkaufen (Market + Limit) | Man kann live traden |
| **M2 Spieler-Kern** | Portfolio, Grundeinkommen mit Tresor, Level und XP, Freischaltungen, tägliche Missionen, Login-Streak, Erfolge (Basis), Freundes-Liga | 4 Freunde können spielen und sich messen |
| **M3 Karriere** | KI-Jobs, Arbeitsaufgaben, Beförderungen, Gehaltsverhandlung | Einkommen wächst |
| **M4 Unternehmen** | Gründung ab Level 10, Logo-Editor, Quartalssimulation, Branchennachfrage, KI-Mitarbeiter, Kredite, Insolvenz | Firmen gründen und führen |
| **M5 Sozial** | Spieler als Mitarbeiter, Business Angels, Feed, Insider-Regel | Kooperation und Drama |
| **M6 Börsengang** | Prospekt, Bookbuilding, IPO, Reputation, Guidance, Dividenden, Hauptversammlung | Spielerfirmen an der Börse |
| **M7 Risiko** | Short, Hebel, Margin Call, Liquidation, Spielerbankrott, Events, Pharma-Studien | Volles Zockgefühl |
| **M8 Feinschliff** | Lebensstil, Zufallsereignisse, Avatar-Baukasten, Web-Push, Sounds, Performance | Release für Freundestest v1 |

Jeder Meilenstein endet mit: lauffähigem Deploy auf Vercel, Tests für die Simulationslogik, kurzer Changelog-Notiz.

---

## 16. Was du jetzt konkret tun sollst

1. Stelle mir bis zu 5 wirklich wichtige Rückfragen (oder schreibe, dass du mit begründeten Annahmen fortfährst).
2. Erstelle alle Dokumente aus Abschnitt 14.
3. Setze **M0 Fundament** um, inklusive Design-Tokens, Komponenten-Showcase mit Animationen (Buttons, Karten, Number Ticker, Skeletons, Toasts, Bottom Sheet, Tab-Leiste) und einem ersten **Pixel-Icon-Set** (5 Branchen-Icons, 3 Beispiel-Firmenlogos, Münze, Stier, Bär).
4. Prüfe die App selbst auf Handy- und PC-Breite (z. B. mit Playwright-Screenshots) und korrigiere Unschönheiten.
5. Fasse zusammen, was fertig ist, welche Annahmen du getroffen hast und was du für M1 vorschlägst. **Dann stoppen und auf meine Freigabe warten.**

Qualitätsmaßstab: Lieber weniger, dafür poliert. Jede sichtbare Komponente soll so aussehen, als käme sie aus einer professionellen, preisgekrönten Finanz-App mit eigenem, verspieltem Pixel-Charakter.
