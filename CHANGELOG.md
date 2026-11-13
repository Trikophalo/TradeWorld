# Changelog

## M0 Fundament

Erste, navigierbare Fassung ohne Spiellogik.

- Projekt: Next.js 16, TypeScript strict, Tailwind 4, Supabase-Anbindung, Vitest, Playwright, Prettier, Husky.
- Design: Tokens für Farben, Schrift, Radien, Motion und Ebenen in dunklem und hellem Theme mit fünf
  Akzentfarben; Komponentenbibliothek mit Showcase unter `/dev/ui`; erstes Pixel-Art-Set.
- App: fünf Tabs (Start, Portfolio, Märkte, Firma, Profil) mit Seitenleiste am PC und Tab-Leiste am Handy,
  Suche, Aktien-Detail mit Order-Vorschau, Anmeldung und Registrierung, Einstellungen, PWA-Grundlage.
  Ohne Supabase-Zugangsdaten läuft alles im Demo-Modus mit Beispieldaten.
- Datenbank: vollständiges Schema (132 Tabellen) mit RLS, Ledger in doppelter Buchführung, Registrierungs-Trigger
  und Stammdaten (15 KI-Firmen, Anleihen, Index, Jobs, Erfolge). Lokal gegen Postgres 16 geprüft.
- Simulation: Balancing-Konfiguration, Typen und getestete Formeln; Tick und Quartal als Entwurf.
- Dokumentation: Game Design, Architektur, Datenmodell, Simulation, Balancing, Design-System, Roadmap, ADRs.

Noch offen: Deploy auf Vercel, Test der Anmeldung gegen ein echtes Supabase-Projekt.

## Nach M0: Einstieg für neue Spieler

- **Tutorial mit Finn, dem Börsenfuchs:** 13 kurze Schritte direkt nach dem ersten Start, nicht überspringbar,
  mit Sprechblase, Spotlight und echten Aktionen (Tresor leeren, Aktie öffnen, kaufen). Abschluss: 100 XP, Level 2.
- **Ruhigerer Anfang:** Neue Spieler sehen nur Vermögen, Tresor, nächstes Ziel und Aktien. Index, Missionen,
  Events, Nachrichten, Orderbuch, Anleihen und der Firmen-Tab erscheinen mit steigendem Level.
- **Spielregeln** in einfacher Sprache unter Profil → Spielregeln.
- **Unternehmen:** eigener Markt je Firmenstufe, Schonfrist vor der Insolvenz, doppelte XP in der Alpha.
- Der Demo-Spieler startet auf Level 1.

## M1 Markt

- **Live-Markt in der Datenbank:** Die 15 KI-Firmen, vier Staatsanleihen und der NEXA 30 bewegen sich alle
  5 Sekunden, auch wenn niemand online ist. Kursanker ist der faire Wert aus den Firmenzahlen, dazu Marktmacher,
  Value-Fonds, Momentum-Trader und Kleinanleger. Blue Chips schwanken am Tag um etwa 3 %, Pennystocks um 15 bis 20 %.
  Nachbörslich (22 bis 8 Uhr) ist der Spread dreimal so groß.
- **Handeln:** Sofort- und Limit-Orders, Kauf per Stückzahl oder Geldbetrag, 1 € Gebühr, 25 % Steuer mit
  Verlusttopf, große Orders bewegen den Kurs. Doppelklicks erzeugen keine doppelten Orders.
- **Staatsanleihen** ab Level 5 mit Zinsen je Quartal und Rückzahlung bei Fälligkeit; **Limit-Orders** ab Level 3.
- **Level schon in M1:** XP für Trades (doppelt in der Alpha) und für das Tutorial, Freischaltungen prüft der Server.
- **Quartalszahlen** der KI-Firmen alle sechs Stunden mit Nachrichten auf der Aktienseite.
- **Oberfläche:** Kerzen- oder Linienchart mit live wachsender Kerze, Orderbuch, Kennzahlen, Portfolio mit
  Gewinn/Verlust, offenen Orders und Historie, Level-up-Fenster mit Finn.
- **Spätere Features sind sichtbar, aber gesperrt** (Firma, Anleihen, Limit, Liste aller Stufen).
- **Neue Sounds:** zwölf weiche Effekte in einer Tonart.
- Offen: Einspielen ins Supabase-Projekt und Test mit echten Konten.

## Nach M1: Wettbewerb und Fortschritt

