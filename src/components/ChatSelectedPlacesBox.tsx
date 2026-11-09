import React, { useState } from "react";
import { View, Text, TouchableOpacity, Modal, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MapPinIcon, XMarkIcon } from "react-native-heroicons/outline";
import TripRouteMap from "./TripRouteMap";

/** สถานที่ที่ผู้ใช้เลือก (เอาโครงจาก `AiChatMessage["planPlaces"]` แบบเดียวกัน) */
export interface ChatSelectedPlace {
  label: string;
  address?: string | null;
  coords: { lat: number; lng: number };
  googleMapsUrl?: string | null;
  rating?: number | null;
}

export interface ChatSelectedPlacesBoxProps {
  /** รายการสถานที่ที่ผู้ใช้เลือก (แหล่งเดียวกับที่ส่งให้เอไai) */
  places: ChatSelectedPlace[];
  /** จุดเริ่มต้นของผู้ใช้ (ที่ที่ผู้ใช้อยู่) → ใช้เป็นต้นทางในป๊อปอัปแผนที่ */
  startPoint?: { label: string; coords?: { lat: number; lng: number } | null } | null;
  /** หัวข้อของกล่อง (ค่าเริ่มต้น = "สถานที่ที่เลือก (N)") */
  title?: string;
  /** หัวข้อย่อใต้ชื่อกล่อง */
  subtitle?: string;
}

/**
 * ป๊อปอัปแผนที่: จุดเริ่มต้นของผู้ใช้ → สถานที่ที่เลือก (กล่องละ 1 จุด)
 * -------------------------------------------------------------
 * · ใช้ร่วมกัน 2 ที่: กล่องใต้ฟองผู้ใช้ (ChatSelectedPlacesBox) และชิปในการ์ดตั้งค่า
 * · ใช้ `TripRouteMap` ที่มีอยู่แล้ว → มีปุ่ม "เปิดใน Google Maps" + fallback ตอนเป็น Expo Go
 */
export function ChatPlaceMapModal({
  place,
  startPoint,
  onClose,
}: {
  place: ChatSelectedPlace | null;
  startPoint?: { label: string; coords?: { lat: number; lng: number } | null } | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={!!place}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/50 justify-end">
        {/* พื้นหลังมืด → กดที่ใดก็ได้เพื่อปิด */}
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className="bg-white rounded-t-3xl pt-2.5 px-3"
          style={{ paddingBottom: Math.max(insets.bottom, 14) }}
        >
          <View className="items-center mb-1.5">
            <View className="h-1 w-10 rounded-full bg-gray-300" />
          </View>
          <View className="flex-row items-center px-1 mb-2">
            <View className="flex-1 mr-2">
              <Text className="text-[15px] font-black text-gray-900" numberOfLines={1}>
                เส้นทางไปที่ {place?.label}
              </Text>
              <Text className="text-[11.5px] text-gray-500" numberOfLines={1}>
                จาก {startPoint?.label ?? "จุดเริ่มต้น"}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.8}
              className="p-1.5 rounded-full bg-gray-100"
            >
              <XMarkIcon size={16} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {place ? (
            <TripRouteMap
              startPoint={
                startPoint?.label
                  ? { label: startPoint.label, coords: startPoint.coords ?? null }
                  : null
              }
              stops={[
                {
                  id: `place-${place.label}`,
                  name: place.label,
                  coords: place.coords,
                },
              ]}
              height={320}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/**
 * กล่อง "สถานที่ที่เลือก" ใต้ฟองผู้ใช้
 * -------------------------------------------------------------
 * · แต่ละกล่องมีปุ่ม "Google Map" → เปิด **ป๊อปอัปแผนที่** (เหมือนป๊อปอัปเลือกสไตล์)
 *   ในป๊อปอัปจะเห็นเส้นทางจาก "จุดเริ่มต้นของผู้ใช้" → สถานที่ที่เลือกกล่องนั้น
 * · ข้อมูลในกล่องมาจาก `planPlaces` ตัวเดียวกับที่ส่งให้เอไai → สิ่งที่เห็นกับที่ส่งต่างกันไม่ได้
 */
export default function ChatSelectedPlacesBox({
  places,
  startPoint,
  title,
  subtitle,
}: ChatSelectedPlacesBoxProps) {
  /** สถานที่ที่กำลังดูแผนที่ (null = ปิดป๊อปอัป) */
  const [mapPlace, setMapPlace] = useState<ChatSelectedPlace | null>(null);

  const list = places ?? [];
  if (!list.length) return null;

  return (
    <View className="mt-1.5 rounded-2xl border border-violet-200 bg-white overflow-hidden self-end w-full">
      <View className="flex-row items-center px-3 py-2 bg-violet-50 border-b border-violet-100">
        <MapPinIcon size={14} color="#7C3AED" />
        <Text className="text-[12px] font-bold text-violet-800 ml-1.5 flex-1">
          {title ?? `สถานที่ที่เลือก (${list.length})`}
        </Text>
      </View>
      {subtitle ? (
        <Text className="px-3 pt-1.5 text-[11px] text-gray-500">{subtitle}</Text>
      ) : null}

      {list.map((p, i) => (
        <Pressable
          key={`${p.label}-${i}`}
          onPress={() => setMapPlace(p)}
          className="flex-row items-center px-3 py-2 border-t border-violet-100"
        >
          <View className="w-5 h-5 rounded-full bg-violet-100 items-center justify-center">
            <Text className="text-[10px] font-black text-violet-700">{i + 1}</Text>
          </View>
          <View className="flex-1 ml-2 mr-2">
            <Text className="text-[12.5px] font-bold text-gray-900" numberOfLines={1}>
              {p.label}
            </Text>
            {p.address ? (
              <Text className="text-[11px] text-gray-500" numberOfLines={1}>
                {p.address}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={() => setMapPlace(p)}
            activeOpacity={0.8}
            className="flex-row items-center px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200"
          >
            <MapPinIcon size={12} color="#1D4ED8" />
            <Text className="text-[11px] font-bold text-blue-700 ml-1">Google Map</Text>
          </TouchableOpacity>
        </Pressable>
      ))}

      {/* ── ป๊อปอัปแผนที่: จุดเริ่มต้น → สถานที่ที่เลือก ───────────── */}
      <ChatPlaceMapModal
        place={mapPlace}
        startPoint={startPoint}
        onClose={() => setMapPlace(null)}
      />
    </View>
  );
}
