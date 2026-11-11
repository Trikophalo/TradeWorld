"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useGame } from "@/features/game/store";
import { useTutorial } from "@/features/tutorial/store";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { shouldResetPlayer } from "../session";

/**
 * Sign-in, sign-out and registration happen without a page reload. When the
 * account changes, everything kept in memory about the previous player is
 * dropped: portfolio, missions, tutorial progress and cached queries. A new
 * account then starts Finn's tutorial right away, not only after a reload.
 */
export function SessionWatcher() {
  const client = useQueryClient();
  const userId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      const previous = userId.current;
      userId.current = next;
      if (!shouldResetPlayer(previous, next)) return;
      useGame.getState().resetPlayer();
      useTutorial.getState().reset();
      client.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [client]);

  return null;
}
