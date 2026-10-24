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
  placeName?: string;
  community?: string;
  subdistrict?: string;
  province?: string;
  district?: string;
  latitude?: number | null;
  longitude?: number | null;
  videoType?: "tourist_review" | "host_promo";
  /** Reviewed AI summary (already generated + possibly edited by the uploader). */
  aiSummary?: AiSummaryResult | null;
  /** Uploader's 1–5 rating of how accurate the AI summary was (for model eval). */
  summaryAccuracy?: number | null;
  /**
   * Storage path of the temporary draft copy. Once the real upload and the
   * row insert succeed, the draft is deleted so the clip isn't stored twice.
   */
  draftPath?: string | null;
}

export interface UploadResult {
  videoId: string;
  videoUrl: string;
}

/**
 * Drop the Google Places candidate list before persisting.
 *
 * The candidates are a transient picker aid — once the user has ticked one
 * they are meaningless, and keeping them would bloat the row with data the
 * user never confirmed.
 */
function stripCandidates(summary: AiSummaryResult | null): AiSummaryResult | null {
  if (!summary?.place?.google_candidates) return summary;
  const { google_candidates, ...place } = summary.place;
  void google_candidates;
  return { ...summary, place: place as AiSummaryResult["place"] };
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
 * Upload a picked clip to the `videos` bucket under drafts/ so the backend AI
 * can fetch it by public URL for analysis (before the user posts).
 * Returns { path, url } — reuse `path` at post time to avoid re-uploading.
 */
export async function uploadDraftVideo(localUri: string): Promise<{ path: string; url: string }> {
  if (!isSupabaseConfigured) throw new Error("ยังไม่ได้ตั้งค่า Supabase");
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("กรุณาเข้าสู่ระบบก่อน");

  const base64 = await readAsStringAsync(localUri, { encoding: EncodingType.Base64 });
  const bytes = decode(base64);
  const ext = guessExt(localUri);
  const path = `${uid}/drafts/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("videos")
    .upload(path, bytes, { contentType: contentType(ext), upsert: false });
  if (error) throw new Error(`อัปโหลดวิดีโอชั่วคราวไม่สำเร็จ: ${error.message}`);
  const url = supabase.storage.from("videos").getPublicUrl(path).data.publicUrl;
  return { path, url };
}

/**
 * Delete the temporary draft copy. Best-effort: a leftover draft is a storage
 * wart, not a user-facing failure, so we never throw.
 */
export async function deleteDraftVideo(path: string): Promise<void> {
  if (!path || !isSupabaseConfigured) return;
  try {
    const { error } = await supabase.storage.from("videos").remove([path]);
    if (error) console.warn("[upload] delete draft warning:", error.message);
  } catch (e: any) {
    console.warn("[upload] delete draft failed:", e?.message);
  }
}

export async function uploadVideo(input: NewVideoInput): Promise<UploadResult> {
  if (!isSupabaseConfigured) throw new Error("ยังไม่ได้ตั้งค่า Supabase");

  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  console.log("[upload] 0/auth uid =", uid);
  if (!uid) throw new Error("กรุณาเข้าสู่ระบบก่อนโพสต์");

  // 1) Read local file → base64 → ArrayBuffer.
  const base64 = await readAsStringAsync(input.localUri, { encoding: EncodingType.Base64 });
  const bytes = decode(base64);
  console.log("[upload] 1/read bytes =", bytes.byteLength, "uri =", input.localUri);

  // 2) Upload to the `videos` bucket under the user's folder (RLS-friendly).
  const ext = guessExt(input.localUri);
  const path = `${uid}/${Date.now()}.${ext}`;
  console.log("[upload] 2/upload start path =", path);
  const { error: upErr } = await supabase.storage
    .from("videos")
    .upload(path, bytes, { contentType: contentType(ext), upsert: false });
  if (upErr) {
    console.log("[upload] 2/upload FAILED =", JSON.stringify(upErr));
    throw new Error(`อัปโหลดวิดีโอไม่สำเร็จ: ${upErr.message}`);
  }
  console.log("[upload] 2/upload OK");

  // 3) Public URL.
  const { data: pub } = supabase.storage.from("videos").getPublicUrl(path);
  const videoUrl = pub.publicUrl;
  console.log("[upload] 3/url =", videoUrl);

  // 4) Decide the AI summary status we persist.
  //    - ready       → a summary was generated (and maybe edited) before posting
  //    - pending     → no summary available (AI was unreachable) → can retry later
  const persistedSummary = stripCandidates(input.aiSummary ?? null);
  const hasSummary =
    !!persistedSummary && typeof persistedSummary.text === "string" && persistedSummary.text.trim() !== "";
  const summaryStatus =
    hasSummary && persistedSummary!.status !== "unavailable" && persistedSummary!.status !== "error"
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
      location_name: input.locationName ?? input.community ?? null,
      place_name: input.placeName ?? null,
      province: input.province ?? null,
      district: input.district ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      ai_summary: hasSummary ? { ...persistedSummary, status: "ready" } : null,
      ai_summary_status: summaryStatus,
      ai_summary_accuracy:
        typeof input.summaryAccuracy === "number" ? input.summaryAccuracy : null,
    })
    .select("id")
    .single();
  if (insErr || !row) {
    console.log("[upload] 5/insert FAILED =", JSON.stringify(insErr));
    throw new Error(`บันทึกโพสต์ไม่สำเร็จ: ${insErr?.message ?? ""}`);
  }
  console.log("[upload] 5/insert OK id =", row.id);

  // 6) The draft copy has served its purpose (the AI read the clip from it).
  //    Delete it now so the same video isn't stored twice.
  if (input.draftPath) await deleteDraftVideo(input.draftPath);

  // 7) Also store structured AI analysis in video_ai_analyses table (non-blocking)
  if (hasSummary && persistedSummary) {
    const s = persistedSummary;
    const p = s.place;
    supabase
      .from("video_ai_analyses")
      .insert({
        post_id: row.id,
        place_name: p?.place_name ?? input.placeName ?? null,
        community: p?.community ?? input.community ?? null,
        province: p?.location?.province ?? input.province ?? null,
        district: p?.location?.district ?? input.district ?? null,
        subdistrict: p?.location?.subdistrict ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        atmosphere: p?.atmosphere ?? null,
        category: p?.category ?? [],
        activities: p?.activities ?? [],
        highlights: s.highlights ?? p?.highlights ?? [],
        otop_products: p?.otop_products ?? [],
        tags: s.tags ?? p?.tags ?? [],
        price_info: p?.price_info ?? null,
        contact: p?.contact ?? null,
        opening_hours: p?.opening_hours ?? null,
        confidence: p?.confidence ?? null,
        raw_analysis: s,
        display_summary: s.text,
        location_status: input.latitude ? "verified" : "pending",
      })
      .then(({ error: analysisErr }) => {
        if (analysisErr) {
          console.warn("[upload] save to video_ai_analyses warning:", analysisErr.message);
        } else {
          console.log("[upload] saved to video_ai_analyses OK");
        }
      });
  }

  return { videoId: row.id as string, videoUrl };
}
