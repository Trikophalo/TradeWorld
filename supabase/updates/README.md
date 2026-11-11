# Updates for existing databases

Every migration added after a database may already exist gets an **idempotent copy** here
(`if not exists`, guarded `do` blocks). `scripts/build-setup-sql.sh` concatenates them, plus the current
`game_config`, into `supabase/update-to-latest.sql`, which can be pasted into the Supabase SQL Editor any number
of times. `verify_local.sh` runs it twice on top of the full schema; with `NEXA_MIGRATIONS_UPTO=<timestamp>` it
simulates an older database.
