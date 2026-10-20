import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  ListRenderItemInfo,
  Modal,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClockIcon, XMarkIcon } from "react-native-heroicons/outline";

/**
 * Pick an open/close time pair. Used in two flavors on the business form:
 *
 *   • kind="hours"   — café / shop / activity. Two columns เวลาเปิด/เวลาปิด,
 *     plus a "เปิด 24 ชม." shortcut that sets allDay. Confirm requires both
 *     times (or the shortcut).
 *   • kind="checkin" — homestay. Two columns เช็คอิน/เช็คเอาท์. No all-day
 *     option — a homestay always has a checkin time.
 *
 * Implemented as a wheel that snaps each column to the middle row, so a host
 * can scroll 00:00..23:00 with one finger instead of typing. The wheel
 * deliberately does NOT pop a keyboard — that's the whole reason this
 * component exists (item 3 of the user's request: "ไม่ต้องพิมพ์เอง").
 *
 * Values are zero-padded ("08:00" not "8:00") so the round-trip with
 * businessProfile.formatHourRange stays byte-stable.
 */

export interface TimeRangeSheetProps {
  visible: boolean;
  kind: "hours" | "checkin";
  initialRange: { open: string | null; close: string | null; allDay?: boolean };
  /** Surfaced inside the sheet when the parser couldn't read the saved range
   * (e.g. a row stored "9:00 AM – 5:00 PM"). The host has to re-pick. */
  unknownRaw?: string | null;
  onCancel: () => void;
  onConfirm: (range: {
    open: string | null;
    close: string | null;
    allDay: boolean;
  }) => void;
}

const ITEM_HEIGHT = 40;
// 00:00 through 23:00. :30 would also be valid for some places, but the writer
// is whole-hour only and this matches the existing row data.
const HOURS: string[] = Array.from({ length: 24 }, (_, i) =>
  `${String(i).padStart(2, "0")}:00`
);

