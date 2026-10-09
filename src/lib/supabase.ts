import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client for the Local app.
 * -------------------------------------------------------------
 * URL + anon/publishable key come from env (EXPO_PUBLIC_*), never hardcoded.
 * The anon/publishable key is safe to ship in the app bundle (RLS protects
 * the data). The service_role key must NEVER be here — it lives on the backend.
 *
 * Set these in a `.env` file at the project root (see .env.example):
 *   EXPO_PUBLIC_SUPABASE_URL=...
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    "[supabase] Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY.\n" +
      "If you just created/edited .env, RESTART Metro with: npx expo start --clear\n" +
      "Auth and data features are disabled until these are set."
  );
}

// Fall back to a syntactically-valid placeholder so createClient() doesn't throw
// ("supabaseUrl is required") when env isn't loaded yet. Guard real calls with
// `isSupabaseConfigured` instead.
const safeUrl = supabaseUrl || "https://placeholder.supabase.co";
const safeKey = supabaseKey || "placeholder-anon-key";

export const supabase = createClient(safeUrl, safeKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // React Native has no URL to detect a session from.
    detectSessionInUrl: false,
  },
});
