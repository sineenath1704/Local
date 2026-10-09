import { config, isAiConfigured } from "./config";
import {
  SYSTEM_PROMPT,
  buildSummaryPrompt,
  VideoAnalysisInput,
} from "./prompt";

/** Structured place data extracted from the clip (Video Content Analyzer). */
export interface PlaceData {
  place_name: string | null;
  location: {
    province: string | null;
    district: string | null;
    subdistrict?: string | null;
    gps?: string | null;
  };
  category: string[];
  activities: string[];
  price_info: { weekday: string | null; weekend: string | null; currency?: string };
  contact: { phone?: string | null; facebook?: string | null; line?: string | null };
  opening_hours?: string | null;
  otop_products: string[];
  highlights: string[];
  tags: string[];
  confidence?: {
    overall_confidence?: number;
    source_used?: string[];
    missing_info?: string[];
    warning?: string | null;
  };
}

/** Shape returned to the mobile app (superset of the app's AiSummary type). */
export interface AiSummaryResult {
  status: "ready" | "processing" | "unavailable";
  generatedAt: string;
  model: string;
  /** Natural-language summary (maps to the model's "summary"). */
  text: string;
  /** Structured extraction (place/location/price/contact/...), when available. */
  place?: PlaceData;
  // Back-compat display fields used by the current app UI:
  tags?: string[];
  highlights?: string[];
  visualTags?: string[];
  onScreenText?: string[];
  transcriptHighlights?: string[];
}

/** Try to pull a JSON object out of the model's text response. */
function extractJson(raw: string): any | null {
  // Direct parse first
  try {
    return JSON.parse(raw);
  } catch {
    // Fall back to the first {...} block
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Call the AI endpoint to generate a video summary.
 * The endpoint + token come from config (env), never from the client.
 */
export async function generateSummary(
  input: VideoAnalysisInput
): Promise<AiSummaryResult> {
  const now = new Date().toISOString();

  // No credentials configured → return a graceful stub so dev still works.
  if (!isAiConfigured()) {
    return {
      status: "unavailable",
      generatedAt: now,
      model: config.ai.model,
      text:
        "ยังไม่ได้ตั้งค่า AI (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN) บนเซิร์ฟเวอร์ — นี่คือข้อความตัวอย่าง",
      onScreenText: input.onScreenText ?? [],
    };
  }

  const userPrompt = buildSummaryPrompt(input);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);

  try {
    const res = await fetch(`${config.ai.baseUrl}/v1/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ai.authToken,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.ai.model,
        max_tokens: config.ai.maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`AI endpoint error ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data: any = await res.json();

    // Anthropic Messages API: content is an array of { type: "text", text }
    const rawText: string = Array.isArray(data?.content)
      ? data.content.map((c: any) => c?.text ?? "").join("\n").trim()
      : typeof data?.content === "string"
      ? data.content
      : "";

    const parsed = extractJson(rawText);

    // New structured format: has a "summary" string.
    if (parsed && typeof parsed.summary === "string") {
      const place: PlaceData = {
        place_name: parsed.place_name ?? null,
        location: parsed.location ?? { province: null, district: null },
        category: parsed.category ?? [],
        activities: parsed.activities ?? [],
        price_info: parsed.price_info ?? { weekday: null, weekend: null, currency: "THB" },
        contact: parsed.contact ?? {},
        opening_hours: parsed.opening_hours ?? null,
        otop_products: parsed.otop_products ?? [],
        highlights: parsed.highlights ?? [],
        tags: parsed.tags ?? [],
        confidence: parsed.confidence,
      };
      return {
        status: "ready",
        generatedAt: now,
        model: config.ai.model,
        text: parsed.summary,
        place,
        tags: place.tags,
        highlights: place.highlights,
        onScreenText: input.onScreenText ?? [],
      };
    }

    // Model replied but not as structured JSON — still return the plain text.
    return {
      status: "ready",
      generatedAt: now,
      model: config.ai.model,
      text: (parsed && typeof parsed.text === "string" ? parsed.text : rawText) || "AI ไม่ได้ส่งเนื้อหาสรุปกลับมา",
      onScreenText: input.onScreenText ?? [],
    };
  } finally {
    clearTimeout(timer);
  }
}
