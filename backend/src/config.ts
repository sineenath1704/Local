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
    /**
     * งบ token ต่อคำตอบของโมเดล
     * -------------------------------------------------------------
     * prompt สรุปขอ JSON ~70 คีย์ (กิน 1,400–3,000 tokens)
     *
     * ค่านี้เคยเป็น 1024 (default ในโค้ด ไม่ใช่ env) → โมเดลตอบกลาง JSON
     * → `place` ว่าง → Google Places ไม่มีอะไรให้ค้น → สรุดว่างเงียบ ๆ
     * โดยไม่มีใครบอกได้ว่าหายตรงไหน
     *
     * ค่าเริ่มต้นจึงต้องพอสำหรับสรุปเต็ม และ "ไม่ได้ตั้ง env" ต้องไม่กลายเป็น
     * เหตุผลที่สรุดเสีย (ค่าเริ่มต้นคือค่าที่ปลอดภัย ไม่ใช่ค่าที่พังเงียบ)
     */
    maxTokens: num("AI_MAX_TOKENS", 32768),
    /**
     * Proofread pass — a copy-edit round that fixes misspelled Thai in the
     * summary + narration. Costs one extra model call per stage, so it can
     * be switched off with PROOFREAD_ENABLED=off.
     */
    proofreadEnabled: flag("PROOFREAD_ENABLED", true),
    /** Model for the proofread pass — empty = same model as the analyzer. */
    proofreadModel: process.env.AI_PROOFREAD_MODEL?.trim() || "",
    /**
     * Video Content Analyzer V2 — สายสรุปแบบการ์ด (โครงสร้าง + เตือนข้อมูล)
     * -------------------------------------------------------------
     * ปิด (ค่าเริ่มต้น) = ระบบทำงานเหมือนเดิมทุกอย่าง
     * เปิด = สรุปด้วย prompt/schema V2 → ได้ `card` + ข้อความการ์ด และ
     *       ไม่เขียนคำบรรยายรอบที่สอง (ดู `aiClient.ts`)
     *
     * คู่กับ `PROOFREAD_ENABLED=off` ถ้าต้องการ "AI รอบเดียว" จริง ๆ
     */
    vcaV2Enabled: flag("VCA_V2_ENABLED", false),
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

/**
 * เตือนตอนเริ่มเซิร์ฟเวอร์: งบ token น้อยเกินไป = สรุดว่างแบบเงียบ
 * -------------------------------------------------------------
 * prompt สรุปกิน 1,400–3,000 tokens ถ้างบน้อยกว่านั้น โมเดลจะตอบกลาง JSON
 * → `place` ว่าง → Google Places ไม่มีอะไรให้ค้น → สรุดว่าง โดยไม่มี error
 *
 * เคยเกิดจริงบน Vercel เพราะ "ไม่ได้ตั้ง env" → ไปใช้ default 1024 ในโค้ด
 * เลยเตือนไว้ ไม่ให้เป็นเงื่อนไขที่ต้องเดา
 */
const MIN_SUMMARY_MAX_TOKENS = 4096;
if (config.ai.maxTokens < MIN_SUMMARY_MAX_TOKENS) {
  console.warn(
    `[config] ⚠️ AI_MAX_TOKENS = ${config.ai.maxTokens} น้อยเกินไป — ` +
      `prompt สรุปต้องการ ${MIN_SUMMARY_MAX_TOKENS}+ tokens ` +
      `(โมเดลจะตอบกลาง JSON แล้วสรุดจะว่างแบบไม่มี error) — ` +
      `ตั้งค่าใน Vercel หรือแก้ค่าเริ่มต้นที่ backend/src/config.ts`
  );
}

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
