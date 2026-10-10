import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";

/**
 * Caption helper — asks the backend AI to suggest captions for a post,
 * built mainly from the clip's AI summary + chosen location.
 */
export interface CaptionRequest {
  draft?: string;
  locationName?: string;
  province?: string;
  district?: string;
  hashtags?: string[];
  summaryText?: string;
  highlights?: string[];
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
    return Array.isArray(data?.captions) ? data.captions.filter((c: unknown) => typeof c === "string") : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a preview AI summary for the chosen location (before upload),
 * so the caption helper has context. Returns null if unavailable.
 */
export async function previewSummary(location: string): Promise<{ text: string; highlights: string[] } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 3);
  try {
    const res = await fetch(`${API_BASE_URL}/ai-summary/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ audioType: "none", location, caption: location }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { text: typeof data?.text === "string" ? data.text : "", highlights: data?.highlights ?? [] };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
