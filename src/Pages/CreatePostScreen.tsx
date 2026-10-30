import React, { useState, useEffect, useRef } from "react";
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
import PostCardView from "../components/PostCard";
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
  sortByAiRank,
  EVIDENCE_SOURCE_LABEL,
  type MatchLevel,
} from "../services/placeMatchService";
import type { PlaceEvidence, PlaceReading, PlaceResolution } from "../services/placeTypes";
import {
  findCommunitiesByArea,
  registeredPlaceOf,
  type CommunityRow,
} from "../services/communityService";
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

/**
 * The card's address line — "community subdistrict district province".
 *
 * The same shape the backend builds (see `buildPostCard` in
 * `backend/src/videoPromptV2.ts`), so the card and the confirmed place
 * describe the same place in the same words.
 */
function cardAddress(
  community: string | null | undefined,
  location: { subdistrict?: string | null; district?: string | null; province?: string | null }
): string | null {
  const village = (community ?? "").trim();
  // ชุมชนกับตำบลบางทีเป็นชื่อเดียวกัน → ไม่ต้องพิมพ์ซ้ำ ("สุเทพ สุเทพ เมือง …")
  const area = [location.subdistrict, location.district, location.province]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .filter((v) => !village || v !== village)
    .join(" ");
  const out = village ? `${village} ${area}`.trim() : area;
  return out || null;
}

/**
 * คำนำหน้าที่ชื่อสถานที่ไทยใช้บ่อย — ใช้ตอนไล่หาชื่อเก่าในข้อความ
 * (หัวการ์ดเขียน "วัดดอยสุเทพ" แต่ในเนื้อความเขียนแค่ "ดอยสุเทพ")
 */
const PLACE_NAME_PREFIXES = ["วัด", "ที่", "แหลง"];

/**
 * ชื่อเก่าที่อาจโผล่ในข้อความ — ครบทุกรูปแบบ (มี/ไม่มีคำนำหน้า)
 * เรียงยาวสุดก่อน เพื่อไม่ให้รูปสั้นกลืนรูปยาว
 */
