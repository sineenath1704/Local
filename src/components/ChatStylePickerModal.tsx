import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import {
  XMarkIcon,
  SparklesIcon,
  MapPinIcon,
  CheckIcon,
} from "react-native-heroicons/outline";
import type { DiscoveryStyle } from "../data/tripsData";

/**
 * ChatStylePickerModal — ป๊อปอัปกลางจอให้ผู้ใช้เลือก "แท็ก" ก่อนหาสถานที่
 * -------------------------------------------------------------
 * เปิดทันทีที่ผู้ใช้ถามแบบกว้าง ๆ (เช่น "มีที่ไหนน่าเที่ยวบ้าง")
 * แล้วให้ผู้ใช้เลือกแท็กที่ชอบ (ได้หลายอัน) จากคลังแท็กของระบบ
 *
 * ปุ่ม 3 ตัว (กดได้เสมอ ผู้ใช้ไม่เคยติด):
 *   · "ยกเลิก"                → ถามเป็นแชทธรรมดา
 *   · "ให้ AI คิดให้"        → ให้ AI เลือกแท็กเองจากคำถาม แล้วดึงการ์ดเลย
 *   · "ยืนยันแท็กที่เลือก"     → ใช้แท็กที่ผู้ใช้ติ๊กไว้
 *
 * ไม่มีช่องพิมพ์ — กดแท็กเท่านั้น (พื้นที่ที่เดาได้แสดงเป็นบรรทัดอ่านอย่างเดียว)
 */
export interface ChatStylePickerModalProps {
  visible: boolean;
  /** คลังแท็ก (จาก backend · ถ้ายังไม่ได้ → แอปใช้ชุดสำรองของตัวเอง) */
  tags: DiscoveryStyle[];
  /** กำลังโหลดคลังแท็ก */
  loading?: boolean;
  /** กำลังดึงการ์ดสถานที่จริงจาก Google (กดยืนยัน/ให้ AI คิดแล้ว) */
  busy?: boolean;
  /** พื้นที่ที่เดามาจากคำถาม (แสดงอ่านอย่างเดียว — ให้แก้ไขที่แชทแทน) */
  initialArea?: string;
  /** ข้อความคำถามเดิม (ให้ผู้ใช้เห็นว่ากำลังเลือกแท็กให้กับคำถามอะไร) */
  question?: string;
  /** ผู้ใช้ยืนยันแท็กที่เลือก */
  onConfirm: (tags: DiscoveryStyle[]) => void;
  /** ผู้ใช้กด "ให้ AI คิดให้" → ให้ AI เลือกแท็กเองแล้วดึงการ์ดเลย */
  onAiPick: () => void;
  /** ผู้ใช้กดยกเลิก/ปิด → ถามเป็นแชทธรรมดา */
  onCancel: () => void;
}

