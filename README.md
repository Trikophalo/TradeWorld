# NEXA (Arbeitstitel)

Multiplayer-Börsen- und Wirtschaftsspiel für den Browser: handeln, Karriere machen, Firmen gründen und an die
Börse bringen. Reines Menü- und Dashboard-Spiel, nur Spielgeld, ab 18.

Stand: **M0 Fundament**. Die App ist navigierbar und läuft mit Beispieldaten; der Markt kommt mit M1.

## Starten

```bash
pnpm install
pnpm dev
```

Ohne `.env.local` läuft die App im **Demo-Modus** (keine Anmeldung, Beispieldaten). Für ein echtes Backend
`.env.example` nach `.env.local` kopieren, die Supabase-Werte eintragen und das Schema einspielen
(siehe [`supabase/README.md`](./supabase/README.md)).

- App: <http://localhost:3000>
- Komponenten-Showcase: <http://localhost:3000/dev/ui>

## Prüfen

```bash
pnpm typecheck && pnpm lint && pnpm test   # Typen, Lint, Vitest
pnpm test:e2e                              # Playwright, Handy und PC
bash supabase/tests/verify_local.sh        # Schema, RLS und Seeds gegen lokales Postgres 16
```

## Dokumentation

| Dokument                                           | Inhalt                                       |
| -------------------------------------------------- | -------------------------------------------- |
| [`CLAUDE.md`](./CLAUDE.md)                         | Regeln und Befehle für die Arbeit am Projekt |
| [`docs/GAME_DESIGN.md`](./docs/GAME_DESIGN.md)     | Game-Design-Dokument                         |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md)             | Meilensteine M0 bis M8                       |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)   | Systemarchitektur, Tick und Quartal          |
| [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md)       | Tabellen, RLS, RPCs                          |
| [`docs/SIMULATION.md`](./docs/SIMULATION.md)       | Formeln und Pseudocode                       |
| [`docs/BALANCING.md`](./docs/BALANCING.md)         | Startwerte und Geldfluss                     |
| [`docs/DESIGN_SYSTEM.md`](./docs/DESIGN_SYSTEM.md) | Tokens, Komponenten, Motion, Pixel-Art       |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md)         | Annahmen und Architekturentscheidungen       |

## Lizenzen Dritter

Inter und Silkscreen (SIL Open Font License), TradingView Lightweight Charts (Apache 2.0, Attributions-Logo im
Chart sichtbar). Pixel-Art und Sounds sind für dieses Projekt erstellt.
