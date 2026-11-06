import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { requireOptionalNativeModule } from "expo";
import {
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  MapPinIcon,
  TrashIcon,
  XMarkIcon,
} from "react-native-heroicons/outline";
import {
  deleteSavedPlace,
  setDefaultSavedPlace,
  updateSavedPlace,
  updateSavedPlaceCoords,
  UserSavedPlace,
} from "../services/savedPlacesService";
import { resolvePlaceCoords } from "../services/placesService";

/**
 * หน้าจอดู/แก้ไข/ลบ "ที่อยู่ที่บันทึกไว้" (ปักหมุด)
 * =============================================================
 * เปิดจากชิปที่อยู่ใน `OriginSelectorModal`
 * → กดชิป = เปิดหน้านี้ (ไม่ส่งข้อความเข้าแชท ไม่เลือกจุดทันที)
 *
 * ในหน้านี้ทำได้ 4 อย่าง
 *  1. ดูบนแผนที่ว่าอยู่ตรงไหน (หรือกดเปิดใน Google Maps)
 *  2. แก้ชื่อ / ที่อยู่ / ลิงก์ / พิกัด แล้วกด "ยืนยันบันทึก"
 *  3. ตั้ง "จุดหลัก" (ใช้เป็นจุดเริ่มต้นประจำ) — สลับได้ทีละจุด
 *  4. ลบที่อยู่นี้ทิ้ง (มีการยืนยันก่อน)
 *
 * โครงหน้านี้เป็น "แผงเนื้อหา" ไม่ใช่ Modal ของตัวเอง
 * → เอาไปวางใน Modal เดียวกับรายการที่อยู่ได้
 *   (Modal ซ้อน Modal บน iOS แล้วปุ่มกดไม่ติด)
 *
 * แผนที่ใช้ expo-maps (ต้อง dev build)
 * → ถ้ารันใน Expo Go จะไม่มีโมดูล → แสดงพิกัด + ปุ่มเปิด Google Maps แทน ไม่ crash
 */

// ─────────────────────────────────────────────────────────────────────────
//  แผนที่หมุดเดียว
// ─────────────────────────────────────────────────────────────────────────

class PinMapErrorBoundary extends React.Component<
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
    console.warn("[SavedPlaceEditor] แผนที่แสดงไม่ได้:", error?.message ?? error);
  }
  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

