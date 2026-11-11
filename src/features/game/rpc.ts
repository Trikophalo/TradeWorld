import type { z } from "zod";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { GAME_ERROR_KEYS, GameError, type GameErrorKey } from "./types";

export function toErrorKey(message: string | undefined): GameErrorKey {
  return (GAME_ERROR_KEYS as readonly string[]).includes(message ?? "") ? (message as GameErrorKey) : "unknown";
}

/** Calls a Postgres RPC and validates the answer, so a server change shows up as a clear error. */
export async function rpc<T>(fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new GameError("not_authenticated");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (process.env.NODE_ENV !== "production") console.warn(`[rpc ${fn}]`, error);
    throw new GameError(toErrorKey(error.message));
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.error(`[rpc ${fn}] unexpected response`, parsed.error.issues.slice(0, 3));
    throw new GameError("unknown");
  }
  return parsed.data;
}
