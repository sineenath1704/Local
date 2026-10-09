import React, { useState, useRef, useEffect, useMemo } from "react";
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
import { MapSelectionInfo } from "./Map/MapScreen";
import { PlaceItem } from "../data/thailandGeographicData";
import { HOME_FEED_POSTS, buildPlaceFeedPost } from "../data/homeFeedData";
import { getProfileById } from "../data/profilesData";

interface HomeScreenProps {
  onOpenMap?: (provinceName?: string) => void;
  mapSelection?: MapSelectionInfo | null;
  selectedPlace?: PlaceItem | null;
}

/**
 * HomeScreen — vertical video feed template ("สำหรับคุณ").
 * -------------------------------------------------------------
 * Orchestration only:
 *   • Feed content comes from `src/data/homeFeedData.ts` (+ homeFeedPosts.json)
 *   • Each card is rendered by `src/components/VideoFeedItem.tsx`
 *   • Hosts the Save-to-folder sheet, Share sheet, and the read-only
 *     author profile viewer (opened from a card). All actions flow through
 *     the global InteractionContext (real taps, no mock counts).
 */
export default function HomeScreen({
  onOpenMap,
  mapSelection,
  selectedPlace,
}: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const isSmallDevice = screenHeight < 700;

  // Build dynamic feed: when a place is chosen from map, prepend its tailored video post
  const feedPosts = useMemo(() => {
    if (selectedPlace) {
      return [buildPlaceFeedPost(selectedPlace), ...HOME_FEED_POSTS];
    }
    return HOME_FEED_POSTS;
  }, [selectedPlace]);

  const [activePostId, setActivePostId] = useState<string>(feedPosts[0].id);

  // Overlay/navigation state driven by card actions
  const [saveVideoId, setSaveVideoId] = useState<string | null>(null);
  const [shareVideoId, setShareVideoId] = useState<string | null>(null);
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedPlace) {
      setActivePostId(`place-${selectedPlace.id}`);
    }
  }, [selectedPlace]);

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

  const viewingProfile = viewingProfileId ? getProfileById(viewingProfileId) : undefined;

  // Full-screen read-only profile takes over when an author is tapped
  if (viewingProfile) {
    return (
      <UserProfileScreen
        profile={viewingProfile}
        onBack={() => setViewingProfileId(null)}
      />
    );
  }

  return (
    <View className="flex-1 bg-black w-full h-full">
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <View
        style={{
          width: "100%",
          height: screenHeight,
        }}
        className="bg-black"
      >
        <FlatList
          data={feedPosts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <VideoFeedItem
              post={item}
              isActive={item.id === activePostId}
              screenHeight={screenHeight}
              isSmallDevice={isSmallDevice}
              bottomOffset={bottomOffset}
              topInset={insets.top}
              onOpenMap={onOpenMap}
              mapSelection={mapSelection}
              onOpenProfile={(authorId) => setViewingProfileId(authorId)}
              onRequestSave={(videoId) => setSaveVideoId(videoId)}
              onRequestShare={(videoId) => setShareVideoId(videoId)}
            />
          )}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={screenHeight}
          snapToAlignment="start"
          decelerationRate="fast"
          windowSize={3}
          maxToRenderPerBatch={2}
          initialNumToRender={1}
          removeClippedSubviews={Platform.OS === "android"}
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          getItemLayout={(_, index) => ({
            length: screenHeight,
            offset: screenHeight * index,
            index,
          })}
        />
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
