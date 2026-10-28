import React from "react";
import { Text, View } from "react-native";
import * as Linking from "expo-linking";
import type {
  PostCard as PostCardData,
  PostCardLine,
} from "../data/commentsData";

/**
 * การ์ดสรุปหน้าโพสต์ (PostCard)
 * =============================================================
 * รูปแบบมีโครงสร้างของสรุป AI — backend เป็นเจ้าของข้อมูล
 * (ดู `backend/src/videoPromptV2.ts` → `buildPostCard()`)
 *
 * รูปแบบปัจจุบัน: การ์ด "ข้อความล้วน" ไม่มีไอคอนหน้าบรรทัด
 *   · blocks[].style = "bullets" → หัวข้อ + รายการขึ้นต้นด้วย "• "
 *   · blocks[].style = "facts"   → หัวข้อ (ถ้ามี) + บรรทัดข้อเท็จจริงต่อเนื่อง
 *
 * หัวข้อที่มีหัวข้อชัดเจน เช่น "ราคา" "ที่พัก" "ภายในห้องพัก"
 * → วาดเป็นหัวข้อจริง + เส้นแบ่งบาง ๆ ให้กวาดตาอ่านได้เร็ว
 *
 * การ์ดเก่าในฐานข้อมูล (มี `sections`) → เรนเดอร์แบบเดิม (มีไอคอน ✔/⚠/ℹ)
 * คลิปเก่าไม่มี `card` → ผู้เรียกต้อง fallback ไปแสดง `summary.text` แบบเดิม
 */

interface Props {
  card?: PostCardData | null;
}

/** สัญลักษณ์ + สีของแต่ละบรรทัด (เฉพาะการ์ดรูปแบบเก่า) */
const LINE_STYLE: Record<PostCardLine["kind"], { icon: string; text: string }> = {
  ok: { icon: "✔", text: "text-gray-700" },
  warn: { icon: "⚠", text: "text-amber-700" },
  info: { icon: "ℹ", text: "text-blue-700" },
};

/**
 * ข้อความในบรรทัด — ถ้ามีลิงก์ (เช่น "สถานที่ที่อยู่ใกล้เคียง")
 * ให้กดแล้วเปิดแผนที่ได้เลย
 */
function CardLineText({
  line,
  className,
}: {
  line: PostCardLine;
  className?: string;
}) {
  const url = line.url?.trim();
  if (!url) return <Text className={className}>{line.text}</Text>;
  return (
    <Text
      className={`${className ?? ""} text-blue-700 underline`}
      suppressHighlighting
      onPress={() => {
        void Linking.openURL(url).catch(() => {
          // เปิดแผนที่ไม่ได้ (ไม่มีแอปแผนที่) → ไม่ต้องทำอะไร
        });
      }}
    >
      {line.text}
    </Text>
  );
}

