import React, { useState } from "react";
import { Modal, Pressable, View, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { XMarkIcon } from "react-native-heroicons/outline";
import { Wheel, ITEM_H } from "./TripTimeSheet";

/**
 * ล้อเลือก "เวลาเริ่มที่จะอยู่ – เวลาสิ้นสุด" (เขียนเองทั้งหมด — JS ล้วน)
 * =============================================================
 * · ใช้ล้อตัวเดียวกับ `TripTimeSheet` (export `Wheel` มาใช้ซ้ำ → ไม่มีโค้ดซ้ำสองชุด)
 * · ไม่ใช้ `@react-native-community/datetimepicker` (native) — พังบน iOS
 *   และเป็น native module → ต้อง rebuild ทุกครั้งที่เพิ่ม dependency
 * · ขั้นละ 5 นาที · ค่าเป็น "HH:mm" (24 ชั่วโมง) เสมอ
 *
 * โครง Modal เหมือน `TripTimeSheet` (root View → backdrop → การ์ด)
 * → ปุ่มในการ์ดกดได้เสมอบน iOS (ดูคอมเมนต์ใน `TripTimeSheet.tsx`)
 */

/** ความสูงล้อ (เห็น 3 แถว — แถวกลางคือที่เลือก) */
const WHEEL_H = ITEM_H * 3;
/** นาทีขยับทีละ 5 */
const MINUTE_STEP = 5;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * MINUTE_STEP);

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "HH:mm" → { h, m } (ค่าที่เสีย → ค่าเริ่มต้น) */
function parseHhMm(value?: string | null): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!m) return { h: 9, m: 0 };
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return { h, m: mm };
}

/** จำนวนนาทีตั้งแต่ 00:00 */
export function timeToMinutes(value?: string | null): number | null {
  const p = parseHhMm(value);
  if (!value || !/^\d{1,2}:\d{2}$/.test(value.trim())) return null;
  return p.h * 60 + p.m;
}

export interface TripTimeRangeSheetProps {
  visible: boolean;
  /** เวลาเริ่มที่เลือกไว้ ("HH:mm") */
  initialStart?: string | null;
  /** เวลาสิ้นสุดที่เลือกไว้ ("HH:mm") */
  initialEnd?: string | null;
  title?: string;
  subtitle?: string;
  /** เลขรอบการเปิด — เปลี่ยนเมื่อเปิดล้อใหม่ (กัน iOS ค้าง modal เดิม) */
  resetKey?: number;
  onCancel: () => void;
  /** ยืนยันช่วงเวลา */
  onConfirm: (range: { start: string; end: string }) => void;
}

