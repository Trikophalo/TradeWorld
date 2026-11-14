# Artworks (jetzt NFTs): Pixel-Kunst, Auktionen, Sammlungen

Konzept zu ADR-080. Kunstwerke sind die freiwillige Geldsenke des Spiels: Man gibt gern Geld aus, weil man etwas
Einzigartiges besitzt, das andere sehen. Das Geld fließt an Staatskasse und Haushalte zurück, also wieder in den
Kreislauf.

## Inhalt

1. [Grundregeln](#1-grundregeln)
2. [Kunstwerke des Spiels](#2-kunstwerke-des-spiels)
3. [Eigene Kunstwerke](#3-eigene-kunstwerke)
4. [Auktionen](#4-auktionen)
5. [Beliebtheit und Marktplatz](#5-beliebtheit-und-marktplatz)
6. [Ranglisten und Profile](#6-ranglisten-und-profile)
7. [Geldflüsse](#7-geldflüsse)
8. [Schnittstelle (RPCs)](#8-schnittstelle-rpcs)

## 1. Grundregeln

- **Freischaltung:** ab Level 8 (`artworks`). Finn erklärt den Tab kurz.
- **Format:** Jedes Kunstwerk ist 32 × 32 Pixel mit bis zu 16 Farben.
- **Einzigartig:** Jedes Kunstwerk gibt es genau einmal. Es hat eine Nummer (`NFT-0042`), einen Titel und einen
  Urheber.
- **Herkunft:** Das Label unterscheidet immer „NEXA-Galerie“ (Werke des Spiels) und „von Spielername“
  (Werke von Spielern).
- **Wert:** Der Wert ist der letzte Auktionspreis. Ein noch nie verkauftes Werk hat keinen Wert.
- Kunst zählt zum Vermögen in der Reichenliste.

## 2. Kunstwerke des Spiels

- 36 Werke, erzeugt von `scripts/gen-artworks.ts`: 25 gewöhnliche, 8 seltene, 3 legendäre.
- Zu Beginn gehören sie der NEXA-Galerie.
- Die Galerie versteigert jeden Tag 4 noch unverkaufte Werke, je 6 Stunden lang.
- Startpreise: gewöhnlich 5.000 €, selten 25.000 €, legendär 150.000 €.
- Was die Galerie einnimmt, geht an die Haushalte.

## 3. Eigene Kunstwerke

- Im großen Kunst-Editor malt man 32 × 32 Pixel mit bis zu 16 Farben und gibt einen Titel.
- Der Titel geht durch den Namensfilter, das Bild durch die Prüfung auf verbotene Symbole.
- **Kosten:** Das erste Werk kostet 15.000 €, jedes weitere das 1,5-Fache des vorigen (22.500 €, 33.750 €, …; bis ADR-135 das Doppelte).
  So bleiben eigene Werke selten. Das Geld geht an die Staatskasse.
- Ein neues Werk gehört seinem Maler. Er kann es behalten oder versteigern.

## 4. Auktionen

- **Start:** Der Besitzer bietet ein Werk mit Startpreis (mindestens 100 €) und Dauer an (1, 6 oder 24 Stunden).
- **Gebote:**
  - Jedes Gebot liegt mindestens 5 % über dem aktuellen, aufgerundet auf ganze Euro.
  - Das Geld des Höchstbietenden ist reserviert. Wird er überboten, bekommt er es sofort zurück.
  - Man kann nicht auf eigene Werke bieten.
- **Kein Last-Second-Sniping:** Ein Gebot in den letzten 2 Minuten verlängert die Auktion auf 2 Minuten ab dem
  Gebot.
- **Ende:**
  - Der Höchstbietende bekommt das Werk.
  - Der Verkäufer bekommt den Preis minus 10 % Gebühr; die Gebühr geht an die Haushalte.
  - Ohne Gebot bleibt das Werk beim Besitzer.
- **Abbrechen:** Eine Auktion ohne Gebot kann der Besitzer abbrechen, eine mit Geboten nicht.
- Weil jedes Werk über Auktionen den Besitzer wechselt, steigen gefragte Werke im Preis.

## 5. Beliebtheit und Marktplatz

- **Likes:** Jeder Spieler kann jedes fremde Werk einmal liken und den Like wieder zurücknehmen.
- **Beliebtheit:**

  ```
  (Likes × 1 + Bieter × 3 + 1) / (Alter in Stunden + 2) ^ 1,5
  ```

  Neue, viel gelikte und umkämpfte Werke stehen oben, alte sinken langsam ab.

- **Marktplatz:**
  - Sortierung: „Beliebt“ (Standard), „Teuerste“, „Neueste“, „Endet bald“.
  - Filter: Alle, nur Galerie, nur Spieler, nur laufende Auktionen.
  - Besonders teure Werke und heiße Auktionen erscheinen oben als Hervorhebung.

## 6. Ranglisten und Profile

- **Größte Sammlungen:** Spieler nach Summe der Werte ihrer Werke.
- **Teuerste Kunstwerke:** Werke nach Wert, mit Besitzer und Urheber.
- **Profil:** Jedes Spielerprofil zeigt die Sammlung mit Werten. Ein Klick auf ein Werk zeigt die Details mit
  Verlauf aller Verkäufe.

## 7. Geldflüsse

| Vorgang                | von               | an                                         |
| ---------------------- | ----------------- | ------------------------------------------ |
| Werk malen             | Spieler           | Staatskasse                                |
| Gebot abgeben          | Spieler (Bargeld) | Treuhandkonto `art_escrow`                 |
| Überboten              | `art_escrow`      | zurück an den Spieler                      |
| Verkauf (Spieler-Werk) | `art_escrow`      | Verkäufer (Preis − 10 %), Haushalte (10 %) |
| Verkauf (Galerie-Werk) | `art_escrow`      | Haushalte (100 %)                          |

## 8. Schnittstelle (RPCs)

Alle Antworten sind JSON in `snake_case`. Ein Kunstwerk in Listen (`ARTWORK`):

```json
{
  "id": "uuid",
  "code": "NFT-0042",
  "title": "Abendrot über der Börse",
  "origin": "game | player",
  "rarity": "common | rare | legendary | null",
  "creator": "Nickname | null",
  "owner": "Nickname | null (null = NEXA-Galerie)",
  "pixels": { "palette": ["#rrggbb"], "grid": ["32 Zeichen x 32"] },
  "value_cents": 123400,
  "likes": 12,
  "liked": true,
  "created_at": "iso",
  "hot": 0.42,
  "auction": {
    "id": "uuid",
    "ends_at": "iso",
    "start_cents": 500000,
    "current_cents": 650000,
    "min_bid_cents": 682500,
    "bids": 3,
    "leader": "Nickname | null",
    "seller": "Nickname | null",
    "my_bid_cents": 650000
  }
}
```

`value_cents` ist `null` ohne Verkauf, `auction` ist `null` ohne laufende Auktion, `my_bid_cents` ist `null`,
wenn ich nicht führe.

| RPC                                                                 | Antwort                                                                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `get_artworks(p_sort, p_origin, p_on_auction, p_limit, p_offset)`   | `{server_time, total, entries: [ARTWORK]}`                                                                       |
| `get_artwork(p_artwork_id)`                                         | `{artwork: ARTWORK, sales: [{at, price_cents, seller, buyer}], bids: [{nickname, amount_cents, at}]}`            |
| `get_art_studio()`                                                  | `{painted, next_cost_cents, unlocked}`                                                                           |
| `create_artwork(p_request_id, p_title, p_pixels)`                   | `{artwork: ARTWORK, cost_cents, next_cost_cents}`                                                                |
| `like_artwork(p_request_id, p_artwork_id, p_like)`                  | `{likes, liked}`                                                                                                 |
| `start_auction(p_request_id, p_artwork_id, p_start_cents, p_hours)` | `{artwork: ARTWORK}`                                                                                             |
| `cancel_auction(p_request_id, p_auction_id)`                        | `{artwork: ARTWORK}`                                                                                             |
| `bid_artwork(p_request_id, p_auction_id, p_amount_cents)`           | `{artwork: ARTWORK}`                                                                                             |
| `get_art_rankings(p_limit)`                                         | `{collections: [{rank, nickname, avatar_key, count, value_cents, is_me}], artworks: [{rank, artwork: ARTWORK}]}` |
| `get_collection(p_nickname)`                                        | `{nickname, count, value_cents, artworks: [ARTWORK]}`                                                            |

`p_sort` kann `hot`, `price`, `new` oder `ending` sein, `p_origin` kann `all`, `game` oder `player` sein.

Fehler-Schlüssel:

- `artworks_locked` (Level zu niedrig)
- `artwork_not_found`
- `auction_not_found`
- `auction_ended`
- `bid_too_low`
- `own_artwork`
- `already_on_auction`
- `auction_has_bids`
- `insufficient_funds`
- `invalid_argument`
- `logo_forbidden` (verbotenes Symbol)
- die Fehler des Namensfilters für den Titel
