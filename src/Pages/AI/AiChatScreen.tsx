import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  FolderIcon,
} from "react-native-heroicons/outline";
import { useAiPlanner } from "../../state/AiPlannerContext";
import { useInteractions } from "../../state/InteractionContext";
import { sendChat } from "../../services/aiChatService";
import { placeLabelsFor, AiChatMessage } from "../../data/tripsData";

interface AiChatScreenProps {
  threadId: string;
  onBack: () => void;
  onPlanTrip?: (folderId?: string) => void;
}

const SUGGESTIONS = [
  "ช่วยวางแผนทริป 3 วันจากคลิปที่เซฟไว้",
  "ที่พักชุมชนงบไม่เกิน 500 บาทมีที่ไหนบ้าง",
  "แนะนำอาหารพื้นถิ่นที่ต้องลอง",
];

export default function AiChatScreen({ threadId, onBack, onPlanTrip }: AiChatScreenProps) {
  const insets = useSafeAreaInsets();
  const { getThread, appendMessage } = useAiPlanner();
  const { folders } = useInteractions();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<AiChatMessage>>(null);

  const thread = getThread(threadId);
  const folder = thread?.folderId ? folders.find((f) => f.id === thread.folderId) : undefined;

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || !thread || sending) return;

    appendMessage(threadId, { role: "user", content: body });
    setDraft("");
    setSending(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

    const history = [...thread.messages.map((m) => ({ role: m.role, content: m.content })), {
      role: "user" as const,
      content: body,
    }];

    const folderCtx = folder
      ? { folderName: folder.name, places: placeLabelsFor(folder.videoIds) }
      : undefined;

    const reply = await sendChat(history, folderCtx);
    appendMessage(threadId, { role: "assistant", content: reply });
    setSending(false);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  };

  const isEmpty = !thread || thread.messages.length === 0;

  return (
    <View className="flex-1 bg-white">
      {/* Header */}
      <View
        style={{ paddingTop: Math.max(insets.top, 12) + 6 }}
        className="flex-row items-center px-3 pb-3 border-b border-gray-100"
      >
        <TouchableOpacity onPress={onBack} className="p-1 mr-1">
          <ArrowLeftIcon size={24} color="#18181B" strokeWidth={2} />
        </TouchableOpacity>
        <View className="w-9 h-9 rounded-full bg-violet-100 items-center justify-center mr-2.5">
          {folder ? <FolderIcon size={18} color="#7C3AED" /> : <SparklesIcon size={18} color="#7C3AED" />}
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-bold text-gray-900" numberOfLines={1}>
            {thread?.title ?? "แชท AI"}
          </Text>
          <Text className="text-[11px] text-gray-400">
            {folder ? `จากโฟลเดอร์ • ${folder.videoIds.length} คลิป` : "แชททั่วไป"}
          </Text>
        </View>
        {folder && onPlanTrip && (
          <TouchableOpacity
            onPress={() => onPlanTrip(folder.id)}
            activeOpacity={0.8}
            className="bg-violet-600 px-3 py-2 rounded-full flex-row items-center"
          >
            <SparklesIcon size={14} color="#FFFFFF" />
            <Text className="text-white text-[12px] font-bold ml-1">วางแผนทริป</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Messages / empty state */}
      {isEmpty ? (
        <View className="flex-1 px-6 justify-center">
          <View className="items-center mb-8">
            <View className="w-16 h-16 rounded-3xl bg-violet-100 items-center justify-center mb-3">
              <SparklesIcon size={30} color="#7C3AED" />
            </View>
            <Text className="text-xl font-black text-gray-900">AI ช่วยคิด</Text>
            <Text className="text-gray-500 text-[13px] text-center mt-1 leading-5">
              {folder
                ? `ถามอะไรก็ได้เกี่ยวกับคลิปในโฟลเดอร์ "${folder.name}" หรือกด "วางแผนทริป" ได้เลย`
                : "ผู้ช่วยวางแผนเที่ยว ถามเรื่องที่พัก เส้นทาง อาหารพื้นถิ่น หรือวางแผนทริปได้เลย"}
            </Text>
          </View>
          {SUGGESTIONS.map((s, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => send(s)}
              activeOpacity={0.7}
              className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 mb-2.5"
            >
              <Text className="text-gray-700 text-[13px]">{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={thread!.messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingVertical: 14, paddingHorizontal: 14 }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const mine = item.role === "user";
            return (
              <View className={`mb-3 flex-row ${mine ? "justify-end" : "justify-start"}`}>
                {!mine && (
                  <View className="w-7 h-7 rounded-full bg-violet-100 items-center justify-center mr-2 mt-0.5">
                    <SparklesIcon size={14} color="#7C3AED" />
                  </View>
                )}
                <View
                  className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl ${
                    mine ? "bg-[#2D6A4F] rounded-br-md" : "bg-gray-100 rounded-bl-md"
                  }`}
                >
                  <Text className={`text-[13.5px] leading-5 ${mine ? "text-white" : "text-gray-900"}`}>
                    {item.content}
                  </Text>
                </View>
              </View>
            );
          }}
          ListFooterComponent={
            sending ? (
              <View className="flex-row items-center ml-9 mb-3">
                <ActivityIndicator size="small" color="#7C3AED" />
                <Text className="text-gray-400 text-[12px] ml-2">กำลังคิด...</Text>
              </View>
            ) : null
          }
        />
      )}

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
              placeholder="ถาม AI ช่วยคิด..."
              placeholderTextColor="#9CA3AF"
              className="text-[14px] text-gray-900 py-0"
              multiline
              editable={!sending}
            />
          </View>
          <TouchableOpacity
            onPress={() => send(draft)}
            disabled={!draft.trim() || sending}
            activeOpacity={0.8}
            className={`ml-2 w-11 h-11 rounded-full items-center justify-center ${
              draft.trim() && !sending ? "bg-violet-600" : "bg-gray-200"
            }`}
          >
            <PaperAirplaneIcon size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
