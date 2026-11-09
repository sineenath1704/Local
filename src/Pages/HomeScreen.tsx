import React, { useState, useCallback } from "react";
import {
  View,
  StatusBar,
  useWindowDimensions,
  Platform,
  FlatList,
  ListViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import VideoFeedItem from "../components/VideoFeedItem";
import SaveToFolderSheet from "../components/SaveToFolderSheet";
import ShareSheet from "../components/ShareSheet";
import UserProfileScreen from "./UserProfileScreen";
import { Text, ActivityIndicator } from "react-native";
import { MapSelectionInfo } from "./Map/MapScreen";
import { PlaceItem } from "../data/thailandGeographicData";
import { getProfileById } from "../data/profilesData";
import { useFeed } from "../hooks/useFeed";

interface HomeScreenProps {
  onOpenMap?: (provinceName?: string) => void;
  mapSelection?: MapSelectionInfo | null;
  selectedPlace?: PlaceItem | null;
}

/**
 * config ตรวจว่าคลิปไหน "มองเห็น" พอ (FlatList)
 * ต้องเป็น object เดิมทุก render → เก็บไว้นอก component
 */
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60 };

/**
 * HomeScreen — vertical video feed template ("สำหรับคุณ").
 * -------------------------------------------------------------
 * Orchestration only:
 *   • Feed content comes from Supabase ONLY (via useFeed) — no mock/fallback.
 *     When there are no real posts it shows an empty state.
 *   • Each card is rendered by `src/components/VideoFeedItem.tsx`
 *   • Hosts the Save-to-folder sheet, Share sheet, and the read-only
 *     author profile viewer (opened from a card). All actions flow through
 *     the global InteractionContext (real taps, no mock counts).
 */
export default function HomeScreen({
  onOpenMap,
  mapSelection,
}: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const isSmallDevice = screenHeight < 700;

  // Measure the actual available height of the video feed area.
  const [feedHeight, setFeedHeight] = useState(0);

  // Feed from Supabase ONLY (no mock/fallback). Empty state when there are
  // no real posts yet.
  const {
    posts: feedPosts,
    loading: feedLoading,
    status: feedStatus,
  } = useFeed();

  const [activePostId, setActivePostId] = useState<string>("");

  /**
   * คลิปที่กำลังเล่น — ถ้าคลิปที่ active หายไปจากฟีด (โพสต์ถูกลบ/ซ่อน)
   * ให้ใช้คลิปแรกแทน (คำนวณตอน render — React Compiler ไม่ให้ setState ใน effect)
   */
  const currentActiveId =
    feedPosts.length > 0 && !feedPosts.some((p) => p.id === activePostId)
      ? feedPosts[0].id
      : activePostId;

  // Overlay/navigation state driven by card actions
  const [saveVideoId, setSaveVideoId] = useState<string | null>(null);
  const [shareVideoId, setShareVideoId] = useState<string | null>(null);
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(
    null
  );

  // Dynamic bottom offset
  const bottomOffset = 20;

  // Viewability callback — ต้องมี identity นิ่ง (FlatList ลงทะเบียน observer ครั้งเดียว)
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ListViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].item) {
        setActivePostId(viewableItems[0].item.id);
      }
    },
    []
  );

  const viewingProfile = viewingProfileId
    ? getProfileById(viewingProfileId)
    : undefined;

  // Full-screen read-only profile takes over when an author is tapped
  if (viewingProfile) {
    return (
      <UserProfileScreen
        profile={viewingProfile}
        onBack={() => setViewingProfileId(null)}
      />
    );
  }

  // Loading (first fetch) — simple spinner over black.
  if (feedLoading && feedPosts.length === 0) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text className="text-white/70 text-sm mt-3">
          กำลังโหลดวิดีโอ...
        </Text>
      </View>
    );
  }

  // Empty state — no real posts (or Supabase unavailable). No mock fallback.
  if (feedPosts.length === 0) {
    return (
      <View className="flex-1 bg-black items-center justify-center px-10">
        <StatusBar barStyle="light-content" />
        <Text className="text-white text-lg font-bold text-center">
          ยังไม่มีวิดีโอในขณะนี้
        </Text>
        <Text className="text-white/60 text-[13px] text-center mt-2 leading-5">
          {feedStatus === "error"
            ? "โหลดวิดีโอไม่สำเร็จ ลองใหม่อีกครั้งภายหลัง"
            : feedStatus === "notConfigured"
              ? "ยังเชื่อมต่อฐานข้อมูลไม่ได้"
              : 'เป็นคนแรกที่แชร์คลิปชุมชน กดปุ่ม "เพิ่มโพส" เพื่อลงวิดีโอ'}
        </Text>
      </View>
    );
  }

  return (
    <View
      className="flex-1 bg-black w-full"
      onLayout={(event) => {
        const height = event.nativeEvent.layout.height;

        // Update only when the measured height actually changes.
        setFeedHeight((previousHeight) =>
          previousHeight === height ? previousHeight : height
        );
      }}
    >
      <StatusBar barStyle="light-content" />

      {/* Video feed fills the available space above the bottom menu. */}
      <View className="flex-1 bg-black w-full">
        {feedHeight > 0 && (
          <FlatList
            style={{ flex: 1 }}
            data={feedPosts}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={{ height: feedHeight, width: "100%" }}>
                <VideoFeedItem
                  post={item}
                  isActive={item.id === currentActiveId}
                  screenHeight={feedHeight}
                  isSmallDevice={isSmallDevice}
                  bottomOffset={bottomOffset}
                  topInset={insets.top}
                  onOpenMap={onOpenMap}
                  mapSelection={mapSelection}
                  onOpenProfile={(authorId) =>
                    setViewingProfileId(authorId)
                  }
                  onRequestSave={(videoId) => setSaveVideoId(videoId)}
                  onRequestShare={(videoId) => setShareVideoId(videoId)}
                />
              </View>
            )}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            snapToInterval={feedHeight}
            snapToAlignment="start"
            decelerationRate="fast"
            windowSize={3}
            maxToRenderPerBatch={2}
            initialNumToRender={1}
            removeClippedSubviews={Platform.OS === "android"}
            viewabilityConfig={VIEWABILITY_CONFIG}
            onViewableItemsChanged={onViewableItemsChanged}
            getItemLayout={(_, index) => ({
              length: feedHeight,
              offset: feedHeight * index,
              index,
            })}
          />
        )}
      </View>

      {/* Save-to-folder sheet (choose/create folder for AI trip planning) */}
      <SaveToFolderSheet
        visible={saveVideoId !== null}
        videoId={saveVideoId}
        onClose={() => setSaveVideoId(null)}
      />

      {/* Share sheet (send to a friend's chat, or copy link) */}
      <ShareSheet
        visible={shareVideoId !== null}
        videoId={shareVideoId}
        onClose={() => setShareVideoId(null)}
      />
    </View>
  );
}
