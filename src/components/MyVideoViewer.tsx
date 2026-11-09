import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  StatusBar,
  FlatList,
  useWindowDimensions,
  Platform,
  Alert,
  Modal,
  KeyboardAvoidingView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  XMarkIcon,
} from "react-native-heroicons/outline";
import type { VideoPost } from "../data/homeFeedData";
import VideoFeedItem from "./VideoFeedItem";
import SaveToFolderSheet from "./SaveToFolderSheet";
import ShareSheet from "./ShareSheet";

/**
 * config ตรวจว่าคลิปไหน "มองเห็น" พอ (FlatList)
 * ต้องเป็น object เดิมทุก render → เก็บไว้นอก component
 */
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60 };

interface MyVideoViewerProps {
  /** คลิปที่ผู้ใช้แตะเข้ามา */
  initialVideoId: string;
  /** คลิปทั้งหมดที่เลื่อนดูได้ (คลิปของฉัน · คลิปที่ถูกใจ · คลิปที่บันทึก) */
  posts: VideoPost[];
  onBack: () => void;
  /** คลิปของตัวเองเอง → มีปุ่มแก้ไข/ลบ */
  canEdit?: boolean;
  /** แก้ไขคำบรรยาย + แฮทแท็ก */
  onSaveEdit?: (
    videoId: string,
    patch: { caption: string; hashtags: string[] }
  ) => Promise<void>;
  /** ลบคลิปของตัวเอง */
  onDelete?: (videoId: string) => Promise<void>;
}

/** "ชายทะเล ทะเลไทย #เที่ยว #วันหยุด" → ["#เที่ยว", "#วันหยุด"] */
function parseHashtags(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));
}

/**
 * ผู้ดูคลิปแบบเต็มจอ (ใช้ในหน้าโปรไฟล์)
 * -------------------------------------------------------------
 * ใช้ `VideoFeedItem` ตัวเดียวกับหน้าแรก → ไลก์ · คอมเมนต์ · เซฟ · แชร์
 * ทำงานเหมือนกันเป๊ะ พร้อมตัวเลขจากฐานข้อมูล
 * คลิปของตัวเองจะมีปุ่ม "แก้ไข" (แก้ได้แค่คำบรรยาย + แฮทแท็ก) และ "ลบ"
 */
