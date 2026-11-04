import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { VideoPost } from "../data/homeFeedData";
import { rowToPost } from "./feedService";

/**
 * Interaction service — likes & saves backed by Supabase (per-user).
 * -------------------------------------------------------------
 * video_likes / video_saves hold (user_id, video_id). Counter columns on
 * `videos` are maintained by DB triggers (bump_video_likes / _saves).
 *
 * ⚠️ ทุกฟังก์ชันที่ "เขียน" จะ **โยน error** เมื่อ query ล้มเหลว
 *   (เคยแค่ log ไว้ → หน้าจอบอกว่าสำเร็จทั้งที่ไม่มีอะไรถูกบันทึก)
 *   ผู้เรียกต้อง catch แล้ว rollback + แจ้งผู้ใช้
 */

async function currentUid(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Load the current user's liked + saved video ids. */
export async function loadMyInteractions(): Promise<{ likedIds: string[]; savedIds: string[] }> {
  if (!isSupabaseConfigured) return { likedIds: [], savedIds: [] };
  const uid = await currentUid();
  if (!uid) return { likedIds: [], savedIds: [] };

  const [{ data: likes, error: le }, { data: saves, error: se }] = await Promise.all([
    supabase.from("video_likes").select("video_id").eq("user_id", uid),
    supabase.from("video_saves").select("video_id").eq("user_id", uid),
  ]);
  console.log(
    "[load] likes =", likes?.length ?? 0, le ? JSON.stringify(le) : "",
    "saves =", saves?.length ?? 0, se ? JSON.stringify(se) : ""
  );
  return {
    likedIds: (likes ?? []).map((r: any) => r.video_id),
    savedIds: (saves ?? []).map((r: any) => r.video_id),
  };
}

export async function likeVideo(videoId: string): Promise<void> {
  const uid = await currentUid();
  if (!uid) throw new Error("กรุณาเข้าสู่ระบบก่อนกดไลก์");
  // upsert → กดซ้ำไม่ error (23505)
  const { error } = await supabase
    .from("video_likes")
    .upsert({ user_id: uid, video_id: videoId }, { onConflict: "user_id,video_id" });
  console.log("[like] upsert", videoId, "error =", error ? JSON.stringify(error) : "none");
  if (error) throw new Error(`กดไลก์ไม่สำเร็จ: ${error.message}`);
}

export async function unlikeVideo(videoId: string): Promise<void> {
  const uid = await currentUid();
  if (!uid) throw new Error("กรุณาเข้าสู่ระบบก่อนกดไลก์");
  const { error } = await supabase.from("video_likes").delete().eq("user_id", uid).eq("video_id", videoId);
  console.log("[like] delete", videoId, "error =", error ? JSON.stringify(error) : "none");
  if (error) throw new Error(`เอาไลก์ออกไม่สำเร็จ: ${error.message}`);
}

export async function saveVideoRow(videoId: string): Promise<void> {
  const uid = await currentUid();
  if (!uid) throw new Error("กรุณาเข้าสู่ระบบก่อนบันทึกคลิป");
  const { error } = await supabase
    .from("video_saves")
    .upsert({ user_id: uid, video_id: videoId }, { onConflict: "user_id,video_id" });
  console.log("[save] upsert", videoId, "error =", error ? JSON.stringify(error) : "none");
  if (error) throw new Error(`บันทึกคลิปไม่สำเร็จ: ${error.message}`);
}

export async function unsaveVideoRow(videoId: string): Promise<void> {
  const uid = await currentUid();
  if (!uid) throw new Error("กรุณาเข้าสู่ระบบก่อนบันทึกคลิป");
  const { error } = await supabase.from("video_saves").delete().eq("user_id", uid).eq("video_id", videoId);
  console.log("[save] delete", videoId, "error =", error ? JSON.stringify(error) : "none");
  if (error) throw new Error(`เอาคลิปออกจากที่บันทึกไม่สำเร็จ: ${error.message}`);
}

const VIDEO_SELECT =
  "id, user_id, video_url, thumbnail_url, caption, hashtags, location_name, province, district, likes_count, comments_count, saves_count, shares_count, created_at";

/** โหลดผู้ใช้ (ผู้เขียนคลิป) มาเติมในโพสต์ — แยก query ไม่ join เพื่อไม่ต้องพึ่ง FK ของ PostgREST */
async function attachAuthors(rows: any[]): Promise<any[]> {
  const authorIds = Array.from(new Set(rows.map((r: any) => r.user_id).filter(Boolean)));
  if (authorIds.length === 0) return rows;
  const { data: users } = await supabase
    .from("users")
    .select("id, display_name, username, avatar_url")
    .in("id", authorIds);
  const userById = new Map((users ?? []).map((u: any) => [u.id, u]));
  return rows.map((r: any) => ({ ...r, users: userById.get(r.user_id) ?? null }));
}

/**
 * Videos the current user LIKED (newest first), resolved to full posts.
 * โยน error เมื่อ query ล้มเหลว (เช่น ยังไม่ได้ grant ตาราง) — เพื่อให้หน้าโปรไฟล์
 * แยก "ไม่มีคลิปที่ถูกใจ" ออกจาก "โหลดไม่สำเร็จ" ได้
 */
export async function loadLikedVideos(): Promise<VideoPost[]> {
  if (!isSupabaseConfigured) return [];
  const uid = await currentUid();
  if (!uid) return [];
  const { data: likes, error: le } = await supabase
    .from("video_likes")
    .select("video_id, created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });
  if (le) {
    console.warn("[loadLikedVideos] likes error =", JSON.stringify(le));
    throw new Error(`โหลดคลิปที่ถูกใจไม่สำเร็จ: ${le.message}`);
  }
  const ids = (likes ?? []).map((r: any) => r.video_id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("videos").select(VIDEO_SELECT).in("id", ids);
  if (error) {
    console.warn("[loadLikedVideos] videos error =", JSON.stringify(error));
    throw new Error(`โหลดคลิปที่ถูกใจไม่สำเร็จ: ${error.message}`);
  }
  const rows = await attachAuthors(data ?? []);
  const likedIds = new Set(ids);
  return rows.map((r) => rowToPost(r, likedIds, new Set<string>()));
}

/** Videos the current user SAVED (optionally only those in a given folder). */
export async function loadSavedVideos(videoIds: string[]): Promise<VideoPost[]> {
  if (!isSupabaseConfigured || videoIds.length === 0) return [];
  const { data, error } = await supabase
    .from("videos")
    .select(VIDEO_SELECT)
    .in("id", videoIds);
  console.log("[loadSavedVideos] ids =", videoIds.length, "rows =", data?.length ?? 0, "error =", error ? JSON.stringify(error) : "none");
  if (error || !data) {
    throw new Error(`โหลดคลิปที่บันทึกไม่สำเร็จ: ${error?.message ?? "ไม่ทราบสาเหตุ"}`);
  }

  const rows = await attachAuthors(data);
  const savedIds = new Set(videoIds);
  return rows.map((r) => rowToPost(r, new Set<string>(), savedIds));
}
