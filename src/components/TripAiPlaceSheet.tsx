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
  TruckIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
} from "react-native-heroicons/outline";
import {
  fetchNearbySuggestions,
  suggestTripPlaces,
  type NearbyPlace,
} from "../services/tripService";
import { TRAVEL_STYLES, type TravelStyle } from "../data/tripsData";
import { THAI_PROVINCES } from "./TripDestinationPickerModal";

/**
 * ชีต "เพิ่มสถานที่ด้วยเอไAI"
 * =============================================================
 * ใช้ในหน้า "สร้างแพลนเอง" — ผู้ใช้เลือกสถานที่เองได้ 3 ทาง:
 *
 *   A. ใกล้เคียง   → มีสถานที่ในแผน/โฟลเดอร์แล้ว → หารอบจุดที่เลือก
 *   B. ตามสไตล์     → ยังไม่มีสถานที่ → เลือกสไตล์ (+ จังหวัดถ้าอยากระบุ)
 *   C. ใกล้จุดที่เลือก → ติ๊กสถานที่แล้ว ≥1 → เดาจังหวัดจากจุดนั้น → หาใกล้เคียง
 *
 * ข้อมูลมาจาก API ที่มีอยู่แล้ว (`/trips/nearby`, `/trips/suggest-places`)
 * → ผู้ใช้ต้องกดเพิ่มเอง ระบบไม่เพิ่มให้เงียบ ๆ
 */

/** จุดอ้างอิงที่มีพิกัด (จุดเริ่มต้น + สถานที่ที่เลือกไว้ในแผน) */
export interface AiPlaceAnchor {
  label: string;
  coords: { lat: number; lng: number };
  address?: string | null;
  province?: string | null;
}

/** สถานที่ที่ผู้ใช้ติ๊กแล้วส่งกลับไปเพิ่มลงแผน */
export interface AiPickedPlace {
  name: string;
  address?: string | null;
  coords: { lat: number; lng: number };
  province?: string | null;
  /** registry = ยืนยันในทะเบียนของแอป · manual = มาจาก AI/Google */
  source: "registry" | "manual";
}

/** ผลลัพธ์ที่แสดงในชีต (รวมทั้งจากทะเบียนและจาก AI) */
interface ResultItem {
  id: string;
  name: string;
  address?: string | null;
  coords: { lat: number; lng: number };
  province?: string | null;
  distanceKm?: number | null;
  rating?: number | null;
  source: string;
}

/** ข้อความสไตล์ที่ส่งให้เอไAI — เขียนให้ตรงกับที่ปลายทางเข้าใจ */
const STYLE_TO_AI: Record<TravelStyle, string> = {
  nature: "ธรรมชาติ ภูเขา และวิวสวย จุดชมวิว อุทยานแห่งชาติ ป่าไม้ น้ำตก",
  slowlife: "พักผ่อน สบายๆ ไม่เร่งรีบ แคมป์ปิ้ง ริมน้ำ สปา วิถีสโลว์ไลฟ์ ชุมชน OTOP",
  culture: "วัด ประวัติศาสตร์ และวัฒนธรรม โบราณสถาน วัดสำคัญ วิถีชีวิตท้องถิ่น",
  foodie: "ตะลุยกิน สตรีทฟู้ด ร้านเด็ด ของกินขึ้นชื่อ ร้านมิชลิน ตลาดกลางคืน",
};

/** คำใบ้สำหรับจัดอันดับสถานที่ตามสไตล์ (คะแนนยิ่งมากยิ่งตรงสไตล์) */
const STYLE_KEYWORDS: Record<TravelStyle, string[]> = {
  nature: [
    "ธรรมชาติ", "อุทยาน", "น้ำตก", "ภูเขา", "ป่า", "สวน", "ทะเล", "สวนสัตว์",
    "เขา", "แม่น้ำ", "ทะเลสอบ", "จุดชมวิว", "ล่อง",
  ],
  slowlife: [
    "ชุมชน", "OTOP", "โฮมสเตย์", "รีสอร์ท", "คาเฟ่", "ตลาด", "งานฝีมือ",
    "พักผ่อน", "วิว", "ชา", "กาแฟ", "หมู่บ้าน",
  ],
  culture: [
    "วัด", "โบราณ", "ประวัติศาสตร์", "พิพิธภัณฑ์", "วัฒนธรรม", "ปราสาท",
    "ศาล", "ศาลา", "พระ", "เจดีย์", "ชุมชน", "หมู่บ้าน",
  ],
  foodie: [
    "อาหาร", "ร้าน", "ตลาด", "คาเฟ่", "กาแฟ", "ขนม", "ครัว", "รส",
    "ตลาดน้ำ", "ผลิตภัณฑ์", "ของฝาก",
  ],
};

