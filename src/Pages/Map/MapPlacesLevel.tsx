import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  VideoCameraIcon,
  SparklesIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
} from "react-native-heroicons/outline";
import { CheckCircleIcon as CheckCircleSolid } from "react-native-heroicons/solid";
import { DistrictItem, PlaceItem } from "../../data/thailandGeographicData";
import {
  communitySourceLabel,
  fetchDistrictPlaces,
  type CommunityPlaceRow,
} from "../../services/communityService";
import ThailandMapSvg from "./ThailandMapSvg";

interface MapPlacesLevelProps {
  district: DistrictItem;
  places: PlaceItem[];
  onToggleVisitPlace: (placeId: string) => void;
  onViewPlaceVideo?: (place: PlaceItem) => void;
  onViewAllInDistrict: () => void;
  onBack: () => void;
}

type CategoryFilter = "ทั้งหมด" | "ชุมชนท่องเที่ยว OTOP นวัตวิถี" | "ชุมชน OTOP เพื่อการท่องเที่ยว" | "หมู่บ้านท่องเที่ยวโดยชุมชน";

/** ชั้นบนแผนที่ — ชุมชน OTOP หรือสถานที่ที่ยืนยันแล้ว (PLAN §7.2) */
type MapLayer = "community" | "place";

export default function MapPlacesLevel({
  district,
  places,
  onToggleVisitPlace,
  onViewPlaceVideo,
  onViewAllInDistrict,
  onBack,
}: MapPlacesLevelProps) {
  const insets = useSafeAreaInsets();
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>("ทั้งหมด");
  const [searchQuery, setSearchQuery] = useState("");
  const [layer, setLayer] = useState<MapLayer>("community");

  // ── ชั้นหมุดระดับสถานที่ (D20) ─────────────────────────────────
  // สถานที่ที่ยืนยันแล้วในอำเภอนี้ มาจาก `community_places` (ผ่าน backend)
  // key ใช้บอกว่าเป็นผลของอำเภอไหน — ถ้าไม่ตรง = ยังโหลดไม่เสร็จ
  const placeKey = `${district.provinceName}|${district.name}`;
  const [placeLayer, setPlaceLayer] = useState<{
    key: string;
    rows: CommunityPlaceRow[];
  }>({ key: "", rows: [] });

  useEffect(() => {
    if (layer !== "place") return;
    let active = true;
    fetchDistrictPlaces(district.provinceName, district.name).then((rows) => {
      if (!active) return;
      setPlaceLayer({ key: placeKey, rows });
    });
    return () => {
      active = false;
    };
  }, [layer, placeKey, district.provinceName, district.name]);

  const placeLoading = layer === "place" && placeLayer.key !== placeKey;
  const registeredPlaces = placeLayer.key === placeKey ? placeLayer.rows : [];

  const visitedCount = places.filter((p) => p.isVisited).length;
  const totalCount = places.length;

  // Filter places by category tab and search query
  const filteredPlaces = places.filter((p) => {
    const matchesCat =
      selectedCategory === "ทั้งหมด" || p.category === selectedCategory;
    const matchesQuery =
      searchQuery.trim() === "" ||
      p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
      p.subdistrict.toLowerCase().includes(searchQuery.trim().toLowerCase());
    return matchesCat && matchesQuery;
  });

  // ชั้นสถานที่: กรองด้วยคำค้นอย่างเดียว (ไม่มีหมวดหมู่ OTOP)
  const filteredRegistered = registeredPlaces.filter((p) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      (p.place_name ?? "").toLowerCase().includes(q) ||
      (p.formatted_address ?? "").toLowerCase().includes(q)
    );
  });

  // Count by category for filter tabs
  const countNavatwithi = places.filter((p) => p.category === "ชุมชนท่องเที่ยว OTOP นวัตวิถี").length;
  const countOtopTourism = places.filter((p) => p.category === "ชุมชน OTOP เพื่อการท่องเที่ยว").length;
  const countCbt = places.filter((p) => p.category === "หมู่บ้านท่องเที่ยวโดยชุมชน").length;

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 16) + 10,
          paddingBottom: Math.max(insets.bottom, 20) + 90,
          paddingHorizontal: 20,
        }}
      >
        {/* 1. Header Back Button */}
        <TouchableOpacity
          onPress={onBack}
          activeOpacity={0.7}
          className="flex-row items-center self-start mb-4"
        >
          <ArrowLeftIcon size={20} color="#2D6A4F" strokeWidth={2.5} />
          <Text className="text-[#2D6A4F] text-base font-bold ml-2">
            ย้อนกลับไประดับอำเภอ
          </Text>
        </TouchableOpacity>

        {/* 2. Main Title: ระดับสถานที่ 0/XX แห่ง */}
        <View className="items-center mb-4">
          <Text className="text-xs font-bold text-gray-400 tracking-wider uppercase mb-1">
            ระดับที่ 4 • สถานที่ท่องเที่ยวในอำเภอ ({district.provinceName} • อ.{district.name})
          </Text>
          <Text className="text-2xl font-black text-gray-900 tracking-tight text-center">
            อำเภอ{district.name}{" "}
            <Text className="text-[#00D26A] font-extrabold">
              {visitedCount}/{totalCount}
            </Text>{" "}
            แห่ง
          </Text>
          <Text className="text-xs text-gray-500 mt-1">
            {district.regionName} ➔ จังหวัด{district.provinceName} ➔ อำเภอ{district.name}
          </Text>
        </View>

        {/* 2.5 Toggle ชั้นข้อมูล: ชุมชน OTOP / สถานที่ที่ยืนยันแล้ว (PLAN §7.2) */}
        <View className="flex-row bg-gray-100 rounded-full p-1 mb-4 self-stretch">
          <TouchableOpacity
            onPress={() => setLayer("community")}
            activeOpacity={0.8}
            className={`flex-1 py-2 rounded-full items-center justify-center flex-row ${
              layer === "community" ? "bg-white shadow-sm" : ""
            }`}
          >
            <Text
              className={`text-[12.5px] font-bold ${
                layer === "community" ? "text-gray-900" : "text-gray-500"
              }`}
            >
              🏘️ ชุมชน ({totalCount})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setLayer("place")}
            activeOpacity={0.8}
            className={`flex-1 py-2 rounded-full items-center justify-center flex-row ${
              layer === "place" ? "bg-white shadow-sm" : ""
            }`}
          >
            <Text
              className={`text-[12.5px] font-bold ${
                layer === "place" ? "text-gray-900" : "text-gray-500"
              }`}
            >
              📍 สถานที่ ({placeLoading ? "…" : registeredPlaces.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* 2.6 Map Graphic Zoomed into Province for Places Context */}
        <View className="items-center justify-center my-1 bg-gray-50/70 py-3 rounded-3xl border border-gray-100 overflow-hidden">
          <ThailandMapSvg
            width={300}
            height={400}
            viewLevel="places"
            selectedProvinceName={district.provinceName}
            selectedDistrictName={district.name}
            places={
              layer === "place"
                ? filteredRegistered.map((p) => ({
                    id: p.place_id,
                    name: p.place_name,
                    subdistrict: p.subdistrict ?? "",
                    kind: "registered",
                    row: p,
                  }))
                : filteredPlaces
            }
            onPressPlace={(place) => {
              if (place?.kind === "registered") {
                const url = place.row?.google_maps_url;
                if (url) void Linking.openURL(url);
                return;
              }
              onViewPlaceVideo?.(place);
            }}
          />
          <Text className="text-gray-400 text-[11px] mt-1 text-center font-medium">
            {layer === "place"
              ? "หมุดเขียว = สถานที่ที่ยืนยันแล้วในอำเภอนี้ (แตะเพื่อเปิด Google Maps)"
              : "แตะหมุดหรือชื่อสถานที่เพื่อเปิดชมวิดีโอ • ใช้สองนิ้วซูมเข้า–ออก ลากเพื่อเลื่อน • แตะสองครั้งเพื่อรีเซ็ต"}
          </Text>
        </View>

        {/* 3. Stamp & Review Mission Notice Banner */}
        <View className="bg-emerald-50 border border-[#00D26A]/30 rounded-2xl p-3.5 mb-4 flex-row items-center">
          <SparklesIcon size={22} color="#2D6A4F" />
          <Text className="text-xs text-gray-700 ml-2.5 flex-1 leading-5">
            เกณฑ์ปลดล็อกตราประทับ: จะได้เครื่องหมาย{" "}
            <Text className="font-bold text-[#2D6A4F]">ติ๊กถูก (✓)</Text>{" "}
            เมื่อท่านได้{" "}
            <Text className="font-bold text-[#D47A3A]">
              ลงคลิปรีวิวและปักหมุด
            </Text>{" "}
            ในสถานที่นั้นๆ
          </Text>
        </View>

        {/* 4. Search Bar */}
        <View className="flex-row items-center bg-gray-100 rounded-2xl px-3.5 py-2.5 mb-3 border border-gray-200">
          <MagnifyingGlassIcon size={18} color="#9CA3AF" />
          <TextInput
            placeholder={
              layer === "place"
                ? `ค้นหาสถานที่ที่ยืนยันแล้วใน อ.${district.name}...`
                : `ค้นหาชุมชนใน อ.${district.name}...`
            }
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
            className="flex-1 ml-2.5 text-sm text-gray-900 py-0"
          />
        </View>

        {/* 5. The 3 OTOP Categories Tabs Filter — เฉพาะชั้น "ชุมชน" (ชั้นสถานที่ไม่มีหมวด OTOP) */}
        {layer === "community" && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mb-4 -mx-1"
          contentContainerStyle={{ paddingHorizontal: 2 }}
        >
          <TouchableOpacity
            onPress={() => setSelectedCategory("ทั้งหมด")}
            activeOpacity={0.7}
            className={`mr-2 px-3.5 py-2 rounded-xl border ${
              selectedCategory === "ทั้งหมด"
                ? "bg-[#2D6A4F] border-[#2D6A4F]"
                : "bg-gray-100 border-gray-200"
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                selectedCategory === "ทั้งหมด" ? "text-white" : "text-gray-700"
              }`}
            >
              ทั้งหมด ({totalCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setSelectedCategory("ชุมชนท่องเที่ยว OTOP นวัตวิถี")}
            activeOpacity={0.7}
            className={`mr-2 px-3.5 py-2 rounded-xl border ${
              selectedCategory === "ชุมชนท่องเที่ยว OTOP นวัตวิถี"
                ? "bg-[#D47A3A] border-[#D47A3A]"
                : "bg-gray-100 border-gray-200"
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                selectedCategory === "ชุมชนท่องเที่ยว OTOP นวัตวิถี"
                  ? "text-white"
                  : "text-gray-700"
              }`}
            >
              1. นวัตวิถี ({countNavatwithi})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setSelectedCategory("ชุมชน OTOP เพื่อการท่องเที่ยว")}
            activeOpacity={0.7}
            className={`mr-2 px-3.5 py-2 rounded-xl border ${
              selectedCategory === "ชุมชน OTOP เพื่อการท่องเที่ยว"
                ? "bg-[#2563EB] border-[#2563EB]"
                : "bg-gray-100 border-gray-200"
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                selectedCategory === "ชุมชน OTOP เพื่อการท่องเที่ยว"
                  ? "text-white"
                  : "text-gray-700"
              }`}
            >
              2. เพื่อการท่องเที่ยว ({countOtopTourism})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setSelectedCategory("หมู่บ้านท่องเที่ยวโดยชุมชน")}
            activeOpacity={0.7}
            className={`mr-2 px-3.5 py-2 rounded-xl border ${
              selectedCategory === "หมู่บ้านท่องเที่ยวโดยชุมชน"
                ? "bg-[#7C3AED] border-[#7C3AED]"
                : "bg-gray-100 border-gray-200"
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                selectedCategory === "หมู่บ้านท่องเที่ยวโดยชุมชน"
                  ? "text-white"
                  : "text-gray-700"
              }`}
            >
              3. โดยชุมชน ({countCbt})
            </Text>
          </TouchableOpacity>
        </ScrollView>
        )}

        {/* 6. Places List strictly for this District */}
        {layer === "place" ? (
          /* ── ชั้นสถานที่: สถานที่ที่ยืนยันแล้วในอำเภอ (D20) ── */
          <View className="space-y-3.5 mb-5">
            {placeLoading ? (
              <View className="py-12 items-center justify-center">
                <ActivityIndicator size="large" color="#2D6A4F" />
                <Text className="text-gray-400 text-sm mt-3">
                  กำลังโหลดสถานที่ที่ยืนยันแล้วในอำเภอ{district.name}...
                </Text>
              </View>
            ) : filteredRegistered.length > 0 ? (
              filteredRegistered.map((p) => (
                <View
                  key={`${p.place_id}-${p.id}`}
                  className="bg-white border border-gray-200/90 rounded-2xl p-4 shadow-sm"
                >
                  <View className="flex-row items-start justify-between mb-1.5">
                    <View className="flex-1 mr-2">
                      <Text className="text-base font-bold text-gray-900 leading-snug">
                        {p.place_name}
                      </Text>
                      {p.formatted_address ? (
                        <Text className="text-xs text-gray-500 mt-0.5">
                          {p.formatted_address}
                        </Text>
                      ) : (
                        <Text className="text-xs text-gray-500 mt-0.5">
                          {[p.subdistrict, p.district, p.province]
                            .filter(Boolean)
                            .join(" • ") || "ไม่ระบุที่ตั้ง"}
                        </Text>
                      )}
                    </View>
                    <View className="bg-emerald-100 px-2.5 py-0.5 rounded-full">
                      <Text className="text-[10px] font-bold text-emerald-800">
                        {communitySourceLabel(p.source)}
                      </Text>
                    </View>
                  </View>

                  {(p.price_info || p.price_level) && (
                    <Text className="text-xs text-gray-600 mb-1">
                      💰{" "}
                      {p.price_info ||
                        "ราคา: " + "฿".repeat(Math.max(1, Number(p.price_level) || 1))}
                    </Text>
                  )}
                  {p.opening_hours ? (
                    <Text className="text-xs text-gray-600 mb-1">
                      🕒 {p.opening_hours}
                    </Text>
                  ) : null}
                  {p.phone ? (
                    <Text className="text-xs text-gray-600 mb-1">📞 {p.phone}</Text>
                  ) : null}
                  {p.website ? (
                    <Text className="text-xs text-gray-600 mb-1">
                      🌐 {p.website}
                    </Text>
                  ) : null}

                  {p.google_maps_url ? (
                    <TouchableOpacity
                      onPress={() => void Linking.openURL(p.google_maps_url as string)}
                      activeOpacity={0.8}
                      className="flex-row items-center bg-[#266348] px-3 py-2 rounded-xl mt-2 self-start"
                    >
                      <MapPinIcon size={14} color="#FFFFFF" />
                      <Text className="text-[11px] font-bold text-white ml-1">
                        เปิดใน Google Maps
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))
            ) : (
              <View className="py-12 items-center justify-center">
                <Text className="text-gray-400 text-sm text-center px-6">
                  ยังไม่มีสถานที่ที่ยืนยันแล้วในอำเภอ{district.name}
                </Text>
                <Text className="text-gray-400 text-xs text-center px-6 mt-1">
                  สถานที่จะปรากฏหลังจากมีผู้ใช้ยืนยันจากคลิป หรือเจ้าของชุมชนเพิ่มข้อมูล
                </Text>
              </View>
            )}
          </View>
        ) : (
        <View className="space-y-3.5 mb-5">
          {filteredPlaces.length > 0 ? (
            filteredPlaces.map((place) => {
              // Color style for each category badge
              let badgeBg = "bg-amber-100";
              let badgeText = "text-amber-800";
              if (place.category === "ชุมชน OTOP เพื่อการท่องเที่ยว") {
                badgeBg = "bg-blue-100";
                badgeText = "text-blue-800";
              } else if (place.category === "หมู่บ้านท่องเที่ยวโดยชุมชน") {
                badgeBg = "bg-purple-100";
                badgeText = "text-purple-800";
              }

              return (
                <View
                  key={place.id}
                  className="bg-white border border-gray-200/90 rounded-2xl p-4 shadow-sm mb-3"
                >
                  {/* Title and Checkbox status */}
                  <View className="flex-row items-start justify-between mb-1.5">
                    <View className="flex-1 mr-2">
                      <Text className="text-base font-bold text-gray-900 leading-snug">
                        {place.name}
                      </Text>
                      <Text className="text-xs text-gray-500 mt-0.5">
                        {place.subdistrict}
                      </Text>
                    </View>

                    {/* Toggle Review / Visited Stamp Button */}
                    <TouchableOpacity
                      onPress={() => onToggleVisitPlace(place.id)}
                      activeOpacity={0.7}
                      className="items-center p-1"
                    >
                      {place.isVisited ? (
                        <CheckCircleSolid size={28} color="#00D26A" />
                      ) : (
                        <CheckCircleIcon size={28} color="#D1D5DB" />
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Category Badge & Review Clip count */}
                  <View className="flex-row items-center my-1.5 flex-wrap">
                    <View className={`${badgeBg} px-2.5 py-0.5 rounded-full mr-2`}>
                      <Text className={`text-[10px] font-bold ${badgeText}`}>
                        {place.category}
                      </Text>
                    </View>
                    <Text className="text-[11px] text-gray-400 font-medium">
                      {place.reviewClipCount} คลิปรีวิว
                    </Text>
                  </View>

                  {/* Cultural Highlight */}
                  <Text className="text-xs text-gray-600 leading-4 mb-3">
                    {place.highlight}
                  </Text>

                  {/* Status Indicator Bar */}
                  <View className="flex-row items-center justify-between pt-2.5 border-t border-gray-100">
                    <TouchableOpacity
                      onPress={() => onToggleVisitPlace(place.id)}
                      activeOpacity={0.8}
                      className="flex-row items-center flex-1 mr-2"
                    >
                      <Text
                        className={`text-[11px] font-semibold ${
                          place.isVisited ? "text-[#00D26A]" : "text-gray-400"
                        }`}
                      >
                        {place.isVisited
                          ? "✓ รีวิวและปักหมุดแล้ว (ปลดล็อกตราปั๊ม)"
                          : "○ ยังไม่ได้รีวิว (แตะเพื่อบันทึกรีวิว)"}
                      </Text>
                    </TouchableOpacity>

                    {/* Watch Video Clips Button */}
                    <TouchableOpacity
                      onPress={() => onViewPlaceVideo?.(place)}
                      activeOpacity={0.8}
                      className="flex-row items-center bg-gray-100 px-3 py-1.5 rounded-xl"
                    >
                      <VideoCameraIcon size={14} color="#2D6A4F" />
                      <Text className="text-[11px] font-bold text-[#2D6A4F] ml-1">
                        ดูคลิป
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          ) : (
            <View className="py-12 items-center justify-center">
              <Text className="text-gray-400 text-sm">
                ไม่พบสถานที่ในหมวดหมู่นี้ในอำเภอ{district.name}
              </Text>
            </View>
          )}
        </View>
        )}

        {/* 7. Action Button: [ เลือกดูทั้งหมดในอำเภอนี้ ] — เฉพาะชั้นชุมชน */}
        {layer === "community" && (
        <TouchableOpacity
          onPress={onViewAllInDistrict}
          activeOpacity={0.85}
          className="bg-[#266348] py-4 rounded-2xl items-center justify-center mt-2 shadow-md shadow-emerald-950/20"
        >
          <Text className="text-white text-base font-bold tracking-wide">
            เลือกดูทั้งหมดในอำเภอ{district.name}
          </Text>
        </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}
