import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { PencilIcon } from "react-native-heroicons/outline";

/**
 * A read-only row that turns into an editor when you ask it to.
 *
 * Most of what a community host fills in comes straight out of Google and is
 * usually right. Showing every field as an editable box from the start made the
 * form feel like work rather than confirmation, so each section now shows its
 * value and only reveals inputs behind a per-section "เปลี่ยน".
 *
 * Deliberately has no animation — the panel just appears. That matches the
 * expand pattern already used by AiDiagnosticsSheet.
 */

export type EditableRowTone = "green" | "amber";

interface EditableValueRowProps {
  label: string;
  /** Shown while collapsed. Empty string falls back to `emptyHint`. */
  value: string;
  editing: boolean;
  onToggle: () => void;
  /** Emoji or short glyph shown to the left of the label. */
  icon?: string;
  tone?: EditableRowTone;
  emptyHint?: string;
  children?: React.ReactNode;
}

export default function EditableValueRow({
  label,
  value,
  editing,
  onToggle,
  icon,
  tone = "green",
  emptyHint = "ยังไม่ได้ระบุ",
  children,
}: EditableValueRowProps) {
  const accent = tone === "amber" ? "text-amber-900" : "text-[#1B4332]";
  const accentBorder = tone === "amber" ? "border-amber-200" : "border-emerald-200";
  const accentBg = tone === "amber" ? "bg-amber-100" : "bg-emerald-100";

  return (
    <View
      className={`bg-white border ${accentBorder} rounded-2xl p-3.5 mb-3`}
    >
      <View className="flex-row items-center justify-between mb-1">
        <View className="flex-row items-center flex-1 mr-2">
          {icon ? <Text className="text-[15px] mr-1.5">{icon}</Text> : null}
          <Text className={`text-[14px] font-bold ${accent}`}>{label}</Text>
        </View>
        <TouchableOpacity
          onPress={onToggle}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={editing ? `ปิดการแก้ไข${label}` : `เปลี่ยน${label}`}
          className={`flex-row items-center px-2.5 py-1 rounded-xl border ${accentBorder} ${accentBg}`}
        >
          <PencilIcon size={13} color={tone === "amber" ? "#B45309" : "#2D6A4F"} />
          <Text
            className={`text-[13px] font-bold ml-1 ${
              tone === "amber" ? "text-amber-800" : "text-emerald-800"
            }`}
          >
            {editing ? "ปิด" : "เปลี่ยน"}
          </Text>
        </TouchableOpacity>
      </View>

      {!editing ? (
        <Text
          className={`text-[15px] font-bold mt-0.5 ${
            value ? "text-gray-900" : "text-gray-400"
          }`}
        >
          {value || emptyHint}
        </Text>
      ) : (
        <View className="mt-2">{children}</View>
      )}
    </View>
  );
}