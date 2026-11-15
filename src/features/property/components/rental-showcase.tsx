"use client";

import { Card } from "@/components/ui/card";
import { TILE } from "@/config/furniture";
import type { Property, Tenant } from "@/features/game/types";
import { useFitScale } from "../hooks";
import { layoutWohnwert } from "../wohnwert";
import { RoomView } from "./room-view";
import { WohnwertMeter } from "./wohnwert-meter";

/** The furnished flat of the SQL and e2e tests (Wohnwert 90). */
const SAMPLE_FLAT: Property = {
  owner: "Vera_Vermieter",
  tier: "flat",
  width: 8,
  height: 6,
  garageSlots: 0,
  wallColor: "#c8e6c9",
  floor: "laminate",
  floorsOwned: ["laminate"],
  placed: (
    [
      ["bed_double", 0, 0],
      ["sofa_leather", 5, 0],
      ["table_oak", 5, 2],
      ["lamp_table", 5, 2],
      ["vase_flowers", 6, 3],
      ["kitchen_fridge", 7, 5],
      ["shower", 0, 5],
      ["plant_monstera", 7, 2],
      ["rug_wool", 1, 3],
    ] as const
  ).map(([itemKey, x, y], i) => ({ id: `s-${i}`, itemKey, x, y, rot: 0 as const })),
  garage: [],
  valueCents: 0,
};

const SAMPLE_TENANTS: Tenant[] = [
  { id: "t1", name: "Mia F.", isAi: true, avatarKey: null, accessories: [], since: "2026-11-01T12:00:00Z" },
  {
    id: "t2",
    name: "Tim_Mieter",
    isAi: false,
    avatarKey: "coder",
    accessories: ["party_hat", "sunglasses"],
    since: "2026-11-01T12:00:00Z",
  },
];

/** /dev/ui: the Wohnwert meter and a room with walking tenants (ADR-158). */
export function RentalShowcase() {
  const { ref, scale } = useFitScale(SAMPLE_FLAT.width * TILE, 4);
  const wohnwert = layoutWohnwert(
    "flat",
    "laminate",
    SAMPLE_FLAT.placed.map((p) => p.itemKey),
  );
  return (
    <Card padding="lg" className="grid gap-5 lg:grid-cols-2">
      <div ref={ref} className="w-full">
        <RoomView property={SAMPLE_FLAT} scale={scale} tenants={SAMPLE_TENANTS} />
      </div>
      <WohnwertMeter wohnwert={wohnwert} />
    </Card>
  );
}
