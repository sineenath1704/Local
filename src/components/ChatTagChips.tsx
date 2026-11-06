import React, { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import {
  ArrowTopRightOnSquareIcon,
  CheckBadgeIcon,
  GlobeAltIcon,
} from "react-native-heroicons/outline";
import type { ChatSource, PlaceTag } from "../data/tripsData";

/**
 * แท็กใต้ฟองแชทของเอไai
 * =============================================================
 * 3 อย่างที่บอกผู้ใช้ได้ว่าคำตอบนี้มาจากไหน
 *
 *   1. แท็กประเภทสถานที่ — OTOP (ติดทะเบียนของระบบ) หรือท่องเที่ยวทั่วไป
 *      (backend ตรวจจากทะเบียน `community_places` ตามกฎของผู้ใช้:
 *       "นำชื่อไปค้นว่าเป็นสถานที่ OTOP ไหมก่อบ")
 *   2. แท็กหมวดหมู่ — ที่พัก · ร้านอาหาร · คาเฟ่ · แหล่งท่องเที่ยว ...
 *   3. ลิงก์แหล่งที่มา — มีเมื่อคำตอบนั้นมาจากการค้นเว็บ (Google Search)
 *
 * ไม่มีอะไรเลย → ไม่วาดอะไร (ไม่ต้องมีกรอบเปล่าในแชท)
 */

interface ChatTagChipsProps {
  /** แท็กประเภทสถานที่ (OTOP / ท่องเที่ยวทั่วไป) */
  placeTag?: PlaceTag | null;
  /** แท็กหมวดหมู่ของสถานที่ */
  tags?: string[] | null;
  /** ลิงก์แหล่งที่มาจากการค้นเว็บ */
  sources?: ChatSource[] | null;
}

export default function ChatTagChips({
  placeTag,
  tags,
  sources,
}: ChatTagChipsProps) {
  const [showSources, setShowSources] = useState(false);
  const topicList = (tags ?? []).filter((t) => typeof t === "string" && t.trim());
  const sourceList = (sources ?? []).filter((s) => s?.url);
  if (!placeTag && topicList.length === 0 && sourceList.length === 0) return null;

  const isOtop = placeTag === "otop";

  return (
    <View className="mt-1.5 self-start">
      <View className="flex-row flex-wrap items-center gap-1.5">
        {/* ── แท็กประเภทสถานที่ ───────────────────────────────────── */}
        {placeTag ? (
          <View
            className={`flex-row items-center rounded-full px-2.5 py-1 border ${
              isOtop
                ? "bg-amber-50 border-amber-300"
                : "bg-sky-50 border-sky-300"
            }`}
          >
            <CheckBadgeIcon
              size={13}
              color={isOtop ? "#B45309" : "#0369A1"}
            />
            <Text
              className={`text-[12px] font-bold ml-1 ${
                isOtop ? "text-amber-800" : "text-sky-800"
              }`}
            >
              {isOtop ? "OTOP" : "ท่องเที่ยวทั่วไป"}
            </Text>
          </View>
        ) : null}

        {/* ── แท็กหมวดหมู่ ───────────────────────────────────────── */}
        {topicList.map((tag) => (
          <View
            key={tag}
            className="bg-violet-50 border border-violet-200 rounded-full px-2.5 py-1"
          >
            <Text className="text-[12px] font-semibold text-violet-700">
              {tag}
            </Text>
          </View>
        ))}

        {/* ── แหล่งที่มา (มีตอนคำตอบมาจากการค้นเว็บ) ─────────────── */}
        {sourceList.length > 0 ? (
          <Pressable
            onPress={() => setShowSources((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showSources }}
            accessibilityLabel={`ดูแหล่งที่มาจากเว็บ ${sourceList.length} แหล่ง`}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            className="flex-row items-center bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1"
          >
            <GlobeAltIcon size={13} color="#4B5563" />
            <Text className="text-[12px] font-semibold text-gray-600 ml-1">
              ที่มา {sourceList.length} แหล่ง
            </Text>
            <ArrowTopRightOnSquareIcon size={11} color="#6B7280" />
          </Pressable>
        ) : null}
      </View>

      {/* ── รายการลิงก์แหล่งที่มา (กด "ที่มา" เพื่อกางออก) ──────────── */}
      {showSources && sourceList.length > 0 ? (
        <View className="mt-1.5 bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-2 gap-1">
          {sourceList.map((s) => (
            <Pressable
              key={s.url}
              onPress={() => Linking.openURL(s.url).catch(() => undefined)}
              accessibilityRole="link"
              accessibilityLabel={`เปิด ${s.title}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              className="flex-row items-start"
            >
              <ArrowTopRightOnSquareIcon size={12} color="#6B7280" />
              <Text className="text-[12px] text-gray-700 ml-1 flex-1" numberOfLines={2}>
                {s.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
