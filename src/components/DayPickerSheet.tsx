import React, { useState } from "react";
import {
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckIcon, XMarkIcon } from "react-native-heroicons/outline";
import { DAYS_OF_WEEK, KEY_TO_DAY_NAME } from "../lib/businessProfile";

/**
 * Pick from the seven weekday keys as a checklist.
 *
 * Generic enough to cover all three day-set questions on the business form:
 *   • "วันที่ปิดทำการ" — closed days (the original caller). The selected list
 *     means "open every day except these"; the "เปิดทุกวัน" reset clears it.
 *   • "วันธรรมดา" / "วันหยุดสุดสัปดาห์" — membership in a group. The selected
 *     list means "these days belong to the group"; the reset button is hidden
 *     because "no specific days" is the default state these rows already have.
 *
 * Edits are staged in local state and only handed back on confirm, so
 * dismissing the sheet can't leave the form half-changed.
 */

interface DayPickerSheetProps {
  visible: boolean;
  /** Day keys currently ticked, e.g. ["อา"]. */
  selected: string[];
  onCancel: () => void;
  onConfirm: (days: string[]) => void;
  /** Sheet header. Defaults to "วันที่ปิดทำการ". */
  title?: string;
  /** Reset-button label. Defaults to "เปิดทุกวัน". Pass "" to hide the reset. */
  resetLabel?: string;
  /** Caption on a ticked row. Defaults to "ปิด" (closed). */
  selectedLabel?: string;
  /** Caption on an unticked row. Defaults to "เปิด" (open). */
  unselectedLabel?: string;
}

export default function DayPickerSheet({
  visible,
  selected,
  onCancel,
  onConfirm,
  title = "วันที่ปิดทำการ",
  resetLabel = "เปิดทุกวัน",
  selectedLabel = "ปิด",
  unselectedLabel = "เปิด",
}: DayPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<string[]>(selected);
  const [wasVisible, setWasVisible] = useState(visible);

  // Re-seed whenever the sheet opens so a previous session's ticks don't leak
  // into a fresh one. Adjusted during render rather than in an effect: an
  // effect would cause a second pass of renders for no reason, and the sheet is
  // hidden at that moment anyway.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setDraft(selected);
  }

  const toggle = (key: string) =>
    setDraft((prev) =>
      prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]
    );

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
          <Text className="text-[17px] font-black text-gray-900">
            {title}
          </Text>
          <TouchableOpacity onPress={onCancel} className="p-1" accessibilityRole="button">
            <XMarkIcon size={22} color="#6B7280" />
          </TouchableOpacity>
        </View>

        <ScrollView className="px-5 pt-2" showsVerticalScrollIndicator={false}>
          {DAYS_OF_WEEK.map((d) => {
            const off = draft.includes(d.key);
            return (
              <TouchableOpacity
                key={d.key}
                onPress={() => toggle(d.key)}
                activeOpacity={0.75}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: off }}
                accessibilityLabel={KEY_TO_DAY_NAME[d.key]}
                className="flex-row items-center py-3 border-b border-gray-100"
              >
                <View
                  className={`w-6 h-6 rounded-md border items-center justify-center mr-3 ${
                    off ? "bg-[#2D6A4F] border-[#2D6A4F]" : "bg-white border-gray-300"
                  }`}
                >
                  {off ? <CheckIcon size={16} color="#FFFFFF" strokeWidth={3} /> : null}
                </View>
                <Text
                  className={`text-[15px] font-semibold flex-1 ${
                    off ? "text-gray-400 line-through" : "text-gray-900"
                  }`}
                >
                  {KEY_TO_DAY_NAME[d.key]}
                </Text>
                <Text
                  className={`text-[13px] font-bold ${off ? "text-red-500" : "text-emerald-600"}`}
                >
                  {off ? selectedLabel : unselectedLabel}
                </Text>
              </TouchableOpacity>
            );
          })}
          <View className="h-3" />
        </ScrollView>

        {resetLabel ? (
          <View className="flex-row items-center gap-2.5 px-5 pt-3">
            <TouchableOpacity
              onPress={() => setDraft([])}
              activeOpacity={0.75}
              className={`px-3.5 py-3 rounded-2xl border ${
                draft.length === 0
                  ? "bg-emerald-100 border-emerald-300"
                  : "bg-white border-gray-200"
              }`}
            >
              <Text
                className={`text-[14px] font-bold ${
                  draft.length === 0 ? "text-emerald-800" : "text-gray-500"
                }`}
              >
                ✓ {resetLabel}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => onConfirm(draft)}
              activeOpacity={0.85}
              className="flex-1 bg-[#2D6A4F] py-3 rounded-2xl items-center justify-center"
            >
              <Text className="text-white text-[15px] font-bold">ตกลง</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="px-5 pt-3">
            <TouchableOpacity
              onPress={() => onConfirm(draft)}
              activeOpacity={0.85}
              className="bg-[#2D6A4F] py-3 rounded-2xl items-center justify-center"
            >
              <Text className="text-white text-[15px] font-bold">ตกลง</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}