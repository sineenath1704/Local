import React, { useState } from "react";
import {
  Modal,
  Platform,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  Text,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { XMarkIcon } from "react-native-heroicons/outline";

/**
 * ล้อเวลาออกเดินทาง (native)
 * =============================================================
 * ใช้ `@react-native-community/datetimepicker` (v9.2.1 — รวมอยู่ใน Expo Go แล้ว)
 * → ได้ UI ของระบบ (ล้อแบบ iOS / นาฬิกาของ Android) ไม่ต้องเขียนล้อเอง
 *
 * เก็บค่าเป็น "HH:mm" เสมอ (24 ชั่วโมง) ไม่ว่าผู้ใช้จะเลือกอะไรในล้อ
 */

function parseHhMm(value?: string | null): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!m) return { h: 8, m: 0 };
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return { h, m: mm };
}

function toHhMm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

interface TripTimeSheetProps {
  visible: boolean;
  /** ค่าเวลาปัจจุบัน ("HH:mm") */
  value?: string | null;
  onCancel: () => void;
  onConfirm: (time: string) => void;
}

export default function TripTimeSheet({
  visible,
  value,
  onCancel,
  onConfirm,
}: TripTimeSheetProps) {
  const insets = useSafeAreaInsets();
  /**
   * เริ่มจากค่าที่ส่งเข้ามา
   * (แม่เรียก mount ใหม่ทุกครั้งที่เปิดล้อ → ได้ค่าล่าสุดเสมอ ไม่ต้องมี effect)
   */
  const [draft, setDraft] = useState<Date>(() => {
    const { h, m } = parseHhMm(value);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  });

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    if (event.type === "dismissed") {
      if (Platform.OS === "android") onCancel();
      return;
    }
    if (!date) return;
    setDraft(date);
    // Android เปิดเป็น dialog ของระบบ → เลือกเสร็จกด OK แล้วปิดได้เลย
    if (Platform.OS === "android") onConfirm(toHhMm(date));
  };

  const text = toHhMm(draft);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <TouchableWithoutFeedback onPress={onCancel}>
        <View className="flex-1 bg-black/40" />
      </TouchableWithoutFeedback>
      <View
        className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        <View className="items-center pt-2.5 pb-1">
          <View className="w-10 h-1.5 rounded-full bg-gray-300" />
        </View>
        <View className="px-5 pt-1 pb-3 flex-row items-center justify-between border-b border-gray-100">
          <Text className="text-[16px] font-black text-gray-900">
            เวลาออกเดินทาง
          </Text>
          <TouchableOpacity onPress={onCancel} className="p-1">
            <XMarkIcon size={22} color="#6B7280" />
          </TouchableOpacity>
        </View>

        <View className="px-5 pt-4 items-center">
          <Text className="text-[32px] font-black text-gray-900">{text}</Text>
          <Text className="text-[12px] text-gray-400 mt-0.5">
            เลื่อนเพื่อเลือกเวลา (ทีละ 5 นาที)
          </Text>
        </View>

        <View className="px-2 pt-1">
          <DateTimePicker
            value={draft}
            mode="time"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            minuteInterval={5}
            is24Hour
            locale="en-GB"
            onChange={handleChange}
            accentColor="#7C3AED"
            textColor="#111827"
            themeVariant="light"
          />
        </View>

        {Platform.OS === "ios" ? (
          <View className="flex-row px-5 pt-2 pb-1">
            <TouchableOpacity
              onPress={onCancel}
              activeOpacity={0.85}
              className="flex-1 py-3 rounded-2xl border border-gray-200 items-center justify-center mr-2"
            >
              <Text className="text-[14px] font-bold text-gray-600">ยกเลิก</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onConfirm(text)}
              activeOpacity={0.85}
              className="flex-1 py-3 rounded-2xl bg-violet-600 items-center justify-center ml-2"
            >
              <Text className="text-[14px] font-bold text-white">ตกลง</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