function padZero(h: string | null): string | null {
  if (!h) return null;
  const m = h.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return h;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

interface HourWheelProps {
  value: string | null;
  placeholderLabel: string;
  onChange: (h: string) => void;
}

function HourWheel({ value, placeholderLabel, onChange }: HourWheelProps) {
  // Snap-to-center: pad the list with one ITEM_HEIGHT of empty space above and
  // below so the first/last hour can be scrolled to the center.
  const listRef = useRef<FlatList<string>>(null);
  const initialIndex = value ? Math.max(0, HOURS.indexOf(padZero(value) ?? "")) : 0;

  useEffect(() => {
    if (!listRef.current) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({
        offset: initialIndex * ITEM_HEIGHT,
        animated: false,
      });
    });
  }, [initialIndex]);

  const renderItem = ({ item }: ListRenderItemInfo<string>) => {
    const selected = padZero(value) === item;
    return (
      <TouchableOpacity
        onPress={() => onChange(item)}
        activeOpacity={0.7}
        style={{ height: ITEM_HEIGHT }}
        className="items-center justify-center"
      >
        <Text
          className={`text-[15px] ${
            selected ? "text-[#1B4332] font-black" : "text-gray-500"
          }`}
        >
          {item}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View
      className="flex-1 bg-white border border-gray-200 rounded-xl overflow-hidden"
      style={{ height: ITEM_HEIGHT * 5 }}
    >
      {/* Selection highlight band — visual center */}
      <View
        pointerEvents="none"
        className="absolute left-0 right-0 border-y border-emerald-200"
        style={{
          top: ITEM_HEIGHT * 2,
          height: ITEM_HEIGHT,
        }}
      />
      <FlatList
        ref={listRef}
        data={HOURS}
        keyExtractor={(h) => h}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(
            e.nativeEvent.contentOffset.y / ITEM_HEIGHT
          );
          const safe = Math.max(0, Math.min(HOURS.length - 1, idx));
          if (HOURS[safe] && HOURS[safe] !== padZero(value)) onChange(HOURS[safe]);
        }}
      />
      {!value ? (
        <View
          pointerEvents="none"
          className="absolute inset-0 items-center justify-center"
          style={{ height: ITEM_HEIGHT * 5 }}
        >
          <Text className="text-gray-400 text-[13px]">{placeholderLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function TimeRangeSheet({
  visible,
  kind,
  initialRange,
  unknownRaw,
  onCancel,
  onConfirm,
}: TimeRangeSheetProps) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<string | null>(initialRange.open ?? null);
  const [close, setClose] = useState<string | null>(initialRange.close ?? null);
  const [wasVisible, setWasVisible] = useState(visible);

  // Re-seed whenever the sheet opens so a previous session's pick doesn't leak
  // into a fresh one. Adjusted during render rather than in an effect — see
  // DayPickerSheet for the same rationale.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setOpen(padZero(initialRange.open ?? null));
      setClose(padZero(initialRange.close ?? null));
    }
  }

  const isHours = kind === "hours";
  const openLabel = isHours ? "เวลาเปิด" : "เช็คอิน";
  const closeLabel = isHours ? "เวลาปิด" : "เช็คเอาท์";
  const titleText = isHours ? "เลือกเวลาเปิด-ปิด" : "เลือกเวลาเช็คอิน / เช็คเอาท์";

  const confirmEnabled =
    isHours ? Boolean(open && close) : Boolean(open && close);

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
        style={{ paddingBottom: Math.max(insets.bottom, 12) + 8, maxHeight: "82%" }}
      >
        <View className="items-center pt-2.5 pb-1">
          <View className="w-10 h-1.5 rounded-full bg-gray-300" />
        </View>

        <View className="flex-row items-center justify-between px-5 pt-1 pb-3 border-b border-gray-100">
          <Text className="text-[17px] font-black text-gray-900">{titleText}</Text>
          <TouchableOpacity onPress={onCancel} className="p-1" accessibilityRole="button">
            <XMarkIcon size={22} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {unknownRaw ? (
          <View className="mx-5 mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <Text className="text-amber-800 text-[13px] font-semibold mb-0.5">
              รูปแบบเดิมไม่รู้จัก
            </Text>
            <Text className="text-amber-700 text-[13px]" numberOfLines={2}>
              {unknownRaw}
            </Text>
          </View>
        ) : null}

        <View className="flex-row gap-3 px-5 pt-4">
          <View className="flex-1">
            <Text className="text-[13px] font-bold text-gray-700 mb-1.5">
              {openLabel}
            </Text>
            <HourWheel
              value={open}
              placeholderLabel="เลือกเวลา"
              onChange={setOpen}
            />
          </View>
          <View className="flex-1">
            <Text className="text-[13px] font-bold text-gray-700 mb-1.5">
              {closeLabel}
            </Text>
            <HourWheel
              value={close}
              placeholderLabel="เลือกเวลา"
              onChange={setClose}
            />
          </View>
        </View>

        {isHours ? (
          <View className="px-5 pt-3">
            <TouchableOpacity
              onPress={() => onConfirm({ open: null, close: null, allDay: true })}
              activeOpacity={0.85}
              className="flex-row items-center justify-center bg-emerald-50 border border-emerald-200 rounded-2xl py-2.5"
            >
              <ClockIcon size={16} color="#2D6A4F" />
              <Text className="text-emerald-800 font-bold text-[14px] ml-1.5">
                เปิด 24 ชม.
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View className="px-5 pt-3 pb-1">
          <TouchableOpacity
            disabled={!confirmEnabled}
            onPress={() => onConfirm({ open, close, allDay: false })}
            activeOpacity={0.85}
            className={`py-3 rounded-2xl items-center justify-center ${
              confirmEnabled ? "bg-[#2D6A4F]" : "bg-gray-300"
            }`}
          >
            <Text className="text-white text-[15px] font-bold">ตกลง</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
