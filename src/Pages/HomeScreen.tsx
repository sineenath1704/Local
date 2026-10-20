import React, { useState, useRef, useEffect } from "react";
import {
  View,
  StatusBar,
  useWindowDimensions,
  Platform,
  FlatList,
  ViewToken,
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

  // Keep the active post valid as the feed loads/changes.
  useEffect(() => {
    if (
      feedPosts.length > 0 &&
      !feedPosts.some((p) => p.id === activePostId)
    ) {
      setActivePostId(feedPosts[0].id);
    }
  }, [feedPosts, activePostId]);

  // Overlay/navigation state driven by card actions
  const [saveVideoId, setSaveVideoId] = useState<string | null>(null);
  const [shareVideoId, setShareVideoId] = useState<string | null>(null);
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(
    null
  );

  // Dynamic bottom offset
  const bottomOffset = Math.max(insets.bottom, 20) + 72;

  // Viewability config to detect which video is currently visible
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
  }).current;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].item) {
        setActivePostId(viewableItems[0].item.id);
      }
    }
  ).current;

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
        <StatusBar
          barStyle="light-content"
          translucent
          backgroundColor="transparent"
        />
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
        <StatusBar
          barStyle="light-content"
          translucent
          backgroundColor="transparent"
        />
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
      <StatusBar
        barStyle="light-content"
        translucent
        backgroundColor="transparent"
      />

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
                  isActive={item.id === activePostId}
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
            viewabilityConfig={viewabilityConfig}
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
