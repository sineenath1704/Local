import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import {
  CheckCircleIcon,
  XCircleIcon,
  CameraIcon,
  ArrowRightIcon,
  MapPinIcon,
} from "react-native-heroicons/outline";
import { useAuth } from "../../state/AuthContext";
import { verifyOtop, type OtopProfile } from "../../services/otopService";
import { verifyPlaceOnGoogle, type PlaceCandidate } from "../../services/placesService";
import { supabase } from "../../lib/supabase";

/**
 * OnboardingScreen — shown once after a first Google sign-in, before the app.
 * Step 1: role
 * Step 2 (if host): otop verify -> business profile (place_name, price, phone, GPS)
 * Step 3: pick unique username
 * Step 4: display name + avatar -> save
 */
type Step = "role" | "otop" | "business" | "username" | "details";

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { isUsernameAvailable, completeOnboarding } = useAuth();

  const [step, setStep] = useState<Step>("role");

  // Role + OTOP verification
  const [role, setRole] = useState<"tourist" | "host" | null>(null);
  const [villageId, setVillageId] = useState("");
  const [otopChecking, setOtopChecking] = useState(false);
  const [otop, setOtop] = useState<OtopProfile | null>(null);

  // Host business profile
  type BizType = "homestay" | "activity" | "cafe" | "custom";
  const [bizType, setBizType] = useState<BizType>("homestay");
  const [weekdayLabel, setWeekdayLabel] = useState("วันธรรมดา (อา.-พฤ.)");
  const [weekendLabel, setWeekendLabel] = useState("วันหยุดสุดสัปดาห์ (ศ.-ส. & นักขัตฤกษ์)");
  const [weekdayHours, setWeekdayHours] = useState("");
  const [weekendHours, setWeekendHours] = useState("");
  const [closedDays, setClosedDays] = useState("เปิดทุกวัน");
  const [weekdayPrice, setWeekdayPrice] = useState("");
  const [weekendPrice, setWeekendPrice] = useState("");

  const [businessPlaceName, setBusinessPlaceName] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [searchingPin, setSearchingPin] = useState(false);
  const [pinCandidates, setPinCandidates] = useState<PlaceCandidate[]>([]);
  const [confirmedPlace, setConfirmedPlace] = useState<PlaceCandidate | null>(null);

  const [username, setUsername] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const checkOtop = async () => {
    if (!villageId.trim()) {
      Alert.alert("กรอกเลขทะเบียน", "กรุณากรอกเลขทะเบียน OTOP นวัตวิถี");
      return;
    }
    setOtopChecking(true);
    const r = await verifyOtop(villageId.trim());
    setOtopChecking(false);
    if (!r.configured) {
      Alert.alert("ยังไม่พร้อมใช้งาน", "ระบบยืนยัน OTOP ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์");
      return;
    }
    if (!r.verified || !r.profile) {
      setOtop(null);
      Alert.alert("ไม่พบทะเบียน", r.error ?? "ไม่พบเลขทะเบียนนี้ในระบบ OTOP กรุณาตรวจสอบอีกครั้ง");
      return;
    }
    setOtop(r.profile);
  };

  // ค้นหาสถานที่บน Google Maps แบบ Realtime สโคปในชุมชน (Debounce 500ms)
  React.useEffect(() => {
    if (step !== "business" || !otop) return;
    const query = businessPlaceName.trim();
    if (!query || query.length < 2) {
      setPinCandidates([]);
      return;
    }
    if (confirmedPlace && confirmedPlace.name === query) {
      return;
    }
    setSearchingPin(true);
    const timer = setTimeout(async () => {
      try {
        const res = await verifyPlaceOnGoogle({
          placeName: query,
          community: otop.village,
          district: otop.amphur,
          province: otop.province,
        });
        setPinCandidates(res.candidates);
      } catch {
        setPinCandidates([]);
      } finally {
        setSearchingPin(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [businessPlaceName, step, otop, confirmedPlace]);

  const handleSelectBizType = (type: BizType) => {
    setBizType(type);
    if (type === "homestay") {
      setWeekdayLabel("วันธรรมดา (อา.-พฤ.)");
      setWeekendLabel("วันหยุดสุดสัปดาห์ (ศ.-ส. & นักขัตฤกษ์)");
    } else if (type === "activity") {
      setWeekdayLabel("วันธรรมดา (จ.-ศ.)");
      setWeekendLabel("วันหยุดสุดสัปดาห์ (ส.-อา. & นักขัตฤกษ์)");
    } else if (type === "cafe") {
      setWeekdayLabel("วันธรรมดา (จ.-ศ.)");
      setWeekendLabel("วันหยุดสุดสัปดาห์ (ส.-อา.)");
    } else {
      setWeekdayLabel("วันธรรมดา");
      setWeekendLabel("วันหยุด / เทศกาล");
    }
  };

  const parseGoogleHours = (openingHoursStr?: string | null) => {
    if (!openingHoursStr) return;
    const parts = openingHoursStr.split("|").map((p) => p.trim());
    const closedDayNames: string[] = [];
    parts.forEach((p) => {
      if (p.includes("ปิดทำการ") || p.toLowerCase().includes("closed")) {
        const dayName = p.split(":")[0]?.trim();
        if (dayName) closedDayNames.push(dayName.replace("วัน", ""));
      }
    });

    if (closedDayNames.length > 0) {
      setClosedDays(`ปิดทุกวัน${closedDayNames.join(", ")}`);
    } else {
      setClosedDays("เปิดทุกวัน");
    }

    const openPart = parts.find(
      (p) => !p.includes("ปิดทำการ") && !p.toLowerCase().includes("closed") && p.includes(":")
    );
    if (openPart) {
      const timeIdx = openPart.indexOf(":");
      if (timeIdx !== -1) {
        const timeStr = openPart.slice(timeIdx + 1).trim();
        setWeekdayHours(timeStr);
        setWeekendHours(timeStr);
      }
    }
  };

  const selectCandidate = (c: PlaceCandidate) => {
    setConfirmedPlace(c);
    if (c.name) setBusinessPlaceName(c.name);
    if (c.phone) setBusinessPhone(c.phone);
    if (c.openingHours) parseGoogleHours(c.openingHours);
    setPinCandidates([]);
  };

  const applyOtopFallbackPin = () => {
    const fallbackName =
      businessPlaceName.trim() || otop?.otopNawatwithi || otop?.village || "สถานประกอบการชุมชน";
    const fallbackAddress = [
      otop?.village,
      otop?.tambol && `ต.${otop.tambol}`,
      otop?.amphur && `อ.${otop.amphur}`,
      otop?.province && `จ.${otop.province}`,
    ]
      .filter(Boolean)
      .join(" • ");

    setConfirmedPlace({
      name: fallbackName,
      address: fallbackAddress,
      placeId: `otop-${villageId}-${Date.now()}`,
      latitude: null,
      longitude: null,
      province: otop?.province ?? null,
      district: otop?.amphur ?? null,
      subdistrict: otop?.tambol ?? null,
      types: ["community"],
    });
    setPinCandidates([]);
  };

  const searchBusinessLocation = async () => {
    if (!businessPlaceName.trim()) {
      Alert.alert("กรอกชื่อสถานที่", "กรุณากรอกชื่อสถานที่ประกอบการของคุณก่อนค้นหาพิกัด");
      return;
    }
    setSearchingPin(true);
    setPinCandidates([]);
    try {
      const res = await verifyPlaceOnGoogle({
        placeName: businessPlaceName.trim(),
        community: otop?.village,
        district: otop?.amphur,
        province: otop?.province,
      });
      setSearchingPin(false);
      setPinCandidates(res.candidates);
    } catch {
      setSearchingPin(false);
    }
  };

  const normalized = username.trim().toLowerCase();
  const validFormat = /^[a-z0-9_.]{3,20}$/.test(normalized);

  const checkUsername = async () => {
    if (!validFormat) {
      setAvailable(null);
      Alert.alert("ชื่อผู้ใช้ไม่ถูกต้อง", "ใช้ a-z, 0-9, _ หรือ . ความยาว 3-20 ตัวอักษร");
      return;
    }
    setChecking(true);
    const ok = await isUsernameAvailable(normalized);
    setAvailable(ok);
    setChecking(false);
  };

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("ต้องการสิทธิ์เข้าถึงรูปภาพ", "โปรดอนุญาตให้แอปเข้าถึงคลังรูปเพื่อเลือกรูปโปรไฟล์");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  const goStep2 = async () => {
    // Re-verify availability before advancing.
    if (!validFormat) {
      Alert.alert("ชื่อผู้ใช้ไม่ถูกต้อง", "ใช้ a-z, 0-9, _ หรือ . ความยาว 3-20 ตัวอักษร");
      return;
    }
    setChecking(true);
    const ok = await isUsernameAvailable(normalized);
    setChecking(false);
    setAvailable(ok);
    if (!ok) {
      Alert.alert("ชื่อผู้ใช้ซ้ำ", "ชื่อนี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น");
      return;
    }
    // Prefill phone from host business phone if applicable
    if (role === "host" && businessPhone && !phone) {
      setPhone(businessPhone);
    }
    setStep("details");
  };

  const handleSave = async () => {
    if (!displayName.trim()) {
      Alert.alert("กรอกชื่อ", "กรุณากรอกชื่อที่จะแสดงในโปรไฟล์");
      return;
    }
    setSaving(true);
    const compOpening = [
      weekdayHours.trim() ? `${weekdayLabel}: ${weekdayHours.trim()}` : "",
      weekendHours.trim() ? `${weekendLabel}: ${weekendHours.trim()}` : "",
      closedDays.trim() ? `วันหยุดร้าน: ${closedDays.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    const compPrice = [
      weekdayPrice.trim() ? `${weekdayLabel}: ${weekdayPrice.trim()}` : "",
      weekendPrice.trim() ? `${weekendLabel}: ${weekendPrice.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    const { error } = await completeOnboarding({
      username: normalized,
      displayName: displayName.trim(),
      phone: (role === "host" ? businessPhone.trim() : phone.trim()) || undefined,
      avatarUri,
      role: role ?? "tourist",
      otop: role === "host" ? otop : null,
      businessPlaceName: role === "host" ? businessPlaceName.trim() : undefined,
      businessPriceInfo: role === "host" ? compPrice : undefined,
      businessPhone: role === "host" ? businessPhone.trim() : undefined,
      businessLat: role === "host" ? (confirmedPlace?.latitude ?? null) : undefined,
      businessLng: role === "host" ? (confirmedPlace?.longitude ?? null) : undefined,
      businessAddress: role === "host" ? (confirmedPlace?.address ?? null) : undefined,
      businessSubdistrict: role === "host" ? (confirmedPlace?.subdistrict ?? otop?.tambol ?? null) : undefined,
      businessDistrict: role === "host" ? (confirmedPlace?.district ?? otop?.amphur ?? null) : undefined,
      businessProvince: role === "host" ? (confirmedPlace?.province ?? otop?.province ?? null) : undefined,
    });
    setSaving(false);
    if (error) {
      Alert.alert("บันทึกไม่สำเร็จ", error);
      if (error.includes("ถูกใช้แล้ว")) setStep("username");
      return;
    }

    // Upsert into community_places master table for AI chat & search
    if (role === "host" && confirmedPlace) {
      const pId = confirmedPlace.placeId || `otop-${villageId}-${Date.now()}`;
      const gUrl =
        confirmedPlace.googleMapsUri ||
        (confirmedPlace.latitude != null && confirmedPlace.longitude != null
          ? `https://www.google.com/maps?q=${confirmedPlace.latitude},${confirmedPlace.longitude}`
          : null);

      supabase
        .from("community_places")
        .upsert(
          {
            place_id: pId,
            place_name: businessPlaceName.trim(),
            formatted_address: confirmedPlace.address || null,
            province: confirmedPlace.province || otop?.province || "",
            district: confirmedPlace.district || otop?.amphur || null,
            subdistrict: confirmedPlace.subdistrict || otop?.tambol || null,
            village: otop?.village || null,
            latitude: confirmedPlace.latitude ?? null,
            longitude: confirmedPlace.longitude ?? null,
            google_maps_url: gUrl,
            phone: businessPhone.trim() || null,
            opening_hours: compOpening || null,
            price_info: compPrice || null,
            rating: confirmedPlace.rating ?? null,
            user_ratings_total: confirmedPlace.userRatingCount ?? null,
            website: confirmedPlace.website ?? null,
            source: "host_verified",
          },
          { onConflict: "place_id" }
        )
        .then(({ error: cErr }) => {
          if (cErr) console.warn("[onboarding] community_places error:", cErr.message);
        });
    }
    // On success, AuthGate re-renders into the app automatically.
  };

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: Math.max(insets.top, 16) + 8 }}>
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ---- STEP: choose role ---- */}
        {step === "role" && (
          <>
            <Text className="text-2xl font-black text-gray-900 mb-1">คุณคือใคร?</Text>
            <Text className="text-gray-500 text-[13px] mb-6 leading-5">
              เลือกประเภทบัญชีเพื่อเริ่มใช้งาน Local
            </Text>

            <TouchableOpacity
              onPress={() => {
                setRole("tourist");
                setStep("username");
              }}
              activeOpacity={0.85}
              className="border-2 border-gray-200 rounded-2xl p-4 mb-3 flex-row items-center"
            >
              <Text className="text-3xl mr-3">🧳</Text>
              <View className="flex-1">
                <Text className="text-gray-900 font-black text-[15px]">นักท่องเที่ยว</Text>
                <Text className="text-gray-500 text-[12px]">เที่ยว รีวิว บันทึกคลิป วางแผนทริป</Text>
              </View>
              <ArrowRightIcon size={18} color="#9CA3AF" strokeWidth={2.5} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setRole("host");
                setStep("otop");
              }}
              activeOpacity={0.85}
              className="border-2 border-emerald-200 bg-emerald-50 rounded-2xl p-4 flex-row items-center"
            >
              <Text className="text-3xl mr-3">🏡</Text>
              <View className="flex-1">
                <Text className="text-gray-900 font-black text-[15px]">ชุมชน OTOP นวัตวิถี</Text>
                <Text className="text-gray-500 text-[12px]">ผู้ให้บริการ — ยืนยันด้วยเลขทะเบียน</Text>
              </View>
              <ArrowRightIcon size={18} color="#2D6A4F" strokeWidth={2.5} />
            </TouchableOpacity>
          </>
        )}

        {/* ---- STEP: OTOP verification (host only) ---- */}
        {step === "otop" && (
          <>
            <Text className="text-2xl font-black text-gray-900 mb-1">ยืนยันชุมชน OTOP</Text>
            <Text className="text-gray-500 text-[13px] mb-6 leading-5">
              กรอกเลขทะเบียนผู้ประกอบการ OTOP นวัตวิถี เพื่อยืนยันว่าเป็นผู้ให้บริการจริง
            </Text>

            <Text className="text-gray-700 font-bold text-[13px] mb-1.5">เลขทะเบียน (Village ID)</Text>
            <View className="flex-row">
              <TextInput
                value={villageId}
                onChangeText={(t) => {
                  setVillageId(t);
                  setOtop(null);
                }}
                placeholder="เช่น 123456"
                placeholderTextColor="#9CA3AF"
                className="flex-1 bg-gray-100 rounded-xl px-3.5 py-3 text-[15px] text-gray-900"
              />
              <TouchableOpacity
                onPress={checkOtop}
                disabled={otopChecking || !villageId.trim()}
                activeOpacity={0.85}
                className={`ml-2 px-4 items-center justify-center rounded-xl ${villageId.trim() && !otopChecking ? "bg-[#2D6A4F]" : "bg-gray-200"}`}
              >
                {otopChecking ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text className={`font-bold text-[13px] ${villageId.trim() ? "text-white" : "text-gray-400"}`}>ตรวจสอบ</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Verified community card */}
            {otop && (
              <View className="mt-4 bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                <View className="flex-row items-center mb-2">
                  <CheckCircleIcon size={18} color="#2D6A4F" />
                  <Text className="text-[#1B4332] font-black text-[14px] ml-1.5">ยืนยันแล้ว</Text>
                </View>
                {otop.otopNawatwithi && (
                  <Text className="text-gray-900 font-bold text-[14px] mb-0.5">{otop.otopNawatwithi}</Text>
                )}
                <Text className="text-gray-600 text-[12px] leading-5">
                  {[otop.village, otop.tambol && `ต.${otop.tambol}`, otop.amphur && `อ.${otop.amphur}`, otop.province, otop.region]
                    .filter(Boolean)
                    .join(" • ")}
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={() => setStep("business")}
              disabled={!otop}
              activeOpacity={0.85}
              className={`mt-8 py-4 rounded-2xl flex-row items-center justify-center ${otop ? "bg-[#2D6A4F]" : "bg-gray-200"}`}
            >
              <Text className={`font-bold text-[15px] mr-1.5 ${otop ? "text-white" : "text-gray-400"}`}>ถัดไป (ข้อมูลสถานประกอบการ)</Text>
              <ArrowRightIcon size={18} color={otop ? "#FFFFFF" : "#9CA3AF"} strokeWidth={2.5} />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep("role")} activeOpacity={0.7} className="mt-3 items-center">
              <Text className="text-gray-400 text-[13px]">ย้อนกลับ</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ---- STEP: Host business profile ---- */}
        {step === "business" && otop && (
          <>
            <Text className="text-2xl font-black text-gray-900 mb-1">ข้อมูลสถานประกอบการ</Text>
            <Text className="text-gray-500 text-[13px] mb-4 leading-5">
              พิมพ์ชื่อร้านหรือโฮมสเตย์ของคุณ ระบบจะค้นหาบน Google Maps ในพื้นที่ชุมชนนี้ และดึงข้อมูลมาให้ตรวจเช็คโดยอัตโนมัติ
            </Text>

            {/* Read-only OTOP Community Location Banner */}
            <View className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 mb-4">
              <View className="flex-row items-center mb-1">
                <CheckCircleIcon size={16} color="#2D6A4F" />
                <Text className="text-[#1B4332] font-bold text-[13px] ml-1.5">
                  สโคปพื้นที่ชุมชน OTOP (ดึงจากทะเบียน)
                </Text>
              </View>
              <Text className="text-gray-900 text-[13px] leading-5 font-semibold">
                ชุมชน: {otop.otopNawatwithi || otop.village || "-"}
              </Text>
              <Text className="text-gray-600 text-[12px] leading-5">
                {[otop.tambol && `ต.${otop.tambol}`, otop.amphur && `อ.${otop.amphur}`, otop.province && `จ.${otop.province}`]
                  .filter(Boolean)
                  .join(" • ")}
              </Text>
            </View>

            {/* 1. Search Business on Google Maps (Scoped to Community) */}
            <Text className="text-gray-700 font-bold text-[13px] mb-1.5">
              ค้นหาและระบุชื่อสถานประกอบการ <Text className="text-red-500">*</Text>
            </Text>
            <View className="relative mb-3">
              <TextInput
                value={businessPlaceName}
                onChangeText={(t) => {
                  setBusinessPlaceName(t);
                  setConfirmedPlace(null);
                }}
                placeholder="พิมพ์ชื่อร้าน/โฮมสเตย์ เช่น บ้านสวนตานงค์"
                placeholderTextColor="#9CA3AF"
                className="bg-gray-100 rounded-xl px-3.5 py-3 pr-10 text-[15px] text-gray-900"
              />
              {searchingPin && (
                <View className="absolute right-3 top-3.5">
                  <ActivityIndicator size="small" color="#2D6A4F" />
                </View>
              )}
            </View>

            {/* Candidates found on Google Maps within community scope */}
            {pinCandidates.length > 0 && !confirmedPlace && (
              <View className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 mb-4">
                <Text className="text-blue-900 font-bold text-[12px] mb-2">
                  📍 พบสถานที่ในเขต {otop.amphur || otop.province} — เลือกเพื่อดึงข้อมูลอัตโนมัติ:
                </Text>
                {pinCandidates.map((c, idx) => (
                  <View key={idx} className="bg-white border border-blue-100 rounded-xl p-3 mb-2.5 shadow-sm">
                    <Text className="text-gray-900 font-bold text-[13.5px]">📍 {c.name}</Text>
                    <Text className="text-gray-500 text-[11px] mt-0.5" numberOfLines={2}>{c.address}</Text>

                    {(c.phone || c.openingHours) && (
                      <View className="mt-1.5 pt-1.5 border-t border-gray-100">
                        {c.phone && <Text className="text-gray-600 text-[11px]">📞 {c.phone}</Text>}
                        {c.openingHours && (
                          <Text className="text-gray-600 text-[11px] mt-0.5" numberOfLines={1}>
                            🕒 {c.openingHours}
                          </Text>
                        )}
                      </View>
                    )}

                    <View className="flex-row items-center justify-between mt-2.5">
                      {c.googleMapsUri ? (
                        <TouchableOpacity
                          onPress={() => Linking.openURL(c.googleMapsUri!)}
                          activeOpacity={0.7}
                          className="flex-row items-center px-2 py-1 bg-gray-100 rounded-lg"
                        >
                          <Text className="text-[11px] text-blue-700 font-semibold">🗺️ ดูบน Google Maps</Text>
                        </TouchableOpacity>
                      ) : <View />}

                      <TouchableOpacity
                        onPress={() => selectCandidate(c)}
                        activeOpacity={0.85}
                        className="bg-[#2D6A4F] py-1.5 px-3.5 rounded-lg"
                      >
                        <Text className="text-white font-bold text-[11px]">✓ เลือกสถานที่นี้</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Fallback button when not found on Google Maps */}
            {pinCandidates.length === 0 &&
              businessPlaceName.trim().length >= 2 &&
              !searchingPin &&
              !confirmedPlace && (
                <View className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 mb-4">
                  <Text className="text-amber-900 font-semibold text-[12px] mb-1">
                    ไม่พบหมุดร้าน "{businessPlaceName.trim()}" บน Google Maps ในเขต {otop.amphur}
                  </Text>
                  <Text className="text-gray-500 text-[11px] mb-2.5 leading-4">
                    หากเป็นร้านเปิดใหม่หรือยังไม่มีหมุด สามารถกดใช้พิกัดของชุมชน OTOP แทน และกรอกข้อมูลด้วยตนเองได้เลยค่ะ
                  </Text>
                  <TouchableOpacity
                    onPress={applyOtopFallbackPin}
                    activeOpacity={0.85}
                    className="bg-amber-600 py-2 px-3.5 rounded-xl flex-row items-center justify-center self-start"
                  >
                    <MapPinIcon size={15} color="#FFFFFF" />
                    <Text className="text-white font-bold text-[12px] ml-1.5">
                      📍 ใช้พิกัดของชุมชน OTOP แทน
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

            {/* Confirmed Pin & Review / Edit Section */}
            {confirmedPlace && (
              <View className="mb-2">
                <View className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-3.5 mb-4">
                  <View className="flex-row items-center justify-between mb-1">
                    <View className="flex-row items-center">
                      <CheckCircleIcon size={18} color="#2D6A4F" />
                      <Text className="text-[#1B4332] font-black text-[13px] ml-1.5">
                        ✓ ยืนยันพิกัดเรียบร้อยแล้ว
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setConfirmedPlace(null)}
                      activeOpacity={0.7}
                      className="px-2 py-0.5 bg-white border border-emerald-200 rounded-lg"
                    >
                      <Text className="text-emerald-700 font-semibold text-[10.5px]">เปลี่ยนพิกัด</Text>
                    </TouchableOpacity>
                  </View>
                  <Text className="text-gray-800 font-bold text-[13px] mt-0.5">{confirmedPlace.name}</Text>
                  <Text className="text-gray-500 text-[11px] mt-0.5">{confirmedPlace.address}</Text>

                  {confirmedPlace.googleMapsUri && (
                    <TouchableOpacity
                      onPress={() => Linking.openURL(confirmedPlace.googleMapsUri!)}
                      activeOpacity={0.7}
                      className="mt-2 self-start flex-row items-center"
                    >
                      <Text className="text-[11px] text-blue-700 font-semibold">🗺️ ดูตำแหน่งบน Google Maps</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Preset Selector */}
                <Text className="text-gray-700 font-bold text-[13px] mb-1.5">
                  เลือกประเภทสถานประกอบการ <Text className="text-gray-400 font-normal text-[11px]">(ปรับรอบวันอัตโนมัติ)</Text>
                </Text>
                <View className="flex-row flex-wrap gap-1.5 mb-4">
                  {[
                    { id: "homestay", label: "🏡 โฮมสเตย์ / ที่พัก" },
                    { id: "activity", label: "🎨 กิจกรรม / ท่องเที่ยว" },
                    { id: "cafe", label: "☕ ร้านค้า / คาเฟ่" },
                    { id: "custom", label: "⚙️ กำหนดเอง" },
                  ].map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => handleSelectBizType(p.id as BizType)}
                      activeOpacity={0.8}
                      className={`px-3 py-1.5 rounded-xl border ${
                        bizType === p.id
                          ? "bg-[#2D6A4F] border-[#2D6A4F]"
                          : "bg-gray-100 border-gray-200"
                      }`}
                    >
                      <Text
                        className={`text-[12px] font-bold ${
                          bizType === p.id ? "text-white" : "text-gray-700"
                        }`}
                      >
                        {p.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Section 1: Weekday Schedule & Price */}
                <View className="bg-gray-50 p-3.5 rounded-2xl border border-gray-200 mb-3">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-[#1B4332] font-bold text-[13px]">
                      1. รอบวันธรรมดา / วันปกติ
                    </Text>
                    <Text className="text-gray-400 text-[10px]">แตะแก้ไขชื่อวันได้</Text>
                  </View>
                  <TextInput
                    value={weekdayLabel}
                    onChangeText={setWeekdayLabel}
                    placeholder="เช่น วันธรรมดา (อา.-พฤ.)"
                    placeholderTextColor="#9CA3AF"
                    className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-[13px] text-gray-800 font-semibold mb-2"
                  />
                  <Text className="text-gray-600 text-[11.5px] font-medium mb-1">
                    เวลาเปิด-ปิดทำการ / Check-in
                  </Text>
                  <TextInput
                    value={weekdayHours}
                    onChangeText={setWeekdayHours}
                    placeholder={
                      bizType === "homestay"
                        ? "เช่น เช็คอิน 14:00 / เช็คเอาท์ 11:00"
                        : "เช่น 08:30 - 17:00"
                    }
                    placeholderTextColor="#9CA3AF"
                    className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-[13px] text-gray-900 mb-2"
                  />
                  <Text className="text-gray-600 text-[11.5px] font-medium mb-1">
                    อัตราค่าบริการ / ราคา
                  </Text>
                  <TextInput
                    value={weekdayPrice}
                    onChangeText={setWeekdayPrice}
                    placeholder={
                      bizType === "homestay"
                        ? "เช่น 500 บาท / คืน"
                        : "เช่น 50-150 บาท"
                    }
                    placeholderTextColor="#9CA3AF"
                    className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-[13px] text-gray-900"
                  />
                </View>

                {/* Section 2: Weekend & Holiday Schedule & Price */}
                <View className="bg-amber-50/50 p-3.5 rounded-2xl border border-amber-200 mb-3">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-amber-900 font-bold text-[13px]">
                      2. รอบวันหยุด / สุดสัปดาห์ / เทศกาล
                    </Text>
                    <Text className="text-gray-400 text-[10px]">แตะแก้ไขชื่อวันได้</Text>
                  </View>
                  <TextInput
                    value={weekendLabel}
                    onChangeText={setWeekendLabel}
                    placeholder="เช่น วันหยุดสุดสัปดาห์ (ศ.-ส. & นักขัตฤกษ์)"
                    placeholderTextColor="#9CA3AF"
                    className="bg-white border border-amber-200 rounded-xl px-3 py-2 text-[13px] text-gray-800 font-semibold mb-2"
                  />
                  <Text className="text-gray-600 text-[11.5px] font-medium mb-1">
                    เวลาเปิด-ปิดทำการ / Check-in
                  </Text>
                  <TextInput
                    value={weekendHours}
                    onChangeText={setWeekendHours}
                    placeholder={
                      bizType === "homestay"
                        ? "เช่น เช็คอิน 14:00 / เช็คเอาท์ 11:00"
                        : "เช่น 08:00 - 18:00"
                    }
                    placeholderTextColor="#9CA3AF"
                    className="bg-white border border-amber-200 rounded-xl px-3 py-2 text-[13px] text-gray-900 mb-2"
                  />
                  <Text className="text-gray-600 text-[11.5px] font-medium mb-1">
                    อัตราค่าบริการ / ราคา
                  </Text>
                  <TextInput
                    value={weekendPrice}
                    onChangeText={setWeekendPrice}
                    placeholder={
                      bizType === "homestay"
                        ? "เช่น 750 บาท / คืน"
                        : "เช่น 80-200 บาท"
                    }
                    placeholderTextColor="#9CA3AF"
                    className="bg-white border border-amber-200 rounded-xl px-3 py-2 text-[13px] text-gray-900"
                  />
                </View>

                {/* Section 3: Closed Days */}
                <View className="bg-gray-50 p-3.5 rounded-2xl border border-gray-200 mb-4">
                  <Text className="text-gray-800 font-bold text-[13px] mb-1.5">
                    3. วันหยุดประจำร้าน / วันที่ไม่เปิดทำการ
                  </Text>
                  <View className="flex-row flex-wrap gap-1.5 mb-2">
                    {["เปิดทุกวัน", "ปิดวันจันทร์", "ปิดวันพุธ", "ปิดวันอาทิตย์"].map((opt) => (
                      <TouchableOpacity
                        key={opt}
                        onPress={() => setClosedDays(opt)}
                        activeOpacity={0.75}
                        className={`px-2.5 py-1 rounded-lg border ${
                          closedDays === opt
                            ? "bg-red-500 border-red-500"
                            : "bg-white border-gray-200"
                        }`}
                      >
                        <Text
                          className={`text-[11px] font-semibold ${
                            closedDays === opt ? "text-white" : "text-gray-600"
                          }`}
                        >
                          {opt}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    value={closedDays}
                    onChangeText={setClosedDays}
                    placeholder="เช่น เปิดทุกวัน หรือ ปิดทุกวันจันทร์"
                    placeholderTextColor="#9CA3AF"
                    className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-[13px] text-gray-900"
                  />
                </View>

                {/* Business Phone */}
                <Text className="text-gray-700 font-bold text-[13px] mb-1.5">
                  เบอร์โทรศัพท์ติดต่อ <Text className="text-red-500">*</Text>
                </Text>
                <TextInput
                  value={businessPhone}
                  onChangeText={setBusinessPhone}
                  placeholder="เช่น 0812345678"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="phone-pad"
                  className="bg-gray-100 rounded-xl px-3.5 py-3 text-[14px] text-gray-900 mb-4"
                />
              </View>
            )}

            {/* Next Button */}
            <TouchableOpacity
              onPress={() => setStep("username")}
              disabled={!businessPlaceName.trim() || !businessPhone.trim() || !confirmedPlace}
              activeOpacity={0.85}
              className={`py-4 rounded-2xl flex-row items-center justify-center ${
                businessPlaceName.trim() && businessPhone.trim() && confirmedPlace ? "bg-[#2D6A4F]" : "bg-gray-200"
              }`}
            >
              <Text
                className={`font-bold text-[15px] mr-1.5 ${
                  businessPlaceName.trim() && businessPhone.trim() && confirmedPlace ? "text-white" : "text-gray-400"
                }`}
              >
                ถัดไป (ตั้งชื่อผู้ใช้)
              </Text>
              <ArrowRightIcon
                size={18}
                color={businessPlaceName.trim() && businessPhone.trim() && confirmedPlace ? "#FFFFFF" : "#9CA3AF"}
                strokeWidth={2.5}
              />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep("otop")} activeOpacity={0.7} className="mt-3 items-center">
              <Text className="text-gray-400 text-[13px]">ย้อนกลับไปทะเบียน OTOP</Text>
            </TouchableOpacity>
          </>
        )}

        {step === "username" ? (
          <>
            <Text className="text-2xl font-black text-gray-900 mb-1">ตั้งชื่อผู้ใช้</Text>
            <Text className="text-gray-500 text-[13px] mb-6 leading-5">
              ชื่อผู้ใช้ (username) ใช้เป็นชื่อเฉพาะของคุณ ห้ามซ้ำกับคนอื่น และตั้งได้ครั้งเดียว
            </Text>

            <View className="flex-row items-center bg-gray-100 rounded-xl px-3.5">
              <Text className="text-gray-400 text-[15px]">@</Text>
              <TextInput
                value={username}
                onChangeText={(t) => {
                  setUsername(t);
                  setAvailable(null);
                }}
                placeholder="username"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 py-3 text-[15px] text-gray-900 ml-1"
              />
              {checking ? (
                <ActivityIndicator size="small" color="#2D6A4F" />
              ) : available === true ? (
                <CheckCircleIcon size={22} color="#2D6A4F" />
              ) : available === false ? (
                <XCircleIcon size={22} color="#DC2626" />
              ) : null}
            </View>

            <TouchableOpacity onPress={checkUsername} activeOpacity={0.7} className="self-start mt-2">
              <Text className="text-[#2D6A4F] text-[12px] font-semibold">ตรวจสอบชื่อนี้</Text>
            </TouchableOpacity>

            {available === true && (
              <Text className="text-emerald-600 text-[12px] mt-1">ใช้ชื่อนี้ได้ ✓</Text>
            )}
            {available === false && (
              <Text className="text-red-500 text-[12px] mt-1">ชื่อนี้ถูกใช้แล้ว</Text>
            )}

            <TouchableOpacity
              onPress={goStep2}
              disabled={checking || !validFormat}
              activeOpacity={0.85}
              className={`mt-8 py-4 rounded-2xl flex-row items-center justify-center ${
                validFormat && !checking ? "bg-[#2D6A4F]" : "bg-gray-200"
              }`}
            >
              <Text className={`font-bold text-[15px] mr-1.5 ${validFormat ? "text-white" : "text-gray-400"}`}>
                ถัดไป
              </Text>
              <ArrowRightIcon size={18} color={validFormat ? "#FFFFFF" : "#9CA3AF"} strokeWidth={2.5} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setStep(role === "host" ? "business" : "role")}
              activeOpacity={0.7}
              className="mt-3 items-center"
            >
              <Text className="text-gray-400 text-[13px]">ย้อนกลับ</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {step === "details" && (
          <>
            <Text className="text-2xl font-black text-gray-900 mb-1">ข้อมูลโปรไฟล์</Text>
            <Text className="text-gray-500 text-[13px] mb-6">กรอกชื่อ รูป และเบอร์ติดต่อ</Text>

            {/* Avatar */}
            <View className="items-center mb-6">
              <TouchableOpacity onPress={pickAvatar} activeOpacity={0.8}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={{ width: 96, height: 96, borderRadius: 48 }} />
                ) : (
                  <View className="w-24 h-24 rounded-full bg-gray-100 items-center justify-center border-2 border-dashed border-gray-300">
                    <CameraIcon size={28} color="#9CA3AF" />
                  </View>
                )}
              </TouchableOpacity>
              <Text className="text-gray-400 text-[12px] mt-2">แตะเพื่อเลือกรูปโปรไฟล์</Text>
            </View>

            <Text className="text-gray-700 font-bold text-[13px] mb-1.5">ชื่อที่แสดง</Text>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="เช่น ป้าสมศรี ชุมชนห้วยห้อม"
              placeholderTextColor="#9CA3AF"
              className="bg-gray-100 rounded-xl px-3.5 py-3 text-[15px] text-gray-900 mb-4"
            />

            <Text className="text-gray-700 font-bold text-[13px] mb-1.5">
              เบอร์โทร <Text className="text-gray-400 font-normal">(ไม่บังคับ)</Text>
            </Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="08x-xxx-xxxx"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              className="bg-gray-100 rounded-xl px-3.5 py-3 text-[15px] text-gray-900 mb-8"
            />

            <TouchableOpacity
              onPress={handleSave}
              disabled={saving || !displayName.trim()}
              activeOpacity={0.85}
              className={`py-4 rounded-2xl items-center justify-center ${
                displayName.trim() && !saving ? "bg-[#2D6A4F]" : "bg-gray-200"
              }`}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text className={`font-bold text-[15px] ${displayName.trim() ? "text-white" : "text-gray-400"}`}>
                  บันทึกและเริ่มใช้งาน
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep("username")} activeOpacity={0.7} className="mt-3 items-center">
              <Text className="text-gray-400 text-[13px]">ย้อนกลับไปแก้ชื่อผู้ใช้</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}
