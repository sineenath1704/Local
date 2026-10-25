import { config, isAiConfigured } from "./config";
import { AiUpstreamError } from "./aiErrors";
import { pickHashtagSuggestions } from "./hashtagText";
import type { PlaceCandidate } from "./placeTypes";
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
  /**
   * Google Places candidates for this clip. The app shows them as a picker —
   * the USER ticks one, we never pick for them. Not persisted: the app
   * strips this list before saving the summary.
   */
  google_candidates?: PlaceCandidate[];
  atmosphere?: string | null;
  category: string[];
  activities: string[];
  price_info: {
    weekday: string | null;
    weekend: string | null;
    currency?: string;
    /**
     * Google's price band for a place the user confirmed ("฿" / "฿฿฿" /
     * "ฟรี"). An overall estimate — NOT a weekday/weekend price, so it sits
     * beside them rather than in them. Filled in on the app when the user
     * tick-confirms a Google candidate.
     */
    level?: string | null;
  };
  contact: {
    phone?: string | null;
    facebook?: string | null;
    line?: string | null;
    /** Website of the confirmed place, from Google. */
    website?: string | null;
  };
  opening_hours?: string | null;
  /**
   * How many people the place takes. Every slot is a STRING on purpose: the
   * clip says "มี 3 ห้อง ห้องใหญ่นอนได้ 4-6 คน" and a number would force us
   * to pick one reading of an ambiguous sentence.
   */
  capacity?: {
    rooms?: string | null;
    guests_per_room?: string | null;
    max_guests?: string | null;
    beds?: string | null;
  } | null;
  /** The place's rules — "รับวันละ 1 กลุ่ม", "ต้องช่วยกันทำเตาไฟ". */
  rules?: string[];
  /** Zones of the place — "โซนเจ้าบ้าน", "โซนคาเฟ่". */
  areas?: string[];
  /** Facilities — "ระเบียง", "กองไฟ". */
  facilities?: string[];
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
/**
 * One object from the clip's scene inventory (Pillar 1). The narrator treats
 * this list as a checklist — every row has to end up in paragraph 1, so a
 * small detail (a towel, a sign, a water bottle) is never dropped.
 */
export interface SceneItem {
  /** Name of the thing ("เตียงไม้") — "ไม่ชัด" when it can't be identified. */
  item: string;
  /** What it's made of ("ไม้เนื้อแข็ง"). */
  material: string | null;
  /** How many ("2", "3-4", "1 คู่") — a string because clips say ranges. */
  count: string | null;
  /** How it looks now ("เก่า มีรอยชำรุด"). */
  condition: string | null;
  /** Where it sits in the frame ("ซ้าย บนโต๊ะ"). */
  position: string | null;
}

export interface AiSummaryResult {
  status: "ready" | "processing" | "unavailable";
  generatedAt: string;
  model: string;
  /** Natural-language summary (maps to the model's "summary"). */
  text: string;
  /** Detailed description of everything visible in the clip (Pillar 1). */
  visualDescription?: string;
  /** Every visible object, itemised — the narrator's checklist for ¶1. */
  sceneInventory?: SceneItem[];
  /** Structured extraction (place/location/price/contact/...), when available. */
  place?: PlaceData;
  // Back-compat display fields used by the current app UI:
  tags?: string[];
  highlights?: string[];
  visualTags?: string[];
  onScreenText?: string[];
  transcriptHighlights?: string[];
}

/**
 * Normalise the model's `scene_inventory` into our shape. Rows without a
 * usable name are dropped — a nameless row can't be narrated.
 */
function parseSceneInventory(raw: unknown): SceneItem[] {
  if (!Array.isArray(raw)) return [];
  const rows: SceneItem[] = [];
  for (const row of raw as any[]) {
    const item = typeof row?.item === "string" ? row.item.trim() : "";
    if (!item) continue;
    rows.push({
      item,
      material: row?.material != null ? String(row.material) : null,
      count: row?.count != null ? String(row.count) : null,
      condition: row?.condition != null ? String(row.condition) : null,
      position: row?.position != null ? String(row.position) : null,
    });
  }
  return rows;
}

