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