export default function TripTimeRangeSheet({
  visible,
  initialStart,
  initialEnd,
  title = "เลือกเวลาที่จะอยู่",
  subtitle = "เลื่อนล้อเพื่อเลือกเวลาเริ่มและเวลาสิ้นสุด (ทีละ 5 นาที)",
  resetKey = 0,
  onCancel,
  onConfirm,
}: TripTimeRangeSheetProps) {
  const insets = useSafeAreaInsets();

  const startParsed = parseHhMm(initialStart);
  const endParsed = parseHhMm(initialEnd);

  const [startHour, setStartHour] = useState<number>(startParsed.h);
  const [startMinute, setStartMinute] = useState<number>(startParsed.m);
  const [endHour, setEndHour] = useState<number>(endParsed.h);
  const [endMinute, setEndMinute] = useState<number>(endParsed.m);
  const [lastStart, setLastStart] = useState<string | null | undefined>(initialStart);
  const [lastEnd, setLastEnd] = useState<string | null | undefined>(initialEnd);

  // ค่าที่ส่งเข้ามาเปลี่ยนระหว่างที่ล้อยังเปิดอยู่ → ปรับ state ตอน render
  // (ไม่ใช้ effect ตามวิธีของ React Compiler แบบเดียวกับ TripTimeSheet)
  if (initialStart !== lastStart) {
    setLastStart(initialStart);
    const p = parseHhMm(initialStart);
    setStartHour(p.h);
    setStartMinute(p.m);
  }
  if (initialEnd !== lastEnd) {
    setLastEnd(initialEnd);
    const p = parseHhMm(initialEnd);
    setEndHour(p.h);
    setEndMinute(p.m);
  }

  const startIndex = Math.max(0, Math.min(23, startHour));
  const startMinuteIndex = Math.max(
    0,
    Math.min(MINUTES.length - 1, Math.round(startMinute / MINUTE_STEP))
  );
  const endIndex = Math.max(0, Math.min(23, endHour));
  const endMinuteIndex = Math.max(
    0,
    Math.min(MINUTES.length - 1, Math.round(endMinute / MINUTE_STEP))
  );

  const startText = `${pad2(startIndex)}:${pad2(MINUTES[startMinuteIndex])}`;
  const endText = `${pad2(endIndex)}:${pad2(MINUTES[endMinuteIndex])}`;

  const startMinutes = startIndex * 60 + MINUTES[startMinuteIndex];
  const endMinutes = endIndex * 60 + MINUTES[endMinuteIndex];
  /** ถ้าเวลาสิ้นสุดไม่หลังเวลาเริ่ม → ถือว่าข้ามคืน (นับต่อไปอีกวัน) */
  const overnight = endMinutes <= startMinutes;
  const stayMinutes = overnight ? endMinutes + 24 * 60 - startMinutes : endMinutes - startMinutes;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View className="flex-1">
        <Pressable
          className="flex-1 bg-black/40"
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="ปิดตัวเลือกเวลา"
        />
        <View
          className="bg-white rounded-t-3xl"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <View className="items-center pt-2.5 pb-1">
            <View className="w-10 h-1.5 rounded-full bg-gray-300" />
          </View>

          <View className="px-5 pt-1 pb-3 flex-row items-center justify-between border-b border-gray-100">
            <View className="flex-1 mr-2">
              <Text className="text-[16px] font-black text-gray-900">{title}</Text>
              <Text className="text-[11.5px] text-gray-500 mt-0.5">{subtitle}</Text>
            </View>
            <Pressable
              onPress={onCancel}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="ปิด"
              className="p-1"
            >
              <XMarkIcon size={22} color="#6B7280" />
            </Pressable>
          </View>

          {/* ── ค่าที่เลือก (ใหญ่) ─────────────────────────────── */}
          <View className="px-5 pt-3 items-center">
            <Text className="text-[30px] font-black text-gray-900">
              {startText} – {endText}
            </Text>
            <Text className="text-[12px] text-gray-400 mt-0.5">
              อยู่ที่นั่นประมาณ {Math.floor(stayMinutes / 60)} ชม.
              {stayMinutes % 60 ? ` ${stayMinutes % 60} นาที` : ""}
              {overnight ? " (ข้ามคืน)" : ""}
            </Text>
          </View>

          {/* ── ล้อ 4 อัน: เริ่ม ชม./นาที · จบ ชม./นาที ──────────── */}
          <View className="flex-row px-4 pt-2">
            <Text className="flex-1 text-[12px] font-bold text-gray-600 text-center">
              เวลาเริ่มที่จะอยู่
            </Text>
            <View className="w-px mx-2" />
            <Text className="flex-1 text-[12px] font-bold text-gray-600 text-center">
              เวลาสิ้นสุด
            </Text>
          </View>
          <View className="flex-row px-4 pt-1" style={{ height: WHEEL_H }}>
            <View className="flex-row flex-1">
              <Wheel
                key={`sh-${resetKey}`}
                values={HOURS}
                selectedIndex={startIndex}
                onCommit={setStartHour}
                format={pad2}
              />
              <View className="w-px bg-gray-200 mx-1" />
              <Wheel
                key={`sm-${resetKey}`}
                values={MINUTES}
                selectedIndex={startMinuteIndex}
                onCommit={(i) => setStartMinute(MINUTES[i])}
                format={pad2}
              />
            </View>

            <View className="w-px bg-gray-200 mx-2" />

            <View className="flex-row flex-1">
              <Wheel
                key={`eh-${resetKey}`}
                values={HOURS}
                selectedIndex={endIndex}
                onCommit={setEndHour}
                format={pad2}
              />
              <View className="w-px bg-gray-200 mx-1" />
              <Wheel
                key={`em-${resetKey}`}
                values={MINUTES}
                selectedIndex={endMinuteIndex}
                onCommit={(i) => setEndMinute(MINUTES[i])}
                format={pad2}
              />
            </View>
          </View>

          {/* ── ปุ่ม ──────────────────────────────────────────── */}
          <View className="flex-row px-5 pt-3 pb-1">
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="ยกเลิก"
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              className="flex-1 py-3 rounded-2xl border border-gray-200 items-center justify-center mr-2"
            >
              <Text className="text-[14px] font-bold text-gray-600">ยกเลิก</Text>
            </Pressable>
            <Pressable
              onPress={() => onConfirm({ start: startText, end: endText })}
              accessibilityRole="button"
              accessibilityLabel="ตกลง"
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
              className="flex-1 py-3 rounded-2xl items-center justify-center ml-2 bg-violet-600"
            >
              <Text className="text-[14px] font-bold text-white">ตกลง</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