/** แผนที่ที่มีหมุดเดียว (จุดที่บันทึกไว้) */
function SinglePinMap({
  coords,
  label,
  height = 190,
}: {
  coords?: { lat: number; lng: number } | null;
  label: string;
  height?: number;
}) {
  const [layoutWidth, setLayoutWidth] = useState(0);

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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const maps = require("expo-maps");
      return Platform.OS === "ios" ? maps.AppleMaps.View : maps.GoogleMaps.View;
    } catch (e: any) {
      console.warn("[SavedPlaceEditor] โหลด expo-maps ไม่ได้:", e?.message ?? e);
      return null;
    }
  }, [mapsAvailable]);

  const camera = useMemo(() => {
    if (!coords) return undefined;
    return {
      coordinates: { latitude: coords.lat, longitude: coords.lng },
      zoom: 15,
    };
  }, [coords]);

  const markers = useMemo(() => {
    if (!coords) return [];
    return [
      {
        id: "saved-place",
        coordinates: { latitude: coords.lat, longitude: coords.lng },
        title: label,
        ...(Platform.OS === "ios" ? { tintColor: "#7C3AED" } : { zIndex: 90 }),
      },
    ];
  }, [coords, label]);

  const openInGoogleMaps = () => {
    if (!coords) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;
    Linking.openURL(url).catch(() => undefined);
  };

  const fallback = (
    <View className="flex-1 items-center justify-center px-6 bg-gray-50">
      <ExclamationTriangleIcon size={22} color="#B45309" />
      <Text className="text-amber-800 text-[11.5px] font-bold mt-1.5 text-center">
        แผนที่สดต้องใช้ dev build
      </Text>
      {coords ? (
        <Text className="text-gray-500 text-[11px] mt-1 text-center">
          {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View>
      <View
        onLayout={(e) => setLayoutWidth(e.nativeEvent.layout.width)}
        style={{ height, borderRadius: 18, overflow: "hidden" }}
        className="bg-gray-100"
      >
        {MapComponent && camera && layoutWidth > 0 ? (
          <PinMapErrorBoundary fallback={fallback}>
            <MapComponent
              style={{ flex: 1 }}
              cameraPosition={camera}
              markers={markers}
              {...(Platform.OS === "ios"
                ? {
                    properties: { selectionEnabled: false },
                    uiSettings: { compassEnabled: false, scaleBarEnabled: true },
                  }
                : {
                    properties: { selectionEnabled: false },
                    uiSettings: { compassEnabled: false, zoomControlsEnabled: false },
                  })}
            />
          </PinMapErrorBoundary>
        ) : (
          fallback
        )}
      </View>

      {coords ? (
        <Pressable
          onPress={openInGoogleMaps}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          className="self-start flex-row items-center bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1 mt-2"
        >
          <ArrowTopRightOnSquareIcon size={12} color="#1D4ED8" />
          <Text className="text-blue-700 text-[11px] font-bold ml-1">
            เปิดใน Google Maps
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  หน้าจอหลัก
// ─────────────────────────────────────────────────────────────────────────

interface SavedPlaceEditorSheetProps {
  /** ที่อยู่ที่กำลังแก้ไข */
  place: UserSavedPlace;
  /** ปิดหน้านี้ (ยกเลิก / เสร็จแล้ว) */
  onClose: () => void;
  /**
   * ผู้ใช้กด "ใช้จุดนี้" → ส่งข้อมูลที่แก้แล้วกลับไปใช้ต่อ
   * (ถ้าไม่ส่งมา ปุ่มนี้จะไม่แสดง — เช่นเปิดดูเฉย ๆ เพื่อแก้/ลบ)
   */
  onUsePlace?: (place: UserSavedPlace) => void;
  /** ป้ายของปุ่ม "ใช้จุดนี้" */
  useLabel?: string;
  /** บันทึก/ลบเสร็จแล้ว → ให้แม่รีเฟรชรายการ */
  onChanged?: () => void;
}

export default function SavedPlaceEditorSheet({
  place,
  onClose,
  onUsePlace,
  useLabel = "ใช้จุดนี้",
  onChanged,
}: SavedPlaceEditorSheetProps) {
  const insets = useSafeAreaInsets();

  // ── ค่าในฟอร์ม ──────────────────────────────────────────────────────
  const [label, setLabel] = useState(place.label);
  const [address, setAddress] = useState(place.address_text ?? "");
  const [mapsUrl, setMapsUrl] = useState(place.google_maps_url ?? "");
  const [lat, setLat] = useState<number | null>(place.lat ?? null);
  const [lng, setLng] = useState<number | null>(place.lng ?? null);
  const [isDefault, setIsDefault] = useState(!!place.is_default);

  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /** ค่าที่ผ่านมาเปลี่ยน (เปิดจุดอื่นทับ) → ดึงค่าใหม่มาใช้ */
  const [lastPlaceId, setLastPlaceId] = useState(place.id);
  if (place.id !== lastPlaceId) {
    setLastPlaceId(place.id);
    setLabel(place.label);
    setAddress(place.address_text ?? "");
    setMapsUrl(place.google_maps_url ?? "");
    setLat(place.lat ?? null);
    setLng(place.lng ?? null);
    setIsDefault(!!place.is_default);
  }

  /** เปิดจุดที่ยังไม่มีพิกัด → ลองหาให้อัตโนมัติ (เพื่อให้แผนที่ใช้ได้) */
  useEffect(() => {
    if (lat != null && lng != null) return;
    let cancelled = false;
    (async () => {
      setResolving(true);
      try {
        const resolved = await resolvePlaceCoords({
          url: place.google_maps_url ?? null,
          text: place.address_text ?? null,
        });
        if (cancelled || !resolved) return;
        setLat(resolved.lat);
        setLng(resolved.lng);
        // เขียนกลับฐานข้อมูลด้วย (ไม่รอผู้ใช้กดยืนยัน) → ครั้งหน้าไม่ต้องค้นใหม่
        void updateSavedPlaceCoords(place.id, resolved.lat, resolved.lng).catch(() => {});
      } catch {
        // หาพิกัดไม่ได้ → ผู้ใช้ยังพิมพ์/ค้นหาเองได้
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // รันครั้งเดียวตอนเปิดจุดนี้
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.id]);

  const coords = lat != null && lng != null ? { lat, lng } : null;

  /** ปุ่ม "ค้นหาพิกัดใหม่" — ใช้เมื่อแก้ที่อยู่/ลิงก์แล้วอยากให้หาพิกัดตามใหม่ */
  const handleResolveCoords = useCallback(async () => {
    setResolving(true);
    try {
      const resolved = await resolvePlaceCoords({
        url: mapsUrl.trim() || null,
        text: address.trim() || null,
      });
      if (!resolved) {
        Alert.alert(
          "หาพิกัดไม่ได้",
          "ลองใส่ชื่อสถานที่ให้ละเอียดกว่านี้ หรือวางลิงก์ Google Maps"
        );
        return;
      }
      setLat(resolved.lat);
      setLng(resolved.lng);
      // เขียนกลับทันที (ไม่รอกดยืนยัน) → แผนที่ใช้ได้ทันที
      void updateSavedPlaceCoords(place.id, resolved.lat, resolved.lng).catch(() => {});
    } catch {
      Alert.alert("หาพิกัดไม่สำเร็จ", "ลองใหม่อีกครั้ง หรือพิมพ์พิกัดเอง");
    } finally {
      setResolving(false);
    }
  }, [address, mapsUrl, place.id]);

  /** เขียนค่าที่แก้ไว้ลงฐานข้อมูล (คืนค่าที่บันทึกสำเร็จ) */
  const persist = useCallback(async (): Promise<UserSavedPlace> => {
    const trimmedLabel = label.trim() || place.label;
    const trimmedAddress = address.trim();
    const trimmedUrl = mapsUrl.trim();

    await updateSavedPlace(place.id, {
      label: trimmedLabel,
      address_text: trimmedAddress,
      // ส่งค่าว่างไปด้วย (ไม่ใช่ undefined) → ถ้าผู้ใช้ลบลิงก์ออก ของเก่าต้องหายด้วย
      google_maps_url: trimmedUrl,
      lat: lat ?? undefined,
      lng: lng ?? undefined,
    });

    // จุดหลัก → ต้องล้างของจุดอื่นก่อน (ทำที่ฝั่ง server ให้เป็นจุดหลักจริง)
    if (isDefault && !place.is_default) {
      await setDefaultSavedPlace(place.id);
    } else if (!isDefault && place.is_default) {
      await updateSavedPlace(place.id, { is_default: false });
    }

    return {
      ...place,
      label: trimmedLabel,
      address_text: trimmedAddress,
      google_maps_url: trimmedUrl || undefined,
      lat: lat ?? undefined,
      lng: lng ?? undefined,
      is_default: isDefault,
    };
  }, [
    address,
    isDefault,
    label,
    lat,
    lng,
    mapsUrl,
    place,
  ]);

  /** "ยืนยันบันทึก" */
  const handleSave = async () => {
    setSaving(true);
    try {
      await persist();
      onChanged?.();
      Alert.alert("บันทึกแล้ว", "ข้อมูลที่อยู่ถูกอัปเดตเรียบร้อย", [
        { text: "ตกลง", onPress: onClose },
      ]);
    } catch (err: any) {
      Alert.alert(
        "บันทึกไม่สำเร็จ",
        err?.message ?? "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง"
      );
    } finally {
      setSaving(false);
    }
  };

  /** "ใช้จุดนี้" — บันทึกข้อมูลที่แก้ก่อน แล้วค่อยส่งค่าที่แก้แล้วกลับไปใช้ */
  const handleUse = async () => {
    setSaving(true);
    try {
      const saved = await persist();
      onChanged?.();
      onUsePlace?.(saved);
      onClose();
    } catch (err: any) {
      Alert.alert(
        "บันทึกไม่สำเร็จ",
        err?.message ?? "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง"
      );
    } finally {
      setSaving(false);
    }
  };

  /** "ลบที่นี้" — ขอยืนยันก่อนลบจริง */
  const handleDelete = () => {
    Alert.alert(
      "ลบที่อยู่นี้?",
      `"${label.trim() || place.label}" จะถูกลบออกจากรายการที่บันทึกไว้`,
      [
        { text: "ยกเลิก", style: "cancel" },
        {
          text: "ลบ",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteSavedPlace(place.id);
              onChanged?.();
              onClose();
            } catch (err: any) {
              Alert.alert(
                "ลบไม่สำเร็จ",
                err?.message ?? "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง"
              );
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1">
      {/* ── หัวเรื่อง ─────────────────────────────────────────────── */}
      <View className="flex-row items-center justify-between px-5 pt-3 pb-3 border-b border-gray-100">
        <View className="flex-1 mr-2">
          <Text className="text-[17px] font-black text-gray-900" numberOfLines={1}>
            ที่อยู่ที่บันทึกไว้
          </Text>
          <Text className="text-[12px] text-gray-400" numberOfLines={1}>
            ดูตำแหน่ง · แก้ไข · ตั้งจุดหลัก · ลบ
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="ปิด"
          className="p-1.5 bg-gray-100 rounded-full"
        >
          <XMarkIcon size={20} color="#4B5563" />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        className="px-5 pt-3"
        keyboardShouldPersistTaps="handled"
      >
        {/* ── แผนที่ ─────────────────────────────────────────────── */}
        <SinglePinMap coords={coords} label={label.trim() || place.label} />

        {resolving ? (
          <View className="flex-row items-center mt-2">
            <ActivityIndicator size="small" color="#7C3AED" />
            <Text className="text-gray-500 text-[11.5px] ml-1.5">
              กำลังหาพิกัด...
            </Text>
          </View>
        ) : null}

        {/* ── พิกัด ─────────────────────────────────────────────── */}
        <View className="flex-row items-center justify-between mt-3 mb-1">
          <Text className="text-[12px] font-semibold text-gray-700">พิกัด</Text>
          <Pressable
            onPress={() => void handleResolveCoords()}
            disabled={resolving}
            accessibilityRole="button"
            accessibilityLabel="ค้นหาพิกัดใหม่"
            className="flex-row items-center bg-violet-50 border border-violet-200 rounded-full px-2.5 py-1"
          >
            <MapPinIcon size={12} color="#7C3AED" />
            <Text className="text-violet-700 text-[11px] font-bold ml-1">
              ค้นหาพิกัดใหม่
            </Text>
          </Pressable>
        </View>
        <View className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
          <Text className="text-[12.5px] text-gray-700">
            {coords
              ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`
              : "ยังไม่มีพิกัด — แผนทริปต้องใช้พิกัด จึงคำนวณเส้นทางไม่ได้"}
          </Text>
        </View>

        {/* ── ชื่อ ─────────────────────────────────────────────── */}
        <Text className="text-[12px] font-semibold text-gray-700 mt-3 mb-1">
          ชื่อที่บันทึก
        </Text>
        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder="เช่น บ้าน, หอพัก, ที่ทำงาน"
          placeholderTextColor="#9CA3AF"
          className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-[13px] text-gray-900"
        />

        {/* ── ที่อยู่ ───────────────────────────────────────────── */}
        <Text className="text-[12px] font-semibold text-gray-700 mt-3 mb-1">
          ที่อยู่
        </Text>
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="เช่น คอนโดเดอะเบส อ่อนนุช, เลขที่ 123..."
          placeholderTextColor="#9CA3AF"
          multiline
          className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-[13px] text-gray-900 min-h-[54px]"
        />

        {/* ── ลิงก์ Google Maps ─────────────────────────────────── */}
        <Text className="text-[12px] font-semibold text-gray-700 mt-3 mb-1">
          ลิงก์ Google Maps
        </Text>
        <TextInput
          value={mapsUrl}
          onChangeText={setMapsUrl}
          placeholder="วางลิงก์ https://maps.app.goo.gl/..."
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-gray-900"
        />

        {/* ── จุดหลัก ───────────────────────────────────────────── */}
        <Pressable
          onPress={() => setIsDefault((v) => !v)}
          style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isDefault }}
          accessibilityLabel="ใช้เป็นจุดหลัก"
          className="flex-row items-center mt-4 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5"
        >
          <View
            className={`w-5 h-5 rounded-md border items-center justify-center mr-2.5 ${
              isDefault ? "bg-violet-600 border-violet-600" : "bg-white border-gray-300"
            }`}
          >
            {isDefault ? <CheckIcon size={13} color="#FFFFFF" strokeWidth={3} /> : null}
          </View>
          <View className="flex-1">
            <Text className="text-[12.5px] font-bold text-violet-900">
              ใช้เป็นจุดหลัก
            </Text>
            <Text className="text-[11px] text-violet-700">
              ใช้จุดนี้เป็นจุดเริ่มต้นประจำ (มีได้จุดเดียว)
            </Text>
          </View>
        </Pressable>

        {/* ── ปุ่ม ──────────────────────────────────────────────── */}
        <Pressable
          onPress={() => void handleSave()}
          disabled={saving || deleting}
          accessibilityRole="button"
          accessibilityLabel="ยืนยันบันทึก"
          style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
          className={`mt-4 rounded-2xl py-3.5 items-center justify-center ${
            saving || deleting ? "bg-gray-300" : "bg-violet-600"
          }`}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text className="text-white text-[14px] font-bold">
              ยืนยันบันทึก
            </Text>
          )}
        </Pressable>

        {onUsePlace ? (
          <Pressable
            onPress={() => void handleUse()}
            disabled={saving || deleting}
            accessibilityRole="button"
            accessibilityLabel={useLabel}
            style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
            className="mt-2 rounded-2xl py-3 items-center justify-center border border-violet-300 bg-white"
          >
            <Text className="text-violet-700 text-[13.5px] font-bold">
              {useLabel}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={handleDelete}
          disabled={saving || deleting}
          accessibilityRole="button"
          accessibilityLabel="ลบที่อยู่นี้"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          className="mt-2 flex-row items-center justify-center py-3"
        >
          {deleting ? (
            <ActivityIndicator size="small" color="#DC2626" />
          ) : (
            <TrashIcon size={15} color="#DC2626" />
          )}
          <Text className="text-red-600 text-[13px] font-bold ml-1.5">
            ลบที่อยู่นี้
          </Text>
        </Pressable>

        <View style={{ height: Math.max(insets.bottom, 12) }} />
      </ScrollView>
    </View>
  );
}
