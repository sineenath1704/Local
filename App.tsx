import "./global.css";
import React, { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { View, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import BottomMenuBar, { TabKey } from "./src/components/BottomMenuBar";
import { InteractionProvider } from "./src/state/InteractionContext";
import { ChatProvider } from "./src/state/ChatContext";
import { AiPlannerProvider } from "./src/state/AiPlannerContext";
import { MyProfileProvider } from "./src/state/MyProfileContext";
import { SettingsProvider, useSettings } from "./src/state/SettingsContext";
import HomeScreen from "./src/Pages/HomeScreen";
import ProfileLocal from "./src/Pages/ProfileLocal";
import ChatScreen from "./src/Pages/ChatScreen";
import AiHubScreen from "./src/Pages/AI/AiHubScreen";
import FolderDetailScreen from "./src/Pages/AI/FolderDetailScreen";
import MapScreen, { MapSelectionInfo } from "./src/Pages/Map/MapScreen";
import { PlaceItem } from "./src/data/thailandGeographicData";

function AppContent() {
  const { loggedOut, resetSession } = useSettings();
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [isMapOpen, setIsMapOpen] = useState<boolean>(false);
  const [mapProvinceName, setMapProvinceName] = useState<string>("กรุงเทพมหานคร");

  // Track what was last selected in the map so the HomeScreen pin can reflect it
  const [mapSelection, setMapSelection] = useState<MapSelectionInfo | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<PlaceItem | null>(null);

  // Hide the bottom bar while a chat room is open (its composer sits at bottom)
  const [chatRoomOpen, setChatRoomOpen] = useState<boolean>(false);
  // Hide the bottom bar while an AI sub-view (chat/wizard/itinerary) is open
  const [aiFullScreen, setAiFullScreen] = useState<boolean>(false);
  // Hide the bottom bar while a profile sub-view (own-video viewer) is open
  const [profileFullScreen, setProfileFullScreen] = useState<boolean>(false);
  // A folder opened from the Profile "saved" tab
  const [profileFolderId, setProfileFolderId] = useState<string | null>(null);

  const tabLabels: Record<TabKey, string> = {
    home: "หน้าหลัก",
    ai: "AI ช่วยคิด",
    create: "เพิ่มโพส",
    chat: "กล่องข้อความ",
    profile: "โปรไฟล์",
  };

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    // ปิด Map เมื่อผู้ใช้กดสลับแท็บเมนูด้านล่าง
    if (tab !== "home") {
      setIsMapOpen(false);
    }
    // ออกจากห้องแชทเมื่อสลับแท็บ
    if (tab !== "chat") {
      setChatRoomOpen(false);
    }
    if (tab !== "ai") {
      setAiFullScreen(false);
    }
    if (tab !== "profile") {
      setProfileFullScreen(false);
      setProfileFolderId(null);
    }
  };

  // Logged-out placeholder (auth system not built yet)
  if (loggedOut) {
    return (
      <View className="flex-1 bg-[#121212] items-center justify-center px-8">
        <Text className="text-2xl font-black text-white mb-2">ออกจากระบบแล้ว</Text>
        <Text className="text-sm text-gray-400 text-center mb-6">
          ระบบล็อกอินยังอยู่ระหว่างการพัฒนา กดด้านล่างเพื่อกลับเข้าใช้งาน
        </Text>
        <View
          className="bg-[#00D26A] px-8 py-3 rounded-full"
          onTouchEnd={() => resetSession()}
        >
          <Text className="text-black font-bold">กลับเข้าสู่ระบบ</Text>
        </View>
      </View>
    );
  }

  return (
      <View className="flex-1 w-full h-full bg-black">
        <StatusBar
          style={
            activeTab === "profile" || (activeTab === "home" && isMapOpen)
              ? "dark"
              : "light"
          }
        />

        {/* Main Content Area */}
        {activeTab === "home" ? (
          isMapOpen ? (
            <MapScreen
              initialProvinceName={mapProvinceName}
              onBackToHome={() => setIsMapOpen(false)}
              onSelectionChange={(info) => setMapSelection(info)}
              onSelectPlaceForFeed={(place) => {
                setSelectedPlace(place);
                setIsMapOpen(false);
              }}
            />
          ) : (
            <HomeScreen
              onOpenMap={(prov) => {
                setMapProvinceName(prov || "กรุงเทพมหานคร");
                setIsMapOpen(true);
              }}
              mapSelection={mapSelection}
              selectedPlace={selectedPlace}
            />
          )
        ) : activeTab === "profile" ? (
          profileFolderId ? (
            <FolderDetailScreen
              folderId={profileFolderId}
              onBack={() => setProfileFolderId(null)}
              onChatFromFolder={() => {
                setProfileFolderId(null);
                handleTabChange("ai");
              }}
              onPlanTrip={() => {
                setProfileFolderId(null);
                handleTabChange("ai");
              }}
            />
          ) : (
            <ProfileLocal
              onOpenFolder={(folderId) => setProfileFolderId(folderId)}
              onFullScreenChange={setProfileFullScreen}
            />
          )
        ) : activeTab === "chat" ? (
          <ChatScreen onRoomOpenChange={setChatRoomOpen} />
        ) : activeTab === "ai" ? (
          <AiHubScreen onFullScreenChange={setAiFullScreen} />
        ) : (
          <View className="flex-1 bg-[#121212] items-center justify-center px-6">
            <Text className="text-2xl font-bold text-white mb-2">
              {tabLabels[activeTab]}
            </Text>
            <Text className="text-sm text-gray-400">
              หน้านี้อยู่ในระหว่างการพัฒนา
            </Text>
          </View>
        )}

        {/* Bottom Menu Bar (hidden during Map flow, chat room, AI sub-view, or profile sub-view) */}
        {!isMapOpen &&
          !(activeTab === "chat" && chatRoomOpen) &&
          !(activeTab === "ai" && aiFullScreen) &&
          !(activeTab === "profile" && (profileFullScreen || profileFolderId)) && (
            <BottomMenuBar activeTab={activeTab} onTabChange={handleTabChange} />
          )}
      </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <InteractionProvider>
          <MyProfileProvider>
            <ChatProvider>
              <AiPlannerProvider>
                <AppContent />
              </AiPlannerProvider>
            </ChatProvider>
          </MyProfileProvider>
        </InteractionProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
