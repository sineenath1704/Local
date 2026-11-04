import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ExclamationTriangleIcon,
  XMarkIcon,
} from "react-native-heroicons/outline";
import { useAuth } from "../state/AuthContext";

/**
 * Final-stage confirmation for permanent account deletion.
 *
 * Two deliberate friction points before the network call is allowed:
 *   1. A scrubbed list of what disappears (cascades + storage).
 *   2. Type "ลบบัชี" verbatim — a screen-reader-friendly guard
 *      against tap-by-mistake on mobile.
 *
 * Disables Android hardware back while the request is in-flight so
 * a mid-call tap can't leave the user half-deleted (Step M from the
 * validation review).
 */

const CONFIRM_WORD = "ลบบัญชี";

const DELETION_BULLETS = [
  "วิดีโอทุกคลิป รูป thumbnail และไฟล์ใน Storage ทั้งหมด",
  "ไลก์ เซฟ คอมเมนต์ รวมถึงรูปและวิดีโอในคอมเมนต์",
  "โฟลเดอร์ที่คุณเป็นเจ้าของ และสถานที่ที่คุณบันทึกไว้",
  "ทริปที่วางแผนไว้ การจอง และสแตมป์ของคุณ",
  "รูปโปรไฟล์ ไบโอ และการเป็นสมาชิกในห้องแชททั้งหมด",
];

/**
 * กฎของระบบ: ลบบัญชี = ลบแค่ของตัวเอง · ของคนอื่นต้องอยู่ครบ
 * ตัวอย่างที่ชัดที่สุด: ไลก์ที่เรากดบนคลิปของคนอื่น → หายแค่ "ร่องรอยของเรา"
 * (แถว video_likes) ส่วนคลิปของเขายังอยู่ และจำนวนไลก์ของเขาลดลงถูกต้อง
 */
const OTHER_PEOPLE_NOTE =
  "ข้อมูลของคนอื่นจะไม่หายไปด้วย เช่น คลิปที่คนอื่นเป็นเจ้าของยังอยู่ครบ หายแค่ร่องรอยของคุณ เช่น ไลก์ที่คุณกดไว้บนคลิปนั้น";

// Visible-but-kept behaviour (schema-level ON DELETE SET NULL).
// เก็บไว้เพราะการลบทิ้ง = ลบของคนอื่น (ข้อความในห้องแชทร่วม, โฟลเดอร์ของคนอื่น)
const SURVIVOR_NOTE =
  "บางอย่างจะยังอยู่โดยไม่มีชื่อคุณ เช่น สถานที่ที่คุณลงทะเบียนไว้ ข้อความที่คุณพิมพ์ และคลิปที่คุณเพิ่มในโฟลเดอร์ของคนอื่น";

// Side-effects a host needs to know about before pulling the trigger.
// หลังแก้ FK แล้ว ชุมชนจะไม่หายตามบัญชี → ของนักท่องเที่ยวคนอื่นไม่หาย
const HOST_SURVIVE_NOTE =
  "หากคุณเคยเป็นเจ้าของชุมชน: ชุมชนและบริการของชุมชนจะยังอยู่ และการจอง/สแตมป์ที่นักท่องเที่ยวคนอื่นทำไว้จะไม่หายไปด้วย — เพียงแต่ชุมชนจะไม่มีชื่อคุณเป็นเจ้าของ";

interface DeleteAccountSheetProps {
  visible: boolean;
  onClose: () => void;
  /** True when the calling user has otop_verified=true. */
  isHost?: boolean;
}

