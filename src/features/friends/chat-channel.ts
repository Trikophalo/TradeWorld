"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/*
 * A Realtime broadcast per open chat with friends (ADR-164): after sending, a client says "there is something new",
 * the others with the chat open fetch it at once. The ping carries nothing (no text, no player): reading still goes
 * through get_chat(), which checks membership. Polling stays as the fallback. No channel in the demo.
 */
export interface ChatChannel {
  ping(): void;
  close(): void;
}

export function openChatChannel(chatId: number, onPing: () => void): ChatChannel | null {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  let ready = false;
  const channel: RealtimeChannel = supabase.channel(`friend-chat:${chatId}`, {
    config: { broadcast: { self: false, ack: false } },
  });
  channel
    .on("broadcast", { event: "new" }, () => onPing())
    .subscribe((status) => {
      ready = status === "SUBSCRIBED";
    });
  return {
    ping() {
      if (ready) void channel.send({ type: "broadcast", event: "new", payload: {} });
    },
    close() {
      void supabase.removeChannel(channel);
    },
  };
}