- **Bruchstücke von Aktien:** Kauf per exaktem Betrag (Standard) oder per Stückzahl mit Nachkommastellen,
  Mengen-Regler mit 25/50/75/100 % statt Tippen.
- **Geschlossener Geldkreislauf:** Die Spielwelt hat einmalig 10 Mrd. €, danach entsteht kein Geld mehr.
  Grundeinkommen und Startkapital kommen aus der Staatskasse, Steuern und Gebühren fließen zurück.
- **Reichenliste:** alle Spieler und 120 KI-Tycoons live, eigener Platz mit Abstand zum nächsten, Schlagzeilen.
- **Missionen von Anfang an:** schnelle, tägliche, wöchentliche und Story-Missionen, täglicher Bonus mit Serie.
- **Endlose Level** mit Titeln und Prestige-Stufen; Finn erklärt neue Funktionen (Limit-Order, Anleihen).
- **Spielername** statt „Gast“, alle 60 Tage änderbar, Filter gegen Schimpfwörter und reservierte Namen.
- Konzept für Garagen-Startups und Firmen als Clans mit Chat (`docs/ECONOMY.md`), Umsetzung mit M4/M5.

## M4i und M4j: Aufstieg, Verbesserungen und Vertrauen

- **Verbesserungen:** Für Spielgeld wird der Tresor größer (8 bis 20 Stunden), das Grundeinkommen etwas höher
  (bis +30 %), Fachpunkte kommen schneller, es gibt bis zu 14 bezahlte Stunden am Tag und bessere
  Beförderungschancen. Jede Stufe zeigt „jetzt → danach“.
- **Karriereleiter:** Praktikum, Junior, Senior, Teamleitung, Vorstand. Für jede Stufe steht da, was fehlt:
  Level, Punkte im Hauptfach, ab Teamleitung Management, Stunden im Rang. KI-Chefs sagen mit einer Chance Ja, die mit
  jedem Punkt über der Anforderung steigt; Spieler-Chefs entscheiden selbst. Eine Beförderung bringt mindestens
  15 % oder den Lohn des neuen Rangs.
- **Skillpunkte erklärt:** Level, Arbeit, Tagesbelohnung, Missionen und Schulungen mit ihrem Fortschritt, dazu,
  wofür Skills gut sind.
- **Gewinnwege:** Die Firmenseite nennt den Engpass (Kunden oder Leute) und schätzt für jeden Hebel, was er pro
  Stunde bringt. Neu: Marketing-Kampagnen mit Glück im Ergebnis.
- **Deals unter Spielern:** Kredite, Lieferverträge (freie Kapazität gegen Gebühr) und Teilhaber, an einen
  Spieler oder offen auf der Deal-Börse. Wer Wort hält, gewinnt Vertrauen; wer zu spät zahlt oder bricht, verliert es,
  und alle sehen es auf der Visitenkarte.

## M4k und M5a: Krypto, Stufen, Ebenen, eindeutige Namen, Anwesenheit

- **Kryptowährungen ab Level 10** unter „Krypto“: 15 Coins von Stablecoins bis Memecoins, rund um die Uhr, jeder
  Kauf bewegt den Kurs über einen Topf aus Geld und Coins. Krypto-Wetter (Bullen-, Bären-, Seitwärtsmarkt),
  Ereignisse wie Hacks, Wale, Influencer und Rug Pulls, tote Memecoins werden ersetzt. Handelsmaske mit Gebühr,
  Kursrutsch-Vorschau und Grenze.
- **Eigener Coin ab Level 14** im Coin-Studio: Name, Kürzel und Pixel-Logo, Aufgaben fürs Team (Technik, Hype,
  Nutzen), Start mit eigenem Geld im Topf und Team-Anteil, Coins verbrennen, Rug-Pull-Warnung, Einstellen mit
  Auszahlung an alle Halter.
- **Verbesserungen mit Level-Stufen** und fünf neuen Verbesserungen (Mentor, Kunststudio, Effizienz, Makler,
  Hardware-Wallet).
- **Drei Ebenen beim Einrichten:** Teppich, Möbel, kleine Dinge auf Tischen und Theken.
- **Eindeutige Namen** für Firmen, Kunstwerke und Coins; wer seine Firma auflöst, gibt den Namen frei.
- **Deals nach Firmenwert:** große Deals erst mit einer wertvolleren Firma.
- **Anwesenheit:** 8 bezahlte Stunden am Tag, weniger Lohn nach 1, 2 und 3 Tagen Abwesenheit, nach 5 Tagen
  gekündigt (Benachrichtigung an Spieler und Chef).
