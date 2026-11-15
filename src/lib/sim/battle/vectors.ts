/**
 * Test inputs for the battle simulations (ADR-160): made-up players that hold a random direction for six ticks
 * (sometimes with the action button) or, in Aktie pumpen, tap two ticks out of three. The same generator runs in SQL
 * (tests.battle_bot in supabase/tests/9s_battles.sql), so both simulations can be compared on identical inputs.
 */
import { battleHash } from "./hash.ts";

export function botStream(seed: number, kind: string, slot: number, length: number): string {
  let out = "";
  for (let t = 0; t < length; t++) {
    if (kind === "pump") {
      out += battleHash(seed + 7, slot, t) % 3 > 0 ? "1" : "0";
      continue;
    }
    const r = battleHash(seed + 7, slot, Math.floor(t / 6));
    out += String((r % 5) + (Math.floor(r / 16) % 3 === 0 ? 5 : 0));
  }
  return out;
}