export function ChatStylePickerModal({
  visible,
  tags,
  loading = false,
  busy = false,
  initialArea = "",
  question = "",
  onConfirm,
  onAiPick,
  onCancel,
}: ChatStylePickerModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // เปิดใหม่ทุกครั้ง → เริ่มจากไม่ได้เลือกอะไร
  useEffect(() => {
    if (visible) setSelectedIds([]);
  }, [visible]);

  const list = tags ?? [];
  const selected = list.filter((t) => selectedIds.includes(t.id));

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 bg-black/60 items-center justify-center px-5">
        <View className="bg-white rounded-3xl w-full max-w-[420px] overflow-hidden">
          {/* หัวเรื่อง */}
          <View className="flex-row items-start justify-between px-5 pt-5 pb-3">
            <View className="flex-1 mr-3">
              <Text className="text-[17px] font-bold text-gray-900">
                อยากไปแท็กไหน?
              </Text>
              <Text className="text-[12px] text-gray-500 mt-1" numberOfLines={2}>
                {question
                  ? `สำหรับ "${question}"`
                  : "เลือกแท็กที่ชอบได้หลายอัน แล้วเราจะหาสถานที่จริงให้"}
              </Text>
            </View>
            <TouchableOpacity onPress={onCancel} className="p-1 rounded-full bg-gray-100">
              <XMarkIcon size={20} color="#4B5563" />
            </TouchableOpacity>
          </View>

          {/* พื้นที่ที่เดามาได้ (อ่านอย่างเดียว) */}
          {initialArea ? (
            <View className="mx-5 mb-1 flex-row items-center bg-violet-50 border border-violet-100 rounded-xl px-3 py-2">
              <MapPinIcon size={15} color="#7C3AED" />
              <Text
                className="text-[12.5px] text-violet-700 font-bold ml-1.5 flex-1"
                numberOfLines={1}
              >
                {initialArea} (จากคำถาม)
              </Text>
            </View>
          ) : null}

          {/* แท็ก */}
          {busy ? (
            <View className="items-center py-8 px-5">
              <ActivityIndicator size="large" color="#7C3AED" />
              <Text className="text-gray-700 font-bold text-[14px] mt-4">
                กำลังหาสถานที่จาก Google Maps...
              </Text>
              <Text className="text-gray-500 text-[12px] mt-1 text-center">
                อาจใช้เวลาสัก 10-20 วินาที การ์ดสถานที่จะขึ้นในแชทเอง
              </Text>
            </View>
          ) : loading && list.length === 0 ? (
            <View className="items-center py-8 px-5">
              <ActivityIndicator size="large" color="#7C3AED" />
              <Text className="text-gray-700 font-bold text-[14px] mt-4">
                กำลังดูแท็กที่เหมาะกับคำถามคุณ...
              </Text>
              <Text className="text-gray-500 text-[12px] mt-1 text-center">
                เดี๋ยวก่อนนะคะ กำลังเอาคลังแท็กมาให้เลือก
              </Text>
            </View>
          ) : (
            <ScrollView
              className="px-5 py-3"
              style={{ maxHeight: 300 }}
              contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap" }}
            >
              {list.map((tag) => {
                const on = selectedIds.includes(tag.id);
                return (
                  <TouchableOpacity
                    key={tag.id}
                    onPress={() => toggle(tag.id)}
                    activeOpacity={0.85}
                    className={
                      on
                        ? "flex-row items-center bg-violet-600 border border-violet-600 rounded-full px-3.5 py-2 mr-2 mb-2"
                        : "flex-row items-center bg-white border border-gray-200 rounded-full px-3.5 py-2 mr-2 mb-2"
                    }
                  >
                    <Text className="text-[15px] mr-1.5">{tag.emoji}</Text>
                    <Text
                      className={
                        on
                          ? "text-[13px] font-bold text-white"
                          : "text-[13px] font-bold text-gray-700"
                      }
                    >
                      {tag.label}
                    </Text>
                    {on ? (
                      <CheckIcon size={14} color="#FFFFFF" style={{ marginLeft: 5 }} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* ปุ่ม 3 ตัว */}
          <View className="px-5 pt-1 pb-5">
            <TouchableOpacity
              onPress={onCancel}
              activeOpacity={0.85}
              className="rounded-xl py-3 items-center justify-center flex-row bg-gray-100"
            >
              <XMarkIcon size={17} color="#4B5563" />
              <Text className="text-gray-700 font-bold text-[13.5px] ml-1.5">
                ยกเลิก
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onAiPick}
              activeOpacity={0.85}
              disabled={busy}
              className="rounded-xl py-3 items-center justify-center flex-row bg-white border border-violet-300 mt-2.5"
            >
              <SparklesIcon size={17} color="#7C3AED" />
              <Text className="text-violet-700 font-bold text-[13.5px] ml-1.5">
                ให้ AI คิดให้
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => onConfirm(selected)}
              activeOpacity={0.85}
              disabled={busy || selected.length === 0}
              className={
                busy || selected.length === 0
                  ? "rounded-xl py-3 items-center justify-center flex-row bg-gray-200 mt-2.5"
                  : "rounded-xl py-3 items-center justify-center flex-row bg-violet-600 mt-2.5"
              }
            >
              <Text
                className={
                  busy || selected.length === 0
                    ? "text-gray-400 font-bold text-[13.5px]"
                    : "text-white font-bold text-[13.5px]"
                }
              >
                ยืนยันแท็กที่เลือก
              </Text>
            </TouchableOpacity>

            <View className="flex-row items-center justify-center mt-3">
              <SparklesIcon size={13} color="#9CA3AF" />
              <Text className="text-[11.5px] text-gray-400 ml-1">
                สถานที่ทั้งหมดมาจาก Google Maps จริง
              </Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
