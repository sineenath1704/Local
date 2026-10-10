import { AiSummaryResult } from "./aiClient";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Summary store — persists AI video summaries.
 * -------------------------------------------------------------
 * Primary: Supabase `videos` table (ai_summary jsonb + ai_summary_status).
 *   → survives Vercel cold starts, tied to the owner's video row.
 *   → generated ONCE at upload time; the app reads it instantly on demand.
 * Fallback: in-memory Map when Supabase isn't configured (local dev / demo).
 *
 * `postId` = the video's id (uuid in Supabase, or any string in dev).
 */
const memory = new Map<string, AiSummaryResult>();

/** Seed a summary into the in-memory cache only (demo data with non-DB ids). */
export function seedMemorySummary(postId: string, summary: AiSummaryResult): void {
  memory.set(postId, summary);
}

/** Save a summary for a video. Writes to Supabase if configured, else memory. */
export async function saveSummary(postId: string, summary: AiSummaryResult): Promise<void> {
  memory.set(postId, summary);

  const admin = getSupabaseAdmin();
  if (!admin) return;

  const { error } = await admin
    .from("videos")
    .update({
      ai_summary: summary,
      ai_summary_status: summary.status === "ready" ? "ready" : summary.status,
    })
    .eq("id", postId);

  if (error) {
    // Don't crash the request — the in-memory copy still serves this instance.
    // eslint-disable-next-line no-console
    console.warn(`[summaryStore] Supabase update failed for ${postId}: ${error.message}`);
  }
}

/** Get a summary for a video. Reads Supabase first, then memory. */
export async function getSummary(postId: string): Promise<AiSummaryResult | undefined> {
  const admin = getSupabaseAdmin();
  if (admin) {
    const { data, error } = await admin
      .from("videos")
      .select("ai_summary")
      .eq("id", postId)
      .maybeSingle();
    if (!error && data?.ai_summary) {
      return data.ai_summary as AiSummaryResult;
    }
  }
  return memory.get(postId);
}

/** Whether a summary exists for a video. */
export async function hasSummary(postId: string): Promise<boolean> {
  return Boolean(await getSummary(postId));
}
