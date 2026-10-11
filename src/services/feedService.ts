import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { VideoPost } from "../data/homeFeedData";

/**
 * Feed service — loads the video feed from Supabase ONLY.
 * -------------------------------------------------------------
 * Maps the `videos` table (joined with `users`) into the VideoPost shape.
 * Remote media become { uri } sources.
 *
 * No mock/fallback data: when Supabase isn't configured, has no posts, or the
 * query fails, this returns an empty list with a status the UI uses to show an
 * empty / error state ("ยังไม่มีวิดีโอในขณะนี้").
 */
interface VideoRow {
  id: string;
  user_id: string;
  video_url: string;
  thumbnail_url: string | null;
  caption: string | null;
  hashtags: unknown;
  location_name: string | null;
  province: string | null;
  district: string | null;
  likes_count: number | null;
  comments_count: number | null;
  saves_count: number | null;
  shares_count: number | null;
  created_at: string;
  users: {
    id: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
  } | null;
}

function toHashtags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  return [];
}

function rowToPost(row: VideoRow, likedIds: Set<string>, savedIds: Set<string>): VideoPost {
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
    hashtags: toHashtags(row.hashtags),
    booking: { roomsText: "เปิดรับนักท่องเที่ยว", price: 0 },
    initialLikes: row.likes_count ?? 0,
    initialComments: row.comments_count ?? 0,
    initialSaves: row.saves_count ?? 0,
    initialShares: row.shares_count ?? 0,
    initialLiked: likedIds.has(row.id),
    initialSaved: savedIds.has(row.id),
  };
}

export interface FeedResult {
  posts: VideoPost[];
  /**
   * ok        — loaded from Supabase (may still be an empty list)
   * notConfigured — Supabase env not set
   * error     — the query failed
   */
  status: "ok" | "notConfigured" | "error";
}

export async function loadFeed(): Promise<FeedResult> {
  if (!isSupabaseConfigured) {
    return { posts: [], status: "notConfigured" };
  }

  try {
    // No join on users (avoids depending on a PostgREST FK relationship).
    const { data, error } = await supabase
      .from("videos")
      .select(
        "id, user_id, video_url, thumbnail_url, caption, hashtags, location_name, province, district, likes_count, comments_count, saves_count, shares_count, created_at"
      )
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(50);

    console.log("[feed] rows =", data?.length ?? 0, "error =", error ? JSON.stringify(error) : "none");
    if (error) {
      return { posts: [], status: "error" };
    }
    if (!data || data.length === 0) {
      return { posts: [], status: "ok" }; // no posts yet → empty state
    }

    // Fetch the authors separately, then map them in.
    const authorIds = Array.from(new Set(data.map((r: any) => r.user_id)));
    const { data: users } = await supabase
      .from("users")
      .select("id, display_name, username, avatar_url")
      .in("id", authorIds);
    const userById = new Map((users ?? []).map((u: any) => [u.id, u]));
    console.log("[feed] authors =", users?.length ?? 0);

    // Reflect the current user's likes/saves on the hearts/bookmarks.
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    const likedIds = new Set<string>();
    const savedIds = new Set<string>();
    if (uid) {
      const videoIds = data.map((r: any) => r.id);
      const [{ data: likes }, { data: saves }] = await Promise.all([
        supabase.from("video_likes").select("video_id").eq("user_id", uid).in("video_id", videoIds),
        supabase.from("video_saves").select("video_id").eq("user_id", uid).in("video_id", videoIds),
      ]);
      (likes ?? []).forEach((l: any) => likedIds.add(l.video_id));
      (saves ?? []).forEach((s: any) => savedIds.add(s.video_id));
    }

    const posts = (data as any[]).map((r) =>
      rowToPost({ ...r, users: userById.get(r.user_id) ?? null }, likedIds, savedIds)
    );
    return { posts, status: "ok" };
  } catch {
    return { posts: [], status: "error" };
  }
}
