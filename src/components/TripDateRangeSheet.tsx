import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  Text,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
} from "react-native-heroicons/outline";
import {
  THAI_WEEKDAYS,
  TRIP_MAX_DAYS,
  formatThaiDate,
  tripAddDays,
  tripDiffDays,
  tripTodayIso,
} from "../data/tripsData";

/**
 * ปฏิทินเลือก "ช่วงวันที่" ในหน้าเดียว
 * =============================================================
 * กดวันแรก = วันเริ่มต้น · กดวันที่สอง = วันสิ้นสุด (ช่วงที่เลือกจะถูกไฮไลต์)
 *
 * เขียนเองทั้งหมด เพราะ `datetimepicker` ของ native ไม่มีโหมดเลือกช่วงวันที่
 * (มีแค่เลือกวันเดียว) → ถ้าใช้ตัวนั้นต้องกดเปิดปฏิทินสองครั้ง ซึ่งไม่ใช่สิ่งที่ผู้ใช้ต้องการ
 *
 * กติกา: วันเริ่มต้องไม่ย้อนหลัง · สูงสุด 7 วัน (ตรงกับที่ backend clamp ไว้)
 */

const THAI_MONTHS_FULL = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกยน", "ธันวาคม",
];

interface MonthCell {
  iso: string | null;
  day: number | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** เลื่อนเดือน (คีย์ "YYYY-MM") */
function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** ตาราง 6 แถว × 7 คอลัมน์ (ขึ้นต้นด้วยวันอาทิตย์ — ตรงกับปฏิทินไทย) */
function buildMonthGrid(monthKey: string): MonthCell[] {
  const [y, m] = monthKey.split("-").map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: MonthCell[] = [];
  for (let i = 0; i < lead; i += 1) cells.push({ iso: null, day: null });
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push({ iso: `${y}-${pad2(m)}-${pad2(d)}`, day: d });
  }
  while (cells.length < 42) cells.push({ iso: null, day: null });
  return cells;
}

interface TripDateRangeSheetProps {
  visible: boolean;
  /** วันเริ่มต้นที่เลือกไว้แล้ว (ถ้ามี) */
  startDate?: string | null;
  /** วันสิ้นสุดที่เลือกไว้แล้ว (ถ้ามี) */
  endDate?: string | null;
  onCancel: () => void;
  /** ยืนยันช่วงวันที่ที่เลือก */
  onConfirm: (startDate: string, endDate: string) => void;
}

