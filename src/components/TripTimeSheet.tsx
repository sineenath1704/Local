import React, { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  View,
  Text,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { XMarkIcon } from "react-native-heroicons/outline";

/**
 * ล้อเวลาออกเดินทาง (เขียนเองทั้งหมด — JS ล้วน)
 * =============================================================
 * เขียนเองเพราะ `@react-native-community/datetimepicker` (native) พังบน iOS
 * → แอปหลุดไปหน้าจอโฮมตอนหมุนล้อ (ดู issue #1010 / #848 ของ library)
 *   และเป็น native module → ต้อง rebuild ทุกครั้งที่เพิ่ม dependency
 *
 * วิธีเดียวกับปฏิทินช่วงวันที่ที่เขียนเอง (`TripDateRangeSheet.tsx`)
 * → ไม่มี native module ใหม่ · ไม่ต้อง build ใหม่ · ไม่พัง
 *
 * เลือกได้ทีละ 5 นาที · เก็บค่าเป็น "HH:mm" (24 ชั่วโมง) เสมอ
 *
 * โครง Modal (สำคัญมากบน iOS)
 * -------------------------------------------------------------
 * โครงเดิมเป็น "พี่คู่" 2 อัน: backdrop (`flex-1`) + การ์ด (`absolute bottom-0`)
 * → ปุ่มในการ์ดกดไม่ติด (เลื่อนล้อได้ แต่ยกเลิก/ตกลง/ปิดไม่ทำงาน)
 *   เพราะทั้งครอบสีดำและการ์ดชนกันในโครงเดียว
 * → เปลี่ยนเป็นโครงเดียวเหมือน `OriginSelectorModal` ที่ใช้ได้ปกติ:
 *   root = View (flex-1) → backdrop (flex-1) → การ์ด (ลูกธรรมดา อยู่ล่างสุด)
 *   (ไม่มี position:absolute ปนอนอีกแล้ว)
 */

/** ความสูง 1 แถวของล้อ */
export const ITEM_H = 40;
/** ความสูงล้อ (เห็น 3 แถว — แถวกลางคือที่เลือก) */
const WHEEL_H = ITEM_H * 3;
/** นาทีขยับทีละ 5 */
const MINUTE_STEP = 5;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * MINUTE_STEP);

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseHhMm(value?: string | null): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!m) return { h: 8, m: 0 };
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return { h, m: mm };
}

/**
 * ล้อเลื่อนแนวตั้ง 1 อัน
 * -------------------------------------------------------------
 * · ตำแหน่งที่เลือก = แถวกลาง (เหมือนล้อของ iOS)
 * · เลื่อนแล้วปล่อย → snap เข้าช่อง → รายงานค่าที่เลือกกลับ
 * · อัปเดตค่าสดระหว่างเลื่อน (ไม่ใช่ตอนปล่อย) → แถวที่ไฮไลต์ตรงกับที่เห็นเสมอ
 *   แม้ iOS จะ snap เป็นช่องหลังปล่อยนิ้ว
 *
 * export ไว้ให้ `TripTimeRangeSheet` (ตัวเลือกช่วงเวลาเริ่ม–จบ) ใช้ล้อตัวเดียวกัน
 */
