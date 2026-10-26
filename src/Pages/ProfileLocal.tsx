import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  useWindowDimensions,
  Modal,
  Platform,
  TextInput,
  ActivityIndicator,
  Alert,
  Linking,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Cog8ToothIcon,
  PlayIcon as PlayOutline,
  XMarkIcon,
  ShieldCheckIcon,
  PencilSquareIcon,
  FolderIcon,
  FolderPlusIcon,
  BuildingStorefrontIcon,
  CheckCircleIcon,
  MapPinIcon,
  PlusIcon,
  ChevronDownIcon,
} from "react-native-heroicons/outline";
import {
  MapPinIcon as MapPinSolid,
  BookmarkIcon as BookmarkSolid,
  HeartIcon as HeartSolid,
  PlayIcon as PlaySolid,
} from "react-native-heroicons/solid";

import { VideoItemData } from "../data/profileLocalData";
import { useMyProfile } from "../state/MyProfileContext";
import { useAuth } from "../state/AuthContext";
import { useInteractions } from "../state/InteractionContext";
import { useMyVideos } from "../hooks/useMyVideos";
import { loadLikedVideos, loadSavedVideos } from "../services/interactionService";
import type { VideoPost } from "../data/homeFeedData";
import { getVideoById } from "../data/profilesData";
import { resolveSavedVideo } from "../data/tripsData";
import { verifyPlaceOnGoogle, type PlaceCandidate } from "../services/placesService";
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
  parsePriceStr,
  profileFor,
  resolvePriceUnit,
  splitPriceUnit,
  parseStoredHours,
  formatStoredHours,
  composeHoursJson,
  composePricingJson,
  type BizType,
} from "../lib/businessProfile";
import { upsertMyPlace, syntheticPlaceId, mapsUrlFor } from "../services/hostPlaceService";
import {
  communitySourceLabel,
  fetchCommunityPlaces,
  findCommunityById,
  findCommunityByOtopVillage,
  type CommunityPlaceRow,
  type CommunityRow,
} from "../services/communityService";
import { verifyOtop, type OtopProfile } from "../services/otopService";
import EditProfileSheet from "../components/EditProfileSheet";
import SettingsSheet from "../components/SettingsSheet";
import MyVideoViewer from "../components/MyVideoViewer";
import EditableValueRow from "../components/EditableValueRow";
import DayPickerSheet from "../components/DayPickerSheet";
import TimeRangeSheet from "../components/TimeRangeSheet";

type ProfileTabKey = "videos" | "saved" | "liked" | "community";

interface ProfileLocalProps {
  onOpenFolder?: (folderId: string) => void;
  onFullScreenChange?: (full: boolean) => void;
  /**
   * เปิด flow "เป็นคนแรกที่เพิ่มสถานที่ในชุมชน" (PLAN §7.1 · empty state)
   * — ส่งพื้นที่ของชุมชนไปให้หน้าเพิ่มโพสต์เติมให้
   */
  onAddFirstPlace?: (area: {
    community?: string | null;
    subdistrict?: string | null;
    district?: string | null;
    province?: string | null;
  }) => void;
}

