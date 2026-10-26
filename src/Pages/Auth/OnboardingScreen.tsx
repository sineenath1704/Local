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
  ChevronDownIcon,
} from "react-native-heroicons/outline";
import { useAuth } from "../../state/AuthContext";
import { verifyOtop, type OtopProfile } from "../../services/otopService";
import { verifyPlaceOnGoogle, type PlaceCandidate } from "../../services/placesService";
import {
  BIZ_TYPE_OPTIONS,
  PRICE_UNITS,
  detectBusinessProfile,
  formatClosedDaysStr,
  formatDayGroupLabel,
  formatHourRange,
  formatPriceStr,
  parseDayGroupFromLabel,
  parseHourRange,
  parseOpeningHours,
  profileFor,
  resolvePriceUnit,
  composeHoursJson,
  composePricingJson,
  type BizType,
  type ParsedGoogleHours,
} from "../../lib/businessProfile";
import EditableValueRow from "../../components/EditableValueRow";
import DayPickerSheet from "../../components/DayPickerSheet";
import TimeRangeSheet, { type TimeRangeSheetProps } from "../../components/TimeRangeSheet";
import { upsertMyPlace, syntheticPlaceId, mapsUrlFor } from "../../services/hostPlaceService";
import { findCommunityByOtopVillage } from "../../services/communityService";

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
  const { isUsernameAvailable, completeOnboarding, user, session } = useAuth();
  // id ของผู้ใช้ที่ล็อกอินอยู่ — ใช้เป็นกุญแจของแถวที่สังเคราะห์ (ไม่มี timestamp)
  const uid = session?.user?.id ?? user?.id ?? null;

  const [step, setStep] = useState<Step>("role");

  // Role + OTOP verification
  const [role, setRole] = useState<"tourist" | "host" | null>(null);
  const [villageId, setVillageId] = useState("");
  const [otopChecking, setOtopChecking] = useState(false);
  const [otop, setOtop] = useState<OtopProfile | null>(null);

  // Host business profile
  const [bizType, setBizType] = useState<BizType>("homestay");
  // Weekday/weekend day arrays — the wizard edits these via DayPickerSheet and
  // the displayed label (rebuilt below) comes from them. Default values come
  // from the homestay profile so the user sees something meaningful before
  // they pick a Google place or a business-type chip.
  const [weekdayDays, setWeekdayDays] = useState<string[]>(
    () => parseDayGroupFromLabel(profileFor("homestay").weekdayLabel)?.days ?? []
  );
  const [weekendDays, setWeekendDays] = useState<string[]>(
    () => parseDayGroupFromLabel(profileFor("homestay").weekendLabel)?.days ?? []
  );
  // Hours stay as text inputs for the legacy seed path (seeded from
  // parseOpeningHours on a Google pick); TimeRangeSheet writes via the
  // dedicated state added below.
  const [weekdayHoursText, setWeekdayHoursText] = useState("");
  const [weekendHoursText, setWeekendHoursText] = useState("");
  const [closedDayKeys, setClosedDayKeys] = useState<string[]>([]);
  const [weekdayPrice, setWeekdayPrice] = useState("");
  const [weekendPrice, setWeekendPrice] = useState("");
  const [priceUnit, setPriceUnit] = useState("/ คืน");
  const [customUnit, setCustomUnit] = useState("");

  // Each Google-derived section shows its value and stays read-only until the
  // host asks to change it — most of what Google returns is already right, so
  // a wall of empty-looking inputs made the step feel like typing, not checking.
  const [editing, setEditing] = useState({
    type: false,
    weekday: false,
    weekend: false,
    closed: false,
    price: false,
  });
  const toggleEditing = (key: keyof typeof editing) =>
    setEditing((prev) => ({ ...prev, [key]: !prev[key] }));

  /**
   * Seed the TimeRangeSheet from whatever hours string we have. If the value
   * came from parseOpeningHours we already know it's two HH:mm tokens; if it's
   * the host's free-text pick we hand the raw value to the sheet so a text
   * like "เปิด 24 ชม." doesn't get rewritten into a meaningless "00:00 -
   * 00:00".
   */
  const seedTimeSheet = (text: string) => {
    if (!text) return { open: null, close: null, allDay: false };
    const range = parseHourRange(text);
    return {
      open: range.allDay ? null : range.open,
      close: range.allDay ? null : range.close,
      allDay: range.allDay,
    };
  };

  // Day labels are rebuilt from the day arrays on every render so the
  // displayed label never goes out of sync with what the host just picked.
  // Prefix is fixed per row — only the day list and note change.
  const weekdayLabel = formatDayGroupLabel("วันธรรมดา", weekdayDays);
  const weekendLabel = formatDayGroupLabel("วันหยุดสุดสัปดาห์", weekendDays);

  const [businessPlaceName, setBusinessPlaceName] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [searchingPin, setSearchingPin] = useState(false);
  const [pinCandidates, setPinCandidates] = useState<PlaceCandidate[]>([]);
  const [confirmedPlace, setConfirmedPlace] = useState<PlaceCandidate | null>(null);
  /**
   * Google Place ID ของหมุดที่ host เลือก — เก็บแยกจาก `confirmedPlace`
   * เพราะหมุดที่ไม่ได้มาจาก Google (fallback ของ OTOP) จะมี placeId เป็น
   * id สังเคราะห์ ซึ่ง **ห้าม** เขียนลง `users.business_place_id`
   * (D2 เทียบด้วย Google id เท่านั้น — id ปลอมเทียบไม่ได้)
   */
  const [googlePlaceId, setGooglePlaceId] = useState<string | null>(null);
  // What Google actually said, kept separate from the editable fields so the
  // registrant can compare the two instead of guessing what was prefilled.
  const [googleHours, setGoogleHours] = useState<ParsedGoogleHours | null>(null);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  // Three pickers used by the weekday / weekend / closed sections. Each is its
  // own state so opening one doesn't accidentally close another, and so the
  // weekday picker (which is purely a layout question) doesn't carry the
  // "เปิดทุกวัน" reset button that the closed picker has.
  const [weekdaySheetOpen, setWeekdaySheetOpen] = useState(false);
  const [weekendSheetOpen, setWeekendSheetOpen] = useState(false);
  const [timeSheet, setTimeSheet] = useState<
    | { which: "weekday" | "weekend"; range: { open: string | null; close: string | null; allDay: boolean } }
    | null
  >(null);

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
    const p = profileFor(type);
    setBizType(type);
    // Day sets come from the new default labels — empty if the profile
    // doesn't pin a day list ("วันธรรมดา" alone, for "custom").
    const wdParsed = parseDayGroupFromLabel(p.weekdayLabel);
    const weParsed = parseDayGroupFromLabel(p.weekendLabel);
    setWeekdayDays(wdParsed?.days ?? []);
    setWeekendDays(weParsed?.days ?? []);
    setPriceUnit(p.priceUnit);
    // Leave hours alone if the host already has them — switching type shouldn't
    // silently rewrite something they typed.
    if (!weekdayHoursText.trim()) setWeekdayHoursText(p.defaultWeekdayHours);
    if (!weekendHoursText.trim()) setWeekendHoursText(p.defaultWeekendHours);
    setEditing((prev) => ({ ...prev, type: false }));
  };

  const selectCandidate = (c: PlaceCandidate) => {
    setConfirmedPlace(c);
    setGooglePlaceId(c.placeId || null);
    if (c.name) setBusinessPlaceName(c.name);
    // Don't stomp a number the host already typed — Google often has none.
    if (c.phone && !businessPhone.trim()) setBusinessPhone(c.phone);

    // Category + day labels come from Google's own classification.
    const detected = detectBusinessProfile(c.types, c.name, c.primaryType);
    setBizType(detected.bizType);
    const wdParsed = parseDayGroupFromLabel(detected.weekdayLabel);
    const weParsed = parseDayGroupFromLabel(detected.weekendLabel);
    setWeekdayDays(wdParsed?.days ?? []);
    setWeekendDays(weParsed?.days ?? []);
    setPriceUnit(detected.priceUnit);

    // Real Google hours beat our defaults; the host then corrects what's wrong.
    const parsed = parseOpeningHours(c.openingHours);
    setGoogleHours(parsed);
    if (parsed) {
      setWeekdayHoursText(parsed.weekdayHours);
      setWeekendHoursText(parsed.weekendHours);
      setClosedDayKeys(parsed.closedDayKeys);
    } else {
      setWeekdayHoursText(detected.defaultWeekdayHours);
      setWeekendHoursText(detected.defaultWeekendHours);
      setClosedDayKeys([]);
    }

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
      // ⚠️ ห้ามใส่ timestamp — `place_id` ต้องนิ่ง (PLAN §2.6.1)
      // ถ้ามี timestamp ทุกครั้งที่บันทึกจะได้แถวใหม่ แล้วแอปต้องเลือก
      // ระหว่างของเก่ากับของใหม่ตอน AI ตอบ
      placeId: uid ? syntheticPlaceId(uid) : "",
      latitude: null,
      longitude: null,
      province: otop?.province ?? null,
      district: otop?.amphur ?? null,
      subdistrict: otop?.tambol ?? null,
      types: ["community"],
    });
    // หมุดนี้ไม่ได้มาจาก Google → ยังไม่มี Google id ให้ผูก (D2)
    setGooglePlaceId(null);
    // No Google pin means no Google data to show — clear it so the card
    // doesn't imply anything was fetched.
    setGoogleHours(null);
    setPinCandidates([]);
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
    // The labels are derived from the day arrays (see weekdayLabel above);
    // we keep the same "${label}: ${hours}" shape so existing rows in DB
    // are still parseable by ProfileLocal.parseStoredHours.
    const wdSegment = `${weekdayLabel}: ${weekdayHoursText.trim()}`.trim();
    const weSegment = `${weekendLabel}: ${weekendHoursText.trim()}`.trim();
    const compOpening = [
      wdSegment && wdSegment.endsWith(":") ? "" : wdSegment,
      weSegment && weSegment.endsWith(":") ? "" : weSegment,
      `วันหยุดร้าน: ${formatClosedDaysStr(closedDayKeys)}`,
    ]
      .filter(Boolean)
      .join(" | ");

    const effectiveUnit = resolvePriceUnit(priceUnit, customUnit);
    const compPrice = formatPriceStr(weekdayPrice, weekendPrice, effectiveUnit);

    const { error } = await completeOnboarding({
      username: normalized,
      displayName: displayName.trim(),
      phone: (role === "host" ? businessPhone.trim() : phone.trim()) || undefined,
      avatarUri,
      role: role ?? "tourist",
      otop: role === "host" ? otop : null,
      businessPlaceName: role === "host" ? businessPlaceName.trim() : undefined,
      businessPriceInfo: role === "host" ? compPrice : undefined,
      businessOpeningHours: role === "host" ? compOpening : undefined,
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

    // Publish the listing for AI chat & search. This used to be a separate
    // fire-and-forget Supabase write, so a failure left the host registered
    // with no row for the AI to read and nobody was told. The backend commits
    // this alongside anything else in one transaction.
    if (role === "host" && confirmedPlace && user?.id) {
      try {
        // ชุมชนของ host — ผูกด้วยเลขทะเบียน OTOP (CDD Village_ID)
        // ซึ่งคือ `communities.otop_village_id` (ไม่เดาจากชื่อ — ชื่อซ้ำกันเยอะ)
        // ถ้ายังไม่มีชุมชนนี้ในทะเบียน (ยังไม่ได้ seed) → null = ยังไม่ผูก
        const community = await findCommunityByOtopVillage(otop?.idNumber ?? null);
        await upsertMyPlace({
          users: {
            // Google Place ID ของหมุดที่ host เลือก — กุญแจที่ผูก host
            // กับสถานที่ของตัวเอง (D2) · null = ยังไม่มีหมุดจาก Google
            businessPlaceId: googlePlaceId,
            communityId: community?.id ?? null,
          },
          place: {
            placeId: confirmedPlace.placeId || syntheticPlaceId(user.id),
            placeName: businessPlaceName.trim(),
            province: confirmedPlace.province || otop?.province || "",
            formattedAddress: confirmedPlace.address || null,
            district: confirmedPlace.district || otop?.amphur || null,
            subdistrict: confirmedPlace.subdistrict || otop?.tambol || null,
            village: otop?.village || null,
            latitude: confirmedPlace.latitude ?? null,
            longitude: confirmedPlace.longitude ?? null,
            googleMapsUrl: mapsUrlFor(
              confirmedPlace.googleMapsUri,
              confirmedPlace.latitude,
              confirmedPlace.longitude
            ),
            phone: businessPhone.trim() || null,
            openingHours: compOpening || null,
            priceInfo: compPrice || null,
            rating: confirmedPlace.rating ?? null,
            userRatingsTotal: confirmedPlace.userRatingCount ?? null,
            website: confirmedPlace.website ?? null,
            // ชุมชนที่สถานที่นี้อยู่ — เป็นที่มาของชื่อ hierarchy (D18)
            communityId: community?.id ?? null,
            // Machine-readable twins of the two strings above.
            businessHours: composeHoursJson({
              weekdayDays,
              weekdayHours: weekdayHoursText,
              weekendDays,
              weekendHours: weekendHoursText,
              dayOffs: closedDayKeys,
            }),
            businessPricing: composePricingJson(
              weekdayPrice,
              weekendPrice,
              effectiveUnit
            ),
          },
        });
      } catch (e: any) {
        // The account itself is registered and usable, so this is a warning
        // rather than a failed save — the host can retry from "แก้ไขร้าน".
        Alert.alert(
          "ลงทะเบียนสำเร็จ แต่ข้อมูลสถานที่ยังไม่ถูกเผยแพร่",
          `${e?.message ?? String(e)}\n\nคุณสามารถลองใหม่ได้ภายหลังจากหน้าโปรไฟล์ > แก้ไขข้อมูลร้าน`
        );
      }
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
                keyboardType="numeric"
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
                <Text className="text-blue-900 font-bold text-[13px] mb-2">
                  📍 พบสถานที่ในเขต {otop.amphur || otop.province} — เลือกเพื่อดึงข้อมูลอัตโนมัติ:
                </Text>
                {pinCandidates.map((c, idx) => (
                  <View key={idx} className="bg-white border border-blue-100 rounded-xl p-3 mb-2.5 shadow-sm">
                    <Text className="text-gray-900 font-bold text-[15px]">📍 {c.name}</Text>
                    <Text className="text-gray-500 text-[12.5px] mt-0.5" numberOfLines={2}>{c.address}</Text>

                    {(c.phone) && (
                      <View className="mt-1.5 pt-1.5 border-t border-gray-100">
                        {c.phone && <Text className="text-gray-600 text-[12.5px]">📞 {c.phone}</Text>}
                      </View>
                    )}

                    <View className="flex-row items-center justify-between mt-2.5">
                      {c.googleMapsUri ? (
                        <TouchableOpacity
                          onPress={() => Linking.openURL(c.googleMapsUri!)}
                          activeOpacity={0.7}
                          className="flex-row items-center px-2 py-1 bg-gray-100 rounded-lg"
                        >
                          <Text className="text-[12.5px] text-blue-700 font-semibold">🗺️ ดูบน Google Maps</Text>
                        </TouchableOpacity>
                      ) : <View />}

                      <TouchableOpacity
                        onPress={() => selectCandidate(c)}
                        activeOpacity={0.85}
                        className="bg-[#2D6A4F] py-1.5 px-3.5 rounded-lg"
                      >
                        <Text className="text-white font-bold text-[12.5px]">✓ เลือกสถานที่นี้</Text>
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
                  <Text className="text-amber-900 font-semibold text-[13px] mb-1">
                    ไม่พบหมุดร้าน &quot;{businessPlaceName.trim()}&quot; บน Google Maps ในเขต {otop.amphur}
                  </Text>
                  <Text className="text-gray-500 text-[12.5px] mb-2.5 leading-5">
                    หากเป็นร้านเปิดใหม่หรือยังไม่มีหมุด สามารถกดใช้พิกัดของชุมชน OTOP แทน และกรอกข้อมูลด้วยตนเองได้เลยค่ะ
                  </Text>
                  <TouchableOpacity
                    onPress={applyOtopFallbackPin}
                    activeOpacity={0.85}
                    className="bg-amber-600 py-2 px-3.5 rounded-xl flex-row items-center justify-center self-start"
                  >
                    <MapPinIcon size={15} color="#FFFFFF" />
                    <Text className="text-white font-bold text-[13px] ml-1.5">
                      📍 ใช้พิกัดของชุมชน OTOP แทน
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

            {/* Confirmed Pin + what Google actually said about it */}
            {confirmedPlace && (
              <View className="mb-2">
                <View className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-3.5 mb-4">
                  <View className="flex-row items-center justify-between mb-1">
                    <View className="flex-row items-center flex-1">
                      <CheckCircleIcon size={18} color="#2D6A4F" />
                      <Text className="text-[#1B4332] font-black text-[13px] ml-1.5">
                        ✓ ยืนยันพิกัดเรียบร้อยแล้ว
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        setConfirmedPlace(null);
                        setGoogleHours(null);
                      }}
                      activeOpacity={0.7}
                      className="px-2 py-0.5 bg-white border border-emerald-200 rounded-lg"
                    >
                      <Text className="text-emerald-700 font-semibold text-[13px]">เปลี่ยนพิกัด</Text>
                    </TouchableOpacity>
                  </View>
                  <Text className="text-gray-800 font-bold text-[15px] mt-0.5">{confirmedPlace.name}</Text>
                  <Text className="text-gray-500 text-[13px] mt-0.5">{confirmedPlace.address}</Text>

                  <View className="flex-row items-center mt-2">
                    {confirmedPlace.googleMapsUri ? (
                      <TouchableOpacity
                        onPress={() => Linking.openURL(confirmedPlace.googleMapsUri!)}
                        activeOpacity={0.7}
                        className="flex-row items-center"
                      >
                        <Text className="text-[13px] text-blue-700 font-semibold">
                          🗺️ ดูตำแหน่งบน Google Maps
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>

                {/* Each block below starts as a plain read-only value. Google's
                    classification and hours are usually right, so the inputs
                    only appear where the host says "เปลี่ยน". */}

                {/* 1. Business type — straight from Google's own tag */}
                <EditableValueRow
                  label="ประเภทสถานประกอบการ"
                  icon={profileFor(bizType).icon}
                  value={profileFor(bizType).badgeLabel}
                  editing={editing.type}
                  onToggle={() => toggleEditing("type")}
                >
                  {confirmedPlace.primaryTypeDisplayName ? (
                    <Text className="text-[13px] text-gray-500 mb-2.5">
                      ตรวจพบจาก Google: &quot;{confirmedPlace.primaryTypeDisplayName}&quot;
                    </Text>
                  ) : null}
                  <View className="flex-row flex-wrap gap-2">
                    {BIZ_TYPE_OPTIONS.map((p) => (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => handleSelectBizType(p.id)}
                        activeOpacity={0.8}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: bizType === p.id }}
                        className={`px-3 py-2 rounded-xl border ${
                          bizType === p.id
                            ? "bg-[#2D6A4F] border-[#2D6A4F]"
                            : "bg-gray-100 border-gray-200"
                        }`}
                      >
                        <Text
                          className={`text-[14px] font-bold ${
                            bizType === p.id ? "text-white" : "text-gray-700"
                          }`}
                        >
                          {p.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </EditableValueRow>

                {/* 2. Weekday: day list + time — pickers, not text inputs */}
                <EditableValueRow
                  label={weekdayLabel || "วันธรรมดา"}
                  icon="🌿"
                  value={weekdayHoursText}
                  editing={editing.weekday}
                  onToggle={() => toggleEditing("weekday")}
                  emptyHint="ยังไม่ได้ระบุเวลาเปิด-ปิด"
                >
                  {/* Day-list picker */}
                  <Text className="text-[13px] font-medium text-gray-600 mb-1.5">
                    วันในสัปดาห์
                  </Text>
                  <TouchableOpacity
                    onPress={() => setWeekdaySheetOpen(true)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    className="flex-row items-center justify-between bg-white border border-gray-200 rounded-xl px-3.5 py-3 mb-3"
                  >
                    <Text className="text-[15px] font-bold text-gray-800">
                      {weekdayLabel || "วันธรรมดา"}
                    </Text>
                    <ChevronDownIcon size={20} color="#2D6A4F" />
                  </TouchableOpacity>

                  {/* Time picker */}
                  <Text className="text-[13px] font-medium text-gray-600 mb-1.5">
                    {bizType === "homestay" ? "เช็คอิน / เช็คเอาท์" : "เวลาเปิด / เวลาปิด"}
                  </Text>
                  <TouchableOpacity
                    onPress={() =>
                      setTimeSheet({
                        which: "weekday",
                        range: seedTimeSheet(weekdayHoursText),
                      })
                    }
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    className="flex-row items-center justify-between bg-white border border-gray-200 rounded-xl px-3.5 py-3"
                  >
                    <Text className="text-[15px] font-bold text-gray-800">
                      {weekdayHoursText || (bizType === "homestay"
                        ? "เลือกเวลาเช็คอิน / เช็คเอาท์"
                        : "เลือกเวลาเปิด-ปิด")}
                    </Text>
                    <ChevronDownIcon size={20} color="#2D6A4F" />
                  </TouchableOpacity>
                </EditableValueRow>

                {/* 3. Weekend: day list + time — same pickers */}
                <EditableValueRow
                  label={weekendLabel || "วันหยุดสุดสัปดาห์"}
                  icon="🔥"
                  tone="amber"
                  value={weekendHoursText}
                  editing={editing.weekend}
                  onToggle={() => toggleEditing("weekend")}
                  emptyHint="ยังไม่ได้ระบุเวลาเปิด-ปิด"
                >
                  <Text className="text-[13px] font-medium text-gray-600 mb-1.5">
                    วันในสัปดาห์
                  </Text>
                  <TouchableOpacity
                    onPress={() => setWeekendSheetOpen(true)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    className="flex-row items-center justify-between bg-white border border-amber-200 rounded-xl px-3.5 py-3 mb-3"
                  >
                    <Text className="text-[15px] font-bold text-gray-800">
                      {weekendLabel || "วันหยุดสุดสัปดาห์"}
                    </Text>
                    <ChevronDownIcon size={20} color="#2D6A4F" />
                  </TouchableOpacity>

                  <Text className="text-[13px] font-medium text-gray-600 mb-1.5">
                    {bizType === "homestay" ? "เช็คอิน / เช็คเอาท์" : "เวลาเปิด / เวลาปิด"}
                  </Text>
                  <TouchableOpacity
                    onPress={() =>
                      setTimeSheet({
                        which: "weekend",
                        range: seedTimeSheet(weekendHoursText),
                      })
                    }
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    className="flex-row items-center justify-between bg-white border border-amber-200 rounded-xl px-3.5 py-3"
                  >
                    <Text className="text-[15px] font-bold text-gray-800">
                      {weekendHoursText || (bizType === "homestay"
                        ? "เลือกเวลาเช็คอิน / เช็คเอาท์"
                        : "เลือกเวลาเปิด-ปิด")}
                    </Text>
                    <ChevronDownIcon size={20} color="#2D6A4F" />
                  </TouchableOpacity>
                </EditableValueRow>

                {/* 4. Closed days — pick from a checklist, not seven 42px chips */}
                <EditableValueRow
                  label="วันที่ปิดทำการ"
                  icon="🚫"
                  value={formatClosedDaysStr(closedDayKeys)}
                  editing={editing.closed}
                  onToggle={() => toggleEditing("closed")}
                >
                  <TouchableOpacity
                    onPress={() => setDaySheetOpen(true)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    className="flex-row items-center justify-between bg-white border border-gray-200 rounded-xl px-3.5 py-3"
                  >
                    <Text className="text-[15px] font-bold text-gray-800">
                      เลือกวันที่ปิดทำการ
                    </Text>
                    <ChevronDownIcon size={20} color="#2D6A4F" />
                  </TouchableOpacity>
                  {googleHours && googleHours.closedDayKeys.length > 0 ? (
                    <Text className="text-[12.5px] text-gray-500 mt-2">
                      ตั้งจากข้อมูล Google — ตรวจสอบให้ตรงกับที่จริง
                    </Text>
                  ) : null}
                </EditableValueRow>

                {/* 5. Price — numeric keypad plus a unit, never free text */}
                <EditableValueRow
                  label="อัตราค่าบริการ"
                  icon="💰"
                  value={formatPriceStr(
                    weekdayPrice,
                    weekendPrice,
                    resolvePriceUnit(priceUnit, customUnit)
                  )}
                  editing={editing.price}
                  onToggle={() => toggleEditing("price")}
                  emptyHint="ยังไม่ได้ระบุราคา"
                >
                  <Text className="text-[13px] text-gray-600 font-medium mb-1.5">
                    หน่วยบริการ
                  </Text>
                  <View className="flex-row flex-wrap gap-1.5 mb-2">
                    {PRICE_UNITS.map((u) => (
                      <TouchableOpacity
                        key={u.id}
                        onPress={() => setPriceUnit(u.id)}
                        activeOpacity={0.8}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: priceUnit === u.id }}
                        className={`px-3 py-1.5 rounded-xl border ${
                          priceUnit === u.id
                            ? "bg-[#2D6A4F] border-[#2D6A4F]"
                            : "bg-white border-gray-200"
                        }`}
                      >
                        <Text
                          className={`text-[14px] font-bold ${
                            priceUnit === u.id ? "text-white" : "text-gray-700"
                          }`}
                        >
                          {u.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {priceUnit === "custom" ? (
                    <TextInput
                      value={customUnit}
                      onChangeText={setCustomUnit}
                      placeholder="ระบุหน่วย เช่น / ทริป, / จาน, / ชุด"
                      placeholderTextColor="#9CA3AF"
                      className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[15px] text-gray-900 mb-2"
                    />
                  ) : null}

                  <Text className="text-[13px] text-gray-600 font-medium mb-1">
                    วันธรรมดา
                  </Text>
                  <View className="flex-row items-center bg-white border border-gray-200 rounded-xl px-3 mb-2">
                    <Text className="text-[15px] font-bold text-gray-400 mr-1">฿</Text>
                    <TextInput
                      value={weekdayPrice}
                      onChangeText={setWeekdayPrice}
                      keyboardType="numeric"
                      placeholder="เช่น 500"
                      placeholderTextColor="#9CA3AF"
                      className="flex-1 text-[15px] font-bold text-gray-900 py-2.5"
                    />
                  </View>

                  <Text className="text-[13px] text-amber-800 font-medium mb-1">
                    วันหยุด / เทศกาล
                  </Text>
                  <View className="flex-row items-center bg-white border border-amber-200 rounded-xl px-3">
                    <Text className="text-[15px] font-bold text-gray-400 mr-1">฿</Text>
                    <TextInput
                      value={weekendPrice}
                      onChangeText={setWeekendPrice}
                      keyboardType="numeric"
                      placeholder="เช่น 750"
                      placeholderTextColor="#9CA3AF"
                      className="flex-1 text-[15px] font-bold text-gray-900 py-2.5"
                    />
                  </View>
                </EditableValueRow>

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

      <DayPickerSheet
        visible={daySheetOpen}
        selected={closedDayKeys}
        onCancel={() => setDaySheetOpen(false)}
        onConfirm={(days) => {
          setClosedDayKeys(days);
          setDaySheetOpen(false);
        }}
      />

      <DayPickerSheet
        visible={weekdaySheetOpen}
        selected={weekdayDays}
        title="เลือกวันธรรมดา"
        resetLabel=""
        selectedLabel="ใช่"
        unselectedLabel="ไม่ใช่"
        onCancel={() => setWeekdaySheetOpen(false)}
        onConfirm={(days) => {
          setWeekdayDays(days);
          setWeekdaySheetOpen(false);
        }}
      />

      <DayPickerSheet
        visible={weekendSheetOpen}
        selected={weekendDays}
        title="เลือกวันหยุดสุดสัปดาห์"
        resetLabel=""
        selectedLabel="ใช่"
        unselectedLabel="ไม่ใช่"
        onCancel={() => setWeekendSheetOpen(false)}
        onConfirm={(days) => {
          setWeekendDays(days);
          setWeekendSheetOpen(false);
        }}
      />

      <TimeRangeSheet
        visible={timeSheet !== null}
        kind={bizType === "homestay" ? "checkin" : "hours"}
        initialRange={timeSheet?.range ?? { open: null, close: null, allDay: false }}
        onCancel={() => setTimeSheet(null)}
        onConfirm={(range) => {
          if (!timeSheet) return;
          const formatted = formatHourRange(range, bizType === "homestay" ? "checkin" : "hours");
          if (timeSheet.which === "weekday") {
            setWeekdayHoursText(formatted);
          } else {
            setWeekendHoursText(formatted);
          }
          setTimeSheet(null);
        }}
      />
    </View>
  );
}