/** ชื่อย่อที่คนใช้บ่อย → ชื่อจังหวัดเต็ม */
const PROVINCE_ALIASES: Record<string, string> = {
  "กรุงเทพฯ": "กรุงเทพมหานคร",
  "กรุงเทพ": "กรุงเทพมหานคร",
  "กระทบุรี": "กระบี่",
  "พระนครฯ": "พระนครศรีอยุธยา",
  "อยุธยา": "พระนครศรีอยุธยา",
  "เชียงใหม่": "เชียงใหม่",
  "สุราษฎร์": "สุราษฎร์ธานี",
};

/** รายชื่อจังหวัดเรียงจากยาวไปสั้น → เจอชื่อยาวก่อน (กัน "ธานี" ทับ "อุทัยธานี") */
const PROVINCES_BY_LENGTH = [...THAI_PROVINCES].sort(
  (a, b) => b.length - a.length
);

/**
 * เดาจังหวัดจากข้อความที่อยู่
 * (ผลจาก Google Places มักไม่มีฟิลด์ province → ต้องเดาจากที่อยู่)
 */
export function guessProvinceFromText(text?: string | null): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  for (const alias of Object.keys(PROVINCE_ALIASES)) {
    if (t.includes(alias)) return PROVINCE_ALIASES[alias];
  }
  for (const p of PROVINCES_BY_LENGTH) {
    if (t.includes(p)) return p;
  }
  return null;
}

/** คะแนนความเข้าสไตล์ (0 = ไม่เกี่ยว) */
function styleScore(item: ResultItem, style: TravelStyle): number {
  const hay = `${item.name} ${item.address ?? ""}`.toLowerCase();
  const keys = STYLE_KEYWORDS[style] ?? [];
  let score = 0;
  for (const k of keys) {
    if (hay.includes(k.toLowerCase())) score += 1;
  }
  return score;
}

/** แปลงผลจาก /trips/nearby → รูปแบบที่ชีตใช้ */
function fromNearby(p: NearbyPlace): ResultItem {
  return {
    id: `n-${p.id}`,
    name: p.name,
    address: p.address ?? null,
    coords: { lat: p.coordinates.lat, lng: p.coordinates.lng },
    province: p.province ?? guessProvinceFromText(p.address),
    distanceKm: p.distanceKm ?? null,
    rating: p.rating ?? null,
    source: p.source,
  };
}

export interface TripAiPlaceSheetProps {
  visible: boolean;
  onClose: () => void;
  /** จุดอ้างอิงที่มีพิกัด (จุดเริ่มต้น + สถานที่ที่เลือกไว้แล้ว) */
  anchors: AiPlaceAnchor[];
  /** สไตล์ที่เลือกไว้ในหน้าแพลน (ใช้เป็นค่าเริ่มต้น) */
  style?: TravelStyle;
  /** นำสถานที่ที่ติ๊กไว้กลับไปเพิ่มลงแผน */
  onAdd: (places: AiPickedPlace[]) => void;
}