/** Try to pull a JSON object out of the model's text response. */
export function extractJson(raw: string): any | null {
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
        capacity: parsed.capacity ?? null,
        rules: parsed.rules ?? [],
        areas: parsed.areas ?? [],
        facilities: parsed.facilities ?? [],
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
        visualDescription: parsed.visual_description ?? undefined,
        sceneInventory: parseSceneInventory(parsed.scene_inventory),
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
 * + location as the main source, plus a set of hashtag suggestions.
 *
 * Returns `{ captions, hashtags }`. The hashtags are suggestions the user picks
 * from — the app never posts them without a tap.
 */
export interface CaptionSuggestion {
  captions: string[];
  hashtags: string[];
}

export async function generateCaptions(input: CaptionInput): Promise<CaptionSuggestion> {
  if (!isAiConfigured()) {
    // Graceful stub so the feature works before the token is set.
    const place = input.locationName || input.province || "ชุมชน";
    const safePlace = place.replace(/\s+/g, "");
    return {
      captions: [
        `วันนี้พามาเที่ยว ${place} บรรยากาศดีมากกก 🌿`,
        `${place} สวยจนต้องมาเอง มาสัมผัสวิถีชุมชนกัน ✨`,
        `แวะ ${place} มาเติมพลังใจ 😊`,
      ],
      hashtags: [
        safePlace,
        "เที่ยวชุมชน",
        "ช้อปปิ้ง",
        "คาเฟ่",
        "ไทย",
      ].filter(Boolean),
    };
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
        max_tokens: 1024,
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
      const captions = parsed.captions
        .filter((c: unknown) => typeof c === "string")
        .slice(0, 3) as string[];
      const hashtags = pickHashtagSuggestions(parsed.hashtags, input.hashtags);
      return { captions, hashtags };
    }
    // Fallback: split lines if JSON wasn't returned.
    const captions = rawText
      .split("\n")
      .map((l) => l.replace(/^[-*\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 3);
    return { captions, hashtags: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stage 2: Turn structured JSON into an engaging 2-paragraph narrative
 * for display in the AI summary panel.
 *
 * Paragraph 1 = what the clip shows. Paragraph 2 = the conditions a
 * traveller needs before going (price, rules, capacity, zones, facilities).
 */
export async function generateNarration(analysisJson: any): Promise<string> {
  const place = analysisJson?.place ?? analysisJson;
  const placeName = place?.place_name ?? null;
  const province = place?.location?.province ?? null;
  const district = place?.location?.district ?? null;
  const atmosphere = place?.atmosphere ?? analysisJson?.atmosphere ?? null;
  const highlights: string[] = place?.highlights ?? analysisJson?.highlights ?? [];

  const locationText = [district, province].filter(Boolean).join(" ");

  // Paragraph 1 — what the clip shows. The fallback must not be thinner
  // than the AI-written version, so it leans on the visual description and
  // falls back to the highlights / atmosphere when there is none.
  const visualDescription: string | null =
    analysisJson?.visualDescription ?? place?.visual_description ?? null;
  // The inventory is the narrator's checklist. In the fallback it becomes
  // paragraph 1 itself, so nothing the model saw is lost when the AI call
  // fails or the token is not configured.
  const sceneInventory: SceneItem[] = Array.isArray(analysisJson?.sceneInventory)
    ? analysisJson.sceneInventory
    : Array.isArray(place?.scene_inventory)
    ? place.scene_inventory
    : [];
  const inventoryLine = sceneInventory
    .map((row) => {
      const bits = [row.count, row.material, row.condition, row.position].filter(Boolean);
      return bits.length ? `${row.item} (${bits.join(", ")})` : row.item;
    })
    .join(", ");
  const fallbackVisual = visualDescription
    ? `ในคลิปนี้เห็น${visualDescription}`
    : inventoryLine
    ? `ในคลิปนี้เห็น${inventoryLine}`
    : highlights.length
    ? `ในคลิปนี้เห็น${highlights.join(" ")}`
    : atmosphere || "";

  // Paragraph 2 — the conditions. Same order the prompt asks for: price →
  // rules → capacity → zones → facilities.
  const conditions: string[] = [];
  const price = place?.price_info?.weekday ?? place?.price_info?.weekend ?? null;
  if (price) conditions.push(`ราคา ${price}`);
  const rules: string[] = Array.isArray(place?.rules) ? place.rules : [];
  if (rules.length) conditions.push(rules.join(" "));
  const cap = place?.capacity ?? null;
  if (cap?.rooms) conditions.push(`มี ${cap.rooms} ห้อง`);
  if (cap?.guests_per_room) conditions.push(`ห้องปกตินอนได้ ${cap.guests_per_room} คน`);
  if (cap?.max_guests) conditions.push(`ห้องใหญ่นอนได้ ${cap.max_guests} คน`);
  if (cap?.beds) conditions.push(`มี ${cap.beds} เตียง`);
  const areas: string[] = Array.isArray(place?.areas) ? place.areas : [];
  if (areas.length) conditions.push(areas.join(" "));
  const facilities: string[] = Array.isArray(place?.facilities) ? place.facilities : [];
  if (facilities.length) conditions.push(facilities.join(" "));

  const placeLine = placeName
    ? `${placeName}${locationText ? ` ที่ ${locationText}` : ""}`
    : "";
  const fallbackConditions = [
    placeLine,
    conditions.length
      ? conditions.join(" ")
      : "คลิปนี้พามาสัมผัสบรรยากาศความสวยงามและเสน่ห์ของชุมชนท้องถิ่นที่อบอุ่น ชวนแวะมาพักผ่อน สัมผัสวิถีชีวิตเป็นกันเอง และช้อปสินค้า OTOP ชุมชนด้วยตัวเองสักครั้งนะคะ!",
  ]
    .filter(Boolean)
    .join(" — ");

  const fallbackText = [fallbackVisual, fallbackConditions].filter(Boolean).join("\n\n");

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
        // Paragraph 1 is written at maximum detail (every object described by
        // material / count / condition), so the old 1024 budget truncated it
        // mid-sentence.
        max_tokens: 4096,
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
