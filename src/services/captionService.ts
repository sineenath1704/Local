import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";
import { aiFetch, AiError, toastAiError } from "./aiHttp";

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
  /** Public URL of the clip — makes the backend analyze the VIDEO directly. */
  videoUrl?: string;
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
 *
 * Returns the whole summary object so the UI can show it and we can persist
 * it verbatim with the video.
 *
 * Throws `AiError` on failure — this used to return `null`, which the caller
 * could not tell apart from "AI ran fine but found no location". A null used
 * to make the create-post screen wipe the user's typed-in location fields.
 */
export async function generatePreviewSummary(
  input: SummaryInput
): Promise<AiSummaryResult> {
  const data = await aiFetch<AiSummaryResult>({
    label: "ai-summary/preview",
    path: "/ai-summary/preview",
    method: "POST",
    body: {
      caption: input.caption ?? "",
      location: input.location ?? "",
      audioType: input.audioType ?? "none",
      uploaderType: input.uploaderType ?? "tourist",
      videoUrl: input.videoUrl,
    },
    timeoutMs: API_TIMEOUT_MS * 6,
    onSettled: (ok, error) => {
      if (!ok && error) toastAiError(error);
    },
  });

  if (!data || typeof data.text !== "string") {
    throw new AiError({
      kind: "bad-shape",
      status: 200,
      body: JSON.stringify(data ?? null),
      requestId: null,
      label: "ai-summary/preview",
      url: `${API_BASE_URL}/ai-summary/preview`,
      durationMs: 0,
      timeoutMs: API_TIMEOUT_MS * 6,
    });
  }
  return data;
}

/** Returns 2–3 caption suggestions. Throws `AiError` on failure (was: `[]`). */
export async function suggestCaptions(req: CaptionRequest): Promise<string[]> {
  const data = await aiFetch<{ captions?: unknown }>({
    label: "ai-caption",
    path: "/ai-caption",
    method: "POST",
    body: req,
    timeoutMs: API_TIMEOUT_MS * 3,
    onSettled: (ok, error) => {
      if (!ok && error) toastAiError(error);
    },
  });

  if (!Array.isArray(data?.captions)) {
    throw new AiError({
      kind: "bad-shape",
      status: 200,
      body: JSON.stringify(data ?? null),
      requestId: null,
      label: "ai-caption",
      url: `${API_BASE_URL}/ai-caption`,
      durationMs: 0,
      timeoutMs: API_TIMEOUT_MS * 3,
    });
  }
  return data.captions.filter((c: unknown): c is string => typeof c === "string");
}
