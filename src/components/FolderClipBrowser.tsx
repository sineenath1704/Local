import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeftIcon, FolderIcon, PlayIcon } from "react-native-heroicons/outline";
import { getClipsInFolder } from "../services/folderService";
import { loadSavedVideos } from "../services/interactionService";
import type { VideoPost } from "../data/homeFeedData";
import MyVideoViewer from "./MyVideoViewer";

interface FolderClipBrowserProps {
  /** รหัสโฟลเดอร์ที่กดเข้ามา */
  folderId: string;
  /** ชื่อโฟลเดอร์ (แสดงหัวหน้าจอ) */
  folderName: string;
  /** จำนวนคลิปที่รู้ไว้ตอนแนบ (แสดงระหว่างโหลด) */
  clipCount?: number;
  /**
   * รายการ video id ที่รู้อยู่แล้ว
   * → ถ้ามี ใช้เลย ไม่ต้อง query ซ้ำ (ฝั่งแอปโหลดโฟลเดอร์ไว้แล้ว)
   */
  videoIds?: string[];
  /** ปิดหน้าจอนี้ */
  onClose: () => void;
}

/**
 * ดูคลิปข้างในโฟลเดอร์ (แบบเต็มจอ)
 * =============================================================
 * 2 เรื่องที่ผู้ใช้ต้องการจากโฟลเดอร์ที่แนบในแชท:
 *   1. เห็นว่าข้างในมีคลิปอะไรบ้าง → ตารางรูปย่อ 2 คอลัมน์
 *   2. กดคลิปแล้ว "เล่นคลิปเหมือนหน้าโฮม" → เปิด `MyVideoViewer` (ตัวเดียวกับหน้าโฮม)
 *      เลื่อนขึ้นลงเปลี่ยนคลิปได้ ไลก์ · คอมเมนต์ · เซฟ · แชร์ ได้ครบ
 *
 * ทำเป็นหน้าจอเต็ม (ไม่ใช่ Modal ซ้อน) เพราะ `MyVideoViewer` มี Sheet ข้างใน
 *   ถ้าซ้อน Modal บน iOS ปุ่มในชีตจะกดไม่ติด (เคยเจอแล้ว)
 */
