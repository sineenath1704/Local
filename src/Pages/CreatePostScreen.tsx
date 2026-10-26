import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
import * as ImagePicker from "expo-image-picker";
import {
  VideoCameraIcon,
  MapPinIcon,
  HashtagIcon,
  PaperAirplaneIcon,
  XMarkIcon,
  SparklesIcon,
  PencilSquareIcon,
  CheckIcon,
  ArrowPathIcon,
  StarIcon as StarOutline,
} from "react-native-heroicons/outline";
import { StarIcon as StarSolid } from "react-native-heroicons/solid";
import { useAuth } from "../state/AuthContext";
import { uploadVideo, uploadDraftVideo, deleteDraftVideo } from "../services/uploadService";
import {
  suggestCaptions,
  generatePreviewSummary,
  extractDiag,
  type AiSummaryResult,
  type SummaryPlace,
  type SummaryDiag,
} from "../services/captionService";
import PlaceDetailsCard, {
  type PlaceDetailsValues,
} from "../components/PlaceDetailsCard";
import {
  fetchPlaceDetailsRow,
  savePlaceDetails,
} from "../services/placeDetailsService";
import { searchPlaces } from "../data/thailandGeographicData";
import type { PlaceItem } from "../data/thailandGeographicData";
import { verifyLocationOffline, type VerifyResult } from "../services/placeVerifyService";
import { findLocalPlaces, saveVerifiedPlace, type LocalPlace } from "../services/placesLocalService";
import {
  verifyPlaceOnGoogle,
  fetchPlaceDetails,
  type PlaceCandidate,
} from "../services/placesService";
import {
  matchAgainstRegistered,
  sortByMatchLevel,
  type MatchLevel,
} from "../services/placeMatchService";
import {
  findCommunitiesByArea,
  registeredPlaceOf,
  type CommunityRow,
} from "../services/communityService";
import { upsertMyPlace } from "../services/hostPlaceService";
import { asAiError } from "../services/aiHttp";

export interface InitialPostLocation {
  placeName?: string;
  community?: string;
  province?: string;
  district?: string;
  subdistrict?: string;
  coords?: { lat: number; lng: number };
}

interface CreatePostScreenProps {
  /** Called after a successful upload (host refreshes feed / switches tab). */
  onPosted?: () => void;
  /** Go back / cancel. */
  onCancel?: () => void;
  /** Prefilled location from a completed trip stop */
  initialLocation?: InitialPostLocation;
}

/**
 * Google's price band (0–4) → the label Thai users read.
 * Google shows these as: Free / ฿ / ฿฿ / ฿฿฿ / ฿฿฿฿.
 *
 * This is an overall estimate of the place, not a real price list — so it
 * lives in `price_info.level`, beside the weekday/weekend prices that come
 * from what the uploader actually said.
 */
function priceLevelLabel(level?: number | null): string | null {
  switch (level) {
    case 0:
      return "ฟรี";
    case 1:
      return "฿";
    case 2:
      return "฿฿";
    case 3:
      return "฿฿฿";
    case 4:
      return "฿฿฿฿";
    default:
      return null;
  }
}

