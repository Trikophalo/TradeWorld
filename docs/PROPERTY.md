# Grundstück: Wohnen, Einrichten, Garage

Konzept zu ADR-082. Das eigene Zuhause ist eine freiwillige Geldsenke und ein Statussymbol. Man kauft sich hoch,
richtet ein und zeigt es her. Alles Geld für Wohnungen, Möbel, Böden und Autos geht an die Haushalte, also
zurück in den Kreislauf.

## 1. Regeln

- **Freischaltung:** Tab „Grundstück“ ab Level 4 (`property`).
- **Stufen** (`BALANCE.property.tiers`):

  | Stufe       | Preis      | Fläche (Felder) | Garage  | ab Level |
  | ----------- | ---------- | --------------- | ------- | -------- |
  | Wohnung     | 25.000 €   | 8 × 6           | –       | 4        |
  | Apartment   | 100.000 €  | 10 × 8          | –       | 8        |
  | Haus        | 500.000 €  | 13 × 9          | 2 Autos | 14       |
  | Villa       | 2,5 Mio. € | 16 × 11         | 4 Autos | 22       |
  | Luxus-Villa | 15 Mio. €  | 20 × 13         | 8 Autos | 30       |

- **Upgrade:** Man kann auch Stufen überspringen. Die alte Bleibe wird zu 50 % angerechnet. Beim Umzug wird die
  Einrichtung geleert: Alle Möbel kommen ins Inventar, die Autos bleiben in der Garage.
- **Möbel** (`src/config/furniture.ts`, erzeugt von `scripts/gen-furniture.ts`):
  - 65 Stücke in 10 Kategorien: Sitzen, Tische, Betten, Küche, Bad, Pflanzen, Deko, Technik, Teppiche, Spaß.
  - Fünf Preisklassen: Günstig, Standard, Edel, Luxus, Ultra (25 € bis 1,5 Mio. €).
  - Jedes gekaufte Stück liegt im Inventar, bis man es aufstellt.
  - Teppiche liegen unter den Möbeln. Sonst darf sich nichts überlappen.
  - Möbel lassen sich um 90° drehen.
- **Boden und Wand:** Bodenbeläge kauft man einmal (Laminat gratis bis Gold für 1 Mio. €) und kann sie dann in jeder
  Bleibe verwenden. Die Wandfarbe ist frei wählbar aus 16 Farben.
- **Garage:** Ab dem Haus. Autos von 9.000 € bis 7,5 Mio. €, alle mit ausgedachten Marken.
- **Verkaufen:** Möbel aus dem Inventar und Autos lassen sich für 40 % zurückverkaufen.
- **Vermögen:** Die Bleibe zählt mit 50 % ihres Preises, Möbel, Böden und Autos mit 40 %.
- **Herzeigen:** Jedes Spielerprofil zeigt Zuhause und Garage der anderen.

## 2. Schnittstelle (RPCs)

`PROPERTY`:

```json
{
  "owner": "Nickname",
  "tier": "flat | apartment | house | villa | luxury_villa | null",
  "width": 8,
  "height": 6,
  "garage_slots": 0,
  "wall_color": "#f3efe4",
  "floor": "laminate",
  "floors_owned": ["laminate", "parquet"],
  "placed": [{ "id": "uuid", "item_key": "sofa_leather", "x": 1, "y": 2, "rot": 0 }],
  "garage": [{ "id": "uuid", "car_key": "car_sports", "slot": 0 }],
  "value_cents": 1234500
}
```

`INVENTORY` (nur eigene): `{"furniture": [{"id", "item_key"}], "cars": []}`. Hier stehen nur Möbel, die nicht
aufgestellt sind. Autos stehen immer in der Garage.

| RPC                                                          | Antwort                                              |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| `get_property(p_nickname)` (`null` = ich)                    | `{property: PROPERTY, inventory: INVENTORY \| null}` |
| `buy_home(p_request_id, p_tier)`                             | `{property, inventory, cost_cents}`                  |
| `buy_furniture(p_request_id, p_item_key, p_count)`           | `{property, inventory}`                              |
| `buy_floor(p_request_id, p_material)`                        | `{property, inventory}`                              |
| `save_layout(p_request_id, p_wall_color, p_floor, p_placed)` | `{property, inventory}`                              |
| `buy_car(p_request_id, p_car_key)`                           | `{property, inventory}`                              |
| `sell_item(p_request_id, p_kind, p_id)`                      | `{property, inventory, refund_cents}`                |

- `p_placed` ist die vollständige Aufstellung: `[{id, x, y, rot}]`. Alles, was nicht darin steht, liegt danach im
  Inventar.
- `p_kind` ist `furniture` oder `car`.

Fehler-Schlüssel:

- `property_locked` (Level zu niedrig für die Stufe oder den Tab)
- `no_home` (Möbel aufstellen oder Auto ohne Bleibe)
- `invalid_tier` (gleiche oder niedrigere Stufe)
- `item_not_found`
- `layout_invalid` (außerhalb oder überlappend)
- `floor_not_owned`
- `garage_full`
- `insufficient_funds`
- `invalid_argument`
