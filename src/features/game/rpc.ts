import type { z } from "zod";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { GAME_ERROR_KEYS, GameError, type GameErrorKey } from "./types";

export function toErrorKey(message: string | undefined): GameErrorKey {
  return (GAME_ERROR_KEYS as readonly string[]).includes(message ?? "") ? (message as GameErrorKey) : "unknown";
}

/** The server's own words for an unexpected error, short enough for a toast. */
export function serverDetail(fn: string, error: { message?: string; code?: string }): string {
  const text = (error.message ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  return [fn, error.code, text].filter(Boolean).join(" · ");
}

/** The wait a rate_limited error carries (detail "retry_after=<s>", api_rate_limited), else undefined. */
export function retryAfterSeconds(details: string | null | undefined): number | undefined {
  const m = /retry_after=(\d+)/.exec(details ?? "");
  const s = m ? Number(m[1]) : NaN;
  return Number.isFinite(s) && s > 0 ? s : undefined;
}

/** Calls a Postgres RPC and validates the answer, so a server change shows up as a clear error. */
export async function rpc<T>(fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new GameError("not_authenticated");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (process.env.NODE_ENV !== "production") console.warn(`[rpc ${fn}]`, error);
    const key = toErrorKey(error.message);
    // An error the client has no sentence for (a database error, a timeout, a missing function): keep its text.
    throw new GameError(
      key,
      key === "unknown" ? serverDetail(fn, error) : undefined,
      key === "rate_limited" ? retryAfterSeconds((error as { details?: string | null }).details) : undefined,
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.error(`[rpc ${fn}] unexpected response`, parsed.error.issues.slice(0, 3));
    const issue = parsed.error.issues[0];
    throw new GameError("unknown", `${fn}: unexpected response${issue ? ` (${issue.path.join(".")})` : ""}`);
  }
  return parsed.data;
}
