import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Heroicons - Outline
import {
  HomeIcon as HomeOutline,
  LightBulbIcon as LightBulbOutline,
  ChatBubbleLeftEllipsisIcon as ChatOutline,
  UserCircleIcon as UserOutline,
  PlusIcon,
} from "react-native-heroicons/outline";

// Heroicons - Solid
import {
  HomeIcon as HomeSolid,
  LightBulbIcon as LightBulbSolid,
  ChatBubbleLeftEllipsisIcon as ChatSolid,
  UserCircleIcon as UserSolid,
  SparklesIcon as SparklesSolid,
} from "react-native-heroicons/solid";

export type TabKey = "home" | "ai" | "create" | "chat" | "profile";

interface BottomMenuBarProps {
  activeTab?: TabKey;
  onTabChange?: (tab: TabKey) => void;
}

const ACTIVE_COLOR = "#00D26A";
const INACTIVE_COLOR = "#A1A1AA";

export default function BottomMenuBar({
  activeTab = "home",
  onTabChange,
}: BottomMenuBarProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // Responsive scale calculations
  const isSmallDevice = screenWidth < 360 || screenHeight < 680;
  // Proportional icon and spacing sizes
  const iconSize = isSmallDevice ? 22 : 24;
  const plusButtonSize = isSmallDevice ? 25 : 28;
  const plusIconSize = isSmallDevice ? 16 : 18;
  const fontSize = isSmallDevice ? "text-[10px]" : "text-[11px]";
  const paddingY = isSmallDevice ? "py-2.5" : "py-3";

  const handlePress = (tab: TabKey) => {
    onTabChange?.(tab);
  };

  return (
    <View
      style={{
        position: "absolute",
        left: 10,
        right: 10,
        bottom: Math.max(insets.bottom, 20),
      }}
      className={`bg-[#171717] rounded-full ${paddingY} px-2 flex-row items-center justify-around shadow-2xl shadow-black border border-white/5 z-50`}
    >
      {/* 1. หน้าหลัก */}
      <TouchableOpacity
        onPress={() => handlePress("home")}
        activeOpacity={0.7}
        className="flex-1 items-center justify-center py-1"
      >
        {activeTab === "home" ? (
          <HomeSolid size={iconSize} color={ACTIVE_COLOR} />
        ) : (
          <HomeOutline size={iconSize} color={INACTIVE_COLOR} strokeWidth={1.8} />
        )}
        <Text
          className={`${fontSize} mt-1 ${
            activeTab === "home"
              ? "text-[#00D26A] font-bold"
              : "text-[#A1A1AA] font-normal"
          }`}
        >
          หน้าหลัก
        </Text>
      </TouchableOpacity>

      {/* 2. AI ช่วยคิด */}
      <TouchableOpacity
        onPress={() => handlePress("ai")}
        activeOpacity={0.7}
        className="flex-1 items-center justify-center py-1"
      >
        <View className="relative">
          {activeTab === "ai" ? (
            <>
              <LightBulbSolid size={iconSize} color={ACTIVE_COLOR} />
              <View className="absolute -top-1 -right-2">
                <SparklesSolid size={isSmallDevice ? 10 : 12} color={ACTIVE_COLOR} />
              </View>
            </>
          ) : (
            <LightBulbOutline
              size={iconSize}
              color={INACTIVE_COLOR}
              strokeWidth={1.8}
            />
          )}
        </View>
        <Text
          className={`${fontSize} mt-1 ${
            activeTab === "ai"
              ? "text-[#00D26A] font-bold"
              : "text-[#A1A1AA] font-normal"
          }`}
        >
          AI ช่วยคิด
        </Text>
      </TouchableOpacity>

      {/* 3. เพิ่มโพส (ปุ่มตรงกลาง วงกลมสีขาว เครื่องหมายบวกสีเข้ม) */}
      <TouchableOpacity
        onPress={() => handlePress("create")}
        activeOpacity={0.7}
        className="flex-1 items-center justify-center py-1"
      >
        <View
          style={{ width: plusButtonSize, height: plusButtonSize }}
          className={`rounded-full items-center justify-center ${
            activeTab === "create" ? "bg-[#00D26A]" : "bg-white"
          }`}
        >
          <PlusIcon
            size={plusIconSize}
            color={activeTab === "create" ? "#000000" : "#171717"}
            strokeWidth={2.8}
          />
        </View>
        <Text
          className={`${fontSize} mt-1 ${
            activeTab === "create"
              ? "text-[#00D26A] font-bold"
              : "text-[#A1A1AA] font-normal"
          }`}
        >
          เพิ่มโพส
        </Text>
      </TouchableOpacity>

      {/* 4. กล่องข้อความ */}
      <TouchableOpacity
        onPress={() => handlePress("chat")}
        activeOpacity={0.7}
        className="flex-1 items-center justify-center py-1"
      >
        {activeTab === "chat" ? (
          <ChatSolid size={iconSize} color={ACTIVE_COLOR} />
        ) : (
          <ChatOutline size={iconSize} color={INACTIVE_COLOR} strokeWidth={1.8} />
        )}
        <Text
          className={`${fontSize} mt-1 ${
            activeTab === "chat"
              ? "text-[#00D26A] font-bold"
              : "text-[#A1A1AA] font-normal"
          }`}
        >
          กล่องข้อความ
        </Text>
      </TouchableOpacity>

      {/* 5. โปรไฟล์ */}
      <TouchableOpacity
        onPress={() => handlePress("profile")}
        activeOpacity={0.7}
        className="flex-1 items-center justify-center py-1"
      >
        {activeTab === "profile" ? (
          <UserSolid size={iconSize} color={ACTIVE_COLOR} />
        ) : (
          <UserOutline size={iconSize} color={INACTIVE_COLOR} strokeWidth={1.8} />
        )}
        <Text
          className={`${fontSize} mt-1 ${
            activeTab === "profile"
              ? "text-[#00D26A] font-bold"
              : "text-[#A1A1AA] font-normal"
          }`}
        >
          โปรไฟล์
        </Text>
      </TouchableOpacity>
    </View>
  );
}