export default function TripAiPlaceSheet({
  visible,
  onClose,
  anchors,
  style,
  onAdd,
}: TripAiPlaceSheetProps) {
  // "menu" = เลือกวิธี · "style" = เลือกสไตล์/จังหวัด · "results" = ดูผลลัพธ์
  const [mode, setMode] = useState<"menu" | "style" | "results">("menu");
  const [styleKey, setStyleKey] = useState<TravelStyle>(style ?? "slowlife");
  const [province, setProvince] = useState<string | null>(null);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // รีเซ็ตทุกครั้งที่เปิด (เลื่อนไป tick ถัดไป เพื่อไม่อัปเดต state ระหว่าง render)
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      setMode("menu");
      setStyleKey(style ?? "slowlife");
      setProvince(null);
      setResults([]);
      setSelectedIds([]);
      setError(null);
      setLoading(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [visible, style]);

  /** จุดอ้างอิงที่มีพิกัดจริง (ไม่มีพิกัดใช้เป็นจุดอ้างอิงไม่ได้) */
  const validAnchors = anchors.filter(
    (a) => a.coords && a.coords.lat !== 0 && a.coords.lng !== 0
  );

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  /**
   * หาสถานที่ใกล้เคียงรอบจุดอ้างอิง
   * (ไม่ห่อ useCallback — React Compiler จัดการ memo ให้เอง
   *  และ useCallback ที่ dep เป็นค่าที่คำนวณใหม่ทุก render จะโดนกฎ
   *  preserve-manual-memoization บ่น)
   */
  const searchNearby = async (
    anchor: AiPlaceAnchor,
    radiusKm: number,
    mergeMode: "replace" | "append"
  ) => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchNearbySuggestions({
        near: { label: anchor.label, coords: anchor.coords },
        radiusKm,
        limit: mergeMode === "append" ? 8 : 12,
        routePoints: validAnchors.map((a) => a.coords),
      });
      const items = list.map(fromNearby);
      setResults((prev) =>
        mergeMode === "append"
          ? [...prev, ...items.filter((i) => !prev.some((p) => p.name === i.name))]
          : items
      );
      setMode("results");
    } catch {
      setError("หาสถานที่ไม่สำเร็จ — ต่อเน็ตใหม่แล้วลองอีกครั้ง");
      if (mergeMode === "replace") setResults([]);
    } finally {
      setLoading(false);
    }
  };

  /** สาขา B: เลือกสไตล์ (+ จังหวัดถ้าอยากระบุ) → หาสถานที่ */
  const searchByStyle = async () => {
    setLoading(true);
    setError(null);
    try {
      if (province) {
        // ระบุจังหวัด → ให้ AI + Places แนะนำสถานที่ของจังหวัดนั้นตามสไตล์
        const list = await suggestTripPlaces({
          destination: province,
          style: STYLE_TO_AI[styleKey],
          count: 8,
        });
        const items: ResultItem[] = list
          .filter((p) => p.latitude != null && p.longitude != null)
          .map((p) => ({
            id: `s-${p.placeId || p.name}`,
            name: p.name,
            address: p.address || null,
            coords: { lat: p.latitude!, lng: p.longitude! },
            province: p.province ?? province,
            distanceKm: null,
            rating: p.rating ?? null,
            source: "ai",
          }));
        setResults(items);
      } else {
        // ไม่ระบุจังหวัด → หารอบจุดอ้างอิง (จุดเริ่มต้น/จุดที่เลือก) แล้วจัดอันดับตามสไตล์
        const anchor = validAnchors[0];
        if (!anchor) {
          setError(
            "เลือกจังหวัด หรือกลับไปเลือกจุดเริ่มต้นก่อน — ระบบต้องรู้จุดอ้างอิงถึงจะหาสถานที่ใกล้เคียงได้"
          );
          setResults([]);
          setLoading(false);
          return;
        }
        const list = await fetchNearbySuggestions({
          near: { label: anchor.label, coords: anchor.coords },
          radiusKm: 50,
          limit: 20,
          routePoints: validAnchors.map((a) => a.coords),
        });
        setResults(list.map(fromNearby));
      }
      setMode("results");
    } catch {
      setError("หาสถานที่ไม่สำเร็จ — ต่อเน็ตใหม่แล้วลองอีกครั้ง");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  /**
   * สาขา C: จุดที่ติ๊กไว้ → ดูว่าอยู่จังหวัดไหน → หาสถานที่ใกล้เคียงในจังหวัดเดียวกัน
   */
  const searchNearSelection = async () => {
    const picked = results.filter((r) => selectedIds.includes(r.id));
    const first = picked[0];
    if (!first) return;
    const prov = first.province ?? guessProvinceFromText(first.address);
    if (!prov) {
      setError(
        "เดาจังหวัดจากสถานที่ที่เลือกไม่ได้ — ลองเลือกจังหวัดเอง หรือเลือกสถานที่ที่มีชื่อจังหวัดในชื่อ"
      );
      return;
    }
    await searchNearby(
      { label: first.name, coords: first.coords, address: first.address, province: prov },
      30,
      "append"
    );
  };

  /** เรียงผลลัพธ์ให้ตรงสไตล์ก่อน แล้วค่อยตามระยะ */
  const sorted = [...results].sort((a, b) => {
    const sa = styleScore(a, styleKey);
    const sb = styleScore(b, styleKey);
    if (sa !== sb) return sb - sa;
    return (a.distanceKm ?? 999) - (b.distanceKm ?? 999);
  });

  const chosen = sorted.filter((r) => selectedIds.includes(r.id));

  const confirm = () => {
    if (chosen.length === 0) return;
    onAdd(
      chosen.map((r) => ({
        name: r.name,
        address: r.address ?? null,
        coords: r.coords,
        province: r.province ?? null,
        source: r.source === "registry" ? "registry" : "manual",
      }))
    );
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-end">
        <View className="bg-white rounded-t-3xl max-h-[90%] min-h-[520px] flex-col">
          {/* Header */}
          <View className="flex-row items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
            <View className="flex-row items-center flex-1">
              {mode !== "menu" ? (
                <TouchableOpacity
                  onPress={() => setMode(mode === "results" ? "style" : "menu")}
                  className="mr-3 p-1 rounded-full bg-gray-100"
                >
                  <ArrowPathIcon size={17} color="#374151" />
                </TouchableOpacity>
              ) : null}
              <Text className="text-[17px] font-bold text-gray-900">
                {mode === "menu"
                  ? "เพิ่มสถานที่ด้วย AI"
                  : mode === "style"
                  ? "เลือกสไตล์และจังหวัด"
                  : "สถานที่ที่ AI แนะนำ"}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} className="p-1 rounded-full bg-gray-100">
              <XMarkIcon size={20} color="#4B5563" />
            </TouchableOpacity>
          </View>

          {/* ── เลือกวิธี ─────────────────────────────────────────── */}
          {mode === "menu" ? (
            <ScrollView className="flex-1 px-5 pt-4" contentContainerStyle={{ paddingBottom: 30 }}>
              <TouchableOpacity
                onPress={() => {
                  const anchor = validAnchors[0];
                  if (!anchor) return;
                  void searchNearby(anchor, 30, "replace");
                }}
                disabled={validAnchors.length === 0}
                activeOpacity={0.85}
                className={`rounded-2xl border p-4 mb-3 ${
                  validAnchors.length === 0
                    ? "bg-gray-50 border-gray-200"
                    : "bg-violet-50 border-violet-200"
                }`}
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-xl bg-white items-center justify-center mr-3">
                    <MapPinIcon size={20} color={validAnchors.length === 0 ? "#9CA3AF" : "#7C3AED"} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[15px] font-bold text-gray-900">
                      ใกล้เคียงกับที่เลือก
                    </Text>
                    <Text className="text-[12px] text-gray-500 mt-0.5">
                      {validAnchors.length === 0
                        ? "ยังไม่มีสถานที่ที่มีพิกัด — เลือกจุดเริ่มต้นหรือเพิ่มสถานที่ก่อน"
                        : `หาสถานที่รอบ ${validAnchors[0].label} (รัศมี 30 กม.)`}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setMode("style")}
                activeOpacity={0.85}
                className="rounded-2xl border p-4 bg-emerald-50 border-emerald-200"
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-xl bg-white items-center justify-center mr-3">
                    <SparklesIcon size={20} color="#059669" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[15px] font-bold text-gray-900">
                      เลือกตามสไตล์
                    </Text>
                    <Text className="text-[12px] text-gray-500 mt-0.5">
                      เลือกสไตล์ที่ชอบ — จังหวัดไม่ระบุก็ได้ (ระบบจะหาจากจุดที่เลือก)
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              {loading ? (
                <View className="flex-row items-center justify-center py-6">
                  <ActivityIndicator color="#7C3AED" />
                  <Text className="text-[12.5px] text-gray-500 ml-2">กำลังหาสถานที่…</Text>
                </View>
              ) : null}
            </ScrollView>
          ) : null}

          {/* ── เลือกสไตล์ + จังหวัด ───────────────────────────────── */}
          {mode === "style" ? (
            <ScrollView className="flex-1 px-5 pt-4" contentContainerStyle={{ paddingBottom: 30 }}>
              <Text className="text-[13px] font-bold text-gray-900 mb-2">สไตล์ที่อยากไป</Text>
              <View className="flex-row flex-wrap mb-4">
                {TRAVEL_STYLES.map((s) => {
                  const active = styleKey === s.key;
                  return (
                    <TouchableOpacity
                      key={s.key}
                      onPress={() => setStyleKey(s.key)}
                      activeOpacity={0.8}
                      className={`mr-2 mb-2 px-3 py-2 rounded-full border ${
                        active
                          ? "bg-violet-600 border-violet-600"
                          : "bg-white border-gray-200"
                      }`}
                    >
                      <Text
                        className={`text-[12.5px] font-bold ${
                          active ? "text-white" : "text-gray-600"
                        }`}
                      >
                        {s.emoji} {s.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text className="text-[13px] font-bold text-gray-900 mb-1">
                จังหวัด (ไม่ระบุก็ได้)
              </Text>
              <Text className="text-[11.5px] text-gray-500 mb-2 leading-4">
                ถ้าไม่ระบุจังหวัด ระบบจะหาสถานที่รอบจุดที่เลือก แล้วจัดอันดับตามสไตล์ให้
              </Text>

              <View className="flex-row flex-wrap mb-4">
                <TouchableOpacity
                  onPress={() => setProvince(null)}
                  activeOpacity={0.8}
                  className={`mr-2 mb-2 px-3 py-2 rounded-full border ${
                    province === null
                      ? "bg-violet-600 border-violet-600"
                      : "bg-white border-gray-200"
                  }`}
                >
                  <Text
                    className={`text-[12.5px] font-bold ${
                      province === null ? "text-white" : "text-gray-600"
                    }`}
                  >
                    ไม่ระบุจังหวัด
                  </Text>
                </TouchableOpacity>
                {THAI_PROVINCES.map((p) => {
                  const active = province === p;
                  return (
                    <TouchableOpacity
                      key={p}
                      onPress={() => setProvince(p)}
                      activeOpacity={0.8}
                      className={`mr-2 mb-2 px-3 py-2 rounded-full border ${
                        active
                          ? "bg-violet-600 border-violet-600"
                          : "bg-white border-gray-200"
                      }`}
                    >
                      <Text
                        className={`text-[12.5px] font-bold ${
                          active ? "text-white" : "text-gray-600"
                        }`}
                      >
                        {p}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                onPress={() => void searchByStyle()}
                disabled={loading}
                activeOpacity={0.85}
                className={`rounded-xl py-3.5 items-center justify-center flex-row ${
                  loading ? "bg-gray-300" : "bg-violet-600"
                }`}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <SparklesIcon size={18} color="#FFFFFF" />
                )}
                <Text className="text-white font-bold text-[14.5px] ml-2">
                  {loading ? "กำลังค้นหา…" : "ค้นหาสถานที่ตามสไตล์"}
                </Text>
              </TouchableOpacity>

              {error ? (
                <View className="flex-row items-start mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                  <ExclamationTriangleIcon size={15} color="#B45309" />
                  <Text className="text-[12px] text-amber-800 ml-1.5 flex-1 leading-4">
                    {error}
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          ) : null}

          {/* ── ผลลัพธ์ ──────────────────────────────────────────── */}
          {mode === "results" ? (
            <View className="flex-1 px-4 pt-3">
              {loading ? (
                <View className="flex-1 items-center justify-center py-16">
                  <ActivityIndicator size="large" color="#7C3AED" />
                  <Text className="text-gray-800 font-bold text-[15px] mt-4">
                    กำลังหาสถานที่ใกล้เคียง...
                  </Text>
                  <Text className="text-gray-500 text-[12.5px] mt-1 text-center px-6">
                    ระบบกำลังดูรอบจุดที่เลือกและจัดอันดับตามสไตล์
                  </Text>
                </View>
              ) : sorted.length === 0 ? (
                <View className="flex-1 items-center justify-center py-16">
                  <Text className="text-gray-700 font-bold text-[14px]">ไม่พบสถานที่</Text>
                  <TouchableOpacity
                    onPress={() => setMode("style")}
                    className="mt-4 bg-gray-100 rounded-xl px-4 py-2"
                  >
                    <Text className="text-violet-700 font-bold text-[13px]">
                      ← ลองเปลี่ยนสไตล์หรือจังหวัด
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View className="flex-1">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-[12.5px] text-gray-500">
                      แตะที่กล่องเพื่อเลือก ({selectedIds.length}/{sorted.length})
                    </Text>
                    <TouchableOpacity
                      onPress={() =>
                        setSelectedIds(
                          selectedIds.length === sorted.length
                            ? []
                            : sorted.map((r) => r.id)
                        )
                      }
                    >
                      <Text className="text-[12px] font-bold text-violet-700">
                        {selectedIds.length === sorted.length
                          ? "ล้างทั้งหมด"
                          : "เลือกทั้งหมด"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 120 }}>
                    {sorted.map((r) => {
                      const isSelected = selectedIds.includes(r.id);
                      return (
                        <TouchableOpacity
                          key={r.id}
                          onPress={() => toggle(r.id)}
                          activeOpacity={0.85}
                          className={`mb-2.5 rounded-2xl border p-3.5 flex-row items-center ${
                            isSelected
                              ? "bg-violet-50 border-violet-400"
                              : "bg-white border-gray-200"
                          }`}
                        >
                          <View className="flex-1 mr-3">
                            <Text className="text-[14px] font-bold text-gray-900" numberOfLines={1}>
                              {r.name}
                            </Text>
                            {r.address ? (
                              <Text className="text-[11.5px] text-gray-500 mt-0.5" numberOfLines={2}>
                                {r.address}
                              </Text>
                            ) : null}
                            <View className="flex-row items-center flex-wrap mt-1.5">
                              {r.distanceKm != null ? (
                                <View className="flex-row items-center bg-white rounded-full px-2 py-0.5 mr-1.5 border border-gray-200">
                                  <TruckIcon size={11} color="#6B7280" />
                                  <Text className="text-[10.5px] text-gray-600 ml-1">
                                    {r.distanceKm.toFixed(1)} กม.
                                  </Text>
                                </View>
                              ) : null}
                              {r.province ? (
                                <View className="bg-emerald-50 rounded-full px-2 py-0.5 mr-1.5">
                                  <Text className="text-[10.5px] font-bold text-emerald-700">
                                    {r.province}
                                  </Text>
                                </View>
                              ) : null}
                              {r.rating ? (
                                <Text className="text-[10.5px] font-bold text-amber-600">
                                  ⭐ {r.rating.toFixed(1)}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                          <View
                            className={`w-6 h-6 rounded-full border items-center justify-center ${
                              isSelected
                                ? "bg-violet-600 border-violet-600"
                                : "border-gray-300"
                            }`}
                          >
                            {isSelected ? <CheckIcon size={13} color="#FFFFFF" /> : null}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {/* ปุ่มลอยด้านล่าง */}
                  <View className="absolute bottom-0 left-0 right-0 bg-white pt-2 border-t border-gray-100">
                    {/* สาขา C: ติ๊กแล้ว → หาสถานที่ใกล้จังหวัดเดียวกัน */}
                    {chosen.length > 0 ? (
                      <TouchableOpacity
                        onPress={() => void searchNearSelection()}
                        disabled={loading}
                        activeOpacity={0.85}
                        className="mb-2 flex-row items-center justify-center py-2.5 rounded-xl border border-violet-200 bg-violet-50"
                      >
                        <MapPinIcon size={15} color="#7C3AED" />
                        <Text className="text-violet-700 font-bold text-[12.5px] ml-1.5">
                          หาใกล้เคียงในจังหวัดเดียวกับที่เลือก
                        </Text>
                      </TouchableOpacity>
                    ) : null}

                    {error ? (
                      <Text className="text-[11.5px] text-amber-700 mb-2">{error}</Text>
                    ) : null}

                    <TouchableOpacity
                      onPress={confirm}
                      disabled={chosen.length === 0}
                      activeOpacity={0.85}
                      className={`rounded-xl py-3.5 items-center justify-center flex-row ${
                        chosen.length > 0 ? "bg-violet-600" : "bg-gray-300"
                      }`}
                    >
                      <SparklesIcon size={18} color="#FFFFFF" />
                      <Text className="text-white font-bold text-[14px] ml-2">
                        เพิ่มลงแผน ({chosen.length} แห่ง)
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
