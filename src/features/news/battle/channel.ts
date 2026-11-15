"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/*
 * Realtime broadcast between the players of a battle (ADR-160): each client sends its latest inputs a few times a
 * second, so the others can predict it before the server's answer arrives. Only a guess: nothing here decides
 * anything, the server's streams overwrite it. No channel in the demo.
 */
export interface BattleChannel {
  send(slot: number, from: number, data: string): void;
  close(): void;
}

export function openBattleChannel(
  battleId: number,
  onInputs: (slot: number, from: number, data: string) => void,
): BattleChannel | null {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  let ready = false;
  const channel: RealtimeChannel = supabase.channel(`battle:${battleId}`, {
    config: { broadcast: { self: false, ack: false } },
  });
  channel
    .on("broadcast", { event: "in" }, ({ payload }) => {
      const p = payload as { s?: unknown; f?: unknown; d?: unknown };
      if (typeof p.s === "number" && typeof p.f === "number" && typeof p.d === "string" && p.d.length <= 64)
        onInputs(p.s, p.f, p.d.replace(/[^0-9]/g, "0"));
    })
    .subscribe((status) => {
      ready = status === "SUBSCRIBED";
    });
  return {
    send(slot, from, data) {
      if (!ready || !data) return;
      void channel.send({ type: "broadcast", event: "in", payload: { s: slot, f: from, d: data } });
    },
    close() {
      void supabase.removeChannel(channel);
    },
  };
}
