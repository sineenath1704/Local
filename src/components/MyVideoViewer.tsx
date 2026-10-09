import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  StatusBar,
  StyleSheet,
  FlatList,
  useWindowDimensions,
  Platform,
  Alert,
  Modal,
  KeyboardAvoidingView,
  ViewToken,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  ArrowLeftIcon,
  PencilSquareIcon,
  TrashIcon,
  EyeIcon,
  XMarkIcon,
} from "react-native-heroicons/outline";
import { useMyProfile } from "../state/MyProfileContext";
import { MyVideo } from "../data/profileLocalData";

interface MyVideoViewerProps {
  initialVideoId: string;
  onBack: () => void;
}

function OwnVideoItem({
  video,
  isActive,
  height,
  topInset,
  bottomInset,
  onEdit,
  onDelete,
}: {
  video: MyVideo;
  isActive: boolean;
  height: number;
  topInset: number;
  bottomInset: number;
  onEdit: (v: MyVideo) => void;
  onDelete: (v: MyVideo) => void;
}) {
  const [, setPlaying] = useState(true);
  const player = useVideoPlayer(video.videoSource, (p) => {
    p.loop = true;
    if (isActive) p.play();
  });

  useEffect(() => {
    if (!player) return;
    if (isActive) {
      player.play();
      setPlaying(true);
    } else {
      player.pause();
      setPlaying(false);
    }
  }, [isActive, player]);

  const togglePlay = () => {
    if (!player) return;
    if (player.playing) {
      player.pause();
      setPlaying(false);
    } else {
      player.play();
      setPlaying(true);
    }
  };

  return (
    <View style={{ width: "100%", height }} className="relative bg-black">
      <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
        <VideoView
          player={player}
          style={{ width: "100%", height: "100%" }}
          contentFit="contain"
          nativeControls={false}
        />
      </View>
      <TouchableWithoutFeedback onPress={togglePlay}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>

      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.35)", "rgba(0,0,0,0.9)"]}
        style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 260 }}
        pointerEvents="none"
      />

      {/* Owner action buttons */}
      <View
        style={{ position: "absolute", right: 14, bottom: bottomInset + 120 }}
        className="items-center z-20"
      >
        <TouchableOpacity onPress={() => onEdit(video)} activeOpacity={0.8} className="items-center mb-5">
          <View className="w-11 h-11 rounded-full bg-black/40 border border-white/20 items-center justify-center">
            <PencilSquareIcon size={22} color="#FFFFFF" />
          </View>
          <Text className="text-white text-[11px] font-semibold mt-1">แก้ไข</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onDelete(video)} activeOpacity={0.8} className="items-center">
          <View className="w-11 h-11 rounded-full bg-black/40 border border-white/20 items-center justify-center">
            <TrashIcon size={22} color="#F87171" />
          </View>
          <Text className="text-white text-[11px] font-semibold mt-1">ลบ</Text>
        </TouchableOpacity>
      </View>

      {/* Caption + views */}
      <View style={{ position: "absolute", left: 16, right: 80, bottom: bottomInset + 24 }} className="z-20">
        <View className="flex-row items-center mb-2">
          <EyeIcon size={14} color="#FFFFFF" />
          <Text className="text-white/90 text-[12px] ml-1 font-semibold">{video.views} ครั้ง</Text>
        </View>
        <Text className="text-white/95 text-[13px] leading-5">{video.caption}</Text>
      </View>
    </View>
  );
}

export default function MyVideoViewer({ initialVideoId, onBack }: MyVideoViewerProps) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const { ownedVideos, updateVideoCaption, deleteVideo } = useMyProfile();

  const initialIndex = Math.max(0, ownedVideos.findIndex((v) => v.id === initialVideoId));
  const [activeId, setActiveId] = useState(ownedVideos[initialIndex]?.id ?? "");

  const [editTarget, setEditTarget] = useState<MyVideo | null>(null);
  const [draftCaption, setDraftCaption] = useState("");

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].item) {
      setActiveId((viewableItems[0].item as MyVideo).id);
    }
  }).current;

  // If list becomes empty after deletes, go back.
  useEffect(() => {
    if (ownedVideos.length === 0) onBack();
  }, [ownedVideos.length, onBack]);

  const handleDelete = (v: MyVideo) => {
    Alert.alert("ลบคลิป", `ต้องการลบคลิปนี้ออกจากโปรไฟล์ใช่ไหม?`, [
      { text: "ยกเลิก", style: "cancel" },
      { text: "ลบ", style: "destructive", onPress: () => deleteVideo(v.id) },
    ]);
  };

  const openEdit = (v: MyVideo) => {
    setEditTarget(v);
    setDraftCaption(v.caption);
  };

  const saveCaption = () => {
    if (editTarget) updateVideoCaption(editTarget.id, draftCaption);
    setEditTarget(null);
  };

  return (
    <View className="flex-1 bg-black">
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

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
        data={ownedVideos}
        keyExtractor={(v) => v.id}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, index) => ({ length: screenHeight, offset: screenHeight * index, index })}
        renderItem={({ item }) => (
          <OwnVideoItem
            video={item}
            isActive={item.id === activeId}
            height={screenHeight}
            topInset={insets.top}
            bottomInset={Math.max(insets.bottom, 20)}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={screenHeight}
        snapToAlignment="start"
        decelerationRate="fast"
        removeClippedSubviews={Platform.OS === "android"}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
      />

      {/* Edit caption modal */}
      <Modal visible={editTarget !== null} transparent animationType="slide" onRequestClose={() => setEditTarget(null)}>
        <TouchableWithoutFeedback onPress={() => setEditTarget(null)}>
          <View className="flex-1 bg-black/50" />
        </TouchableWithoutFeedback>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View
            className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl p-5"
            style={{ paddingBottom: Math.max(insets.bottom, 14) + 10 }}
          >
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg font-black text-gray-900">แก้ไขคำบรรยาย</Text>
              <TouchableOpacity onPress={() => setEditTarget(null)} className="p-1">
                <XMarkIcon size={22} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <TextInput
              value={draftCaption}
              onChangeText={setDraftCaption}
              placeholder="เขียนคำบรรยายคลิป..."
              placeholderTextColor="#9CA3AF"
              multiline
              autoFocus
              className="bg-gray-100 rounded-xl px-3.5 py-3 text-[14px] text-gray-900 mb-4"
              style={{ minHeight: 90, textAlignVertical: "top" }}
            />
            <TouchableOpacity onPress={saveCaption} activeOpacity={0.85} className="bg-[#2D6A4F] py-3.5 rounded-2xl items-center">
              <Text className="text-white font-bold text-[15px]">บันทึก</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