export default function PostCardView({ card }: Props) {
  // ไม่มีการ์ด → ให้ผู้เรียก fallback เอง (แสดงข้อความเดิม)
  if (!card) return null;

  // กันข้อมูลผิดรูปแบบในฐานข้อมูลทำให้หน้าโพสต์พัง
  const blocks = Array.isArray(card.blocks) ? card.blocks : [];
  const sections = Array.isArray(card.sections) ? card.sections : [];
  const isLegacy = blocks.length === 0 && sections.length > 0;

  const name = card.place?.name?.trim();
  const address = card.place?.address?.trim();
  const tagline = card.place?.tagline?.trim();
  const description = card.place?.description?.trim();

  const contactBits = [
    card.contact?.phone ? `โทร ${card.contact.phone}` : null,
    card.contact?.facebook ? `เฟซบุ๊ก ${card.contact.facebook}` : null,
    card.contact?.line ? `ไลน์ ${card.contact.line}` : null,
    card.contact?.hours ? `เวลา ${card.contact.hours}` : null,
  ].filter(Boolean) as string[];
  return (
    <View className="bg-amber-50/90 border border-amber-200/80 rounded-2xl p-4 shadow-sm">
      {/* ชื่อสถานที่ + ที่อยู่ + แท็กไลน์ + คำบรรยาย */}
      {(name || address || tagline || description) && (
        <View className="mb-3">
          {name ? (
            <Text className="text-gray-900 font-bold text-[14px]">{name}</Text>
          ) : null}
          {address ? (
            <Text className="text-gray-500 text-[12px] mt-0.5">{address}</Text>
          ) : null}
          {tagline ? (
            <Text className="text-gray-700 text-[12.5px] leading-5 mt-1">{tagline}</Text>
          ) : null}
          {description ? (
            <Text className="text-gray-600 text-[12.5px] leading-5 mt-1">{description}</Text>
          ) : null}
        </View>
      )}

      {/* บล็อก (รูปแบบปัจจุบัน) — ข้อความล้วน ไม่มีไอคอน */}
      {blocks.map((block, i) => {
        const lines = Array.isArray(block.lines) ? block.lines : [];
        return (
          <View key={`${block.title ?? "facts"}-${i}`} className={i > 0 ? "mt-3" : ""}>
            {block.title ? (
              <View className="flex-row items-center mb-1">
                <Text className="text-gray-900 font-bold text-[13.5px]">
                  {block.title}
                </Text>
                <View className="flex-1 ml-2 h-px bg-amber-200/80" />
              </View>
            ) : null}

            {block.style === "bullets"
              ? lines.map((line, j) => (
                  <View key={j} className="flex-row mb-0.5">
                    <Text className="text-[12px] w-4 text-gray-400">•</Text>
                    <CardLineText
                      line={line}
                      className="text-[13px] leading-5 flex-1 text-gray-700"
                    />
                  </View>
                ))
              : lines.map((line, j) => (
                  <CardLineText
                    key={j}
                    line={line}
                    className="text-[13px] leading-5 text-gray-700 mb-0.5"
                  />
                ))}
          </View>
        );
      })}

      {/* การ์ดรูปแบบเก่า — ยังมีอยู่ในฐานข้อมูล เรนเดอร์แบบเดิม */}
      {isLegacy
        ? sections.map((section, i) => (
            <View key={`${section.title}-${i}`} className={i > 0 ? "mt-3" : ""}>
              <View className="flex-row items-center flex-wrap mb-1">
                <Text className="text-gray-900 font-bold text-[13.5px]">
                  {section.title}
                </Text>
                {section.highlight ? (
                  <Text className="text-amber-700 font-bold text-[13.5px] ml-2">
                    {section.highlight}
                  </Text>
                ) : null}
              </View>

              {(Array.isArray(section.lines) ? section.lines : []).map((line, j) => {
                const style = LINE_STYLE[line.kind] ?? LINE_STYLE.ok;
                return (
                  <View key={j} className="flex-row mb-0.5">
                    <Text className="text-[12px] w-4">{style.icon}</Text>
                    <Text className={`text-[13px] leading-5 flex-1 ${style.text}`}>
                      {line.text}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))
        : null}

      {/* กิจกรรม (รูปแบบเก่า) */}
      {card.activity ? (
        <Text className="text-gray-800 text-[13px] leading-5 mt-3">{card.activity}</Text>
      ) : null}

      {/* ติดต่อ/จอง */}
      {contactBits.length > 0 ? (
        <Text className="text-gray-800 text-[13px] leading-5 mt-2">
          {isLegacy ? `ติดต่อ/จอง: ${contactBits.join(" · ")}` : contactBits.join(" · ")}
        </Text>
      ) : null}

      {/* เครดิตแผนที่ (ต้องแสดงเมื่อมีข้อมูลจาก OSM) */}
      {card.mapCredit ? (
        <Text className="text-gray-400 text-[12px] mt-3">{card.mapCredit}</Text>
      ) : null}
    </View>
  );
}
