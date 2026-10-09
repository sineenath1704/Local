import React, { useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  PaperAirplaneIcon,
  UserGroupIcon,
  PlayIcon,
  UserPlusIcon,
} from "react-native-heroicons/outline";
import { ChatMessage, ME_ID, friendName, friendAvatar } from "../data/chatData";

interface ChatRoomProps {
  title: string;
  subtitle?: string;
  avatar?: any | null;
  isGroup?: boolean;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onBack: () => void;
  onAddMembers?: () => void;
}

/** One message row (text or shared video), left for others, right for me. */
function MessageBubble({ message, isGroup }: { message: ChatMessage; isGroup: boolean }) {
  const mine = message.senderId === ME_ID;
  const avatar = friendAvatar(message.senderId);

  return (
    <View className={`flex-row items-end mb-2.5 px-3 ${mine ? "justify-end" : "justify-start"}`}>
      {!mine && (
        <View className="mr-2">
          {avatar ? (
            <Image source={avatar} style={{ width: 28, height: 28, borderRadius: 14 }} />
          ) : (
            <View className="w-7 h-7 rounded-full bg-emerald-100 items-center justify-center">
              <Text className="text-[#2D6A4F] font-bold text-[11px]">
                {friendName(message.senderId).charAt(0)}
              </Text>
            </View>
          )}
        </View>
      )}

      <View className="max-w-[76%]">
        {/* Sender name in groups */}
        {!mine && isGroup && (
          <Text className="text-gray-400 text-[10px] mb-0.5 ml-1">
            {friendName(message.senderId)}
          </Text>
        )}

        {message.sharedVideoId ? (
          // Shared video card
          <View
            className={`rounded-2xl overflow-hidden border ${
              mine ? "bg-[#2D6A4F] border-[#2D6A4F]" : "bg-gray-100 border-gray-200"
            }`}
            style={{ width: 180 }}
          >
            <View className="h-24 bg-black/80 items-center justify-center">
              <PlayIcon size={30} color="#FFFFFF" />
            </View>
            <View className="p-2.5">
              <Text className={`text-[12px] font-bold ${mine ? "text-white" : "text-gray-900"}`}>
                แชร์คลิปวิดีโอ
              </Text>
              <Text className={`text-[10px] ${mine ? "text-white/70" : "text-gray-400"}`} numberOfLines={1}>
                {message.sharedVideoId}
              </Text>
            </View>
          </View>
        ) : (
          // Text bubble
          <View
            className={`px-3.5 py-2.5 rounded-2xl ${
              mine ? "bg-[#2D6A4F] rounded-br-md" : "bg-gray-100 rounded-bl-md"
            }`}
          >
            <Text className={`text-[13.5px] leading-5 ${mine ? "text-white" : "text-gray-900"}`}>
              {message.text}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function ChatRoom({
  title,
  subtitle,
  avatar,
  isGroup = false,
  messages,
  onSend,
  onBack,
  onAddMembers,
}: ChatRoomProps) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  };

  return (
    <View className="flex-1 bg-white">
      {/* Header */}
      <View
        style={{ paddingTop: Math.max(insets.top, 12) + 6 }}
        className="flex-row items-center px-3 pb-3 border-b border-gray-100 bg-white"
      >
        <TouchableOpacity onPress={onBack} activeOpacity={0.7} className="p-1 mr-1">
          <ArrowLeftIcon size={24} color="#18181B" strokeWidth={2} />
        </TouchableOpacity>

        {isGroup ? (
          <View className="w-10 h-10 rounded-full bg-emerald-100 items-center justify-center mr-3">
            <UserGroupIcon size={20} color="#2D6A4F" />
          </View>
        ) : avatar ? (
          <Image source={avatar} style={{ width: 40, height: 40, borderRadius: 20 }} className="mr-3" />
        ) : (
          <View className="w-10 h-10 rounded-full bg-emerald-100 items-center justify-center mr-3">
            <Text className="text-[#2D6A4F] font-bold">{title.charAt(0)}</Text>
          </View>
        )}

        <View className="flex-1">
          <Text className="text-[15px] font-bold text-gray-900" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? <Text className="text-[11px] text-gray-400">{subtitle}</Text> : null}
        </View>

        {isGroup && onAddMembers && (
          <TouchableOpacity onPress={onAddMembers} activeOpacity={0.7} className="p-1.5">
            <UserPlusIcon size={22} color="#2D6A4F" />
          </TouchableOpacity>
        )}
      </View>

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} isGroup={isGroup} />}
        contentContainerStyle={{ paddingVertical: 12 }}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View className="py-20 items-center">
            <Text className="text-gray-400 text-sm">เริ่มบทสนทนาได้เลย 👋</Text>
          </View>
        }
      />

      {/* Composer */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View
          className="flex-row items-center px-3 pt-2 border-t border-gray-100"
          style={{ paddingBottom: Math.max(insets.bottom, 10) }}
        >
          <View className="flex-1 bg-gray-100 rounded-full px-4 py-2.5">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="พิมพ์ข้อความ..."
              placeholderTextColor="#9CA3AF"
              className="text-[14px] text-gray-900 py-0"
              multiline
            />
          </View>
          <TouchableOpacity
            onPress={handleSend}
            disabled={!draft.trim()}
            activeOpacity={0.8}
            className={`ml-2 w-11 h-11 rounded-full items-center justify-center ${
              draft.trim() ? "bg-[#2D6A4F]" : "bg-gray-200"
            }`}
          >
            <PaperAirplaneIcon size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
