import React, { useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StatusBar,
  Platform,
  TouchableOpacity,
  useWindowDimensions,
  ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeftIcon } from "react-native-heroicons/outline";
import VideoFeedItem from "./VideoFeedItem";
import SaveToFolderSheet from "./SaveToFolderSheet";
import ShareSheet from "./ShareSheet";
import UserProfileScreen from "../Pages/UserProfileScreen";
import { VideoPost } from "../data/homeFeedData";
import { getProfileById } from "../data/profilesData";

interface ChatClipViewerProps {
  /** The ordered clips shared in this conversation (already resolved). */
  clips: VideoPost[];
  /** Index to open first (the clip the user tapped). */
  initialIndex: number;
  /** Title shown in the small header (e.g. the chat/group name). */
  title?: string;
  /** Called to leave the viewer (back button OR scrolling past the last clip). */
  onClose: () => void;
}

// A sentinel row appended after the last clip. Scrolling onto it = "past the
// last clip" → close the viewer (no wrap-around).
const EXIT_SENTINEL = "__exit__";

/**
 * Full-screen vertical pager that plays ONLY the clips shared in one chat.
 * Reuses VideoFeedItem so like / comment / follow work out of the box; save /
 * share / open-profile are hosted here (same pattern as HomeScreen).
 */
export default function ChatClipViewer({ clips, initialIndex, title, onClose }: ChatClipViewerProps) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight, width } = useWindowDimensions();
  const isSmallDevice = width < 360;

  const safeInitial = Math.min(Math.max(initialIndex, 0), Math.max(clips.length - 1, 0));
  const [activeId, setActiveId] = useState<string>(clips[safeInitial]?.id ?? "");

  const [saveVideoId, setSaveVideoId] = useState<string | null>(null);
  const [shareVideoId, setShareVideoId] = useState<string | null>(null);
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);

  const bottomOffset = Math.max(insets.bottom, 20) + 24;

  // data = clips + a trailing sentinel so swiping past the last one closes.
  const data = [...clips, { id: EXIT_SENTINEL } as VideoPost];

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0]?.item as { id: string } | undefined;
      if (!first) return;
      if (first.id === EXIT_SENTINEL) {
        onClose();
      } else {
        setActiveId(first.id);
      }
    }
  ).current;

  const viewingProfile = viewingProfileId ? getProfileById(viewingProfileId) : undefined;
  if (viewingProfile) {
    return <UserProfileScreen profile={viewingProfile} onBack={() => setViewingProfileId(null)} />;
  }

  return (
    <View className="flex-1 bg-black">
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        initialScrollIndex={safeInitial}
        getItemLayout={(_, index) => ({
          length: screenHeight,
          offset: screenHeight * index,
          index,
        })}
        renderItem={({ item }) => {
          if (item.id === EXIT_SENTINEL) {
            // Blank page — reaching it triggers onClose via viewability.
            return (
              <View style={{ height: screenHeight }} className="bg-black items-center justify-center">
                <Text className="text-gray-500 text-sm">สิ้นสุดคลิปในแชทนี้</Text>
              </View>
            );
          }
          return (
            <VideoFeedItem
              post={item}
              isActive={item.id === activeId}
              screenHeight={screenHeight}
              isSmallDevice={isSmallDevice}
              bottomOffset={bottomOffset}
              topInset={insets.top}
              onOpenProfile={(authorId) => setViewingProfileId(authorId)}
              onRequestSave={(videoId) => setSaveVideoId(videoId)}
              onRequestShare={(videoId) => setShareVideoId(videoId)}
            />
          );
        }}
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
      />

      {/* Back button (also closes to the chat) */}
      <TouchableOpacity
        onPress={onClose}
        activeOpacity={0.8}
        style={{ top: Math.max(insets.top, 12) + 4 }}
        className="absolute left-3 w-10 h-10 rounded-full bg-black/40 items-center justify-center z-30"
      >
        <ArrowLeftIcon size={22} color="#FFFFFF" strokeWidth={2} />
      </TouchableOpacity>

      {title ? (
        <View
          style={{ top: Math.max(insets.top, 12) + 8 }}
          className="absolute left-0 right-0 items-center z-20"
          pointerEvents="none"
        >
          <Text className="text-white/90 text-[13px] font-semibold" numberOfLines={1}>
            {title}
          </Text>
        </View>
      ) : null}

      <SaveToFolderSheet
        visible={saveVideoId !== null}
        videoId={saveVideoId}
        onClose={() => setSaveVideoId(null)}
      />
      <ShareSheet
        visible={shareVideoId !== null}
        videoId={shareVideoId}
        onClose={() => setShareVideoId(null)}
      />
    </View>
  );
}