export default function TripDateRangeSheet({
  visible,
  startDate,
  endDate,
  onCancel,
  onConfirm,
}: TripDateRangeSheetProps) {
  const insets = useSafeAreaInsets();
  const today = useMemo(() => tripTodayIso(), []);
  /** เลื่อนเดือนไปข้างหน้าได้ 1 ปี */
  const maxDate = useMemo(() => tripAddDays(today, 365), [today]);
  const currentMonth = today.slice(0, 7);

  /**
   * เริ่มจากค่าที่ส่งเข้ามา
   * (แม่เรียก mount ใหม่ทุกครั้งที่เปิดปฏิทิน → ได้ค่าล่าสุดเสมอ ไม่ต้องมี effect)
   */
  const [month, setMonth] = useState<string>(() =>
    (startDate ?? today).slice(0, 7)
  );
  const [pickStart, setPickStart] = useState<string | null>(startDate ?? null);
  const [pickEnd, setPickEnd] = useState<string | null>(endDate ?? null);

  const cells = useMemo(() => buildMonthGrid(month), [month]);

  const handlePressDay = (iso: string) => {
    if (!pickStart || (pickStart && pickEnd)) {
      // เริ่มช่วงใหม่
      setPickStart(iso);
      setPickEnd(null);
      return;
    }
    if (iso < pickStart) {
      // กดวันก่อนหน้า → ถือเป็นวันเริ่มใหม่
      setPickStart(iso);
      setPickEnd(null);
      return;
    }
    // กดวันหลัง → วันสิ้นสุด (ไม่เกิน 7 วันนับจากวันเริ่ม)
    const limit = tripAddDays(pickStart, TRIP_MAX_DAYS - 1);
    setPickEnd(iso > limit ? limit : iso);
  };

  const canGoPrev = month > currentMonth;
  const canGoNext = shiftMonth(month, 1) <= maxDate.slice(0, 7);
  const [yearText, monthIndex] = month.split("-");
  const days =
    pickStart && pickEnd ? tripDiffDays(pickStart, pickEnd) + 1 : null;

  const summaryText = pickStart
    ? pickEnd
      ? `วันเริ่มต้น ${formatThaiDate(pickStart)} → วันสิ้นสุด ${formatThaiDate(
          pickEnd
        )} · ${days} วัน${days && days > 1 ? ` ${days - 1} คืน` : " · ไป-กลับ"}`
      : `วันเริ่มต้น ${formatThaiDate(pickStart)} — เลือกวันสิ้นสุดต่อ`
    : "เลือกวันเริ่มต้นก่อน (วันที่ย้อนหลังเลือกไม่ได้)";

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
            เลือกช่วงวันที่
          </Text>
          <TouchableOpacity onPress={onCancel} className="p-1">
            <XMarkIcon size={22} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {/* ── เดือน ─────────────────────────────────────────── */}
        <View className="flex-row items-center justify-between px-4 pt-3">
          <TouchableOpacity
            onPress={() => setMonth((m) => shiftMonth(m, -1))}
            disabled={!canGoPrev}
            className={`p-2 rounded-full ${
              canGoPrev ? "bg-gray-100" : "bg-transparent"
            }`}
          >
            <ChevronLeftIcon
              size={20}
              color={canGoPrev ? "#374151" : "#D1D5DB"}
            />
          </TouchableOpacity>
          <Text className="text-[15px] font-bold text-gray-900">
            {THAI_MONTHS_FULL[Number(monthIndex) - 1]} {Number(yearText) + 543}
          </Text>
          <TouchableOpacity
            onPress={() => setMonth((m) => shiftMonth(m, 1))}
            disabled={!canGoNext}
            className={`p-2 rounded-full ${
              canGoNext ? "bg-gray-100" : "bg-transparent"
            }`}
          >
            <ChevronRightIcon
              size={20}
              color={canGoNext ? "#374151" : "#D1D5DB"}
            />
          </TouchableOpacity>
        </View>

        {/* ── หัวตาราง ─────────────────────────────────────── */}
        <View className="flex-row px-2 pt-2 pb-1">
          {THAI_WEEKDAYS.map((w) => (
            <View key={w} className="flex-1 items-center">
              <Text className="text-[11.5px] font-bold text-gray-400">{w}</Text>
            </View>
          ))}
        </View>

        {/* ── วันที่ ───────────────────────────────────────── */}
        <View className="flex-row flex-wrap px-2">
          {cells.map((cell, idx) => {
            if (!cell.iso) {
              return <View key={`blank-${idx}`} className="w-[14.285%] h-11" />;
            }
            const disabled = cell.iso < today || cell.iso > maxDate;
            const isStart = cell.iso === pickStart;
            const isEnd = cell.iso === pickEnd;
            const inRange =
              !!pickStart && !!pickEnd && cell.iso > pickStart && cell.iso < pickEnd;
            const band = inRange || isStart || isEnd;
            const isToday = cell.iso === today;

            return (
              <View key={cell.iso} className="w-[14.285%] h-11">
                <Pressable
                  onPress={() => !disabled && handlePressDay(cell.iso as string)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`วันที่ ${cell.day}`}
                  className={`h-11 w-full items-center justify-center flex-row ${
                    band ? "bg-violet-100" : ""
                  } ${isStart ? "rounded-l-2xl" : ""} ${
                    isEnd ? "rounded-r-2xl" : ""
                  }`}
                >
                  <View
                    className={`w-8 h-8 rounded-full items-center justify-center ${
                      isStart || isEnd ? "bg-violet-600" : ""
                    }`}
                  >
                    <Text
                      className={`text-[13.5px] ${
                        disabled
                          ? "text-gray-300"
                          : isStart || isEnd
                          ? "text-white font-bold"
                          : isToday
                          ? "text-violet-600 font-bold"
                          : "text-gray-800"
                      }`}
                    >
                      {cell.day}
                    </Text>
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>

        {/* ── สรุปช่วงที่เลือก ──────────────────────────────── */}
        <View className="px-5 pt-3">
          <Text
            className={`text-[13px] font-bold ${
              pickStart && pickEnd ? "text-violet-800" : "text-gray-500"
            }`}
          >
            {summaryText}
          </Text>
          {pickStart && !pickEnd ? (
            <Text className="text-[11.5px] text-gray-400 mt-0.5">
              เลือกได้ไม่เกิน {TRIP_MAX_DAYS} วันนับจากวันเริ่มต้น
            </Text>
          ) : null}
        </View>

        {/* ── ปุ่ม ─────────────────────────────────────────── */}
        <View className="flex-row px-5 pt-3 pb-1">
          <TouchableOpacity
            onPress={onCancel}
            activeOpacity={0.85}
            className="flex-1 py-3 rounded-2xl border border-gray-200 items-center justify-center mr-2"
          >
            <Text className="text-[14px] font-bold text-gray-600">ยกเลิก</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              if (pickStart && pickEnd) onConfirm(pickStart, pickEnd);
            }}
            disabled={!pickStart || !pickEnd}
            activeOpacity={0.85}
            className={`flex-1 py-3 rounded-2xl items-center justify-center ml-2 ${
              pickStart && pickEnd ? "bg-violet-600" : "bg-gray-200"
            }`}
          >
            <Text
              className={`text-[14px] font-bold ${
                pickStart && pickEnd ? "text-white" : "text-gray-400"
              }`}
            >
              ตกลง
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