export default function CreatePostScreen({ onPosted, onCancel, initialLocation }: CreatePostScreenProps) {
  const insets = useSafeAreaInsets();
  const { session, user, refreshUser } = useAuth();

  // Pre-fill location for OTOP hosts from their verified business profile.
  const isHost = user?.role === "host" && Boolean(user?.otop_verified);
  // Any host may curate a place's details (the backend gates on the role, not
  // on the OTOP verification) — OTOP only decides the posting mode.
  const isCommunityHost = user?.role === "host";
  const hostBusinessName = user?.business_place_name || user?.otop_village || user?.otop_nawatwithi || "";
  const hostLocation = isHost ? {
    locationName: hostBusinessName,
    placeName: hostBusinessName,
    community: user?.otop_village || "",
    subdistrict: user?.business_subdistrict || user?.otop_tambol || "",
    district: user?.business_district || user?.otop_amphur || "",
    province: user?.business_province || user?.otop_province || "",
    lat: user?.business_lat ?? null,
    lng: user?.business_lng ?? null,
  } : null;

  // Host mode: "own_business" (locked to own shop) or "community_spot" (within own tambol/village)
  const [hostPostMode, setHostPostMode] = useState<"own_business" | "community_spot">("own_business");

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [province, setProvince] = useState(hostLocation?.province || initialLocation?.province || "");
  const [district, setDistrict] = useState(hostLocation?.district || initialLocation?.district || "");
  const [subdistrict, setSubdistrict] = useState(hostLocation?.subdistrict || initialLocation?.subdistrict || "");
  const [community, setCommunity] = useState(hostLocation?.community || initialLocation?.community || "");
  const [placeName, setPlaceName] = useState(hostLocation?.placeName || initialLocation?.placeName || "");
  const [locationName, setLocationName] = useState(
    hostLocation?.locationName || initialLocation?.placeName || initialLocation?.community || ""
  );
  const [locationQuery, setLocationQuery] = useState(
    initialLocation?.placeName || initialLocation?.community || ""
  );
  // Host location is pre-confirmed (from OTOP profile), tourist needs to verify.
  const [locationConfirmedInit] = useState(isHost && !!hostLocation?.province);
  const [locationSource, setLocationSource] = useState<"otop" | "ai" | "manual">(
    isHost && hostLocation ? "otop" : "manual"
  );
  const [uploading, setUploading] = useState(false);

  // Location verification (offline + Local places store).
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [localPlaceCandidates, setLocalPlaceCandidates] = useState<LocalPlace[]>([]);
  const [locationConfirmed, setLocationConfirmed] = useState(locationConfirmedInit);
  const [googleCandidates, setGoogleCandidates] = useState<PlaceCandidate[]>([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  // The Google place the host confirmed — its id is the place's identity in
  // `community_places`, the table the AI chat reads.
  const [confirmedPlace, setConfirmedPlace] = useState<PlaceCandidate | null>(null);
  // The place's own details — price band, website, phone, opening hours.
  // They belong to the PLACE, not to one summary, so they live in their own
  // state: a regenerated summary cannot drop them, and they are what gets
  // saved for the AI chat to answer from.
  const [placeDetails, setPlaceDetails] = useState<PlaceDetailsValues>({
    priceLevel: null,
    website: null,
    phone: null,
    openingHours: null,
  });
  // Fields the host set by hand — a fresh answer never overwrites those.
  const [placeDetailsEdited, setPlaceDetailsEdited] = useState<
    Partial<Record<keyof PlaceDetailsValues, boolean>>
  >({});
  // The card opens once the place's details have arrived — a form that
  // appears empty and then fills itself under the host's fingers is worse
  // than one that appears a moment later, already right.
  const [placeDetailsReady, setPlaceDetailsReady] = useState(false);
  // True while a Place Details call is in flight — blocks a double tap,
  // which would spend a second billable call on the same place.
  const [confirmingPlace, setConfirmingPlace] = useState(false);
  // Single Google result pending confirmation (with editable fields).
  const [pendingConfirm, setPendingConfirm] = useState<PlaceCandidate | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [pendingAddress, setPendingAddress] = useState("");
  // ── การจับคู่สถานที่กับชุมชน (PLAN §6.3-§6.7) ──────────────────────
  // สถานที่ที่ "ทะเบียน" ของขอบเขตนี้ชี้ไป — เทียบด้วย Google id เท่านั้น (D2)
  const [registeredPlace, setRegisteredPlace] = useState<{
    placeId: string;
    name: string;
    /** ป้ายบนการ์ด — ของเรา หรือ ของชุมชน */
    label: string;
  } | null>(null);
  // candidate ที่ "ตรงกับทะเบียน" — ขึ้นการ์ดให้ผู้ใช้กดยืนยัน
  const [registeredMatch, setRegisteredMatch] = useState<PlaceCandidate | null>(null);
  // ชุมชนของสถานที่ที่ยืนยันแล้ว (null = จับคู่ไม่ได้ → ไม่บันทึก — D11)
  const [confirmedCommunityId, setConfirmedCommunityId] = useState<string | null>(null);
  // ระดับที่จับคู่ชุมชนได้ (D28)
  const [communityMatchLevel, setCommunityMatchLevel] = useState<MatchLevel | "manual" | null>(null);
  // เส้นทาง ③ — "ค้นหาใหม่ในชุมชนนี้" (null = ยังไม่ได้กด)
  const [communitySearch, setCommunitySearch] = useState<"subdistrict" | "district" | null>(null);
  // ชุมชนที่ตรงกับสถานที่แต่มีมากกว่าหนึ่ง → ให้ผู้ใช้เลือก
  const [communityChoices, setCommunityChoices] = useState<CommunityRow[]>([]);
  // coordinates captured when a Google candidate is chosen or from host registration
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    hostLocation?.lat != null && hostLocation?.lng != null ? { lat: hostLocation.lat, lng: hostLocation.lng } : null
  );

  const [captionIdeas, setCaptionIdeas] = useState<string[]>([]);
  const [captionLoading, setCaptionLoading] = useState(false);
  /** Hashtags the AI suggests — tapping one adds it to the field. */
  const [hashtagIdeas, setHashtagIdeas] = useState<string[]>([]);

  // Switch functions for host post modes
  const applyHostOwnBusiness = () => {
    setHostPostMode("own_business");
    if (hostLocation) {
      setPlaceName(hostLocation.placeName);
      setLocationName(hostLocation.locationName);
      setCommunity(hostLocation.community);
      setSubdistrict(hostLocation.subdistrict);
      setDistrict(hostLocation.district);
      setProvince(hostLocation.province);
      if (hostLocation.lat != null && hostLocation.lng != null) {
        setCoords({ lat: hostLocation.lat, lng: hostLocation.lng });
      }
      setLocationSource("otop");
      setLocationConfirmed(true);
      setVerify(null);
    }
  };

  const applyHostCommunitySpot = () => {
    setHostPostMode("community_spot");
    setLocationConfirmed(false);
    setLocationSource("manual");
    setPlaceName("");
    setLocationName("");
    setLocationQuery("");
    setVerify(null);
    setCoords(null);
  };

  // ─────────────────────────────────────────────────────────────
  //  การจับคู่สถานที่กับชุมชน (PLAN_PLACE_MATCHING.md §6.3-§6.7)
  // ─────────────────────────────────────────────────────────────

  /**
   * ขอบเขตที่กำลังค้นอยู่ — ชุมชน/ตำบล/อำเภอ/จังหวัด
   *
   * host → ของชุมชนตัวเอง (ตามโหมดโพสต์) · tourist → ที่ AI อ่านได้
   * หรือที่ผู้ใช้กรอกเอง
   */
  const resolveScope = () => {
    if (isHost && hostLocation) {
      return {
        community: hostLocation.community || "",
        subdistrict: hostLocation.subdistrict || "",
        district: hostLocation.district || "",
        province: hostLocation.province || "",
      };
    }
    return {
      community: community.trim(),
      subdistrict: subdistrict.trim(),
      district: district.trim(),
      province: province.trim(),
    };
  };

  /**
   * "ที่ลงทะเบียน" ของขอบเขตนี้ — สถานที่ที่ candidate จะถูกเทียบด้วย
   *
   * • host → สถานที่ประกอบการของตัวเอง (`users.business_place_id`)
   * • tourist → สถานที่ที่ชุมชนนั้นลงทะเบียนไว้
   *
   * D2: เทียบด้วย **Google id อย่างเดียว** — ถ้าเป็น id ที่ระบบสร้างเอง
   * (`host-…`, `otop-…`) มันไม่ใช่ Google id → เทียบกับ candidate ไม่ได้
   * และถือว่า "ไม่ตรง" เสมอ
   */
  const resolveRegisteredPlace = async (): Promise<void> => {
    // host → สถานที่ของตัวเอง
    const ownId = user?.business_place_id ?? null;
    if (isCommunityHost && ownId) {
      setRegisteredPlace({
        placeId: ownId,
        name: user?.business_place_name || "",
        label: "ของคุณ",
      });
      return;
    }
    // ทุกคน: ชุมชนของ host หรือชุมชนที่หาได้จากบริเวณที่กำลังค้น
    const communityId = await resolveCommunityId(resolveScope());
    if (!communityId) {
      setRegisteredPlace(null);
      return;
    }
    const reg = await registeredPlaceOf(communityId);
    setRegisteredPlace(
      reg?.place_id
        ? { placeId: reg.place_id, name: reg.place_name ?? "", label: "ของชุมชน" }
        : null
    );
  };

  /**
   * ชุมชนของสถานที่ที่กำลังค้น
   * • host → ชุมชนของตัวเอง (`users.community_id`)
   * • คนอื่น → หาจากตำบล/อำเภอ/จังหวัด · เจอ 1 = ใช้เลย · เจอหลาย = ให้เลือก
   */
  const resolveCommunityId = async (scope: {
    subdistrict: string;
    district: string;
    province: string;
  }): Promise<string | null> => {
    if (isCommunityHost && user?.community_id) return user.community_id;
    const list = await findCommunitiesByArea(scope);
    if (list.length === 1) return list[0].id;
    if (list.length > 1) {
      setCommunityChoices(list);
      return null;
    }
    return null;
  };

  /**
   * ผูกสถานที่ที่ยืนยันแล้วเข้ากับชุมชน (D4) + บอกระดับที่จับคู่ได้ (D28)
   *
   * • host → ชุมชนของตัวเอง
   * • tourist → หาจากบริเวณของสถานที่ · ไม่เจอ = ไม่บันทึก (D11)
   */
  const resolveCommunityFor = async (place: PlaceCandidate): Promise<string | null> => {
    if (isCommunityHost && user?.community_id) {
      setConfirmedCommunityId(user.community_id);
      setCommunityChoices([]);
      return user.community_id;
    }
    const list = await findCommunitiesByArea({
      subdistrict: place.subdistrict ?? subdistrict.trim(),
      district: place.district ?? district.trim(),
      province: place.province ?? province.trim(),
    });
    if (list.length === 1) {
      setConfirmedCommunityId(list[0].id);
      setCommunityChoices([]);
      return list[0].id;
    }
    if (list.length > 1) {
      // มากกว่าหนึ่ง → ให้ผู้ใช้เลือกในการ์ดยืนยัน
      setCommunityChoices(list);
      setConfirmedCommunityId(null);
      return null;
    }
    setConfirmedCommunityId(null);
    setCommunityChoices([]);
    return null;
  };

  /** ระดับที่จับคู่ชุมชนได้ของสถานที่ที่เพิ่งยืนยัน */
  const matchLevelOf = (c: PlaceCandidate): MatchLevel | "manual" | null => {
    // ผู้ใช้เลือกเองจากผลค้น "ในชุมชน" = manual (เชื่อถือที่สุด)
    if (communitySearch) return "manual";
    // ตรงกับทะเบียนของชุมชนอยู่แล้ว = ชุมชนมีสถานที่นี้อยู่แล้ว
    // → ไม่ต้องเขียนระดับซ้ำ (ระดับเดิมของแถวนั้นถูกต้องกว่า)
    if (registeredMatch && c.placeId && c.placeId === registeredMatch.placeId) return null;
    return c.matchLevel ?? null;
  };

  /** เขียนชุมชน/ชื่อที่ยืนยันแล้วกลับลง summary (PLAN §6.9) */
  const writeConfirmedPlaceToSummary = (place: PlaceCandidate, communityName?: string | null) => {
    setSummary((prev) => {
      if (!prev) return prev;
      const p = prev.place;
      if (!p) return prev;
      const base: SummaryPlace = {
        ...p,
        place_name: p.place_name ?? place.name,
        community: communityName ?? p.community ?? null,
        location: {
          ...p.location,
          province: place.province ?? p.location.province ?? null,
          district: place.district ?? p.location.district ?? null,
          subdistrict: place.subdistrict ?? p.location.subdistrict ?? null,
        },
      };
      return { ...prev, place: base };
    });
  };

  // --- AI summary (generated at upload time, before posting) ---
  const [summary, setSummary] = useState<AiSummaryResult | null>(null);
  const [draftVideoUrl, setDraftVideoUrl] = useState<string | null>(null);
  // Storage path of the draft copy — deleted once the real upload succeeds.
  const [draftVideoPath, setDraftVideoPath] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [accuracy, setAccuracy] = useState<number>(0); // 1–5, 0 = not rated
  // รายงานการวิเคราะห์จาก backend — บอกว่าแต่ละขั้นตอนเกิดอะไรขึ้น
  const [summaryDiag, setSummaryDiag] = useState<SummaryDiag | null>(null);
  const [showDiag, setShowDiag] = useState(false);

  /**
   * Push the place's details into the summary.
   *
   * The summary rides along with the video, so these facts travel with it —
   * and the same values are saved to `community_places`, the row the AI chat
   * answers from. `price_info.level` belongs to us alone (Google's band for
   * the confirmed place), so it is always written; the contact and the hours
   * may also have been read by the AI out of the clip, so a value we don't
   * have never erases one we do.
   */
  const writePlaceDetailsToSummary = (values: PlaceDetailsValues) => {
    setSummary((prev) => {
      if (!prev) return prev;
      const place = prev.place;
      const base: SummaryPlace = {
        ...(place ?? {}),
        place_name: place?.place_name ?? null,
        location: place?.location ?? { province: null, district: null },
        category: place?.category ?? [],
        activities: place?.activities ?? [],
        otop_products: place?.otop_products ?? [],
        highlights: place?.highlights ?? [],
        tags: place?.tags ?? [],
        price_info: {
          weekday: place?.price_info?.weekday ?? null,
          weekend: place?.price_info?.weekend ?? null,
          currency: place?.price_info?.currency ?? "THB",
          level: values.priceLevel,
        },
        contact: { ...(place?.contact ?? {}) },
        opening_hours: place?.opening_hours ?? null,
      };
      if (values.website) base.contact.website = values.website;
      if (values.phone) base.contact.phone = values.phone;
      if (values.openingHours) base.opening_hours = values.openingHours;
      return { ...prev, place: base };
    });
  };

  /**
   * The host corrected something — their value is final.
   *
   * It goes into the card and into the summary, so what the host sees, what
   * the video carries and what the AI chat says all agree.
   */
  const applyPlaceDetails = (patch: Partial<PlaceDetailsValues>) => {
    const next: PlaceDetailsValues = { ...placeDetails };
    const edited: Partial<Record<keyof PlaceDetailsValues, boolean>> = {};
    (Object.keys(patch) as (keyof PlaceDetailsValues)[]).forEach((key) => {
      const value = patch[key];
      if (value === undefined) return;
      next[key] = value;
      edited[key] = true;
    });
    setPlaceDetails(next);
    setPlaceDetailsEdited((prev) => ({ ...prev, ...edited }));
    writePlaceDetailsToSummary(next);
  };

  /**
   * A place was confirmed — seed the card with what we know about it.
   *
   * The place's OWN row wins (its owner may have corrected it before), then
   * Google. A field the host set by hand is theirs and stays theirs.
   */
  const seedPlaceDetails = (values: PlaceDetailsValues, samePlace: boolean) => {
    const next: PlaceDetailsValues = { ...values };
    if (samePlace) {
      (Object.keys(next) as (keyof PlaceDetailsValues)[]).forEach((key) => {
        if (placeDetailsEdited[key]) next[key] = placeDetails[key];
      });
    } else {
      // A different place: the corrections belonged to the one they replaced.
      setPlaceDetailsEdited({});
    }
    setPlaceDetails(next);
    writePlaceDetailsToSummary(next);
  };

  const player = useVideoPlayer(videoUri ?? "", (p) => {
    p.loop = true;
    p.muted = true;
  });

  const rawPlaceResults = locationQuery.trim().length >= 1 ? searchPlaces(locationQuery) : [];
  // For host in community spot mode, restrict results to their own province
  const placeResults = isHost && hostPostMode === "community_spot" && user?.otop_province
    ? rawPlaceResults.filter(p => p.provinceName === user.otop_province)
    : rawPlaceResults;

  // Generate the AI summary from the VIDEO itself (video-only, no caption).
  const runSummary = async (overrides?: { videoUrl?: string }) => {
    // Summary is produced from the VIDEO itself only (no caption/location),
    // so it can feed the caption helper as an independent source.
    const url = overrides?.videoUrl ?? draftVideoUrl;
    if (!url) return;
    setSummaryLoading(true);
    setSummaryEditing(false);

    let result: Awaited<ReturnType<typeof generatePreviewSummary>> | null = null;
    try {
      result = await generatePreviewSummary({
        videoUrl: url,
        audioType: "speech",
        // In own_business mode for hosts, pass their registered place as context
        // so AI summarizes atmosphere only, NOT guessing location.
        uploaderType: isHost && hostPostMode === "own_business" ? "community" : "tourist",
        location: isHost && hostPostMode === "own_business" && hostLocation
          ? [hostLocation.placeName, hostLocation.community, hostLocation.subdistrict,
             hostLocation.district, hostLocation.province].filter(Boolean).join(" ")
          : undefined,
      });
    } catch (err) {
      // The call FAILED — leave every location field exactly as the user left
      // it. Previously a failure produced `null`, which fell into the
      // "AI found no place" branch below and silently wiped whatever they had
      // typed in.
      const aiErr = asAiError(err);
      console.warn("[summary] FAIL", aiErr?.status ?? "-", aiErr?.message ?? err);
      setSummary(null);
      setSummaryDraft("");
      // รายงานจาก backend บอกได้ว่าติดที่ขั้นไหน — ไม่ต้องเดา
      const diag = extractDiag(err);
      setSummaryDiag(diag);
      if (diag) setShowDiag(true);
      const why = diag?.problems?.length
        ? `\n\nสาเหตุ:\n${diag.problems.map((p) => `• ${p}`).join("\n")}`
        : "";
      Alert.alert(
        "สรุปไม่สำเร็จ",
        `${aiErr?.message ?? "เรียก AI ไม่สำเร็จ"}${why}\n\nข้อมูลสถานที่ที่กรอกไว้ไม่ถูกแตะต้อง — กด "สรุปใหม่" เพื่อลองอีกครั้ง`
      );
      return;
    } finally {
      setSummaryLoading(false);
    }

    setSummary(result);
    setSummaryDraft(result?.text ?? "");
    setSummaryDiag(result?._diag ?? null);
    setAccuracy(0);
    // The place's details are the place's, not the summary's — put them back
    // after a regeneration, so a fresh summary never drops them.
    writePlaceDetailsToSummary(placeDetails);

    // ── Host in own_business mode: ต้อง "ตรวจเทียบเสมอ" (D5) ──
    // เดิมล็อกตำแหน่งจากทะเบียนโดยไม่เคยตรวจ (สำเร็จเสมอ เพราะไม่เคยเทียบ)
    // ตอนนี้ต้องเทียบกับทะเบียนจริง และผู้ใช้ต้องกดยืนยันเสมอ (D27)
    if (isHost && hostLocation && hostPostMode === "own_business") {
      console.log("[summary] host own_business → verify against the registered place");
      setLocationSource("otop");
      setLocationConfirmed(false);
      setVerify(null);
      // ค่าเริ่มต้นยังเป็นตำแหน่งทะเบียน — ผู้ใช้ต้องยืนยันเอง
      if (hostLocation.lat != null && hostLocation.lng != null) {
        setCoords({ lat: hostLocation.lat, lng: hostLocation.lng });
      }
      setPlaceName(hostLocation.placeName);
      setLocationName(hostLocation.locationName);
      setCommunity(hostLocation.community);
      setSubdistrict(hostLocation.subdistrict);
      setDistrict(hostLocation.district);
      setProvince(hostLocation.province);
      await verifyOwnBusiness();
    } else if (result?.place) {
      // Tourist or host in community_spot mode: verify AI location normally
      const aiPlaceName = result.place.place_name ?? null;
      const aiCommunity = (result.place as any).community ?? null;
      const aiLoc = result.place.location ?? ({} as any);
      const aiProvince = aiLoc.province ?? null;
      const aiName = aiPlaceName || aiCommunity || "";

      if (isHost && hostLocation && hostPostMode === "community_spot") {
        // community_spot: AI may suggest a nearby place — still verify but scoped to tambol
        console.log("[summary] host community_spot → AI location verify (scoped to tambol)");
        setLocationSource("ai");
        if (aiName || aiProvince) {
          await runLocationVerify(result.place);
        }
      } else {
        setLocationSource("ai");
        await runLocationVerify(result.place);
      }
    } else if (!(isHost && hostPostMode === "own_business")) {
      // The call SUCCEEDED and AI genuinely found no place → clear location.
      // (Only reachable now that transport errors return early above.)
      console.log("[summary] AI found no place → clearing location");
      setLocationName("");
      setPlaceName("");
      setCommunity("");
      setSubdistrict("");
      setDistrict("");
      setProvince("");
      setCoords(null);
      setLocationConfirmed(false);
      setVerify(null);
      setLocationSource("manual");
    }
  };

  // Verify + reconcile the AI's location against local data; never auto-pick
  // when ambiguous — surface candidates for the user to choose.
  //
  // PLAN §6.3 — สามขั้น:
  //   ① มี candidate จาก backend → เทียบกับทะเบียน (D2) → การ์ด "ตรง / ไม่ตรง"
  //   ② ไม่มี candidate → เช็ค cache ตาราง places → ไม่เจอก็ค้น Google เอง
  //   ③ ผู้ใช้กด "ไม่ใช่ที่นี่" → searchInCommunity()
  const runLocationVerify = async (place: NonNullable<AiSummaryResult["place"]>) => {
    const aiPlaceName = place.place_name ?? null;
    const aiCommunity = (place as any).community ?? null;
    const loc = place.location ?? ({} as any);
    // Backend may have already run Google Places enrichment.
    const backendCandidates: PlaceCandidate[] = (place as any).google_candidates ?? [];
    const aiGps: string | null = loc.gps ?? null;

    console.log("[verify] aiPlaceName =", aiPlaceName, "community =", aiCommunity,
      "province =", loc.province, "district =", loc.district,
      "backendCandidates =", backendCandidates.length, "aiGps =", aiGps);

    const res = verifyLocationOffline({
      placeName: aiPlaceName,
      community: aiCommunity,
      subdistrict: loc.subdistrict ?? null,
      district: loc.district ?? null,
      province: loc.province ?? null,
    });
    setVerify(res);
    setLocationConfirmed(false);

    setGoogleCandidates([]);
    setCoords(null);
    setPendingConfirm(null);
    setRegisteredMatch(null);
    setCommunitySearch(null);

    // Prefill the form from what the AI read out of the clip (name / area /
    // coords). This is the AI's own reading — the user still confirms it.
    if (aiPlaceName) setPlaceName(aiPlaceName);
    if (aiCommunity) setCommunity(aiCommunity);
    if (loc.subdistrict) setSubdistrict(loc.subdistrict);
    if (loc.district) setDistrict(loc.district);
    if (loc.province) setProvince(loc.province);
    const label = aiPlaceName || aiCommunity || "";
    if (label) setLocationName(label);
    if (aiGps) {
      const [lat, lng] = aiGps.split(",").map(Number);
      if (!isNaN(lat) && !isNaN(lng)) setCoords({ lat, lng });
    }

    // รู้จัก "ที่ลงทะเบียน" ของขอบเขตนี้ก่อน — เทียบด้วย Google id (D2)
    await resolveRegisteredPlace();

    // ── ① Google Places results the backend already fetched ──
    // Nothing is written into the form here. The user TICK-CONFIRMS first;
    // only then do we spend one Place Details call and fill the fields.
    if (backendCandidates.length > 0) {
      console.log("[verify] using", backendCandidates.length, "backend Google candidates");
      showCandidates(sortByMatchLevel(backendCandidates));
      return;
    }

    // ── ② check our local confirmed places store ──
    if (aiPlaceName) {
      const local = await findLocalPlaces({
        name: aiPlaceName,
        province: loc.province,
        district: loc.district,
      });
      setLocalPlaceCandidates(local);
      // ไม่ auto-pick แล้ว (D7) — การเทียบด้วยชื่อทำให้เลือกผิดได้
      // ("บ้านปาย" ไปตรงกับ "บ้านปายใหม่") และเลิกค้น Google ทิ้ง
      // ── ③ call Google ourselves if backend didn't enrich ──
      if (local.length === 0) {
        void lookupOnGoogle(aiPlaceName);
      }
    } else {
      setLocalPlaceCandidates([]);
    }
  };

  /**
   * แสดงผลค้นของ Google ให้ผู้ใช้เลือก
   *
   * เทียบกับทะเบียนก่อนเสมอ (D2): ถ้าตรง → การ์ด "✓ ตรงกับที่ลงทะเบียน"
   * ถ้าไม่ตรง → รายการให้เลือก (หรือการ์ดเดียวถ้ามีอันเดียว)
   */
  const showCandidates = (list: PlaceCandidate[]) => {
    // เส้นทาง ③: ผู้ใช้บอกแล้วว่า "ไม่ใช่ที่ลงทะเบียน" → ไม่ต้องเทียบทะเบียนซ้ำ
    // (ไม่งั้นจะวนกลับมาการ์ดเดิมทุกครั้งที่กด "ค้นกว้างขึ้น")
    const hit = communitySearch
      ? { kind: "none" as const, candidate: null }
      : matchAgainstRegistered(list, registeredPlace?.placeId ?? null);
    setRegisteredMatch(hit.candidate);
    if (hit.candidate) {
      setPendingName(hit.candidate.name);
      setPendingAddress(hit.candidate.address);
      setGoogleCandidates([]);
      return;
    }
    if (list.length === 1) {
      // One result still needs the user's tick — do not fill the form yet.
      setPendingConfirm(list[0]);
      setPendingName(list[0].name);
      setPendingAddress(list[0].address);
      setGoogleCandidates([]);
      return;
    }
    setGoogleCandidates(list);
  };

  /**
   * โหมด own_business — เทียบกับทะเบียนเสมอ (D5)
   *
   * • ตรง → การ์ด "✓ ตรงกับที่ลงทะเบียนของคุณ" → ยืนยัน → ใช้ตำแหน่งทะเบียน
   * • ไม่ตรง → รายการให้เลือก (โหมด "สถานที่ใหม่ในชุมชน")
   * • ไม่มี candidate → ให้ host เลือกหมุดเอง (D17)
   */
  const verifyOwnBusiness = async () => {
    const scope = resolveScope();
    const name = hostBusinessName.trim();
    await resolveRegisteredPlace();
    setVerify(
      verifyLocationOffline({
        placeName: name || null,
        community: scope.community || null,
        subdistrict: scope.subdistrict || null,
        district: scope.district || null,
        province: scope.province || null,
      })
    );
    if (!name) {
      // ไม่มีชื่อที่จะค้น — host ต้องยืนยันเอง
      setRegisteredMatch(null);
      return;
    }
    setGoogleLoading(true);
    const r = await verifyPlaceOnGoogle({
      placeName: name,
      community: scope.community || undefined,
      subdistrict: scope.subdistrict || undefined,
      district: scope.district || undefined,
      province: scope.province || undefined,
    });
    console.log("[own_business] candidates =", r.candidates.length);
    setGoogleLoading(false);
    if (r.candidates.length === 0) {
      setRegisteredMatch(null);
      setGoogleCandidates([]);
      return;
    }
    showCandidates(sortByMatchLevel(r.candidates));
  };

  /**
   * เส้นทาง ③ — "ค้นหาใหม่ในชุมชนนี้" (PLAN §6.5 · D24)
   *
   * ค้นระดับตำบลก่อน (strict) → ถ้ายังไม่มีอะไรที่อยู่ "ในหมู่บ้าน" จริง
   * ผู้ใช้กด "ค้นกว้างขึ้น (ทั้งอำเภอ)" → ค้นใหม่โดยถอดตำบลออก
   */
  const searchInCommunity = async (level: "subdistrict" | "district" = "subdistrict") => {
    const scope = resolveScope();
    const name = placeName.trim() || locationName.trim();
    if (!name) return;
    setCommunitySearch(level);
    setGoogleLoading(true);
    setPendingConfirm(null);
    setRegisteredMatch(null);
    setGoogleCandidates([]);
    const r = await verifyPlaceOnGoogle({
      placeName: name,
      community: scope.community || undefined,
      // ระดับอำเภอ = ถอดตำบลออก (คำค้นกว้างขึ้นจริง ๆ)
      subdistrict: level === "subdistrict" ? scope.subdistrict || undefined : undefined,
      district: scope.district || undefined,
      province: scope.province || undefined,
      strict: true,
      scopeLevel: level,
    });
    console.log("[community-search] level =", level, "candidates =", r.candidates.length);
    setGoogleLoading(false);
    if (r.candidates.length === 0) {
      setGoogleCandidates([]);
      return;
    }
    showCandidates(sortByMatchLevel(r.candidates));
  };

  const lookupOnGoogle = async (
    name: string
  ) => {
    console.log("[google] lookupOnGoogle name =", name);
    setGoogleLoading(true);
    setPendingConfirm(null);
    setRegisteredMatch(null);
    setGoogleCandidates([]);
    // A host posting a community spot may only find places inside their own
    // community — scope the search to it instead of the whole country.
    const scopeCommunity =
      isHost && hostPostMode === "community_spot"
        ? hostLocation?.community || user?.otop_village || ""
        : community.trim();
    const scopeSubdistrict =
      isHost && hostPostMode === "community_spot"
        ? hostLocation?.subdistrict || user?.business_subdistrict || user?.otop_tambol || ""
        : subdistrict.trim();
    const scopeDistrict =
      isHost && hostPostMode === "community_spot"
        ? hostLocation?.district || user?.business_district || user?.otop_amphur || ""
        : district.trim();
    const scopeProvince =
      isHost && hostPostMode === "community_spot"
        ? hostLocation?.province || user?.business_province || user?.otop_province || ""
        : province.trim();

    const r = await verifyPlaceOnGoogle({
      placeName: name,
      community: scopeCommunity || undefined,
      subdistrict: scopeSubdistrict || undefined,
      district: scopeDistrict || undefined,
      province: scopeProvince || undefined,
    });
    console.log("[google] result configured =", r.configured, "candidates =", r.candidates.length);
    setGoogleLoading(false);
    if (r.candidates.length === 0) {
      setGoogleCandidates([]);
      return;
    }
    showCandidates(sortByMatchLevel(r.candidates));
  };

  /**
   * The user ticked a Google candidate.
   *
   * This is the ONLY place we spend a Place Details call: we fetch the full
   * record for that one place id, write it into the form, and fold the
   * contact/atmosphere fields (phone, website, price band, opening hours)
   * into the AI summary.
   */
  const confirmGooglePlace = async (c: PlaceCandidate, nameOverride?: string) => {
    if (confirmingPlace) return;
    setConfirmingPlace(true);
    setPlaceDetailsReady(false);
    const name = (nameOverride ?? c.name).trim() || c.name;
    let place = c;

    try {
      if (c.placeId) {
        const details = await fetchPlaceDetails(c.placeId);
        if (details.place) place = details.place;
      }

      const confirmed: PlaceCandidate = { ...place, name };
      applyGoogleCandidate(confirmed);
      setConfirmedPlace(confirmed);

      // Fold the confirmed place's details into the card. We already paid for
      // the Place Details call, so phone / website / price band / opening
      // hours all come along for free.
      //
      // The place's OWN values win where we already hold them: if the owner
      // corrected the price or the phone, the host editing this clip should
      // see — and the AI should be told — the corrected ones, not Google's.
      const saved = confirmed.placeId
        ? await fetchPlaceDetailsRow(confirmed.placeId).catch(() => null)
        : null;
      seedPlaceDetails(
        {
          priceLevel: saved?.price_level ?? priceLevelLabel(confirmed.priceLevel) ?? null,
          website: saved?.website ?? confirmed.website ?? null,
          phone: saved?.phone ?? confirmed.phone ?? null,
          openingHours: saved?.opening_hours ?? confirmed.openingHours ?? null,
        },
        confirmedPlace?.placeId === confirmed.placeId,
      );
      // The card opens only now, with the values already in it.
      setPlaceDetailsReady(true);

      // ผูกกับชุมชน (D4) + ระดับที่จับคู่ได้ (D28)
      // host → ชุมชนของตัวเอง · tourist → หาจากบริเวณของสถานที่
      // (ถ้าหลายชุมชน → resolveCommunityFor จะเปิดการ์ดให้ผู้ใช้เลือก)
      await resolveCommunityFor(confirmed);
      const level = matchLevelOf(confirmed);
      setCommunityMatchLevel(level);

      // เขียนชุมชน/ชื่อที่ยืนยันแล้วกลับลง summary (PLAN §6.9)
      writeConfirmedPlaceToSummary(confirmed, community.trim() || null);

      // Save to Supabase places store immediately so it appears on the map.
      void saveVerifiedPlace({
        name: confirmed.name,
        community: community.trim() || null,
        subdistrict: (confirmed.subdistrict ?? subdistrict.trim()) || null,
        district: (confirmed.district ?? district.trim()) || null,
        province: (confirmed.province ?? province.trim()) || null,
        latitude: confirmed.latitude,
        longitude: confirmed.longitude,
        googlePlaceId: confirmed.placeId || null,
        source: "google",
      });

      // D17 — host เลือกหมุดที่ไม่ใช่ที่ลงทะเบียน → บันทึกกลับไว้
      // เป็น "ที่ของฉัน" เพื่อให้ครั้งหน้าเทียบได้ตรง (D2 ใช้ได้จริง)
      if (
        isCommunityHost &&
        confirmed.placeId &&
        confirmed.placeId !== user?.business_place_id
      ) {
        void rememberBusinessPlace(confirmed);
      }
    } finally {
      setConfirmingPlace(false);
    }
  };

  /**
   * D17 — จำ "ที่ของฉัน" ใหม่ (host เลือกเองตอนโพสต์)
   *
   * เขียนกลับ `users.business_place_id` ผ่าน backend เดียวกับที่โปรไฟล์ใช้
   * → ครั้งหน้าที่โพสต์จะเทียบกับทะเบียนได้ตรง (D2)
   */
  const rememberBusinessPlace = async (c: PlaceCandidate) => {
    try {
      await upsertMyPlace({
        users: {
          businessPlaceId: c.placeId,
          businessPlaceName: c.name,
          businessLat: c.latitude,
          businessLng: c.longitude,
          businessAddress: c.address,
          businessSubdistrict: c.subdistrict,
          businessDistrict: c.district,
          businessProvince: c.province,
        },
      });
      await refreshUser();
      console.log("[own_business] saved the chosen place as the host's own");
    } catch (e: any) {
      console.warn("[own_business] could not save the chosen place:", e?.message ?? e);
    }
  };

  // Confirm the single Google result (after optional editing).
  const confirmPending = async () => {
    if (!pendingConfirm) return;
    const name = pendingName.trim() || pendingConfirm.name;
    await confirmGooglePlace(pendingConfirm, name);
    setPendingConfirm(null);
  };

  const applyGoogleCandidate = (c: PlaceCandidate) => {
    setPlaceName(c.name);
    if (c.subdistrict) setSubdistrict(c.subdistrict);
    if (c.district) setDistrict(c.district);
    if (c.province) setProvince(c.province);
    setLocationName(c.name);
    if (c.latitude != null && c.longitude != null) setCoords({ lat: c.latitude, lng: c.longitude });
    setLocationConfirmed(true);
    setPendingConfirm(null);
    setGoogleCandidates([]);
    setLocationSource("ai");
    setVerify(null);
  };

  const applyLocalPlace = (p: LocalPlace) => {
    setPlaceName(p.name);
    if (p.community) setCommunity(p.community);
    if (p.subdistrict) setSubdistrict(p.subdistrict);
    if (p.district) setDistrict(p.district);
    if (p.province) setProvince(p.province);
    setLocationName(p.name);
    setLocationConfirmed(true);
    setLocationSource("ai");
    setVerify(null);
  };

  const selectPlace = (p: PlaceItem) => {
    setLocationName(p.name);
    setCommunity(p.name);
    setSubdistrict(p.subdistrict);
    setProvince(p.provinceName);
    setDistrict(p.districtName);
    setLocationQuery("");
    setCaptionIdeas([]);
    setLocationConfirmed(true);
    setLocationSource("manual");
    setVerify(null);
  };
  const clearLocation = () => {
    setLocationName("");
    setPlaceName("");
    setCommunity("");
    setSubdistrict("");
    setProvince("");
    setDistrict("");
    setLocationQuery("");
    setCaptionIdeas([]);
    setHashtagIdeas([]);
    setVerify(null);
    setLocalPlaceCandidates([]);
    setLocationConfirmed(false);
    setGoogleCandidates([]);
    setPendingConfirm(null);
    setLocationSource("manual");
    setConfirmedPlace(null);
    setPlaceDetails({ priceLevel: null, website: null, phone: null, openingHours: null });
    setPlaceDetailsEdited({});
    setPlaceDetailsReady(false);
    // สถานะการจับคู่กับชุมชน — ล้างตาม
    setRegisteredMatch(null);
    setRegisteredPlace(null);
    setConfirmedCommunityId(null);
    setCommunityMatchLevel(null);
    setCommunitySearch(null);
    setCommunityChoices([]);
  };

  const pickVideo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("ต้องการสิทธิ์เข้าถึงคลังวิดีโอ", "โปรดอนุญาตให้แอปเข้าถึงคลังสื่อเพื่อเลือกวิดีโอ");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      quality: 1,
      videoMaxDuration: 120,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      const uri = result.assets[0].uri;
      setVideoUri(uri);
      // Upload a draft copy to Storage → get a public URL → let the backend
      // AI analyze the VIDEO directly, right after the clip is picked.
      setSummaryLoading(true);
      try {
        const { path, url } = await uploadDraftVideo(uri);
        setDraftVideoPath(path);
        setDraftVideoUrl(url);
        await runSummary({ videoUrl: url });
      } catch (e: any) {
        setSummaryLoading(false);
        Alert.alert("เตรียมวิดีโอไม่สำเร็จ", e?.message ?? "ลองเลือกวิดีโอใหม่อีกครั้ง");
      }
    }
  };

  const removeVideo = () => {
    // The draft copy is dead weight now — drop it so the clip isn't stored twice.
    if (draftVideoPath) void deleteDraftVideo(draftVideoPath);
    setVideoUri(null);
    setDraftVideoUrl(null);
    setDraftVideoPath(null);
    setSummary(null);
    setSummaryDraft("");
    setSummaryEditing(false);
    setAccuracy(0);
    // Reset location back to OTOP defaults for hosts, or clear for tourists.
    if (isHost && hostLocation) {
      setLocationName(hostLocation.locationName);
      setCommunity(hostLocation.community);
      setSubdistrict(hostLocation.subdistrict);
      setDistrict(hostLocation.district);
      setProvince(hostLocation.province);
      setPlaceName("");
      setLocationConfirmed(true);
      setVerify(null);
      setGoogleCandidates([]);
      setPendingConfirm(null);
      setLocationSource("otop");
    } else {
      setLocationName("");
      setPlaceName("");
      setCommunity("");
      setSubdistrict("");
      setDistrict("");
      setProvince("");
      setLocationQuery("");
      setVerify(null);
      setLocalPlaceCandidates([]);
      setLocationConfirmed(false);
      setGoogleCandidates([]);
      setPendingConfirm(null);
      setCoords(null);
    }
  };

  const parseHashtags = (raw: string): string[] =>
    raw
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith("#") ? t : `#${t}`));

  // Save the edited summary text back into the summary object.
  const saveSummaryEdit = () => {
    setSummary((prev) => (prev ? { ...prev, text: summaryDraft.trim() } : prev));
    setSummaryEditing(false);
  };

  // "ให้ AI ช่วยคิดแคปชัน" — use the already-generated summary as context.
  const handleAiCaption = async () => {
    setCaptionLoading(true);
    setCaptionIdeas([]);
    setHashtagIdeas([]);
    try {
      const { captions: ideas, hashtags: tagIdeas } = await suggestCaptions({
        draft: caption,
        locationName,
        province,
        district,
        hashtags: parseHashtags(hashtags),
        summaryText: summary?.text,
        highlights: summary?.highlights ?? summary?.place?.highlights,
      });
      setCaptionIdeas(ideas);
      setHashtagIdeas(tagIdeas);
      if (ideas.length === 0) {
        Alert.alert("ขออภัย", "AI ตอบกลับมาแต่ไม่มีแคปชันให้ใช้ ลองใหม่อีกครั้งนะคะ");
      }
    } catch (err) {
      // Show the actual reason (401 / timeout / unreachable), not a fixed
      // apology that hid all four from the user.
      const aiErr = asAiError(err);
      console.warn("[caption] FAIL", aiErr?.status ?? "-", aiErr?.message ?? err);
      Alert.alert("ขอแคปชันไม่สำเร็จ", aiErr?.message ?? "เรียก AI ไม่สำเร็จ");
    } finally {
      setCaptionLoading(false);
    }
  };

  /** Add a suggested hashtag to the field (no duplicates). */
  const addHashtag = (tag: string) => {
    const clean = tag.replace(/^#+/, "").trim();
    if (!clean) return;
    setHashtags((prev) => {
      const existing = parseHashtags(prev).map((t) => t.replace(/^#/, ""));
      if (existing.includes(clean)) return prev;
      return prev.trim() ? `${prev.trim()} ${clean}` : clean;
    });
  };

  const handlePost = async () => {
    if (!videoUri) {
      Alert.alert("ยังไม่ได้เลือกวิดีโอ", "กรุณาเลือกวิดีโอก่อนโพสต์");
      return;
    }
    setUploading(true);
    try {
      // Persist the reviewed summary text (if the user edited it in-place).
      const finalSummary: AiSummaryResult | null = summary
        ? { ...summary, text: summaryEditing ? summaryDraft.trim() : summary.text }
        : null;

      // Save the specific place to the Local `places` store (accumulates so
      // later posts resolve it for free). Only when the user confirmed one.
      if (placeName.trim() && (province.trim() || district.trim())) {
        void saveVerifiedPlace({
          name: placeName.trim(),
          community: community.trim() || null,
          subdistrict: subdistrict.trim() || null,
          district: district.trim() || null,
          province: province.trim() || null,
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
          source: coords ? "google" : "manual",
        });
      }

      await uploadVideo({
        localUri: videoUri,
        caption: caption.trim(),
        hashtags: parseHashtags(hashtags),
        locationName: locationName.trim() || undefined,
        placeName: placeName.trim() || undefined,
        community: community.trim() || undefined,
        subdistrict: subdistrict.trim() || undefined,
        province: province.trim() || undefined,
        district: district.trim() || undefined,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        aiSummary: finalSummary,
        summaryAccuracy: accuracy > 0 ? accuracy : null,
        // The draft copy was only there so the AI could read the clip —
        // the real upload is done, so let the service delete the draft.
        draftPath: draftVideoPath,
      });

      // The place's details are the AI's ground truth — the same row a
      // traveller's question is answered from. Save them now that the clip is
      // up; a failure here must not cost the host their video.
      //
      // A field the host set by hand travels even when it is empty (that
      // clears the column); a field we simply don't know is left out, so a
      // value the place's owner already saved survives.
      const detailValue = (key: keyof PlaceDetailsValues): string | undefined =>
        placeDetailsEdited[key]
          ? (placeDetails[key] ?? "")
          : (placeDetails[key] ?? undefined);

      let placeSaveWarning: string | null = null;
      // D11 — จับคู่ชุมชนไม่ได้ = ไม่บันทึกสถานที่ (ไม่มีแถว "รอตรวจ")
      // host บันทึกได้เสมอ · tourist ต้องรู้ชุมชนก่อน
      const canSavePlace =
        !!confirmedPlace?.placeId && (isCommunityHost || !!confirmedCommunityId);
      if (confirmedPlace?.placeId && !canSavePlace) {
        placeSaveWarning =
          "ยังไม่ทราบว่าสถานที่นี้อยู่ชุมชนไหน — ข้อมูลสถานที่จึงยังไม่ถูกบันทึกเข้าชุมชน";
      }
      if (canSavePlace && confirmedPlace?.placeId) {
        try {
          await savePlaceDetails({
            placeId: confirmedPlace.placeId,
            placeName: placeName.trim() || confirmedPlace.name,
            province: confirmedPlace.province || province.trim(),
            district: confirmedPlace.district ?? (district.trim() || null),
            subdistrict: confirmedPlace.subdistrict ?? (subdistrict.trim() || null),
            village: community.trim() || null,
            formattedAddress: confirmedPlace.address ?? null,
            latitude: confirmedPlace.latitude ?? coords?.lat ?? null,
            longitude: confirmedPlace.longitude ?? coords?.lng ?? null,
            googleMapsUrl: confirmedPlace.googleMapsUri ?? null,
            // ชุมชน + ระดับการจับคู้ (D4 / D28)
            communityId: confirmedCommunityId,
            communityMatchLevel: communityMatchLevel,
            // ข้อมูลของเจ้าของสถานที่ — host แก้ได้เท่านั้น (D6)
            priceLevel: isCommunityHost ? detailValue("priceLevel") : undefined,
            website: isCommunityHost ? detailValue("website") : undefined,
            phone: isCommunityHost ? detailValue("phone") : undefined,
            openingHours: isCommunityHost ? detailValue("openingHours") : undefined,
            // What the clip said about this place — capacity, rules, zones,
            // facilities. Same row, so the AI chat can answer "มีกี่ห้อง"
            // without the traveller watching the clip. A clip that said
            // nothing leaves the place's own value alone.
            capacity: finalSummary?.place?.capacity ?? undefined,
            rules: finalSummary?.place?.rules ?? undefined,
            areas: finalSummary?.place?.areas ?? undefined,
            facilities: finalSummary?.place?.facilities ?? undefined,
          });
        } catch (e: any) {
          console.warn("[post] save place details failed:", e);
          placeSaveWarning = e?.message ?? "บันทึกข้อมูลสถานที่ไม่สำเร็จ";
        }
      }

      setUploading(false);
      Alert.alert(
        "โพสต์สำเร็จ 🎉",
        placeSaveWarning
          ? `วิดีโอของคุณขึ้นฟีดแล้ว พร้อมสรุปจาก AI\n\nแต่ข้อมูลสถานที่บันทึกไม่สำเร็จ: ${placeSaveWarning}`
          : "วิดีโอของคุณขึ้นฟีดแล้ว พร้อมสรุปจาก AI",
        [
          {
            text: "ตกลง",
            onPress: () => {
              removeVideo();
              setCaption("");
              setHashtags("");
              clearLocation();
              onPosted?.();
            },
          },
        ]
      );
    } catch (e: any) {
      setUploading(false);
      Alert.alert("โพสต์ไม่สำเร็จ", e?.message ?? "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");
    }
  };

  if (!session) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-10" style={{ paddingTop: insets.top }}>
        <VideoCameraIcon size={44} color="#D1D5DB" />
        <Text className="text-gray-500 text-center mt-3 leading-6">
          กรุณาเข้าสู่ระบบก่อน จึงจะโพสต์วิดีโอได้
        </Text>
      </View>
    );
  }

  const canPost = !!videoUri && !uploading;

  return (
    <View className="flex-1 bg-white">
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header with cancel + title */}
      <View
        style={{ paddingTop: Math.max(insets.top, 16) + (Platform.OS === "android" ? 8 : 4) }}
        className="px-4 pb-3 flex-row items-center justify-between border-b border-gray-100"
      >
        <TouchableOpacity onPress={onCancel} className="p-1">
          <XMarkIcon size={24} color="#18181B" />
        </TouchableOpacity>
        <Text className="text-[17px] font-black text-gray-900">สร้างโพสต์</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 18, paddingBottom: 40 }}
      >
        {/* Video picker / preview */}
        {videoUri ? (
          <View className="rounded-2xl overflow-hidden bg-black mb-4" style={{ height: 300 }}>
            <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={false} />
            <TouchableOpacity
              onPress={removeVideo}
              className="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/60 items-center justify-center"
            >
              <XMarkIcon size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={pickVideo}
            activeOpacity={0.8}
            className="rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 items-center justify-center mb-4"
            style={{ height: 200 }}
          >
            <VideoCameraIcon size={40} color="#9CA3AF" />
            <Text className="text-gray-500 font-semibold mt-2">แตะเพื่อเลือกวิดีโอจากคลัง</Text>
            <Text className="text-gray-400 text-[12px] mt-1">ความยาวไม่เกิน 2 นาที</Text>
          </TouchableOpacity>
        )}

        {/* AI Summary card — generated right after a clip is picked */}
        {videoUri && (
          <View className="mb-4 bg-amber-50 border border-amber-200/80 rounded-2xl p-4">
            <View className="flex-row items-center mb-2">
              <View className="w-8 h-8 rounded-full bg-amber-100 items-center justify-center mr-2">
                <SparklesIcon size={16} color="#D97706" />
              </View>
              <View className="flex-1">
                <Text className="text-gray-900 font-black text-[14px]">สรุปวิดีโอโดย AI</Text>
                <Text className="text-gray-400 text-[10px]">
                  สรุปอัตโนมัติตั้งแต่ตอนเลือกคลิป • แก้ไขได้ก่อนโพสต์
                </Text>
              </View>
              {!summaryLoading && (
                <TouchableOpacity
                  onPress={() => runSummary()}
                  activeOpacity={0.7}
                  className="w-8 h-8 rounded-full bg-white border border-amber-200 items-center justify-center"
                >
                  <ArrowPathIcon size={15} color="#D97706" />
                </TouchableOpacity>
              )}
            </View>

            {summaryLoading ? (
              <View className="py-6 items-center">
                <ActivityIndicator color="#D97706" />
                <Text className="text-amber-700/80 text-[12px] mt-2">AI กำลังสรุปวิดีโอ...</Text>
              </View>
            ) : summary ? (
              <>
                {summaryEditing ? (
                  <TextInput
                    value={summaryDraft}
                    onChangeText={setSummaryDraft}
                    multiline
                    autoFocus
                    placeholder="แก้ไขสรุปให้ตรงกับวิดีโอ..."
                    placeholderTextColor="#B45309"
                    className="bg-white border border-amber-200 rounded-xl px-3 py-2.5 text-[13.5px] text-gray-800"
                    style={{ minHeight: 90, textAlignVertical: "top" }}
                  />
                ) : (
                  <Text className="text-gray-800 text-[13.5px] leading-6">
                    {summary.text || "AI ไม่ได้ส่งเนื้อหาสรุปกลับมา"}
                  </Text>
                )}

                {/* Highlights (read-only preview) */}
                {!summaryEditing && !!(summary.highlights ?? summary.place?.highlights)?.length && (
                  <View className="mt-2.5">
                    {(summary.highlights ?? summary.place?.highlights)!.slice(0, 4).map((h, i) => (
                      <View key={i} className="flex-row mb-1">
                        <Text className="text-amber-600 mr-1.5">•</Text>
                        <Text className="text-gray-600 text-[12px] leading-5 flex-1">{h}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Edit / Save control */}
                <View className="flex-row justify-end mt-2">
                  {summaryEditing ? (
                    <TouchableOpacity
                      onPress={saveSummaryEdit}
                      activeOpacity={0.8}
                      className="flex-row items-center bg-[#2D6A4F] px-3 py-1.5 rounded-full"
                    >
                      <CheckIcon size={14} color="#FFFFFF" />
                      <Text className="text-white text-[12px] font-bold ml-1">บันทึกสรุป</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => {
                        setSummaryDraft(summary.text ?? "");
                        setSummaryEditing(true);
                      }}
                      activeOpacity={0.8}
                      className="flex-row items-center bg-white border border-amber-300 px-3 py-1.5 rounded-full"
                    >
                      <PencilSquareIcon size={14} color="#B45309" />
                      <Text className="text-amber-700 text-[12px] font-bold ml-1">แก้ไขสรุป</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Accuracy rating — feedback for improving the AI */}
                <View className="mt-3 pt-3 border-t border-amber-200/70">
                  <Text className="text-gray-600 text-[12px] mb-1.5">
                    สรุปของ AI ตรงกับวิดีโอแค่ไหน?{" "}
                    <Text className="text-gray-400">(ช่วยพัฒนา AI)</Text>
                  </Text>
                  <View className="flex-row items-center">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <TouchableOpacity
                        key={n}
                        onPress={() => setAccuracy(n)}
                        activeOpacity={0.7}
                        className="mr-1.5"
                      >
                        {n <= accuracy ? (
                          <StarSolid size={24} color="#F59E0B" />
                        ) : (
                          <StarOutline size={24} color="#D1A75A" />
                        )}
                      </TouchableOpacity>
                    ))}
                    {accuracy > 0 && (
                      <Text className="text-amber-700 text-[12px] font-semibold ml-1.5">
                        {accuracy}/5
                      </Text>
                    )}
                  </View>
                </View>
              </>
            ) : (
              <View className="py-3 items-center">
                <Text className="text-amber-700/80 text-[12px] mb-2 text-center">
                  ยังไม่มีสรุป — ลองกดสรุปอีกครั้ง
                </Text>
                <TouchableOpacity
                  onPress={() => runSummary()}
                  activeOpacity={0.8}
                  className="flex-row items-center bg-amber-500 px-3.5 py-2 rounded-full"
                >
                  <SparklesIcon size={14} color="#FFFFFF" />
                  <Text className="text-white text-[12px] font-bold ml-1">ให้ AI สรุป</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* รายงานการวิเคราะห์ — บอกว่าแต่ละขั้นตอนเกิดอะไรขึ้น
                (โดยเฉพาะตอนข้อมูลไม่ครบ จะได้รู้ว่าติดที่ขั้นไหน) */}
            {summaryDiag && (
              <View className="mt-3 bg-white border border-amber-200 rounded-xl p-3">
                {summaryDiag.problems.length > 0 && (
                  <View className="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-2">
                    <Text className="text-red-700 font-bold text-[12px] mb-1">
                      ทำไมข้อมูลไม่ครบ
                    </Text>
                    {summaryDiag.problems.map((p, i) => (
                      <Text key={i} className="text-red-600 text-[12px] leading-5">
                        • {p}
                      </Text>
                    ))}
                  </View>
                )}

                <TouchableOpacity
                  onPress={() => setShowDiag(!showDiag)}
                  activeOpacity={0.7}
                  className="flex-row items-center"
                >
                  <Text className="text-amber-700 font-bold text-[12px]">
                    {showDiag ? "ซ่อนรายงานการวิเคราะห์" : "ดูรายงานการวิเคราะห์"}
                  </Text>
                  <Text className="text-amber-500 text-[12px] ml-1">
                    {showDiag ? "▲" : "▼"}
                  </Text>
                </TouchableOpacity>

                {showDiag && (
                  <View className="mt-2">
                    {summaryDiag.steps.map((s) => (
                      <View key={s.id} className="flex-row mb-2">
                        <Text className="text-gray-400 w-5 text-[12px]">
                          {s.status === "ok" ? "✓" : s.status === "failed" ? "✗" : "–"}
                        </Text>
                        <View className="flex-1">
                          <Text className="text-gray-700 text-[12px] font-semibold">
                            {s.label}
                            <Text className="text-gray-400 font-normal">
                              {" "}
                              ({s.ms >= 1000 ? `${(s.ms / 1000).toFixed(1)} วิ` : `${s.ms} มิลลิวินาที`})
                            </Text>
                          </Text>
                          {!!s.detail && (
                            <Text className="text-gray-500 text-[12px] leading-4">
                              {s.detail}
                            </Text>
                          )}
                        </View>
                      </View>
                    ))}
                    <Text className="text-gray-400 text-[12px] mt-1">
                      รวม {(summaryDiag.totalMs / 1000).toFixed(1)} วินาที ·{" "}
                      {summaryDiag.steps.length} ขั้นตอน
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* AI location verification card */}
        {verify && !locationConfirmed && (
          <View className="mb-4 bg-blue-50 border border-blue-200 rounded-2xl p-4">
            <View className="flex-row items-center mb-2">
              <MapPinIcon size={16} color="#2563EB" />
              <Text className="text-blue-900 font-black text-[13px] ml-1.5">ตรวจสอบสถานที่จาก AI</Text>
            </View>

            {/* What the AI extracted */}
            <View className="bg-white rounded-xl p-3 mb-2">
              {placeName ? (
                <Text className="text-gray-900 font-bold text-[14px]">📍 {placeName}</Text>
              ) : null}
              <Text className="text-gray-500 text-[12px] mt-0.5">
                {[community, subdistrict && `ต.${subdistrict}`, district && `อ.${district}`, province && `จ.${province}`]
                  .filter(Boolean)
                  .join(" • ") || "ไม่พบข้อมูลสถานที่ในคลิป"}
              </Text>
            </View>

            {/* Warnings */}
            {verify.warnings.map((w, i) => (
              <Text key={i} className="text-amber-700 text-[11px] mb-1">⚠️ {w}</Text>
            ))}

            {/* Previously-confirmed places in Local (choose, don't auto-pick) */}
            {localPlaceCandidates.length > 0 && (
              <>
                <Text className="text-gray-500 text-[11px] font-bold mt-1 mb-1">สถานที่ที่ยืนยันแล้วใน Local:</Text>
                {localPlaceCandidates.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => applyLocalPlace(p)}
                    activeOpacity={0.8}
                    className="bg-white border border-emerald-200 rounded-xl px-3 py-2 mb-1.5"
                  >
                    <Text className="text-gray-900 text-[13px] font-semibold">{p.name}</Text>
                    <Text className="text-gray-400 text-[11px]">
                      {[p.district && `อ.${p.district}`, p.province && `จ.${p.province}`].filter(Boolean).join(" • ")}
                    </Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* OTOP community candidates (choose) */}
            {verify.communityCandidates.length > 0 && (
              <>
                <Text className="text-gray-500 text-[11px] font-bold mt-1 mb-1">
                  {verify.communityCandidates.length > 1 ? "พบหลายชุมชน เลือกที่ถูกต้อง:" : "ชุมชนที่ตรวจพบ:"}
                </Text>
                {verify.communityCandidates.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => selectPlace(p)}
                    activeOpacity={0.8}
                    className="bg-white border border-gray-200 rounded-xl px-3 py-2 mb-1.5"
                  >
                    <Text className="text-gray-900 text-[13px] font-semibold">{p.name}</Text>
                    <Text className="text-gray-400 text-[11px]">อ.{p.districtName} • จ.{p.provinceName}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Google Maps lookup — find WHERE a specific place is */}
            {googleLoading && (
              <View className="flex-row items-center py-2">
                <ActivityIndicator size="small" color="#2563EB" />
                <Text className="text-blue-700 text-[12px] ml-2">กำลังค้นหาใน Google Maps...</Text>
              </View>
            )}

            {/* ── ตรงกับที่ลงทะเบียนของชุมชน (D2 · PLAN §6.4) ──
                candidate ที่ id ตรงกับทะเบียนเป๊ะ → ให้ผู้ใช้กดยืนยัน
                ปุ่ม "ไม่ใช่ที่นี่" ไม่ล้างข้อมูล แต่ไปสู่เส้นทาง ③ */}
            {registeredMatch && !googleLoading && (
              <View className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-3 mb-2">
                <Text className="text-emerald-800 text-[12px] font-bold mb-1.5">
                  ✓ ตรงกับที่ลงทะเบียน{registeredPlace?.label ?? "ของชุมชน"}
                </Text>

                <Text className="text-gray-500 text-[11px] mb-0.5">ชื่อสถานที่</Text>
                <TextInput
                  value={pendingName}
                  onChangeText={setPendingName}
                  className="bg-white border border-emerald-200 rounded-lg px-2.5 py-2 text-[13px] text-gray-900 mb-1.5"
                />

                <Text className="text-gray-400 text-[11px]" numberOfLines={1}>{registeredMatch.address}</Text>
                <Text className="text-gray-500 text-[11px] mt-1">
                  {[registeredMatch.subdistrict && `ต.${registeredMatch.subdistrict}`,
                    registeredMatch.district && `อ.${registeredMatch.district}`,
                    registeredMatch.province && `จ.${registeredMatch.province}`]
                    .filter(Boolean).join(" • ")}
                </Text>

                <View className="flex-row mt-2.5">
                  <TouchableOpacity
                    onPress={() => void confirmGooglePlace(registeredMatch, pendingName)}
                    disabled={confirmingPlace}
                    activeOpacity={0.85}
                    className={`flex-1 rounded-xl py-2.5 items-center mr-1.5 ${
                      confirmingPlace ? "bg-[#2D6A4F]/50" : "bg-[#2D6A4F]"
                    }`}
                  >
                    <Text className="text-white font-bold text-[12px]">
                      {confirmingPlace ? "กำลังดึงข้อมูล..." : "✓ ยืนยันถูกต้อง"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => void searchInCommunity("subdistrict")}
                    disabled={confirmingPlace}
                    activeOpacity={0.8}
                    className="flex-1 bg-white border border-gray-200 rounded-xl py-2.5 items-center"
                  >
                    <Text className="text-gray-600 font-bold text-[12px]">✕ ไม่ใช่ที่นี่</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Single Google result → confirmation card (editable before confirming) */}
            {pendingConfirm && !googleLoading && (
              <View className="bg-blue-50 border border-blue-300 rounded-xl p-3 mb-2">
                <Text className="text-blue-800 text-[11px] font-bold mb-1.5">📍 พบสถานที่บน Google Maps — ยืนยันหรือแก้ไขก่อน</Text>

                <Text className="text-gray-500 text-[11px] mb-0.5">ชื่อสถานที่</Text>
                <TextInput
                  value={pendingName}
                  onChangeText={setPendingName}
                  className="bg-white border border-blue-200 rounded-lg px-2.5 py-2 text-[13px] text-gray-900 mb-1.5"
                />

                <Text className="text-gray-400 text-[11px]" numberOfLines={1}>{pendingAddress}</Text>
                <Text className="text-gray-500 text-[11px] mt-1">
                  {[pendingConfirm.subdistrict && `ต.${pendingConfirm.subdistrict}`,
                    pendingConfirm.district && `อ.${pendingConfirm.district}`,
                    pendingConfirm.province && `จ.${pendingConfirm.province}`]
                    .filter(Boolean).join(" • ")}
                </Text>

                <View className="flex-row mt-2.5">
                  <TouchableOpacity
                    onPress={confirmPending}
                    disabled={confirmingPlace}
                    activeOpacity={0.85}
                    className={`flex-1 rounded-xl py-2.5 items-center mr-1.5 ${
                      confirmingPlace ? "bg-[#2D6A4F]/50" : "bg-[#2D6A4F]"
                    }`}
                  >
                    <Text className="text-white font-bold text-[12px]">
                      {confirmingPlace ? "กำลังดึงข้อมูล..." : "✓ ถูกต้อง (ยืนยัน)"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={clearLocation}
                    disabled={confirmingPlace}
                    activeOpacity={0.8}
                    className="flex-1 bg-gray-100 border border-gray-200 rounded-xl py-2.5 items-center"
                  >
                    <Text className="text-gray-600 font-bold text-[12px]">✕ ไม่ถูกต้อง (ค้นหาเอง)</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Multiple Google results → list to choose from */}
            {googleCandidates.length > 1 && !googleLoading && (
              <>
                <Text className="text-gray-500 text-[11px] font-bold mt-1 mb-1">
                  พบหลายที่บน Google Maps — เลือกที่ถูกต้อง:
                </Text>
                {googleCandidates.map((c) => (
                  <TouchableOpacity
                    key={c.placeId}
                    onPress={() => void confirmGooglePlace(c)}
                    disabled={confirmingPlace}
                    activeOpacity={0.8}
                    className="bg-white border border-blue-200 rounded-xl px-3 py-2 mb-1.5"
                  >
                    <Text className="text-gray-900 text-[13px] font-semibold">{c.name}</Text>
                    <Text className="text-gray-400 text-[11px]" numberOfLines={1}>{c.address}</Text>
                    <Text className="text-blue-600 text-[10px] mt-0.5">
                      {confirmingPlace ? "กำลังดึงข้อมูล..." : "แตะเพื่อยืนยันสถานที่นี้"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* ── เส้นทาง ③: "ค้นหาใหม่ในชุมชนนี้" (PLAN §6.5 · D24) ──
                สถานที่ที่ AI อ่านมาไม่ตรงกับทะเบียน → ค้นใหม่ในขอบเขตชุมชน
                ถ้ายังไม่มีผลระดับหมู่บ้าน ให้บอกตรง ๆ และเสนอ "ค้นกว้างขึ้น" */}
            {placeName && !googleLoading && !pendingConfirm && !registeredMatch && (
              <TouchableOpacity
                onPress={() => void searchInCommunity("subdistrict")}
                activeOpacity={0.8}
                className="flex-row items-center justify-center bg-indigo-100 border border-indigo-200 rounded-xl py-2.5 mb-1 mt-1"
              >
                <MapPinIcon size={15} color="#4338CA" />
                <Text className="text-indigo-700 font-bold text-[12px] ml-1.5">
                  ค้นหาใหม่ในชุมชนนี้
                </Text>
              </TouchableOpacity>
            )}

            {communitySearch && !googleLoading && (
              <>
                <View className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 mb-2 mt-1">
                  <Text className="text-indigo-800 text-[11px] font-bold mb-1">
                    {communitySearch === "subdistrict"
                      ? "🔎 ผลค้นในระดับตำบล"
                      : "🔎 ผลค้นในระดับอำเภอ (กว้างขึ้น)"}
                  </Text>
                  {googleCandidates.length === 0 ? (
                    <Text className="text-indigo-700 text-[12px] leading-5">
                      ไม่พบสถานที่ในขอบเขตนี้ — ลองค้นกว้างขึ้นที่ระดับอำเภอ หรือกรอกชื่อสถานที่เองด้านล่าง
                    </Text>
                  ) : googleCandidates.some((c) => c.matchLevel === "village") ? (
                    <Text className="text-indigo-700 text-[12px] leading-5">
                      พบ {googleCandidates.length} แห่ง — เลือกที่ถูกต้องด้านล่าง
                    </Text>
                  ) : (
                    <Text className="text-amber-700 text-[12px] leading-5">
                      ⚠️ ยังไม่มีสถานที่ที่อยู่ “ในหมู่บ้าน” จริงในผลนี้ — ที่เห็นอยู่ในตำบล/อำเภอเดียวกันเท่านั้น
                    </Text>
                  )}
                </View>

                {communitySearch === "subdistrict" && (
                  <TouchableOpacity
                    onPress={() => void searchInCommunity("district")}
                    activeOpacity={0.8}
                    className="flex-row items-center justify-center bg-white border border-indigo-200 rounded-xl py-2.5 mb-1"
                  >
                    <ArrowPathIcon size={15} color="#4338CA" />
                    <Text className="text-indigo-700 font-bold text-[12px] ml-1.5">
                      ค้นกว้างขึ้น (ทั้งอำเภอ)
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {/* Manual Google search trigger (if auto lookup found nothing) */}
            {placeName && !googleLoading && googleCandidates.length === 0 && !pendingConfirm && !registeredMatch && (
              <TouchableOpacity
                onPress={() => lookupOnGoogle(placeName)}
                activeOpacity={0.8}
                className="flex-row items-center justify-center bg-blue-100 rounded-xl py-2.5 mb-1 mt-1"
              >
                <MapPinIcon size={15} color="#2563EB" />
                <Text className="text-blue-700 font-bold text-[12px] ml-1.5">ค้นหาที่ตั้งใน Google Maps</Text>
              </TouchableOpacity>
            )}

            {/* Confirm the AI's reconciled location as-is, or search below */}
            <View className="flex-row mt-2">
              <TouchableOpacity
                onPress={() => {
                  setLocationConfirmed(true);
                  setVerify(null);
                }}
                disabled={!locationName}
                activeOpacity={0.85}
                className={`flex-1 items-center justify-center rounded-xl py-2.5 mr-2 ${locationName ? "bg-[#2D6A4F]" : "bg-gray-200"}`}
              >
                <Text className={`font-bold text-[13px] ${locationName ? "text-white" : "text-gray-400"}`}>
                  ยืนยันสถานที่นี้
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={clearLocation}
                activeOpacity={0.85}
                className="flex-1 items-center justify-center rounded-xl py-2.5 bg-gray-100"
              >
                <Text className="text-gray-600 font-bold text-[13px]">ค้นหา/แก้เอง</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Host mode selector: 🏠 own business vs 📍 community spot */}
        {isHost && (
          <View className="mb-4">
            <Text className="text-gray-700 font-bold text-[13px] mb-2">📍 โพสต์นี้เป็นสถานที่ไหน?</Text>
            <View className="flex-row gap-x-2">
              <TouchableOpacity
                onPress={applyHostOwnBusiness}
                activeOpacity={0.8}
                className={`flex-1 py-3 rounded-xl border items-center ${
                  hostPostMode === "own_business"
                    ? "bg-[#2D6A4F] border-[#2D6A4F]"
                    : "bg-white border-gray-300"
                }`}
              >
                <Text className={`text-[13px] font-bold ${
                  hostPostMode === "own_business" ? "text-white" : "text-gray-600"
                }`}>🏠 สถานที่ของตัวเอง</Text>
                {hostPostMode === "own_business" && (
                  <Text className="text-white/80 text-[10px] mt-0.5">🔒 ตำแหน่งล็อกจากทะเบียน</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={applyHostCommunitySpot}
                activeOpacity={0.8}
                className={`flex-1 py-3 rounded-xl border items-center ${
                  hostPostMode === "community_spot"
                    ? "bg-blue-600 border-blue-600"
                    : "bg-white border-gray-300"
                }`}
              >
                <Text className={`text-[13px] font-bold ${
                  hostPostMode === "community_spot" ? "text-white" : "text-gray-600"
                }`}>📍 ภายในหมู่บ้าน/ตำบล</Text>
                {hostPostMode === "community_spot" && (
                  <Text className="text-white/80 text-[10px] mt-0.5">ค้นหาจุดในตำบลตนเอง</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 1) Location — searchable OTOP place picker */}
        <View className="flex-row items-center mb-1.5">
          <MapPinIcon size={14} color="#EF4444" />
          <Text className="text-gray-700 font-bold text-[13px] ml-1">สถานที่ / ชุมชน</Text>
          {isHost && locationSource === "otop" && (
            <View className="ml-2 bg-emerald-100 rounded-full px-2 py-0.5">
              <Text className="text-[#2D6A4F] text-[10px] font-bold">ชุมชน OTOP ของคุณ</Text>
            </View>
          )}
          {locationSource === "ai" && locationConfirmed && (
            <View className="ml-2 bg-blue-100 rounded-full px-2 py-0.5">
              <Text className="text-blue-700 text-[10px] font-bold">สถานที่จาก AI</Text>
            </View>
          )}
        </View>

        {/* Host own_business: LOCKED card 🔒 — no X button, read-only */}
        {isHost && hostPostMode === "own_business" && locationSource === "otop" && locationName && locationConfirmed && !verify ? (
          <View className="bg-emerald-50 border-2 border-emerald-300 rounded-xl px-3.5 py-3 mb-4">
            <View className="flex-row items-center mb-1">
              <MapPinIcon size={16} color="#2D6A4F" />
              <Text className="text-[#1B4332] font-bold text-[14px] flex-1 ml-2">{locationName}</Text>
              <View className="bg-emerald-200 rounded-full px-2 py-0.5">
                <Text className="text-[#1B4332] text-[10px] font-bold">🔒 ล็อก</Text>
              </View>
            </View>
            <Text className="text-gray-500 text-[12px] ml-6">
              {[subdistrict && `ต.${subdistrict}`, district && `อ.${district}`, province && `จ.${province}`]
                .filter(Boolean)
                .join(" • ")}
            </Text>
            <Text className="text-emerald-600 text-[10px] mt-1 ml-6">📋 ตำแหน่งนี้ดึงจากทะเบียน OTOP ของคุณ — แก้ไขได้ในหน้าโปรไฟล์</Text>
          </View>
        ) : verify && !locationConfirmed ? (
          // While verifying, the verification card above handles the choice.
          <Text className="text-gray-400 text-[12px] mb-4 px-1">
            {'ตรวจสอบสถานที่จาก AI ด้านบน หรือเลือก "ค้นหา/แก้เอง"'}
          </Text>
        ) : locationName ? (
          <View className="flex-row items-center bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-3 mb-4">
            <MapPinIcon size={16} color="#2D6A4F" />
            <View className="flex-1 ml-2">
              <Text className="text-[#1B4332] font-bold text-[14px]">{locationName}</Text>
              <Text className="text-gray-500 text-[12px]">
                {[subdistrict && `ต.${subdistrict}`, district && `อ.${district}`, province && `จ.${province}`]
                  .filter(Boolean)
                  .join(" • ")}
              </Text>
              {locationSource === "ai" && (
                <Text className="text-blue-600 text-[10px] mt-0.5">✨ จากการสรุปของ AI & Google Maps • แตะกากบาทเพื่อเปลี่ยน</Text>
              )}
            </View>
            <TouchableOpacity onPress={clearLocation} className="p-1">
              <XMarkIcon size={18} color="#6B7280" />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TextInput
              value={locationQuery}
              onChangeText={setLocationQuery}
              placeholder="ค้นหาชุมชน OTOP เช่น ห้วยห้อม, เชียงใหม่..."
              placeholderTextColor="#9CA3AF"
              className="bg-gray-100 rounded-xl px-3.5 py-3 text-[14px] text-gray-900 mb-2"
            />
            {placeResults.length > 0 && (
              <View className="bg-white border border-gray-200 rounded-xl mb-4 overflow-hidden">
                {placeResults.slice(0, 8).map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => selectPlace(p)}
                    activeOpacity={0.7}
                    className="px-3.5 py-2.5 border-b border-gray-100"
                  >
                    <Text className="text-gray-900 text-[14px] font-semibold">{p.name}</Text>
                    <Text className="text-gray-400 text-[12px]">
                      อ.{p.districtName} • จ.{p.provinceName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {locationQuery.trim().length >= 1 && (
              <TouchableOpacity
                onPress={() => lookupOnGoogle(locationQuery.trim())}
                activeOpacity={0.8}
                className="flex-row items-center justify-center bg-blue-50 border border-blue-200 rounded-xl py-2.5 mb-3"
              >
                <MapPinIcon size={16} color="#2563EB" />
                <Text className="text-blue-700 font-bold text-[13px] ml-1.5">
                  {`ค้นหา "${locationQuery.trim()}" ใน Google Maps`}
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* ── เลือกชุมชนที่สถานที่นี้อยู่ (PLAN §6.7) ──
            จับคู่ชุมชนได้หลายแห่งในตำบลเดียวกัน → ให้ผู้ใช้เลือกเอง
            เลือกไม่ได้ = ไม่บันทึกสถานที่ (D11) */}
        {communityChoices.length > 0 && (
          <View className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 mb-4">
            <Text className="text-amber-900 font-bold text-[13px] mb-1">
              🏘️ เลือกชุมชนที่สถานที่นี้อยู่
            </Text>
            <Text className="text-amber-800 text-[11px] mb-2">
              พบ {communityChoices.length} ชุมชนในตำบลนี้ — เลือกชุมชนที่ถูกต้องเพื่อบันทึกสถานที่
            </Text>
            {communityChoices.map((c) => (
              <TouchableOpacity
                key={c.id}
                onPress={() => {
                  setConfirmedCommunityId(c.id);
                  setCommunityChoices([]);
                }}
                activeOpacity={0.8}
                className="bg-white border border-amber-200 rounded-xl px-3 py-2 mb-1.5"
              >
                <Text className="text-gray-900 text-[13px] font-semibold">{c.name}</Text>
                <Text className="text-gray-400 text-[11px]">
                  {[c.subdistrict && `ต.${c.subdistrict}`,
                    c.district && `อ.${c.district}`,
                    c.province && `จ.${c.province}`]
                    .filter(Boolean).join(" • ")}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ข้อมูลสถานที่ — the host checks what Google said and corrects it.
            Saved on post, into the place's own row: that is what the AI chat
            reads when a traveller asks about the price or the website.

            §6.8: นักท่องเที่ยวก็เห็นการ์ดนี้ แต่แก้เฉพาะช่องที่เป็นของเจ้าของไม่ได้ (D6/D26) */}
        {confirmedPlace?.placeId && placeDetailsReady && (
          <PlaceDetailsCard
            values={placeDetails}
            onChange={applyPlaceDetails}
            canEditOwnerFields={isCommunityHost}
            matchLevel={communityMatchLevel}
            sources={{
              priceLevel: placeDetailsEdited.priceLevel ? "owner" : "google",
              website: placeDetailsEdited.website ? "owner" : "google",
              phone: placeDetailsEdited.phone ? "owner" : "google",
              openingHours: placeDetailsEdited.openingHours ? "owner" : "google",
            }}
            subtitle={
              isCommunityHost
                ? "ยืนยันข้อมูลของสถานที่นี้ — แอไอแชทจะตอบคำถามเรื่องราคา เว็บไซต์ เบอร์โทร และเวลาเปิดปิดจากข้อมูลชุดนี้"
                : "ข้อมูลสถานที่นี้มาจาก Google — เจ้าของสถานที่เป็นผู้ยืนยันค่าที่ถูกต้อง"
            }
            clipFacts={{
              capacity: summary?.place?.capacity ?? null,
              rules: summary?.place?.rules ?? null,
              areas: summary?.place?.areas ?? null,
              facilities: summary?.place?.facilities ?? null,
            }}
          />
        )}

        {/* 2) Caption (optional) + AI helper */}
        <View className="flex-row items-center justify-between mb-1.5">
          <Text className="text-gray-700 font-bold text-[13px]">
            คำบรรยาย <Text className="text-gray-400 font-normal">(ไม่บังคับ)</Text>
          </Text>
          <TouchableOpacity
            onPress={handleAiCaption}
            disabled={captionLoading}
            activeOpacity={0.8}
            className="flex-row items-center bg-violet-100 px-2.5 py-1.5 rounded-full"
          >
            {captionLoading ? (
              <ActivityIndicator size="small" color="#7C3AED" />
            ) : (
              <SparklesIcon size={14} color="#7C3AED" />
            )}
            <Text className="text-violet-700 text-[12px] font-bold ml-1">ให้ AI ช่วยคิด</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          value={caption}
          onChangeText={setCaption}
          placeholder="เล่าเรื่องราวของคลิปนี้..."
          placeholderTextColor="#9CA3AF"
          multiline
          className="bg-gray-100 rounded-xl px-3.5 py-3 text-[14px] text-gray-900 mb-2"
          style={{ minHeight: 76, textAlignVertical: "top" }}
        />

        {/* AI caption suggestions */}
        {captionIdeas.length > 0 && (
          <View className="mb-4">
            <Text className="text-gray-400 text-[11px] mb-1.5">แตะเพื่อใช้แคปชันนี้:</Text>
            {captionIdeas.map((idea, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => setCaption(idea)}
                activeOpacity={0.75}
                className="bg-violet-50 border border-violet-200 rounded-xl px-3.5 py-2.5 mb-2"
              >
                <Text className="text-gray-800 text-[13px] leading-5">{idea}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 3) Hashtags (optional) */}
        <View className="flex-row items-center mb-1.5">
          <HashtagIcon size={14} color="#2D6A4F" />
          <Text className="text-gray-700 font-bold text-[13px] ml-1">
            แฮชแท็ก <Text className="text-gray-400 font-normal">(ไม่บังคับ)</Text>
          </Text>
        </View>
        <TextInput
          value={hashtags}
          onChangeText={setHashtags}
          placeholder="เช่น เชียงใหม่ OTOP ชุมชน (เว้นวรรคคั่น)"
          placeholderTextColor="#9CA3AF"
          className="bg-gray-100 rounded-xl px-3.5 py-3 text-[14px] text-gray-900 mb-2"
        />

        {/* AI hashtag suggestions — tap to add */}
        {hashtagIdeas.length > 0 && (
          <View className="mb-4">
            <Text className="text-gray-400 text-[11px] mb-1.5">
              แตะแฮชแท็กที่แนะนำเพื่อเพิ่ม:
            </Text>
            <View className="flex-row flex-wrap">
              {hashtagIdeas.map((tag) => (
                <TouchableOpacity
                  key={tag}
                  onPress={() => addHashtag(tag)}
                  activeOpacity={0.75}
                  className="bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5 mr-1.5 mb-1.5"
                >
                  <Text className="text-[#2D6A4F] text-[12px] font-semibold">#{tag}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Post button — fixed above the safe-area bottom (bottom menu bar is
          hidden on this tab, so it's never covered). */}
      <View
        className="px-5 pt-3 border-t border-gray-100 bg-white"
        style={{ paddingBottom: Math.max(insets.bottom, 14) }}
      >
        <TouchableOpacity
          onPress={handlePost}
          disabled={!canPost}
          activeOpacity={0.85}
          className={`py-4 rounded-2xl flex-row items-center justify-center ${
            canPost ? "bg-[#2D6A4F]" : "bg-gray-200"
          }`}
        >
          {uploading ? (
            <>
              <ActivityIndicator color="#FFFFFF" />
              <Text className="text-white font-bold text-[15px] ml-2">กำลังอัปโหลด...</Text>
            </>
          ) : (
            <>
              <PaperAirplaneIcon size={18} color={videoUri ? "#FFFFFF" : "#9CA3AF"} />
              <Text className={`font-bold text-[15px] ml-2 ${videoUri ? "text-white" : "text-gray-400"}`}>
                โพสต์ลงฟีด
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
