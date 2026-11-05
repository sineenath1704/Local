import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, Linking, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import {
  MapPinIcon,
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
} from "react-native-heroicons/outline";

/**
 * แผนที่เส้นทางจริงของแผนทริป (expo-maps)
 * =============================================================
 * · iOS  → Apple Maps (ไม่ต้องใช้ key)
 * · Android → Google Maps (ต้องเปิด Maps SDK for Android ใน Google Cloud)
 *
 * ต้องใช้ dev build — ถ้ารันใน Expo Go จะไม่มี native module
 * → แสดง "แผนที่สำรอง" (รายการจุด + ปุ่มเปิดใน Google Maps) แทน ไม่ crash
 *
 * หมายเหตุ: expo-maps จะเรียก requireNativeModule ตอน import
 * → ต้องโหลดแบบ lazy (require ใน try/catch) ไม่ใช่ import ที่บนสุดไฟล์
 */

/** จุดที่เอาไปวางหมุดบนแผนที่ */
export interface RouteMapStop {
  id: string;
  name: string;
  coords?: { lat: number; lng: number } | null;
}

/** ขาเส้นทาง (geometry มาจาก OSRM หรือค่าประมาณ) */
export interface RouteMapLeg {
  km?: number;
  minutes?: number;
  source?: string;
  geometry?: { lat: number; lng: number }[] | null;
}

export interface TripRouteMapProps {
  startPoint?: { label: string; coords?: { lat: number; lng: number } | null } | null;
  endPoint?: { label: string; coords?: { lat: number; lng: number } | null } | null;
  returnMode?: "same_as_start" | "custom";
  stops?: RouteMapStop[];
  legs?: RouteMapLeg[];
  height?: number;
  /** แตะหมุด/แตะรายการ → เลือกจุดนั้น */
  onSelectStop?: (stopId: string) => void;
  selectedStopId?: string | null;
  /** ที่มาของข้อมูลเส้นทาง (osrm = เส้นทางจริง · estimate = ประมาณ) */
  routeSource?: string;
  routeCredit?: string;
}

// ─────────────────────────────────────────────────────────────────────────
//  ตัวช่วยคำนวณกล้อง (expo-maps ไม่มี fitToCoordinates → ต้องคำนวณเอง)
// ─────────────────────────────────────────────────────────────────────────

const TILE_SIZE = 256;
const EARTH_CIRCUMFERENCE_M = 40075016.686;

