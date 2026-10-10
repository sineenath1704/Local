import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    // Don't throw at import time — let the server start and report clearly,
    // so dev can run without the AI token (it falls back to a stub).
    return "";
  }
  return v.trim();
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num("PORT", 4000),

  ai: {
    baseUrl: required("ANTHROPIC_BASE_URL"),
    authToken: required("ANTHROPIC_AUTH_TOKEN"),
    model: process.env.ANTHROPIC_MODEL?.trim() || "minimax-m3",
    timeoutMs: num("AI_TIMEOUT_MS", 120000),
    maxTokens: num("AI_MAX_TOKENS", 1024),
  },

  // Supabase (service_role — SERVER ONLY, bypasses RLS).
  // Used to persist AI summaries into the `videos` table.
  supabase: {
    url: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  },
};

/** True only when both base URL and token are configured. */
export function isAiConfigured(): boolean {
  return Boolean(config.ai.baseUrl && config.ai.authToken);
}

/** True when the backend can read/write the Supabase database. */
export function isSupabaseConfigured(): boolean {
  return Boolean(config.supabase.url && config.supabase.serviceRoleKey);
}
