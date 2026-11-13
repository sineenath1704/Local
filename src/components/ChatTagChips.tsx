import React, { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import {
  ArrowTopRightOnSquareIcon,
  GlobeAltIcon,
} from "react-native-heroicons/outline";
import type { ChatSource, PlaceTag } from "../data/tripsData";

/**
 * แท็กของคำตอบ AI
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

/**
 * วางแท็กหน้าชื่อสถานที่แต่ละแห่งในข้อความ (แยกตามแต่ละสถานที่ ไม่ใช่ติดที่จังหวัด)
 */
export function renderAnnotatedTextWithPlaces(
  content: string,
  placeTags?: { name: string; placeTag?: PlaceTag | null; tags?: string[] | null }[] | null,
  singleTag?: { placeName?: string | null; placeTag?: PlaceTag | null; tags?: string[] | null }
): React.ReactNode {
  if (!content) return null;
  const list = (placeTags ?? []).filter((p) => p && p.name && p.name.trim());
  if (list.length === 0) {
    if (singleTag?.placeName) {
      const parts = splitAtPlaceName(content, singleTag.placeName);
      if (parts) {
        return (
          <>
            {parts.before}
            <InlinePlaceTags placeTag={singleTag.placeTag} tags={singleTag.tags} />
            {parts.match}
            {parts.after}
          </>
        );
      }
    }
    return content;
  }

  type MatchSpan = {
    start: number;
    end: number;
    placeTag?: PlaceTag | null;
    tags?: string[] | null;
    matchText: string;
  };
  const spans: MatchSpan[] = [];

  for (const item of list) {
    const pattern = new RegExp(escapeRegExp(item.name.trim()).replace(/\s+/g, "\\s+"), "gi");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        placeTag: item.placeTag,
        tags: item.tags,
        matchText: match[0],
      });
      if (!pattern.global) break;
    }
  }

  if (spans.length === 0) return content;

  spans.sort((a, b) => a.start - b.start);
  const nonOverlapping: MatchSpan[] = [];
  let lastEnd = 0;
  for (const s of spans) {
    if (s.start >= lastEnd) {
      nonOverlapping.push(s);
      lastEnd = s.end;
    }
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  nonOverlapping.forEach((span, idx) => {
    if (span.start > cursor) {
      nodes.push(content.slice(cursor, span.start));
    }
    nodes.push(
      <React.Fragment key={`tag-span-${idx}`}>
        <InlinePlaceTags placeTag={span.placeTag} tags={span.tags} />
        {span.matchText}
      </React.Fragment>
    );
    cursor = span.end;
  });
  if (cursor < content.length) {
    nodes.push(content.slice(cursor));
  }

  return <>{nodes}</>;
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