- **Organigramm** der Firma mit Gründer, Rängen und KI-Kräften.

## Nach M5a: Ruhigeres Menü, Börse rund um die Uhr

- **Keine Nachbörse mehr:** Die Börse ist rund um die Uhr regulär offen, auch nachts ohne breiteren Spread.
- **Menü in Gruppen:** Investieren (mit Krypto), Arbeit, Unternehmen, Besitz, Du. Gesperrtes steht gesammelt unter
  „Bald frei“, das Profil auf dem Profilbild oben rechts.
- **Skills als Pfade** mit „Jetzt lernbar“, die Karte als zweite Ansicht.
- **Neue Symbole** für Deals (Vertrag mit Feder) und Grundstück (Haus mit Garten).
- **Grundstück:** drei Ebenen im Editor und detailreichere Möbel.

## Grafik-Update „handgemacht“ (ADR-108)

- **Neue Farbwelt:** Nachthimmel im dunklen, warmes Papier im hellen Thema, dahinter Punktraster und aufsteigende
  Pixel-Stäubchen.
- **Flächen und Tasten mit Gewicht:** kleine Ecken, dicke Ränder, harte Kanten; Buttons sinken beim Drücken ein und
  sprühen Funken.
- **Banner auf jeder Seite** mit Titel, einem Satz und schwebendem Pixel-Bild.
- **Titelbildschirm** bei Anmeldung und Registrierung: Sternenhimmel, Mond, Skyline mit Lichtern, Finn begrüßt.
- **Mehr Bewegung:** Inhalte kommen gestaffelt an, Icons hüpfen, Balken sind segmentiert, das Vermögen glänzt, die
  Münze am Guthaben hüpft bei jeder Änderung.

## Startseite, Währung zur Wahl, Freundescode

- **Ruhige Startseite (ADR-109):** Finn begrüßt, groß das Vermögen, genau eine nächste Aufgabe, der Tresor und drei
  Kacheln. Feed, Liga, Index und Termine stehen auf ihren eigenen Seiten.
- **Währung zur Wahl (ADR-113):** Das Spiel zeigt Euro. Unter Profil → Einstellungen kannst du stattdessen Dollar
  oder NX wählen. Es ändert sich nur das Zeichen, alle Beträge bleiben gleich. Der Stablecoin heißt jetzt
  „Eins-Stabil“.
- **Freundescode (ADR-111):** Im Profil steht dein Code (z. B. `NEXA-K7Q2`) zum Kopieren und Teilen. Wer den Code
  eines Freundes dort einträgt, bekommt einmalig 5.000 €; der Freund erfährt es per Benachrichtigung.
- **Registrierung ohne Einladungscode (ADR-114):** E-Mail, Passwort, Spielername und die 18+-Bestätigung reichen.
- **Skills der Reihe nach (ADR-115):** Jeder Skill hat eine Voraussetzung, zum Beispiel Programmierung erst nach den
  IT-Grundlagen. Die Karte ist immer zu sehen und neu gezeichnet: ruhige Kacheln ohne Farbstreifen, Linien zeigen
  den Weg, Namen sind ausgeschrieben.
- **Nur noch Sofort-Orders (ADR-117):** Limit-Orders und das Tutorial dazu sind entfernt.
- **Bedienung:** Das Mausrad zoomt die Skill-Karte, ohne die Seite zu scrollen; der Betrags-Regler zieht das
  Order-Fenster nicht mehr weg.
- **Stabilität:** Der Minuten-Job hängt nicht mehr an der Rangliste, Datenbank-Updates laufen in kleinen Schritten.
- **Börsen-News (ADR-119):** Auf der Märkte-Seite kündigen Meldungen an, welche Aktie bald steigen oder fallen
  dürfte. Etwa drei von vier treffen ein.
- **Schnellere Beförderung (ADR-118):** Eine bezahlte Stunde zählt als ganzer Tag im Rang.
- **Spieler bewegen den Markt (ADR-120):** Käufe und Verkäufe wirken etwa fünfmal so stark auf den Kurs.
- **Kündigen in einer Stunde** statt einem Tag; sofort gegen einen Tageslohn bleibt möglich.
- **Portfolio nach Branche sortierbar**, Visitenkarte ohne gestauchten Text.
