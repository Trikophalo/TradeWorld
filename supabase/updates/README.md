# Updates for existing databases

Every migration added after a database may already exist gets an **idempotent copy** here
(`if not exists`, guarded `do` blocks). `scripts/build-setup-sql.sh` concatenates them, plus the current
`game_config`, into `supabase/update-to-latest.sql`, which can be pasted into the Supabase SQL Editor any number
of times. `verify_local.sh` runs it twice on top of the full schema; with `NEXA_MIGRATIONS_UPTO=<timestamp>` it
simulates an older database.

The M1 migrations (`20261111000*_m1_*.sql`) are written idempotently themselves; their copies here are identical apart
from a header line. After the config, both generated files call `public.market_bootstrap()` (idempotent: fair values
once, bond series, price history only while no candle exists).

## SQL Editor in Teilen

Der Supabase SQL Editor lehnt sehr große Abfragen ab („Query is too large“). Darum legt `scripts/build-setup-sql.sh`
beide Dateien zusätzlich in Teilen unter `supabase/sql-editor/` ab (je unter 200 KB, nur ganze Dateien, jeder Teil
eine eigene Transaktion):

- **Bestehendes Projekt aktualisieren:** `update-01.sql`, `update-02.sql`, … der Reihe nach ausführen. Der letzte Teil
  schreibt die aktuelle Spielkonfiguration. Alle Teile dürfen beliebig oft laufen.
- **Neues, leeres Projekt:** `setup-01.sql`, `setup-02.sql`, … der Reihe nach ausführen.
