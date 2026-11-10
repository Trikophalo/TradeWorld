/**
 * Public Supabase settings. When they are missing the app runs in demo mode
 * (docs/DECISIONS.md, ADR-015): no sign-in, example data only.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
export const isDemoMode = !isSupabaseConfigured;