function fitCamera(
  coords: { lat: number; lng: number }[],
  width: number,
  height: number,
  padding = 44
) {
  if (!coords.length || width <= 0 || height <= 0) return undefined;
  const lats = coords.map((c) => c.lat);
  const lngs = coords.map((c) => c.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  const latSpanM = Math.max((maxLat - minLat) * 111320, 50);
  const lngSpanM = Math.max(
    (maxLng - minLng) * 111320 * Math.cos((centerLat * Math.PI) / 180),
    50
  );

  const usableW = Math.max(width - padding * 2, 40);
  const usableH = Math.max(height - padding * 2, 40);
  const metersPerPixelAtZoom0 = EARTH_CIRCUMFERENCE_M / TILE_SIZE;

  const zoomX = Math.log2((metersPerPixelAtZoom0 * usableW) / lngSpanM);
  const zoomY = Math.log2((metersPerPixelAtZoom0 * usableH) / latSpanM);
  const zoom = Math.min(15, Math.max(8, Math.min(zoomX, zoomY)));

  return {
    coordinates: { latitude: centerLat, longitude: centerLng },
    zoom,
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  Error boundary — ถ้า native module พังหลังอัปเดต ให้แสดงแผนที่สำรอง
//  แทนที่จะ crash ทั้งแอป
// ─────────────────────────────────────────────────────────────────────────

class MapErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: any) {
    console.warn("[TripRouteMap] แผนที่แสดงไม่ได้:", error?.message ?? error);
  }
  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  ส่วนประกอบหลัก
// ─────────────────────────────────────────────────────────────────────────

/**
 * ค่าว่างที่คงที่เสมอ
 * ถ้าใช้ `[]` เป็นค่าเริ่มต้นตรงๆ จะได้ array ใหม่ทุกครั้งที่ re-render
 * → memo ข้างในถูก invalidate ทุกครั้ง → แผนที่ native โหลด marker/polyline ใหม่
 * → แอปค้างตอนผู้ใช้กดแก้ข้อมูลในแชท
 */
const NO_STOPS: RouteMapStop[] = [];
const NO_LEGS: RouteMapLeg[] = [];

function TripRouteMap({
  startPoint,
  endPoint,
  returnMode = "same_as_start",
  stops = NO_STOPS,
  legs = NO_LEGS,
  height = 240,
  onSelectStop,
  selectedStopId,
  routeSource,
  routeCredit,
}: TripRouteMapProps) {
  const [layout, setLayout] = useState({ width: 0, height });

  /** expo-maps มี native module ไหม (null = รันใน Expo Go) */
  const mapsAvailable = useMemo(() => {
    try {
      return requireOptionalNativeModule("ExpoMaps") != null;
    } catch {
      return false;
    }
  }, []);

  /** โหลด component ของแผนที่แบบ lazy — import ที่บนสุดไฟล์จะ throw ใน Expo Go */
  const MapComponent = useMemo((): React.ComponentType<any> | null => {
    if (!mapsAvailable) return null;
    try {
      // โหลดแบบ lazy เพราะ import ที่บนสุดไฟล์จะ throw ตอนรันใน Expo Go
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const maps = require("expo-maps");
      return Platform.OS === "ios" ? maps.AppleMaps.View : maps.GoogleMaps.View;
    } catch (e: any) {
      console.warn("[TripRouteMap] โหลด expo-maps ไม่ได้:", e?.message ?? e);
      return null;
    }
  }, [mapsAvailable]);

  const startCoords = startPoint?.coords ?? null;
  const endCoords = endPoint?.coords ?? null;
  const stopList = useMemo(
    () =>
      stops.filter(
        (s) =>
          s.coords &&
          Number.isFinite(s.coords.lat) &&
          Number.isFinite(s.coords.lng)
      ),
    [stops]
  );

  /** หมุดทั้งหมด: A (จุดเริ่ม) → 1..n (จุดแวะ) → B (จุดสิ้นสุด) */
  const markers = useMemo(() => {
    const list: any[] = [];
    if (startCoords) {
      list.push({
        id: "__start",
        coordinates: { latitude: startCoords.lat, longitude: startCoords.lng },
        title: `A · ${startPoint?.label ?? "จุดเริ่มต้น"}`,
        ...(Platform.OS === "ios" ? { tintColor: "#2563EB" } : { zIndex: 90 }),
      });
    }
    stopList.forEach((s, i) => {
      list.push({
        id: s.id,
        coordinates: { latitude: s.coords!.lat, longitude: s.coords!.lng },
        title: `${i + 1} · ${s.name}`,
        ...(Platform.OS === "ios" ? { tintColor: "#7C3AED" } : { zIndex: 50 }),
      });
    });
    if (endCoords) {
      list.push({
        id: "__end",
        coordinates: { latitude: endCoords.lat, longitude: endCoords.lng },
        title: `B · ${endPoint?.label ?? "จุดสิ้นสุด"}`,
        ...(Platform.OS === "ios" ? { tintColor: "#DC2626" } : { zIndex: 90 }),
      });
    }
    return list;
  }, [startCoords, endCoords, startPoint?.label, endPoint?.label, stopList]);

  /** เส้นทาง (เส้นต่อขา) */
  const polylines = useMemo(() => {
    const list: any[] = [];
    legs.forEach((leg, i) => {
      const geom = (leg.geometry ?? []).filter(
        (p) =>
          p &&
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lng)
      );
      if (geom.length < 2) return;
      list.push({
        id: `leg-${i}`,
        coordinates: geom.map((p) => ({
          latitude: p.lat,
          longitude: p.lng,
        })),
        color: "#2563EB",
        width: 5,
      });
    });
    return list;
  }, [legs]);

  /** กล้อง — คำนวณจากทุกจุดบนเส้นทาง */
  const camera = useMemo(() => {
    const all: { lat: number; lng: number }[] = [];
    if (startCoords) all.push(startCoords);
    all.push(...stopList.map((s) => s.coords!));
    if (endCoords) all.push(endCoords);
    return fitCamera(all, layout.width, layout.height);
  }, [startCoords, endCoords, stopList, layout.width, layout.height]);

  /** ลิงก์เปิดใน Google Maps (เส้นทางจริงของ Google — ผู้ใช้คุ้นเคย) */
  const openInGoogleMaps = () => {
    const points: { lat: number; lng: number }[] = [];
    if (startCoords) points.push(startCoords);
    points.push(...stopList.map((s) => s.coords!));
    if (endCoords) points.push(endCoords);
    if (!points.length) return;
    const fmt = (p: { lat: number; lng: number }) => `${p.lat},${p.lng}`;
    const origin = fmt(points[0]);
    const destination = fmt(points[points.length - 1]);
    const waypoints = points.slice(1, -1).map(fmt).join("|");
    const url =
      `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}` +
      `&destination=${encodeURIComponent(destination)}` +
      (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "") +
      `&travelmode=driving`;
    Linking.openURL(url).catch(() => undefined);
  };

  /** แผนที่สำรอง — ใช้เมื่อไม่มี native module หรือแผนที่พัง */
  const fallback = (
    <View className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden">
      <View className="flex-row items-center px-3.5 py-2.5 bg-amber-50 border-b border-amber-100">
        <ExclamationTriangleIcon size={15} color="#B45309" />
        <Text className="text-amber-800 text-[11.5px] font-bold ml-1.5 flex-1">
          แผนที่สดต้องใช้ dev build — ตอนนี้แสดงลำดับจุดแวะแทน
        </Text>
      </View>
      <View className="px-3.5 py-2">
        {startCoords ? (
          <View className="flex-row items-center py-1">
            <View className="w-5 h-5 rounded-full bg-blue-600 items-center justify-center">
              <Text className="text-white text-[10px] font-black">A</Text>
            </View>
            <Text className="text-[12.5px] text-gray-800 ml-2 flex-1" numberOfLines={1}>
              {startPoint?.label ?? "จุดเริ่มต้น"}
            </Text>
          </View>
        ) : null}
        {stopList.map((s, i) => (
          <TouchableOpacity
            key={s.id}
            onPress={() => onSelectStop?.(s.id)}
            activeOpacity={0.7}
            className="flex-row items-center py-1"
          >
            <View
              className={`w-5 h-5 rounded-full items-center justify-center ${
                selectedStopId === s.id ? "bg-violet-600" : "bg-violet-100"
              }`}
            >
              <Text
                className={`text-[10px] font-black ${
                  selectedStopId === s.id ? "text-white" : "text-violet-700"
                }`}
              >
                {i + 1}
              </Text>
            </View>
            <Text className="text-[12.5px] text-gray-800 ml-2 flex-1" numberOfLines={1}>
              {s.name}
            </Text>
          </TouchableOpacity>
        ))}
        {endCoords ? (
          <View className="flex-row items-center py-1">
            <View className="w-5 h-5 rounded-full bg-red-600 items-center justify-center">
              <Text className="text-white text-[10px] font-black">B</Text>
            </View>
            <Text className="text-[12.5px] text-gray-800 ml-2 flex-1" numberOfLines={1}>
              {endPoint?.label ?? "จุดสิ้นสุด"}
            </Text>
          </View>
        ) : null}
        {!stopList.length && !startCoords && !endCoords ? (
          <Text className="text-gray-500 text-[12px] py-2">
            ยังไม่มีจุดที่มีพิกัดสำหรับวาดเส้นทาง
          </Text>
        ) : null}
      </View>
    </View>
  );

  const showMap = MapComponent && camera;

  return (
    <View>
      <View
        onLayout={(e) =>
          setLayout({ width: e.nativeEvent.layout.width, height })
        }
        style={{ height, borderRadius: 18, overflow: "hidden" }}
        className="bg-gray-100"
      >
        {showMap ? (
          <MapErrorBoundary fallback={fallback}>
            <MapComponent
              style={{ flex: 1 }}
              cameraPosition={camera}
              markers={markers}
              polylines={polylines}
              {...(Platform.OS === "ios"
                ? {
                    properties: { selectionEnabled: true },
                    uiSettings: { compassEnabled: false, scaleBarEnabled: true },
                  }
                : {
                    properties: { selectionEnabled: true },
                    uiSettings: { compassEnabled: false, zoomControlsEnabled: false },
                  })}
              onMarkerClick={(e: any) => {
                const id = e?.id ?? e?.nativeEvent?.id;
                if (id && id !== "__start" && id !== "__end") onSelectStop?.(id);
              }}
            />
          </MapErrorBoundary>
        ) : (
          <View className="flex-1 items-center justify-center px-4">
            <MapPinIcon size={26} color="#9CA3AF" />
            <Text className="text-gray-500 text-[12px] text-center mt-2 leading-5">
              แผนที่ต้องใช้ dev build (มีโมดูล expo-maps)
              {"\n"}แอปที่รันอยู่ยังไม่มีโมดูลนี้
            </Text>
          </View>
        )}
      </View>

      {/* คำอธิบายที่มาของข้อมูล + ปุ่มเปิดใน Google Maps */}
      <View className="flex-row items-center mt-2">
        <Text className="text-[10.5px] text-gray-400 flex-1" numberOfLines={2}>
          {routeSource === "osrm"
            ? `เส้นทางจริงจาก OpenStreetMap${routeCredit ? ` · ${routeCredit}` : ""}`
            : routeSource
            ? `ระยะ/เวลาเป็นค่าประมาณ (${routeSource}) · ไม่รวมสภาพจราจร`
            : "เวลาเดินทางโดยประมาณ ไม่รวมสภาพจราจร"}
        </Text>
        <TouchableOpacity
          onPress={openInGoogleMaps}
          activeOpacity={0.8}
          className="flex-row items-center bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1 ml-2"
        >
          <ArrowTopRightOnSquareIcon size={12} color="#1D4ED8" />
          <Text className="text-blue-700 text-[11px] font-bold ml-1">
            เปิดใน Google Maps
          </Text>
        </TouchableOpacity>
      </View>

      {returnMode === "custom" ? (
        <Text className="text-[10.5px] text-gray-400 mt-1">
          เส้นทางนี้จบที่จุดสิ้นสุดคนละจุดกับจุดเริ่มต้น (A → B)
        </Text>
      ) : null}
    </View>
  );
}

/**
 * ห่อด้วย React.memo — แชท re-render ทั้งหน้าตอนผู้ใช้แก้ข้อมูลในการ์ด
 * แผนที่ native ไม่ต้องถูกส่งค่าใหม่ (ถ้าเนื้อหาไม่เปลี่ยนจริง)
 */
export default React.memo(TripRouteMap);
