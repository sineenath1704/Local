import React from "react";
import { View, Text, TouchableOpacity, Image, Linking } from "react-native";
import {
  MapPinIcon,
  ArrowTopRightOnSquareIcon,
  GlobeAltIcon,
} from "react-native-heroicons/outline";
import { CheckIcon } from "react-native-heroicons/solid";
import type { ChatPlaceCard as ChatPlaceCardData } from "../data/tripsData";
import { placePhotoUrl } from "../services/placesService";

/**
 * ChatPlaceCard — กล่องสถานที่ 1 แห่ง ในแชท (ประเภท D)
 * -------------------------------------------------------------
 * 1 กล่อง = 1 สถานที่ ข้อมูลจริงจาก Google Places:
 *   รูป · ชื่อ + ป้ายสไตล์ · คำอธิบายสั้น ๆ · ⭐ ดาว (จำนวนรีวิว)
 *   · ปุ่ม "เพจ/เว็บไซต์" (ซ่อนถ้าไม่มี) · ปุ่ม "เปิดใน Google Maps" · checkbox
 */
export interface ChatPlaceCardProps {
  place: ChatPlaceCardData;
  /** ติ๊กไว้แล้วหรือยัง */
  selected: boolean;
  /** กดกล่อง (ติ๊ก/เอาออก) */
  onToggle: () => void;
  /** ป้ายสไตล์ที่ผู้ใช้เลือก (แสดงเป็นป้ายเล็ก ๆ บนชื่อสถานที่) */
  styleLabel?: string | null;
  styleEmoji?: string | null;
}

export function ChatPlaceCard({
  place,
  selected,
  onToggle,
  styleLabel,
  styleEmoji,
}: ChatPlaceCardProps) {
  const imgUrl = placePhotoUrl(place.photoUrl);

  const openLink = (url: string | null) => {
    if (!url) return;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.9}
      className={`mb-3 rounded-2xl border overflow-hidden bg-white shadow-xs ${
        selected ? "border-violet-500" : "border-gray-200"
      }`}
    >
      {/* รูปประกอบ */}
      {imgUrl ? (
        <Image
          source={{ uri: imgUrl }}
          className="w-full h-36 bg-gray-100"
          resizeMode="cover"
        />
      ) : (
        <View className="w-full h-20 bg-gray-100 items-center justify-center flex-row">
          <MapPinIcon size={22} color="#9CA3AF" />
          <Text className="text-gray-400 text-[11.5px] ml-1.5" numberOfLines={1}>
            {place.name}
          </Text>
        </View>
      )}

      <View className="p-3.5">
        <View className="flex-row items-start justify-between">
          <View className="flex-1 mr-2">
            <View className="flex-row items-center flex-wrap">
              <Text className="text-[15px] font-bold text-gray-900" numberOfLines={2}>
                {place.name}
              </Text>
              {styleLabel ? (
                <View className="ml-1.5 px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200">
                  <Text className="text-[10.5px] font-bold text-violet-700">
                    {styleEmoji ? `${styleEmoji} ` : ""}
                    {styleLabel}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* ประเภทสถานที่ + ที่อยู่ */}
            {place.category ? (
              <Text className="text-[11.5px] font-semibold text-emerald-700 mt-1">
                {place.category}
              </Text>
            ) : null}
            {place.address ? (
              <Text className="text-[11.5px] text-gray-500 mt-0.5" numberOfLines={2}>
                {place.address}
              </Text>
            ) : null}
          </View>

          {/* Checkbox */}
          <View
            className={`w-6 h-6 rounded-full border items-center justify-center mt-0.5 ${
              selected ? "bg-violet-600 border-violet-600" : "border-gray-300"
            }`}
          >
            {selected ? <CheckIcon size={14} color="#FFFFFF" /> : null}
          </View>
        </View>

        {/* คำอธิบายสั้น ๆ */}
        {place.description ? (
          <Text className="text-[12.5px] text-gray-700 leading-5 mt-2">
            {place.description}
          </Text>
        ) : null}

        {/* ดาวรีวิว */}
        <View className="flex-row items-center mt-2.5">
          {place.rating != null ? (
            <Text className="text-[12px] font-bold text-amber-600">
              ⭐ {place.rating.toFixed(1)}
              {place.userRatingsTotal != null ? ` (${place.userRatingsTotal} รีวิว)` : ""}
            </Text>
          ) : (
            <Text className="text-[11.5px] text-gray-400">ยังไม่มีคะแนนรีวิว</Text>
          )}
          {place.priceLevel != null && place.priceLevel > 0 ? (
            <Text className="text-[12px] font-bold text-gray-600 ml-2.5">
              {"฿".repeat(Math.min(place.priceLevel, 4))}
            </Text>
          ) : null}
        </View>

        {/* ลิงก์: เพจ/เว็บไซต์ + แมพ */}
        <View className="flex-row items-center flex-wrap mt-3 pt-2.5 border-t border-gray-100">
          {place.website ? (
            <TouchableOpacity
              onPress={() => openLink(place.website)}
              activeOpacity={0.7}
              className="flex-row items-center bg-gray-100 px-2.5 py-1.5 rounded-full border border-gray-200 mr-2 mb-2"
            >
              <GlobeAltIcon size={12} color="#374151" />
              <Text className="text-[11px] font-bold text-gray-700 ml-1">เพจ/เว็บไซต์</Text>
              <View style={{ marginLeft: 3 }}>
                <ArrowTopRightOnSquareIcon size={11} color="#6B7280" />
              </View>
            </TouchableOpacity>
          ) : null}

          {place.googleMapsUrl ? (
            <TouchableOpacity
              onPress={() => openLink(place.googleMapsUrl)}
              activeOpacity={0.7}
              className="flex-row items-center bg-blue-50 px-2.5 py-1.5 rounded-full border border-blue-200 mb-2"
            >
              <MapPinIcon size={12} color="#1D4ED8" />
              <Text className="text-[11px] font-bold text-blue-700 ml-1">Google Maps</Text>
              <ArrowTopRightOnSquareIcon size={11} color="#1D4ED8" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}
