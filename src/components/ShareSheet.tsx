import React, { useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  FlatList,
  Share as RNShare,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  XMarkIcon,
  LinkIcon,
  PaperAirplaneIcon,
} from "react-native-heroicons/outline";
import { CheckCircleIcon as CheckSolid } from "react-native-heroicons/solid";
import { FRIENDS } from "../data/socialData";
import { useInteractions } from "../state/InteractionContext";

interface ShareSheetProps {
  visible: boolean;
  videoId: string | null;
  onClose: () => void;
}

/** Build the public link for a video (same scheme the backend would expose). */
function videoLink(videoId: string): string {
  return `https://local.app/v/${videoId}`;
}

/** Letter-fallback avatar. */
function Avatar({ avatar, name }: { avatar: any | null; name: string }) {
  if (avatar) {
    return <Image source={avatar} style={{ width: 48, height: 48, borderRadius: 24 }} />;
  }
  return (
    <View className="w-12 h-12 rounded-full bg-emerald-100 items-center justify-center">
      <Text className="text-[#2D6A4F] font-bold text-lg">{name.trim().charAt(0)}</Text>
    </View>
  );
}

export default function ShareSheet({ visible, videoId, onClose }: ShareSheetProps) {
  const insets = useSafeAreaInsets();
  const { shareToChat } = useInteractions();
  const [sentTo, setSentTo] = useState<string[]>([]);

  const handleSendToFriend = (friendId: string) => {
    if (!videoId) return;
    shareToChat(friendId, videoId);
    setSentTo((prev) => (prev.includes(friendId) ? prev : [...prev, friendId]));
  };

  const handleCopyLink = async () => {
    if (!videoId) return;
    try {
      // Opens the OS share dialog (includes a Copy option on all platforms)
      await RNShare.share({ message: videoLink(videoId) });
    } catch {
      // user cancelled
    }
  };

  const close = () => {
    setSentTo([]);
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
          <Text className="text-lg font-black text-gray-900">แชร์ไปให้</Text>
          <TouchableOpacity onPress={close} className="p-1">
            <XMarkIcon size={22} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {/* 2. Copy link */}
        <TouchableOpacity
          onPress={handleCopyLink}
          activeOpacity={0.7}
          className="flex-row items-center px-5 py-3.5 border-b border-gray-50"
        >
          <View className="w-11 h-11 rounded-full bg-blue-50 items-center justify-center mr-3">
            <LinkIcon size={20} color="#2563EB" />
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 font-semibold text-[14px]">คัดลอก / แชร์ลิงก์คลิป</Text>
            <Text className="text-gray-400 text-[11px]" numberOfLines={1}>
              {videoId ? videoLink(videoId) : ""}
            </Text>
          </View>
        </TouchableOpacity>

        {/* 1. Friends (send to chat) */}
        <Text className="text-gray-400 text-[11px] font-bold px-5 pt-3 pb-1 uppercase">
          เพื่อนที่ติดตามกัน
        </Text>
        <FlatList
          data={FRIENDS}
          keyExtractor={(f) => f.id}
          renderItem={({ item }) => {
            const sent = sentTo.includes(item.id);
            return (
              <View className="flex-row items-center px-5 py-2.5">
                <Avatar avatar={item.avatar} name={item.name} />
                <View className="flex-1 ml-3">
                  <Text className="text-gray-900 font-semibold text-[14px]">{item.name}</Text>
                  <Text className="text-gray-400 text-[11px]">{item.username}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleSendToFriend(item.id)}
                  disabled={sent}
                  activeOpacity={0.8}
                  className={`flex-row items-center px-3.5 py-2 rounded-full ${
                    sent ? "bg-emerald-50" : "bg-[#2D6A4F]"
                  }`}
                >
                  {sent ? (
                    <>
                      <CheckSolid size={15} color="#00D26A" />
                      <Text className="text-[#2D6A4F] font-bold text-[12px] ml-1">ส่งแล้ว</Text>
                    </>
                  ) : (
                    <>
                      <PaperAirplaneIcon size={14} color="#FFFFFF" />
                      <Text className="text-white font-bold text-[12px] ml-1">ส่ง</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            );
          }}
        />
      </View>
    </Modal>
  );
}