function nameVariants(name: string): string[] {
  const base = (name ?? "").trim();
  if (!base) return [];
  const out = new Set<string>([base]);
  for (const p of PLACE_NAME_PREFIXES) {
    if (!base.startsWith(p) || base.length <= p.length + 1) continue;
    const core = base.slice(p.length).trim();
    if (!core) continue;
    out.add(core); // "วัดดอยสุเทพ" → "ดอยสุเทพ"
    for (const q of PLACE_NAME_PREFIXES) out.add(`${q}${core}`);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * แทนที่ชื่อเก่าด้วยชื่อที่ยืนยัน ในข้อความใด ๆ
 * -------------------------------------------------------------
 * ทำไมต้องมีฟังก์ชันนี้ (ไม่ใช่แค่ split/join ธรรมดา)
 *   · ชื่อในหัวการ์ดกับชื่อในเนื้อความมักไม่เหมือนกัน
 *     ("วัดดอยสุเทพ" กับ "ดอยสุเทพ") → ถ้าแทนที่แบบตรงตัว ชื่อเก่าจะยังโผล่
 *     แล้วผู้ใช้เห็นชื่อที่ผิดกับชื่อที่ถูก ติดกันบนการ์ด (ต้อง "หายไป")
 *   · ชื่อใหม่อาจมีชื่อเก่าอยู่ข้างใน ("ห้วยหอม" ใน "บ้านห้วยหอม")
 *     → ต้องกันไม่ให้กลายเป็น "บ้านบ้านห้วยหอม"
 *
 * แนวทาง: กลุ่มชื่อเก่าทุกรูปแบบ → แทนที่ด้วย regex ครั้งเดียว
 * (ข้อความที่แทนที่จะไม่ถูกสแกนซ้ำ → ไม่เกิดชื่อซ้ำ)
 */
function scrubOldName(
  text: string | null | undefined,
  oldName: string | null | undefined,
  newName: string
): string | null | undefined {
  const from = (oldName ?? "").trim();
  const to = (newName ?? "").trim();
  if (typeof text !== "string" || !text || !from || !to) return text;
  if (from === to) return text;

  const variants = nameVariants(from).filter((v) => v && v !== to);
  if (!variants.length) return text;

  // กันชื่อใหม่ที่มีอยู่แล้วในข้อความ (ไม่ให้ถูกไปแตะตอนแทนที่)
  const SENTINEL = "\u0000";
  let out = text.split(to).join(SENTINEL);

  const pattern = variants
    .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  try {
    out = out.replace(new RegExp(pattern, "g"), to);
  } catch {
    return text;
  }
  return out.split(SENTINEL).join(to);
}

/**
 * ทำให้การ์ด "เป็น" สถานที่ที่ผู้ใช้ยืนยัน
 * -------------------------------------------------------------
 * · หัวการ์ด = ชื่อที่ยืนยัน (เปลี่ยนตัวตน ไม่ใช่ไปแก้สตริง)
 * · ที่อยู่ = ชุมชน + พื้นที่ที่ยืนยัน
 * · ชื่อเก่าที่ AI เขียนไว้ทั่วการ์ด → ถูกแทนที่ด้วยชื่อที่ยืนยัน
 *   (ชื่อเก่าต้อง "หายไป" ไม่ใช่ค้างอยู่ข้าง ๆ ชื่อที่ถูก)
 */
function applyConfirmedPlaceToCard(
  card: NonNullable<AiSummaryResult["card"]>,
  oldName: string | null | undefined,
  newName: string,
  community: string | null,
  location: { subdistrict?: string | null; district?: string | null; province?: string | null }
): NonNullable<AiSummaryResult["card"]> {
  const to = newName.trim();
  const swap = (text: string | null | undefined) => scrubOldName(text, oldName, to) ?? null;
  return {
    ...card,
    place: {
      ...(card.place ?? {}),
      name: to,
      address: cardAddress(community, location) ?? card.place?.address ?? null,
      tagline: swap(card.place?.tagline),
      description: swap(card.place?.description),
    },
    activity: swap(card.activity),
    blocks:
      card.blocks?.map((b) => ({
        ...b,
        title: swap(b.title),
        lines: b.lines.map((l) => ({ ...l, text: swap(l.text) ?? "" })),
      })) ?? null,
    sections:
      card.sections?.map((sec) => ({
        ...sec,
        title: swap(sec.title) ?? sec.title,
        highlight: swap(sec.highlight),
        lines: sec.lines.map((l) => ({ ...l, text: swap(l.text) ?? "" })),
      })) ?? null,
  };
}

export default function CreatePostScreen({ onPosted, onCancel, initialLocation }: CreatePostScreenProps) {
  const insets = useSafeAreaInsets();
  const { session, user } = useAuth();

  // Any host may curate a place's details (the backend gates on the role, not
  // on the OTOP verification). This only decides who may edit the owner's
  // fields on the details card — the place-picking flow is the same for
  // everyone (tourist and community).
  const isCommunityHost = user?.role === "host";

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [hashtagInput, setHashtagInput] = useState("");
  const [province, setProvince] = useState(initialLocation?.province || "");
  const [district, setDistrict] = useState(initialLocation?.district || "");
  const [subdistrict, setSubdistrict] = useState(initialLocation?.subdistrict || "");
  const [community, setCommunity] = useState(initialLocation?.community || "");
  const [placeName, setPlaceName] = useState(initialLocation?.placeName || "");
  const [locationName, setLocationName] = useState(
    initialLocation?.placeName || initialLocation?.community || ""
  );
  const [locationQuery, setLocationQuery] = useState(
    initialLocation?.placeName || initialLocation?.community || ""
  );
  const [locationSource, setLocationSource] = useState<"otop" | "ai" | "manual">("manual");
  const [uploading, setUploading] = useState(false);

  // Location verification (offline + Local places store).
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [localPlaceCandidates, setLocalPlaceCandidates] = useState<LocalPlace[]>([]);
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [googleCandidates, setGoogleCandidates] = useState<PlaceCandidate[]>([]);
  // ตัวที่ผู้ใช้เลือกไว้ในรายการ — ยังไม่ใช่ "ยืนยัน" จนกว่าจะกดปุ่มยืนยัน
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  // ผลของรอบ AI ที่หน้าที่เดียวคือ "หาสถานที่" — มาพร้อมหลักฐานในคลิป
  // (มาจาก backend ที่ root ของ summary → เก็บแยกเพื่อโชว์ในการ์ด)
  const [placeResolution, setPlaceResolution] = useState<PlaceResolution | null>(null);
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
  /** สถานที่ที่ลงทะเบียนไว้ — ใช้เทียบกับ candidate ที่ค้นเจอ */
  type RegisteredPlace = {
    placeId: string;
    name: string;
    /** ป้ายบนการ์ด — ของเรา หรือ ของชุมชน */
    label: string;
  };
  const [registeredPlace, setRegisteredPlace] = useState<RegisteredPlace | null>(null);
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
  // coordinates captured when a Google candidate is chosen
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const [captionIdeas, setCaptionIdeas] = useState<string[]>([]);
  const [captionLoading, setCaptionLoading] = useState(false);
  /** Hashtags the AI suggests — tapping one adds it to the field. */
  const [hashtagIdeas, setHashtagIdeas] = useState<string[]>([]);

  // ─────────────────────────────────────────────────────────────
  //  การจับคู่สถานที่กับชุมชน (PLAN_PLACE_MATCHING.md §6.3-§6.7)
  // ─────────────────────────────────────────────────────────────

  /**
   * ขอบเขตที่กำลังค้นอยู่ — ชุมชน/ตำบล/อำเภอ/จังหวัด
   *
   * ทุกคน (นักท่องเที่ยว/ชุมชน) ใช้ค่าจากฟอร์มชุดเดียวกัน
   * → ขั้นตอน "กรอก/ค้นหาสถานที่" ของสองฝั่งต้องเหมือนกัน 100%
   */
  const resolveScope = () => {
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
   * ทุกคน (นักท่องเที่ยว/ชุมชน) → สถานที่ที่ "ชุมชนนั้น" ลงทะเบียนไว้
   * (`community_places` ที่มีเจ้าของ) โดยหาชุมชนจากบริเวณที่กำลังค้น
   *
   * D2: เทียบด้วย **Google id อย่างเดียว** — ถ้าเป็น id ที่ระบบสร้างเอง
   * (`host-…`, `otop-…`) มันไม่ใช่ Google id → เทียบกับ candidate ไม่ได้
   * และถือว่า "ไม่ตรง" เสมอ
   *
   * คืนค่าที่เทียบจริงให้ผู้เรียกใช้ด้วย (ไม่ใช่แค่ setState)
   */
  const resolveRegisteredPlace = async (): Promise<RegisteredPlace | null> => {
    const communityId = await resolveCommunityId(resolveScope());
    const reg = communityId ? await registeredPlaceOf(communityId) : null;
    const communityReg: RegisteredPlace | null = reg?.place_id
      ? { placeId: reg.place_id, name: reg.place_name ?? "", label: "ของชุมชน" }
      : null;
    setRegisteredPlace(communityReg);
    return communityReg;
  };

  /**
   * ชุมชนของสถานที่ที่กำลังค้น
   * หาจากตำบล/อำเภอ/จังหวัด · เจอ 1 = ใช้เลย · เจอหลาย = ให้เลือก
   */
  const resolveCommunityId = async (scope: {
    subdistrict: string;
    district: string;
    province: string;
  }): Promise<string | null> => {
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
   * หาจากบริเวณของสถานที่ · ไม่เจอ = ไม่บันทึก (D11)
   *
   * คืนชุมชนที่ผูกได้จริง (ไม่ใช่แค่ id) เพราะชื่อชุมชนที่ผูกได้ต้องไป
   * **ทับ** ชื่อชุมชนที่รอบสรุปตั้งเอง — ไม่งั้นสรุปจะเก็บชื่อที่ AI เดาไว้
   */
  const resolveCommunityFor = async (
    place: PlaceCandidate
  ): Promise<{ id: string | null; name: string | null }> => {
    const list = await findCommunitiesByArea({
      subdistrict: place.subdistrict ?? subdistrict.trim(),
      district: place.district ?? district.trim(),
      province: place.province ?? province.trim(),
    });
    if (list.length === 1) {
      setConfirmedCommunityId(list[0].id);
      setCommunityChoices([]);
      setCommunity(list[0].name);
      return { id: list[0].id, name: list[0].name };
    }
    if (list.length > 1) {
      // มากกว่าหนึ่ง → ให้ผู้ใช้เลือกในการ์ดยืนยัน
      setCommunityChoices(list);
      setConfirmedCommunityId(null);
      return { id: null, name: null };
    }
    setConfirmedCommunityId(null);
    setCommunityChoices([]);
    return { id: null, name: null };
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

  /**
   * เขียนชุมชน/ชื่อที่ยืนยันแล้วกลับลง summary (PLAN §6.9)
   * -------------------------------------------------------------
   * การ์ดต้อง "เปลี่ยนตัวตน" เป็นสถานที่ที่ผู้ใช้ยืนยัน ไม่ใช่แค่เอาชื่อใหม่
   * ไป "ต่อท้าย" ชื่อเก่า — ชื่อเก่าที่ AI เขียนไว้ต้องหายไปจากทุกจุด
   * (หัวการ์ด · คำบรรยาย · บรรทัดในบล็อก · ไฮไลต์ใต้การ์ด · ข้อความรวม)
   */
  const writeConfirmedPlaceToSummary = (place: PlaceCandidate, communityName?: string | null) => {
    setSummary((prev) => {
      if (!prev) return prev;
      const p = prev.place;
      const community = communityName ?? p?.community ?? null;
      const location = {
        ...(p?.location ?? { province: null, district: null }),
        province: place.province ?? p?.location?.province ?? null,
        district: place.district ?? p?.location?.district ?? null,
        subdistrict: place.subdistrict ?? p?.location?.subdistrict ?? null,
        // พิกัดของที่ผู้ใช้ยืนยัน ต้องทับพิกัดที่ AI เดาไว้
        gps:
          place.latitude != null && place.longitude != null
            ? `${place.latitude},${place.longitude}`
            : p?.location?.gps ?? null,
      };
      // ชื่อเดิมที่ AI อ่านมา — คือตัวที่ต้องถูก "ลบ" ออกจากทั้งการ์ด
      const oldName = prev.card?.place?.name ?? p?.place_name ?? null;
      const newName = place.name;
      // The name the user confirmed is the final word. The AI misreads names
      // (a blurry sign, or a guess from a generic shot), and it used to win
      // because its value was never replaced.
      const base: SummaryPlace = {
        ...(p ?? {
          location,
          category: [],
          activities: [],
          otop_products: [],
          highlights: [],
          tags: [],
          price_info: { weekday: null, weekend: null },
          contact: {},
        }),
        place_name: newName,
        community,
        location,
        // คำบรรยายของสถานที่ (ไม่ขึ้นจอการ์ด แต่ถูกบันทึกลง community_places)
        // → ชื่อเก่าต้องไม่ตามไปด้วย ไม่งั้นข้อมูลที่บันทึกจะขัดกับชื่อที่ยืนยัน
        atmosphere: scrubOldName(p?.atmosphere, oldName, newName) ?? p?.atmosphere ?? null,
      };
      // The card is what the user actually sees — its header, its address
      // and the name inside its text must agree with the confirmed place.
      const card = prev.card
        ? applyConfirmedPlaceToCard(prev.card, oldName, newName, community, location)
        : prev.card;
      // ไฮไลต์ใต้การ์ดก็ขึ้นจอด้วย → ชื่อเก่าต้องหายไปจากที่นั้นด้วย
      const highlights = (prev.highlights ?? p?.highlights ?? []).map((h) =>
        scrubOldName(h, oldName, newName) ?? h
      );
      base.highlights = highlights;
      // The summary text is rendered FROM the card, so it carries the same
      // name — it goes to the AI chat as the clip's context, and a wrong
      // name there makes the chat answer about the wrong place.
      const text = scrubOldName(prev.text, oldName, newName) ?? prev.text;
      return { ...prev, place: base, card, text, highlights };
    });
  };

  /**
   * เขียนชุมชนที่ผู้ใช้เลือกเองกลับลง summary
   * -------------------------------------------------------------
   * ชุมชนคือ "หมู่บ้าน" ที่สถานที่อยู่จริง — รอบสรุปมักเดาจากชื่อที่ได้ยิน
   * ผู้ใช้ที่เลือกเองคือคำตอบที่ถูก → ต้องทับค่าของ AI
   */
  const writeCommunityToSummary = (communityName: string) => {
    setSummary((prev) => {
      if (!prev) return prev;
      const p = prev.place;
      const location = { ...(p?.location ?? { province: null, district: null }) };
      // ชื่อไม่เปลี่ยน → แต่ที่อยู่ในการ์ดต้องตรงกับชุมชนที่ผู้ใช้เลือก
      const cardName = prev.card?.place?.name ?? p?.place_name ?? null;
      const card =
        prev.card && cardName
          ? applyConfirmedPlaceToCard(prev.card, cardName, cardName, communityName, location)
          : prev.card;
      if (!p) return { ...prev, card };
      return { ...prev, place: { ...p, community: communityName }, card };
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

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  // Keep the preview playing while the draft uploads and AI analyzes it.
  useEffect(() => {
    if (videoUri) {
      player.replace(videoUri);
      player.play();
    } else {
      player.pause();
    }
  }, [player, videoUri]);

  // Invalidates results from a clip that was removed or replaced.
  const videoGeneration = useRef(0);

  // ผลค้นจากทะเบียนชุมชนในเครื่อง — เหมือนกันทั้งนักท่องเที่ยวและชุมชน
  const placeResults = locationQuery.trim().length >= 1 ? searchPlaces(locationQuery) : [];

  // Generate the AI summary from the VIDEO itself (video-only, no caption).
  const runSummary = async (overrides?: { videoUrl?: string }) => {
    // Summary is produced from the VIDEO itself only (no caption/location),
    // so it can feed the caption helper as an independent source.
    const url = overrides?.videoUrl ?? draftVideoUrl;
    if (!url) return;
    const generation = videoGeneration.current;
    setSummaryLoading(true);
    setSummaryEditing(false);

    let result: Awaited<ReturnType<typeof generatePreviewSummary>> | null = null;
    try {
      result = await generatePreviewSummary({
        videoUrl: url,
        audioType: "speech",
        uploaderType: "tourist",
        location: undefined,
        // The area we already know — lets the backend narrow its Google
        // Places search instead of looking through the whole country.
        locationScope: {
          community: community.trim() || null,
          subdistrict: subdistrict.trim() || null,
          district: district.trim() || null,
          province: province.trim() || null,
        },
      });
    } catch (err) {
      if (generation !== videoGeneration.current) return;
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
      if (generation === videoGeneration.current) setSummaryLoading(false);
    }

    if (generation !== videoGeneration.current) return;
    setSummary(result);
    setSummaryDraft(result?.text ?? "");
    setSummaryDiag(result?._diag ?? null);
    // ผลของรอบ "หาสถานที่" — มาที่ root ของ summary ไม่ใช่ใน `place`
    setPlaceResolution(result?.placeResolution ?? null);
    setAccuracy(0);
    // The place's details are the place's, not the summary's — put them back
    // after a regeneration, so a fresh summary never drops them.
    writePlaceDetailsToSummary(placeDetails);

    if (result?.place) {
      // นักท่องเที่ยว + ชุมชน → ขั้นตอนเดียวกัน
      setLocationSource("ai");
      await runLocationVerify(result.place, generation, result.placeResolution ?? null);
    } else {
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
      setPlaceResolution(null);
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
  //
  // รับผลจาก AI (นักท่องเที่ยว/ชุมชน)
  // → ขั้นตอนนี้เป็นของเดียวกันทั้งสองฝั่ง
  type PlaceToVerify = {
    place_name?: string | null;
    community?: string | null;
    location?: {
      province?: string | null;
      district?: string | null;
      subdistrict?: string | null;
      gps?: string | null;
    } | null;
    google_candidates?: PlaceCandidate[];
  };
  const runLocationVerify = async (
    place: PlaceToVerify,
    generation = videoGeneration.current,
    resolution?: PlaceResolution | null
  ) => {
    if (generation !== videoGeneration.current) return;
    const aiPlaceName = place.place_name ?? null;
    const aiCommunity = place.community ?? null;
    const loc = place.location ?? {};
    // Backend may have already run Google Places enrichment.
    const backendCandidates: PlaceCandidate[] = place.google_candidates ?? [];
    const aiGps: string | null = loc.gps ?? null;

    console.log("[verify] aiPlaceName =", aiPlaceName, "community =", aiCommunity,
      "province =", loc.province, "district =", loc.district,
      "backendCandidates =", backendCandidates.length, "aiGps =", aiGps,
      "resolution =", resolution?.found ? resolution.placeName : "-");

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
    setSelectedCandidateId(null);
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
    const registry = await resolveRegisteredPlace();
    if (generation !== videoGeneration.current) return;

    // ── ① Google Places results the backend already fetched ──
    // Nothing is written into the form here. The user TICK-CONFIRMS first;
    // only then do we spend one Place Details call and fill the fields.
    if (backendCandidates.length > 0) {
      console.log("[verify] using", backendCandidates.length, "backend Google candidates");
      setLocalPlaceCandidates([]);
      // อันดับที่ AI ให้มาก่อน — ลำดับเดิม (ระดับอำเภอ/ตำบล) เป็นตัวแก้เมื่อ aiRank เท่ากัน
      showCandidates(sortByAiRank(backendCandidates), registry);
      return;
    }

    // AI ให้ชื่อ/พื้นที่เป็นคำค้นเท่านั้น — ต้องตรวจสอบกับ Google Places
    // ก่อนแสดงปุ่มยืนยัน ไม่ใช้ผล Local หรือ AI เป็นตัวเลือกยืนยันอีกชุด
    setLocalPlaceCandidates([]);
    if (aiPlaceName || aiCommunity) {
      // The AI's own area travels with the call — the form was only just
      // filled from it, so reading the form here would still be empty.
      await lookupOnGoogle(aiPlaceName || aiCommunity || "", registry, generation, {
        community: aiCommunity,
        subdistrict: loc.subdistrict ?? null,
        district: loc.district ?? null,
        province: loc.province ?? null,
      });
    }
  };

  /**
   * แสดงผลค้นของ Google ให้ผู้ใช้เลือก
   *
   * เทียบกับทะเบียนก่อนเสมอ (D2): ถ้าตรง → การ์ด "✓ ตรงกับที่ลงทะเบียน"
   * (โชว์แค่ที่ลงทะเบียนที่ตรง ไม่ต้องมีรายการอื่นให้เลือก)
   * ถ้าไม่ตรง → รายการให้เลือก (หรือการ์ดเดียวถ้ามีอันเดียว)
   *
   * `registry` = ที่ลงทะเบียนที่เพิ่ง resolve มา (ส่งเข้ามาเลย ไม่ต้องรอ state)
   * ไม่ส่ง → ใช้ค่าใน state ตามเดิม
   *
   * ติ๊กล่วงหน้า: อันดับ 1 ของ AI เท่านั้น (ผลค้นจากแอปเองไม่มี `aiRank`
   * → ไม่ติ๊กให้ ผู้ใช้ต้องเลือกเอง)
   */
  const showCandidates = (
    list: PlaceCandidate[],
    registry?: RegisteredPlace | null
  ) => {
    const reg = registry === undefined ? registeredPlace : registry;
    // เส้นทาง ③: ผู้ใช้บอกแล้วว่า "ไม่ใช่ที่ลงทะเบียน" → ไม่ต้องเทียบทะเบียนซ้ำ
    // (ไม่งั้นจะวนกลับมาการ์ดเดิมทุกครั้งที่กด "ค้นกว้างขึ้น")
    const hit = communitySearch
      ? { kind: "none" as const, candidate: null }
      : matchAgainstRegistered(list, reg?.placeId ?? null);
    setRegisteredMatch(hit.candidate);
    setPendingConfirm(null);
    setSelectedCandidateId(list.find((c) => c.aiRank === 1)?.placeId ?? null);
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
    setSelectedCandidateId(null);
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
      setSelectedCandidateId(null);
      return;
    }
    showCandidates(sortByAiRank(r.candidates));
  };

  const lookupOnGoogle = async (
    name: string,
    registry?: RegisteredPlace | null,
    generation = videoGeneration.current,
    /**
     * The area to search in. Pass it when the area was read a moment ago:
     * a `setX()` from this same tick has not reached the state yet, so
     * reading the form here would search the whole country.
     */
    scope?: {
      community?: string | null;
      subdistrict?: string | null;
      district?: string | null;
      province?: string | null;
    }
  ) => {
    console.log("[google] lookupOnGoogle name =", name);
    setGoogleLoading(true);
    setPendingConfirm(null);
    setRegisteredMatch(null);
    setGoogleCandidates([]);
    setSelectedCandidateId(null);
    setLocalPlaceCandidates([]);
    // ขอบเขตการค้นหา = ค่าในฟอร์ม (เหมือนนักท่องเที่ยวทุกประการ)
    const pick = (v: string | null | undefined) => (v ?? "").trim() || undefined;
    const r = await verifyPlaceOnGoogle({
      placeName: name,
      community: pick(scope?.community ?? community),
      subdistrict: pick(scope?.subdistrict ?? subdistrict),
      district: pick(scope?.district ?? district),
      province: pick(scope?.province ?? province),
    });
    if (generation !== videoGeneration.current) return;
    console.log("[google] result configured =", r.configured, "candidates =", r.candidates.length);
    setGoogleLoading(false);
    if (r.candidates.length === 0) {
      setGoogleCandidates([]);
      setSelectedCandidateId(null);
      return;
    }
    showCandidates(sortByAiRank(r.candidates), registry);
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
      // หาจากบริเวณของสถานที่
      // (ถ้าหลายชุมชน → resolveCommunityFor จะเปิดการ์ดให้ผู้ใช้เลือก)
      const resolved = await resolveCommunityFor(confirmed);
      const level = matchLevelOf(confirmed);
      setCommunityMatchLevel(level);

      // เขียนชุมชน/ชื่อที่ยืนยันแล้วกลับลง summary (PLAN §6.9)
      // ชุมชนที่ผูกได้จริงทับชื่อที่รอบสรุปตั้งเอง
      const confirmedCommunity = resolved.name ?? (community.trim() || null);
      writeConfirmedPlaceToSummary(confirmed, confirmedCommunity);

      // Save to Supabase places store immediately so it appears on the map.
      void saveVerifiedPlace({
        name: confirmed.name,
        community: confirmedCommunity,
        subdistrict: (confirmed.subdistrict ?? subdistrict.trim()) || null,
        district: (confirmed.district ?? district.trim()) || null,
        province: (confirmed.province ?? province.trim()) || null,
        latitude: confirmed.latitude,
        longitude: confirmed.longitude,
        googlePlaceId: confirmed.placeId || null,
        source: "google",
      });
    } finally {
      setConfirmingPlace(false);
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
    // ผู้ใช้เลือกสถานที่นี้เอง = คำตอบที่ถูก → การ์ดต้องกลายเป็นสถานที่นี้
    writeConfirmedPlaceToSummary(
      {
        name: p.name,
        address: "",
        placeId: p.googlePlaceId ?? "",
        latitude: p.latitude,
        longitude: p.longitude,
        province: p.province,
        district: p.district,
        subdistrict: p.subdistrict,
        types: [],
      },
      p.community ?? p.name
    );
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
    // ชุมชนที่ผู้ใช้เลือกต้องไปอยู่ในการ์ดด้วย (ที่อยู่บนหัวการ์ด)
    writeCommunityToSummary(p.name);
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
    setSelectedCandidateId(null);
    setPendingConfirm(null);
    setPlaceResolution(null);
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
      const generation = ++videoGeneration.current;
      setVideoUri(uri);
      // Upload a draft copy to Storage → get a public URL → let the backend
      // AI analyze the VIDEO directly, right after the clip is picked.
      setSummaryLoading(true);
      try {
        const { path, url } = await uploadDraftVideo(uri);
        if (generation !== videoGeneration.current) {
          void deleteDraftVideo(path);
          return;
        }
        setDraftVideoPath(path);
        setDraftVideoUrl(url);
        await runSummary({ videoUrl: url });
      } catch (e: any) {
        if (generation !== videoGeneration.current) return;
        setSummaryLoading(false);
        Alert.alert("เตรียมวิดีโอไม่สำเร็จ", e?.message ?? "ลองเลือกวิดีโอใหม่อีกครั้ง");
      }
    }
  };

  const removeVideo = () => {
    videoGeneration.current += 1;
    player.pause();
    // The draft copy is dead weight now — drop it so the clip isn't stored twice.
    if (draftVideoPath) void deleteDraftVideo(draftVideoPath);
    setVideoUri(null);
    setDraftVideoUrl(null);
    setDraftVideoPath(null);
    setSummary(null);
    setSummaryDraft("");
    setSummaryEditing(false);
    setAccuracy(0);
    setSummaryLoading(false);
    setSummaryDiag(null);
    setShowDiag(false);
    setCaption("");
    setCaptionIdeas([]);
    setCaptionLoading(false);
    setHashtags("");
    setHashtagInput("");
    setHashtagIdeas([]);
    // ล้างสถานที่ให้เหมือนกันทั้งสองฝั่ง
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
    setConfirmedPlace(null);
    setPlaceDetails({ priceLevel: null, website: null, phone: null, openingHours: null });
    setPlaceDetailsEdited({});
    setPlaceDetailsReady(false);
    setConfirmingPlace(false);
    setPendingName("");
    setPendingAddress("");
    setRegisteredPlace(null);
    setRegisteredMatch(null);
    setConfirmedCommunityId(null);
    setCommunityMatchLevel(null);
    setCommunitySearch(null);
    setCommunityChoices([]);
  };

  const parseHashtags = (raw: string): string[] =>
    raw
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith("#") ? t : `#${t}`));

  // Save the edited summary text back into the summary object.
  // ผู้ใช้แก้ข้อความเอง → การ์ดโครงสร้างไม่ตรงกับข้อความแล้ว → ตัดการ์ดออก
  const saveSummaryEdit = () => {
    setSummary((prev) =>
      prev ? { ...prev, text: summaryDraft.trim(), card: undefined } : prev
    );
    setSummaryEditing(false);
  };

  // "ให้ AI ช่วยคิดแคปชัน" — use the already-generated summary as context.
  const handleAiCaption = async () => {
    const generation = videoGeneration.current;
    setCaptionLoading(true);
    setCaptionIdeas([]);
    setHashtagIdeas([]);
    try {
      const { captions: ideas, hashtags: tagIdeas } = await suggestCaptions({
        draft: caption,
        locationName,
        province,
        district,
        hashtags: parseHashtags([hashtags, hashtagInput].filter(Boolean).join(" ")),
        summaryText: summary?.text,
        highlights: summary?.highlights ?? summary?.place?.highlights,
      });
      if (generation !== videoGeneration.current) return;
      setCaptionIdeas(ideas);
      setHashtagIdeas(tagIdeas);
      if (ideas.length === 0) {
        Alert.alert("ขออภัย", "AI ตอบกลับมาแต่ไม่มีแคปชันให้ใช้ ลองใหม่อีกครั้งนะคะ");
      }
    } catch (err) {
      if (generation !== videoGeneration.current) return;
      // Show the actual reason (401 / timeout / unreachable), not a fixed
      // apology that hid all four from the user.
      const aiErr = asAiError(err);
      console.warn("[caption] FAIL", aiErr?.status ?? "-", aiErr?.message ?? err);
      Alert.alert("ขอแคปชันไม่สำเร็จ", aiErr?.message ?? "เรียก AI ไม่สำเร็จ");
    } finally {
      if (generation === videoGeneration.current) setCaptionLoading(false);
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
      // แก้ข้อความเอง → ตัดการ์ดออก (ข้อความกับการ์ดไม่ตรงกันแล้ว)
      const finalSummary: AiSummaryResult | null = summary
        ? {
            ...summary,
            text: summaryEditing ? summaryDraft.trim() : summary.text,
            card: summaryEditing ? undefined : summary.card,
          }
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
        hashtags: parseHashtags([hashtags, hashtagInput].filter(Boolean).join(" ")),
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

  /**
   * หลักฐานที่ backend ส่งมา — กัน payload เก่า/ไม่ครบไว้ก่อนเอาไปวน
   * การ์ดหลักฐานโชว์เฉพาะเมื่อ **มีหลักฐานจริง** — การ์ดที่บอกว่า
   * "AI อ่านได้ชื่อนี้" แต่ไม่มีประโยคอ้างอิง คือคำโกหกที่ฟีเจอร์นี้
   * ตั้งใจจะลบออก
   */
  const resolutionEvidence: PlaceEvidence[] = Array.isArray(placeResolution?.evidence)
    ? placeResolution.evidence
    : [];

  /**
   * ชื่อที่อ่านได้จากแต่ละแหล่ง (เสียงพูด / ตัวหนังสือบนจอ)
   * -------------------------------------------------------------
   * ถ้าสองทางได้คนละชื่อ → ระบบค้นทั้งสองชื่อ และผู้ใช้ต้องเลือกเอง
   * การ์ดนี้จึงต้องบอกตรง ๆ ว่าไม่ตรงกัน ไม่ใช่โชว์ชื่อเดียวแล้วเงียบ ๆ
   */
  const resolutionReadings: PlaceReading[] = Array.isArray(placeResolution?.readings)
    ? placeResolution.readings
    : [];
  const readingsDisagree = resolutionReadings.length > 1;

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
            <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={true} fullscreenOptions={{ enable: true }} />
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
                ) : summary.card ? (
                  /* การ์ดโครงสร้าง (VCA V2) — ถ้าไม่มีการ์ดใช้ข้อความเดิม */
                  <PostCardView card={summary.card} />
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
                    {summaryDiag.steps.map((s) => {
                      // ข้าม ≠ พัง — ต้องดูต่างกันให้ชัด
                      const glyph =
                        s.status === "ok" ? "✓" : s.status === "failed" ? "✗" : "○";
                      const glyphClass =
                        s.status === "ok"
                          ? "text-emerald-600"
                          : s.status === "failed"
                          ? "text-red-500"
                          : "text-gray-300";
                      const detailClass =
                        s.status === "failed"
                          ? "text-red-500"
                          : s.status === "skipped"
                          ? "text-gray-400"
                          : "text-gray-500";
                      return (
                        <View key={s.id} className="flex-row mb-2">
                          <Text className={`w-5 text-[12px] ${glyphClass}`}>
                            {glyph}
                          </Text>
                          <View className="flex-1">
                            <Text className="text-gray-700 text-[12px] font-semibold">
                              {s.label}
                              <Text className="text-gray-400 font-normal">
                                {" "}
                                (
                                {s.ms >= 1000
                                  ? `${(s.ms / 1000).toFixed(1)} วิ`
                                  : `${s.ms} มิลลิวินาที`}
                                )
                              </Text>
                            </Text>
                            {!!s.detail && (
                              <Text className={`text-[12px] leading-4 ${detailClass}`}>
                                {s.detail}
                              </Text>
                            )}
                          </View>
                        </View>
                      );
                    })}
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
              <Text className="text-blue-900 font-black text-[13px] ml-1.5">
                ตรวจสอบสถานที่จาก AI
              </Text>
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

            {/* ── หลักฐานที่ AI ใช้หาชื่อสถานที่ ──
                รอบ AI ที่หน้าที่เดียวคือ "หาสถานที่" — ทุกชื่อที่มันให้
                ต้องมีประโยคในคลิปมาหลักฐาน ผู้ใช้ต้องเห็นที่มาของชื่อ
                ก่อนตัดสินใจติ๊ก */}
            {placeResolution?.found && resolutionEvidence.length > 0 && (
              <View className="bg-violet-50 border border-violet-200 rounded-xl p-3 mb-2">
                <Text className="text-violet-800 text-[11px] font-bold mb-1">
                  🤖 AI อ่านชื่อนี้จากคลิป
                </Text>
                {placeResolution.placeName ? (
                  <Text className="text-gray-900 font-bold text-[13px] mb-1">
                    {placeResolution.placeName}
                  </Text>
                ) : null}
                {/* ── ชื่อที่อ่านได้จากแต่ละแหล่ง ──
                    เสียงพูดกับตัวหนังสือบนจออาจไม่ตรงกัน → ค้นทั้งสองชื่อ
                    แล้วให้ผู้ใช้เลือก ต้องบอกตรง ๆ ว่าไม่ตรงกัน */}
                {resolutionReadings.length > 0 && (
                  <View className="bg-white rounded-lg px-2.5 py-2 mb-1">
                    {readingsDisagree && (
                      <Text className="text-amber-700 text-[11px] font-bold mb-1 leading-4">
                        ⚠️ ชื่อที่อ่านได้จากคลิปไม่ตรงกัน — เลือกอันที่ถูกจากรายการด้านล่าง
                      </Text>
                    )}
                    {resolutionReadings.map((r, i) => (
                      <View key={i} className={i > 0 ? "mt-1.5" : ""}>
                        <Text className="text-[9px] text-violet-500 font-bold mb-0.5">
                          {EVIDENCE_SOURCE_LABEL[r.source] ?? "จากในคลิป"}
                        </Text>
                        <Text className="text-gray-900 font-bold text-[12.5px]">
                          {r.placeName}
                        </Text>
                        {r.quote ? (
                          <Text className="text-gray-700 text-[11px] leading-4 mt-0.5">
                            “{r.quote}”
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                )}
                {resolutionEvidence.map((ev, i) => (
                  <View key={i} className="bg-white rounded-lg px-2.5 py-2 mb-1">
                    <Text className="text-[9px] text-violet-500 font-bold mb-0.5">
                      {EVIDENCE_SOURCE_LABEL[ev.source] ?? "จากในคลิป"}
                    </Text>
                    <Text className="text-gray-700 text-[12px] leading-5">“{ev.quote}”</Text>
                  </View>
                ))}
                {placeResolution.reason ? (
                  <Text className="text-gray-500 text-[11px] mt-1">{placeResolution.reason}</Text>
                ) : null}
                {typeof placeResolution.confidence === "number" ? (
                  <Text className="text-gray-400 text-[10px] mt-1">
                    ความมั่นใจ {Math.round(placeResolution.confidence * 100)}%
                  </Text>
                ) : null}
              </View>
            )}

            {/* ── AI อ่านได้ชื่อ แต่ Google ไม่มีที่นี้ ──
                บอกตรง ๆ แทนที่จะปล่อยให้ผู้ใช้เดาว่าทำไมถึงไม่มีให้เลือก */}
            {placeResolution?.found &&
              !googleLoading &&
              googleCandidates.length === 0 &&
              !pendingConfirm &&
              !registeredMatch &&
              !communitySearch && (
              <View className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-2">
                <Text className="text-amber-900 text-[12px] font-bold mb-1">
                  🤖 AI อ่านได้ชื่อ “{placeResolution.placeName ?? "ในคลิป"}” แต่ Google Maps ยังไม่มีที่นี้
                </Text>
                <Text className="text-amber-800 text-[11px] leading-5">
                  ชื่อนี้ถูกใส่ไว้ในช่องสถานที่แล้ว — กด “ค้นชื่อนี้ใน Google Maps เอง” ด้านล่าง
                  หรือแก้ชื่อเองได้
                </Text>
              </View>
            )}

            {/* Warnings */}
            {verify.warnings.map((w, i) => (
              <Text key={i} className="text-amber-700 text-[11px] mb-1">⚠️ {w}</Text>
            ))}

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

                {registeredMatch.aiRank === 1 ? (
                  <View className="bg-emerald-100 rounded-lg px-2 py-1.5 mt-1.5">
                    <Text className="text-emerald-700 text-[10px] font-bold">
                      ✓ ตรงกับคลิปที่สุด
                    </Text>
                    {registeredMatch.aiReason ? (
                      <Text className="text-gray-600 text-[11px] leading-4 mt-0.5">
                        {registeredMatch.aiReason}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

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

                {/* เหตุผลที่ AI ให้ — ผู้ใช้เห็นก่อนกดยืนยัน */}
                {pendingConfirm.aiRank === 1 ? (
                  <View className="bg-blue-100 rounded-lg px-2 py-1.5 mt-1.5">
                    <Text className="text-blue-700 text-[10px] font-bold">
                      ✓ ตรงกับคลิปที่สุด
                    </Text>
                    {pendingConfirm.aiReason ? (
                      <Text className="text-gray-600 text-[11px] leading-4 mt-0.5">
                        {pendingConfirm.aiReason}
                      </Text>
                    ) : null}
                    {pendingConfirm.evidenceMatch ? (
                      <Text className="text-gray-500 text-[11px] leading-4 mt-0.5">
                        “{pendingConfirm.evidenceMatch}”
                      </Text>
                    ) : null}
                  </View>
                ) : null}

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

            {/* Multiple Google results → list to choose from
                ผู้ใช้เลือกก่อน แล้วค่อยกดยืนยัน — เหมือนการ์ดจุดเดียว
                อันดับ 1 ของ AI ถูกติ๊กไว้ให้แล้ว (ผู้ใช้ยังต้องกดยืนยันเอง) */}
            {googleCandidates.length > 1 && !googleLoading && (
              <>
                <Text className="text-gray-500 text-[11px] font-bold mt-1 mb-1">
                  พบหลายที่บน Google Maps — เลือกที่ถูกต้อง:
                </Text>
                {googleCandidates.map((c) => {
                  const isTop = c.aiRank === 1;
                  const isSelected = selectedCandidateId === c.placeId;
                  return (
                    <TouchableOpacity
                      key={c.placeId}
                      onPress={() => setSelectedCandidateId(c.placeId)}
                      disabled={confirmingPlace}
                      activeOpacity={0.8}
                      className={`bg-white rounded-xl px-3 py-2 mb-1.5 ${
                        isSelected
                          ? "border-2 border-blue-400 bg-blue-50/40"
                          : "border border-blue-200"
                      }`}
                    >
                      <View className="flex-row items-start">
                        {/* วงกลมเลือก — ติ๊กไว้ให้ตัวที่ AI มั่นใจที่สุด */}
                        <View
                          className={`w-4 h-4 rounded-full border-2 mt-0.5 mr-2 ${
                            isSelected ? "bg-blue-500 border-blue-500" : "border-gray-300"
                          }`}
                        />
                        <View className="flex-1">
                          <Text className="text-gray-900 text-[13px] font-semibold">{c.name}</Text>
                          <Text className="text-gray-400 text-[11px]" numberOfLines={1}>{c.address}</Text>

                          {isTop ? (
                            <View className="mt-1">
                              <Text className="text-blue-600 text-[10px] font-bold">
                                ✓ ตรงกับคลิปที่สุด
                              </Text>
                              {c.aiReason ? (
                                <Text className="text-gray-500 text-[11px] leading-4 mt-0.5">
                                  {c.aiReason}
                                </Text>
                              ) : null}
                              {c.evidenceMatch ? (
                                <Text className="text-gray-400 text-[11px] leading-4 mt-0.5">
                                  “{c.evidenceMatch}”
                                </Text>
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity
                  onPress={() => {
                    const picked = googleCandidates.find((c) => c.placeId === selectedCandidateId);
                    if (picked) void confirmGooglePlace(picked);
                  }}
                  disabled={confirmingPlace || !selectedCandidateId}
                  activeOpacity={0.85}
                  className={`rounded-xl py-2.5 items-center mt-1 mb-1 ${
                    confirmingPlace || !selectedCandidateId
                      ? "bg-[#2D6A4F]/40"
                      : "bg-[#2D6A4F]"
                  }`}
                >
                  <Text className="text-white font-bold text-[12px]">
                    {confirmingPlace
                      ? "กำลังดึงข้อมูล..."
                      : selectedCandidateId
                        ? "✓ ยืนยันสถานที่ที่เลือก"
                        : "แตะสถานที่ที่ต้องการก่อน"}
                  </Text>
                </TouchableOpacity>
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
                <Text className="text-blue-700 font-bold text-[12px] ml-1.5">
                  {placeResolution?.found
                    ? "ค้นชื่อนี้ใน Google Maps เอง"
                    : "ค้นหาที่ตั้งใน Google Maps"}
                </Text>
              </TouchableOpacity>
            )}


          </View>
        )}

        {/* 1) Location — searchable OTOP place picker */}
        <View className="flex-row items-center mb-1.5">
          <MapPinIcon size={14} color="#EF4444" />
          <Text className="text-gray-700 font-bold text-[13px] ml-1">สถานที่ / ชุมชน</Text>
          {locationSource === "ai" && locationConfirmed && (
            <View className="ml-2 bg-blue-100 rounded-full px-2 py-0.5">
              <Text className="text-blue-700 text-[10px] font-bold">สถานที่จาก AI</Text>
            </View>
          )}
        </View>

        {verify && !locationConfirmed ? (
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
                  // ชุมชนที่ผู้ใช้เลือกเอง ต้องทับชุมชนที่รอบสรุปตั้งเอง
                  setCommunity(c.name);
                  writeCommunityToSummary(c.name);
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
        <View className="bg-gray-100 rounded-xl px-3.5 py-3 mb-2">
          <View className="flex-row flex-wrap items-center">
            {parseHashtags(hashtags).map((tag) => (
              <View
                key={tag}
                className="flex-row items-center bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 mr-2 mb-2"
              >
                <Text className="text-[#2D6A4F] text-[13px] font-semibold">{tag}</Text>
                <TouchableOpacity
                  onPress={() => {
                    setHashtags((prev) =>
                      parseHashtags(prev).filter((item) => item !== tag).join(" ")
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`ลบแฮชแท็ก ${tag}`}
                  className="ml-1.5"
                >
                  <XMarkIcon size={15} color="#2D6A4F" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
          <TextInput
            value={hashtagInput}
            onChangeText={(text) => {
              if (/[\s,]/.test(text)) {
                text.split(/[\s,]+/).forEach((tag) => addHashtag(tag));
                setHashtagInput("");
              } else {
                setHashtagInput(text);
              }
            }}
            onSubmitEditing={() => {
              addHashtag(hashtagInput);
              setHashtagInput("");
            }}
            placeholder="เช่น เชียงใหม่ OTOP ชุมชน (เว้นวรรคคั่น)"
            placeholderTextColor="#9CA3AF"
            className="text-[14px] text-gray-900 p-0"
          />
        </View>

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