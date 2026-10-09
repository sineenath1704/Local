import React from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  FlatList,
  StatusBar,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  ChatBubbleLeftRightIcon,
  SparklesIcon,
  PlayIcon,
  MapPinIcon,
} from "react-native-heroicons/outline";
import { useInteractions } from "../../state/InteractionContext";
import { resolveSavedVideo } from "../../data/tripsData";

interface FolderDetailScreenProps {
  folderId: string;
  onBack: () => void;
  onChatFromFolder: (folderId: string, folderName: string) => void;
  onPlanTrip: (folderId: string) => void;
}

export default function FolderDetailScreen({
  folderId,
  onBack,
  onChatFromFolder,
  onPlanTrip,
}: FolderDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const { folders } = useInteractions();
  const folder = folders.find((f) => f.id === folderId);

  const videos = (folder?.videoIds ?? []).map(resolveSavedVideo);

  return (
    <View className="flex-1 bg-white">
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <View
        style={{ paddingTop: Math.max(insets.top, 12) + (Platform.OS === "android" ? 8 : 4) }}
        className="px-3 pb-3 flex-row items-center border-b border-gray-100"
      >
        <TouchableOpacity onPress={onBack} className="p-1 mr-1">
          <ArrowLeftIcon size={24} color="#18181B" strokeWidth={2} />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-lg font-black text-gray-900" numberOfLines={1}>
            {folder?.name ?? "โฟลเดอร์"}
          </Text>
          <Text className="text-[11px] text-gray-400">{videos.length} คลิปที่บันทึก</Text>
        </View>
      </View>

      {/* Action buttons */}
      <View className="flex-row px-4 py-3">
        <TouchableOpacity
          onPress={() => folder && onChatFromFolder(folder.id, folder.name)}
          activeOpacity={0.85}
          className="flex-1 flex-row items-center justify-center bg-violet-100 rounded-2xl py-3 mr-2"
        >
          <ChatBubbleLeftRightIcon size={18} color="#7C3AED" />
          <Text className="text-violet-700 font-bold text-[13px] ml-1.5">คุยกับ AI</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onPlanTrip(folderId)}
          activeOpacity={0.85}
          className="flex-1 flex-row items-center justify-center bg-violet-600 rounded-2xl py-3"
        >
          <SparklesIcon size={18} color="#FFFFFF" />
          <Text className="text-white font-bold text-[13px] ml-1.5">วางแผนทริป</Text>
        </TouchableOpacity>
      </View>

      {/* Saved videos */}
      <FlatList
        data={videos}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 14, paddingBottom: 110 }}
        renderItem={({ item }) => (
          <View className="flex-row items-center bg-gray-50 border border-gray-100 rounded-2xl p-2.5 mb-2.5">
            <View className="w-16 h-20 rounded-xl overflow-hidden bg-gray-200 mr-3">
              {item.poster ? (
                <Image source={item.poster} className="w-full h-full" resizeMode="cover" />
              ) : (
                <View className="w-full h-full items-center justify-center">
                  <PlayIcon size={22} color="#9CA3AF" />
                </View>
              )}
            </View>
            <View className="flex-1">
              <Text className="text-gray-900 font-bold text-[14px]" numberOfLines={1}>
                {item.title}
              </Text>
              <View className="flex-row items-center mt-1">
                <MapPinIcon size={13} color="#EF4444" />
                <Text className="text-gray-500 text-[12px] ml-1" numberOfLines={1}>
                  {item.placeLabel}
                </Text>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View className="py-20 items-center px-10">
            <PlayIcon size={40} color="#D1D5DB" />
            <Text className="text-gray-400 text-sm text-center mt-3">
              ยังไม่มีคลิปในโฟลเดอร์นี้ ไปที่หน้าหลักแล้วกดบันทึกคลิปที่ชอบเข้ามาได้เลย
            </Text>
          </View>
        }
      />
    </View>
  );
}