export default function DeleteAccountSheet({
  visible,
  onClose,
  isHost = false,
}: DeleteAccountSheetProps) {
  const insets = useSafeAreaInsets();
  const { user, deleteAccount } = useAuth();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setConfirm("");
    setBusy(false);
  };

  const handleConfirm = async () => {
    // Lock the button immediately on first tap — even before async resolves —
    // so a frustrated double-tap can't fire two POSTs in parallel.
    if (busy) return;
    setBusy(true);
    const result = await deleteAccount();
    setBusy(false);
    if (result.error) {
      Alert.alert("ลบบัญชีไม่สำเร็จ", result.error, [
        { text: "ลองอีกครั้ง", style: "default" },
        {
          text: "ปิด",
          style: "cancel",
          onPress: () => {
            reset();
            onClose();
          },
        },
      ]);
      return;
    }
    // Success: signOut has cleared auth state; close the sheet and reset
    // any draft text so a future re-use of this view doesn't pre-fill.
    reset();
    onClose();
  };

  const typedMatches = confirm === CONFIRM_WORD;
  const buttonEnabled = typedMatches && !busy;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={busy ? undefined : () => {
        reset();
        onClose();
      }}
    >
      <TouchableWithoutFeedback
        onPress={busy ? undefined : () => {
          reset();
          onClose();
        }}
      >
        <View className="flex-1 bg-black/50" />
      </TouchableWithoutFeedback>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      >
        <View
          className="bg-white rounded-t-3xl"
          style={{
            paddingBottom: Math.max(insets.bottom, 12) + 8,
            maxHeight: "85%",
          }}
        >
          <View className="items-center pt-2.5 pb-1">
            <View className="w-10 h-1.5 rounded-full bg-gray-300" />
          </View>

          <View className="flex-row items-center justify-between px-5 pt-1 pb-3 border-b border-gray-100">
            <View className="flex-row items-center">
              <ExclamationTriangleIcon size={20} color="#DC2626" />
              <Text className="text-red-600 text-lg font-black ml-2">
                ลบบัญชีถาวร
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                if (busy) return;
                reset();
                onClose();
              }}
              className="p-1"
              accessibilityRole="button"
            >
              <XMarkIcon size={22} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <ScrollView
            className="px-5 pt-4"
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text className="text-[15px] font-bold text-gray-900 mb-1">
              {user?.display_name ? user.display_name : "คุณ"}กำลังจะลบบัญชีนี้ไปตลอด
            </Text>
            <Text className="text-[13px] text-gray-600 mb-3">
              บัญชีของคุณและข้อมูลทั้งหมดที่เชื่อมกับบัญชีนี้จะถูกลบออกจากระบบอย่างถาวร ไม่สามารถกู้คืนได้
            </Text>

            <Text className="text-[12px] font-bold text-red-700 mb-2 uppercase tracking-wide">
              สิ่งที่จะหายไป
            </Text>
            {DELETION_BULLETS.map((line) => (
              <View key={line} className="flex-row items-start mb-1.5">
                <Text className="text-red-500 text-[15px] mr-2 mt-[-1px]">•</Text>
                <Text className="flex-1 text-[14px] text-red-700 leading-[20px]">
                  {line}
                </Text>
              </View>
            ))}

            {/* กฎของระบบ — ของคนอื่นไม่หายตาม */}
            <View className="mt-3 rounded-2xl bg-emerald-50 border border-emerald-200 px-3.5 py-3">
              <Text className="text-[13px] text-emerald-800 leading-[19px]">
                {OTHER_PEOPLE_NOTE}
              </Text>
            </View>

            {/* Caveat box — accent in yellow so it reads as info, not alarm. */}
            <View className="mt-2 rounded-2xl bg-amber-50 border border-amber-200 px-3.5 py-3">
              <Text className="text-[13px] text-amber-800 leading-[19px]">
                {SURVIVOR_NOTE}
              </Text>
            </View>

            {isHost ? (
              <View className="mt-2 rounded-2xl bg-gray-50 border border-gray-200 px-3.5 py-3">
                <Text className="text-[13px] text-gray-700 leading-[19px]">
                  {HOST_SURVIVE_NOTE}
                </Text>
              </View>
            ) : null}

            <View className="mt-5">
              <Text className="text-[13px] font-bold text-gray-800 mb-1.5">
                พิมพ์คำว่า &quot;{CONFIRM_WORD}&quot; เพื่อยืนยัน
              </Text>
              <TextInput
                value={confirm}
                onChangeText={setConfirm}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                placeholder={CONFIRM_WORD}
                placeholderTextColor="#9CA3AF"
                className="border border-gray-300 rounded-2xl px-4 py-3 text-[15px] text-gray-900 bg-white"
                accessibilityLabel="พิมพ์คำว่าลบบัญชีเพื่อยืนยัน"
              />
              {confirm.length > 0 && !typedMatches ? (
                <Text className="text-[12px] text-red-500 mt-1">
                  คำที่พิมพ์ไม่ตรง กรุณาพิมพ์ &quot;{CONFIRM_WORD}&quot; ให้ถูกต้อง
                </Text>
              ) : null}
            </View>
            <View className="h-4" />
          </ScrollView>

          <View className="px-5 pt-2 pb-1">
            <TouchableOpacity
              onPress={handleConfirm}
              disabled={!buttonEnabled}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ disabled: !buttonEnabled }}
              className={`py-3.5 rounded-2xl items-center justify-center flex-row ${
                buttonEnabled ? "bg-red-600" : "bg-gray-200"
              }`}
            >
              {busy ? (
                <>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text className="text-white text-[15px] font-bold ml-2">
                    กำลังลบบัญชี...
                  </Text>
                </>
              ) : (
                <Text
                  className={`text-[15px] font-bold ${
                    buttonEnabled ? "text-white" : "text-gray-500"
                  }`}
                >
                  ยืนยันการลบถาวร
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                if (busy) return;
                reset();
                onClose();
              }}
              className="py-3 items-center"
              accessibilityRole="button"
            >
              <Text className="text-[14px] text-gray-600 font-semibold">
                ยกเลิก
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
