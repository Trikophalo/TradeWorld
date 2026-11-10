#!/usr/bin/env python3
"""Regenerates the generated sections of docs/DATA_MODEL.md from a live database.

Usage:
    NEXA_KEEP=1 supabase/tests/verify_local.sh          # leaves a cluster on port 54329
    python3 supabase/tools/gen_data_model.py "postgresql://postgres@127.0.0.1:54329/nexa_verify"

Only the blocks between `<!-- BEGIN GENERATED:<name> -->` and
`<!-- END GENERATED:<name> -->` are replaced; everything else in the document
is hand-written. Needs `psql` on PATH (or PG_BIN) and Python 3.9+, no packages.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "docs" / "DATA_MODEL.md"
MIGRATIONS = ROOT / "supabase" / "migrations"

# Domain per migration file (prefix of the file name after the timestamp).
DOMAINS = [
    ("config_game_time", "Konfiguration, Laufzeit und Spielzeit"),
    ("ledger", "Ledger (doppelte Buchführung)"),
    ("players_progression", "Spieler, Fortschritt und Belohnungen"),
    ("securities_market_data", "Wertpapiere, Marktdaten und Simulationsinterna"),
    ("trading", "Handel"),
    ("companies_employees", "Unternehmen und Mitarbeiter"),
    ("ipo_governance", "Börsengang und Governance"),
    ("careers", "Karriere"),
    ("social_notifications", "Soziales und Benachrichtigungen"),
    ("events_news", "Events und Nachrichten"),
    ("admin_audit", "Admin, Missbrauchsschutz und Audit"),
]
DOMAIN_ALIASES = {"extensions_enums_helpers": "admin_audit"}

# German one-line purpose per table (prose of the document is German).
PURPOSE = {
    # config / time
    "game_config": "Balancing-Werte zur Laufzeit, ein JSON-Dokument je Bereich (ADR-009). Wird aus `src/config/balance.ts` erzeugt.",
    "game_config_public_keys": "Allowlist der `game_config`-Schlüssel, die Spieler lesen dürfen (Gebühren, Steuersatz, Tresorgröße).",
    "internal_settings": "Server-Einstellungen als Ersatz für Supabase Vault (URL und Secret der Edge Functions).",
    "sim_runtime": "Singleton: Lease des Tick-Runners, Tick-Zähler, Admin-Zeitversatz, Spiel-Epoche.",
    "sim_rng_streams": "Gespeicherter Zustand der Zufallsgeneratoren je Strom, damit Ticks reproduzierbar sind (ADR-012).",
    "sim_tick_log": "Ein Eintrag pro Markt-Tick für Monitoring (Dauer, Fehler). Kurze Aufbewahrung.",
    "job_runs": "Genau-einmal-Schutz für Cron-Jobs wie den Quartalsabschluss (`job_name` + `run_key` eindeutig).",
    "market_status": "Singleton mit öffentlicher Börsenphase (vorbörslich, offen, nachbörslich) und letztem Tick.",
    "game_quarters": "Spielkalender (ADR-006): jedes Quartal als Zeile mit Beginn, Ende und Status.",
    # ledger
    "ledger_accounts": "Konten für Spieler, Firmen und System (Quellen und Senken). `balance_cents` ist ein per Trigger gepflegter Cache.",
    "ledger_transactions": "Kopf einer Buchung mit Art, Bezug und Idempotenzschlüssel. Unveränderlich.",
    "ledger_entries": "Buchungszeilen. Summe je Transaktion ist 0, kein UPDATE/DELETE.",
    # players
    "invite_codes": "Einladungscodes der geschlossenen Alpha (ADR-010).",
    "invite_code_redemptions": "Welcher Spieler welchen Einladungscode eingelöst hat.",
    "profiles": "Öffentliche Spielerkarte: Nickname, Level, XP, Reputation, Avatar, Titel. Enthält bewusst keine privaten Daten.",
    "player_private": "Privater Spielerzustand: Altersbestätigung, Gründungssperre, Berufserfahrung, Spielzeit.",
    "player_settings": "UI- und Privatsphäre-Einstellungen. Der Client darf sie direkt ändern.",
    "levels": "XP-Kurve für Level 1 bis 50.",
    "unlocks": "Freischaltungen je Level (Spec 9.3). Der Schlüssel wird serverseitig mit `has_unlock()` geprüft.",
    "player_unlocks": "Freigeschaltete Features je Spieler, mit Merker, ob das Overlay schon gezeigt wurde.",
    "xp_events": "XP-Journal (nur anhängen). `profiles.xp_total` und `level` sind daraus abgeleitet.",
    "xp_daily_counters": "Tageszähler je XP-Quelle für die Deckel (30 Trades, 12 Arbeitsstunden, 3 Missionen).",
    "vaults": "Grundeinkommens-Tresor. Der Inhalt ergibt sich aus der Zeit seit `accrual_started_at`.",
    "vault_claims": "Historie der Tresorleerungen (idempotent über `request_id`).",
    "login_streaks": "Login-Serie mit einem Streak-Schutz pro Woche.",
    "daily_logins": "Ein Eintrag je Spieler und Kalendertag mit dem ausgezahlten Bonus.",
    "mission_templates": "Vorlagen für tägliche Missionen, Wochen-Challenges und Einstiegsmissionen.",
    "player_missions": "Missionen eines Spielers je Zeitraum mit Fortschritt und Belohnung.",
    "achievements": "Katalog der Erfolge mit Pixel-Icon-Schlüssel und XP-Belohnung.",
    "player_achievements": "Fortschritt und Freischaltung der Erfolge je Spieler.",
    "cosmetic_items": "Katalog kosmetischer Teile: Avatar-Teile, Profilrahmen, Titel. Nie käuflich.",
    "player_cosmetics": "Kosmetische Teile, die ein Spieler besitzt.",
    "lifestyle_items": "Kaufbare Statussymbole mit Unterhaltskosten (Geldsenke).",
    "player_lifestyle_items": "Statussymbole im Besitz eines Spielers. Im Profil öffentlich sichtbar.",
    "random_event_definitions": "Definitionen persönlicher Zufallsereignisse mit verdeckten Parametern.",
    "player_random_events": "Zufallsereignisse, die einem Spieler passiert sind.",
    "player_bankruptcies": "Historie der Spielerpleiten mit Neustartkapital und Malus.",
    # market
    "sectors": "Die fünf Branchen mit Branchen-KGV und gemeinsamer Quartalsnachfrage.",
    "sector_sim_state": "Verdeckte Branchenschocks und Multiplikatoren der Simulation.",
    "securities": "Alles mit Kurs: Aktien, Staatsanleihen, Indizes, später Optionen und Rohstoffe.",
    "bonds": "Anleihebedingungen: Laufzeit, Kupon, Nennwert, Fälligkeit.",
    "option_contracts": "Platzhalter für Optionen ab Level 30 (Call/Put, Basispreis, Verfall).",
    "indices": "Indexdefinitionen (NEXA 30) mit Divisor.",
    "index_memberships": "Aktuelle und frühere Indexmitglieder mit Gewicht.",
    "security_quotes": "Aktueller Kurs je Wertpapier (eine Zeile, wird bei jedem Tick überschrieben).",
    "price_ticks": "Rohe Kurs-Ticks alle 5 Sekunden. Nach Tagen partitioniert, 3 Tage Aufbewahrung.",
    "candles": "Kerzen für 1 min, 5 min, 1 h, 1 Quartal und 1 Spieljahr, serverseitig aggregiert.",
    "order_book_levels": "Öffentliches Orderbuch: Marktmacher-Stufen plus aggregierte Spieler-Limits, ohne Spielerbezug.",
    "analyst_ratings": "Analystenkursziele (ab Level 7 lesbar, manchmal falsch).",
    "central_bank_state": "Singleton mit dem aktuellen Leitzins.",
    "central_bank_decisions": "Historie der Zinsentscheide mit der Geldmenge, die sie ausgelöst hat.",
    "money_supply_snapshots": "Geldmenge und Zu-/Abflüsse je Quartal aus dem Ledger.",
    "macro_indicators": "Öffentliche Makrogrößen wie Ölpreis und Konsumklima.",
    "macro_indicator_history": "Zeitreihe der Makrogrößen.",
    "security_sim_state": "Verdeckter Kursanker: fairer Wert, Sentiment, Momentum, Liquidität.",
    "ai_investors": "Die sechs KI-Investortypen mit Strategieparametern und aggregiertem Cash (ADR-005).",
    "ai_investor_holdings": "Aggregierte Bestände je KI-Investortyp und Wertpapier.",
    # trading
    "orders": "Orders der Spieler (Market, Limit, Stop; Long/Short; Hebel). Idempotent über `request_id`.",
    "positions": "Bestände je Spieler, Wertpapier, Richtung und Hebel, inklusive Liquidationspreis.",
    "trades": "Ausführungen mit Kurs, Gebühr, Steuer und realisiertem Gewinn. Unveränderlich.",
    "position_lots": "Kauf-Tranchen (FIFO) für Steuer, Haltedauer und Wash-Trading-Prüfung.",
    "margin_events": "Margin-Warnungen, Margin Calls und Zwangsliquidationen.",
    "financing_charges": "Finanzierungskosten über Nacht für Hebel und Leihgebühren für Shorts.",
    "player_tax_years": "Steuertopf je Spieler und Spieljahr mit Verlustverrechnung.",
    "security_distributions": "Dividenden (mit Ex-Tag), Kupons und Tilgungen je Wertpapier und Quartal.",
    "distribution_payouts": "Auszahlung einer Ausschüttung an einen Spieler.",
    "watchlist_items": "Persönliche Watchlist. Der Client darf direkt schreiben.",
    "portfolio_snapshots": "Regelmäßige Vermögens-Schnappschüsse für den Wertverlauf.",
    # companies
    "companies": "Öffentliches Firmenprofil für KI- und Spielerfirmen (dieselbe Simulation).",
    "company_state": "Betriebszustand für die Quartalssimulation: Qualität, Bekanntheit, Preisindex, Kapazität, Schulden.",
    "company_products": "Produktlinien mit Entwicklungsfortschritt (Zeit-Gate).",
    "company_quarter_decisions": "Quartalsentscheidungen des Managements: Preis, Marketing, Entwicklung, Finanzen.",
    "company_quarter_reports": "Quartalszahlen. Öffentlich ab `published_at`, für Insider schon vorher.",
    "sector_quarter_stats": "Veröffentlichte Branchennachfrage und Summen je Quartal.",
    "company_events": "Öffentliche Firmenchronik: Gründung, Umwandlung, Meilensteine, IPO, Insolvenz.",
    "employee_traits": "Eigenschaften von KI-Mitarbeitern mit ihren Effekten.",
    "employees": "KI-Mitarbeiter und Spieler-Mitarbeiter einer Firma.",
    "applicants": "Bewerberpool, der jedes Quartal je Firma neu erzeugt wird.",
    "poaching_offers": "Abwerbeversuche bei der Konkurrenz.",
    "stock_option_grants": "Aktienoptionen für Spieler-Mitarbeiter mit Vesting.",
    "stock_option_vesting_events": "Vesting-Schritte je Quartal.",
    "loans": "Kredite der KI-Bank an Firmen und der Kleinkredit für Spieler.",
    "loan_payments": "Zins- und Tilgungszahlungen.",
    "cap_table_entries": "Aktionärsregister (Cap Table). Vor dem IPO maßgeblich, danach Gründer, Insider und Streubesitz.",
    "share_issuances": "Historie der Aktienzahl: Gründung, Angel-Runden, IPO, Kapitalerhöhung, Rückkauf.",
    "share_lockups": "Haltefristen, zum Beispiel der Gründer-Lock-up nach dem IPO.",
    "capital_injections": "Private Einlagen des Gründers (je Phase gedeckelt).",
    "insolvency_proceedings": "Insolvenzverfahren mit Rettungsfenster und Gründungssperre.",
    "takeover_offers": "Rettungsübernahmen und (später) freundliche oder feindliche Übernahmeangebote.",
    # ipo / governance
    "angel_offers": "Vorbörsliche Beteiligungsangebote zwischen Firma und Investor (Spieler oder KI).",
    "ipos": "Börsengang mit Prospektkopf, Preisspanne, Zeichnungsfrist und Ergebnis.",
    "ipo_prospectus_forecasts": "Prospekt: verbindliche Umsatzprognose für vier Quartale samt automatischer Prüfung.",
    "ipo_use_of_proceeds": "Prospekt: geplante und tatsächliche Mittelverwendung in Prozent.",
    "ipo_subscriptions": "Zeichnungen von Spielern und KI-Fonds im Bookbuilding.",
    "guidance": "Prognose des Gründers für das nächste Quartal und ihr Ergebnis.",
    "shareholder_votes": "Abstimmungen der Hauptversammlung (Dividende, Abberufung des CEO).",
    "shareholder_vote_ballots": "Abgegebene Stimmen mit Aktiengewicht (geheim).",
    "corporate_actions": "Kapitalmaßnahmen: Dividende, Rückkauf, Kapitalerhöhung.",
    "reputation_events": "Journal der Reputationsänderungen eines Gründers.",
    "insider_blackout_windows": "Sperrfenster vor Quartalszahlen, in denen Insider nicht handeln dürfen.",
    "insider_violations": "Insider-Trades im Sperrfenster, auch unentdeckte (KI-Finanzaufsicht).",
    # careers
    "job_definitions": "Jobbörse der KI-Firmen vom Praktikanten bis zum C-Level.",
    "player_jobs": "Anstellung eines Spielers mit Gehalt, Erfahrung und Beförderungsstufe.",
    "salary_payouts": "Passive Gehaltszahlungen (höchstens 12 bezahlte Stunden pro Tag).",
    "work_task_definitions": "Arten von Arbeitsaufgaben (20 bis 60 Sekunden).",
    "work_tasks": "Aufgaben eines Spielers mit Aufgabenstellung, Antwort und Bewertung.",
    "work_task_solutions": "Lösungen der Arbeitsaufgaben. Getrennt gespeichert, damit sie nie zum Client gelangen.",
    "salary_negotiations": "Gehaltsverhandlungen (eine pro Woche).",
    "job_offers": "Jobangebote von Spielerfirmen (Gehalt plus Optionen) und Headhuntern.",
    # social
    "friendships": "Freundschaftsanfragen und Freundschaften (eine Zeile je Paar).",
    "feed_items": "Einträge im Freundes-Feed, vom Server erzeugt.",
    "league_seasons": "Liga-Saison je Kalenderwoche.",
    "league_entries": "Öffentliche Rangliste: Wachstum in Prozent und Platz, nie absolute Beträge.",
    "league_entry_baselines": "Vermögens-Basiswerte hinter den Prozentwerten der Liga.",
    "notification_types": "Katalog der Benachrichtigungsarten mit Standardwerten.",
    "notifications": "In-App-Benachrichtigungen, live über Realtime (ADR-013).",
    "notification_preferences": "Schalter je Spieler und Benachrichtigungsart für In-App und Push.",
    "push_subscriptions": "Web-Push-Abos der PWA.",
    "push_deliveries": "Push-Ausgang und Zustellprotokoll (Tagesdeckel).",
    # events / news
    "scheduled_events": "Angekündigte Events mit Countdown: Zinsentscheid, Quartalszahlen, Studien, Glocken.",
    "scheduled_event_secrets": "Verdeckte Parameter geplanter Events (zum Beispiel Erfolgswahrscheinlichkeit einer Studie).",
    "macro_event_definitions": "Definitionen zufälliger Makro-Events mit verdeckter Wirkung.",
    "macro_events": "Aktive und vergangene Makro-Events (öffentliche Schlagzeile).",
    "news_templates": "Textvorlagen mit Variablen für Nachrichten.",
    "news_items": "Veröffentlichte Nachrichten für Ticker und Aktien-Detailseite.",
    "news_item_effects": "Verdeckter Sentiment-Impuls je Nachricht.",
    # admin / audit
    "admin_users": "Admins des Spiels. Nur per SQL oder Service-Rolle pflegbar.",
    "admin_actions": "Audit-Log der Admin-Aktionen (nur anhängen).",
    "rate_limits": "Zähler für Rate Limits je Spieler und Aktion.",
    "suspicious_activity": "Protokoll verdächtiger Muster: Wash-Trading, Mehrfachkonten, Limit-Verstöße.",
    "player_requests": "Idempotenz-Journal für Spieleraktionen ohne eigene Tabelle.",
    "player_login_events": "Gehashte Login-Merkmale für spätere Mehrfachkonten-Erkennung.",
}

# FK targets that almost every table references; left out of the ER diagrams.
ER_SKIP_TARGETS = {"game_quarters", "ledger_transactions"}


def psql_json(dsn: str, sql: str):
    psql = os.path.join(os.environ.get("PG_BIN", ""), "psql") if os.environ.get("PG_BIN") else "psql"
    out = subprocess.run(
        [psql, "-X", "-At", "-v", "ON_ERROR_STOP=1", dsn, "-c", sql],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    return json.loads(out) if out else []


def table_domains() -> dict[str, str]:
    result: dict[str, str] = {}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        key = re.sub(r"^\d+_", "", path.stem)
        key = DOMAIN_ALIASES.get(key, key)
        for name in re.findall(r"^create table public\.(\w+)", path.read_text(), flags=re.M):
            result[name] = key
    return result


COLUMNS_SQL = """
select coalesce(json_agg(t order by t.table_name, t.ordinal), '[]') from (
  select c.relname as table_name, a.attnum as ordinal, a.attname as column_name,
         format_type(a.atttypid, a.atttypmod) as data_type,
         a.attnotnull as not_null,
         pg_get_expr(d.adbin, d.adrelid) as default_expr,
         a.attidentity <> '' as is_identity,
         exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'p' and a.attnum = any (k.conkey)) as is_pk,
         (select string_agg(distinct format('%s.%s', fc.relname, fa.attname), ', ')
            from pg_constraint k
            join pg_class fc on fc.oid = k.confrelid
            join pg_attribute fa on fa.attrelid = k.confrelid
                 and fa.attnum = k.confkey[array_position(k.conkey, a.attnum)]
           where k.conrelid = c.oid and k.contype = 'f' and a.attnum = any (k.conkey)) as fk
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
) t
"""

ACCESS_SQL = """
select coalesce(json_agg(t), '[]') from (
  select c.relname as table_name,
         has_table_privilege('authenticated', c.oid, 'select') as can_select,
         (select coalesce(json_agg(json_build_object('name', p.polname, 'cmd', p.polcmd) order by p.polcmd, p.polname), '[]')
            from pg_policy p where p.polrelid = c.oid) as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
) t
"""

FK_SQL = """
select coalesce(json_agg(t), '[]') from (
  select distinct c.relname as child, fc.relname as parent,
         (select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
           where a.attrelid = k.conrelid and a.attnum = any (k.conkey)) as cols
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_class fc on fc.oid = k.confrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_namespace fn on fn.oid = fc.relnamespace
   where k.contype = 'f' and n.nspname = 'public' and fn.nspname = 'public' and not c.relispartition
) t
"""

CMD = {"r": "SELECT", "a": "INSERT", "w": "UPDATE", "d": "DELETE", "*": "ALL"}


def short_default(expr: str | None, identity: bool) -> str:
    if identity:
        return "identity"
    if not expr:
        return ""
    expr = re.sub(r"::[a-z_ .\"]+(\[\])?", "", expr)
    expr = expr.replace("public.", "")
    return expr if len(expr) <= 32 else expr[:29] + "..."


def access_label(acc: dict) -> str:
    if not acc["can_select"]:
        return "`internal` (nur `service_role`)"
    parts = [f"{CMD.get(p['cmd'], p['cmd'])} „{p['name']}“" for p in acc["policies"]]
    return "; ".join(parts)


def build_tables(dsn: str) -> str:
    domains = table_domains()
    columns = psql_json(dsn, COLUMNS_SQL)
    access = {a["table_name"]: a for a in psql_json(dsn, ACCESS_SQL)}
    by_table: dict[str, list] = {}
    for col in columns:
        by_table.setdefault(col["table_name"], []).append(col)

    missing = sorted(set(by_table) - set(PURPOSE))
    if missing:
        raise SystemExit(f"PURPOSE text missing for: {', '.join(missing)}")

    out: list[str] = []
    for number, (key, title) in enumerate(DOMAINS, start=1):
        tables = sorted(t for t in by_table if domains.get(t) == key)
        out.append(f"### 3.{number} {title}\n")
        out.append(f"{len(tables)} Tabellen.\n")
        for t in tables:
            out.append(f"#### `{t}`\n")
            out.append(f"{PURPOSE[t]}\n")
            out.append(f"Zugriff für `authenticated`: {access_label(access[t])}\n")
            out.append("| Spalte | Typ | Pflicht | Hinweis |")
            out.append("|---|---|---|---|")
            for c in by_table[t]:
                notes = []
                if c["is_pk"]:
                    notes.append("PK")
                if c["fk"]:
                    notes.append(f"FK → `{c['fk']}`")
                default = short_default(c["default_expr"], c["is_identity"])
                if default:
                    notes.append(f"Default `{default}`")
                data_type = c["data_type"].replace("timestamp with time zone", "timestamptz")
                out.append(
                    f"| `{c['column_name']}` | `{data_type}` | {'ja' if c['not_null'] else ''} | {', '.join(notes)} |"
                )
            out.append("")
    unassigned = sorted(t for t in by_table if domains.get(t) not in {k for k, _ in DOMAINS})
    if unassigned:
        raise SystemExit(f"tables without domain: {unassigned}")
    return "\n".join(out).rstrip() + "\n"


def build_er(dsn: str) -> str:
    domains = table_domains()
    fks = psql_json(dsn, FK_SQL)
    out: list[str] = []
    number = 0
    for key, title in DOMAINS:
        edges = [
            f for f in fks
            if domains.get(f["child"]) == key
            and (f["parent"] not in ER_SKIP_TARGETS or domains.get(f["parent"]) == key)
        ]
        if not edges:
            continue
        number += 1
        out.append(f"### 4.{number} {title}\n")
        out.append("```mermaid")
        out.append("erDiagram")
        for f in sorted(edges, key=lambda e: (e["parent"], e["child"], e["cols"])):
            out.append(f'  {f["parent"]} ||--o{{ {f["child"]} : "{f["cols"]}"')
        out.append("```\n")
    return "\n".join(out).rstrip() + "\n"


def build_stats(dsn: str) -> str:
    row = psql_json(dsn, """
      select json_build_object(
        'tables', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition),
        'views', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind = 'v'),
        'policies', (select count(*) from pg_policies where schemaname = 'public'),
        'indexes', (select count(*) from pg_indexes where schemaname = 'public'),
        'enums', (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
                   where n.nspname = 'public' and t.typtype = 'e'),
        'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public'))
    """)
    return (
        f"Stand der Generierung: **{row['tables']} Tabellen**, {row['views']} Views, {row['enums']} Enums, "
        f"{row['policies']} RLS-Policies, {row['indexes']} Indizes, {row['functions']} Funktionen.\n"
    )


def replace_block(text: str, name: str, content: str) -> str:
    pattern = re.compile(
        rf"(<!-- BEGIN GENERATED:{name} -->\n).*?(<!-- END GENERATED:{name} -->)", flags=re.S
    )
    if not pattern.search(text):
        raise SystemExit(f"marker for block '{name}' not found in {DOC}")
    return pattern.sub(lambda m: m.group(1) + content + m.group(2), text)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    dsn = sys.argv[1]
    text = DOC.read_text()
    text = replace_block(text, "stats", build_stats(dsn))
    text = replace_block(text, "tables", build_tables(dsn))
    text = replace_block(text, "er", build_er(dsn))
    DOC.write_text(text)
    print(f"updated {DOC}")


if __name__ == "__main__":
    main()
