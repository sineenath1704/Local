import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import {
  XMarkIcon,
  SparklesIcon,
  MapPinIcon,
  ArrowPathIcon,
} from "react-native-heroicons/outline";
import type { DiscoveryStyle } from "../data/tripsData";

/**
 * ChatStylePickerModal — ป๊อปอัปให้ผู้ใช้เลือก "สไตล์" ก่อนหาสถานที่
 * -------------------------------------------------------------
 * เปิดทันทีที่ผู้ใช้ถามแบบกว้าง ๆ (เช่น "มีที่ไหนน่าเที่ยวบ้าง")
 * แล้วให้ AI เสนอสไตล์ที่ตรงกับคำถาม → ผู้ใช้เลือก 1 แบบ
 *
 * มีปุ่มปิด (X) + ปุ่ม "ยกเลิก" เสมอ → กดยกเลิก = ถามเป็นแชทธรรมดา
 * (ไม่มีทางติด ไม่ต้องหลอกผู้ใช้ว่าต้องเลือก)
 */
export interface ChatStylePickerModalProps {
  visible: boolean;
  /** สไตล์ที่ AI เสนอ (ถ้ายังไม่ได้ → null แล้วแสดงสำรอง 6 แบบ) */
  styles: DiscoveryStyle[];
  /** กำลังโหลดสไตล์จาก AI */
  loading?: boolean;
  /** กำลังดึงการ์ดสถานที่จริงจาก Google (ผู้ใช้เลือกสไตล์แล้ว) */
  busy?: boolean;
  /** พื้นที่ที่เดามาจากคำถาม (ใช้เติมในช่องพื้นที่) */
  initialArea?: string;
  /** ข้อความคำถามเดิม (ให้ผู้ใช้เห็นว่ากำลังเลือกสไตล์ให้กับคำถามอะไร) */
  question?: string;
  /** ผู้ใช้เลือกสไตล์แล้ว (พร้อมพื้นที่ที่แก้ไข) */
  onPick: (style: DiscoveryStyle, area: string) => void;
  /** ผู้ใช้กดยกเลิก/ปิด → ถามเป็นแชทธรรมดา */
  onCancel: () => void;
  /** ขอโหลดสไตล์ใหม่ (ปุ่ม "ลองใหม่") */
  onRetry?: () => void;
}

export function ChatStylePickerModal({
  visible,
  styles,
  loading = false,
  busy = false,
  initialArea = "",
  question = "",
  onPick,
  onCancel,
  onRetry,
}: ChatStylePickerModalProps) {
  const [area, setArea] = useState(initialArea);

  // เปิดใหม่ทุกครั้ง → เริ่มจากพื้นที่ที่เดามาได้
  useEffect(() => {
    if (visible) setArea(initialArea);
  }, [visible, initialArea]);

  const list = styles ?? [];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1 bg-black/60 justify-end">
        <View className="bg-white rounded-t-3xl max-h-[85%] flex-col">
          {/* Header: ปุ่มปิด (X) */}
          <View className="flex-row items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
            <View className="flex-1 mr-3">
              <Text className="text-[17px] font-bold text-gray-900">อยากไปสไตล์ไหน?</Text>
              <Text className="text-[12px] text-gray-500 mt-0.5" numberOfLines={1}>
                {question ? `สำหรับ "${question}"` : "เลือกสไตล์ที่ชอบ แล้วเราจะหาสถานที่จริงให้"}
              </Text>
            </View>
            <TouchableOpacity onPress={onCancel} className="p-1 rounded-full bg-gray-100">
              <XMarkIcon size={20} color="#4B5563" />
            </TouchableOpacity>
          </View>

          {/* พื้นที่ */}
          <View className="px-5 pt-4">
            <Text className="text-[12px] font-bold text-gray-500 mb-2">
              พื้นที่ (เว้นว่างไว้ = ให้ระบบเดาจากคำถาม)
            </Text>
            <View className="flex-row items-center bg-gray-100 rounded-xl px-3.5 py-2.5 border border-gray-200">
              <MapPinIcon size={18} color="#6B7280" />
              <TextInput
                value={area}
                onChangeText={setArea}
                placeholder="เช่น เชียงใหม่, อยุธยา"
                placeholderTextColor="#9CA3AF"
                className="flex-1 text-[13.5px] text-gray-900 ml-2 py-0"
              />
            </View>
          </View>

          {/* รายการสไตล์ */}
          <ScrollView
            className="flex-1 px-5 pt-4"
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            {busy ? (
              <View className="items-center py-10">
                <ActivityIndicator size="large" color="#7C3AED" />
                <Text className="text-gray-700 font-bold text-[14px] mt-4">
                  กำลังหาสถานที่จาก Google Maps...
                </Text>
                <Text className="text-gray-500 text-[12px] mt-1 text-center px-6">
                  อาจใช้เวลาสัก 10-20 วินาที การ์ดสถานที่จะขึ้นในแชทเอง
                </Text>
              </View>
            ) : loading && list.length === 0 ? (
              <View className="items-center py-10">
                <ActivityIndicator size="large" color="#7C3AED" />
                <Text className="text-gray-700 font-bold text-[14px] mt-4">
                  กำลังคิดสไตล์ที่เหมาะกับคำถามคุณ...
                </Text>
                <Text className="text-gray-500 text-[12px] mt-1 text-center px-6">
                  เดี๋ยวก่อนนะคะ กำลังดูว่าคำถามนี้ควรเป็นสไตล์ไหน
                </Text>
              </View>
            ) : (
              <>
                <Text className="text-[12px] font-bold text-gray-500 mb-2">
                  {loading ? "กำลังอัปเดตสไตล์..." : "เลือกสไตล์ที่ชอบ"}
                </Text>
                {list.map((style) => (
                  <TouchableOpacity
                    key={style.id}
                    onPress={() => onPick(style, area.trim())}
                    activeOpacity={0.85}
                    className="bg-white border border-gray-200 rounded-2xl p-3.5 mb-2.5 flex-row items-center shadow-xs"
                  >
                    <View className="w-11 h-11 rounded-xl bg-violet-50 border border-violet-100 items-center justify-center mr-3">
                      <Text className="text-[20px]">{style.emoji}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-[14px] font-bold text-gray-900">{style.label}</Text>
                      {style.desc ? (
                        <Text className="text-[12px] text-gray-500 mt-0.5" numberOfLines={2}>
                          {style.desc}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))}

                {onRetry ? (
                  <TouchableOpacity
                    onPress={onRetry}
                    activeOpacity={0.8}
                    className="flex-row items-center justify-center py-2.5 mt-1"
                  >
                    <ArrowPathIcon size={15} color="#6B7280" />
                    <Text className="text-[12.5px] font-bold text-gray-600 ml-1.5">
                      ลองเสนอสไตล์ใหม่อีกครั้ง
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </ScrollView>

          {/* ปุ่มยกเลิก (กดได้เสมอ) */}
          <View className="px-5 pb-5 pt-2 border-t border-gray-100">
            <TouchableOpacity
              onPress={onCancel}
              activeOpacity={0.85}
              className="rounded-xl py-3 items-center justify-center flex-row bg-gray-100"
            >
              <XMarkIcon size={17} color="#4B5563" />
              <Text className="text-gray-700 font-bold text-[13.5px] ml-1.5">
                {busy
                  ? "ปิด (สถานที่จะขึ้นในแชทเอง)"
                  : "ยกเลิก (ถามเป็นแชทธรรมดาแทน)"}
              </Text>
            </TouchableOpacity>
            <View className="flex-row items-center justify-center mt-2.5">
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
