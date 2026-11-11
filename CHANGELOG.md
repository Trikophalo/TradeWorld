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