export function Wheel({
  values,
  selectedIndex,
  onCommit,
  format,
}: {
  values: number[];
  selectedIndex: number;
  onCommit: (index: number) => void;
  format: (value: number) => string;
}) {
  const ref = useRef<ScrollViewInstance>(null);
  /** ล้อวางแล้วหรือยัง (ต้องรอ layout ก่อน scrollTo ไม่งั้น iOS จะเงียบไป) */
  const laidOut = useRef(false);
  /** ย้ายไปยังค่าที่เลือกไว้แล้วหรือยัง */
  const synced = useRef(false);

  /**
   * เลื่อนไปยังค่าที่เลือกไว้ตอนแรก (ทำครั้งเดียวตอน mount)
   * ใช้ callback ของ ScrollView ไม่ใช่ effect → ไม่ชนกฎ lint ของ React Compiler
   */
  const scrollToSelected = () => {
    if (synced.current) return;
    synced.current = true;
    requestAnimationFrame(() => {
      ref.current?.scrollTo({ y: selectedIndex * ITEM_H, animated: false });
    });
  };

  /** ScrollView วางเสร็จแล้ว → ย้ายไปค่าที่เลือก (ก่อนวางเสร็จ `scrollTo` ไม่ทำงาน) */
  const handleLayout = () => {
    laidOut.current = true;
    scrollToSelected();
  };

  /** เนื้อหาโหลดเสร็จ (ขนาดล้อขึ้น) → ย้ายไปค่าที่เลือก (ถ้าวางเสร็จแล้ว) */
  const handleContentSizeChange = () => {
    if (!laidOut.current) return;
    scrollToSelected();
  };

  /** ตำแหน่งที่เลื่อนไป → ช่องที่ไฮไลต์ */
  const indexOf = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
    return Math.max(0, Math.min(values.length - 1, idx));
  };

  /**
   * ค่าที่เลื่อนไปตอนนี้ → ช่องที่ไฮไลต์
   * (เลื่อนจะทำให้ iOS snap หลังปล่อย → ค่าสดเสมอตรงกับตำแหน่งจริง)
   */
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const clamped = indexOf(e);
    if (clamped !== selectedIndex) onCommit(clamped);
  };

  /**
   * ปล่อยนิ้ว / หยุดเลื่อน → ล็อกค่าที่ snap ไว้เป็นค่าที่เลือกจริง
   * (กันเคส onScroll สุดท้ายมาไม่ทันตอนหยุด → เวลาที่เห็นไม่ถูกล็อค)
   */
  const handleSettle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const clamped = indexOf(e);
    if (clamped !== selectedIndex) onCommit(clamped);
  };

  return (
    <View className="flex-1 overflow-hidden">
      {/* แถบไฮไลต์ตรงกลาง (ชี้ว่าอันไหนคือค่าที่เลือก) */}
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: 6, right: 6, top: ITEM_H, height: ITEM_H }}
        className="rounded-xl bg-violet-50"
      />
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        bounces={false}
        onLayout={handleLayout}
        onContentSizeChange={handleContentSizeChange}
        onScroll={handleScroll}
        onMomentumScrollEnd={handleSettle}
        onScrollEndDrag={handleSettle}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingVertical: ITEM_H }}
      >
        {values.map((v, i) => (
          <View
            key={v}
            style={{ height: ITEM_H }}
            className="items-center justify-center"
            accessibilityRole="adjustable"
            accessibilityLabel={format(v)}
          >
            <Text
              className={
                i === selectedIndex
                  ? "text-[22px] font-black text-violet-700"
                  : "text-[20px] font-semibold text-gray-400"
              }
            >
              {format(v)}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

interface TripTimeSheetProps {
  visible: boolean;
  /** ค่าเวลาปัจจุบัน ("HH:mm") */
  value?: string | null;
  /**
   * เลขรอบการเปิด — เปลี่ยนเมื่อเปิดล้อใหม่
   * ใช้เป็น key ของ "ล้อ" เพื่อย้ายล้อกลับไปค่าที่เลือกไว้
   * (โค้ดเดิมใช้ key ที่ Modal → เปลี่ยน key ของ Modal ที่ยังเปิดอยู่
   *   ทำให้ iOS ค้าง native modal เดิมไว้บนจอ → ล้อเลื่อนได้แต่กดปุ่มไม่ได้)
   */
  resetKey?: number;
  onCancel: () => void;
  /** ยืนยันเวลาที่เลือก */
  onConfirm: (time: string) => void;
}

export default function TripTimeSheet({
  visible,
  value,
  resetKey = 0,
  onCancel,
  onConfirm,
}: TripTimeSheetProps) {
  const insets = useSafeAreaInsets();
  /**
   * เริ่มจากค่าที่ส่งเข้ามา
   * (ค่านอกอาจเปลี่ยนระหว่างที่ล้อยังเปิดอยู่ เช่น AI ไปกำหนดเวลาให้
   *   → ปรับ state ตอน render ไม่ใช้ effect ตามวิธีของ React)
   */
  const initial = parseHhMm(value);
  const [hour, setHour] = useState<number>(initial.h);
  const [minute, setMinute] = useState<number>(initial.m);
  const [lastValue, setLastValue] = useState<string | null | undefined>(value);
  if (value !== lastValue) {
    setLastValue(value);
    const p = parseHhMm(value);
    setHour(p.h);
    setMinute(p.m);
  }

  const hourIndex = Math.max(0, Math.min(23, hour));
  const minuteIndex = Math.max(
    0,
    Math.min(MINUTES.length - 1, Math.round(minute / MINUTE_STEP))
  );
  const text = `${pad2(hourIndex)}:${pad2(MINUTES[minuteIndex])}`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      {/* โครงเดียว: พื้นหลังกดปิดได้ (บน) + การ์ดล้อเวลา (ล่าง) */}
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
            <Text className="text-[16px] font-black text-gray-900">
              เวลาออกเดินทาง
            </Text>
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
            <Text className="text-[34px] font-black text-gray-900">{text}</Text>
            <Text className="text-[12px] text-gray-400 mt-0.5">
              เลื่อนล้อเพื่อเลือกชั่วโมงและนาที (ทีละ 5 นาที)
            </Text>
          </View>

          {/* ── ล้อ 2 อัน: ชั่วโมง · นาที ───────────────────────── */}
          <View className="flex-row px-4 pt-2" style={{ height: WHEEL_H }}>
            <Wheel
              key={`hour-${resetKey}`}
              values={HOURS}
              selectedIndex={hourIndex}
              onCommit={setHour}
              format={pad2}
            />
            <View className="w-px bg-gray-200 mx-2" />
            <Wheel
              key={`minute-${resetKey}`}
              values={MINUTES}
              selectedIndex={minuteIndex}
              onCommit={(i) => setMinute(MINUTES[i])}
              format={pad2}
            />
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
              onPress={() => {
                console.log("[TripTimeSheet] confirming time:", text);
                onConfirm(text);
              }}
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
