import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";

/** A video the signed-in user has posted (from Supabase, real data only). */
export interface MyVideoRow {
  id: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  caption: string;
  likesCount: number;
}

/**
 * Loads the current user's OWN posted videos from Supabase (no mock).
 * Used by the profile "videos" tab.
 */
export function useMyVideos() {
  const [videos, setVideos] = useState<MyVideoRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setVideos([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      setVideos([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("videos")
      .select("id, video_url, thumbnail_url, caption, likes_count, created_at")
      .eq("user_id", uid)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });

    if (error || !data) {
      setVideos([]);
    } else {
      setVideos(
        data.map((r: any) => ({
          id: r.id,
          videoUrl: r.video_url,
          thumbnailUrl: r.thumbnail_url ?? null,
          caption: r.caption ?? "",
          likesCount: r.likes_count ?? 0,
        }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      await load();
      if (!active) return;
    })();
    return () => {
      active = false;
    };
  }, [load]);

  return { videos, loading, refetch: load };
}