export default function MyVideoViewer({
  initialVideoId,
  posts,
  onBack,
  canEdit,
  onSaveEdit,
  onDelete,
}: MyVideoViewerProps) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const isSmallDevice = screenHeight < 700;
  const bottomOffset = 20;

  const initialIndex = Math.max(0, posts.findIndex((p) => p.id === initialVideoId));
  const [activeId, setActiveId] = useState(posts[initialIndex]?.id ?? "");

  // Sheets ระดับหน้าจอ (เหมือนหน้าแรก)
  const [saveVideoId, setSaveVideoId] = useState<string | null>(null);
  const [shareVideoId, setShareVideoId] = useState<string | null>(null);

  // แก้ไขคำบรรยาย + แฮทแท็ก
  const [editTarget, setEditTarget] = useState<VideoPost | null>(null);
  const [draftCaption, setDraftCaption] = useState("");
  const [draftHashtags, setDraftHashtags] = useState("");
  const [saving, setSaving] = useState(false);

  // Viewability callback — ต้องมี identity นิ่ง (FlatList ลงทะเบียน observer ครั้งเดียว)
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { item?: unknown }[] }) => {
      const first = viewableItems[0]?.item as VideoPost | undefined;
      if (first?.id) setActiveId(first.id);
    },
    []
  );

  const openEdit = (videoId: string) => {
    const post = posts.find((p) => p.id === videoId);
    if (!post) return;
    setEditTarget(post);
    setDraftCaption(post.caption);
    setDraftHashtags(post.hashtags.join(" "));
  };

  const saveEdit = async () => {
    if (!editTarget || !onSaveEdit) return;
    setSaving(true);
    try {
      await onSaveEdit(editTarget.id, {
        caption: draftCaption.trim(),
        hashtags: parseHashtags(draftHashtags),
      });
      setEditTarget(null);
    } catch (err: any) {
      Alert.alert("บันทึกไม่สำเร็จ", err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (videoId: string) => {
    Alert.alert("ลบคลิป", "ต้องการลบคลิปนี้ออกจากโปรไฟล์ใช่ไหม?", [
      { text: "ยกเลิก", style: "cancel" },
      {
        text: "ลบ",
        style: "destructive",
        onPress: () => {
          if (!onDelete) return;
          onDelete(videoId)
            .then(() => onBack())
            .catch((err: any) =>
              Alert.alert("ลบคลิปไม่สำเร็จ", err?.message ?? String(err))
            );
        },
      },
    ]);
  };

  return (
    <View className="flex-1 bg-black">
      <StatusBar barStyle="light-content" />

      {/* Back button */}
      <TouchableOpacity
        onPress={onBack}
        activeOpacity={0.7}
        style={{ position: "absolute", top: Math.max(insets.top, 16) + 4, left: 12, zIndex: 30 }}
        className="w-10 h-10 rounded-full bg-black/40 items-center justify-center"
      >
        <ArrowLeftIcon size={22} color="#FFFFFF" strokeWidth={2.2} />
      </TouchableOpacity>

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        initialScrollIndex={posts.length > 0 ? initialIndex : undefined}
        getItemLayout={(_, index) => ({ length: screenHeight, offset: screenHeight * index, index })}
        renderItem={({ item }) => (
          <View style={{ height: screenHeight, width: "100%" }}>
            <VideoFeedItem
              post={item}
              isActive={item.id === activeId}
              screenHeight={screenHeight}
              isSmallDevice={isSmallDevice}
              bottomOffset={bottomOffset}
              topInset={insets.top}
              headerTitle={canEdit ? "คลิปของฉัน" : "คลิปที่เลือก"}
              hideFollowButton={canEdit}
              onRequestEdit={canEdit ? openEdit : undefined}
              onRequestDelete={canEdit && onDelete ? confirmDelete : undefined}
              onRequestSave={(videoId) => setSaveVideoId(videoId)}
              onRequestShare={(videoId) => setShareVideoId(videoId)}
            />
          </View>
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={screenHeight}
        snapToAlignment="start"
        decelerationRate="fast"
        removeClippedSubviews={Platform.OS === "android"}
        viewabilityConfig={VIEWABILITY_CONFIG}
        onViewableItemsChanged={onViewableItemsChanged}
      />

      {/* Save-to-folder sheet */}
      <SaveToFolderSheet
        visible={saveVideoId !== null}
        videoId={saveVideoId}
        onClose={() => setSaveVideoId(null)}
      />

      {/* Share sheet */}
      <ShareSheet
        visible={shareVideoId !== null}
        videoId={shareVideoId}
        onClose={() => setShareVideoId(null)}
      />

      {/* แก้ไขคำบรรยาย + แฮทแท็ก */}
      <Modal
        visible={editTarget !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditTarget(null)}
      >
        <TouchableWithoutFeedback onPress={() => setEditTarget(null)}>
          <View className="flex-1 bg-black/50" />
        </TouchableWithoutFeedback>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View
            className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl p-5"
            style={{ paddingBottom: Math.max(insets.bottom, 14) + 10 }}
          >
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg font-black text-gray-900">แก้ไขข้อมูลคลิป</Text>
              <TouchableOpacity onPress={() => setEditTarget(null)} className="p-1">
                <XMarkIcon size={22} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <Text className="text-gray-500 text-[12px] mb-1.5">คำบรรยาย</Text>
            <TextInput
              value={draftCaption}
              onChangeText={setDraftCaption}
              placeholder="เขียนคำบรรยายคลิป..."
              placeholderTextColor="#9CA3AF"
              multiline
              className="bg-gray-100 rounded-xl px-3.5 py-3 text-[14px] text-gray-900 mb-4"
              style={{ minHeight: 90, textAlignVertical: "top" }}
            />

            <Text className="text-gray-500 text-[12px] mb-1.5">แฮทแท็ก</Text>
            <TextInput
              value={draftHashtags}
              onChangeText={setDraftHashtags}
              placeholder="#เที่ยว #ธรรมชาติ (คั่นด้วยช่องว่าง)"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              className="bg-gray-100 rounded-xl px-3.5 py-3 text-[14px] text-gray-900 mb-4"
            />

            <TouchableOpacity
              onPress={saveEdit}
              disabled={saving}
              activeOpacity={0.85}
              className={`py-3.5 rounded-2xl items-center ${saving ? "bg-gray-300" : "bg-[#2D6A4F]"}`}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text className="text-white font-bold text-[15px]">บันทึก</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
