/**
 * Public Supabase settings. When they are missing the app runs in demo mode
 * (docs/DECISIONS.md, ADR-015): no sign-in, example data only.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
/**
 * Supabase now shows a "publishable" key (sb_publishable_...) where it used to
 * show the "anon" key. Both work the same way here; either variable name is accepted.
 */
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
export const isDemoMode = !isSupabaseConfigured;
