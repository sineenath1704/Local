import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StatusBar,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  FolderIcon,
  ChatBubbleLeftRightIcon,
  MapIcon,
  PlusIcon,
  SparklesIcon,
} from "react-native-heroicons/outline";
import { useInteractions } from "../../state/InteractionContext";
import { useAiPlanner } from "../../state/AiPlannerContext";

import FolderDetailScreen from "./FolderDetailScreen";
import AiChatScreen from "./AiChatScreen";
import TripDashboard from "./TripDashboard";
import TripWizard from "./TripWizard";
import ItineraryViewer from "./ItineraryViewer";

type HubTab = "folders" | "chat" | "trips";

type Nav =
  | { view: "hub" }
  | { view: "folderDetail"; folderId: string }
  | { view: "chat"; threadId: string }
  | { view: "wizard"; folderId?: string }
  | { view: "itinerary"; tripId: string };

interface AiHubScreenProps {
  onFullScreenChange?: (full: boolean) => void;
}

export default function AiHubScreen({ onFullScreenChange }: AiHubScreenProps) {
  const insets = useSafeAreaInsets();
  const { folders } = useInteractions();
  const { threads, startGeneralThread, startFolderThread } = useAiPlanner();

  const [tab, setTab] = useState<HubTab>("folders");
  const [nav, setNav] = useState<Nav>({ view: "hub" });

  // Hide the bottom menu bar whenever we're not on the hub list.
  React.useEffect(() => {
    onFullScreenChange?.(nav.view !== "hub");
  }, [nav.view, onFullScreenChange]);

  const goHub = () => setNav({ view: "hub" });

  // ---- Full-screen sub-views ----
  if (nav.view === "folderDetail") {
    return (
      <FolderDetailScreen
        folderId={nav.folderId}
        onBack={goHub}
        onChatFromFolder={(folderId, folderName) => {
          const id = startFolderThread(folderId, folderName);
          setNav({ view: "chat", threadId: id });
        }}
        onPlanTrip={(folderId) => setNav({ view: "wizard", folderId })}
      />
    );
  }
  if (nav.view === "chat") {
    return (
      <AiChatScreen
        threadId={nav.threadId}
        onBack={goHub}
        onPlanTrip={(folderId) => setNav({ view: "wizard", folderId })}
      />
    );
  }
  if (nav.view === "wizard") {
    return (
      <TripWizard
        initialFolderId={nav.folderId}
        onBack={goHub}
        onCreated={(tripId) => setNav({ view: "itinerary", tripId })}
      />
    );
  }
  if (nav.view === "itinerary") {
    return <ItineraryViewer tripId={nav.tripId} onBack={() => { setTab("trips"); goHub(); }} />;
  }

  // ---- Hub (list) ----
  return (
    <View className="flex-1 bg-white">
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <View
        style={{ paddingTop: Math.max(insets.top, 16) + (Platform.OS === "android" ? 8 : 4) }}
        className="px-5 pb-2"
      >
        <View className="flex-row items-center">
          <View className="w-9 h-9 rounded-2xl bg-violet-100 items-center justify-center mr-2.5">
            <SparklesIcon size={20} color="#7C3AED" />
          </View>
          <Text className="text-2xl font-black text-gray-900">AI ช่วยคิด</Text>
        </View>
      </View>

      {/* Primary tabs */}
      <View className="flex-row px-3 border-b border-gray-100">
        {([
          ["folders", "โฟลเดอร์", FolderIcon],
          ["chat", "แชท AI", ChatBubbleLeftRightIcon],
          ["trips", "ทริปของฉัน", MapIcon],
        ] as const).map(([key, label, Icon]) => {
          const active = tab === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setTab(key)}
              activeOpacity={0.7}
              className={`flex-1 py-3 items-center flex-row justify-center border-b-2 ${
                active ? "border-violet-600" : "border-transparent"
              }`}
            >
              <Icon size={16} color={active ? "#7C3AED" : "#9CA3AF"} />
              <Text className={`text-[13px] ml-1.5 ${active ? "font-bold text-violet-700" : "font-medium text-gray-500"}`}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ---- Folders tab ---- */}
      {tab === "folders" && (
        <FlatList
          data={folders}
          keyExtractor={(f) => f.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => setNav({ view: "folderDetail", folderId: item.id })}
              activeOpacity={0.8}
              className="flex-row items-center bg-gray-50 border border-gray-100 rounded-2xl p-4 mb-2.5"
            >
              <View className="w-12 h-12 rounded-2xl bg-amber-100 items-center justify-center mr-3">
                <FolderIcon size={24} color="#D47A3A" />
              </View>
              <View className="flex-1">
                <Text className="text-gray-900 font-bold text-[15px]">{item.name}</Text>
                <Text className="text-gray-400 text-[12px]">{item.videoIds.length} คลิปที่บันทึก</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View className="py-20 items-center px-10">
              <FolderIcon size={44} color="#D1D5DB" />
              <Text className="text-gray-400 text-sm text-center mt-3 leading-5">
                ยังไม่มีโฟลเดอร์ ไปที่หน้าหลักแล้วกดบันทึกคลิปที่ชอบ เลือกสร้างโฟลเดอร์ไว้ให้ AI วางแผนทริปได้
              </Text>
            </View>
          }
        />
      )}

      {/* ---- Chat tab ---- */}
      {tab === "chat" && (
        <View className="flex-1">
          <TouchableOpacity
            onPress={() => {
              const id = startGeneralThread();
              setNav({ view: "chat", threadId: id });
            }}
            activeOpacity={0.9}
            className="mx-4 mt-3 mb-2 bg-violet-600 rounded-2xl p-4 flex-row items-center justify-center"
          >
            <PlusIcon size={20} color="#FFFFFF" strokeWidth={2.5} />
            <Text className="text-white font-black text-[15px] ml-1.5">เริ่มแชทใหม่ (เรื่องทั่วไป)</Text>
          </TouchableOpacity>

          <Text className="text-gray-400 text-[11px] font-bold px-5 pt-2 pb-1 uppercase">แชทที่ผ่านมา</Text>
          <FlatList
            data={threads}
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => setNav({ view: "chat", threadId: item.id })}
                activeOpacity={0.7}
                className="flex-row items-center py-3 border-b border-gray-50"
              >
                <View className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${item.folderId ? "bg-amber-100" : "bg-violet-100"}`}>
                  {item.folderId ? <FolderIcon size={18} color="#D47A3A" /> : <ChatBubbleLeftRightIcon size={18} color="#7C3AED" />}
                </View>
                <View className="flex-1">
                  <Text className="text-gray-900 font-semibold text-[14px]" numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text className="text-gray-400 text-[12px]" numberOfLines={1}>
                    {item.folderId ? "จากโฟลเดอร์" : "แชททั่วไป"} • {item.messages.length} ข้อความ
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View className="py-16 items-center">
                <Text className="text-gray-400 text-sm">ยังไม่มีประวัติแชท</Text>
              </View>
            }
          />
        </View>
      )}

      {/* ---- Trips tab ---- */}
      {tab === "trips" && (
        <TripDashboard
          onNewTrip={() => setNav({ view: "wizard" })}
          onOpenTrip={(tripId) => setNav({ view: "itinerary", tripId })}
        />
      )}
    </View>
  );
}
