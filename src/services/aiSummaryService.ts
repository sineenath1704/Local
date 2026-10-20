import { AiSummary, getPostCommentData } from "../data/commentsData";
import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { aiFetch, AiError, toastAiError } from "./aiHttp";

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

/** Local fallback used when the backend is unreachable in development. */
function localFallback(postId: string): AiSummary | null {
  return getPostCommentData(postId).aiSummary;
}

/**
 * Three genuinely different outcomes, previously collapsed into one value.
 * -------------------------------------------------------------
 * "Not ready yet" (404 / row pending) and "the call failed" (502, 401,
 * timeout, dead host) used to return the same `"ระบบกำลังประมวลผล…"`
 * object, which told the user to wait forever for something that was never
 * going to arrive. The comment sheet now gets enough information to show a
 * real error with a Retry button.
 */
export type FetchAiSummaryResult =
  | { kind: "ready"; summary: AiSummary }
  | { kind: "pending"; summary: AiSummary }
  | { kind: "error"; summary: AiSummary | null; error: AiError };

const PENDING_SUMMARY: AiSummary = {
  status: "processing",
  text: "ระบบกำลังประมวลผลวิดีโอนี้ด้วย AI (ถอดเสียง + วิเคราะห์ภาพ) โปรดกลับมาดูสรุปอีกครั้งภายหลัง",
} as AiSummary;

/**
 * Fetch the stored AI summary for a post.
 * Never throws — returns a discriminated result so the caller can render
 * each state differently.
 */
export async function fetchAiSummary(postId: string): Promise<FetchAiSummaryResult> {
  // Primary: read the summary straight from the video row in Supabase (it was
  // persisted at post time). Works with the app's anon key via RLS — no
  // dependency on the backend/service_role for display.
  if (isSupabaseConfigured && /^[0-9a-f-]{36}$/i.test(postId)) {
    try {
      const { data, error } = await supabase
        .from("videos")
        .select("ai_summary, ai_summary_status")
        .eq("id", postId)
        .maybeSingle();
      if (!error && data) {
        if (data.ai_summary) return { kind: "ready", summary: data.ai_summary as AiSummary };
        return { kind: "pending", summary: PENDING_SUMMARY };
      }
    } catch {
      /* fall through to backend */
    }
  }

  // Fallback: backend (used by demo ids post-1/2/3 held in memory).
  const path = `/ai-summary/${encodeURIComponent(postId)}`;

  try {
    const data = await aiFetch<AiSummary>({
      label: "ai-summary/get",
      path,
      method: "GET",
      timeoutMs: API_TIMEOUT_MS,
      onSettled: (ok, error) => {
        if (!ok && error) toastAiError(error);
      },
    });

    if (data?.status === "processing") return { kind: "pending", summary: data };
    if (data && typeof data.text === "string") return { kind: "ready", summary: data };
    return {
      kind: "error",
      summary: null,
      error: new AiError({
        kind: "bad-shape",
        status: 200,
        body: JSON.stringify(data ?? null),
        requestId: null,
        label: "ai-summary/get",
        url: `${API_BASE_URL}${path}`,
        durationMs: 0,
        timeoutMs: API_TIMEOUT_MS,
      }),
    };
  } catch (err: any) {
    // 404 genuinely means "not generated yet" — that's not an error.
    if (err instanceof AiError && err.status === 404) {
      return { kind: "pending", summary: PENDING_SUMMARY };
    }
    if (err instanceof AiError) {
      return { kind: "error", summary: localFallback(postId), error: err };
    }
    throw err;
  }
}