import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  XMarkIcon,
  GlobeAltIcon,
  ArrowRightOnRectangleIcon,
  CheckIcon,
} from "react-native-heroicons/outline";
import { useSettings, AppLanguage } from "../state/SettingsContext";

interface SettingsSheetProps {
  visible: boolean;
  onClose: () => void;
}

const LANGUAGES: { key: AppLanguage; label: string; flag: string }[] = [
  { key: "th", label: "ภาษาไทย", flag: "🇹🇭" },
  { key: "en", label: "English", flag: "🇬🇧" },
];

export default function SettingsSheet({ visible, onClose }: SettingsSheetProps) {
  const insets = useSafeAreaInsets();
  const { language, setLanguage, logout } = useSettings();

  const confirmLogout = () => {
    Alert.alert("ออกจากระบบ", "ต้องการออกจากระบบใช่ไหม?", [
      { text: "ยกเลิก", style: "cancel" },
      {
        text: "ออกจากระบบ",
        style: "destructive",
        onPress: () => {
          logout();
          onClose();
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View className="flex-1 bg-black/40" />
      </TouchableWithoutFeedback>

      <View
        className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl"
        style={{ paddingBottom: Math.max(insets.bottom, 12) + 12 }}
      >
        <View className="items-center pt-2.5 pb-1">
          <View className="w-10 h-1.5 rounded-full bg-gray-300" />
        </View>

        <View className="flex-row items-center justify-between px-5 pt-1 pb-3 border-b border-gray-100">
          <Text className="text-lg font-black text-gray-900">ตั้งค่า</Text>
          <TouchableOpacity onPress={onClose} className="p-1">
            <XMarkIcon size={22} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {/* Language */}
        <View className="px-5 pt-4">
          <View className="flex-row items-center mb-2">
            <GlobeAltIcon size={18} color="#2D6A4F" />
            <Text className="text-gray-900 font-bold text-[14px] ml-2">ภาษา / Language</Text>
          </View>
          {LANGUAGES.map((l) => {
            const active = language === l.key;
            return (
              <TouchableOpacity
                key={l.key}
                onPress={() => setLanguage(l.key)}
                activeOpacity={0.7}
                className={`flex-row items-center justify-between px-4 py-3.5 rounded-2xl mb-2 border ${
                  active ? "bg-emerald-50 border-emerald-300" : "bg-gray-50 border-gray-200"
                }`}
              >
                <Text className="text-[14px] text-gray-800">
                  {l.flag}  {l.label}
                </Text>
                {active && <CheckIcon size={18} color="#2D6A4F" strokeWidth={2.5} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Logout */}
        <View className="px-5 pt-3">
          <TouchableOpacity
            onPress={confirmLogout}
            activeOpacity={0.8}
            className="flex-row items-center justify-center bg-red-50 border border-red-200 py-3.5 rounded-2xl"
          >
            <ArrowRightOnRectangleIcon size={18} color="#DC2626" />
            <Text className="text-red-600 font-bold text-[14px] ml-2">ออกจากระบบ</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
