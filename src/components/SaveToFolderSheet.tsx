import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  FlatList,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  XMarkIcon,
  FolderIcon,
  FolderPlusIcon,
  CheckCircleIcon,
  BookmarkIcon,
} from "react-native-heroicons/outline";
import { CheckCircleIcon as CheckSolid } from "react-native-heroicons/solid";
import { useInteractions } from "../state/InteractionContext";

interface SaveToFolderSheetProps {
  visible: boolean;
  videoId: string | null;
  onClose: () => void;
}

/**
 * Shown when the user taps Save. Lets them:
 *   • save directly (no folder), or
 *   • pick an existing folder, or
 *   • create a new folder (for AI trip planning later)
 */
export default function SaveToFolderSheet({ visible, videoId, onClose }: SaveToFolderSheetProps) {
  const insets = useSafeAreaInsets();
  const { folders, saveVideo, createFolder } = useInteractions();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const handleSaveNoFolder = () => {
    if (videoId) saveVideo(videoId);
    close();
  };

  const handleSaveToFolder = (folderId: string) => {
    if (videoId) saveVideo(videoId, folderId);
    close();
  };

  const handleCreateAndSave = () => {
    const name = newName.trim();
    if (!name) return;
    const id = createFolder(name);
    if (videoId) saveVideo(videoId, id);
    close();
  };

  const close = () => {
    setCreating(false);
    setNewName("");
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <TouchableWithoutFeedback onPress={close}>
        <View className="flex-1 bg-black/40" />
      </TouchableWithoutFeedback>

      <View
        className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl"
        style={{ paddingBottom: Math.max(insets.bottom, 12) + 8, maxHeight: "72%" }}
      >
        {/* Handle */}
        <View className="items-center pt-2.5 pb-1">
          <View className="w-10 h-1.5 rounded-full bg-gray-300" />
        </View>

        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pt-1 pb-3 border-b border-gray-100">
          <Text className="text-lg font-black text-gray-900">บันทึกคลิป</Text>
          <TouchableOpacity onPress={close} className="p-1">
            <XMarkIcon size={22} color="#6B7280" />
          </TouchableOpacity>
        </View>

        <Text className="text-gray-500 text-[12px] px-5 pt-3 pb-1 leading-5">
          เก็บคลิปไว้ในโฟลเดอร์ เพื่อให้ AI ช่วยวางแผนทริปจากคลิปที่คุณสนใจได้
        </Text>

        {/* Save without folder */}
        <TouchableOpacity
          onPress={handleSaveNoFolder}
          activeOpacity={0.7}
          className="flex-row items-center px-5 py-3.5 border-b border-gray-50"
        >
          <View className="w-10 h-10 rounded-xl bg-emerald-50 items-center justify-center mr-3">
            <BookmarkIcon size={20} color="#2D6A4F" />
          </View>
          <Text className="text-gray-900 font-semibold text-[14px]">บันทึกแบบไม่จัดโฟลเดอร์</Text>
        </TouchableOpacity>

        {/* Create new folder */}
        {creating ? (
          <View className="px-5 py-3 border-b border-gray-50">
            <View className="flex-row items-center">
              <TextInput
                value={newName}
                onChangeText={setNewName}
                autoFocus
                placeholder="ชื่อโฟลเดอร์ เช่น ทริปเชียงใหม่"
                placeholderTextColor="#9CA3AF"
                className="flex-1 bg-gray-100 rounded-xl px-3.5 py-2.5 text-[14px] text-gray-900"
              />
              <TouchableOpacity
                onPress={handleCreateAndSave}
                disabled={!newName.trim()}
                activeOpacity={0.8}
                className={`ml-2 px-4 py-2.5 rounded-xl ${newName.trim() ? "bg-[#2D6A4F]" : "bg-gray-200"}`}
              >
                <Text className="text-white font-bold text-[13px]">สร้าง</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setCreating(true)}
            activeOpacity={0.7}
            className="flex-row items-center px-5 py-3.5 border-b border-gray-50"
          >
            <View className="w-10 h-10 rounded-xl bg-amber-50 items-center justify-center mr-3">
              <FolderPlusIcon size={20} color="#D47A3A" />
            </View>
            <Text className="text-gray-900 font-semibold text-[14px]">สร้างโฟลเดอร์ใหม่</Text>
          </TouchableOpacity>
        )}

        {/* Existing folders */}
        <Text className="text-gray-400 text-[11px] font-bold px-5 pt-3 pb-1 uppercase">
          โฟลเดอร์ของคุณ
        </Text>
        <FlatList
          data={folders}
          keyExtractor={(f) => f.id}
          renderItem={({ item }) => {
            const alreadyIn = !!videoId && item.videoIds.includes(videoId);
            return (
              <TouchableOpacity
                onPress={() => handleSaveToFolder(item.id)}
                activeOpacity={0.7}
                className="flex-row items-center px-5 py-3"
              >
                <View className="w-10 h-10 rounded-xl bg-gray-100 items-center justify-center mr-3">
                  <FolderIcon size={20} color="#4B5563" />
                </View>
                <View className="flex-1">
                  <Text className="text-gray-900 font-semibold text-[14px]">{item.name}</Text>
                  <Text className="text-gray-400 text-[11px]">{item.videoIds.length} คลิป</Text>
                </View>
                {alreadyIn ? (
                  <CheckSolid size={22} color="#00D26A" />
                ) : (
                  <CheckCircleIcon size={22} color="#D1D5DB" />
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View className="px-5 py-6">
              <Text className="text-gray-400 text-[13px]">ยังไม่มีโฟลเดอร์ สร้างอันแรกได้เลย</Text>
            </View>
          }
        />
      </View>
    </Modal>
  );
}
