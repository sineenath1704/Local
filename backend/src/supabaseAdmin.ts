import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config, isSupabaseConfigured } from "./config";

/**
 * Supabase admin client (service_role) — SERVER ONLY.
 * The service_role key bypasses RLS so the backend can write AI summaries
 * into any user's video row. Never expose this key to the mobile app.
 *
 * Lazily created so the server still boots when Supabase isn't configured
 * (falls back to the in-memory store).
 */
let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (client) return client;
  client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
