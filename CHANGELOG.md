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
