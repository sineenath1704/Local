import { readAsStringAsync, EncodingType } from "expo-file-system/legacy";
import { decode } from "base64-arraybuffer";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import type { AiSummaryResult } from "./captionService";

/**
 * Upload service — pushes a picked video to Supabase Storage and creates a
 * `videos` row owned by the current user.
 * -------------------------------------------------------------
 * The AI summary is generated in the CREATE screen BEFORE posting (so the
 * uploader can review/edit it). We persist that reviewed summary straight
 * into the row here, so the comment sheet reads it instantly later — no
 * post-upload AI wait.
 *
 * RN note: Blob/FormData give 0-byte files in React Native, so we read the
 * file as base64 → ArrayBuffer (the official Supabase RN pattern).
 */
export interface NewVideoInput {
  localUri: string; // from the image picker
  caption: string;
  hashtags: string[];
  locationName?: string;
  province?: string;
  district?: string;
  videoType?: "tourist_review" | "host_promo";
  /** Reviewed AI summary (already generated + possibly edited by the uploader). */
  aiSummary?: AiSummaryResult | null;
  /** Uploader's 1–5 rating of how accurate the AI summary was (for model eval). */
  summaryAccuracy?: number | null;
}

export interface UploadResult {
  videoId: string;
  videoUrl: string;
}

function guessExt(uri: string): string {
  const m = uri.split("?")[0].match(/\.(\w+)$/);
  return m ? m[1].toLowerCase() : "mp4";
}
function contentType(ext: string): string {
  if (ext === "mov") return "video/quicktime";
  if (ext === "m4v") return "video/x-m4v";
  return "video/mp4";
}

export async function uploadVideo(input: NewVideoInput): Promise<UploadResult> {
  if (!isSupabaseConfigured) throw new Error("ยังไม่ได้ตั้งค่า Supabase");

  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("กรุณาเข้าสู่ระบบก่อนโพสต์");

  // 1) Read local file → base64 → ArrayBuffer.
  const base64 = await readAsStringAsync(input.localUri, { encoding: EncodingType.Base64 });
  const bytes = decode(base64);

  // 2) Upload to the `videos` bucket under the user's folder (RLS-friendly).
  const ext = guessExt(input.localUri);
  const path = `${uid}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("videos")
    .upload(path, bytes, { contentType: contentType(ext), upsert: false });
  if (upErr) throw new Error(`อัปโหลดวิดีโอไม่สำเร็จ: ${upErr.message}`);

  // 3) Public URL.
  const { data: pub } = supabase.storage.from("videos").getPublicUrl(path);
  const videoUrl = pub.publicUrl;

  // 4) Decide the AI summary status we persist.
  //    - ready       → a summary was generated (and maybe edited) before posting
  //    - pending     → no summary available (AI was unreachable) → can retry later
  const hasSummary =
    !!input.aiSummary && typeof input.aiSummary.text === "string" && input.aiSummary.text.trim() !== "";
  const summaryStatus =
    hasSummary && input.aiSummary!.status !== "unavailable" && input.aiSummary!.status !== "error"
      ? "ready"
      : "pending";

  // 5) Insert the feed row — WITH the reviewed AI summary baked in.
  const { data: row, error: insErr } = await supabase
    .from("videos")
    .insert({
      user_id: uid,
      video_type: input.videoType ?? "tourist_review",
      video_url: videoUrl,
      caption: input.caption,
      hashtags: input.hashtags,
      location_name: input.locationName ?? null,
      province: input.province ?? null,
      district: input.district ?? null,
      ai_summary: hasSummary ? { ...input.aiSummary, status: "ready" } : null,
      ai_summary_status: summaryStatus,
      ai_summary_accuracy:
        typeof input.summaryAccuracy === "number" ? input.summaryAccuracy : null,
    })
    .select("id")
    .single();
  if (insErr || !row) throw new Error(`บันทึกโพสต์ไม่สำเร็จ: ${insErr?.message ?? ""}`);

  return { videoId: row.id as string, videoUrl };
}