export default function FolderClipBrowser({
  folderId,
  folderName,
  clipCount,
  videoIds,
  onClose,
}: FolderClipBrowserProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  /**
   * ผลลัพธ์ที่โหลดมาแล้ว (ผูกกับคีย์ของคำขอ)
   * → "กำลังโหลด" คำนวณจากคีย์ ไม่ต้อง setState ใน effect (กัน lint rule + ไม่เรนเดอร์ซ้ำ)
   */
  const [state, setState] = useState<{
    key: string;
    clips: VideoPost[];
    error: string | null;
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  /** คลิปที่กำลังเล่น (null = ยังอยู่ที่ตารางรูปย่อ) */
  const [playingId, setPlayingId] = useState<string | null>(null);

  /** คีย์ของคำขอปัจจุบัน — เปลี่ยนเมื่อโฟลเดอร์/รายการคลิป/ปุ่มลองใหม่เปลี่ยน */
  const requestKey = useMemo(
    () => `${folderId}|${videoIds?.join(",") ?? ""}|${reloadKey}`,
    [folderId, videoIds, reloadKey]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // ไม่รู้รายการคลิป → ถามฐานข้อมูลเอง (เผื่อเปิดจากที่อื่นที่ไม่ได้โหลดโฟลเดอร์ไว้)
        const ids =
          videoIds && videoIds.length > 0
            ? videoIds
            : (await getClipsInFolder(folderId)).map((i) => i.video_id);
        const posts = ids.length > 0 ? await loadSavedVideos(ids) : [];
        if (cancelled) return;
        // เรียงตามลำดับในโฟลเดอร์ (Supabase ไม่รับประกันลำดับที่คืนมา)
        const byId = new Map(posts.map((p) => [p.id, p]));
        setState({
          key: requestKey,
          clips: ids.map((id) => byId.get(id)).filter((p): p is VideoPost => Boolean(p)),
          error: null,
        });
      } catch (err: any) {
        if (cancelled) return;
        console.warn("[FolderClipBrowser] โหลดคลิปไม่สำเร็จ:", err?.message ?? err);
        setState({ key: requestKey, clips: [], error: err?.message ?? "โหลดคลิปไม่สำเร็จ" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestKey, folderId, videoIds]);

  const loading = state?.key !== requestKey;
  const clips = loading ? [] : state.clips;
  const error = loading ? null : state.error;

  // ── กำลังเล่นคลิปเต็มจอ (แบบหน้าโฮม) ─────────────────────────────
  if (playingId) {
    return (
      <MyVideoViewer
        initialVideoId={playingId}
        posts={clips}
        onBack={() => setPlayingId(null)}
      />
    );
  }

  const gutter = 10;
  const cell = Math.floor((width - gutter * 3) / 2);

  return (
    <View className="flex-1 bg-white">
      {/* หัวหน้าจอ */}
      <View
        style={{ paddingTop: Math.max(insets.top, 12) + 6 }}
        className="flex-row items-center px-3 pb-3 border-b border-gray-100"
      >
        <TouchableOpacity onPress={onClose} className="p-1 mr-1">
          <ArrowLeftIcon size={24} color="#18181B" strokeWidth={2} />
        </TouchableOpacity>
        <View className="w-9 h-9 rounded-full bg-amber-100 items-center justify-center mr-2.5">
          <FolderIcon size={18} color="#D47A3A" />
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-bold text-gray-900" numberOfLines={1}>
            {folderName}
          </Text>
          <Text className="text-[12px] text-gray-400">
            {loading
              ? "กำลังโหลดคลิป..."
              : `${clips.length || clipCount || 0} คลิปในโฟลเดอร์`}
          </Text>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#7C3AED" />
          <Text className="text-[12px] text-gray-400 mt-2">กำลังโหลดคลิปในโฟลเดอร์</Text>
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-[13px] text-red-600 text-center">{error}</Text>
          <TouchableOpacity
            onPress={() => setReloadKey((n) => n + 1)}
            activeOpacity={0.8}
            className="mt-3 px-4 py-2 rounded-full bg-violet-600"
          >
            <Text className="text-white text-[12px] font-bold">ลองใหม่</Text>
          </TouchableOpacity>
        </View>
      ) : clips.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <FolderIcon size={40} color="#D1D5DB" />
          <Text className="text-[13px] text-gray-400 text-center mt-3 leading-5">
            โฟลเดอร์นี้ยังไม่มีคลิป
          </Text>
        </View>
      ) : (
        <FlatList
          data={clips}
          keyExtractor={(c) => c.id}
          numColumns={2}
          columnWrapperStyle={{ paddingHorizontal: gutter, marginBottom: gutter }}
          contentContainerStyle={{ paddingTop: gutter, paddingBottom: gutter * 2 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => setPlayingId(item.id)}
              activeOpacity={0.85}
              style={{ width: cell, height: cell * 1.5, marginBottom: gutter }}
              className="rounded-xl overflow-hidden bg-gray-900"
            >
              {item.poster ? (
                <Image
                  source={item.poster}
                  style={{ width: "100%", height: "100%" }}
                  resizeMode="cover"
                />
              ) : (
                <View className="flex-1 items-center justify-center">
                  <PlayIcon size={24} color="#FFFFFF" />
                </View>
              )}
              {/* ปุ่มเล่นทับรูป */}
              <View className="absolute inset-0 items-center justify-center">
                <View className="w-10 h-10 rounded-full bg-black/45 items-center justify-center">
                  <PlayIcon size={18} color="#FFFFFF" />
                </View>
              </View>
              {item.caption ? (
                <View className="absolute left-0 right-0 bottom-0 px-2 py-1.5 bg-black/45">
                  <Text numberOfLines={1} className="text-white text-[11px] font-semibold">
                    {item.caption}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}
