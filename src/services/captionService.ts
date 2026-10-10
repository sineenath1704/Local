import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";

/**
 * Caption helper + pre-upload AI summary.
 * -------------------------------------------------------------
 * Both talk to OUR backend (which holds the AI token). The summary is
 * generated at UPLOAD time (before posting) via /ai-summary/preview — no
 * DB row exists yet — then persisted with the video on post, so the comment
 * sheet reads it instantly later.
 */

/** Structured place block (mirrors backend AiSummaryResult.place). */
export interface SummaryPlace {
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

/** Full summary object returned by the backend (what we persist + display). */
export interface AiSummaryResult {
  status: "ready" | "processing" | "unavailable" | "error";
  generatedAt?: string;
  model?: string;
  text: string;
  place?: SummaryPlace;
  tags?: string[];
  highlights?: string[];
  visualTags?: string[];
  onScreenText?: string[];
  transcriptHighlights?: string[];
}

export interface SummaryInput {
  caption?: string;
  location?: string;
  audioType?: "speech" | "music" | "mixed" | "none";
  uploaderType?: "tourist" | "community";
}

export interface CaptionRequest {
  draft?: string;
  locationName?: string;
  province?: string;
  district?: string;
  hashtags?: string[];
  summaryText?: string;
  highlights?: string[];
}

/**
 * Generate the FULL AI summary for a clip before posting (no DB row yet).
 * Returns the whole summary object so the UI can show it and we can persist
 * it verbatim with the video. Returns null on failure.
 */
export async function generatePreviewSummary(input: SummaryInput): Promise<AiSummaryResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 6);
  try {
    const res = await fetch(`${API_BASE_URL}/ai-summary/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        caption: input.caption ?? "",
        location: input.location ?? "",
        audioType: input.audioType ?? "none",
        uploaderType: input.uploaderType ?? "tourist",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AiSummaryResult;
    if (!data || typeof data.text !== "string") return null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Returns 2–3 caption suggestions, or [] on failure. */
export async function suggestCaptions(req: CaptionRequest): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 3);
  try {
    const res = await fetch(`${API_BASE_URL}/ai-caption`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(req),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.captions)
      ? data.captions.filter((c: unknown) => typeof c === "string")
      : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
