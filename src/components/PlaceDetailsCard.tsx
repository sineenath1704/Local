import React, { useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import EditableValueRow from "./EditableValueRow";
import { SOURCE_LABEL, type MatchLevel } from "../services/placeMatchService";

/**
 * A place's own details — the facts the AI chat answers from.
 *
 * Google's price band, phone, website and opening hours arrive with the
 * Place Details call, but they are Google's opinion. A host who knows their
 * own shop should be able to correct them, so each value shows read-only and
 * opens an editor behind "เปลี่ยน" — the same pattern as the business-info
 * form, because most of the time Google's value is right and the form should
 * feel like confirmation, not work.
 *
 * The price band is a tier (ฟรี / ฿ / ฿฿ / ฿฿฿ / ฿฿฿฿), not a number, so it
 * gets chips rather than a numeric keypad.
 *
 * ทุกกลุ่มข้อมูลมีป้ายบอกที่มา (D21) — ผู้ใช้ต้องรู้ว่าค่าที่เห็นเป็นของ
 * เจ้าของ, มาจากคลิป, หรือมาจาก Google
 */

/** Google's price tiers, as users read them. */
export const PRICE_LEVELS = ["ฟรี", "฿", "฿฿", "฿฿฿", "฿฿฿฿"] as const;

/** ที่มาของค่าแต่ละช่อง (D21) */
export type DetailSource = keyof typeof SOURCE_LABEL;

export interface PlaceDetailsValues {
  /** "฿฿", "ฟรี"… — null when the place has no tier. */
  priceLevel: string | null;
  website: string | null;
  phone: string | null;
  openingHours: string | null;
}

/**
 * What the AI read out of the clip about this place.
 *
 * These are not Google's values — they come from the video and the speech,
 * and they are written to the place's own row so the AI chat can answer
 * "มีกี่ห้อง" without the traveller watching the clip. Shown read-only: the
 * card is for the four fields a host corrects by hand.
 */
export interface PlaceClipFacts {
  capacity?: {
    rooms?: string | null;
    guests_per_room?: string | null;
    max_guests?: string | null;
    beds?: string | null;
  } | null;
  rules?: string[] | null;
  areas?: string[] | null;
  facilities?: string[] | null;
}

/** "3 ห้อง • ห้องปกตินอนได้ 1-2 คน" — the parts the clip actually mentioned. */
function capacityText(capacity: NonNullable<PlaceClipFacts["capacity"]>): string {
  const parts: string[] = [];
  if (capacity.rooms) parts.push(`${capacity.rooms} ห้อง`);
  if (capacity.guests_per_room) parts.push(`ห้องปกตินอนได้ ${capacity.guests_per_room} คน`);
  if (capacity.max_guests) parts.push(`ห้องใหญ่นอนได้ ${capacity.max_guests} คน`);
  if (capacity.beds) parts.push(`${capacity.beds} เตียง`);
  return parts.join(" • ");
}

export interface PlaceDetailsCardProps {
  values: PlaceDetailsValues;
  /** Called with the fields that changed. */
  onChange: (patch: Partial<PlaceDetailsValues>) => void;
  /** Small note under the header — where the values came from. */
  subtitle?: string;
  /** What the clip said about this place — shown, not edited. */
  clipFacts?: PlaceClipFacts;
  /**
   * ผู้ใช้แก้ข้อมูลของเจ้าของสถานที่ได้ไหม (D6)
   *
   * tourist = false → ราคา/เวลาเปิด/โทร/เว็บ เป็นของเจ้าของสถานที่
   * แก้ไม่ได้ (D26) — การ์ดยังต้องเห็น แต่ห้ามแตะ
   */
  canEditOwnerFields?: boolean;
  /** ที่มาของแต่ละช่อง (D21) — ถ้าไม่ระบุ ใช้ค่าเริ่มต้นตามบทบาท */
  sources?: Partial<Record<keyof PlaceDetailsValues, DetailSource>>;
  /** ระดับที่จับคู่กับชุมชนได้ (D28) — แสดงเป็นป้ายกำกับหัวการ์ด */
  matchLevel?: MatchLevel | "manual" | null;
}

export default function PlaceDetailsCard({
  values,
  onChange,
  subtitle,
  clipFacts,
  canEditOwnerFields = true,
  sources,
  matchLevel,
}: PlaceDetailsCardProps) {
  const [editing, setEditing] = useState<{
    priceLevel?: boolean;
    website?: boolean;
    phone?: boolean;
    openingHours?: boolean;
  }>({});
  const [draft, setDraft] = useState<PlaceDetailsValues>(values);

  // The draft follows the parent until a row is opened for editing, so a
  // value that arrives late (the place row loads after the card) still shows.
  const toggle = (key: keyof typeof editing) => {
    setDraft(values);
    setEditing((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const commit = (key: keyof PlaceDetailsValues, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    onChange({ [key]: value.trim() ? value.trim() : null } as Partial<PlaceDetailsValues>);
  };

  // ป้ายที่มา — ค่าเริ่มต้นคือ "จาก Google" (ยังไม่มีใครแก้) · เจ้าของแก้แล้ว = "เจ้าของแจ้ง"
  const sourceOf = (key: keyof PlaceDetailsValues): DetailSource =>
    sources?.[key] ?? "google";
  const badgeOf = (key: keyof PlaceDetailsValues) => ({
    text: SOURCE_LABEL[sourceOf(key)],
    tone: (sourceOf(key) === "owner" ? "green" : sourceOf(key) === "clip" ? "amber" : "blue") as
      | "green"
      | "amber"
      | "blue"
      | "gray",
  });

  const matchBadge =
    matchLevel === "manual"
      ? { text: "ผู้ใช้ระบุเอง", tone: "gray" as const }
      : matchLevel
        ? {
            text:
              matchLevel === "village"
                ? "อยู่ในหมู่บ้านนี้"
                : matchLevel === "subdistrict"
                  ? "อยู่ตำบลเดียวกัน"
                  : "อยู่ในอำเภอเดียวกัน",
            tone: "green" as const,
          }
        : null;

  return (
    <View className="mb-4">
      <View className="flex-row items-center mb-1.5 flex-wrap">
        <Text className="text-[15px] mr-1.5">🏪</Text>
        <Text className="text-gray-700 font-bold text-[13px]">ข้อมูลสถานที่</Text>
        {matchBadge ? (
          <View className="ml-2 px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-100">
            <Text className="text-[10px] font-bold text-emerald-800">
              📍 {matchBadge.text}
            </Text>
          </View>
        ) : null}
      </View>
      {subtitle ? (
        <Text className="text-gray-400 text-[11px] mb-2">{subtitle}</Text>
      ) : null}
      {!canEditOwnerFields ? (
        <Text className="text-gray-400 text-[11px] mb-2">
          ข้อมูลชุดนี้เป็นของเจ้าของสถานที่ — ดูอ่านได้ แต่แก้ไขไม่ได้ (ข้อมูลจากคลิปที่คุณเพิ่มจะถูกบันทึกให้)
        </Text>
      ) : null}

      {/* ระดับราคา */}
      <EditableValueRow
        label="ระดับราคา"
        icon="💰"
        value={values.priceLevel ?? ""}
        editing={!!editing.priceLevel}
        onToggle={() => toggle("priceLevel")}
        emptyHint="ยังไม่ได้ระบุ"
        readOnly={!canEditOwnerFields}
        badge={badgeOf("priceLevel")}
      >
        <View className="flex-row flex-wrap gap-2">
          {PRICE_LEVELS.map((level) => {
            const active = (draft.priceLevel ?? "") === level;
            return (
              <TouchableOpacity
                key={level}
                onPress={() => commit("priceLevel", level)}
                activeOpacity={0.8}
                className={`px-3.5 py-2 rounded-xl border ${
                  active ? "bg-[#2D6A4F] border-[#2D6A4F]" : "bg-white border-gray-200"
                }`}
              >
                <Text
                  className={`text-[15px] font-bold ${active ? "text-white" : "text-gray-700"}`}
                >
                  {level}
                </Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            onPress={() => commit("priceLevel", "")}
            activeOpacity={0.8}
            className={`px-3.5 py-2 rounded-xl border ${
              !draft.priceLevel ? "bg-[#2D6A4F] border-[#2D6A4F]" : "bg-white border-gray-200"
            }`}
          >
            <Text
              className={`text-[13px] font-bold ${!draft.priceLevel ? "text-white" : "text-gray-700"}`}
            >
              ไม่ระบุ
            </Text>
          </TouchableOpacity>
        </View>
        <Text className="text-gray-400 text-[12px] mt-2">
          ระดับราคาคร่าวๆ ตามที่ Google ให้ — แก้ได้ถ้าไม่ตรงกับที่แน่จริง
        </Text>
      </EditableValueRow>

      {/* เว็บไซต์ */}
      <EditableValueRow
        label="เว็บไซต์ / เพจ"
        icon="🌐"
        value={values.website ?? ""}
        editing={!!editing.website}
        onToggle={() => toggle("website")}
        emptyHint="ยังไม่ได้ระบุ"
        readOnly={!canEditOwnerFields}
        badge={badgeOf("website")}
      >
        <TextInput
          value={draft.website ?? ""}
          onChangeText={(t) => setDraft((prev) => ({ ...prev, website: t }))}
          onBlur={() => commit("website", draft.website ?? "")}
          placeholder="https://…"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[15px] text-gray-900"
        />
      </EditableValueRow>

      {/* โทรศัพท์ */}
      <EditableValueRow
        label="เบอร์โทรศัพท์"
        icon="📞"
        value={values.phone ?? ""}
        editing={!!editing.phone}
        onToggle={() => toggle("phone")}
        emptyHint="ยังไม่ได้ระบุ"
        readOnly={!canEditOwnerFields}
        badge={badgeOf("phone")}
      >
        <TextInput
          value={draft.phone ?? ""}
          onChangeText={(t) => setDraft((prev) => ({ ...prev, phone: t }))}
          onBlur={() => commit("phone", draft.phone ?? "")}
          placeholder="08x-xxx-xxxx"
          placeholderTextColor="#9CA3AF"
          keyboardType="phone-pad"
          className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[15px] text-gray-900"
        />
      </EditableValueRow>

      {/* เวลาเปิด-ปิด */}
      <EditableValueRow
        label="เวลาเปิด-ปิด"
        icon="🕒"
        value={values.openingHours ?? ""}
        editing={!!editing.openingHours}
        onToggle={() => toggle("openingHours")}
        emptyHint="ยังไม่ได้ระบุ"
        readOnly={!canEditOwnerFields}
        badge={badgeOf("openingHours")}
      >
        <TextInput
          value={draft.openingHours ?? ""}
          onChangeText={(t) => setDraft((prev) => ({ ...prev, openingHours: t }))}
          onBlur={() => commit("openingHours", draft.openingHours ?? "")}
          placeholder="เช่น จันทร์-อาทิตย์ 08:00-17:00"
          placeholderTextColor="#9CA3AF"
          className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[15px] text-gray-900"
        />
      </EditableValueRow>

      {/* What the clip said about this place — read-only, and saved to the
          place's row so the AI chat can answer from it. */}
      {clipFacts && hasClipFacts(clipFacts) ? (
        <View className="bg-gray-50 border border-gray-200 rounded-2xl p-3 mt-3">
          <View className="flex-row items-center mb-1.5">
            <Text className="text-gray-500 text-[12px] font-bold">📖 ที่อ่านได้จากคลิปนี้</Text>
            <View className="ml-2 px-2 py-0.5 rounded-full border border-amber-200 bg-amber-100">
              <Text className="text-[10px] font-bold text-amber-800">
                {SOURCE_LABEL.clip}
              </Text>
            </View>
          </View>
          {clipFacts.capacity && capacityText(clipFacts.capacity) ? (
            <Text className="text-gray-700 text-[12.5px] leading-5 mb-1">
              ที่พักได้: {capacityText(clipFacts.capacity)}
            </Text>
          ) : null}
          {clipFacts.rules?.length ? (
            <Text className="text-gray-700 text-[12.5px] leading-5 mb-1">
              กติกา: {clipFacts.rules.join(" • ")}
            </Text>
          ) : null}
          {clipFacts.areas?.length ? (
            <Text className="text-gray-700 text-[12.5px] leading-5 mb-1">
              โซน: {clipFacts.areas.join(" • ")}
            </Text>
          ) : null}
          {clipFacts.facilities?.length ? (
            <Text className="text-gray-700 text-[12.5px] leading-5">
              สิ่งอำนวยความสะดวก: {clipFacts.facilities.join(" • ")}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** True when the clip actually gave us something to show. */
function hasClipFacts(facts: PlaceClipFacts): boolean {
  return Boolean(
    (facts.capacity && capacityText(facts.capacity)) ||
      facts.rules?.length ||
      facts.areas?.length ||
      facts.facilities?.length
  );
}
