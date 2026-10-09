import { AiSummary, getPostCommentData } from "../data/commentsData";
import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";

/**
 * AI Summary service
 * =============================================================
 * ARCHITECTURE (important):
 *
 *   Mobile App ── Video / URL ──►  AI Server (Backend: mobile/backend)
 *                                   ├─ Speech-to-Text  (เสียง → ข้อความ)
 *                                   ├─ Vision          (ภาพ → สถานที่/คน/สิ่งของ/กิจกรรม/ข้อความบนจอ)
 *                                   └─ LLM             (รวมทุกอย่าง → สรุป)
 *                                        │
 *                                        ▼
 *                                   เก็บ Summary ลง DB
 *   Mobile App ◄── Summary (JSON) ──────┘  GET /ai-summary/:postId
 *
 * The phone must NOT process the whole video itself. The AI runs ON THE
 * SERVER at upload time; the app just fetches the stored summary — instant,
 * no 5–30s wait on tap.
 *
 * SECURITY: the AI endpoint + token live on the backend ONLY. The app only
 * ever talks to OUR backend (API_BASE_URL), which holds the secret.
 */

/** Fetch with a timeout so a slow/unreachable backend doesn't hang the UI. */
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Local fallback used when the backend is unreachable in development. */
function localFallback(postId: string): AiSummary | null {
  return getPostCommentData(postId).aiSummary;
}

/**
 * Fetch the stored AI summary for a post from the backend.
 *
 * Returns:
 *   - the summary (status "ready")                when the backend has it
 *   - { status: "processing" }                    when the backend returns 404
 *   - local JSON fallback                          when the backend is unreachable
 */
export async function fetchAiSummary(postId: string): Promise<AiSummary | null> {
  const url = `${API_BASE_URL}/ai-summary/${encodeURIComponent(postId)}`;

  try {
    const res = await fetchWithTimeout(url, API_TIMEOUT_MS);

    if (res.status === 404) {
      // Backend reachable but summary not generated yet.
      return {
        status: "processing",
        text: "ระบบกำลังประมวลผลวิดีโอนี้ด้วย AI โปรดกลับมาดูสรุปอีกครั้งภายหลัง",
      };
    }

    if (!res.ok) {
      // Any other backend error → fall back to whatever we have locally.
      return localFallback(postId);
    }

    const data = (await res.json()) as AiSummary;
    return data;
  } catch {
    // Network/timeout error (e.g. backend not running) → local fallback.
    return localFallback(postId);
  }
}
