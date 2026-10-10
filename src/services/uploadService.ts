import { readAsStringAsync, EncodingType } from "expo-file-system/legacy";
import { decode } from "base64-arraybuffer";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";

/**
 * Upload service — pushes a picked video to Supabase Storage, creates a
 * `videos` row owned by the current user, then asks the backend to generate
 * & PERSIST the AI summary for that video (so it shows instantly later).
 * -------------------------------------------------------------
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

/**
 * Ask the backend to generate + persist the AI summary for a video.
 * Fire-and-forget friendly: errors are swallowed (summary can be retried).
 */
async function generateSummaryForVideo(videoId: string, input: NewVideoInput): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 4);
  try {
    await fetch(`${API_BASE_URL}/ai-summary/${encodeURIComponent(videoId)}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        caption: input.caption,
        // No STT/Vision pipeline yet — the backend summarizes from caption +
        // location. audioType "none" tells it to rely on caption/visual.
        audioType: "none",
        location: [input.locationName, input.district, input.province].filter(Boolean).join(" "),
        uploaderType: input.videoType === "host_promo" ? "community" : "tourist",
      }),
    });
  } catch {
    // Non-fatal: the summary can be generated again on demand.
  } finally {
    clearTimeout(timer);
  }
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

  // 4) Insert the feed row.
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
      ai_summary_status: "processing",
    })
    .select("id")
    .single();
  if (insErr || !row) throw new Error(`บันทึกโพสต์ไม่สำเร็จ: ${insErr?.message ?? ""}`);

  const videoId = row.id as string;

  // 5) Kick off AI summary generation + persistence (don't block the UI).
  void generateSummaryForVideo(videoId, input);

  return { videoId, videoUrl };
}
