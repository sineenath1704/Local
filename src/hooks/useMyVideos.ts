import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { rowToPost, type VideoRow } from "../services/feedService";
import type { VideoPost } from "../data/homeFeedData";

/**
 * คลิปของผู้ใช้ที่ล็อกอินอยู่ (จาก Supabase จริง ไม่มี mock)
 * -------------------------------------------------------------
 * คืนค่าเป็น `VideoPost` ชุดเดียวกับฟีดหน้าแรก เพื่อให้ทั้งตัวเลข
 * (ไลก์ · คอมเมนต์ · เซฟ · แชร์) และปุ่มกดทำงานเหมือนกันทุกที่
 */
export function useMyVideos() {
  const [posts, setPosts] = useState<VideoPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      setPosts([]);
      setLoading(false);
      return;
    }
    const { data, error: qError } = await supabase
      .from("videos")
      .select(
        "id, user_id, video_url, thumbnail_url, caption, hashtags, location_name, province, district, likes_count, comments_count, saves_count, shares_count, created_at"
      )
      .eq("user_id", uid)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });

    if (qError || !data) {
      setPosts([]);
      setError(qError ? qError.message : "โหลดคลิปของคุณไม่สำเร็จ");
      setLoading(false);
      return;
    }

    // ผู้เขียน = ตัวเอง (แยก query ไม่ join กับ users เพื่อไม่พึ่ง FK ของ PostgREST)
    const { data: me } = await supabase
      .from("users")
      .select("id, display_name, username, avatar_url")
      .eq("id", uid)
      .maybeSingle();

    // สถานะไลก์/เซฟของฉันกับคลิปชุดนี้ (ให้ตัวเลขตรงกับหน้าแรก)
    const videoIds = data.map((r: any) => r.id as string);
    const likedIds = new Set<string>();
    const savedIds = new Set<string>();
    if (videoIds.length > 0) {
      const [{ data: likes }, { data: saves }] = await Promise.all([
        supabase.from("video_likes").select("video_id").eq("user_id", uid).in("video_id", videoIds),
        supabase.from("video_saves").select("video_id").eq("user_id", uid).in("video_id", videoIds),
      ]);
      (likes ?? []).forEach((l: any) => likedIds.add(l.video_id));
      (saves ?? []).forEach((s: any) => savedIds.add(s.video_id));
    }

    const rows: VideoRow[] = (data as any[]).map((r) => ({
      ...r,
      users: me ?? null,
    }));
    setPosts(rows.map((r) => rowToPost(r, likedIds, savedIds)));
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

  /**
   * แก้ไขคลิปของตัวเอง — แก้ได้แค่คำบรรยายกับแฮทแท็ก
   * (เขียนทับในฐานข้อมูล แล้วอัปเดต state ที่หน้าจอ)
   */
  const updatePost = useCallback(
    async (
      videoId: string,
      patch: { caption: string; hashtags: string[] }
    ): Promise<void> => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("กรุณาเข้าสู่ระบบก่อนแก้ไขคลิป");

      const { data, error: qError } = await supabase
        .from("videos")
        .update({ caption: patch.caption, hashtags: patch.hashtags })
        .eq("id", videoId)
        .eq("user_id", uid)
        .select("id");
      if (qError) throw new Error(`บันทึกไม่สำเร็จ: ${qError.message}`);
      // ไม่มีแถว = ไม่มีสิทธิ์แก้ (หรือคลิปไม่ใช่ของเรา)
      if (!data || data.length === 0) {
        throw new Error("ไม่พบคลิปนี้ของคุณ — อาจถูกลบไปแล้ว");
      }

      setPosts((prev) =>
        prev.map((p) =>
          p.id === videoId
            ? { ...p, caption: patch.caption, hashtags: patch.hashtags }
            : p
        )
      );
    },
    []
  );

  /** ลบคลิปของตัวเอง (soft delete — ใช้คอลัมน์ is_deleted เหมือนที่ฟีดใช้) */
  const removePost = useCallback(async (videoId: string): Promise<void> => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) throw new Error("กรุณาเข้าสู่ระบบก่อนลบคลิป");

    const { data, error: qError } = await supabase
      .from("videos")
      .update({ is_deleted: true })
      .eq("id", videoId)
      .eq("user_id", uid)
      .select("id");
    if (qError) throw new Error(`ลบคลิปไม่สำเร็จ: ${qError.message}`);
    if (!data || data.length === 0) {
      throw new Error("ไม่พบคลิปนี้ของคุณ — อาจถูกลบไปแล้ว");
    }

    setPosts((prev) => prev.filter((p) => p.id !== videoId));
  }, []);

  return { posts, loading, error, refetch: load, updatePost, removePost };
}