export default function ProfileLocal({
  onOpenFolder,
  onFullScreenChange,
  onAddFirstPlace,
}: ProfileLocalProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const { name, username, bio, avatar, location } = useMyProfile();
  const { user, refreshUser, claimHostRole } = useAuth();
  const { followingCount, likedVideoIds, savedVideoIds, folders, createFolder } = useInteractions();

  const isOtopHost = user?.role === "host" && user?.otop_verified;

  // Own posted videos — real data from Supabase (no mock).
  const { videos: myVideos } = useMyVideos();

  const followersCount = 0;
  const totalLikesReceived = myVideos.reduce((sum, v) => sum + v.likesCount, 0);

  const [activeTab, setActiveTab] = useState<ProfileTabKey>("videos");
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [viewerVideoId, setViewerVideoId] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // ── D16 — ทางกลับมา: ยืนยันตัวตนเป็น host จากหน้าโปรไฟล์ ──
  // คนที่สมัครเป็นนักท่องเที่ยวแต่เป็นเจ้าของชุมชนจริง ต้องเลื่อนบทบาท
  // ได้เอง โดยยืนยันเลขทะเบียน OTOP (D9 บังคับให้ host ต้องมี OTOP)
  const [showClaimHost, setShowClaimHost] = useState(false);
  const [claimVillageId, setClaimVillageId] = useState("");
  const [claimChecking, setClaimChecking] = useState(false);
  const [claimProfile, setClaimProfile] = useState<OtopProfile | null>(null);

  // Business Profile Edit state (Smart Ergonomics)
  const [bizType, setBizType] = useState<BizType>("homestay");
  // Day arrays — labels are derived from these via formatDayGroupLabel, so
  // there is no setter for a "label string". Day labels come from the homestay
  // default so the modal opens with something meaningful even before the host
  // picks a Google place.
  const [bizWeekdayDays, setBizWeekdayDays] = useState<string[]>(
    () => parseDayGroupFromLabel(profileFor("homestay").weekdayLabel)?.days ?? []
  );
  const [bizWeekendDays, setBizWeekendDays] = useState<string[]>(
    () => parseDayGroupFromLabel(profileFor("homestay").weekendLabel)?.days ?? []
  );
  const [bizWeekendNote, setBizWeekendNote] = useState<string | null>(null);
  // Hours stay as text inputs from the modal's perspective; TimeRangeSheet
  // writes the formatted string back. Parsers may hand us e.g. "เปิด 24 ชม."
  // or "เช็คอิน 14:00 / เช็คเอาท์ 11:00" via parseHourRange / formatHourRange.
  const [bizWeekdayHoursText, setBizWeekdayHoursText] = useState("");
  const [bizWeekendHoursText, setBizWeekendHoursText] = useState("");
  const [bizDayOffs, setBizDayOffs] = useState<string[]>([]);
  const [bizWeekdayPrice, setBizWeekdayPrice] = useState("");
  const [bizWeekendPrice, setBizWeekendPrice] = useState("");
  const [bizPriceUnit, setBizPriceUnit] = useState("/ คืน");
  const [bizCustomUnit, setBizCustomUnit] = useState("");

  // Labels are rebuilt from the day arrays on every render so the displayed
  // label never drifts from what the host just picked in the picker.
  const bizWeekdayLabel = formatDayGroupLabel("วันธรรมดา", bizWeekdayDays);
  const bizWeekendLabel = formatDayGroupLabel(
    "วันหยุดสุดสัปดาห์",
    bizWeekendDays,
    bizWeekendNote
  );

  // Per-section editing, same shape as the registration wizard: the modal opens
  // showing what Google gave us, and each row reveals its inputs only after the
  // host asks to change that one thing.
  const [bizEditing, setBizEditing] = useState({
    type: false,
    weekday: false,
    weekend: false,
    closed: false,
    price: false,
  });
  const toggleBizEditing = (key: keyof typeof bizEditing) =>
    setBizEditing((prev) => ({ ...prev, [key]: !prev[key] }));
  const [bizDaySheetOpen, setBizDaySheetOpen] = useState(false);
  // Each picker is its own state so opening one doesn't accidentally close
  // another; weekday + weekend sheets hide the "เปิดทุกวัน" reset because for
  // groups "no specific days" is the legitimate default state.
  const [bizWeekdaySheetOpen, setBizWeekdaySheetOpen] = useState(false);
  const [bizWeekendSheetOpen, setBizWeekendSheetOpen] = useState(false);
  // One TimeRangeSheet serves both rows. `which` decides on confirm which
  // string to write back; the sheet itself only needs the open/close/allDay
  // triple.
  const [bizTimeSheet, setBizTimeSheet] = useState<
    | null
    | {
      which: "weekday" | "weekend";
      range: { open: string | null; close: string | null; allDay: boolean };
    }
  >(null);

  // Hybrid secondary service (e.g. on-site Cafe or Activity)
  const [hasSecondaryBiz, setHasSecondaryBiz] = useState(false);
  const [secondaryBizType, setSecondaryBizType] = useState<"cafe" | "activity" | "shop">("cafe");
  const [secondaryInheritSchedule, setSecondaryInheritSchedule] = useState(true);
  const [secondaryHours, setSecondaryHours] = useState("08:30 - 17:00");
  const [secondaryPrice, setSecondaryPrice] = useState("");
  const [secondaryPriceUnit, setSecondaryPriceUnit] = useState("/ เมนู");

  const [showEditBusiness, setShowEditBusiness] = useState(false);
  const [bizPlaceName, setBizPlaceName] = useState("");
  const [bizPhone, setBizPhone] = useState("");
  const [bizSaving, setBizSaving] = useState(false);
  const [bizGpsCandidates, setBizGpsCandidates] = useState<PlaceCandidate[]>([]);
  const [bizGpsLoading, setBizGpsLoading] = useState(false);
  const [bizConfirmedPlace, setBizConfirmedPlace] = useState<PlaceCandidate | null>(null);
  /**
   * Google Place ID ของหมุดที่ host เลือก — เก็บแยกจาก `bizConfirmedPlace`
   * เพราะหมุด fallback (ไม่ได้มาจาก Google) มี placeId เป็น id สังเคราะห์
   * ซึ่ง **ห้าม** เขียนลง `users.business_place_id` (D2 เทียบด้วย Google id เท่านั้น)
   */
  const [bizGooglePlaceId, setBizGooglePlaceId] = useState<string | null>(null);

  // ── ชุมชนของฉัน (PLAN §7.1) ────────────────────────────────────────
  // ชุมชนมาจาก `users.community_id` ก่อน — ถ้ายังไม่มี (migration ยังไม่รัน
  // หรือ host เก่าที่ยังไม่ได้ผูก) → หาจากเลขทะเบียน OTOP ที่ยืนยันไว้
  const [myCommunity, setMyCommunity] = useState<CommunityRow | null>(null);
  const [communityPlaces, setCommunityPlaces] = useState<CommunityPlaceRow[]>([]);
  const [communityPartial, setCommunityPartial] = useState(false);
  const [communityShown, setCommunityShown] = useState(20);

  // แท็บ "ชุมชน" มีได้เฉพาะคนที่มีชุมชนจริง — tourist ที่ยังไม่มีชุมชน
  // ไม่ต้องเห็นแท็บเปล่า (PLAN §2.2.4: ห้ามเป็นหน้าว่าง)
  const showCommunityTab = user?.role === "host" || Boolean(user?.community_id);

  /** พื้นที่ของชุมชนที่แสดงในหัวแท็บ — ถ้าไม่มีในทะเบียน ใช้ข้อมูล OTOP ของ host */
  const communityArea = {
    community: myCommunity?.name ?? user?.otop_village ?? null,
    subdistrict: myCommunity?.subdistrict ?? user?.otop_tambol ?? null,
    district: myCommunity?.district ?? user?.otop_amphur ?? null,
    province: myCommunity?.province ?? user?.otop_province ?? null,
  };

  const handleSelectBizType = (type: BizType) => {
    setBizType(type);
    setBizEditing((prev) => ({ ...prev, type: false }));
    const p = profileFor(type);
    // Day sets come from the new default labels — empty when the profile
    // doesn't pin a specific day list ("วันธรรมดา" alone for "custom").
    const wdParsed = parseDayGroupFromLabel(p.weekdayLabel);
    const weParsed = parseDayGroupFromLabel(p.weekendLabel);
    setBizWeekdayDays(wdParsed?.days ?? []);
    setBizWeekendDays(weParsed?.days ?? []);
    setBizWeekendNote(weParsed?.note ?? null);
    setBizPriceUnit(p.priceUnit);
    // Leave hours alone if the host already set them — switching type
    // shouldn't silently overwrite something they chose.
    if (!bizWeekdayHoursText.trim()) setBizWeekdayHoursText(p.defaultWeekdayHours);
    if (!bizWeekendHoursText.trim()) setBizWeekendHoursText(p.defaultWeekendHours);
  };

  /**
   * Seed the TimeRangeSheet from whatever hours string we currently hold. If
   * the parser bailed (AM/PM, ambiguous text) we hand the sheet a clean
   * starting pair so the host can re-pick rather than re-type.
   */
  const seedBizTimeSheet = (text: string) => {
    if (!text) return { open: null, close: null, allDay: false };
    const range = parseHourRange(text);
    return {
      open: range.allDay ? null : range.open,
      close: range.allDay ? null : range.close,
      allDay: range.allDay,
    };
  };

  const parsePrimaryPriceStr = (rawPrice: string) => {
    const { weekdayPrice, weekendPrice, unit } = parsePriceStr(rawPrice);
    const { chipId, customUnit } = splitPriceUnit(unit);
    setBizWeekdayPrice(weekdayPrice);
    setBizWeekendPrice(weekendPrice);
    setBizPriceUnit(chipId);
    setBizCustomUnit(customUnit);
  };

  const openEditBusiness = () => {
    const pName = user?.business_place_name || user?.otop_village || "";
    setBizPlaceName(pName);
    setBizPhone(user?.business_phone || user?.phone_number || "");
    setBizEditing({ type: false, weekday: false, weekend: false, closed: false, price: false });

    // 1. Deconstruct Price Info
    const rawPrice = user?.business_price_info || "";
    if (rawPrice.includes("||")) {
      const [priP, secP] = rawPrice.split("||").map((x: string) => x.trim());
      parsePrimaryPriceStr(priP);

      setHasSecondaryBiz(true);
      if (secP.includes("คาเฟ่")) {
        setSecondaryBizType("cafe");
        setSecondaryPriceUnit("/ เมนู");
      } else if (secP.includes("กิจกรรม")) {
        setSecondaryBizType("activity");
        setSecondaryPriceUnit("/ ท่าน");
      } else {
        setSecondaryBizType("shop");
        setSecondaryPriceUnit("/ ชิ้น");
      }

      const secPriceMatch = secP.match(/\d+(?:-\d+)?/);
      if (secPriceMatch) setSecondaryPrice(secPriceMatch[0]);
    } else {
      setHasSecondaryBiz(false);
      setSecondaryPrice("");
      parsePrimaryPriceStr(rawPrice);
    }

    // 2. Deconstruct Opening Hours via the shared parser. Cuts off at the
    //    "||" if a secondary service is attached, so the weekdays/weekends
    //    here only ever come from the primary service.
    const rawHours = user?.business_opening_hours || "";
    const primaryHours = rawHours.split("||")[0]?.trim() ?? "";
    const parsed = parseStoredHours(primaryHours);

    {
      const wd = parseDayGroupFromLabel(parsed.weekday?.label ?? "");
      const we = parseDayGroupFromLabel(parsed.weekend?.label ?? "");
      setBizWeekdayDays(wd?.days ?? []);
      setBizWeekendDays(we?.days ?? []);
      setBizWeekendNote(we?.note ?? null);
    }
    setBizWeekdayHoursText(parsed.weekday?.hours ?? "");
    setBizWeekendHoursText(parsed.weekend?.hours ?? "");
    setBizDayOffs(parsed.closed?.dayKeys ?? []);

    // 3. Pin coordinates & initial auto-detect
    setBizGpsCandidates([]);
    if (user?.business_place_name && user?.business_lat && user?.business_lng) {
      const cand: PlaceCandidate = {
        name: user.business_place_name,
        address: user.business_address || "",
        // กุญแจของสถานที่ = Google id ที่ host เคยเลือกไว้
        // (ถ้าใช้ id สังเคราะห์แทน การบันทึกครั้งต่อไปจะกลายเป็นแถวใหม่
        //  แล้วแถวเดิมที่ AI ตอบอยู่จะกลายเป็นขยะ)
        placeId: user.business_place_id || "",
        latitude: user.business_lat,
        longitude: user.business_lng,
        province: user.business_province || user.otop_province || null,
        district: user.business_district || user.otop_amphur || null,
        subdistrict: user.business_subdistrict || user.otop_tambol || null,
        types: [],
      };
      setBizConfirmedPlace(cand);
      setBizGooglePlaceId(user.business_place_id || null);
      const detected = detectBusinessProfile([], cand.name);
      setBizType(detected.bizType);
      const wdParsed = parseDayGroupFromLabel(detected.weekdayLabel);
      const weParsed = parseDayGroupFromLabel(detected.weekendLabel);
      setBizWeekdayDays(wdParsed?.days ?? []);
      setBizWeekendDays(weParsed?.days ?? []);
      setBizWeekendNote(weParsed?.note ?? null);
    } else {
      setBizConfirmedPlace(null);
    }
    setShowEditBusiness(true);
  };

  const selectBizCandidate = (c: PlaceCandidate) => {
    setBizConfirmedPlace(c);
    setBizGooglePlaceId(c.placeId || null);
    setBizPlaceName(c.name);
    if (c.phone) setBizPhone(c.phone);

    const detected = detectBusinessProfile(c.types, c.name, c.primaryType);
    setBizType(detected.bizType);
    const wdParsed = parseDayGroupFromLabel(detected.weekdayLabel);
    const weParsed = parseDayGroupFromLabel(detected.weekendLabel);
    setBizWeekdayDays(wdParsed?.days ?? []);
    setBizWeekendDays(weParsed?.days ?? []);
    setBizWeekendNote(weParsed?.note ?? null);
    setBizPriceUnit(detected.priceUnit);
    if (!bizWeekdayHoursText) setBizWeekdayHoursText(detected.defaultWeekdayHours);
    if (!bizWeekendHoursText) setBizWeekendHoursText(detected.defaultWeekendHours);

    // Google's weekday_text is its own shape ("จันทร์: 08:00 – 17:00 | …") —
    // the shared parser now handles that too, so we feed it through the same
    // path as a previously-saved host row.
    if (c.openingHours) {
      const parsed = parseStoredHours(c.openingHours);
      if (parsed.weekday?.hours) setBizWeekdayHoursText(parsed.weekday.hours);
      if (parsed.weekend?.hours) setBizWeekendHoursText(parsed.weekend.hours);
      if (parsed.closed?.dayKeys) setBizDayOffs(parsed.closed.dayKeys);
    }

    setBizGpsCandidates([]);
  };

  /**
   * D16 — ยืนยันตัวตนเป็น host จากหน้าโปรไฟล์
   *
   * ขั้นที่ 1: กรอกเลขทะเบียน → เช็กกับทะเบียน CDD
   * ขั้นที่ 2: เจอแล้ว → ผูกชุมชน (ถ้ามีในทะเบียน) → เลื่อน role = host
   */
  const checkClaimVillage = async () => {
    const id = claimVillageId.trim();
    if (!id) {
      Alert.alert("กรอกเลขทะเบียน", "กรุณากรอกเลขทะเบียน OTOP นวัตวิถี");
      return;
    }
    setClaimChecking(true);
    const r = await verifyOtop(id);
    setClaimChecking(false);
    if (!r.configured) {
      Alert.alert("ยังพร้อมใช้งานไม่ได้", "ระบบยืนยัน OTOP ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์");
      return;
    }
    if (!r.verified || !r.profile) {
      setClaimProfile(null);
      Alert.alert("ไม่พบทะเบียน", r.error ?? "ไม่พบเลขทะเบียนนี้ในระบบ OTOP กรุณาตรวจสอบอีกครั้ง");
      return;
    }
    setClaimProfile(r.profile);
  };

  const confirmClaimHost = async () => {
    if (!claimProfile) return;
    setClaimChecking(true);
    const community = await findCommunityByOtopVillage(claimProfile.idNumber);
    const { error } = await claimHostRole({
      otop: claimProfile,
      communityId: community?.id ?? null,
    });
    setClaimChecking(false);
    if (error) {
      Alert.alert("ยืนยันไม่สำเร็จ", error);
      return;
    }
    await refreshUser();
    setShowClaimHost(false);
    setClaimProfile(null);
    setClaimVillageId("");
    Alert.alert(
      "ยืนยันตัวตนเป็น host แล้ว",
      community
        ? `ผูกกับชุมชน "${community.name}" เรียบร้อยแล้ว — แก้ไขข้อมูลร้านได้จากปุ่ม "แก้ไขร้าน"`
        : "ยืนยันเรียบร้อยแล้ว — แก้ไขข้อมูลร้านได้จากปุ่ม \"แก้ไขร้าน\""
    );
  };

  const applyBizOtopFallback = () => {
    const otopFallback: PlaceCandidate = {
      name: bizPlaceName.trim(),
      address: [
        user?.otop_village,
        user?.otop_tambol && `ต.${user.otop_tambol}`,
        user?.otop_amphur && `อ.${user.otop_amphur}`,
        user?.otop_province && `จ.${user.otop_province}`,
      ]
        .filter(Boolean)
        .join(" "),
      placeId: user?.id ? syntheticPlaceId(user.id) : "",
      latitude: user?.business_lat ?? 0,
      longitude: user?.business_lng ?? 0,
      province: user?.otop_province ?? null,
      district: user?.otop_amphur ?? null,
      subdistrict: user?.otop_tambol ?? null,
      types: ["point_of_interest"],
    };
    setBizConfirmedPlace(otopFallback);
    // หมุดนี้ไม่ได้มาจาก Google → ยังไม่มี Google id ให้ผูก (D2)
    setBizGooglePlaceId(null);
    setBizGpsCandidates([]);
  };

  // ค้นหาพิกัด Google Maps อัตโนมัติเมื่อผู้ใช้พิมพ์ชื่อสถานที่ (Debounce 500ms)
  useEffect(() => {
    if (!showEditBusiness) return;
    const query = bizPlaceName.trim();
    if (!query || query.length < 2) {
      setBizGpsCandidates([]);
      setBizGpsLoading(false);
      return;
    }
    // หากเลือกหมุดชื่อนี้ไปแล้ว ไม่ต้องค้นหาซ้ำ
    if (bizConfirmedPlace && bizConfirmedPlace.name === query) {
      return;
    }

    setBizGpsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await verifyPlaceOnGoogle({
          placeName: query,
          community: user?.otop_village ?? undefined,
          district: user?.otop_amphur ?? undefined,
          province: user?.otop_province ?? undefined,
        });
        setBizGpsCandidates(res.candidates);
      } catch (err: any) {
        console.warn("[ProfileLocal] search GPS error:", err);
      } finally {
        setBizGpsLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [bizPlaceName, showEditBusiness, user?.otop_village, user?.otop_amphur, user?.otop_province, bizConfirmedPlace]);

  const handleSaveBusiness = async () => {
    if (!bizPhone.trim()) {
      Alert.alert("กรุณาระบุเบอร์โทร", "เบอร์โทรศัพท์จำเป็นสำหรับการติดต่อสถานที่ประกอบการ");
      return;
    }
    setBizSaving(true);
    // Round-trip through the shared parser/format pair — same path the wizard
    // uses, so a re-edit pulls back exactly what the host just saved.
    const primaryOpening = formatStoredHours({
      weekday:
        bizWeekdayDays.length > 0 || bizWeekdayHoursText.trim()
          ? { label: bizWeekdayLabel || "วันธรรมดา", hours: bizWeekdayHoursText.trim() }
          : undefined,
      weekend:
        bizWeekendDays.length > 0 || bizWeekendHoursText.trim()
          ? {
            label: bizWeekendLabel || "วันหยุดสุดสัปดาห์",
            hours: bizWeekendHoursText.trim(),
          }
          : undefined,
      closed: { isAllDays: bizDayOffs.length === 0, dayKeys: bizDayOffs },
      hasUnknown: false,
      unknownSegments: [],
    });

    let compOpening = primaryOpening;
    if (hasSecondaryBiz) {
      const secName =
        secondaryBizType === "cafe"
          ? "คาเฟ่/เครื่องดื่ม"
          : secondaryBizType === "activity"
            ? "กิจกรรม"
            : "ร้านค้าชุมชน";
      const detectedInfo = detectBusinessProfile(bizConfirmedPlace?.types, bizPlaceName, bizConfirmedPlace?.primaryType);
      let secSchedule = "";
      if (secondaryInheritSchedule) {
        secSchedule = `วัน-เวลาเปิดเดียวกับ${detectedInfo.badgeLabel}`;
      } else {
        secSchedule = `เวลา ${secondaryHours.trim() || "08:30 - 17:00"}`;
      }
      compOpening = `${primaryOpening} || ${secName}: ${secSchedule}`;
    }

    const effectiveUnit = resolvePriceUnit(bizPriceUnit, bizCustomUnit);
    const primaryPrice = formatPriceStr(bizWeekdayPrice, bizWeekendPrice, effectiveUnit);

    let compPrice = primaryPrice;
    if (hasSecondaryBiz && secondaryPrice.trim()) {
      const secName =
        secondaryBizType === "cafe" ? "คาเฟ่" : secondaryBizType === "activity" ? "กิจกรรม" : "สินค้า";
      compPrice = `${primaryPrice || "ตามตกลง"} || ${secName}: ${secondaryPrice.trim()} บาท${secondaryPriceUnit}`;
    }

    try {
      // ชุมชนของ host — ผูกด้วยเลขทะเบียน OTOP (CDD Village_ID) ซึ่งคือ
      // `communities.otop_village_id` · ถ้ายังไม่มีในทะเบียน → null (ยังไม่ผูก)
      const community = user?.community_id
        ? { id: user.community_id }
        : await findCommunityByOtopVillage(user?.otop_village_id);

      // One transaction covers the profile AND the community_places row the AI
      // reads. Previously these were two round-trips and the second was
      // fire-and-forget, so a rejected write left the host looking saved while
      // the AI had nothing to ground its answers on.
      await upsertMyPlace({
        users: {
          businessPlaceName: bizPlaceName.trim(),
          businessPriceInfo: compPrice,
          // Was computed above and then dropped on the floor — the hours a host
          // set here vanished the next time they opened this modal.
          businessOpeningHours: compOpening,
          businessPhone: bizPhone.trim(),
          businessLat: bizConfirmedPlace?.latitude ?? user?.business_lat ?? null,
          businessLng: bizConfirmedPlace?.longitude ?? user?.business_lng ?? null,
          businessAddress: bizConfirmedPlace?.address ?? user?.business_address ?? null,
          businessSubdistrict: bizConfirmedPlace?.subdistrict ?? user?.business_subdistrict ?? user?.otop_tambol ?? null,
          businessDistrict: bizConfirmedPlace?.district ?? user?.business_district ?? user?.otop_amphur ?? null,
          businessProvince: bizConfirmedPlace?.province ?? user?.business_province ?? user?.otop_province ?? null,
          // กุญแจที่ผูก host กับสถานที่ของตัวเอง (D2) — null = ยังไม่มีหมุดจาก Google
          businessPlaceId: bizGooglePlaceId,
          // ชุมชนที่ host สังกัด
          communityId: community?.id ?? null,
        },
        // Skipped when the host hasn't confirmed a location on the map — their
        // profile still saves, and they can add the place later.
        place: bizConfirmedPlace && user?.id
          ? {
            placeId: bizConfirmedPlace.placeId || syntheticPlaceId(user.id),
            placeName: bizPlaceName.trim(),
            province: bizConfirmedPlace.province || user?.otop_province || "",
            formattedAddress: bizConfirmedPlace.address || null,
            district: bizConfirmedPlace.district || user?.otop_amphur || null,
            subdistrict: bizConfirmedPlace.subdistrict || user?.otop_tambol || null,
            village: user?.otop_village || null,
            latitude: bizConfirmedPlace.latitude ?? null,
            longitude: bizConfirmedPlace.longitude ?? null,
            googleMapsUrl: mapsUrlFor(
              bizConfirmedPlace.googleMapsUri,
              bizConfirmedPlace.latitude,
              bizConfirmedPlace.longitude
            ),
            phone: bizPhone.trim() || null,
            openingHours: compOpening || null,
            priceInfo: compPrice || null,
            rating: bizConfirmedPlace.rating ?? null,
            userRatingsTotal: bizConfirmedPlace.userRatingCount ?? null,
            website: bizConfirmedPlace.website ?? null,
            // ชุมชนที่สถานที่นี้อยู่ — เป็นที่มาของชื่อ hierarchy (D18)
            communityId: community?.id ?? null,
            // Machine-readable twins of the two strings above — this is what
            // lets the AI answer "เปิดวันอาทิตย์ไหม" without re-parsing prose.
            businessHours: composeHoursJson({
              weekdayDays: bizWeekdayDays,
              weekdayHours: bizWeekdayHoursText,
              weekendDays: bizWeekendDays,
              weekendHours: bizWeekendHoursText,
              dayOffs: bizDayOffs,
            }),
            businessPricing: composePricingJson(
              bizWeekdayPrice,
              bizWeekendPrice,
              effectiveUnit,
              hasSecondaryBiz && secondaryPrice.trim()
                ? {
                  label:
                    secondaryBizType === "cafe"
                      ? "คาเฟ่"
                      : secondaryBizType === "activity"
                        ? "กิจกรรม"
                        : "สินค้า",
                  amount: secondaryPrice.trim(),
                  unit: secondaryPriceUnit,
                }
                : null
            ),
          }
          : undefined,
      });

      await refreshUser();
      setBizSaving(false);
      setShowEditBusiness(false);
      Alert.alert("สำเร็จ", "อัปเดตข้อมูลสถานที่ประกอบการเรียบร้อยแล้ว");
    } catch (e: any) {
      setBizSaving(false);
      Alert.alert(
        "บันทึกไม่สำเร็จ",
        `${e?.message ?? String(e)}\n\nข้อมูลจะยังไม่ถูกบันทึก กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง`
      );
    }
  };

  // Liked tab: the current user's liked videos, loaded from Supabase.
  const likedKey = likedVideoIds.join(",");
  const [likedVideos, setLikedVideos] = useState<VideoPost[]>([]);
  useEffect(() => {
    let active = true;
    loadLikedVideos().then((v) => {
      console.log("[profile] likedVideos fetched =", v.length, "likedIds =", likedVideoIds.length);
      if (active) setLikedVideos(v);
    });
    return () => {
      active = false;
    };
  }, [likedKey]);

  // Saved tab: loose saves (not in any folder), loaded from Supabase.
  const inFolderIds = new Set(folders.flatMap((f) => f.videoIds));
  const looseSavedIds = savedVideoIds.filter((id) => !inFolderIds.has(id));
  const looseKey = looseSavedIds.join(",");
  const [looseSaved, setLooseSaved] = useState<VideoPost[]>([]);
  useEffect(() => {
    let active = true;
    loadSavedVideos(looseKey ? looseKey.split(",") : []).then((v) => {
      console.log("[profile] looseSaved fetched =", v.length, "savedIds =", savedVideoIds.length, "loose =", looseSavedIds.length);
      if (active) setLooseSaved(v);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looseKey]);

  // ── โหลดชุมชน + สถานที่ในชุมชน (PLAN §7.1) ─────────────────────────
  // ชุมชนมาจาก `users.community_id` ก่อน ถ้าไม่มีค่อยหาจากเลขทะเบียน OTOP
  // (ชื่อหมู่บ้านซ้ำกันเยอะ — เลขทะเบียนคือตัวระบุที่เชื่อถือได้)
  useEffect(() => {
    let active = true;
    const load = async () => {
      const byId = await findCommunityById(user?.community_id);
      const row = byId ?? (await findCommunityByOtopVillage(user?.otop_village_id));
      if (!active) return;
      setMyCommunity(row);
      if (!row?.id) {
        setCommunityPlaces([]);
        setCommunityPartial(false);
        return;
      }
      const { places, partial } = await fetchCommunityPlaces(row.id);
      if (!active) return;
      setCommunityPlaces(places);
      setCommunityPartial(partial);
    };
    void load();
    return () => {
      active = false;
    };
  }, [user?.id, user?.community_id, user?.otop_village_id]);

  const gridItemWidth = (screenWidth - 4) / 3;

  const handleCreateFolder = () => {
    const n = newFolderName.trim();
    if (!n) return;
    createFolder(n);
    setNewFolderName("");
    setShowNewFolder(false);
  };

  // Tell host to hide the bottom bar while the own-video viewer is open
  React.useEffect(() => {
    onFullScreenChange?.(viewerVideoId !== null);
  }, [viewerVideoId, onFullScreenChange]);

  // Full-screen own-video viewer (feed-style) with edit/delete
  if (viewerVideoId) {
    return <MyVideoViewer initialVideoId={viewerVideoId} onBack={() => setViewerVideoId(null)} />;
  }

  return (
    <View className="flex-1 bg-white w-full h-full">
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <View className="flex-1 w-full bg-white">
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingTop: Math.max(insets.top, 16) + (Platform.OS === "android" ? 10 : 6),
            paddingBottom: Math.max(insets.bottom, 20) + 80,
          }}
        >
          {/* 1. Header (Settings Gear) */}
          <View className="px-5 flex-row justify-end items-center mb-1">
            <TouchableOpacity
              onPress={() => setShowSettings(true)}
              activeOpacity={0.7}
              className="w-10 h-10 items-center justify-center -mr-2"
            >
              <Cog8ToothIcon size={26} color="#18181B" strokeWidth={1.8} />
            </TouchableOpacity>
          </View>

          {/* 2. Location */}
          {location ? (
            <View className="px-5 flex-row items-center mb-3">
              <MapPinSolid size={16} color="#EF4444" />
              <Text className="text-gray-500 text-[13px] font-medium ml-1.5">{location}</Text>
            </View>
          ) : null}

          {/* 3. Name / Username / Bio + Avatar (editable via pencil) */}
          <View className="px-5 flex-row items-start justify-between mb-5">
            <View className="flex-1 pr-3">
              <View className="flex-row items-center mb-0.5">
                <Text className="text-2xl font-black text-black tracking-tight">{name}</Text>
                <TouchableOpacity onPress={() => setShowEdit(true)} activeOpacity={0.7} className="ml-2 p-1">
                  <PencilSquareIcon size={18} color="#2D6A4F" />
                </TouchableOpacity>
              </View>
              <Text className="text-sm font-semibold text-gray-700 mb-2">{username}</Text>
              {bio ? (
                <Text className="text-[13px] text-gray-800 leading-5">{bio}</Text>
              ) : (
                <Text className="text-[13px] text-gray-400 italic leading-5">ยังไม่ได้เขียนแนะนำตัว</Text>
              )}
            </View>

            <TouchableOpacity onPress={() => setShowEdit(true)} activeOpacity={0.85} className="items-center justify-center">
              {avatar ? (
                <Image
                  source={avatar}
                  style={{ width: 97, height: 97, borderRadius: 97 / 2 }}
                  className="bg-gray-100 border border-gray-200"
                  resizeMode="cover"
                />
              ) : (
                <View
                  style={{ width: 97, height: 97, borderRadius: 97 / 2 }}
                  className="bg-emerald-100 border border-gray-200 items-center justify-center"
                >
                  <Text className="text-[#2D6A4F] font-black text-4xl">
                    {name.trim().charAt(0)}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* 4. Stats + info button */}
          <View className="px-5 flex-row items-center justify-between mb-6">
            <View className="flex-row items-center">
              <View className="items-start mr-5">
                <Text className="text-base font-bold text-black tracking-tight">{followingCount}</Text>
                <Text className="text-[11px] text-gray-500 mt-0.5">กำลังติดตาม</Text>
              </View>
              <View className="items-start mr-5">
                <Text className="text-base font-bold text-black tracking-tight">{followersCount}</Text>
                <Text className="text-[11px] text-gray-500 mt-0.5">ผู้ติดตาม</Text>
              </View>
              <View className="items-start">
                <Text className="text-base font-bold text-black tracking-tight">{totalLikesReceived}</Text>
                <Text className="text-[11px] text-gray-500 mt-0.5">ถูกใจ</Text>
              </View>
            </View>

            {isOtopHost ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setShowInfoModal(true)}
                  activeOpacity={0.8}
                  className="bg-[#D47A3A] px-3.5 py-2.5 rounded-xl flex-row items-center justify-center shadow-sm"
                >
                  <ShieldCheckIcon size={14} color="#FFFFFF" />
                  <Text className="text-white text-xs font-bold tracking-wide ml-1">OTOP</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={openEditBusiness}
                  activeOpacity={0.8}
                  className="bg-emerald-700 px-3.5 py-2.5 rounded-xl flex-row items-center justify-center shadow-sm"
                >
                  <BuildingStorefrontIcon size={14} color="#FFFFFF" />
                  <Text className="text-white text-xs font-bold tracking-wide ml-1">แก้ไขร้าน</Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* D16 — ทางกลับมา: ผู้ใช้ที่สมัครเป็นนักท่องเที่ยวแต่เป็นเจ้าของ
                 ชุมชนจริง ยืนยันเลขทะเบียน OTOP เพื่อเลื่อนบทบาทเองได้ */
              <TouchableOpacity
                onPress={() => setShowClaimHost(true)}
                activeOpacity={0.8}
                className="bg-[#D47A3A] px-3.5 py-2.5 rounded-xl flex-row items-center justify-center shadow-sm self-start"
              >
                <ShieldCheckIcon size={14} color="#FFFFFF" />
                <Text className="text-white text-xs font-bold tracking-wide ml-1">
                  ยืนยันตัวตนเป็น host
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* 5. Tabs */}
          <View className="flex-row items-center border-b border-gray-200">
            <TouchableOpacity
              onPress={() => setActiveTab("videos")}
              activeOpacity={0.7}
              className={`flex-1 py-3 items-center flex-row justify-center border-b-2 ${activeTab === "videos" ? "border-black" : "border-transparent"}`}
            >
              <PlaySolid size={14} color={activeTab === "videos" ? "#000000" : "#6B7280"} />
              <Text className={`ml-1.5 text-xs ${activeTab === "videos" ? "font-bold text-black" : "font-medium text-gray-500"}`}>วิดีโอ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab("saved")}
              activeOpacity={0.7}
              className={`flex-1 py-3 items-center flex-row justify-center border-b-2 ${activeTab === "saved" ? "border-black" : "border-transparent"}`}
            >
              <BookmarkSolid size={14} color={activeTab === "saved" ? "#00D26A" : "#6B7280"} />
              <Text className={`ml-1.5 text-xs ${activeTab === "saved" ? "font-bold text-black" : "font-medium text-gray-500"}`}>วิดีโอที่บันทึก</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab("liked")}
              activeOpacity={0.7}
              className={`flex-1 py-3 items-center flex-row justify-center border-b-2 ${activeTab === "liked" ? "border-black" : "border-transparent"}`}
            >
              <HeartSolid size={14} color={activeTab === "liked" ? "#EF4444" : "#6B7280"} />
              <Text className={`ml-1.5 text-xs ${activeTab === "liked" ? "font-bold text-black" : "font-medium text-gray-500"}`}>วิดีโอที่ถูกใจ</Text>
            </TouchableOpacity>
            {/* แท็บ "ชุมชน" — มีเฉพาะคนที่มีชุมชนจริง (host หรือผู้ที่ผูกชุมชนไว้) */}
            {showCommunityTab && (
              <TouchableOpacity
                onPress={() => setActiveTab("community")}
                activeOpacity={0.7}
                className={`flex-1 py-3 items-center flex-row justify-center border-b-2 ${activeTab === "community" ? "border-black" : "border-transparent"}`}
              >
                <MapPinSolid size={14} color={activeTab === "community" ? "#2D6A4F" : "#6B7280"} />
                <Text className={`ml-1.5 text-xs ${activeTab === "community" ? "font-bold text-black" : "font-medium text-gray-500"}`}>ชุมชน</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* 6a. VIDEOS tab — owned videos (tap → feed-style viewer w/ edit & delete) */}
          {activeTab === "videos" && (
            <View className="flex-row flex-wrap">
              {myVideos.length > 0 ? (
                myVideos.map((video, index) => (
                  <TouchableOpacity
                    key={video.id}
                    onPress={() => setViewerVideoId(video.id)}
                    activeOpacity={0.85}
                    style={{
                      width: gridItemWidth,
                      height: gridItemWidth * 1.35,
                      marginRight: (index + 1) % 3 === 0 ? 0 : 2,
                      marginBottom: 2,
                    }}
                    className="bg-gray-100 relative overflow-hidden"
                  >
                    <Image
                      source={video.thumbnailUrl ? { uri: video.thumbnailUrl } : avatar}
                      className="w-full h-full"
                      resizeMode="cover"
                    />
                    <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 40, backgroundColor: "rgba(0,0,0,0.35)" }} />
                    <View className="absolute bottom-1.5 left-1.5 flex-row items-center">
                      <PlayOutline size={12} color="#FFFFFF" strokeWidth={2.5} />
                      <Text className="text-white text-[11px] font-bold ml-1">{video.likesCount}</Text>
                    </View>
                  </TouchableOpacity>
                ))
              ) : (
                <View className="w-full py-16 items-center justify-center">
                  <Text className="text-gray-400 text-sm">ยังไม่มีวิดีโอที่โพสต์</Text>
                </View>
              )}
            </View>
          )}

          {/* 6b. SAVED tab — folders on top (+create), loose clips below */}
          {activeTab === "saved" && (
            <View className="px-4 pt-4">
              {/* Create folder */}
              <TouchableOpacity
                onPress={() => setShowNewFolder(true)}
                activeOpacity={0.8}
                className="flex-row items-center bg-amber-50 border border-amber-200 rounded-2xl p-3.5 mb-3"
              >
                <View className="w-10 h-10 rounded-xl bg-amber-100 items-center justify-center mr-3">
                  <FolderPlusIcon size={22} color="#D47A3A" />
                </View>
                <Text className="text-[#B45309] font-bold text-[14px]">สร้างโฟลเดอร์ใหม่</Text>
              </TouchableOpacity>

              {/* Folders */}
              {folders.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  onPress={() => onOpenFolder?.(f.id)}
                  activeOpacity={0.8}
                  className="flex-row items-center bg-gray-50 border border-gray-100 rounded-2xl p-3.5 mb-2.5"
                >
                  <View className="w-10 h-10 rounded-xl bg-gray-200 items-center justify-center mr-3">
                    <FolderIcon size={22} color="#4B5563" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-gray-900 font-bold text-[14px]">{f.name}</Text>
                    <Text className="text-gray-400 text-[12px]">{f.videoIds.length} คลิป</Text>
                  </View>
                  <PlayOutline size={16} color="#9CA3AF" />
                </TouchableOpacity>
              ))}

              {/* Loose saved clips (not in any folder) */}
              <Text className="text-gray-400 text-[11px] font-bold mt-3 mb-2 uppercase">คลิปที่บันทึกไว้ (ยังไม่ได้จัดโฟลเดอร์)</Text>
              {looseSaved.length > 0 ? (
                <View className="flex-row flex-wrap -mx-0.5">
                  {looseSaved.map((v, index) => (
                    <View
                      key={v.id}
                      style={{ width: (screenWidth - 32 - 8) / 3, height: ((screenWidth - 32 - 8) / 3) * 1.35, margin: 2 }}
                      className="bg-gray-100 relative overflow-hidden rounded-lg"
                    >
                      {v.poster ? (
                        <Image source={v.poster} className="w-full h-full" resizeMode="cover" />
                      ) : (
                        <View className="w-full h-full items-center justify-center">
                          <PlayOutline size={20} color="#9CA3AF" />
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              ) : (
                <Text className="text-gray-400 text-[13px] py-6 text-center">
                  ยังไม่มีคลิปที่บันทึกนอกโฟลเดอร์
                </Text>
              )}
            </View>
          )}

          {/* 6c. LIKED tab */}
          {activeTab === "liked" && (
            <View className="flex-row flex-wrap">
              {likedVideos.length > 0 ? (
                likedVideos.map((video, index) => (
                  <View
                    key={video.id}
                    style={{
                      width: gridItemWidth,
                      height: gridItemWidth * 1.35,
                      marginRight: (index + 1) % 3 === 0 ? 0 : 2,
                      marginBottom: 2,
                    }}
                    className="bg-gray-100 relative overflow-hidden"
                  >
                    {video.poster ? (
                      <Image source={video.poster} className="w-full h-full" resizeMode="cover" />
                    ) : (
                      <View className="w-full h-full items-center justify-center">
                        <PlayOutline size={20} color="#9CA3AF" />
                      </View>
                    )}
                    <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 40, backgroundColor: "rgba(0,0,0,0.35)" }} />
                    <View className="absolute bottom-1.5 left-1.5 flex-row items-center">
                      <PlayOutline size={12} color="#FFFFFF" strokeWidth={2.5} />
                      <Text className="text-white text-[11px] font-bold ml-1">{video.initialLikes}</Text>
                    </View>
                  </View>
                ))
              ) : (
                <View className="w-full py-16 items-center justify-center">
                  <Text className="text-gray-400 text-sm">ยังไม่มีวิดีโอที่ถูกใจ</Text>
                </View>
              )}
            </View>
          )}

          {/* 6d. COMMUNITY tab — สถานที่ในชุมชนของฉัน (PLAN §7.1 · D20/D21) */}
          {activeTab === "community" && (
            <View className="px-4 pt-4">
              {/* หัวชุมชน */}
              <View className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 mb-3">
                <Text className="text-emerald-900 font-black text-[15px]">
                  🏘️ {communityArea.community || "ชุมชนของฉัน"}
                </Text>
                <Text className="text-emerald-700 text-[11px] mt-0.5">
                  {[
                    communityArea.subdistrict && `ต.${communityArea.subdistrict}`,
                    communityArea.district && `อ.${communityArea.district}`,
                    communityArea.province && `จ.${communityArea.province}`,
                  ]
                    .filter(Boolean)
                    .join(" • ") || "ยังไม่ทราบพื้นที่"}
                </Text>
                <Text className="text-emerald-700 text-[11px] mt-1.5 font-semibold">
                  {communityPlaces.length > 0
                    ? `มี ${communityPlaces.length} แห่งที่ยืนยันแล้ว`
                    : "ยังไม่มีสถานที่ที่ยืนยันแล้วในชุมชนนี้"}
                </Text>
                {!myCommunity && communityArea.community ? (
                  <Text className="text-amber-700 text-[11px] mt-1 leading-4">
                    ชุมชนนี้ยังไม่อยู่ในทะเบียนของระบบ — ข้อมูลที่เพิ่มจะผูกกับชุมชน
                    เมื่อมีการ seed ทะเบียน
                  </Text>
                ) : null}
                {communityPartial ? (
                  <Text className="text-amber-700 text-[11px] mt-1 leading-4">
                    ระบบยังอ่านข้อมูลบางส่วนไม่ได้ (เช่น ราคา/เวลาเปิด) — แสดงเฉพาะที่อ่านได้
                  </Text>
                ) : null}
              </View>

              {communityPlaces.length > 0 ? (
                <>
                  {communityPlaces.slice(0, communityShown).map((p) => {
                    const priceBits = [
                      p.price_info && `ราคา: ${p.price_info}`,
                      p.price_level && `ระดับราคา: ${p.price_level}`,
                    ].filter(Boolean) as string[];
                    return (
                      <TouchableOpacity
                        key={p.place_id || p.place_name}
                        onPress={() => {
                          if (p.google_maps_url) void Linking.openURL(p.google_maps_url);
                        }}
                        activeOpacity={0.8}
                        className="bg-white border border-gray-200 rounded-2xl p-3.5 mb-2.5"
                      >
                        <View className="flex-row items-start justify-between mb-1">
                          <Text className="text-gray-900 font-bold text-[14px] flex-1 mr-2">
                            {p.place_name}
                          </Text>
                          {/* ป้ายที่มาของข้อมูล (D21) */}
                          <View className="px-2 py-0.5 rounded-full bg-gray-100">
                            <Text className="text-[10px] font-bold text-gray-600">
                              {communitySourceLabel(p.source)}
                            </Text>
                          </View>
                        </View>

                        {p.formatted_address ? (
                          <Text className="text-gray-500 text-[11px] leading-4">
                            📍 {p.formatted_address}
                          </Text>
                        ) : null}

                        {priceBits.length > 0 ? (
                          <Text className="text-gray-700 text-[12px] font-semibold mt-1.5">
                            💰 {priceBits.join(" • ")}
                          </Text>
                        ) : null}

                        {p.opening_hours ? (
                          <Text className="text-gray-600 text-[11px] mt-1">
                            🕒 เปิด: {p.opening_hours}
                          </Text>
                        ) : null}
                        {p.phone ? (
                          <Text className="text-gray-600 text-[11px] mt-0.5">📞 {p.phone}</Text>
                        ) : null}
                        {p.website ? (
                          <Text className="text-gray-600 text-[11px] mt-0.5" numberOfLines={1}>
                            🌐 {p.website}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}

                  {communityPlaces.length > communityShown ? (
                    <TouchableOpacity
                      onPress={() => setCommunityShown((n) => n + 20)}
                      activeOpacity={0.85}
                      className="bg-gray-100 border border-gray-200 rounded-2xl py-3 items-center justify-center mt-1"
                    >
                      <Text className="text-gray-700 font-bold text-[12.5px]">
                        ดูเพิ่มเติม (อีก {Math.min(20, communityPlaces.length - communityShown)} แห่ง)
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              ) : (
                /* Empty state — ห้ามเป็นหน้าว่าง (PLAN §2.2.4) */
                <View className="items-center py-10 px-4">
                  <Text className="text-gray-700 font-bold text-[14px] text-center">
                    ยังไม่มีสถานที่ในชุมชนนี้
                  </Text>
                  <Text className="text-gray-400 text-[11.5px] text-center mt-1.5 leading-5">
                    เป็นคนแรกที่เพิ่มสถานที่ให้ชุมชน — AI จะใช้ข้อมูลนี้ตอบคำถามนักท่องเที่ยว
                    ว่าที่ไหนเปิด ราคาเท่าไร และมีอะไรให้ทำบ้าง
                  </Text>
                  <TouchableOpacity
                    onPress={() => onAddFirstPlace?.(communityArea)}
                    activeOpacity={0.85}
                    className="mt-4 bg-emerald-700 px-5 py-3 rounded-2xl flex-row items-center shadow-sm"
                  >
                    <PlusIcon size={16} color="#FFFFFF" />
                    <Text className="text-white font-bold text-[13px] ml-1.5">
                      เป็นคนแรกที่เพิ่ม
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </View>

      {/* Edit profile + settings sheets */}
      <EditProfileSheet visible={showEdit} onClose={() => setShowEdit(false)} />
      <SettingsSheet visible={showSettings} onClose={() => setShowSettings(false)} />

      {/* New folder modal */}
      <Modal visible={showNewFolder} transparent animationType="fade" onRequestClose={() => setShowNewFolder(false)}>
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-3xl w-full max-w-sm p-5">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg font-black text-gray-900">สร้างโฟลเดอร์ใหม่</Text>
              <TouchableOpacity onPress={() => setShowNewFolder(false)} className="p-1">
                <XMarkIcon size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <TextInput
              value={newFolderName}
              onChangeText={setNewFolderName}
              placeholder="ชื่อโฟลเดอร์ เช่น ทริปเชียงใหม่"
              placeholderTextColor="#9CA3AF"
              autoFocus
              className="bg-gray-100 rounded-xl px-3.5 py-3 text-[14px] text-gray-900 mb-4"
            />
            <TouchableOpacity
              onPress={handleCreateFolder}
              disabled={!newFolderName.trim()}
              activeOpacity={0.85}
              className={`py-3 rounded-2xl items-center ${newFolderName.trim() ? "bg-[#2D6A4F]" : "bg-gray-200"}`}
            >
              <Text className={`font-bold text-[15px] ${newFolderName.trim() ? "text-white" : "text-gray-400"}`}>สร้าง</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Registration info modal (read-only, from OTOP registration) */}
      <Modal visible={showInfoModal} transparent animationType="fade" onRequestClose={() => setShowInfoModal(false)}>
        <View className="flex-1 bg-black/60 items-center justify-center px-5">
          <View className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <View className="flex-row items-center justify-between pb-3 border-b border-gray-100 mb-4">
              <View className="flex-row items-center">
                <ShieldCheckIcon size={22} color="#2D6A4F" />
                <Text className="text-lg font-bold text-gray-900 ml-2">ชุมชน OTOP นวัตวิถี</Text>
              </View>
              <TouchableOpacity onPress={() => setShowInfoModal(false)} className="w-8 h-8 rounded-full bg-gray-100 items-center justify-center">
                <XMarkIcon size={18} color="#4B5563" />
              </TouchableOpacity>
            </View>

            {/* Verified badge */}
            <View className="bg-emerald-50 rounded-xl p-3 border border-emerald-200 mb-4 flex-row items-center">
              <ShieldCheckIcon size={18} color="#2D6A4F" />
              <Text className="text-[#1B4332] text-[12px] font-semibold ml-2">
                ยืนยันกับทะเบียน OTOP แล้ว (เลขทะเบียน {user?.otop_village_id ?? "-"})
              </Text>
            </View>

            {[
              ["ชื่อ OTOP นวัตวิถี", user?.otop_nawatwithi],
              ["OTOP เพื่อการท่องเที่ยว", user?.otop_for_tourism],
              ["หมู่บ้านท่องเที่ยวโดยชุมชน", user?.otop_cbt_village],
              ["หมู่บ้าน", user?.otop_village],
              ["ตำบล", user?.otop_tambol],
              ["อำเภอ", user?.otop_amphur],
              ["จังหวัด", user?.otop_province],
              ["ภูมิภาค", user?.otop_region],
            ].map(([label, val], i) => (
              <View key={i} className="mb-2.5">
                <Text className="text-[11px] text-gray-400">{label}</Text>
                <Text className="text-sm font-semibold text-gray-800">{val || "ยังไม่ได้ระบุ"}</Text>
              </View>
            ))}

            <View className="bg-amber-50 rounded-xl p-3 border border-amber-200/60 mb-4">
              <Text className="text-amber-800 text-[11px] leading-4">
                📌 ข้อมูลส่วนนี้ดึงจากทะเบียน OTOP นวัตวิถี (กรมการพัฒนาชุมชน) แก้ไขในแอปไม่ได้
              </Text>
            </View>

            <TouchableOpacity onPress={() => setShowInfoModal(false)} className="bg-[#2D6A4F] py-3 rounded-xl items-center">
              <Text className="text-white text-sm font-bold">ตกลง</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* D16 — ทางกลับมา: ยืนยันตัวตนเป็น host */}
      <Modal visible={showClaimHost} transparent animationType="fade" onRequestClose={() => setShowClaimHost(false)}>
        <View className="flex-1 bg-black/60 items-center justify-center px-5">
          <View className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <View className="flex-row items-center justify-between pb-3 border-b border-gray-100 mb-4">
              <View className="flex-row items-center">
                <ShieldCheckIcon size={22} color="#D47A3A" />
                <Text className="text-lg font-bold text-gray-900 ml-2">ยืนยันตัวตนเป็น host</Text>
              </View>
              <TouchableOpacity onPress={() => setShowClaimHost(false)} className="w-8 h-8 rounded-full bg-gray-100 items-center justify-center">
                <XMarkIcon size={18} color="#4B5563" />
              </TouchableOpacity>
            </View>

            {!claimProfile ? (
              <>
                <Text className="text-gray-600 text-[13px] leading-5 mb-3">
                  กรอกเลขทะเบียนผู้ประกอบการ OTOP นวัตวิถี เพื่อยืนยันว่าเป็นเจ้าของชุมชน — บทบาทจะเปลี่ยนเป็น host และค้นหาสถานที่ในชุมชนได้
                </Text>
                <TextInput
                  value={claimVillageId}
                  onChangeText={(t) => {
                    setClaimVillageId(t);
                    setClaimProfile(null);
                  }}
                  keyboardType="numeric"
                  placeholder="เช่น 123456"
                  placeholderTextColor="#9CA3AF"
                  className="bg-gray-100 rounded-xl px-3.5 py-3 text-[15px] text-gray-900 mb-3"
                />
                <TouchableOpacity
                  onPress={() => void checkClaimVillage()}
                  disabled={claimChecking || !claimVillageId.trim()}
                  activeOpacity={0.85}
                  className={`py-3.5 rounded-xl items-center ${
                    claimChecking || !claimVillageId.trim() ? "bg-gray-200" : "bg-[#D47A3A]"
                  }`}
                >
                  {claimChecking ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text className={`font-bold text-[14px] ${claimVillageId.trim() ? "text-white" : "text-gray-400"}`}>
                      ตรวจสอบทะเบียน
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View className="bg-emerald-50 rounded-xl p-3 border border-emerald-200 mb-4">
                  <Text className="text-[#1B4332] text-[13px] font-semibold">
                    {claimProfile.otopNawatwithi || claimProfile.village || "ยืนยันแล้ว"}
                  </Text>
                  <Text className="text-gray-600 text-[12px] mt-0.5">
                    {[claimProfile.village, claimProfile.tambol && `ต.${claimProfile.tambol}`,
                      claimProfile.amphur && `อ.${claimProfile.amphur}`, claimProfile.province]
                      .filter(Boolean)
                      .join(" • ")}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => void confirmClaimHost()}
                  disabled={claimChecking}
                  activeOpacity={0.85}
                  className={`py-3.5 rounded-xl items-center ${claimChecking ? "bg-gray-200" : "bg-[#2D6A4F]"}`}
                >
                  {claimChecking ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text className="text-white font-bold text-[14px]">ยืนยันเป็น host</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
      {/* Edit Business Profile Modal */}
      <Modal visible={showEditBusiness} animationType="slide" transparent onRequestClose={() => setShowEditBusiness(false)}>
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white rounded-t-3xl p-5" style={{ height: "50%" }}>
            <View className="flex-row items-center justify-between pb-3 border-b border-gray-100 mb-3">
              <View className="flex-row items-center">
                <BuildingStorefrontIcon size={20} color="#2D6A4F" />
                <Text className="text-base font-bold text-gray-900 ml-2">แก้ไขข้อมูลสถานประกอบการ</Text>
              </View>
              <TouchableOpacity onPress={() => setShowEditBusiness(false)} className="w-8 h-8 rounded-full bg-gray-100 items-center justify-center">
                <XMarkIcon size={18} color="#4B5563" />
              </TouchableOpacity>
            </View>

            <KeyboardAvoidingView
              style={{ flex: 1, minHeight: 0 }}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {/* OTOP Community Location (Read-only) */}
                <View className="bg-emerald-50 rounded-xl p-3 border border-emerald-200 mb-4">
                  <Text className="text-[#1B4332] text-[13px] font-bold mb-0.5">ที่ตั้งชุมชน OTOP (ล็อกตามทะเบียน)</Text>
                  <Text className="text-gray-700 text-[13px]">
                    {[user?.otop_village, user?.otop_tambol && `ต.${user.otop_tambol}`,
                    user?.otop_amphur && `อ.${user.otop_amphur}`, user?.otop_province && `จ.${user.otop_province}`]
                      .filter(Boolean)
                      .join(" • ") || "-"}
                  </Text>
                </View>

                {/* 1. Place name & Auto GPS Pin */}
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-gray-700 font-bold text-[13px]">
                    ชื่อสถานประกอบการ / ร้านค้า <Text className="text-red-500">*</Text>
                  </Text>
                  {bizGpsLoading && (
                    <View className="flex-row items-center">
                      <ActivityIndicator size="small" color="#2D6A4F" />
                      <Text className="text-emerald-700 text-[13px] font-medium ml-1">กำลังค้นหาพิกัด...</Text>
                    </View>
                  )}
                </View>
                <TextInput
                  value={bizPlaceName}
                  onChangeText={(t) => {
                    setBizPlaceName(t);
                    setBizConfirmedPlace(null);
                  }}
                  placeholder="เช่น โฮมสเตย์ป้าสมศรี, กาแฟบ้านห้วยห้อม"
                  placeholderTextColor="#9CA3AF"
                  className="bg-gray-100 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-900 mb-2"
                />

                {/* Candidates found on Google Maps within community scope */}
                {bizGpsCandidates.length > 0 && !bizConfirmedPlace && (
                  <View className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 mb-4">
                    <Text className="text-blue-900 font-bold text-[12px] mb-2">
                      📍 พบสถานที่ในเขต {user?.otop_amphur || user?.otop_province} — เลือกเพื่อดึงข้อมูลอัตโนมัติ:
                    </Text>
                    {bizGpsCandidates.map((c, idx) => (
                      <View key={idx} className="bg-white border border-blue-100 rounded-xl p-3 mb-2.5 shadow-sm">
                        <Text className="text-gray-900 font-bold text-[13.5px]">📍 {c.name}</Text>
                        <Text className="text-gray-500 text-[13px] mt-0.5" numberOfLines={2}>{c.address}</Text>

                        {(c.phone) && (
                          <View className="mt-1.5 pt-1.5 border-t border-gray-100">
                            {c.phone && <Text className="text-gray-600 text-[13px]">📞 {c.phone}</Text>}
                          </View>
                        )}

                        <View className="flex-row items-center justify-between mt-2.5">
                          {c.googleMapsUri ? (
                            <TouchableOpacity
                              onPress={() => Linking.openURL(c.googleMapsUri!)}
                              activeOpacity={0.7}
                              className="flex-row items-center px-2 py-1 bg-gray-100 rounded-lg"
                            >
                              <Text className="text-[13px] text-blue-700 font-semibold">🗺️ ดูบน Google Maps</Text>
                            </TouchableOpacity>
                          ) : <View />}

                          <TouchableOpacity
                            onPress={() => selectBizCandidate(c)}
                            activeOpacity={0.85}
                            className="bg-[#2D6A4F] py-1.5 px-3.5 rounded-lg"
                          >
                            <Text className="text-white font-bold text-[13px]">✓ เลือกสถานที่นี้</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Fallback button when not found on Google Maps */}
                {bizGpsCandidates.length === 0 &&
                  bizPlaceName.trim().length >= 2 &&
                  !bizGpsLoading &&
                  !bizConfirmedPlace && (
                    <View className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 mb-4">
                      <Text className="text-amber-900 font-semibold text-[12px] mb-1">
                        ไม่พบหมุดร้าน &ldquo;{bizPlaceName.trim()}&rdquo; บน Google Maps ในเขต {user?.otop_amphur}
                      </Text>
                      <Text className="text-gray-500 text-[13px] mb-2.5 leading-4">
                        หากเป็นร้านเปิดใหม่หรือยังไม่มีหมุด สามารถกดใช้พิกัดของชุมชน OTOP แทน และกรอกข้อมูลด้วยตนเองได้เลยค่ะ
                      </Text>
                      <TouchableOpacity
                        onPress={applyBizOtopFallback}
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
                {bizConfirmedPlace && (
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
                          onPress={() => setBizConfirmedPlace(null)}
                          activeOpacity={0.7}
                          className="px-2 py-0.5 bg-white border border-emerald-200 rounded-lg"
                        >
                          <Text className="text-emerald-700 font-semibold text-[13px]">เปลี่ยนพิกัด</Text>
                        </TouchableOpacity>
                      </View>
                      <Text className="text-gray-800 font-bold text-[13px] mt-0.5">{bizConfirmedPlace.name}</Text>
                      <Text className="text-gray-500 text-[13px] mt-0.5">{bizConfirmedPlace.address}</Text>

                      {bizConfirmedPlace.googleMapsUri && (
                        <TouchableOpacity
                          onPress={() => Linking.openURL(bizConfirmedPlace.googleMapsUri!)}
                          activeOpacity={0.7}
                          className="mt-2 self-start flex-row items-center"
                        >
                          <Text className="text-[13px] text-blue-700 font-semibold">🗺️ ดูตำแหน่งบน Google Maps</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Phone input right inside business details */}
                    <Text className="text-gray-700 font-bold text-[13px] mb-1">
                      เบอร์โทรศัพท์ติดต่อ <Text className="text-red-500">*</Text>
                    </Text>
                    <TextInput
                      value={bizPhone}
                      onChangeText={setBizPhone}
                      keyboardType="phone-pad"
                      placeholder="เช่น 081-234-5678"
                      placeholderTextColor="#9CA3AF"
                      className="bg-gray-100 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-900 mb-3.5"
                    />

                    {/* ประเภทธุรกิจ — Google เป็นค่าเริ่มต้น แก้เฉพาะจุดที่ผิด */}
                    <EditableValueRow
                      label="ประเภทสถานประกอบการ"
                      icon={profileFor(bizType).icon}
                      value={profileFor(bizType).badgeLabel}
                      editing={bizEditing.type}
                      onToggle={() => toggleBizEditing("type")}
                    >
                      {bizConfirmedPlace.primaryTypeDisplayName ? (
                        <Text className="text-[13px] text-gray-500 mb-2.5">
                          ตรวจพบจาก Google: &quot;{bizConfirmedPlace.primaryTypeDisplayName}&quot;
                        </Text>
                      ) : null}
                      <View className="flex-row flex-wrap gap-2">
                        {BIZ_TYPE_OPTIONS.map((p) => (
                          <TouchableOpacity
                            key={p.id}
                            onPress={() => handleSelectBizType(p.id)}
                            activeOpacity={0.8}
                            className={`px-3 py-2 rounded-xl border ${bizType === p.id ? "bg-[#2D6A4F] border-[#2D6A4F]" : "bg-white border-gray-200"
                              }`}
                          >
                            <Text
                              className={`text-[14px] font-bold ${bizType === p.id ? "text-white" : "text-gray-700"
                                }`}
                            >
                              {p.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </EditableValueRow>

                    {/* เวลาเปิด-ปิดวันธรรมดา */}
                    <EditableValueRow
                      label={bizWeekdayLabel || "วันธรรมดา"}
                      icon="🌿"
                      value={bizWeekdayHoursText}
                      editing={bizEditing.weekday}
                      onToggle={() => toggleBizEditing("weekday")}
                      emptyHint="ยังไม่ได้ระบุเวลาเปิด-ปิด"
                    >
                      <Text className="text-[13px] font-medium text-gray-600 mb-1.5">
                        วันในสัปดาห์
                      </Text>
                      <TouchableOpacity
                        onPress={() => setBizWeekdaySheetOpen(true)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        className="flex-row items-center justify-between bg-white border border-gray-200 rounded-xl px-3.5 py-3 mb-3"
                      >
                        <Text className="text-[15px] font-bold text-gray-800">
                          {bizWeekdayLabel || "วันธรรมดา"}
                        </Text>
                        <ChevronDownIcon size={20} color="#2D6A4F" />
                      </TouchableOpacity>

                      <Text className="text-[13px] font-medium text-gray-600 mb-1.5">
                        {bizType === "homestay" ? "เช็คอิน / เช็คเอาท์" : "เวลาเปิด / เวลาปิด"}
                      </Text>
                      <TouchableOpacity
                        onPress={() =>
                          setBizTimeSheet({
                            which: "weekday",
                            range: seedBizTimeSheet(bizWeekdayHoursText),
                          })
                        }
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        className="flex-row items-center justify-between bg-white border border-gray-200 rounded-xl px-3.5 py-3"
                      >
                        <Text className="text-[15px] font-bold text-gray-800">
                          {bizWeekdayHoursText ||
                            (bizType === "homestay"
                              ? "เลือกเวลาเช็คอิน / เช็คเอาท์"
                              : "เลือกเวลาเปิด-ปิด")}
                        </Text>
                        <ChevronDownIcon size={20} color="#2D6A4F" />
                      </TouchableOpacity>
                    </EditableValueRow>

                    {/* เวลาเปิด-ปิดวันหยุด */}
                    <EditableValueRow
                      label={bizWeekendLabel || "วันหยุดสุดสัปดาห์"}
                      icon="🔥"
                      tone="amber"
                      value={bizWeekendHoursText}
                      editing={bizEditing.weekend}
                      onToggle={() => toggleBizEditing("weekend")}
                      emptyHint="ยังไม่ได้ระบุเวลาเปิด-ปิด"
                    >
                      <Text className="text-[13px] font-medium text-gray-600 mb-1.5">
                        วันในสัปดาห์
                      </Text>
                      <TouchableOpacity
                        onPress={() => setBizWeekendSheetOpen(true)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        className="flex-row items-center justify-between bg-white border border-amber-200 rounded-xl px-3.5 py-3 mb-3"
                      >
                        <Text className="text-[15px] font-bold text-gray-800">
                          {bizWeekendLabel || "วันหยุดสุดสัปดาห์"}
                        </Text>
                        <ChevronDownIcon size={20} color="#2D6A4F" />
                      </TouchableOpacity>

                      <Text className="text-[13px] font-medium text-gray-600 mb-1.5">
                        {bizType === "homestay" ? "เช็คอิน / เช็คเอาท์" : "เวลาเปิด / เวลาปิด"}
                      </Text>
                      <TouchableOpacity
                        onPress={() =>
                          setBizTimeSheet({
                            which: "weekend",
                            range: seedBizTimeSheet(bizWeekendHoursText),
                          })
                        }
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        className="flex-row items-center justify-between bg-white border border-amber-200 rounded-xl px-3.5 py-3"
                      >
                        <Text className="text-[15px] font-bold text-gray-800">
                          {bizWeekendHoursText ||
                            (bizType === "homestay"
                              ? "เลือกเวลาเช็คอิน / เช็คเอาท์"
                              : "เลือกเวลาเปิด-ปิด")}
                        </Text>
                        <ChevronDownIcon size={20} color="#2D6A4F" />
                      </TouchableOpacity>
                    </EditableValueRow>

                    {/* วันที่ปิดทำการ */}
                    <EditableValueRow
                      label="วันที่ปิดทำการ"
                      icon="🚫"
                      tone="amber"
                      value={formatClosedDaysStr(bizDayOffs)}
                      editing={bizEditing.closed}
                      onToggle={() => toggleBizEditing("closed")}
                    >
                      <TouchableOpacity
                        onPress={() => setBizDaySheetOpen(true)}
                        activeOpacity={0.8}
                        className="flex-row items-center justify-between bg-gray-50 border border-amber-200 rounded-xl px-3.5 py-3"
                      >
                        <Text className="text-[15px] font-bold text-amber-900">
                          เลือกวันที่ปิดทำการ
                        </Text>
                        <ChevronDownIcon size={20} color="#B45309" />
                      </TouchableOpacity>
                    </EditableValueRow>

                    {/* 💰 อัตราค่าบริการ */}
                    <EditableValueRow
                      label="อัตราค่าบริการเริ่มต้น"
                      icon="💰"
                      value={formatPriceStr(
                        bizWeekdayPrice,
                        bizWeekendPrice,
                        resolvePriceUnit(bizPriceUnit, bizCustomUnit)
                      )}
                      emptyHint="ยังไม่ได้ระบุราคา"
                      editing={bizEditing.price}
                      onToggle={() => toggleBizEditing("price")}
                    >
                      <TextInput
                        value={bizWeekdayPrice}
                        onChangeText={setBizWeekdayPrice}
                        keyboardType="numeric"
                        placeholder="เช่น 500"
                        placeholderTextColor="#9CA3AF"
                        className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[15px] font-bold text-gray-900"
                      />
                      <Text className="text-[12.5px] text-gray-500 mt-1 mb-2.5">
                        🌿 ราคาวันธรรมดา (เปิดแป้นตัวเลขอัตโนมัติ)
                      </Text>

                      <TextInput
                        value={bizWeekendPrice}
                        onChangeText={setBizWeekendPrice}
                        keyboardType="numeric"
                        placeholder="เช่น 750"
                        placeholderTextColor="#9CA3AF"
                        className="bg-gray-50 border border-amber-200 rounded-xl px-3 py-2.5 text-[15px] font-bold text-gray-900"
                      />
                      <Text className="text-[12.5px] text-gray-500 mt-1 mb-2.5">
                        🔥 ราคาวันหยุด / เทศกาล (เปิดแป้นตัวเลขอัตโนมัติ)
                      </Text>

                      <Text className="text-[13px] font-bold text-gray-700 mb-1.5">
                        หน่วยบริการ
                      </Text>
                      <View className="flex-row flex-wrap gap-1.5 mb-2">
                        {PRICE_UNITS.map((u) => (
                          <TouchableOpacity
                            key={u.id}
                            onPress={() => setBizPriceUnit(u.id)}
                            activeOpacity={0.8}
                            className={`px-3 py-2 rounded-xl border ${bizPriceUnit === u.id
                                ? "bg-[#2D6A4F] border-[#2D6A4F]"
                                : "bg-white border-gray-200"
                              }`}
                          >
                            <Text
                              className={`text-[14px] font-bold ${bizPriceUnit === u.id ? "text-white" : "text-gray-700"
                                }`}
                            >
                              {u.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      {bizPriceUnit === "custom" && (
                        <TextInput
                          value={bizCustomUnit}
                          onChangeText={setBizCustomUnit}
                          placeholder="ระบุหน่วย เช่น ทริป, จาน, ชุด"
                          placeholderTextColor="#9CA3AF"
                          className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[15px] text-gray-900"
                        />
                      )}
                    </EditableValueRow>

                    {/* Card 4: ☕ บริการเสริมในพื้นที่เดียวกัน (Hybrid Business) */}
                    {!hasSecondaryBiz ? (
                      <TouchableOpacity
                        onPress={() => setHasSecondaryBiz(true)}
                        activeOpacity={0.8}
                        className="border border-dashed border-[#2D6A4F] bg-emerald-50/50 rounded-2xl p-2.5 items-center justify-center flex-row mb-3.5"
                      >
                        <PlusIcon size={15} color="#2D6A4F" />
                        <Text className="text-[#2D6A4F] font-bold text-[13px] ml-1.5">
                          + มีบริการอื่นในพื้นที่เดียวกัน (เช่น คาเฟ่ / กิจกรรม)
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <View className="bg-amber-50/40 border border-amber-200 rounded-2xl p-3 mb-3.5 shadow-xs">
                        <View className="flex-row items-center justify-between mb-2">
                          <Text className="text-amber-900 font-black text-[13px]">
                            ☕ บริการเสริมในพื้นที่เดียวกัน
                          </Text>
                          <TouchableOpacity
                            onPress={() => setHasSecondaryBiz(false)}
                            activeOpacity={0.7}
                            className="px-2 py-0.5 bg-white border border-red-200 rounded-lg"
                          >
                            <Text className="text-red-600 text-[13px] font-semibold">ลบออก</Text>
                          </TouchableOpacity>
                        </View>

                        {/* Secondary service type selector */}
                        <Text className="text-gray-600 text-[13px] font-medium mb-1">ประเภทบริการเสริม:</Text>
                        <View className="flex-row gap-1 mb-2.5">
                          {[
                            { id: "cafe", label: "☕ คาเฟ่ / อาหาร", unit: "/ เมนู" },
                            { id: "activity", label: "🎨 กิจกรรม", unit: "/ ท่าน" },
                            { id: "shop", label: "🛍️ ร้านของฝาก", unit: "/ ชิ้น" },
                          ].map((s) => (
                            <TouchableOpacity
                              key={s.id}
                              onPress={() => {
                                setSecondaryBizType(s.id as any);
                                setSecondaryPriceUnit(s.unit);
                              }}
                              activeOpacity={0.8}
                              className={`flex-1 py-1 items-center justify-center rounded-xl border ${secondaryBizType === s.id ? "bg-amber-600 border-amber-600" : "bg-white border-gray-200"
                                }`}
                            >
                              <Text className={`text-[13px] font-bold ${secondaryBizType === s.id ? "text-white" : "text-gray-700"}`}>
                                {s.label}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>

                        {/* Schedule Choice */}
                        <Text className="text-gray-700 font-bold text-[13px] mb-1">
                          รอบวันและเวลาเปิด-ปิดของบริการเสริม:
                        </Text>
                        <View className="bg-white rounded-xl border border-gray-200 p-2 mb-2">
                          <TouchableOpacity
                            onPress={() => setSecondaryInheritSchedule(true)}
                            activeOpacity={0.8}
                            className="flex-row items-center mb-1.5"
                          >
                            <View className={`w-3.5 h-3.5 rounded-full border items-center justify-center mr-2 ${secondaryInheritSchedule ? "border-[#2D6A4F] bg-[#2D6A4F]" : "border-gray-300 bg-white"
                              }`}>
                              {secondaryInheritSchedule && <View className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </View>
                            <Text className="text-gray-800 text-[13px] font-medium">
                              ใช้วัน-เวลาเปิดเดียวกับธุรกิจหลัก
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            onPress={() => setSecondaryInheritSchedule(false)}
                            activeOpacity={0.8}
                            className="flex-row items-center"
                          >
                            <View className={`w-3.5 h-3.5 rounded-full border items-center justify-center mr-2 ${!secondaryInheritSchedule ? "border-[#2D6A4F] bg-[#2D6A4F]" : "border-gray-300 bg-white"
                              }`}>
                              {!secondaryInheritSchedule && <View className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </View>
                            <Text className="text-gray-800 text-[13px] font-medium">
                              แยกกำหนดเวลาเปิด-ปิดเอง
                            </Text>
                          </TouchableOpacity>

                          {!secondaryInheritSchedule && (
                            <View className="mt-1.5 pt-1.5 border-t border-gray-100">
                              <Text className="text-gray-500 text-[13px] mb-0.5">เวลาทำการ (เช่น 08:30 - 17:00):</Text>
                              <TextInput
                                value={secondaryHours}
                                onChangeText={setSecondaryHours}
                                placeholder="เช่น 08:30 - 17:00"
                                placeholderTextColor="#9CA3AF"
                                className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[15px] text-gray-900"
                              />
                            </View>
                          )}
                        </View>

                        {/* Secondary Price Input */}
                        <Text className="text-gray-700 font-bold text-[13px] mb-1">
                          ราคาเริ่มต้นของบริการเสริม (ถ้ามี):
                        </Text>
                        <View className="flex-row items-center bg-white border border-gray-200 rounded-xl px-2.5 py-1">
                          <Text className="text-gray-400 font-bold text-[13px] mr-1">฿</Text>
                          <TextInput
                            value={secondaryPrice}
                            onChangeText={setSecondaryPrice}
                            keyboardType="numeric"
                            placeholder="เช่น 45 - 80"
                            placeholderTextColor="#9CA3AF"
                            className="flex-1 text-[15px] font-bold text-gray-900 py-0.5"
                          />
                          <Text className="text-gray-500 text-[13px] ml-1">บาท {secondaryPriceUnit}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                )}

                <TouchableOpacity
                  onPress={handleSaveBusiness}
                  disabled={bizSaving || !bizPhone.trim()}
                  activeOpacity={0.85}
                  className={`py-3.5 rounded-2xl items-center flex-row justify-center mb-6 ${bizSaving || !bizPhone.trim() ? "bg-gray-200" : "bg-[#2D6A4F]"
                    }`}
                >
                  {bizSaving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text className={`font-bold text-[15px] ${bizSaving || !bizPhone.trim() ? "text-gray-400" : "text-white"}`}>
                      บันทึกข้อมูล
                    </Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </KeyboardAvoidingView>

            {/* Nested sheets — mounted inside the modal so they float above it. */}
            <DayPickerSheet
              visible={bizDaySheetOpen}
              selected={bizDayOffs}
              onCancel={() => setBizDaySheetOpen(false)}
              onConfirm={(days) => {
                setBizDayOffs(days);
                setBizDaySheetOpen(false);
              }}
            />
            <DayPickerSheet
              visible={bizWeekdaySheetOpen}
              selected={bizWeekdayDays}
              title="เลือกวันธรรมดา"
              resetLabel=""
              selectedLabel="ใช่"
              unselectedLabel="ไม่ใช่"
              onCancel={() => setBizWeekdaySheetOpen(false)}
              onConfirm={(days) => {
                setBizWeekdayDays(days);
                setBizWeekdaySheetOpen(false);
              }}
            />
            <DayPickerSheet
              visible={bizWeekendSheetOpen}
              selected={bizWeekendDays}
              title="เลือกวันหยุดสุดสัปดาห์"
              resetLabel=""
              selectedLabel="ใช่"
              unselectedLabel="ไม่ใช่"
              onCancel={() => setBizWeekendSheetOpen(false)}
              onConfirm={(days) => {
                setBizWeekendDays(days);
                setBizWeekendSheetOpen(false);
              }}
            />
            <TimeRangeSheet
              visible={bizTimeSheet !== null}
              kind={bizType === "homestay" ? "checkin" : "hours"}
              initialRange={
                bizTimeSheet?.range ?? { open: null, close: null, allDay: false }
              }
              onCancel={() => setBizTimeSheet(null)}
              onConfirm={(range) => {
                if (!bizTimeSheet) return;
                const formatted = formatHourRange(
                  range,
                  bizType === "homestay" ? "checkin" : "hours"
                );
                if (bizTimeSheet.which === "weekday") {
                  setBizWeekdayHoursText(formatted);
                } else {
                  setBizWeekendHoursText(formatted);
                }
                setBizTimeSheet(null);
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
