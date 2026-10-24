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

/** Boolean from an env var. Anything that isn't clearly "off" counts as on. */
function flag(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  return v !== "off" && v !== "false" && v !== "0" && v !== "no";
}

export const config = {
  port: num("PORT", 4000),

  ai: {
    baseUrl: required("ANTHROPIC_BASE_URL"),
    authToken: required("ANTHROPIC_AUTH_TOKEN"),
    model: process.env.ANTHROPIC_MODEL?.trim() || "minimax-m3",
    timeoutMs: num("AI_TIMEOUT_MS", 120000),
    maxTokens: num("AI_MAX_TOKENS", 1024),
    /**
     * Proofread pass — a copy-edit round that fixes misspelled Thai in the
     * summary + narration. Costs one extra model call per stage, so it can
     * be switched off with PROOFREAD_ENABLED=off.
     */
    proofreadEnabled: flag("PROOFREAD_ENABLED", true),
    /** Model for the proofread pass — empty = same model as the analyzer. */
    proofreadModel: process.env.AI_PROOFREAD_MODEL?.trim() || "",
  },

  // Supabase (service_role — SERVER ONLY, bypasses RLS).
  // Used to persist AI summaries into the `videos` table.
  supabase: {
    url: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  },

  // Google Places (SERVER ONLY) — verify a specific place & get coordinates.
  places: {
    googleKey: required("GOOGLE_PLACES_API_KEY"),
  },

  // Google AI / Gemini (SERVER ONLY) — transcribe the clip's speech.
  // Gemini reads video/mp4 directly, so we need no ffmpeg, no GCS bucket,
  // and none of the Cloud Speech-to-Text plumbing.
  gemini: {
    apiKey: required("GEMINI_API_KEY"),
    model: process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
    timeoutMs: num("GEMINI_TIMEOUT_MS", 120000),
  },

  // OTOP นวัตวิถี registry (CDD) — verify a community by its Village_ID.
  // URL pattern: https://otopapi.cdd.go.th:3000/{token}/{service}/{id}
  otop: {
    baseUrl: process.env.OTOP_API_BASE_URL?.trim() || "https://otopapi.cdd.go.th:3000",
    token: required("OTOP_API_TOKEN"),
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

/** True when Google Places lookups are available. */
export function isPlacesConfigured(): boolean {
  return Boolean(config.places.googleKey);
}

/** True when Gemini transcription is available. */
export function isGeminiConfigured(): boolean {
  return Boolean(config.gemini.apiKey);
}

/** True when the OTOP registry lookup is available. */
export function isOtopConfigured(): boolean {
  return Boolean(config.otop.token);
}
