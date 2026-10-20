import { config, isAiConfigured } from "./config";
import { AiUpstreamError } from "./aiErrors";
import {
  SYSTEM_PROMPT,
  buildSummaryPrompt,
  VIDEO_PROMPT,
  VideoAnalysisInput,
  CAPTION_SYSTEM_PROMPT,
  buildCaptionPrompt,
  CaptionInput,
  SUMMARY_NARRATION_PROMPT,
  buildNarrationPrompt,
} from "./prompt";

/** Structured place data extracted from the clip (Video Content Analyzer). */
export interface PlaceData {
  place_name: string | null;
  /** Community / village name (separate from the specific place_name). */
  community?: string | null;
  location: {
    province: string | null;
    district: string | null;
    subdistrict?: string | null;
    gps?: string | null;
  };
  atmosphere?: string | null;
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

  // Build comprehensive prompt containing transcript from Speech-to-Text,
  // on-screen text, visual description, and anti-hallucination rules.
  const promptText = buildSummaryPrompt(input);
  const messageContent: any = input.videoUrl
    ? [
        { type: "text", text: promptText },
        { type: "video", source: { type: "url", url: input.videoUrl, fps: 1 } },
      ]
    : promptText;

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
        temperature: 0.0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: messageContent }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new AiUpstreamError(res.status, errText);
    }

    const data: any = await res.json();

    // Anthropic Messages API: content is an array of { type: "text", text }
    const rawText: string = Array.isArray(data?.content)
      ? data.content.map((c: any) => c?.text ?? "").join("\n").trim()
      : typeof data?.content === "string"
      ? data.content
      : "";

    const parsed = extractJson(rawText);

    if (parsed) {
      // Diagnostic logging of reasoning and extracted fields
      // eslint-disable-next-line no-console
      console.log("[generateSummary] reasoning =", parsed.reasoning);
      // eslint-disable-next-line no-console
      console.log("[generateSummary] place_name =", parsed.place_name, "community =", parsed.community, "location =", parsed.location);
    }

    // New structured format: has a "summary" string.
    if (parsed && typeof parsed.summary === "string") {
      const place: PlaceData = {
        place_name: parsed.place_name ?? null,
        community: parsed.community ?? null,
        location: parsed.location ?? { province: null, district: null },
        atmosphere: parsed.atmosphere ?? null,
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

/**
 * Ask the AI to suggest 2–3 captions for a post, using the clip's AI summary
 * + location as the main source. Returns a list of caption strings.
 */
export async function generateCaptions(input: CaptionInput): Promise<string[]> {
  if (!isAiConfigured()) {
    // Graceful stub so the feature works before the token is set.
    const place = input.locationName || input.province || "ชุมชน";
    return [
      `วันนี้พามาเที่ยว ${place} บรรยากาศดีมากกก 🌿`,
      `${place} สวยจนต้องมาเอง มาสัมผัสวิถีชุมชนกัน ✨`,
      `แวะ ${place} มาเติมพลังใจ 😊`,
    ];
  }

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
        max_tokens: 512,
        system: CAPTION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildCaptionPrompt(input) }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new AiUpstreamError(res.status, errText);
    }
    const data: any = await res.json();
    const rawText: string = Array.isArray(data?.content)
      ? data.content.map((c: any) => c?.text ?? "").join("\n").trim()
      : typeof data?.content === "string"
      ? data.content
      : "";

    const parsed = extractJson(rawText);
    if (parsed && Array.isArray(parsed.captions)) {
      return parsed.captions.filter((c: unknown) => typeof c === "string").slice(0, 3);
    }
    // Fallback: split lines if JSON wasn't returned.
    return rawText
      .split("\n")
      .map((l) => l.replace(/^[-*\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 3);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stage 2: Turn structured JSON into an engaging 2-paragraph narrative
 * for display in the AI summary panel.
 */
export async function generateNarration(analysisJson: any): Promise<string> {
  const place = analysisJson?.place ?? analysisJson;
  const placeName = place?.place_name ?? null;
  const province = place?.location?.province ?? null;
  const district = place?.location?.district ?? null;
  const atmosphere = place?.atmosphere ?? analysisJson?.atmosphere ?? null;
  const activities: string[] = place?.activities ?? [];
  const highlights: string[] = place?.highlights ?? analysisJson?.highlights ?? [];

  const locationText = [district, province].filter(Boolean).join(" ");
  const fallbackPin = placeName
    ? `📍 ${placeName}${locationText ? ` | ${locationText}` : ""}`
    : "📍 ท่องเที่ยวชุมชนและวิถีชีวิตไทย";

  const fallbackBody =
    atmosphere ||
    "คลิปนี้พามาสัมผัสบรรยากาศความสวยงามและเสน่ห์ของชุมชนท้องถิ่นที่อบอุ่น ชวนแวะมาพักผ่อน สัมผัสวิถีชีวิตเป็นกันเอง และช้อปสินค้า OTOP ชุมชนด้วยตัวเองสักครั้งนะคะ!";

  const fallbackText = `${fallbackPin}\n\n${fallbackBody}`;

  if (!isAiConfigured()) {
    return fallbackText;
  }

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
        max_tokens: 512,
        temperature: 0.6,
        system: SUMMARY_NARRATION_PROMPT,
        messages: [{ role: "user", content: buildNarrationPrompt(analysisJson) }],
      }),
    });

    if (!res.ok) {
      console.warn("[generateNarration] AI returned status", res.status, "→ fallback");
      return fallbackText;
    }

    const data: any = await res.json();
    const rawText: string = Array.isArray(data?.content)
      ? data.content.map((c: any) => c?.text ?? "").join("\n").trim()
      : typeof data?.content === "string"
      ? data.content.trim()
      : "";

    // Guards:
    // 1. If AI accidentally returned JSON
    const trimmed = rawText.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      console.warn("[generateNarration] AI returned JSON → using fallback");
      return fallbackText;
    }

    // 2. If AI replied with "ไม่มีข้อมูล" or similar
    if (
      rawText.includes("ไม่มีข้อมูลเพียงพอ") ||
      rawText.includes("ไม่พบข้อมูล") ||
      rawText.includes("ขอรอคลิป")
    ) {
      console.warn("[generateNarration] AI returned no-data phrase → using fallback");
      return fallbackText;
    }

    return rawText || fallbackText;
  } catch (err) {
    console.warn("[generateNarration] error:", err);
    return fallbackText;
  } finally {
    clearTimeout(timer);
  }
}
