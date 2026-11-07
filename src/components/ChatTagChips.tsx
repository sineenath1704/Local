import React, { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import {
  ArrowTopRightOnSquareIcon,
  GlobeAltIcon,
} from "react-native-heroicons/outline";
import type { ChatSource, PlaceTag } from "../data/tripsData";

/**
 * แท็กของคำตอบเอไai
 * =============================================================
 * กฎของผู้ใช้:
 *   · **แท็กเฉพาะตอนที่คำตอบเอ่ยชื่อสถานที่** (ไม่ใช่ทุกคำตอบ)
 *   · **แท็กอยู่หน้าชื่อสถานที่** ในบรรทัดเดียวกับคำตอบ ไม่ใช่ก้อนใต้ข้อความ
 *
 * แท็กที่มี 3 อย่าง
 *   1. ประเภทสถานที่ — OTOP (ติดทะเบียนของระบบ) หรือท่องเที่ยวทั่วไป
 *      (backend ตรวจจากทะเบียน `community_places` ตามกฎของผู้ใช้:
 *       "นำชื่อไปค้นว่าเป็นสถานที่ OTOP ไหมก่อน")
 *   2. หมวดหมู่ — ที่พัก · ร้านอาหาร · คาเฟ่ · แหล่งท่องเที่ยว ...
 *   3. ลิงก์แหล่งที่มา — มีเมื่อคำตอบนั้นมาจากการค้นเว็บ (Google Search)
 *
 * ไม่มีอะไรเลย → ไม่วาดอะไร (ไม่ต้องมีกรอบเปล่าในแชท)
 */

// ─────────────────────────────────────────────────────────────────────────
//  แท็กในบรรทัดเดียวกับคำตอบ (วางไว้หน้าชื่อสถานที่)
// ─────────────────────────────────────────────────────────────────────────

/** หนีอักขระพิเศษของ regex ออกจากชื่อสถานที่ */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * หาตำแหน่งที่จะวางแท็กในข้อความ
 * -------------------------------------------------------------
 * · เทียบชื่อแบบไม่สนตัวพิมพ์ และยอมให้ช่องว่างไม่ต้องตรงกัน
 * · ไม่เจอ → null (แอปแสดงข้อความเดิม ไม่มีแท็ก)
 */
export function splitAtPlaceName(
  content: string,
  placeName?: string | null
): { before: string; match: string; after: string } | null {
  const name = (placeName ?? "").trim();
  if (!name || !content) return null;
  const pattern = new RegExp(
    escapeRegExp(name).replace(/\s+/g, "\\s+"),
    "i"
  );
  const hit = pattern.exec(content);
  if (!hit || hit.index < 0) return null;
  return {
    before: content.slice(0, hit.index),
    match: hit[0],
    after: content.slice(hit.index + hit[0].length),
  };
}

/**
 * แท็กแบบอยู่ในบรรทัดเดียวกับข้อความ
 * -------------------------------------------------------------
 * ใช้เป็นลูกของ `<Text>` ของข้อความ (React Native วาด `<Text>` ซ้อนกันได้)
 * → แท็กจึงไปอยู่ตรง "หน้าชื่อสถานที่" ไม่ใช่ก้อนใต้ข้อความ
 */
export function InlinePlaceTags({
  placeTag,
  tags,
}: {
  placeTag?: PlaceTag | null;
  tags?: string[] | null;
}) {
  const topicList = (tags ?? []).filter(
    (t) => typeof t === "string" && t.trim()
  );
  if (!placeTag && topicList.length === 0) return null;

  const isOtop = placeTag === "otop";

  return (
    <>
      {placeTag ? (
        <Text
          style={{
            backgroundColor: isOtop ? "#FEF3C7" : "#E0F2FE",
            color: isOtop ? "#B45309" : "#0369A1",
            fontSize: 11,
            fontWeight: "700",
            borderRadius: 999,
            paddingHorizontal: 6,
            paddingVertical: 1,
            marginRight: 4,
          }}
        >
          {isOtop ? "OTOP" : "ท่องเที่ยวทั่วไป"}
        </Text>
      ) : null}
      {topicList.map((tag) => (
        <Text
          key={tag}
          style={{
            backgroundColor: "#F5F3FF",
            color: "#6D28D9",
            fontSize: 11,
            fontWeight: "600",
            borderRadius: 999,
            paddingHorizontal: 6,
            paddingVertical: 1,
            marginRight: 4,
          }}
        >
          {tag}
        </Text>
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  แหล่งที่มา (กด "ที่มา N แหล่ง" เพื่อกางลิงก์ออก)
// ─────────────────────────────────────────────────────────────────────────

export function ChatSourceChips({
  sources,
}: {
  sources?: ChatSource[] | null;
}) {
  const [showSources, setShowSources] = useState(false);
  const sourceList = (sources ?? []).filter((s) => s?.url);
  if (sourceList.length === 0) return null;

  return (
    <View className="mt-1.5 self-start">
      <Pressable
        onPress={() => setShowSources((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showSources }}
        accessibilityLabel={`ดูแหล่งที่มาจากเว็บ ${sourceList.length} แหล่ง`}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        className="flex-row items-center self-start bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1"
      >
        <GlobeAltIcon size={13} color="#4B5563" />
        <Text className="text-[12px] font-semibold text-gray-600 ml-1">
          ที่มา {sourceList.length} แหล่ง
        </Text>
        <ArrowTopRightOnSquareIcon size={11} color="#6B7280" />
      </Pressable>

      {/* ── รายการลิงก์แหล่งที่มา (กด "ที่มา" เพื่อกางออก) ──────────── */}
      {showSources ? (
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
              <Text
                className="text-[12px] text-gray-700 ml-1 flex-1"
                numberOfLines={2}
              >
                {s.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
