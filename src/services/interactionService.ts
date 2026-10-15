import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { VideoPost } from "../data/homeFeedData";

/**
 * Interaction service — likes & saves backed by Supabase (per-user).
 * -------------------------------------------------------------
 * video_likes / video_saves hold (user_id, video_id). Counter columns on
 * `videos` are maintained by DB triggers (bump_video_likes / _saves).
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
  if (!uid) return;
  const { error } = await supabase.from("video_likes").insert({ user_id: uid, video_id: videoId });
  console.log("[like] insert", videoId, "error =", error ? JSON.stringify(error) : "none");
}

export async function unlikeVideo(videoId: string): Promise<void> {
  const uid = await currentUid();
  if (!uid) return;
  const { error } = await supabase.from("video_likes").delete().eq("user_id", uid).eq("video_id", videoId);
  console.log("[like] delete", videoId, "error =", error ? JSON.stringify(error) : "none");
}

export async function saveVideoRow(videoId: string): Promise<void> {
  const uid = await currentUid();
  if (!uid) return;
  const { error } = await supabase.from("video_saves").insert({ user_id: uid, video_id: videoId });
  console.log("[save] insert", videoId, "error =", error ? JSON.stringify(error) : "none");
}

export async function unsaveVideoRow(videoId: string): Promise<void> {
  const uid = await currentUid();
  if (!uid) return;
  const { error } = await supabase.from("video_saves").delete().eq("user_id", uid).eq("video_id", videoId);
  console.log("[save] delete", videoId, "error =", error ? JSON.stringify(error) : "none");
}

/** VideoRow → VideoPost (same mapping the feed uses). */
function rowToPost(row: any): VideoPost {
  const author = row.users;
  return {
    id: row.id,
    authorId: row.user_id,
    videoSource: { uri: row.video_url },
    poster: row.thumbnail_url ? { uri: row.thumbnail_url } : undefined,
    author: {
      name: author?.display_name ?? "ชุมชน",
      handle: author?.username ?? "@local",
      avatar: author?.avatar_url ? { uri: author.avatar_url } : undefined,
    },
    location: {
      village: row.location_name ?? "",
      district: row.district ? `อ.${row.district}` : "",
      province: row.province ?? "",
    },
    caption: row.caption ?? "",
    hashtags: Array.isArray(row.hashtags) ? row.hashtags.filter((x: unknown) => typeof x === "string") : [],
    booking: { roomsText: "เปิดรับนักท่องเที่ยว", price: 0 },
    initialLikes: row.likes_count ?? 0,
    initialComments: row.comments_count ?? 0,
    initialSaves: row.saves_count ?? 0,
    initialShares: row.shares_count ?? 0,
    initialLiked: false,
    initialSaved: false,
  };
}

const VIDEO_SELECT =
  "id, user_id, video_url, thumbnail_url, caption, hashtags, location_name, province, district, likes_count, comments_count, saves_count, shares_count, created_at, users!left(id, display_name, username, avatar_url)";

/** Videos the current user LIKED (newest first), resolved to full posts. */
export async function loadLikedVideos(): Promise<VideoPost[]> {
  if (!isSupabaseConfigured) return [];
  const uid = await currentUid();
  if (!uid) return [];
  const { data: likes } = await supabase
    .from("video_likes")
    .select("video_id, created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });
  const ids = (likes ?? []).map((r: any) => r.video_id);
  if (ids.length === 0) return [];
  const { data } = await supabase.from("videos").select(VIDEO_SELECT).in("id", ids);
  return (data ?? []).map(rowToPost);
}

/** Videos the current user SAVED (optionally only those in a given folder). */
export async function loadSavedVideos(videoIds: string[]): Promise<VideoPost[]> {
  if (!isSupabaseConfigured || videoIds.length === 0) return [];
  const { data, error } = await supabase
    .from("videos")
    .select("id, user_id, video_url, thumbnail_url, caption, hashtags, location_name, province, district, likes_count, comments_count, saves_count, shares_count, created_at")
    .in("id", videoIds);
  console.log("[loadSavedVideos] ids =", videoIds.length, "rows =", data?.length ?? 0, "error =", error ? JSON.stringify(error) : "none");
  if (error || !data) return [];

  // Fetch authors separately (avoid join recursion).
  const authorIds = Array.from(new Set(data.map((r: any) => r.user_id)));
  const { data: users } = await supabase.from("users").select("id, display_name, username, avatar_url").in("id", authorIds);
  const userById = new Map((users ?? []).map((u: any) => [u.id, u]));

  return data.map((r: any) => rowToPost({ ...r, users: userById.get(r.user_id) ?? null }));
}
