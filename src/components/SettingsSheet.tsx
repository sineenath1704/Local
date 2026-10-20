import React, { useState } from "react";
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
  BugAntIcon,
  ExclamationTriangleIcon,
} from "react-native-heroicons/outline";
import { useSettings, AppLanguage } from "../state/SettingsContext";
import { useAuth } from "../state/AuthContext";
import AiDiagnosticsSheet from "./AiDiagnosticsSheet";
import DeleteAccountSheet from "./DeleteAccountSheet";
import { describeBaseUrl, useAiDiagnostics } from "../services/aiDiagnostics";

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
  const { language, setLanguage } = useSettings();
  const { signOut, user } = useAuth();
  const diagnostics = useAiDiagnostics();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);

  const confirmLogout = () => {
    Alert.alert("ออกจากระบบ", "ต้องการออกจากระบบใช่ไหม?", [
      { text: "ยกเลิก", style: "cancel" },
      {
        text: "ออกจากระบบ",
        style: "destructive",
        onPress: async () => {
          onClose();
          await signOut();
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

        {/* AI diagnostics — which URL the app hits, and what failed */}
        <View className="px-5 pt-4">
          <TouchableOpacity
            onPress={() => setShowDiagnostics(true)}
            activeOpacity={0.8}
            className="flex-row items-center justify-between bg-gray-900 rounded-2xl px-4 py-3"
          >
            <View className="flex-1 pr-3">
              <View className="flex-row items-center">
                <BugAntIcon size={16} color="#A3E635" />
                <Text className="text-white font-bold text-[14px] ml-2">
                  AI Diagnostics
                </Text>
                {diagnostics.some((d) => d.outcome === "error") ? (
                  <View className="ml-2 px-1.5 py-0.5 rounded-md bg-red-500">
                    <Text className="text-white text-[10px] font-bold">
                      {diagnostics.filter((d) => d.outcome === "error").length}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text className="text-gray-400 text-[10px] font-mono mt-1" numberOfLines={1}>
                {describeBaseUrl()}
              </Text>
            </View>
            <Text className="text-gray-400 text-[12px] font-bold">ดู ›</Text>
          </TouchableOpacity>
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

        {/* Danger Zone — kept visually separate so it isn't mistaken for
            a routine toggle. Opens a type-to-confirm bottom sheet. */}
        <View className="px-5 pt-6 pb-2">
          <View className="flex-row items-center mb-2">
            <ExclamationTriangleIcon size={14} color="#DC2626" />
            <Text className="text-red-600 font-bold text-[12px] ml-1.5 uppercase tracking-wider">
              โซนอันตราย
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setShowDeleteAccount(true)}
            activeOpacity={0.8}
            className="flex-row items-center justify-center bg-white border-2 border-red-200 py-3.5 rounded-2xl"
          >
            <ExclamationTriangleIcon size={18} color="#DC2626" />
            <Text className="text-red-600 font-bold text-[14px] ml-2">
              ลบบัญชีถาวร
            </Text>
          </TouchableOpacity>
          <Text className="text-[11px] text-gray-500 mt-1.5 px-1 leading-[16px]">
            ลบบัญชี คลิป คอมเมนต์ แชท และข้อมูลทั้งหมดที่เชื่อมกับบัญชีนี้ ไม่สามารถกู้คืนได้
          </Text>
        </View>
      </View>

      {/* Full-screen siblings — Modals nest poorly on iOS. */}
      <AiDiagnosticsSheet
        visible={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
      />
      <DeleteAccountSheet
        visible={showDeleteAccount}
        onClose={() => setShowDeleteAccount(false)}
        isHost={Boolean(user?.otop_verified)}
      />
    </Modal>
  );
}
