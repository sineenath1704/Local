import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Pressable,
  FlatList,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Animated,
  Easing,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  FolderIcon,
  PaperClipIcon,
  XMarkIcon,
  MapPinIcon,
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  CheckBadgeIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  QuestionMarkCircleIcon,
  PlayIcon,
} from "react-native-heroicons/outline";
import { useAiPlanner } from "../../state/AiPlannerContext";
import { useInteractions } from "../../state/InteractionContext";
import { useAuth } from "../../state/AuthContext";
import {
  sendChat,
  requestDiscoveryPlaces,
  requestDiscoveryTags,
  FALLBACK_DISCOVERY_TAGS,
} from "../../services/aiChatService";
import { asAiError } from "../../services/aiHttp";
import { getFolderContext, type FolderContextInfo } from "../../services/folderContextService";
import {
  generateTripPlan,
  planRequestFromSlots,
  fetchNearbySuggestions,
  type NearbyPlace,
  type PlanTripRequest,
} from "../../services/tripService";
import { updateMyTripPlan } from "../../services/tripPlanService";
import {
  AiChatMessage,
  ChatPlaceCard as ChatPlaceCardData,
  ClipContext,
  ItineraryDay,
  PlaceChoice,
  StopType,
  Trip,
  TripPlan,
  TripPlanLodging,
  TripPlanMeta,
  TripPlanPoint,
  TripSlots,
  TRIP_MAX_DAYS,
  computeTripMissing,
  formatPlanSummary,
  formatPlanPlacesContext,
  formatStopsSelectionText,
  formatTripSetupText,
  isTripPlanReady,
  normalizeTripSlotsShape,
  slotsToWire,
  tripAddDays,
  tripTodayIso,
  type DiscoveryStyle,
} from "../../data/tripsData";
import type { VideoPost } from "../../data/homeFeedData";
import OriginSelectorModal from "../../components/OriginSelectorModal";
import MyVideoViewer from "../../components/MyVideoViewer";
import FolderClipBrowser from "../../components/FolderClipBrowser";
import {
  ChatSourceChips,
  InlinePlaceTags,
  splitAtPlaceName,
  renderAnnotatedTextWithPlaces,
} from "../../components/ChatTagChips";
import TripQuestionFlow, {
  TripOriginTarget,
} from "../../components/TripQuestionFlow";
import TripDateRangeSheet from "../../components/TripDateRangeSheet";
import TripTimeSheet from "../../components/TripTimeSheet";
import TripPlanCard from "../../components/TripPlanCard";
import {
  TripDestinationPickerModal,
  type TripExtraStop,
} from "../../components/TripDestinationPickerModal";
import { ChatStylePickerModal } from "../../components/ChatStylePickerModal";
import { ChatPlaceCard } from "../../components/ChatPlaceCard";
import ChatSelectedPlacesBox, {
  ChatPlaceMapModal,
  type ChatSelectedPlace,
} from "../../components/ChatSelectedPlacesBox";
import { parseGoogleMapsUrl } from "../../services/savedPlacesService";
import { resolvePlaceCoords } from "../../services/placesService";
import { loadSavedVideos } from "../../services/interactionService";

interface AiChatScreenProps {
  threadId: string;
  onBack: () => void;
  onPlanTrip?: (folderId?: string) => void;
  onOpenTrip?: (tripId: string) => void;
  /** If set, auto-send this as the first user message once, on mount. */
  initialMessage?: string;
  /** Plan ID tied to this thread (if modifying an existing trip) */
  linkedPlanId?: string;
  /**
   * บริบทคลิปที่ผู้ใช้กูลับมา (ปุ่ม "คุยต่อกับ AI เรื่องนี้")
   * → ส่งให้ backend แทรกใน system prompt ทุกข้อความของแชทนี้
   */
  initialClipContext?: ClipContext | null;
  /** คลิปที่ผู้ใช้กูลับมา — แนบเป็นวิดีโอในข้อความแรกของแชท */
  initialVideo?: VideoPost | null;
  /** แผนทริปที่กำลังจะให้เอไaiช่วยแก้ (จากหน้าแผนทริป) */
  initialPlanContext?: unknown;
}

/** การ์ดสถานที่ 1 ใบ (ใช้กับตัวแปรของการรีเฟช) */
type DiscoveryCard = NonNullable<AiChatMessage["placeCards"]>[number];

/**
 * ระยะทางเป็นเส้นตรงระหว่าง 2 จุด (กม.) — haversine
 * -------------------------------------------------------------
 * ใช้เช็คว่า "จุดเริ่มต้นอยู่ไกลจากสถานที่ที่ผู้ใช้ติ๊กแค่ไหน"
 * → เตือนผู้ใช้ก่อนกดยืนยัน (ขับข้ามจังหวัด = เวลาเดินทางกินเวลาทั้งวัน)
 */
function straightLineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const SUGGESTIONS = [
  "ช่วยวางแผนทริป 3 วันจากคลิปที่เซฟไว้",
  "ที่พักชุมชนงบไม่เกิน 500 บาทมีที่ไหนบ้าง",
  "แนะนำอาหารพื้นถิ่นที่ต้องลอง",
];

/** Quick-prompt chips shown only in host-self mode — the host is asking
 * about their own business, so the prompts are advisory in tone. */
const HOST_SUGGESTIONS = [
  "สรุปธุรกิจของฉันให้หน่อย",
  "วันไหนที่ร้านปิดบ้าง",
  "ช่วยแต่งแคปชันโปรโมทห้องพักหน่อย",
];

/**
 * เช็คว่าคำถามควรเปิด "ป๊อปอัปเลือกสไตล์" หรือไม่ (ประเภท D)
 * -------------------------------------------------------------
 * เปิดเฉพาะคำถามแบบ "อยากรู้ว่ามีที่ไหนน่าเที่ยว / อะไรน่าไป" เท่านั้น
 * · ถามข้อเท็จจริง (ราคา · เวลาเปิด · เบอร์ · ที่อยู่) → ตอบเป็นข้อความปกติ
 * · ขอวางแผนทริป (แพลน · จัดทริป · กี่วัน) → ไปทางการ์ดวางแผนเดิม
 * · โหมด "ถามเกี่ยวกับธุรกิจ" → ไม่เกี่ยว (เช็คที่ผู้เรียก)
 */
const DISCOVERY_PATTERNS = [
  /มีที่ไหน/,
  /มีอะไร[^?]{0,24}น่า/,
  /อะไร[^?]{0,24}น่า/,
  /ที่ไหน[^?]{0,24}น่า/,
  /ช่วยแนะนำ/,
  /แนะนำ(ที่|สถานที่|จุด|ร้าน|คาเฟ่|อาหาร|ร้านอาหาร|แหล่ง)/,
  /สถานที่[^?]{0,24}น่า/,
  /เที่ยวที่ไหน/,
  /ที่น่าไป/,
  // ── "อยากเที่ยว" / "น่าเบื่อ" → ความหมายคือ "อยากให้แนะนำสถานที่"
  //    (ไม่ต้องให้ผู้ใช้พิมพ์คำว่า "แนะนำที่เที่ยว" ให้ตรงเป๊ะ)
  /อยาก(ไป|ออก)?เที่ยว/,
  /อยากหาที่(เที่ยว|ไป|ดี)/,
  /ไปเที่ยวที่ไหน(ดี|ไหม|บ้าง)/,
  /น่าเบื่อ/,
  /อยากพักผ่อน/,
  /อยากไปเที่ยว/,
  /\bwhere to go\b/i,
  /\bthings to do\b/i,
  /\bwhat to do\b/i,
];

const FACT_QUESTION_PATTERNS = [
  /ราคา/,
  /เท่าไหร่/,
  /เปิด(วัน|ตอน|เวลา|ไหม)/,
  /ปิด(วัน|ตอน|กี่|ไหม)/,
  /เบอร์/,
  /โทร/,
  /ที่อยู่/,
  /อยู่ที่ไหน/,
  /อยู่ตรงไหน/,
  /เส้นทาง/,
];

const PLAN_QUESTION_PATTERNS = [
  /แพลน/,
  /วางแผน/,
  /จัดทริป/,
  /ทริป/,
  /กี่วัน/,
  // "อยากไปเที่ยว 3 วัน" = ขอแผนทริป (ไม่ใช่ขอแนะนำสถานที่)
  /[0-9]\s*วัน/,
  /ตาราง(เวลา)?/,
  /ไทม์ไลน์/i,
  /itinerary/i,
  /แผนการเดินทาง/,
  /ประมาณการค่าใช้จ่าย/,
  /ลำดับการเดินทาง/,
];

/**
 * คำตอบสั้น ๆ ที่เป็น "สไตล์" (เช่น "ทะเล" "คาเฟ่" "วัด")
 * → เอไaiเพิ่งถามว่าอยากไปแนวไหน → เปิดป๊อปอัปให้เลือกสไตล์ต่อ
 * (จำกัดความยาวไว้ กันไม่ให้จับคำถามยาว ๆ ที่บังเอิญมีคำเหล่านี้)
 */
const STYLE_KEYWORD_PATTERNS = [
  /ทะเล/,
  /หาด/,
  /ภูเขา/,
  /ป่า/,
  /น้ำตก/,
  /คาเฟ่/,
  /วัด/,
  /ตลาด/,
  /ธรรมชาติ/,
  /ประวัติศาสตร์/,
  /ถนนคนเดิน/,
];

/**
 * เจตนา "อยากไปเที่ยว / อยากรู้ว่ามีที่ไหนน่า" → ให้เปิดป๊อปอัปเลือกสไตล์
 * และบอกโมเดลด้วยว่าผู้ใช้ต้องการแนะนำสถานที่ (ฝั่งแอป ไม่แตะ prompt ฝั่ง backend)
 */
type ChatIntent = "places" | null;

/** บรรทัดเจตนาที่แนบให้โมเดล (ส่งเฉพาะข้อความที่ "ต้องการแนะนำสถานที่") */
const INTENT_NOTE_PLACES =
  "[เจตนาของผู้ใช้: ต้องการให้แนะนำสถานที่ท่องเที่ยว]";

/**
 * ตรวจเจตนาของคำถาม
 * -------------------------------------------------------------
 * · "places" = อยากได้คำแนะนำสถานที่ (เช่น "อยากเที่ยว" "น่าเบื่ออยากไปเที่ยว" "ทะเล")
 * · ถามข้อเท็จจริง (ราคา · เวลาเปิด · เบอร์ · ที่อยู่) → ไม่ใช่เจตนานี้
 * · ขอวางแผนทริป (แพลน · จัดทริป · กี่วัน) → ไปทางการ์ดวางแผน
 */
function detectChatIntent(text: string): ChatIntent {
  const t = (text ?? "").trim();
  if (!t) return null;
  if (PLAN_QUESTION_PATTERNS.some((re) => re.test(t))) return null;
  if (FACT_QUESTION_PATTERNS.some((re) => re.test(t))) return null;
  if (DISCOVERY_PATTERNS.some((re) => re.test(t))) return "places";
  // คำตอบสั้น ๆ ที่เป็น "สไตล์" → ถือว่าอยากได้คำแนะนำสถานที่แนวนั้น
  if (t.length <= 12 && STYLE_KEYWORD_PATTERNS.some((re) => re.test(t))) return "places";
  return null;
}

/**
 * เนื้อหาที่ส่งให้โมเดลเห็นในประวัติแชท
 * -------------------------------------------------------------
 * · ผู้ใช้เห็นแค่ `m.content` (ฟองข้อความ)
 * · `m.aiNote` = บริบทที่โมเดลต้องรู้แต่ผู้ใช้ไม่เห็น (เจตนา · สถานที่ที่เลือก + พิกัด)
 */
function historyContentOf(m: AiChatMessage): string {
  const base = m.folder
    ? `📁 แนบโฟลเดอร์ "${m.folder.name}" (${m.folder.clipCount} คลิป)\n${m.content}`
    : m.content;
  return m.aiNote ? `${base}\n${m.aiNote}` : base;
}

/**
 * จุด 3 จุดกะพริบ (ใช้ในฟอง "กำลังคิด" ของเอไai)
 */
function TypingDots() {
  // ใช้ useState (lazy init) แทน useRef → React Compiler อ่านค่า ref ตอน render ไม่ได้
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 550,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.quad),
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 550,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.quad),
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  return (
    <View className="flex-row items-center">
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            marginRight: i < 2 ? 4 : 0,
            backgroundColor: "#7C3AED",
            opacity: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.3, 1],
            }),
          }}
        />
      ))}
    </View>
  );
}

/**
 * ดึงพิกัด "lat,lng" ออกจากข้อมูลที่คลิปบันทึกไว้
 * (อาจเป็นพิกัดดิบ หรือ URL ของแผนที่ที่มีพิกัดอยู่ใน query)
 */
function parseCoords(raw?: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
  if (!m) return null;
  return `${m[1]},${m[2]}`;
}

/** รหัสแผนสำรอง (ใช้ตอน backend บันทึกไม่สำเร็จ) — อยู่นอก component เพื่อไม่เรียก Date.now() ระหว่าง render */
let planSeq = 0;
function newPlanId(): string {
  planSeq += 1;
  return `plan-${Date.now()}-${planSeq}`;
}

/**
 * แผนทริปที่มีอยู่แล้ว (รูปแบบ `Trip` ของแอป) → ช่องข้อมูลของแผนทริป
 * -----------------------------------------------------------------
 * ใช้ตอนผู้ใช้กด "ส่งกลับไปให้เอไaiแก้" จากหน้าแผนทริป
 * → เอไaiต้องเห็นค่าเดิมทั้งหมด ไม่ต้องถามซ้ำ
 */
function slotsFromTripContext(raw: unknown): TripSlots {
  if (!raw || typeof raw !== "object") return {};
  const t = raw as Record<string, any>;
  const itinerary: any[] = Array.isArray(t.itinerary) ? t.itinerary : [];
  const vehicle = t.vehicle ?? null;
  // วันที่ของแต่ละวันในแผน → ช่วงวันที่ของทริป (วันเริ่ม … วันสิ้นสุด)
  const dayDates = itinerary
    .map((d: any) => (typeof d?.date === "string" ? d.date : null))
    .filter((d: string | null): d is string => !!d);
  const startDate = dayDates[0] ?? null;
  const endDate = dayDates.length ? dayDates[dayDates.length - 1] : startDate;
  return {
    startPoint: t.startPoint
      ? {
          label: String(t.startPoint),
          address: null,
          coords: t.startPointCoords ?? null,
        }
      : null,
    returnMode: t.returnMode === "custom" ? "custom" : "same_as_start",
    endPoint:
      t.returnMode === "custom" && t.endPoint
        ? {
            label: String(t.endPoint),
            address: null,
            coords: t.endPointCoords ?? null,
          }
        : null,
    startDate,
    endDate,
    startTime: t.startTime ?? "08:00",
    vehicle: vehicle?.key ?? null,
    vehicleModel: vehicle?.model ?? null,
    fuelType: vehicle?.fuelType ?? null,
    travelers: Number(t.travelers) || 1,
    budgetPerPerson: Number(t.budgetPerPerson) || 3000,
    style: t.style ?? null,
    dayEndPoints:
      itinerary.length > 1
        ? itinerary.slice(0, -1).map((d: any) => d?.endPoint ?? null)
        : null,
  };
}

export default function AiChatScreen({
  threadId,
  onBack,
  onPlanTrip,
  onOpenTrip,
  initialMessage,
  linkedPlanId,
  initialClipContext,
  initialVideo,
  initialPlanContext,
}: AiChatScreenProps) {
  const insets = useSafeAreaInsets();
  const { getThread, appendMessage, updateMessage, createOrUpdateTripFromPlan } = useAiPlanner();
  const { folders } = useInteractions();
  const { user, session } = useAuth();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attachedFolderId, setAttachedFolderId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [originModalOpen, setOriginModalOpen] = useState(false);
  const [currentOrigin, setCurrentOrigin] = useState<{ label: string; address: string; url?: string; coords?: { lat: number; lng: number } } | null>(null);
  /** สถานที่ที่กำลังดูแผนที่จากชิปในการ์ดตั้งค่า (null = ปิดป๊อปอัป) */
  const [setupMapPlace, setSetupMapPlace] = useState<ChatSelectedPlace | null>(null);
  const [currentPlanId, setCurrentPlanId] = useState<string | undefined>(linkedPlanId);
  // บริบทโฟลเดอร์จริง (รายชื่อสถานที่ + ที่มา) — โหลดครั้งเดียวต่อโฟลเดอร์
  const [folderCtxState, setFolderCtxState] = useState<{
    folderId: string;
    ctx: FolderContextInfo | null;
  } | null>(null);
  // กำลังสร้างแพลนทริปจริงจากตัวสร้างของ backend
  const [planning, setPlanning] = useState(false);
  // Visible only for hosts (see toggle render below). "tourist" is the default
  // and matches the historical behaviour — every chat before this toggle went
  // through the public /ai-chat endpoint without an Authorization header.
  const [chatMode, setChatMode] = useState<"tourist" | "host-self">("tourist");
  const isHost = user?.role === "host";
  // สถานที่ที่ผู้ใช้เลือกจากรายการ (ชื่อซ้ำ) — key = id ของข้อความที่มีรายการ
  const [chosenPlaces, setChosenPlaces] = useState<Record<string, string>>({});
  // คลิปที่แตะในแชท → เปิดผู้ดูคลิปเต็มจอ (แบบเดียวกับหน้าแรก)
  const [viewerPost, setViewerPost] = useState<VideoPost | null>(null);
  /**
   * โฟลเดอร์ที่กดการ์ดในแชท → เปิดหน้าดูคลิปข้างในโฟลเดอร์ (ข้อ 2.2)
   */
  const [browserFolder, setBrowserFolder] = useState<{
    id: string;
    name: string;
    clipCount: number;
  } | null>(null);
  /**
   * โฟลเดอร์ที่แสดงเป็นการ์ดในแชทไปแล้วหรือยัง
   * -------------------------------------------------------------
   * โฟลเดอร์ยัง "ติดอยู่" ตลอดเธอร์ (ให้ backend ได้บริบททุกข้อความ)
   *   แต่การ์ดโฟลเดอร์ในแชทโผล่ครั้งเดียวต่อการแนบ ไม่ใช่ทุกข้อความ
   */
  const announcedFolderRef = useRef<string | null>(null);

  // ── ระบบวางแผนทริป ──────────────────────────────────────────────
  /**
   * ช่องข้อมูลแผนทริปที่สะสม (เอไaiสกัดได้ + ผู้ใช้แก้ในการ์ด)
   * → ส่งกลับไปทุกข้อความ เพื่อให้เอไaiรู้ว่าผู้ใช้เติมอะไรไปแล้ว
   */
  const [draftSlots, setDraftSlots] = useState<TripSlots>(() => {
    // มีแผนเดิมที่กำลังจะให้เอไaiแก้ → ใช้ค่าของแผนนั้นเป็นฐาน
    const fromPlan = slotsFromTripContext(initialPlanContext);
    if (Object.keys(fromPlan).length > 0) return fromPlan;
    // ถ้าเปิดแชทเดิมที่เคยคุยเรื่องแผนทริปไว้ → ดึงช่องข้อมูลเดิมกลับมา
    // (แชทเก่าที่ยังใช้ `date`/`days` → แปลงเป็น `startDate`/`endDate` ให้อัตโนมัติ)
    const t = getThread(threadId);
    const last = [...(t?.messages ?? [])].reverse().find((m) => m.tripDraft);
    return normalizeTripSlotsShape(last?.tripDraft?.slots);
  });
  /**
   * ค่าช่องข้อมูล "ล่าสุด" เก็บไว้ใน ref (ไม่ใช่แค่ค่าใน state)
   * -------------------------------------------------------------
   * เอไaiตอบช้า 10–30 วินาที → ระหว่างรอ ผู้ใช้กดเลือกช่องในการ์ดไปได้หลายครั้ง
   * ถ้าเอไaiตอบมาแล้วเอา "ค่าตอนส่ง" มารวมทับ → ค่าที่ผู้ใช้เพิ่งแตะหายไป
   * (เคยเจอจริง: กดแพลนไม่ได้ เพราะพิกัด/วันที่ที่กรอกไว้ถูกย้อนกลับ)
   *
   * ref นี้เก็บ "ค่าที่เพิ่งอัปเดต" เสมอ → ตอนเอไaiตอบมา รวมเข้ากับค่าล่าสุด
   */
  const draftSlotsRef = useRef<TripSlots>(draftSlots);
  /** อัปเดตช่องข้อมูล + เก็บไว้ใน ref ให้ตรงกันเสมอ */
  const applyDraftSlots = useCallback((next: TripSlots) => {
    draftSlotsRef.current = next;
    setDraftSlots(next);
  }, []);
  /** ข้อความที่กำลังแก้แผนอยู่ (กด "แก้ไขกับเอไai" → แผนใหม่จะกลับไปอัปเดตข้อความเดิม) */
  const [editingPlanMessageId, setEditingPlanMessageId] = useState<string | null>(null);
  /**
   * ตัวเลือกจุดของการ์ดช่องข้อมูล — เปิดที่ระดับหน้าจอ ไม่ใช่ในแถวของลิสต์
   * (Modal ของ native ที่อยู่ในแถวที่ลิสต์ recycle ทิ้งได้ → กลืนการแตะทั้งหน้าจอ)
   */
  const [cardOriginTarget, setCardOriginTarget] = useState<TripOriginTarget | null>(
    null
  );
  /**
   * จุดเริ่มต้นที่ยังไม่มี → รอผู้ใช้เลือกจาก popup (ที่บันทึกไว้) ก่อนทำเส้นทาง
   * -------------------------------------------------------------
   * · เกิดตอนผู้ใช้กด "สร้างแพลนทริปจาก N แห่งที่เลือก" แต่ยังไม่มีจุดเริ่มต้นที่มีพิกัด
   * · เก็บสถานที่ที่ผู้ใช้ติ๊กไว้ → พอเลือกจุดเริ่มต้นเสร็จ ค่อยไปสร้างการ์ดตั้งค่าต่อ
   */
  const [pendingStartPick, setPendingStartPick] = useState<{
    messageId: string;
    picked: ChatPlaceCardData[];
    stops: PlanTripRequest["extraStops"];
  } | null>(null);
  /**
   * sheet ที่กำลังเปิดจากการ์ด (ปฏิทินช่วงวันที่ · ล้อเวลา)
   * → อยู่ที่ระดับหน้าจอ ไม่ใช่ในแถวของลิสต์ (Modal ในแถวที่ recycle ทิ้งจะกลืนการแตะ)
   */
  const [cardPicker, setCardPicker] = useState<"date" | "time" | null>(null);
  /**
   * ลำดับการเปิด sheet — ใช้เป็น `key` ให้ sheet mount ใหม่ทุกครั้งที่เปิด
   * → ค่าเริ่มต้นใน sheet อ่านจาก props ล่าสุดเสมอ (ไม่ต้องมี effect ซิงก์ค่า)
   */
  const [cardPickerSeq, setCardPickerSeq] = useState(0);
  /** เปิด sheet จากการ์ด (ปฏิทินช่วงวันที่ · ล้อเวลา) */
  const openCardPicker = (kind: "date" | "time") => {
    setCardPickerSeq((n) => n + 1);
    setCardPicker(kind);
  };
  /** กำลังคำนวณแผนใหม่ (ลบ/สลับลำดับ/เปลี่ยนราคาน้ำมัน) — key = id ข้อความ */
  const [replanning, setReplanning] = useState<string | null>(null);
  /** ราคาน้ำมันที่ผู้ใช้ระบุเอง — key = id ข้อความ */
  const [fuelOverride, setFuelOverride] = useState<Record<string, number | null>>({});
  /** จุดที่ผู้ใช้เพิ่มเองจากรายการจุดใกล้เคียง — key = id ข้อความ */
  const [extraStops, setExtraStops] = useState<Record<string, PlanTripRequest["extraStops"]>>({});
  /** sheet จุดใกล้เคียง */
  const [nearbyOpen, setNearbyOpen] = useState(false);
  const [nearbyMessageId, setNearbyMessageId] = useState<string | null>(null);
  const [nearbyTargetDay, setNearbyTargetDay] = useState<number>(0);
  const [nearby, setNearby] = useState<NearbyPlace[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  /** แบนเนอร์โฟลเดอร์ที่หัวแชท (ข้อ 7) */
  const [folderBannerExpanded, setFolderBannerExpanded] = useState<boolean>(false);
  const [folderBannerDismissed, setFolderBannerDismissed] = useState<boolean>(false);
  /** ที่พักที่ผู้ใช้เลือกจากข้อเสนอ — key = id ข้อความ */
  const [selectedLodging, setSelectedLodging] = useState<Record<string, string>>({});
  /**
   * ผู้ใช้/เอไai ระบุรถเองหรือยัง — key = id ข้อความที่มีแผน
   * -------------------------------------------------------------
   * false = ยังไม่ได้ระบุ (backend ใช้ค่าเริ่มต้น) → การ์ดแผนจะถามอีกรอบตอนสรุปค่าใช้จ่าย
   * รอบแรก (การ์ดฟอร์ม) ไม่บังคับรถ → ค่านี้บอกว่าต้องถามเพิ่มหรือไม่
   */
  const [vehicleSpecified, setVehicleSpecified] = useState<Record<string, boolean>>({});
  /** Modal เลือกจุดหมายปลายทาง (โฟลเดอร์ / ค้นหา / ให้ AI คิดให้) เมื่อไม่มีสถานที่สำหรับวางแผน */
  const [showDestinationPicker, setShowDestinationPicker] = useState<boolean>(false);
  const [pendingPlanMessageId, setPendingPlanMessageId] = useState<string | null>(null);

  // ── เส้นทาง "ถามแนะนำสถานที่" (ป๊อปอัปเลือกแท็ก → การ์ดสถานที่) ──
  /** ป๊อปอัปเลือกแท็กเปิดอยู่ไหม */
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  /** คลังแท็ก (จาก backend · ถ้ายังไม่ได้ → แอปมีชุดสำรองให้แทน) */
  const [discoveryTags, setDiscoveryTags] = useState<DiscoveryStyle[]>([]);
  const [discoveryTagsLoading, setDiscoveryTagsLoading] = useState(false);
  /** กำลังดึงการ์ดสถานที่จริงจาก Google (หลังผู้ใช้ยืนยันแท็กแล้ว) */
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  /** คำถามที่กำลังรอเลือกแท็ก (แสดงในหัวป๊อปอัป) */
  const [discoveryQuestion, setDiscoveryQuestion] = useState("");
  /** สถานที่ที่ผู้ใช้ติ๊กในการ์ด — key = id ข้อความ */
  const [selectedPlaceCards, setSelectedPlaceCards] = useState<Record<string, string[]>>({});
  /** คำถามที่กำลังรอเลือกแท็ก (เก็บใน ref เพราะ handler อาจถูกเรียกจากป๊อปอัปที่ค้างอยู่) */
  const discoveryQuestionRef = useRef("");
  /** ข้อความที่จะถูกแทนที่เมื่อกด "เปลี่ยนแท็ก" (null = ข้อความใหม่) */
  const discoveryReplaceIdRef = useRef<string | null>(null);
  /** ผู้ใช้ยืนยันแท็กไปแล้วไหม → คลังแท็กจาก backend ที่มาช้าต้องไม่ทับรายการ */
  const discoveryPickedRef = useRef(false);
  /**
   * กันส่งซ้ำขณะที่เอไaiกำลังตอบ
   * -------------------------------------------------------------
   * ใช้ ref ไม่ใช่ state เพราะ handler ที่ถูกเรียกจากป๊อปอัป/แอลเอิร์ต
   * จะเห็นค่า state เก่า (ตอนกด "ยกเลิก" → state ยังไม่ได้อัปเดต)
   */
  const sendingRef = useRef(false);

  const listRef = useRef<FlatList<AiChatMessage>>(null);
  const autoSentRef = useRef(false);
  /** จำนวนข้อความล่าสุด + กันเลื่อนซ้ำในเฟรมเดียวกัน */
  const lastMessageCountRef = useRef(0);
  const scrollToEndRafRef = useRef<number | null>(null);
  /**
   * ผู้ใช้อยู่ใกล้ล่างสุดของแชทไหม
   * → ใช้ตัดสินว่าจะเลื่อนลงล่างอัตโนมัติไหม (ถ้าผู้ใช้เลื่อนขึ้นไปอ่านข้อความเก่า ไม่ต้องดึงกลับ)
   */
  const nearBottomRef = useRef(true);
  /** ผู้ใช้กำลังลากลิสต์อยู่ → ห้ามเลื่อนล่างเด็ดขาด */
  const draggingRef = useRef(false);

  const thread = getThread(threadId);

  /**
   * เลื่อนลงล่างเมื่อ "มีข้อความใหม่" เท่านั้น
   *
   * เดิมเลื่อนทุกครั้งที่ขนาดเนื้อหาในลิสต์เปลี่ยน — ซึ่งเกิดทันทีที่แถวในการ์ด
   * ขยาย/หด เช่นตอนเลือกรถแล้วแถว "ชนิดน้ำมัน" โผล่ขึ้นมาใต้แถว "รถที่ใช้"
   * → เด้งไปมาจนทั้งแอปค้าง (กดอะไรก็ไม่ได้)
   *
   * เพิ่ม: เลื่อนแบบไม่มีแอนิเมชัน + เลื่อนเฉพาะตอนผู้ใช้อยู่ล่างสุดอยู่แล้ว
   * → ถ้าลิสต์ขยับตอนที่นิ้วผู้ใช้ยังกดค้างอยู่ ทั้งแอปจะกดไม่ได้ (เคยเจอจริง)
   */
  const handleContentSizeChange = useCallback(() => {
    const count = thread?.messages.length ?? 0;
    const isNewMessage = count !== lastMessageCountRef.current;
    lastMessageCountRef.current = count;
    if (!isNewMessage) return; // แถวเดิมขยาย/หด → ไม่ต้องเลื่อน
    if (draggingRef.current) return; // ผู้ใช้กำลังลากอยู่ → ไม่ดึงกลับ
    if (!nearBottomRef.current) return; // ผู้ใช้เลื่อนขึ้นไปอ่านของเก่า → ไม่ดึงกลับ
    if (scrollToEndRafRef.current != null) return;
    scrollToEndRafRef.current = requestAnimationFrame(() => {
      scrollToEndRafRef.current = null;
      listRef.current?.scrollToEnd({ animated: false });
    });
  }, [thread?.messages.length]);

  /** ผู้ใช้อยู่ห่างจากล่างสุดแค่ไหน → ใช้ตัดสินว่าจะเลื่อนอัตโนมัติไหม */
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distanceFromBottom =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);
      nearBottomRef.current = distanceFromBottom < 120;
    },
    []
  );

  const threadFolder = thread?.folderId ? folders.find((f) => f.id === thread.folderId) : undefined;
  const attachedFolder = attachedFolderId ? folders.find((f) => f.id === attachedFolderId) : undefined;
  const folder = attachedFolder ?? threadFolder;

  // บริบทคลิปของแชทนี้ (เก็บไว้กับเธรด เพื่อให้กลับมาเปิดแชทเดิมแล้วยังใช้ได้)
  const clipContext = thread?.clipContext ?? initialClipContext ?? null;
  const clipVideo = thread?.video ?? initialVideo ?? null;
  /** ปุ่ม "เส้นทางไปที่นี่" — ใช้เมื่อแชทนี้มาจากคลิปที่มีสถานที่ */
  const clipPlaceName = clipContext?.placeName ?? null;

  // โหลดบริบทโฟลเดอร์จริง (ชื่อสถานที่ + ป้ายที่มา) — ใช้ทั้งในแชทและตอนกดสร้างแพลน
  const folderId = folder?.id;
  useEffect(() => {
    if (!folderId) return;
    let cancelled = false;
    (async () => {
      const ctx = await getFolderContext(folderId, session?.access_token ?? null).catch(
        () => null
      );
      if (!cancelled) setFolderCtxState({ folderId, ctx });
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId, session?.access_token]);

  // ใช้เฉพาะเมื่อเป็นบริบทของโฟลเดอร์ที่กำลังแสดงอยู่จริง
  const folderCtx =
    folderCtxState && folderCtxState.folderId === folderId ? folderCtxState.ctx : null;

  /**
   * ผู้ใช้เลือกจุดเริ่มต้นจากรายการที่บันทึกไว้
   * -------------------------------------------------------------
   * เลือก = กรอกช่องข้อมูลจุดเริ่มต้นของแผนทริป เท่านั้น
   * → **ไม่ส่งข้อความเข้าแชท** (ผู้ใช้แค่เลือกจุด ไม่ได้ถามเอไai)
   *   จุดเริ่มต้นจะถูกส่งไปพร้อมข้อความถัดไปผ่าน `tripDraft` อยู่แล้ว
   */
  const handleSelectOrigin = (origin: { label: string; address: string; url?: string; coords?: { lat: number; lng: number } }) => {
    setCurrentOrigin(origin);
    // จุดเริ่มต้นที่ผู้ใช้เลือก = ช่องข้อมูลจุดเริ่มต้นของแผนทริป (ไม่ต้องพิมพ์ซ้ำ)
    const coords = origin.coords ?? null;
    const nextSlots: TripSlots = {
      ...draftSlotsRef.current,
      startPoint: {
        label: origin.label,
        address: origin.address || null,
        coords,
      },
    };
    applyDraftSlots(nextSlots);
  };

  /**
   * เริ่มทำแพลนจากสถานที่ที่ผู้ใช้ติ๊ก (หลังได้จุดเริ่มต้นจากที่บันทึกแล้ว)
   * -------------------------------------------------------------
   * · **จุดเริ่มต้น** = สถานที่ที่บันทึกไว้ของผู้ใช้ (ไม่ใช่สถานที่ที่ติ๊ก)
   * · **จุดสิ้นสุด** = เลือก 1 สถานที่ → จบที่สถานที่นั้น · เลือกหลายสถานที่ → กลับจุดเริ่มต้น
   * · สถานที่ที่ติ๊กทั้งหมด = จุดที่ต้องไปของเส้นทาง (ระบบจัดลำดับให้ตามเวลาเดินทาง + เวลาเปิดปิด)
   */
  const startPlanFromCards = (
    messageId: string,
    picked: ChatPlaceCardData[],
    stops: PlanTripRequest["extraStops"]
  ) => {
    const msg = thread?.messages.find((m) => m.id === messageId);
    const base = draftSlotsRef.current;

    // จุดสิ้นสุด: เลือก 1 สถานที่ → จบที่สถานที่นั้น · เลือกหลายสถานที่ → กลับจุดเริ่มต้น
    const single = picked.length === 1 ? picked[0] : null;
    const singleEnd: TripPlanPoint | null = single
      ? {
          label: single.name,
          address: single.address ?? null,
          coords: { lat: single.lat as number, lng: single.lng as number },
        }
      : null;

    applyDraftSlots({
      ...base,
      returnMode: single ? "custom" : "same_as_start",
      endPoint: single ? singleEnd : null,
      style:
        msg?.discoveryTags?.map((t) => t.label).join(" · ") ||
        msg?.discoveryStyle?.label ||
        base.style ||
        null,
    });

    // ── ข้อความฝั่งผู้ใช้ (ระบบสร้างให้เอง) ─────────────────────────
    // → โผล่ทันที ไม่ยิงให้เอไaiตอบกลับ แต่ข้อความจะติดไปกับประวัติแชท
    //   รอบถัดไปที่ผู้ใช้พิมพ์เอง เอไaiจะเห็นบริบทนี้
    // · planPlaces = รายการที่ผู้ใช้ติ๊ก (แหล่งเดียวกับกล่องที่เห็น + ที่ส่งให้เอไai)
    // · aiNote = ชื่อ + พิกัดที่ผู้ใช้ติ๊ก (โมเดลต้องรู้ด้วย ไม่งั้นแผนไม่รู้จุดไหน)
    appendMessage(threadId, {
      role: "user",
      content: `สร้างแพลนทริปจาก ${picked.map((p) => p.name).join(", ")}`,
      planPlaces: stops,
      aiNote: formatPlanPlacesContext(stops, base),
    });

    // ── การ์ดตั้งค่า (ข้อความใหม่ของเอไai) ───────────────────────
    appendMessage(threadId, {
      role: "assistant",
      content:
        "กรอกข้อมูลที่ต้องการเพิ่มเติมได้เลย (ข้ามข้อไหนไม่ได้ก็ได้) แล้วกดยืนยันเพื่อสร้างแพลน",
      planSetup: true,
      // รายการที่ผู้ใช้ติ๊ก → เก็บไว้กับข้อความนี้เลย (แหล่งเดียว)
      // → การ์ดโชว์ชิปจากที่นี่ · ปุ่มยืนยันเอาไปสร้างคำขอจากที่นี่ (ต่างกันไม่ได้)
      planPlaces: stops,
    });
  };

  /**
   * ผู้ใช้เลือกจุดจากตัวเลือกจุดของการ์ด
   * (จุดเริ่มต้น · จุดสิ้นสุดตอนกลับ · จุดจบของแต่ละวัน)
   */
  const handleCardOriginSelected = (origin: {
    label: string;
    address: string;
    url?: string;
    coords?: { lat: number; lng: number };
  }) => {
    const target = cardOriginTarget;
    setCardOriginTarget(null);
    if (!target) return;
    const point: TripPlanPoint = {
      label: origin.label,
      address: origin.address || null,
      coords: origin.coords ?? null,
    };
    const prev = draftSlotsRef.current;
    if (target === "start") {
      // ถ้ารอจุดเริ่มต้นอยู่ (กด "สร้างแพลนทริปจาก N แห่งที่เลือก" แต่ยังไม่มีจุดเริ่มต้น)
      // → จุดเริ่มต้นต้องมีพิกัด ถึงจะวางเส้นทางได้
      const pending = pendingStartPick;
      if (pending && !point.coords) {
        Alert.alert(
          "หาพิกัดไม่ได้",
          "จุดเริ่มต้นต้องมีพิกัด จึงจะวางเส้นทางได้\n\n" +
            "ลองเลือกจากที่บันทึกไว้ หรือพิมพ์ชื่อสถานที่ให้ละเอียดกว่านี้"
        );
        setCardOriginTarget("start");
        return;
      }
      applyDraftSlots({ ...prev, startPoint: point });
      // → ทำขั้นต่อไปต่อเลย (ตั้งค่าจุดสิ้นสุด + สร้างการ์ดตั้งค่า)
      if (pending) {
        setPendingStartPick(null);
        startPlanFromCards(pending.messageId, pending.picked, pending.stops);
      }
      return;
    }
    if (target === "end") {
      applyDraftSlots({ ...prev, endPoint: point, returnMode: "custom" });
      return;
    }
    if (target === "destination") {
      const currentDests = prev.destinations ?? [];
      applyDraftSlots({ ...prev, destinations: [...currentDests, point] });
      return;
    }
    const list = [...(prev.dayEndPoints ?? [])];
    list[target.day] = point;
    applyDraftSlots({ ...prev, dayEndPoints: list });
  };

  // ── ระบบวางแผนทริป ────────────────────────────────────────────────
  /**
   * รวมจุด (จุดเริ่มต้น / จุดสิ้นสุด) โดยไม่ให้พิกัดที่ผู้ใช้เลือกเองหาย
   * -------------------------------------------------------------
   * โมเดล/เซิร์ฟเวอร์ **หาพิกัดเองไม่ได้** → จุดที่กลับมามักมีแต่ชื่อ (`coords: null`)
   * ถ้าเอาค่านั้นทับของเดิมทิ้ง พิกัดที่ผู้ใช้เลือกเองจะหาย
   *   แล้วการ์ดจะขึ้นว่า "ยังขาด: พิกัดจุดเริ่มต้น" ทั้งที่ผู้ใช้เลือกไปแล้ว
   *   (เคยเจอจริง: กด "สร้างแผนทริป" ไม่ได้ ทั้งที่กรอกครบแล้ว)
   *
   * กฎ: **จุดที่มีพิกัดอยู่แล้ว = ผู้ใช้เลือกเอง = ข้อมูลที่ถูกที่สุด → ชนะเสมอ**
   */
  const mergePoint = (
    current?: TripPlanPoint | null,
    incoming?: TripPlanPoint | null
  ): TripPlanPoint | null | undefined => {
    if (!incoming) return current ?? undefined;
    if (!current) return incoming;
    if (current.coords) return current;
    return {
      label: incoming.label || current.label,
      address: incoming.address ?? current.address ?? null,
      coords: incoming.coords ?? current.coords ?? null,
    };
  };

  /**
   * เทียบค่าสองช่องข้อมูลว่า "เหมือนกันไหม" (ใช้บอกว่าผู้ใช้แก้ไปหรือยัง)
   */
  const sameSlotValue = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== "object" || typeof b !== "object") return false;
    const pa = a as Record<string, any>;
    const pb = b as Record<string, any>;
    if ((pa.label ?? null) !== (pb.label ?? null)) return false;
    if ((pa.address ?? null) !== (pb.address ?? null)) return false;
    const ca = pa.coords;
    const cb = pb.coords;
    if (!ca || !cb) return !ca && !cb;
    return ca.lat === cb.lat && ca.lng === cb.lng;
  };

  /**
   * รวมช่องข้อมูลที่เอไaiสกัดได้ กับช่องที่ผู้ใช้เคยกรอกไว้
   * · ค่าที่โมเดลไม่รู้ (null) จะไม่ทับค่าเดิม
   * · จุดที่มีพิกัดอยู่แล้ว จะไม่ถูกจุดที่ไม่มีพิกัดทับ (ดู `mergePoint`)
   * · `dayEndPoints` เก็บฝั่งแอปเท่านั้น (backend ไม่รู้จัก) → ต้องคงเดิม
   * · ถ้ากลับไป "กลับจุดเดิม" → ล้างจุดสิ้นสุดที่เคยเลือกทิ้ง
   * · **ช่วงวันที่ที่ผู้ใช้เลือกเอง = ชนะเสมอ** (โมเดลเสนอได้แค่ตอนที่ยังไม่มี)
   *   → กันกรณีผู้ใช้เลือก 3 วันแล้วโมเดลตอบ `days: 2` แล้วแผนได้ 2 วัน
   *
   * `base` = ค่าที่ส่งไปรอบนี้ → ใช้บอกว่าผู้ใช้เพิ่งแก้ช่องไหนไปหลังส่ง
   *   ถ้าผู้ใช้แก้แล้ว → **ค่าของผู้ใช้ชนะ** (เอไaiไม่รู้ค่าที่เพิ่งแตะ)
   */
  const mergeSlots = (
    current: TripSlots,
    incoming: TripSlots,
    base?: TripSlots
  ): TripSlots => {
    const next: TripSlots = { ...current };
    /** ผู้ใช้แก้ช่องนี้ไปหรือยัง (หลังส่งข้อความไปรอบนี้) */
    const userChanged = (key: keyof TripSlots) =>
      !!base && !sameSlotValue(current[key], base[key]);

    const start = mergePoint(current.startPoint, incoming.startPoint);
    if (start && !userChanged("startPoint")) next.startPoint = start;
    if (incoming.returnMode && !userChanged("returnMode")) {
      next.returnMode = incoming.returnMode;
    }
    const end = mergePoint(current.endPoint, incoming.endPoint);
    if (end && !userChanged("endPoint")) next.endPoint = end;

    // ── ช่วงวันที่ ────────────────────────────────────────────────
    // ผู้ใช้มีช่วงวันที่อยู่แล้ว = ตัดสินใจเอง → ชนะเสมอ (ไม่ว่าเลือกไว้ก่อนหรือหลังส่ง)
    const hasUserRange = !!(current.startDate || current.endDate);
    if (!hasUserRange) {
      if (incoming.startDate) next.startDate = incoming.startDate;
      if (incoming.endDate) next.endDate = incoming.endDate;
    } else if (
      current.startDate &&
      !current.endDate &&
      incoming.startDate === current.startDate &&
      incoming.endDate
    ) {
      // ผู้ใช้มีแต่วันเริ่ม (ข้อมูลเก่า) และโมเดลต่อยอดจากวันเริ่มเดียวกัน → รับวันสิ้นสุดได้
      next.endDate = incoming.endDate;
    }

    if (incoming.startTime && !userChanged("startTime")) {
      next.startTime = incoming.startTime;
    }
    if (incoming.vehicle && !userChanged("vehicle")) next.vehicle = incoming.vehicle;
    if (incoming.vehicleModel && !userChanged("vehicleModel")) {
      next.vehicleModel = incoming.vehicleModel;
    }
    if (incoming.fuelType && !userChanged("fuelType")) next.fuelType = incoming.fuelType;
    if (incoming.travelers && !userChanged("travelers")) {
      next.travelers = incoming.travelers;
    }
    if (incoming.budgetPerPerson && !userChanged("budgetPerPerson")) {
      next.budgetPerPerson = incoming.budgetPerPerson;
    }
    if (incoming.style && !userChanged("style")) next.style = incoming.style;
    if (current.dayEndPoints) next.dayEndPoints = current.dayEndPoints;
    if (current.destinations) next.destinations = current.destinations;
    if (next.returnMode === "same_as_start") next.endPoint = null;
    return next;
  };

  /**
   * สร้างช่องข้อมูลจากแพลนที่วาดแล้ว → ใช้ตอนคำนวณใหม่
   * (ลบจุด · ขยับลำดับ · เปลี่ยนราคาน้ำมัน) เพื่อให้ใช้พิกัด/วันที่/รถเดิมเป๊ะ ๆ
   */
  const slotsFromPlan = (plan: TripPlan): TripSlots => {
    const days = plan.days ?? [];
    const startDate = days[0]?.date ?? null;
    const endDate = days.length ? days[days.length - 1].date ?? startDate : startDate;
    return {
      startPoint: plan.startPoint,
      returnMode: plan.returnMode,
      endPoint: plan.returnMode === "custom" ? plan.endPoint : null,
      startDate,
      endDate,
      startTime: plan.startTime ?? "08:00",
      vehicle: plan.vehicle?.key ?? "private_car",
      vehicleModel: plan.vehicle?.model ?? null,
      fuelType: plan.vehicle?.fuelType ?? null,
      travelers: plan.travelers ?? 1,
      budgetPerPerson: plan.budgetPerPerson ?? plan.budget?.perPerson ?? 3000,
      style: plan.style ?? null,
      // จุดสิ้นสุดของแต่ละวัน (ยกเว้นวันสุดท้ายที่ใช้ endPoint ตอนกลับ)
      dayEndPoints:
        days.length > 1 ? days.slice(0, -1).map((d) => d.endPoint ?? null) : null,
    };
  };

  /** สร้างคำขอวางแผนจากช่องข้อมูล + สิ่งที่ผู้ใช้แก้ในแผน */
  const buildPlanRequest = (
    slots: TripSlots,
    opts?: {
      selectedStops?: { id?: string; name: string; day: number }[];
      extraStops?: PlanTripRequest["extraStops"];
      fuelPriceOverride?: number | null;
      save?: boolean;
    }
  ): PlanTripRequest => {
    const base = planRequestFromSlots(slots, folder?.id ?? null);
    const destStops: NonNullable<PlanTripRequest["extraStops"]> = (slots.destinations ?? [])
      .filter((d) => !!d.coords)
      .map((d) => ({
        label: d.label,
        address: d.address ?? null,
        coords: d.coords!,
      }));
    const combinedExtraStops = [
      ...destStops,
      ...(opts?.extraStops ?? []),
    ];
    // log ก่อนยิง API — ดูได้ทันทีว่าส่งจุดที่ผู้ใช้ติ๊กไปจริงหรือเปล่า
    console.log(
      "[AiChatScreen] buildPlanRequest · extraStops:",
      combinedExtraStops.length,
      combinedExtraStops.map((s) => s.label)
    );
    return {
      ...base,
      selectedStops: opts?.selectedStops,
      extraStops: combinedExtraStops.length > 0 ? combinedExtraStops : undefined,
      fuelPriceOverride: opts?.fuelPriceOverride ?? undefined,
      save: opts?.save ?? false,
    };
  };

  /** รายการจุดทั้งหมดตามลำดับที่ผู้ใช้เห็น → ส่งกลับให้ backend ยึดเป็นจริง */
  const collectSelectedStops = (
    days: TripPlan["days"]
  ): { id?: string; name: string; day: number }[] =>
    (days ?? []).flatMap((d) =>
      (d.stops ?? []).map((s) => ({ id: s.id, name: s.name, day: d.day }))
    );

  /** ล้างการ์ดข้อมูลชั่วคราวออกจากทุกข้อความ (แผนที่สร้างแล้วไม่ต้องการการ์ดซ้ำ) */
  const clearDraftCards = () => {
    if (!thread) return;
    thread.messages.forEach((m) => {
      if (m.tripDraft) updateMessage(threadId, m.id, { tripDraft: undefined });
    });
  };

  /** เรียก POST /trips/plan แล้วอัปเดตการ์ดแพลนในข้อความนั้น */
  const runPlan = async (
    messageId: string,
    req: PlanTripRequest
  ): Promise<TripPlan | null> => {
    setReplanning(messageId);
    try {
      const result = await generateTripPlan(req, {
        token: session?.access_token ?? null,
      });
      const meta: TripPlanMeta = {
        notSelected: result.notSelected,
        aiWarnings: result.aiWarnings,
        folderWarning: result.folderWarning ?? null,
        // คงรหัสแผนเดิมของการ์ดนี้ไว้ (คำนวณใหม่แต่ยังไม่บันทึก)
        // → กดยืนยันแล้วจะอัปเดตทับแถวเดิม ไม่สร้างแผนซ้ำ
        planId: result.planId ?? thread?.messages.find((m) => m.id === messageId)?.planMeta?.planId ?? null,
      };
      console.log(
        "[AiChatScreen] แผนที่ได้กลับ:",
        result.plan.days?.map((d) => ({
          day: d.day,
          stops: d.stops?.length ?? 0,
        }))
      );
      updateMessage(threadId, messageId, { plan: result.plan, planMeta: meta });
      return result.plan;
    } catch (err) {
      const aiErr = asAiError(err);
      // ถ้าไม่มีสถานที่ในโฟลเดอร์สำหรับวางแผนทริป หรือ NO_STOPS → เปิด Modal ให้เลือกสถานที่/ให้ AI คิดให้ ทันที
      if (
        (aiErr as any)?.code === "NO_STOPS" ||
        aiErr?.message?.includes("ไม่พบสถานที่") ||
        aiErr?.message?.includes("NO_STOPS")
      ) {
        console.log("[AiChatScreen] runPlan caught NO_STOPS, opening destination picker modal");
        setPendingPlanMessageId(messageId);
        setShowDestinationPicker(true);
        return null;
      }
      Alert.alert(
        "คำนวณแผนไม่สำเร็จ",
        aiErr?.message ?? "เรียกตัวคำนวณแผนทริปไม่สำเร็จ ลองใหม่อีกครั้ง"
      );
      return null;
    } finally {
      setReplanning(null);
    }
  };

  /**
   * ต่อท้ายข้อความ "สรุปแพลน" ลงในแชท (เส้นทางเดิมของแอป)
   * → flow ใหม่จะไม่เรียกฟังก์ชันนี้ (ผู้ใช้ยืนยันลำดับจุดก่อนค่อยสรุป)
   */
  const appendPlanSummaryMessage = (plan: TripPlan) => {
    appendMessage(threadId, {
      role: "assistant",
      content: formatPlanSummary(plan),
    });
  };

  const handleCreatePlan = async (
    messageId: string,
    opts?: {
      /** จุดที่ผู้ใช้เพิ่งเลือก (ค่าใหม่ → ใช้ค่านี้ทันที ไม่ต้องรอ state) */
      extraStops?: PlanTripRequest["extraStops"];
      /** ข้อความที่จะอัปเดตการ์ดแผน (ข้ามการอ้างอิงข้อความที่กำลังแก้อยู่) */
      targetId?: string;
      /**
       * ต่อท้ายข้อความ "สรุปแพลน" ในแชทหรือไม่
       * · true (ค่าเริ่มต้น) = ต่อท้ายเหมือนเดิม (เส้นทางแชทเดิม)
       * · false = ไม่ต่อท้าย (flow ใหม่: ผู้ใช้ยืนยันลำดับจุดก่อนค่อยสรุป)
       */
      appendSummary?: boolean;
    }
  ) => {
    // ถ้ากำลังแก้แผนเดิมอยู่ → แผนใหม่ต้องไปทับแผนเดิม ไม่ใช่สร้างการ์ดใหม่
    const targetId = opts?.targetId ?? editingPlanMessageId ?? messageId;
    // ใช้ค่าล่าสุดเสมอ (ผู้ใช้อาจแก้การ์ดระหว่างที่รอเอไaiตอบ)
    const rawSlots = draftSlotsRef.current;
    console.log("[AiChatScreen] handleCreatePlan called, rawSlots:", rawSlots);

    // ตรวจสอบก่อนว่ามีสถานที่ให้วางแผนหรือไม่ (ถ้าไม่มีทั้งโฟลเดอร์ และไม่มี extraStops)
    const currentExtra = opts?.extraStops ?? extraStops[targetId] ?? [];
    const hasFolder = Boolean(attachedFolderId || thread?.folderId);
    if (!hasFolder && currentExtra.length === 0) {
      console.log("[AiChatScreen] ไม่มีสถานที่และไม่มีโฟลเดอร์ เปิด TripDestinationPickerModal ทันที");
      setPendingPlanMessageId(targetId);
      setShowDestinationPicker(true);
      return;
    }

    setPlanning(true);

    // ถ้าผู้ใช้กดข้ามจุดเริ่มต้น หรือจุดยังไม่มีพิกัด ให้เตรียมค่าเริ่มต้นที่ใช้งานได้
    // วันที่: ผู้ใช้ข้ามไม่ระบุ → ใช้วันนี้ (จำนวนวันคิดจากจำนวนจุดที่เลือก · 3 จุดต่อวัน)
    const pickedCount = (opts?.extraStops ?? extraStops[targetId] ?? []).length;
    const fallbackDays = Math.min(
      TRIP_MAX_DAYS,
      Math.max(1, Math.ceil(pickedCount / 3))
    );
    const startDate = rawSlots.startDate ?? tripTodayIso();
    const endDate = rawSlots.endDate ?? tripAddDays(startDate, fallbackDays - 1);

    const slots: TripSlots = {
      ...rawSlots,
      startPoint: rawSlots.startPoint?.coords
        ? rawSlots.startPoint
        : rawSlots.startPoint?.label
        ? { label: rawSlots.startPoint.label, coords: { lat: 18.7883, lng: 98.9853 } }
        : { label: "เชียงใหม่ (จุดเริ่มต้น)", coords: { lat: 18.7883, lng: 98.9853 } },
      returnMode: rawSlots.returnMode ?? "same_as_start",
      budgetPerPerson: rawSlots.budgetPerPerson ?? 3000,
      startTime: rawSlots.startTime ?? "08:00",
      startDate,
      endDate,
    };

    // รถยังไม่ได้ระบุ → การ์ดแผนจะถามอีกรอบตอนสรุปค่าใช้จ่าย
    setVehicleSpecified((prev) => ({
      ...prev,
      [targetId]: !!slots.vehicle?.trim(),
    }));
    try {
      const plan = await runPlan(
        targetId,
        buildPlanRequest(slots, {
          extraStops: opts?.extraStops ?? extraStops[targetId] ?? [],
          fuelPriceOverride: fuelOverride[targetId] ?? null,
        })
      );
      if (plan) {
        clearDraftCards();
        setEditingPlanMessageId(null);
        // สรุปแผนทั้งหมดกลับให้ผู้ใช้ในแชท (ข้อ 2.3)
        // → การ์ดแพลนดูรายละเอียด แต่ในแชทต้องมีภาพรวมทั้งทริปด้วย
        if (opts?.appendSummary !== false) appendPlanSummaryMessage(plan);
      }
    } finally {
      setPlanning(false);
    }
  };

  /**
   * ปุ่ม "สร้างแพลนทริปจาก N แห่งที่เลือก" (ใต้การ์ดสถานที่)
   * -------------------------------------------------------------
   * **ขั้นที่ 1 ของ flow ใหม่ — ยังไม่คำนวณแผน**
   *   1. สถานที่ที่ผู้ใช้ติ๊ก = **จุดปลายทางของเส้นทาง** (ไม่ใช่จุดเริ่มต้น!)
   *      · เลือก 1 สถานที่ → ใส่เป็น "จุดสิ้นสุด" ของทริป
   *      · เลือกหลายสถานที่ → ปล่อยให้ระบบจัดเส้นทางเอง
   *        (ประหยัดเวลาเดินทางที่สุด + เคารพเวลาเปิดปิดของแต่ละสถานที่)
   *   2. **จุดเริ่มต้น** = สถานที่ที่บันทึกไว้ของผู้ใช้
   *      · ยังไม่มี → เด้ง popup ให้เลือก/กรอกจุดเริ่มต้นจากที่บันทึกก่อน (ทำรูทไม่ได้ถ้าไม่มี)
   *   3. สร้างฟองผู้ใช้ "สร้างแพลนทริปจาก <ชื่อที่เลือก>" (โผล่ทันที ไม่ยิงให้เอไaiตอบกลับ)
   *   4. ต่อท้ายการ์ด "ตั้งค่าแพลนทริป" (TripQuestionFlow โหมด setup) ให้ผู้ใช้กรอกเอง
   * → ผู้ใช้กด "ยืนยันและสร้างแพลน" ในการ์ดตั้งค่า → ค่อยไปขั้นที่ 2 (คำนวณแพลน)
   */
  const handleCreatePlanFromCards = (messageId: string) => {
    const msg = thread?.messages.find((m) => m.id === messageId);
    const cards = msg?.placeCards ?? [];
    const chosen = selectedPlaceCards[messageId] ?? [];
    const picked = cards.filter(
      (c) => chosen.includes(c.placeId) && c.lat != null && c.lng != null
    );
    if (picked.length === 0) {
      Alert.alert(
        "ยังไม่ได้เลือกสถานที่",
        "ติ๊กกล่องสถานที่ที่อยากไปก่อน แล้วกดปุ่มสร้างแพลนทริปอีกครั้ง"
      );
      return;
    }
    const stops: PlanTripRequest["extraStops"] = picked.map((p) => ({
      label: p.name,
      address: p.address ?? null,
      coords: { lat: p.lat as number, lng: p.lng as number },
      // ส่งเวลาเปิด-ปิดไปด้วย → ระบบรู้ว่าจะรอ (ถึงก่อนเปิด) หรือย้ายวัน (ปิดแล้ว)
      // ถ้าไม่ส่ง → ระบบเตือนว่า "ไม่ทราบเวลาเปิด-ปิด" แล้วจัดลำดับเวลาเปิดให้ไม่ได้
      openingHours: p.openingHours ?? null,
      website: p.website ?? null,
    }));

    // มีการ์ดตั้งค่าค้างอยู่แล้ว → ไม่สร้างซ้ำ (กันการ์ดตั้งค่า 2 ใบ)
    if ((thread?.messages ?? []).some((m) => m.planSetup)) {
      Alert.alert(
        "มีการ์ดตั้งค่าอยู่แล้ว",
        "กรอกข้อมูลในการ์ดตั้งค่าที่มีอยู่ให้เสร็จก่อน แล้วกดยืนยันได้เลย"
      );
      return;
    }
    setExtraStops((prev) => ({ ...prev, [messageId]: stops }));

    // ── จุดเริ่มต้นต้องมาจาก "ที่บันทึก" ของผู้ใช้ ─────────────────
    // สถานที่ที่ผู้ใช้ติ๊กไว้ไม่ใช่จุดเริ่มต้น (เป็นจุดปลายทางของเส้นทาง)
    //   → ถ้ายังไม่มีจุดเริ่มต้นที่มีพิกัด เด้ง popup ให้เลือก/กรอกจากที่บันทึกไว้ก่อน
    //     (ทำเส้นทางไม่ได้ถ้าไม่มีจุดเริ่มต้น) แล้วค่อยไปต่อขั้นถัดไป
    if (!draftSlotsRef.current.startPoint?.coords) {
      setPendingStartPick({ messageId, picked, stops });
      setCardOriginTarget("start");
      return;
    }

    startPlanFromCards(messageId, picked, stops);
  };

  /**
   * ขั้นที่ 2: ผู้ใช้กด "ยืนยันและสร้างแพลน" ในการ์ดตั้งค่า
   * -------------------------------------------------------------
   *   · ส่งข้อมูลที่ผู้ใช้กรอกเป็นข้อความฝั่งผู้ใช้ (ตามที่กรอกจริง ๆ)
   *   · แล้วค่อยคำนวณแพลน → การ์ดแพลนโผล่ "ท้องหลัง" ข้อความผู้ใช้
   *   · ยังไม่มีสรุปแพลน (สรุปตอนผู้ใช้ยืนยันลำดับจุดแล้ว)
   */
  const handleCreatePlanFromSetup = async (setupId: string) => {
    const slots = draftSlotsRef.current;
    // อ่านจากแหล่งเดียวกับที่การ์ดโชว์ชิป → สิ่งที่เห็นคือสิ่งที่จะส่ง
    const setupMsg = thread?.messages.find((m) => m.id === setupId);
    const stops = setupMsg?.planPlaces ?? [];
    if (stops.length === 0) {
      console.warn(
        "[AiChatScreen] handleCreatePlanFromSetup: ไม่มีสถานที่ที่ผู้ใช้ติ๊กในการ์ดตั้งค่า"
      );
    }

    // ── ข้อความฝั่งผู้ใช้: ข้อมูลที่กรอกมา ─────────────────────────
    // · content = ข้อความที่ผู้ใช้เห็น (จุดเริ่มต้น · วัน · เวลา · รถ · คน · งบ)
    // · planPlaces = สถานที่ที่ผู้ใช้ติ๊ก (กล่องใต้ฟองนี้ + สิ่งที่ส่งไปสร้างแผน = ตัวเดียวกัน)
    // · aiNote = ชื่อ + พิกัดสถานที่ → โมเดลต้องเห็นด้วย
    appendMessage(threadId, {
      role: "user",
      content: formatTripSetupText(slots),
      planPlaces: stops,
      aiNote: formatPlanPlacesContext(stops, slots),
    });

    // ── ข้อความใหม่ของเอไai = ที่เกาะของการ์ดแพลน ───────────────
    // planView = "staged" → การ์ดนี้เป็นของ flow ใหม่ (ปุ่ม "ยืนยันแพลนทริป" → การ์ดสรุป)
    const planId = appendMessage(threadId, {
      role: "assistant",
      content: "",
      planView: "staged",
    });
    setExtraStops((prev) => ({ ...prev, [planId]: stops }));

    // ปิดการ์ดตั้งค่า (ไม่ต้องโผล่ซ้ำ)
    updateMessage(threadId, setupId, { planSetup: false });

    await handleCreatePlan(setupId, {
      extraStops: stops,
      targetId: planId,
      appendSummary: false,
    });
  };

  /**
   * ขั้นที่ 3: ผู้ใช้กด "ยืนยันแพลนทริป" ในการ์ดแพลน (หลังจัดลำดับจุดเรียบร้อย)
   * -------------------------------------------------------------
   *   · ส่งรายการจุดที่ผู้ใช้จัดเองเป็นข้อความฝั่งผู้ใช้
   *   · แล้วขึ้น "การ์ดสรุป" = กล่อง "เวลา — สถานที่" เรียงลงล่าง
   */
  const handleConfirmPlanStops = (messageId: string, plan: TripPlan) => {
    const srcMsg = thread?.messages.find((m) => m.id === messageId);

    // ── ข้อความฝั่งผู้ใช้: รายการจุดที่ผู้ใช้ยืนยัน ───────────────
    appendMessage(threadId, {
      role: "user",
      content: formatStopsSelectionText(plan),
    });

    // ── การ์ดสรุป (ข้อความใหม่) ────────────────────────────────
    const sumId = appendMessage(threadId, {
      role: "assistant",
      content: "",
      plan,
      planMeta: srcMsg?.planMeta,
      planView: "summary",
      planFromId: messageId,
    });
    setExtraStops((prev) => ({ ...prev, [sumId]: extraStops[messageId] ?? [] }));
    if (fuelOverride[messageId] != null) {
      setFuelOverride((prev) => ({ ...prev, [sumId]: fuelOverride[messageId] }));
    }
    if (selectedLodging[messageId]) {
      setSelectedLodging((prev) => ({ ...prev, [sumId]: selectedLodging[messageId] }));
    }

    // การ์ดสรุปคือตัวแทนการ์ดแพลนแล้ว → ซ่อนการ์ดแพลนเดิม (ไม่ให้เห็นเนื้อหาซ้ำ)
    // → ถ้าผู้ใช้กด "แก้ไขแพลน" จะคืนการ์ดแพลนนี้กลับมาให้แก้ต่อ
    updateMessage(threadId, messageId, { plan: undefined });
  };

  /**
   * กด "แก้ไขแพลน" ในการ์ดสรุป → ซ่อนการ์ดสรุป + คืนการ์ดแพลนเดิมกลับมา
   */
  const handleBackToEditPlan = (summaryId: string) => {
    const msg = thread?.messages.find((m) => m.id === summaryId);
    const fromId = msg?.planFromId;
    const plan = msg?.plan;

    // ซ่อนการ์ดสรุป (ข้อความว่าง → ไม่วาดฟอง)
    updateMessage(threadId, summaryId, {
      plan: undefined,
      planView: undefined,
      planFromId: undefined,
      content: "",
    });
    // คืนการ์ดแพลนที่ผู้ใช้จัดลำดับไว้ กลับไปแก้ต่อได้
    if (fromId && plan) {
      updateMessage(threadId, fromId, { plan, planView: "staged" });
    }
  };

  /** เมื่อผู้ใช้เลือกโฟลเดอร์จาก TripDestinationPickerModal */
  const handlePickerSelectFolder = (folderId: string) => {
    setAttachedFolderId(folderId);
    setShowDestinationPicker(false);
    if (pendingPlanMessageId) {
      const targetId = pendingPlanMessageId;
      setTimeout(() => {
        void handleCreatePlan(targetId);
      }, 350);
    }
  };

  /** เมื่อผู้ใช้เลือกสถานที่จาก TripDestinationPickerModal (จากการค้นหา หรือ AI จัดทริปให้) */
  const handlePickerSelectStops = async (stops: TripExtraStop[]) => {
    setShowDestinationPicker(false);
    if (!pendingPlanMessageId || stops.length === 0) return;
    const targetId = pendingPlanMessageId;

    // บันทึกสถานที่ลงใน extraStops ของข้อความนี้
    setExtraStops((prev) => ({
      ...prev,
      [targetId]: [...(prev[targetId] ?? []), ...stops],
    }));

    const rawSlots = draftSlotsRef.current;
    const slots: TripSlots = {
      ...rawSlots,
      startPoint: rawSlots.startPoint?.coords
        ? rawSlots.startPoint
        : rawSlots.startPoint?.label
        ? { label: rawSlots.startPoint.label, coords: { lat: 18.7883, lng: 98.9853 } }
        : { label: "เชียงใหม่ (จุดเริ่มต้น)", coords: { lat: 18.7883, lng: 98.9853 } },
      returnMode: rawSlots.returnMode ?? "same_as_start",
      budgetPerPerson: rawSlots.budgetPerPerson ?? 3000,
      startTime: rawSlots.startTime ?? "08:00",
    };

    setPlanning(true);
    try {
      const plan = await runPlan(
        targetId,
        buildPlanRequest(slots, {
          extraStops: stops,
          fuelPriceOverride: fuelOverride[targetId] ?? null,
        })
      );
      if (plan) {
        clearDraftCards();
        setEditingPlanMessageId(null);
        appendPlanSummaryMessage(plan);
      }
    } finally {
      setPlanning(false);
    }
  };

  /**
   * ผู้ใช้ระบุรถตอนสรุปค่าใช้จ่าย (การ์ดแผน) → คำนวณแผนใหม่
   * ค่าน้ำมัน/ค่าไฟในแผนจะเปลี่ยนตามรถที่เลือก
   */
  const handleVehicleChange = async (
    messageId: string,
    plan: TripPlan,
    vehicle: string,
    vehicleModel: string | null
  ) => {
    setVehicleSpecified((prev) => ({ ...prev, [messageId]: true }));
    /**
     * หน่วยของราคาพลังงานต่างกัน: รถไฟฟ้า = บาท/kWh · รถน้ำมัน = บาท/ลิตร
     * → ถ้าผู้ใช้เคยกรอกราคาไฟแล้วสลับกลับไปใช้รถน้ำมัน ค่านั้นใช้ไม่ได้
     *   (และกลับกัน) → ล้างทิ้ง ให้ระบบใช้ค่าประมาณการของหน่วยที่ถูกต้อง
     */
    const wasEv =
      plan.vehicle?.key === "ev" || plan.vehicle?.fuelType === "electric";
    const isEv = vehicle === "ev";
    const prevOverride = fuelOverride[messageId] ?? null;
    const nextOverride = wasEv !== isEv ? null : prevOverride;
    if (nextOverride !== prevOverride) {
      setFuelOverride((prev) => ({ ...prev, [messageId]: nextOverride }));
    }
    await runPlan(
      messageId,
      buildPlanRequest(
        {
          ...slotsFromPlan(plan),
          vehicle,
          vehicleModel,
          // รถไฟฟ้า → บอก backend ให้คิดเป็นค่าไฟ (ไม่ใช่ค่าน้ำมัน)
          fuelType: vehicle === "ev" ? "electric" : null,
        },
        {
          selectedStops: collectSelectedStops(plan.days),
          extraStops: extraStops[messageId] ?? [],
          fuelPriceOverride: nextOverride,
        }
      )
    );
  };

  /** ผู้ใช้ระบุจำนวนผู้เดินทางตอนสรุปค่าใช้จ่าย → คำนวณแผนใหม่ (ต่อคนเปลี่ยนตาม) */
  const handleTravelersChange = async (
    messageId: string,
    plan: TripPlan,
    travelers: number
  ) => {
    await runPlan(
      messageId,
      buildPlanRequest(
        { ...slotsFromPlan(plan), travelers },
        {
          selectedStops: collectSelectedStops(plan.days),
          extraStops: extraStops[messageId] ?? [],
          fuelPriceOverride: fuelOverride[messageId] ?? null,
        }
      )
    );
  };

  /** ลบจุดแวะ → คำนวณเส้นทาง/เวลา/ค่าน้ำมันใหม่ */
  const handleRemoveStop = async (
    messageId: string,
    plan: TripPlan,
    stopId: string
  ) => {
    const nextDays = (plan.days ?? []).map((d) => ({
      ...d,
      stops: (d.stops ?? []).filter((s) => s.id !== stopId),
    }));
    await runPlan(
      messageId,
      buildPlanRequest(slotsFromPlan(plan), {
        selectedStops: collectSelectedStops(nextDays),
        extraStops: extraStops[messageId] ?? [],
        fuelPriceOverride: fuelOverride[messageId] ?? null,
      })
    );
  };

  /** ขยับจุดแวะขึ้น/ลงภายในวันเดียวกัน (ระบบจะไม่สลับลำดับกลับเอง) */
  const handleMoveStop = async (
    messageId: string,
    plan: TripPlan,
    stopId: string,
    dir: -1 | 1
  ) => {
    const nextDays = (plan.days ?? []).map((d) => {
      const list = d.stops ?? [];
      const idx = list.findIndex((s) => s.id === stopId);
      if (idx < 0) return d;
      const target = idx + dir;
      if (target < 0 || target >= list.length) return d;
      const stops = [...list];
      const moved = stops[idx];
      if (!moved) return d;
      stops.splice(idx, 1);
      stops.splice(target, 0, moved);
      return { ...d, stops };
    });
    await runPlan(
      messageId,
      buildPlanRequest(slotsFromPlan(plan), {
        selectedStops: collectSelectedStops(nextDays),
        extraStops: extraStops[messageId] ?? [],
        fuelPriceOverride: fuelOverride[messageId] ?? null,
      })
    );
  };

  /** ผู้ใช้พิมพ์ราคาน้ำมันเอง → คำนวณใหม่ (ราคาที่ระบุเองชนะราคาสดเสมอ) */
  const handleFuelOverride = async (
    messageId: string,
    plan: TripPlan,
    price: number | null
  ) => {
    setFuelOverride((prev) => ({ ...prev, [messageId]: price }));
    await runPlan(
      messageId,
      buildPlanRequest(slotsFromPlan(plan), {
        selectedStops: collectSelectedStops(plan.days),
        extraStops: extraStops[messageId] ?? [],
        fuelPriceOverride: price,
      })
    );
  };

  /** เลือกที่พักที่ระบบเสนอ → ให้วันแรกจบที่ที่พักนั้น */
  const handleSelectLodging = async (
    messageId: string,
    plan: TripPlan,
    lodging: TripPlanLodging
  ) => {
    setSelectedLodging((prev) => ({ ...prev, [messageId]: lodging.name }));
    const slots = slotsFromPlan(plan);
    const dayEnds = [...(slots.dayEndPoints ?? [])];
    dayEnds[0] = {
      label: lodging.name,
      address: lodging.address ?? null,
      coords: lodging.coordinates ?? null,
    };
    await runPlan(
      messageId,
      buildPlanRequest(
        { ...slots, dayEndPoints: dayEnds },
        {
          selectedStops: collectSelectedStops(plan.days),
          extraStops: extraStops[messageId] ?? [],
          fuelPriceOverride: fuelOverride[messageId] ?? null,
        }
      )
    );
  };

  /** เปิดรายการจุดใกล้เคียง (ระบบเสนอ — ผู้ใช้ต้องกดเพิ่มเอง และระบุวันได้) */
  const openNearby = async (messageId: string, plan: TripPlan, targetDayIndex = 0) => {
    setNearbyMessageId(messageId);
    setNearbyTargetDay(targetDayIndex);
    setNearbyOpen(true);
    setNearbyLoading(true);
    setNearby([]);
    try {
      const day = plan.days?.[targetDayIndex] ?? plan.days?.[0];
      const stops = day?.stops ?? [];
      const lastStop = stops[stops.length - 1];
      const nearPoint =
        lastStop?.coordinates ?? plan.endPoint?.coords ?? plan.startPoint?.coords;
      if (!nearPoint) return;
      const routePoints = (day?.legs ?? []).flatMap((l) => l.geometry ?? []);
      const excludeIds = (plan.days ?? []).flatMap((d) =>
        (d.stops ?? []).map((s) => s.id)
      );
      const list = await fetchNearbySuggestions({
        near: {
          label: lastStop?.name ?? plan.endPoint?.label ?? "จุดใกล้เคียง",
          coords: { lat: nearPoint.lat, lng: nearPoint.lng },
        },
        radiusKm: 15,
        limit: 8,
        routePoints,
        excludeIds,
      });
      setNearby(list);
    } catch (err) {
      const aiErr = asAiError(err);
      Alert.alert(
        "หาจุดใกล้เคียงไม่สำเร็จ",
        aiErr?.message ?? "ลองใหม่อีกครั้ง"
      );
    } finally {
      setNearbyLoading(false);
    }
  };

  /** ผู้ใช้กดเพิ่มจุดใกล้เคียง → คำนวณแผนใหม่ (ใส่ในวันที่เลือก + อัปเดต route แบบ real-time) */
  const addNearbyStop = async (messageId: string, place: NearbyPlace) => {
    const current = extraStops[messageId] ?? [];
    const next = [
      ...current,
      {
        label: place.name,
        address: place.address ?? null,
        coords: { lat: place.coordinates.lat, lng: place.coordinates.lng },
        price: place.price ?? null,
        openingHours: place.openingHours ?? null,
        phone: place.phone ?? null,
        website: place.website ?? null,
      },
    ];
    setExtraStops((prev) => ({ ...prev, [messageId]: next }));
    setNearbyOpen(false);
    const plan = thread?.messages.find((m) => m.id === messageId)?.plan;
    if (!plan) return;
    const existingStops = collectSelectedStops(plan.days);
    const targetDayNumber = (nearbyTargetDay ?? 0) + 1;
    const updatedSelectedStops = [
      ...existingStops,
      { name: place.name, day: targetDayNumber },
    ];
    await runPlan(
      messageId,
      buildPlanRequest(slotsFromPlan(plan), {
        selectedStops: updatedSelectedStops,
        extraStops: next,
        fuelPriceOverride: fuelOverride[messageId] ?? null,
      })
    );
  };

  /** แปลงแพลนที่คำนวณแล้ว → ไทม์ไลน์ที่หน้าทริปใช้แสดง */
  const toItinerary = (plan: TripPlan): ItineraryDay[] =>
    (plan.days ?? []).map((d) => ({
      day: d.day,
      date: d.date,
      title: d.title,
      theme: d.theme,
      startPoint: d.startPoint,
      endPoint: d.endPoint,
      endPointType: d.endPointType,
      legs: d.legs,
      totalKm: d.totalKm,
      totalDriveMinutes: d.totalDriveMinutes,
      fuelCost: d.fuelCost,
      warnings: d.warnings,
      stops: (d.stops ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        activity: s.activity ?? "",
        stayHours: s.stayHours ?? 1,
        driveToNextMins: s.driveToNextMins ?? 0,
        type: (s.type as StopType) ?? "attraction",
        estimatedCost: s.estimatedCost ?? undefined,
        verified: s.verified,
        note: s.note ?? undefined,
        coordinates: s.coordinates,
        arriveTime: s.arriveTime,
        leaveTime: s.leaveTime,
        openHours: s.openHours,
        distanceFromPrevKm: s.distanceFromPrevKm,
        booking: s.booking,
        issues: s.issues,
      })),
    }));

  /** แปลงคำตอบของเอไaiที่เป็นข้อความอิสระ → สไตล์ทริปที่ระบบรู้จัก */
  const styleKey = (raw?: string | null): Trip["style"] => {
    const s = (raw ?? "").toLowerCase();
    if (s.includes("slow") || s.includes("สโลว์") || s.includes("คราฟต์")) return "slowlife";
    if (s.includes("culture") || s.includes("วัฒนธรรม") || s.includes("ชุมชน")) return "culture";
    if (s.includes("food") || s.includes("อาหาร") || s.includes("กิน")) return "foodie";
    return "nature";
  };

  /** ยืนยันและบันทึกแพลน → เข้าแท็บ "ทริปที่แพลนไว้" */
  const handleConfirmPlan = async (messageId: string, plan: TripPlan) => {
    setPlanning(true);
    try {
      // แผนที่ยืนยันไปแล้วในข้อความนี้ → อัปเดตทับแถวเดิม (ไม่สร้างแผนซ้ำ)
      const existingPlanId =
        thread?.messages.find((m) => m.id === messageId)?.planMeta?.planId ?? null;
      const result = await generateTripPlan(
        {
          ...buildPlanRequest(slotsFromPlan(plan), {
            selectedStops: collectSelectedStops(plan.days),
            extraStops: extraStops[messageId] ?? [],
            fuelPriceOverride: fuelOverride[messageId] ?? null,
            save: true,
          }),
          planId: existingPlanId,
        },
        { token: session?.access_token ?? null }
      );
      const saved = result.plan;
      const planId = result.planId ?? currentPlanId ?? newPlanId();
      setCurrentPlanId(planId);
      const threadTitle =
        thread?.title && thread.title !== "แชทใหม่" ? thread.title : "ทริปจากน้องโลคอล";
      const savedDays = saved.days ?? [];
      const trip = createOrUpdateTripFromPlan({
        planId,
        title: saved.title || threadTitle,
        summary: saved.summary || "",
        status: "planned",
        startPoint: saved.startPoint?.label ?? "จุดเริ่มต้น",
        startPointCoords: saved.startPoint?.coords ?? undefined,
        startTime: saved.startTime ?? "08:00",
        destinations: savedDays.flatMap((d) => (d.stops ?? []).map((s) => s.name)),
        days: savedDays.length || 1,
        nights: Math.max(0, savedDays.length - 1),
        budgetPerPerson: saved.budgetPerPerson ?? saved.budget?.perPerson ?? 3000,
        travelers: saved.travelers ?? draftSlots.travelers ?? 1,
        style: styleKey(saved.style),
        itinerary: toItinerary(saved),
        budget: {
          lodging: saved.budget?.lodging ?? 0,
          fuel: saved.budget?.fuel ?? 0,
          food: saved.budget?.food ?? 0,
          activities: saved.budget?.activities ?? 0,
          other: saved.budget?.other ?? 0,
          total: saved.budget?.total ?? 0,
          perPerson: saved.budget?.perPerson ?? 0,
          withinBudget: saved.budget?.withinBudget !== false,
        },
        sourceFolderId: folder?.id,
        returnMode: saved.returnMode,
        endPoint: saved.endPoint?.label,
        endPointCoords: saved.endPoint?.coords ?? undefined,
        vehicle: saved.vehicle,
        fuel: saved.fuel,
        lodging: saved.lodgingSuggestions,
        warnings: saved.warnings,
        assumptions: saved.assumptions,
        routeSource: saved.routeSource,
        routeCredit: saved.routeCredit,
      });
      // backend บันทึกครั้งแรกไว้เป็น "ดราฟ" (คอลัมน์ของ DB ไม่ใช่สถานะของแอป)
      // → เขียนสถานะของแอปกลับ ถ้าไม่เขียน พอปิดแอปแล้วเปิดใหม่แผนจะตกไปอยู่แท็บ "ดราฟ"
      if (result.planId) {
        void updateMyTripPlan(result.planId, { appStatus: "planned" });
      }
      updateMessage(threadId, messageId, {
        plan: saved,
        planMeta: {
          ...(thread?.messages.find((m) => m.id === messageId)?.planMeta ?? {}),
          planId,
        },
      });
      if (result.persisted === false) {
        Alert.alert(
          "บันทึกไม่สำเร็จ",
          result.persistReason ??
            "แพลนยังอยู่ในเครื่องนี้ — ถ้าปิดแอปอาจไม่เห็นแพลนอีก"
        );
      }
      if (onOpenTrip) onOpenTrip(trip.id);
    } catch (err) {
      const aiErr = asAiError(err);
      Alert.alert("บันทึกแพลนไม่สำเร็จ", aiErr?.message ?? "ลองใหม่อีกครั้ง");
    } finally {
      setPlanning(false);
    }
  };

  /** กด "แก้ไขกับเอไai" → ส่งแผนเดิมกลับไปให้เอไaiแก้ (รอบใหม่จะอัปเดตแผนเดิม) */
  const handleEditWithAi = (messageId: string, plan: TripPlan) => {
    setEditingPlanMessageId(messageId);
    void send("ช่วยปรับแผนทริปนี้ให้ตามที่ฉันบอก", { planContext: plan });
  };

  const send = async (
    text: string,
    opts?: {
      placeId?: string;
      placeName?: string;
      placeLabel?: string;
      /** คลิปที่แนบไปกับข้อความนี้ (แสดงเป็นวิดีโอในแชท) */
      video?: VideoPost | null;
      /** ข้อความแรกของแชทที่มาจากคลิป → ให้ backend ค้นข้อมูลสถานที่ของคลิปให้ตรงแห่ง */
      useClipPlace?: boolean;
      /** แผนที่กำลังแก้อยู่ → ส่งไปให้เอไaiรู้บริบท (กด "แก้ไขกับเอไai") */
      planContext?: unknown;
      /** ช่องข้อมูลแผนทริปที่จะส่งไปเป็นรอบนี้ (สำหรับกรณีที่เพิ่งได้ค่าใหม่ แต่ state ยังไม่ทันอัปเดต) */
      tripDraftOverride?: TripSlots;
      /** ข้ามการเปิดป๊อปอัปเลือกสไตล์ (ใช้ตอนผู้ใช้กด "ยกเลิก" ในป๊อปอัปเอง) */
      skipDiscovery?: boolean;
      /** ผู้ใช้เลือก "ถามเป็นแชทธรรมดาแทน" → บอก backend ว่าไม่มีการ์ดสถานที่จะขึ้น */
      discoveryDismissed?: boolean;
    }
  ) => {
    const body = text.trim();
    if (!body || !thread || sendingRef.current) return;

    // เจตนาของคำถาม → "อยากเที่ยว" = อยากได้คำแนะนำสถานที่ (ไม่ต้องพิมพ์ "แนะนำที่เที่ยว" ให้ตรงเป๊ะ)
    const intent = detectChatIntent(body);

    // คำถามแบบ "อยากรู้ว่ามีที่ไหนน่าเที่ยว" → เปิดป๊อปอัปเลือกสไตล์ก่อนตอบ
    // · โหมด "ถามเกี่ยวกับธุรกิจ" · ถามต่อจากสถานที่ที่เลือก · แก้แผน → ไม่เปิด
    const canOfferDiscovery =
      !opts?.skipDiscovery &&
      chatMode !== "host-self" &&
      !opts?.placeId &&
      !opts?.planContext &&
      !opts?.useClipPlace;
    if (canOfferDiscovery && intent === "places") {
      void startDiscovery(body);
      return;
    }

    // ช่องข้อมูลแผนทริปที่จะส่งไปรอบนี้ (ค่าที่เพิ่งได้ใหม่ ถ้ามี → ใช้ค่านั้น)
    const slotsForRequest = opts?.tripDraftOverride ?? draftSlots;

    // โฟลเดอร์ที่แนบ → เก็บเป็น "ออบเจกต์" ในข้อความ ไม่ใช่แปะเป็นข้อความ
    // → ผู้ใช้กดการ์ดโฟลเดอร์ในแชทแล้วเข้าไปดูคลิปข้างในได้ (ข้อ 2.2)
    // การ์ดโฟลเดอร์โผล่ครั้งเดียวต่อการแนบ (ไม่ใช่ทุกข้อความ)
    //   แต่โฟลเดอร์ยัง "ติดอยู่" ตลอดเธอร์ → backend ได้บริบทโฟลเดอร์ทุกข้อความ
    const shouldAnnounceFolder = !!attachedFolder && announcedFolderRef.current !== attachedFolder.id;
    const folderAttachment =
      shouldAnnounceFolder && attachedFolder
        ? {
            id: attachedFolder.id,
            name: attachedFolder.name,
            clipCount: attachedFolder.videoIds.length,
          }
        : undefined;
    if (attachedFolder) announcedFolderRef.current = attachedFolder.id;
    // ฝั่งที่ส่งให้โมเดล → บอกโมเดลว่าคลิปมาจากโฟลเดอร์ไหน (โมเดลต้องรู้)
    // บรรทัดนี้ผูกกับ "ข้อความที่แนบโฟลเดอร์" → เวลาส่งรอบถัดไป ประวัติที่ประกอบกลับ
    //   จะเติมบรรทัดเดียวกันให้เอง (ดูโค้ด history ด้านล่าง) → ตรงกันเสมอ
    const aiFolderLine = folderAttachment
      ? `📁 แนบโฟลเดอร์ "${folderAttachment.name}" (${folderAttachment.clipCount} คลิป)\n`
      : "";
    // ผู้ใช้เลือกสถานที่จากรายการ → บอกโมเดลด้วยว่าเลือกอันไหน (คำถามเดิมยังอยู่ข้างบน)
    const selectionNote = opts?.placeLabel ? `\n📍 เลือกสถานที่: ${opts.placeLabel}` : "";

    // เจตนา "อยากไปเที่ยว" → แนบบรรทัดให้โมเดลรู้ว่าต้องการแนะนำสถานที่
    // (ฝั่งแอปล้วน ไม่แตะ prompt ฝั่ง backend · ผู้ใช้ไม่เห็นบรรทัดนี้)
    const intentNote = intent === "places" ? INTENT_NOTE_PLACES : undefined;

    appendMessage(threadId, {
      role: "user",
      content: body + selectionNote,
      video: opts?.video ?? undefined,
      folder: folderAttachment,
      aiNote: intentNote,
    });
    setDraft("");
    sendingRef.current = true;
    setSending(true);
    // ผู้ใช้ส่งข้อความ → ต้องเห็นข้อความตัวเอง → เลื่อนลงล่าง
    // แบบ "ไม่มีแอนิเมชัน" เพราะการเลื่อนแบบแอนิเมชันจะไปแย่งนิ้วผู้ใช้
    // (เคยเจอจริง: ลิสต์ขยับตอนกดชิปในการ์ด → ทั้งแอปกดไม่ได้)
    nearBottomRef.current = true;
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);

    // If the user typed or pasted a Google Maps URL, pre-parse it so AI understands immediately
    let processedForAi = aiFolderLine + body + selectionNote;
    const gmapsMatch = body.match(/https?:\/\/(?:maps\.app\.goo\.gl\/[^\s]+|www\.google\.com\/maps[^\s]+)/i);
    if (gmapsMatch) {
      const url = gmapsMatch[0];
      let parsed = parseGoogleMapsUrl(url);
      // ลิงก์สั้น/ลิงก์ที่มีแต่ชื่อ → แอปอ่าน redirect ไม่ได้ ให้ backend ช่วยหาพิกัด
      if (!parsed.lat || !parsed.lng) {
        const resolved = await resolvePlaceCoords({ url });
        if (resolved) {
          parsed = { ...parsed, lat: resolved.lat, lng: resolved.lng };
        }
      }
      if (parsed.lat && parsed.lng) {
        processedForAi = `${aiFolderLine + body + selectionNote}\n[ข้อมูลพิกัดจากลิงก์: ละติจูด ${parsed.lat.toFixed(4)}, ลองจิจูด ${parsed.lng.toFixed(4)}]`;
      } else {
        processedForAi = `${aiFolderLine + body + selectionNote}\n[หมายเหตุ: ลิงก์จุดเริ่มต้นการเดินทางของผู้ใช้ ให้เริ่มวางแผนจากจุดนี้ได้ทันที ไม่ต้องกดเปิดลิงก์ภายนอก]`;
      }
    }
    // เจตนา "อยากเที่ยว" → บอกโมเดลให้รู้ว่าต้องการแนะนำสถานที่ (บรรทัดเดียว ท้ายข้อความ)
    if (intentNote) processedForAi = `${processedForAi}\n${intentNote}`;

    // ประวัติที่ส่งให้โมเดล → ข้อความที่แนบโฟลเดอร์ ต้องเติมบรรทัดโฟลเดอร์กลับเข้าไป
    // (ในแชทที่เห็นเป็นการ์ดโฟลเดอร์ แต่โมเดลต้องรู้ว่าคลิปมาจากโฟลเดอร์ไหน)
    // · aiNote = บริบทที่ผู้ใช้ไม่เห็นแต่โมเดลต้องรู้ (เจตนา · สถานที่ที่เลือก)
    const history = [
      ...thread.messages.map((m) => ({
        role: m.role,
        content: historyContentOf(m),
      })),
      {
        role: "user" as const,
        content: processedForAi,
      },
    ];

    // บริบทโฟลเดอร์ — ส่งรหัสโฟลเดอร์ไปให้ backend อ่านข้อมูลจริงเอง
    // (ถ้าโหลดไม่ได้ ค่อยส่งชื่อสถานที่ดิบไปเป็นทางสำรอง)
    let folderCtxPayload: { folderName: string; places: string[] } | undefined;
    if (folder) {
      const places = folderCtx?.places.map((p) => p.name) ?? [];
      folderCtxPayload = { folderName: folder.name, places };
    }

    try {
      const result = await sendChat(history, {
        folder: folderCtxPayload,
        // ส่งรหัสโฟลเดอร์ → backend โหลดคลิปจริง + จับคู่ทะเบียนสถานที่เอง
        folderId: folder?.id ?? null,
        mode: chatMode,
        // ส่ง token ทุกครั้งที่มี session (backend ใช้ตรวจสิทธิ์เจ้าของโฟลเดอร์)
        token: session?.access_token ?? undefined,
        // ชุมชนของผู้ใช้เอง → ให้ backend ดึงสถานที่ในชุมชนนั้นมาตอบ (D22)
        communityId: user?.community_id ?? null,
        // ผู้ใช้เลือกสถานที่จากรายการ (ชื่อซ้ำ) → ดึงรายละเอียดของอันนั้นตรง ๆ
        placeId: opts?.placeId ?? null,
        // ข้อความแรกของแชทที่มาจากคลิป → ใช้ชื่อสถานที่ในคลิปค้นข้อมูลให้ตรงแห่ง
        // (ข้อความถัดไปไม่ยกชื่อนี้ขึ้นมา ผู้ใช้จะได้ถามสถานที่อื่นได้ตามปกติ)
        placeName: opts?.placeName ?? (opts?.useClipPlace ? clipPlaceName : null),
        // บริบทคลิป → backend แทรกใน system prompt ให้โมเดลยึดข้อมูลคลิปเป็นหลัก
        clipContext,
        // ช่องข้อมูลแผนทริปที่สะสมไว้ → backend merge กับที่โมเดลสกัดใหม่
        // (แอปเก็บช่วงวันที่เป็น startDate/endDate แต่ backend รู้จักแค่ date+days
        //  → แปลงตรงจุดส่ง ด้วย slotsToWire)
        tripDraft:
          Object.keys(slotsForRequest).length > 0
            ? slotsToWire(slotsForRequest)
            : null,
        // แผนที่กำลังแก้ → backend แทรกลง system prompt ให้เอไaiอ้างอิงได้
        planContext: opts?.planContext ?? null,
        // ผู้ใช้กด "ยกเลิก" ในป๊อปอัปเลือกสไตล์ → บอก backend ว่าไม่มีการ์ดจะขึ้น
        // (ไม่งั้นโมเดลจะตอบว่า "เลือกในการ์ดด้านล่าง" ทั้งที่ไม่มีการ์ด)
        discoveryDismissed: opts?.discoveryDismissed ?? false,
      });
      // เอไaiสกัดช่องข้อมูลได้ → รวมกับที่ผู้ใช้เคยกรอก (ค่าที่โมเดลไม่รู้จะไม่ทับของเดิม
      // และพิกัดที่ผู้ใช้เลือกเองจะไม่หาย)
      // ── สำคัญ: รวมกับ "ค่าล่าสุด" ไม่ใช่ค่าตอนส่งข้อความ ──
      //   ระหว่างที่รอเอไaiตอบ (10–30 วิ) ผู้ใช้กดแก้การ์ดไปได้หลายครั้ง
      //   ถ้าเอา "ค่าตอนส่ง" มารวมทับ → ค่าที่ผู้ใช้เพิ่งแก้หายไป
      //   (base = ค่าตอนส่ง → เทียบว่าผู้ใช้แก้ช่องไหนหลังส่ง → ช่องนั้นผู้ใช้ชนะ)
      const mergedSlots = result.tripDraft
        ? mergeSlots(draftSlotsRef.current, result.tripDraft.slots, slotsForRequest)
        : null;
      if (mergedSlots) applyDraftSlots(mergedSlots);
      // ผู้ใช้ส่งแผนเดิมกลับมาให้เอไaiแก้ (จากหน้าแผนทริป) → ผูกการ์ดใหม่นี้เข้ากับแถวเดิม
      // → กดยืนยันแล้วจะอัปเดตทับแถวเดิม ไม่สร้างแผนซ้ำ
      const linkedPlanId =
        (opts?.planContext as any)?.planId ??
        (opts?.planContext as any)?.planMeta?.planId ??
        null;
      // มีรายการสถานที่ชื่อซ้ำ → แนบไว้ในข้อความเพื่อให้ผู้ใช้เลือกได้
      appendMessage(threadId, {
        role: "assistant",
        content: result.reply,
        placeCandidates: result.placeCandidates,
        planMeta: linkedPlanId ? { planId: linkedPlanId } : undefined,
        // แท็กประเภทสถานที่ (OTOP / ท่องเที่ยวทั่วไป) + หมวดหมู่ + ลิงก์แหล่งที่มา
        // tagPlace = ชื่อที่จะติดแท็ก (มีเฉพาะตอนที่คำตอบเอ่ยชื่อนี้จริง)
        placeTag: result.placeTag,
        tags: result.tags,
        tagPlace: result.tagPlace,
        placeTags: result.placeTags,
        sources: result.sources,
        tripDraft: mergedSlots
          ? {
              slots: mergedSlots,
              missing: computeTripMissing(mergedSlots),
              planReady: isTripPlanReady(mergedSlots),
            }
          : undefined,
      });

      if (result.showFolderPicker) {
        setPickerOpen(true);
      }
      // โฟลเดอร์ไม่ถูกถอดออกหลังส่งแล้ว → ยัง "ติดอยู่" ตลอดเธอร์
      //   → ข้อความถัดไปยังได้บริบทโฟลเดอร์ไปให้ backend ทุกครั้ง (ข้อ 2.3)
      //   → ผู้ใช้ถอดเองได้ด้วยปุ่ม X บนชิปโฟลเดอร์ในช่องพิมพ์
    } catch (err) {
      // Previously this fell through and appended the failure as an assistant
      // message, so a 401 looked exactly like a real answer. Mark it instead.
      const aiErr = asAiError(err);
      const detail = aiErr
        ? `${aiErr.message}\n\n(${aiErr.status !== null ? `HTTP ${aiErr.status} · ` : ""}${aiErr.requestId ? `req ${aiErr.requestId} · ` : ""}${Math.round(aiErr.durationMs)}ms)`
        : "ส่งข้อความไม่สำเร็จ";
      console.warn("[aiChat] FAIL", detail);
      appendMessage(threadId, { role: "assistant", content: detail, isError: true });
    } finally {
      // Without this, any throw above wedged `sending` on forever and the
      // composer could never be used again without remounting the screen.
      sendingRef.current = false;
      setSending(false);
      // ไม่เลื่อนที่นี่ — ตอนคำตอบของเอไaiมา ขนาดเนื้อหาในลิสต์เปลี่ยนเอง
      // → handleContentSizeChange จะเลื่อนให้เอง (แบบไม่มีแอนิเมชัน)
    }
  };

  // ── เส้นทาง "ถามแนะนำสถานที่" (ประเภท D) ─────────────────────────
  /** ประวัติแชทย่อ (สำหรับเส้นทาง /ai-chat/discovery) */
  const buildDiscoveryHistory = (question: string) => [
    ...(thread?.messages ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: question },
  ];

  /**
   * เปิดป๊อปอัปเลือกแท็ก
   * -------------------------------------------------------------
   * · ครั้งแรก = คำถามใหม่ที่ผู้ใช้พิมพ์
   * · ครั้งหลัง = กด "เปลี่ยนแท็ก" (ส่ง id ข้อความเดิมมาให้แทนที่)
   */
  const startDiscovery = async (question: string, replaceMessageId?: string) => {
    discoveryQuestionRef.current = question;
    discoveryReplaceIdRef.current = replaceMessageId ?? null;
    discoveryPickedRef.current = false;
    setDiscoveryQuestion(question);
    // โชว์คลังแท็กสำรองทันที (ผู้ใช้เลือกได้เลย ไม่ต้องรอ) → คลังจาก backend ค่อยทับเมื่อมา
    setDiscoveryTags(FALLBACK_DISCOVERY_TAGS);
    setDiscoveryTagsLoading(true);
    setStylePickerOpen(true);
    // เคลียร์ช่องพิมพ์ (คำถามจะไปโผล่ในแชทตอนผู้ใช้ยืนยันแท็ก)
    setDraft("");
    const tags = await requestDiscoveryTags({
      messages: buildDiscoveryHistory(question),
    });
    // ผู้ใช้ยืนยันไปแล้ว → ไม่ทับรายการที่เขากำลังดู
    setDiscoveryTagsLoading(false);
    if (discoveryPickedRef.current) return;
    setDiscoveryTags(tags);
  };

  /**
   * ดึงการ์ดสถานที่แล้วผนวกเข้าแชท
   * -------------------------------------------------------------
   * · `tags` = แท็กที่ผู้ใช้ยืนยัน · ไม่ส่ง `tags` + `aiPicks` = ให้เอไaiเลือกเอง
   * · `replaceId` = แทนการ์ดในข้อความเดิม (กด "เปลี่ยนแท็ก")
   * · `keepCards` = การ์ดที่ต้องเก็บไว้ (ใบที่ผู้ใช้ติ๊กไว้ตอนรีเฟช)
   * · `excludePlaceIds` / `excludeNames` = สถานที่ที่เคยได้แล้ว (ห้ามย้ำ)
   */
  const runDiscovery = async (opts: {
    tags?: DiscoveryStyle[];
    aiPicks?: boolean;
    replaceId?: string | null;
    excludePlaceIds?: string[];
    excludeNames?: string[];
    keepCards?: DiscoveryCard[];
  }) => {
    const question = discoveryQuestionRef.current;
    const replaceId = opts.replaceId ?? discoveryReplaceIdRef.current ?? null;
    if (!question.trim()) return;
    discoveryPickedRef.current = true;
    setDiscoveryLoading(true);
    sendingRef.current = true;
    setSending(true);
    let fallbackQuestion: string | null = null;
    try {
      const result = await requestDiscoveryPlaces({
        messages: buildDiscoveryHistory(question),
        tags: opts.tags,
        aiPicks: opts.aiPicks,
        excludePlaceIds: opts.excludePlaceIds,
        excludeNames: opts.excludeNames,
      });
      setStylePickerOpen(false);
      const kept = opts.keepCards ?? [];
      const cards = [...kept, ...result.places];
      const usedTags = result.tags.length > 0 ? result.tags : (opts.tags ?? []);
      if (replaceId) {
        // เปลี่ยนแท็ก → แทนการ์ดชุดเดิมในข้อความเดิม
        const prevMsg = (thread?.messages ?? []).find((m) => m.id === replaceId);
        const seen = Array.from(
          new Set([
            ...(prevMsg?.discoverySeen ?? []),
            ...cards.map((c) => c.placeId),
          ])
        );
        const seenNames = Array.from(
          new Set([
            ...(prevMsg?.discoverySeenNames ?? []),
            ...cards.map((c) => c.name),
          ])
        );
        updateMessage(threadId, replaceId, {
          content: result.reply,
          placeCards: cards,
          discoveryTags: usedTags,
          discoveryStyle: usedTags[0],
          discoverySeen: seen,
          discoverySeenNames: seenNames,
        });
        setSelectedPlaceCards((prev) => {
          const next = { ...prev };
          // ใบที่ผู้ใช้ติ๊กไว้ยังติ๊กอยู่ · ใบใหม่ยังไม่ติ๊ก
          next[replaceId] = kept
            .map((c) => c.placeId)
            .filter((id) => (prev[replaceId] ?? []).includes(id));
          return next;
        });
      } else {
        appendMessage(threadId, { role: "user", content: question });
        appendMessage(threadId, {
          role: "assistant",
          content: result.reply,
          placeCards: cards,
          discoveryTags: usedTags,
          discoveryStyle: usedTags[0],
          discoverySeen: cards.map((c) => c.placeId),
          discoverySeenNames: cards.map((c) => c.name),
        });
      }
    } catch (err) {
      const aiErr = asAiError(err);
      setStylePickerOpen(false);
      Alert.alert(
        "หาสถานที่ไม่สำเร็จ",
        aiErr?.message ?? "เชื่อมต่อบริการแนะนำสถานที่ไม่สำเร็จ ลองใหม่อีกครั้ง"
      );
      // ถามเป็นแชทธรรมดาแทน (ผู้ใช้ไม่ค้างคิว)
      if (!replaceId) fallbackQuestion = question;
    } finally {
      setDiscoveryLoading(false);
      sendingRef.current = false;
      setSending(false);
    }
    if (fallbackQuestion) {
      void send(fallbackQuestion, { skipDiscovery: true, discoveryDismissed: true });
    }
  };

  /** ผู้ใช้ยืนยันแท็กที่เลือกในป๊อปอัป → ดึงการ์ดสถานที่จริงจาก Google */
  const handleDiscoveryConfirm = async (tags: DiscoveryStyle[]) => {
    if (!tags || tags.length === 0) return;
    await runDiscovery({ tags });
  };

  /** ผู้ใช้กด "ให้เอไaiคิดให้" → เอไaiเลือกแท็กเองจากคำถาม แล้วดึงการ์ดเลย */
  const handleDiscoveryAiPick = async () => {
    await runDiscovery({ aiPicks: true });
  };

  /**
   * รีเฟชการ์ดสถานที่ (ใช้แท็กเดิมเสมอ · ของใหม่ต้องไม่ซ้ำของเดิม)
   * -------------------------------------------------------------
   * · ใบที่ผู้ใช้ติ๊กไว้ → เก็บไว้ (ยังติ๊กอยู่)
   * · ที่เหลือ → แทนที่ด้วยของใหม่ที่ไม่ซ้ำ
   */
  const handleDiscoveryRefresh = async (messageId: string) => {
    const msg = (thread?.messages ?? []).find((m) => m.id === messageId);
    if (!msg) return;
    const tags = msg.discoveryTags ?? (msg.discoveryStyle ? [msg.discoveryStyle] : []);
    if (tags.length === 0) return;
    const question = questionBefore(messageId) || discoveryQuestionRef.current;
    if (!question.trim()) return;
    const cards = msg.placeCards ?? [];
    const seen = msg.discoverySeen ?? cards.map((c) => c.placeId);
    const seenNames = msg.discoverySeenNames ?? cards.map((c) => c.name);
    const picked = selectedPlaceCards[messageId] ?? [];
    const keepCards = cards.filter((c) => picked.includes(c.placeId));
    discoveryQuestionRef.current = question;
    setDiscoveryLoading(true);
    try {
      const result = await requestDiscoveryPlaces({
        messages: buildDiscoveryHistory(question),
        tags,
        excludePlaceIds: seen,
        excludeNames: seenNames,
      });
      if (result.places.length === 0) {
        Alert.alert(
          "ไม่มีที่ใหม่ในแท็กนี้แล้ว",
          "ลองเปลี่ยนแท็ก หรือกดค้นหาอีกครั้ง"
        );
        return;
      }
      const nextCards = [...keepCards, ...result.places];
      updateMessage(threadId, messageId, {
        placeCards: nextCards,
        discoveryTags: tags,
        discoverySeen: Array.from(
          new Set([...seen, ...result.places.map((p) => p.placeId)])
        ),
        discoverySeenNames: Array.from(
          new Set([...seenNames, ...result.places.map((p) => p.name)])
        ),
      });
      // ใบที่เก็บไว้ยังติ๊กอยู่ · ใบใหม่ยังไม่ติ๊ก
      setSelectedPlaceCards((prev) => ({
        ...prev,
        [messageId]: keepCards.map((c) => c.placeId),
      }));
    } catch (err) {
      const aiErr = asAiError(err);
      Alert.alert(
        "รีเฟชไม่สำเร็จ",
        aiErr?.message ?? "ลองใหม่อีกครั้ง"
      );
    } finally {
      setDiscoveryLoading(false);
    }
  };

  /** ผู้ใช้กดยกเลิก/ปิดป๊อปอัป */
  const handleDiscoveryCancel = () => {
    setStylePickerOpen(false);
    // กำลังดึงสถานที่อยู่ → ปิดไปก่อน การ์ดจะเข้าแชทเองเมื่อเสร็จ
    if (discoveryLoading) return;
    const replaceId = discoveryReplaceIdRef.current;
    const question = discoveryQuestionRef.current;
    // เปลี่ยนสไตล์ (คำถามเดิมอยู่ในแชทแล้ว) → ปิดไป การ์ดเดิมยังอยู่
    if (replaceId) return;
    if (!question.trim()) return;
    void send(question, { skipDiscovery: true, discoveryDismissed: true });
  };

  /** ติ๊ก/เอาออกสถานที่ในการ์ด (เก็บแยกต่อข้อความ) */
  const togglePlaceCard = (messageId: string, placeId: string) => {
    setSelectedPlaceCards((prev) => {
      const cur = prev[messageId] ?? [];
      const next = cur.includes(placeId)
        ? cur.filter((id) => id !== placeId)
        : [...cur, placeId];
      return { ...prev, [messageId]: next };
    });
  };

  /** คำถามของผู้ใช้ก่อนข้อความนี้ (ใช้ตอนกด "สถานที่อื่น / เปลี่ยนสไตล์") */
  const questionBefore = (messageId: string) => {
    const list = thread?.messages ?? [];
    const idx = list.findIndex((m) => m.id === messageId);
    const before = idx >= 0 ? list.slice(0, idx) : list;
    return [...before].reverse().find((m) => m.role === "user")?.content ?? "";
  };

  /** ป้ายสถานที่สั้น ๆ เช่น "บ้านปาย (ต.ป่าแดง อ.เมือง จ.เชียงใหม่)" */
  const placeLabelFor = (c: PlaceChoice) => {
    const loc = [c.subdistrict, c.district, c.province].filter(Boolean).join(" · ");
    return loc ? `${c.name} (${loc})` : c.name;
  };

  /**
   * ผู้ใช้แตะสถานที่ในรายการ (ชื่อซ้ำ) → ถามคำเดิมอีกครั้งพร้อม placeId
   * → backend ดึงรายละเอียดของอันที่เลือกตรง ๆ แล้วตอบใหม่ต่อท้าย
   */
  const handlePickPlace = (messageId: string, choice: PlaceChoice) => {
    if (!thread) return;
    const idx = thread.messages.findIndex((m) => m.id === messageId);
    const question = [...thread.messages.slice(0, idx < 0 ? undefined : idx)]
      .reverse()
      .find((m) => m.role === "user");
    const ask = (question?.content ?? "").trim();
    if (!ask) return;
    setChosenPlaces((prev) => ({ ...prev, [messageId]: choice.placeId }));
    void send(ask, {
      placeId: choice.placeId,
      placeName: choice.name,
      placeLabel: placeLabelFor(choice),
    });
  };

  /**
   * ปุ่ม "เส้นทางไปที่นี่" — เปิด Google Maps
   * มีจุดเริ่มต้นที่ผู้ใช้ตั้งไว้ → คำนวณเส้นทางให้ · ยังไม่มี → เปิดหน้าสถานที่
   */
  const openDirections = () => {
    if (!clipContext) return;
    const destLabel = [clipContext.placeName, clipContext.address]
      .filter(Boolean)
      .join(" ");
    const destCoords = parseCoords(clipContext.gps);
    const originCoords = currentOrigin?.coords;
    let url: string;
    if (originCoords) {
      const origin = `${originCoords.lat},${originCoords.lng}`;
      const destination = destCoords ?? destLabel;
      url =
        `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}` +
        `&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    } else if (destCoords) {
      url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        destCoords
      )}&travelmode=driving`;
    } else {
      url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destLabel)}`;
    }
    Linking.openURL(url).catch(() => undefined);
  };

  // Auto-send the seed message once (used when opened from the AI-summary
  // "คุยต่อกับ AI" button). Only fires on an empty thread.
  useEffect(() => {
    if (
      initialMessage &&
      initialMessage.trim() &&
      !autoSentRef.current &&
      thread &&
      thread.messages.length === 0
    ) {
      autoSentRef.current = true;
      // ข้อความแรก = คำถามจากคลิป → แนบคลิปเป็นวิดีโอ + ให้ backend ค้นข้อมูลสถานที่ของคลิป
      void send(initialMessage, {
        useClipPlace: true,
        video: clipVideo,
        planContext: initialPlanContext ?? undefined,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, thread]);

  const isEmpty = !thread || thread.messages.length === 0;

  /**
   * การ์ดข้อมูลแผนทริปโผล่ที่ข้อความที่เป็นเจ้าของ draft ที่ยังไม่ได้สร้างแพลน
   * หาจากข้อความแรกที่มี draft และยังไม่มี plan เพื่อให้การ์ดยึดอยู่กับข้อความเดิม ไม่เลื่อนตามข้อความใหม่
   */
  const activeDraftMessageId = (() => {
    const msgs = thread?.messages ?? [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m && m.tripDraft && !m.plan) return m.id;
    }
    return null;
  })();

  const lastDraftMessageId = activeDraftMessageId;

  /**
   * การ์ดช่องข้อมูลต้องโผล่ต่อเมื่อ "ยังไม่ได้สร้างแพลน" ของข้อความ draft
   */
  const showDraftCard = !!activeDraftMessageId;

  /**
   * คลิปของแต่ละจุดแวะในแผน (ข้อ 2.3)
   * -------------------------------------------------------------
   * จุดแวะที่มาจากโฟลเดอร์มี `id` = key ของสถานที่ในโฟลเดอร์
   * → จับคู่ด้วย id ก่อน ถ้าไม่ตรงจะ fallback ด้วยชื่อสถานที่
   * → ผู้ใช้เห็นคลิปของจุดนั้น → ตัดสินใจว่าจะลบ/เพิ่มจุดได้
   */
  const buildStopClips = (plan: TripPlan) => {
    type StopClip = {
      videoId: string;
      thumbnailUrl: string | null;
      caption: string | null;
    };
    const out: Record<string, StopClip[]> = {};
    const places = folderCtx?.places ?? [];
    const clipById = new Map((folderCtx?.clips ?? []).map((c) => [c.videoId, c]));
    const norm = (name?: string | null) =>
      (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    /** คลิปของสถานที่หนึ่งในโฟลเดอร์ */
    const clipsOf = (videoIds: string[]): StopClip[] =>
      videoIds
        .map((id) => clipById.get(id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .map((c) => ({
          videoId: c.videoId,
          thumbnailUrl: c.thumbnailUrl ?? null,
          caption: c.caption ?? null,
        }));

    const byName = new Map<string, StopClip[]>();
    for (const place of places) {
      const list = clipsOf(place.videoIds ?? []);
      if (list.length === 0) continue;
      out[place.key] = list;
      byName.set(norm(place.name), list);
    }
    // จุดแวะที่ id ไม่ตรงกับ key ของโฟลเดอร์ → จับคู่ด้วยชื่อแทน
    for (const day of plan.days ?? []) {
      for (const stop of day.stops ?? []) {
        if (out[stop.id]) continue;
        const list = byName.get(norm(stop.name));
        if (list) out[stop.id] = list;
      }
    }
    return out;
  };

  /** กดคลิปของจุดแวะในแผน → เปิดดูคลิปเต็มจอ (แบบหน้าโฮม) */
  const openClipFromStop = async (videoId: string) => {
    try {
      const posts = await loadSavedVideos([videoId]);
      const post = posts[0];
      if (post) setViewerPost(post);
    } catch (err: any) {
      console.warn("[AiChatScreen] เปิดคลิปของจุดแวะไม่สำเร็จ:", err?.message ?? err);
      Alert.alert("เปิดคลิปไม่สำเร็จ", "ลองใหม่อีกครั้ง");
    }
  };

  /**
   * สถานะที่ผู้ใช้เห็นว่าเอไaiกำลังทำอะไรอยู่
   * -------------------------------------------------------------
   * · ตอนกดยืนยันแล้ว → backend คำนวณแพลน (AI + OSRM) ใช้เวลานาน
   *   ถ้าไม่มีสถานะ ผู้ใช้จะคิดว่าแอปค้างหรือเอไaiเออเร่อ
   * · มาจาก state เดิมทั้งหมด (ไม่เพิ่ม request ใหม่)
   */
  const aiStatusText = planning
    ? "กำลังคำนวณแพลนทริป… (อาจใช้เวลาสักครู่)"
    : replanning
    ? "กำลังคำนวณแพลนใหม่…"
    : discoveryLoading
    ? "กำลังหาสถานที่ที่เหมาะกับคุณ…"
    : sending
    ? "กำลังคิด…"
    : null;

  /**
   * จุดเริ่มต้นที่ใช้ในป๊อปอัปแผนที่ (ที่ที่ผู้ใช้อยู่)
   * · จากการ์ดตั้งค่าก่อน (จุดเริ่มต้นที่ผู้ใช้เลือก) · ไม่มี → จุดเริ่มต้นที่บันทึกไว้
   */
  const originForMap = useMemo(() => {
    const fromSlots = draftSlots.startPoint;
    if (fromSlots?.label) {
      return { label: fromSlots.label, coords: fromSlots.coords ?? null };
    }
    if (currentOrigin) {
      return { label: currentOrigin.label, coords: currentOrigin.coords ?? null };
    }
    return null;
  }, [draftSlots.startPoint, currentOrigin]);

  /**
   * เนื้อหาข้อความของเอไai + แท็กที่แทรกไว้ "หน้าชื่อสถานที่"
   * -------------------------------------------------------------
   * กฎของผู้ใช้: แท็กต้องอยู่หน้าชื่อสถานที่ ในบรรทัดเดียวกับคำตอบ
   *   (ไม่ใช่ก้อนแท็กใต้ข้อความ) และใส่เฉพาะตอนที่คำตอบเอ่ยชื่อนั้นจริง
   * → backend ส่ง `tagPlace` (ชื่อที่จะติดแท็ก) มาพร้อมกัน → หาในข้อความแล้วแทรกแท็ก
   * → ถ้าไม่มี/ไม่เจอ → แสดงข้อความเดิมเปล่า ๆ (ไม่มีแท็กเกลอะ)
   */
  const renderMessageContent = (msg: AiChatMessage) => {
    return renderAnnotatedTextWithPlaces(msg.content, msg.placeTags, {
      placeName: msg.tagPlace,
      placeTag: msg.placeTag,
      tags: msg.tags,
    });
  };

  /**
   * การ์ดแผนที่คำนวณเสร็จแล้ว (ผูกกับข้อความที่สร้างมัน)
   * -------------------------------------------------------------
   * · planView = "staged"  = การ์ดแพลนของ flow ใหม่ (ผู้ใช้ยังไม่ยืนยันลำดับจุด)
   *   → ปุ่มหลัก "ยืนยันแพลนทริป" → ขึ้นการ์ดสรุป (กล่องเวลา—สถานที่)
   * · planView = "summary" = การ์ดสรุปสุดท้าย
   *   → ปุ่มหลัก "ยืนยันและบันทึกเข้าทริป" → เปิดหน้าทริป
   * · planView = ไม่มี     = เส้นทางเดิมของแอป (ปุ่ม "สร้างแพลน" → modal → ยืนยันเข้าทริป)
   */
  const renderPlanCard = (messageId: string, plan: TripPlan) => {
    const msg = thread?.messages.find((m) => m.id === messageId);
    const planView = msg?.planView;
    const isSummary = planView === "summary";
    const isStaged = planView === "staged";
    // จุดที่ผู้ใช้ติ๊กที่ส่งไปกับแผนนี้ → ใช้เช็คว่าจุดหายหรือเปล่า
    const sentPlaces = extraStops[messageId] ?? [];
    const planHasStops = (plan.days ?? []).some((d) => (d.stops?.length ?? 0) > 0);
    const placesMissing = sentPlaces.length > 0 && !planHasStops;
    return (
      <View>
        {/* จุดที่ผู้ใช้ติ๊กไม่ได้ถูกใส่ในแผน → บอกตรง ๆ (ไม่ให้เดาว่าทำไม) */}
        {placesMissing ? (
          <View className="mt-2 mb-1 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <Text className="text-amber-800 text-[12.5px] font-bold">
              สถานที่ที่คุณเลือก ({sentPlaces.length}) ไม่ได้ถูกใส่ในแพลนนี้
            </Text>
            <Text className="text-amber-700 text-[12px] mt-1">
              {sentPlaces.map((s) => s.label).join(" · ")}
            </Text>
            <Text className="text-amber-600 text-[11.5px] mt-1">
              ลองเปลี่ยนจุดเริ่มต้น/วันที่แล้วคำนวณใหม่ หรือเริ่มใหม่จากการ์ดสถานที่
            </Text>
          </View>
        ) : null}
        <TripPlanCard
          plan={plan}
          view={isSummary ? "summary" : "plan"}
          showSummary={isSummary}
          onBackToEdit={isSummary ? () => handleBackToEditPlan(messageId) : undefined}
          primaryAction={isStaged ? "confirm" : "preview"}
          primaryLabel={isStaged ? "ยืนยันแพลนทริป" : undefined}
          stopClips={buildStopClips(plan)}
          onOpenClip={(videoId) => void openClipFromStop(videoId)}
          notSelected={msg?.planMeta?.notSelected}
          aiWarnings={msg?.planMeta?.aiWarnings}
          folderWarning={msg?.planMeta?.folderWarning ?? null}
          busy={replanning === messageId || planning}
          onConfirm={() =>
            isSummary
              ? void handleConfirmPlan(messageId, plan)
              : isStaged
              ? handleConfirmPlanStops(messageId, plan)
              : void handleConfirmPlan(messageId, plan)
          }
          onEditWithAi={() => handleEditWithAi(messageId, plan)}
          onAddStop={(dIndex) => openNearby(messageId, plan, dIndex ?? 0)}
          onRemoveStop={(stopId) => handleRemoveStop(messageId, plan, stopId)}
          onMoveStop={(stopId, dir) => handleMoveStop(messageId, plan, stopId, dir)}
          onSelectLodging={(lodging) => handleSelectLodging(messageId, plan, lodging)}
          selectedLodgingName={selectedLodging[messageId] ?? null}
          onFuelPriceOverride={(price) => handleFuelOverride(messageId, plan, price)}
          fuelPriceOverride={fuelOverride[messageId] ?? null}
          vehicleSpecified={vehicleSpecified[messageId] ?? true}
          onVehicleChange={(vehicle, vehicleModel) =>
            void handleVehicleChange(messageId, plan, vehicle, vehicleModel)
          }
          onTravelersChange={(n) => void handleTravelersChange(messageId, plan, n)}
        />
      </View>
    );
  };

  /**
   * การ์ด "ถามทีละคำถาม" (ข้อ 2.3) — แทนการ์ดฟอร์ม 4 ขั้นตอนเดิม
   * → ถามทีละอย่าง ตอบได้ทั้งพิมพ์เองและกดเลือกตัวเลือก
   * → วันที่/เวลาใช้ตัวเลือกของแอปเอง (ปฏิทิน + ล้อเวลา) ที่เปิดจากระดับหน้าจอ
   */
  const renderQuestionFlow = (forMessageId?: string) => (
    <TripQuestionFlow
      slots={draftSlots}
      onChange={applyDraftSlots}
      onSubmitText={(text) => void send(text)}
      onCreatePlan={() => void handleCreatePlan(forMessageId ?? activeDraftMessageId ?? "")}
      creating={planning}
      onRequestOrigin={setCardOriginTarget}
      onRequestDateRange={() => openCardPicker("date")}
      onRequestTime={() => openCardPicker("time")}
    />
  );

  /**
   * การ์ด "ตั้งค่าแพลนทริป" (ขั้นที่ 1 ของ flow ใหม่)
   * -------------------------------------------------------------
   * → ผู้ใช้ติ๊กสถานที่มาแล้ว → กรอกข้อมูลเอง (ข้ามข้อไหนก็ได้) → กดยืนยัน
   * → ระบบส่งข้อมูลที่กรอกเป็นข้อความฝั่งผู้ใช้ แล้วค่อยคำนวณแพลน
   */
  const renderSetupCard = (messageId: string) => {
    const msg = thread?.messages.find((m) => m.id === messageId);
    // แหล่งเดียวของรายการที่ผู้ใช้ติ๊ก (เก็บไว้กับข้อความการ์ดตั้งค่า)
    // → ชิปที่เห็น = สิ่งที่จะถูกส่งไปสร้างแพลน (ไม่มีทางหลุด)
    const stops = msg?.planPlaces ?? [];
    // จุดเริ่มต้นอยู่ไกลจากสถานที่ที่เลือกมากไหม (ขับข้ามจังหวัด → แผนจะเพี้ยน)
    const startCoords = draftSlots.startPoint?.coords ?? null;
    const farthestKm = startCoords
      ? stops.reduce(
          (max, s) => Math.max(max, straightLineKm(startCoords, s.coords)),
          0
        )
      : 0;
    const startDistanceHint =
      startCoords && farthestKm >= 150
        ? `จุดเริ่มต้นอยู่ห่างจากสถานที่ที่เลือกประมาณ ${Math.round(
            farthestKm
          )} กม. — ถ้าจะขับข้ามจังหวัด ควรเริ่มเช้าหรือเปลี่ยนจุดเริ่มต้นก่อน`
        : null;
    return (
      <TripQuestionFlow
        mode="setup"
        places={stops.map((s) => s.label)}
        onSelectPlace={(i) => {
          const picked = stops[i];
          if (picked) setSetupMapPlace(picked);
        }}
        startDistanceHint={startDistanceHint}
        slots={draftSlots}
        onChange={applyDraftSlots}
        onSubmitText={(text) => void send(text)}
        onCreatePlan={() => void handleCreatePlanFromSetup(messageId)}
        creating={planning}
        onRequestOrigin={setCardOriginTarget}
        onRequestDateRange={() => openCardPicker("date")}
        onRequestTime={() => openCardPicker("time")}
      />
    );
  };

  // ผู้ดูคลิปเต็มจอ (แตะคลิปในแชท) — ใช้ตัวดูคลิปเดียวกับหน้าแรก
  // (ไลก์ · คอมเมนต์ · เซฟ · แชร์ ได้ครบ)
  if (viewerPost) {
    return (
      <MyVideoViewer
        initialVideoId={viewerPost.id}
        posts={[viewerPost]}
        onBack={() => setViewerPost(null)}
      />
    );
  }

  // กดการ์ดโฟลเดอร์ในแชท → เปิดหน้าดูคลิปข้างในโฟลเดอร์ (ข้อ 2.2)
  // คลิปในโฟลเดอร์เล่นเต็มจอแบบหน้าโฮม (MyVideoViewer)
  if (browserFolder) {
    return (
      <FolderClipBrowser
        folderId={browserFolder.id}
        folderName={browserFolder.name}
        clipCount={browserFolder.clipCount}
        videoIds={folders.find((f) => f.id === browserFolder.id)?.videoIds}
        onClose={() => setBrowserFolder(null)}
      />
    );
  }

  return (
    <View className="flex-1 bg-white">
      {/* Header */}
      <View
        style={{ paddingTop: Math.max(insets.top, 12) + 6 }}
        className="flex-row items-center px-3 pb-3 border-b border-gray-100"
      >
        <TouchableOpacity onPress={onBack} className="p-1 mr-1">
          <ArrowLeftIcon size={24} color="#18181B" strokeWidth={2} />
        </TouchableOpacity>
        <View className="w-9 h-9 rounded-full bg-violet-100 items-center justify-center mr-2.5">
          {folder ? <FolderIcon size={18} color="#7C3AED" /> : <SparklesIcon size={18} color="#7C3AED" />}
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-bold text-gray-900" numberOfLines={1}>
            {thread?.title ?? "แชท AI"}
          </Text>
          <Text className="text-[11px] text-gray-400">
            {folder
              ? `จากโฟลเดอร์ • ${folderCtx?.clipCount ?? folder.videoIds.length} คลิป`
              : "แชททั่วไป"}
          </Text>
        </View>
        {folder && onPlanTrip && (
          <TouchableOpacity
            onPress={() => onPlanTrip(folder.id)}
            activeOpacity={0.8}
            className="bg-violet-600 px-3 py-2 rounded-full flex-row items-center"
          >
            <SparklesIcon size={14} color="#FFFFFF" />
            <Text className="text-white text-[12px] font-bold ml-1">วางแผนทริป</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* แบนเนอร์ประกาศโฟลเดอร์ที่หัวแชท พร้อมปุ่มย่อ/ซ่อน และปุ่มปิด (ข้อ 7) */}
      {folder && !folderBannerDismissed && (
        <View className="bg-violet-50/90 border-b border-violet-100 px-3 py-2">
          <View className="flex-row items-center justify-between">
            <TouchableOpacity
              onPress={() =>
                setBrowserFolder({
                  id: folder.id,
                  name: folder.name,
                  clipCount: folderCtx?.clipCount ?? folder.videoIds.length,
                })
              }
              activeOpacity={0.7}
              className="flex-row items-center flex-1 mr-2"
            >
              <FolderIcon size={15} color="#7C3AED" />
              <Text className="text-violet-900 text-[12px] font-bold ml-1.5 flex-1" numberOfLines={1}>
                กำลังคุยเรื่อง: {folder.name} ({folderCtx?.clipCount ?? folder.videoIds.length} คลิป{folderCtx?.places.length ? ` • ${folderCtx.places.length} สถานที่` : ""})
              </Text>
              <Text className="text-[11px] text-violet-600 underline ml-1">ดูคลิป</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setFolderBannerExpanded((v) => !v)}
              className="p-1 mx-1 rounded-full bg-violet-100/70"
              accessibilityLabel={folderBannerExpanded ? "ย่อ" : "ขยาย"}
            >
              {folderBannerExpanded ? (
                <ChevronUpIcon size={13} color="#7C3AED" />
              ) : (
                <ChevronDownIcon size={13} color="#7C3AED" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setAttachedFolderId(null);
                setFolderBannerDismissed(true);
              }}
              className="p-1 rounded-full bg-violet-100/50"
              accessibilityLabel="ปิดการเชื่อมต่อโฟลเดอร์นี้"
            >
              <XMarkIcon size={13} color="#7C3AED" />
            </TouchableOpacity>
          </View>

          {/* รายชื่อสถานที่ในโฟลเดอร์เมื่อกดขยาย */}
          {folderBannerExpanded && folderCtx && folderCtx.places.length > 0 && (
            <View className="flex-row flex-wrap mt-2 pt-1.5 border-t border-violet-100">
              {folderCtx.places.slice(0, 8).map((p) => (
                <View
                  key={p.key}
                  className="bg-white border border-violet-100 rounded-full px-2 py-0.5 mr-1 mb-1"
                >
                  <Text className="text-[10.5px] text-violet-800 font-semibold">{p.name}</Text>
                </View>
              ))}
              {folderCtx.places.length > 8 ? (
                <Text className="text-[10.5px] text-gray-500 self-center">
                  +{folderCtx.places.length - 8} แห่ง
                </Text>
              ) : null}
            </View>
          )}
        </View>
      )}

      {/* Mode toggle — visible only for hosts. Defaults to the historical
          tourist behaviour; host-self is a JWT-gated advisor that reads the
          host's own business data. Switching mode does NOT clear the thread,
          but each send tags the new mode, so the prompt rebuilds fresh. */}
      {isHost && (
        <View className="flex-row bg-gray-100 rounded-full p-1 mx-4 my-2 self-stretch">
          <TouchableOpacity
            onPress={() => setChatMode("tourist")}
            activeOpacity={0.8}
            className={`flex-1 py-2 rounded-full items-center ${
              chatMode === "tourist" ? "bg-white shadow-sm" : ""
            }`}
          >
            <Text
              className={`text-[13px] ${
                chatMode === "tourist" ? "font-bold text-gray-900" : "text-gray-500 font-medium"
              }`}
            >
              ถามทั่วไป
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setChatMode("host-self")}
            activeOpacity={0.8}
            className={`flex-1 py-2 rounded-full items-center ${
              chatMode === "host-self" ? "bg-emerald-700 shadow-sm" : ""
            }`}
          >
            <Text
              className={`text-[13px] ${
                chatMode === "host-self" ? "font-bold text-white" : "text-gray-500 font-medium"
              }`}
            >
              ถามเกี่ยวกับร้านฉัน
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Messages / empty state */}
      {isEmpty ? (
        <View className="flex-1 px-6 justify-center">
          <View className="items-center mb-8">
            <View className="w-16 h-16 rounded-3xl bg-violet-100 items-center justify-center mb-3">
              <SparklesIcon size={30} color="#7C3AED" />
            </View>
            <Text className="text-xl font-black text-gray-900">
              {chatMode === "host-self" ? "ผู้ช่วยธุรกิจ" : "AI ช่วยคิด"}
            </Text>
            <Text className="text-gray-500 text-[13px] text-center mt-1 leading-5">
              {chatMode === "host-self"
                ? "ถามเกี่ยวกับธุรกิจของคุณได้เลย — AI จะตอบจากข้อมูลที่ลงทะเบียนไว้ในระบบ"
                : folder
                  ? `ถามอะไรก็ได้เกี่ยวกับคลิปในโฟลเดอร์ "${folder.name}" หรือกด "วางแผนทริป" ได้เลย`
                  : "ผู้ช่วยวางแผนเที่ยว ถามเรื่องที่พัก เส้นทาง อาหารพื้นถิ่น หรือวางแผนทริปได้เลย"}
            </Text>
          </View>
          {(chatMode === "host-self" ? HOST_SUGGESTIONS : SUGGESTIONS).map((s, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => send(s)}
              activeOpacity={0.7}
              className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 mb-2.5"
            >
              <Text className="text-gray-700 text-[13px]">{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={thread!.messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingVertical: 14, paddingHorizontal: 14 }}
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={handleContentSizeChange}
          onScroll={handleScroll}
          onScrollBeginDrag={() => {
            draggingRef.current = true;
          }}
          onScrollEndDrag={() => {
            draggingRef.current = false;
          }}
          removeClippedSubviews={false}
          renderItem={({ item }) => {
            const mine = item.role === "user";
            const failed = Boolean(item.isError);
            return (
              <View className={`mb-3 flex-row ${mine ? "justify-end" : "justify-start"}`}>
                {!mine && (
                  <View
                    className={`w-7 h-7 rounded-full items-center justify-center mr-2 mt-0.5 ${
                      failed ? "bg-red-100" : "bg-violet-100"
                    }`}
                  >
                    {failed ? (
                      <ExclamationTriangleIcon size={14} color="#DC2626" />
                    ) : (
                      <SparklesIcon size={14} color="#7C3AED" />
                    )}
                  </View>
                )}
                <View className="max-w-[88%]">
                  {/* คลิปที่ผู้ใช้แนบมาพร้อมข้อความ → แตะแล้วเปิดดูเต็มจอ (แบบหน้าแรก) */}
                  {mine && item.video ? (
                    <>
                      <TouchableOpacity
                        onPress={() => setViewerPost(item.video as VideoPost)}
                        activeOpacity={0.85}
                        className="mb-1.5 self-end rounded-2xl overflow-hidden border border-gray-200 bg-gray-800"
                        style={{ width: 186 }}
                      >
                        {item.video.poster ? (
                          <Image
                            source={item.video.poster}
                            style={{ width: 186, height: 236 }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            style={{ width: 186, height: 120 }}
                            className="items-center justify-center bg-gray-800"
                          >
                            <PlayIcon size={26} color="#FFFFFF" />
                          </View>
                        )}
                        {/* ปุ่มเล่นทับรูป */}
                        <View
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                          }}
                          className="items-center justify-center"
                        >
                          <View className="w-11 h-11 rounded-full bg-black/45 items-center justify-center">
                            <PlayIcon size={20} color="#FFFFFF" />
                          </View>
                        </View>
                        {item.video.caption ? (
                          <View
                            style={{
                              position: "absolute",
                              left: 0,
                              right: 0,
                              bottom: 0,
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                              backgroundColor: "rgba(0,0,0,0.45)",
                            }}
                          >
                            <Text numberOfLines={1} className="text-white text-[11px] font-semibold">
                              {item.video.caption}
                            </Text>
                          </View>
                        ) : null}
                      </TouchableOpacity>

                      {/* เส้นทางไปที่สถานที่ในคลิป (เปิด Google Maps) */}
                      {clipPlaceName ? (
                        <TouchableOpacity
                          onPress={openDirections}
                          activeOpacity={0.8}
                          className="mb-1.5 self-end flex-row items-center bg-blue-50 border border-blue-200 rounded-full px-3 py-1.5"
                        >
                          <MapPinIcon size={13} color="#1D4ED8" />
                          <Text className="text-blue-700 text-[11.5px] font-bold ml-1">
                            เส้นทางไปที่นี่
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </>
                  ) : null}

                  {failed || item.content.trim() ? (
                  <View
                    className={
                      failed
                        ? "px-3.5 py-2.5 rounded-2xl bg-red-50 border border-red-200 self-start"
                        : mine
                        ? "px-3.5 py-2.5 rounded-2xl bg-[#2D6A4F] rounded-br-md self-end"
                        : "py-1 self-start"
                    }
                  >
                    {failed ? (
                      <Text className="text-[12px] font-bold text-red-700 mb-1">
                        ⚠️ AI ตอบไม่สำเร็จ
                      </Text>
                    ) : null}
                    <Text
                      className={`text-[14px] leading-6 ${
                        failed ? "text-red-800" : mine ? "text-white font-medium" : "text-gray-900"
                      }`}
                    >
                      {renderMessageContent(item)}
                    </Text>
                  </View>
                  ) : null}

                  {/* กล่อง "สถานที่ที่เลือก" ใต้ฟองผู้ใช้ (รอบแรก/รอบสอง)
                      → กดปุ่ม Google Map ในกล่อง = เปิดป๊อปอัปแผนที่จากจุดเริ่มต้นไปที่สถานที่นั้น
                      · ข้อมูลมาจาก item.planPlaces ตัวเดียวกับที่ส่งให้เอไai */}
                  {mine && !failed && item.planPlaces && item.planPlaces.length > 0 ? (
                    <ChatSelectedPlacesBox
                      places={item.planPlaces}
                      startPoint={originForMap}
                    />
                  ) : null}

                  {/* ลิงก์แหล่งที่มา (แท็กประเภทสถานที่อยู่ในบรรทัดคำตอบแล้ว) */}
                  {!mine && !failed ? (
                    <ChatSourceChips sources={item.sources} />
                  ) : null}

                  {failed ? (
                    <TouchableOpacity
                      onPress={() => {
                        const lastUser = [...thread.messages]
                          .reverse()
                          .find((m) => m.role === "user");
                        if (lastUser) send(lastUser.content);
                      }}
                      activeOpacity={0.8}
                      className="mt-2 bg-red-600 rounded-xl px-3.5 py-2 flex-row items-center self-start"
                    >
                      <ArrowPathIcon size={15} color="#FFFFFF" />
                      <Text className="text-white text-[12.5px] font-bold ml-1.5">ลองใหม่อีกครั้ง</Text>
                    </TouchableOpacity>
                  ) : null}

                  {/* แผนที่คำนวณเสร็จแล้ว → การ์ดแผน (แผนที่จริง · เวลา · ต้นทุน · เพิ่ม/ลบจุด) */}
                  {!mine && !failed && item.plan ? renderPlanCard(item.id, item.plan) : null}

                  {/* การ์ด "ตั้งค่าแพลนทริป" (ขั้นที่ 1 ของ flow ใหม่) — ผู้ใช้กรอกเองก่อนสร้างแพลน */}
                  {!mine && !failed && item.planSetup ? (
                    <View className="mt-2.5">{renderSetupCard(item.id)}</View>
                  ) : null}

                  {/* การ์ดวางแผนทริป (TripQuestionFlow) ยึดติดกับข้อความที่เป็นเจ้าของ draft เพื่อไม่ให้เลื่อนตามข้อความใหม่ */}
                  {!mine && !failed && !item.plan && item.id === activeDraftMessageId ? (
                    <View className="mt-2.5">{renderQuestionFlow(item.id)}</View>
                  ) : null}

                  {/* การ์ดสถานที่ที่แนะนำ (ประเภท D) — กล่องต่อกล่อง เรียงลงมา ติ๊กเลือกได้
                      (พอสร้างแพลนจากที่เลือกแล้ว → ซ่อน เพราะการ์ดแผนมาต่อท้ายแทน) */}
                  {!mine && !failed && !item.plan && item.placeCards && item.placeCards.length > 0 ? (
                    <View className="mt-2.5 self-stretch">
                      {item.placeCards.map((p) => {
                        const picked = (selectedPlaceCards[item.id] ?? []).includes(p.placeId);
                        return (
                          <ChatPlaceCard
                            key={`${item.id}-${p.placeId}`}
                            place={p}
                            selected={picked}
                            onToggle={() => togglePlaceCard(item.id, p.placeId)}
                            styleLabel={
                              p.styleLabel ?? item.discoveryTags?.[0]?.label ?? null
                            }
                            styleEmoji={
                              p.styleEmoji ?? item.discoveryTags?.[0]?.emoji ?? null
                            }
                          />
                        );
                      })}

                      {/* ปุ่มใต้รายการ: สร้างแพลนจากที่เลือก · รีเฟช(ที่ใหม่ ไม่ซ้ำ) · เปลี่ยนแท็ก */}
                      <View className="flex-row items-center flex-wrap mt-1">
                        <TouchableOpacity
                          onPress={() => handleCreatePlanFromCards(item.id)}
                          activeOpacity={0.85}
                          className={`flex-row items-center bg-violet-600 rounded-full px-3.5 py-2 mr-2 mb-2 ${
                            (selectedPlaceCards[item.id] ?? []).length === 0
                              ? "opacity-50"
                              : ""
                          }`}
                        >
                          <SparklesIcon size={14} color="#FFFFFF" />
                          <Text className="text-white text-[12.5px] font-bold ml-1.5">
                            สร้างแพลนทริปจาก{" "}
                            {(selectedPlaceCards[item.id] ?? []).length} แห่งที่เลือก
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => void handleDiscoveryRefresh(item.id)}
                          activeOpacity={0.85}
                          className="flex-row items-center bg-white border border-violet-300 rounded-full px-3.5 py-2 mr-2 mb-2"
                        >
                          <ArrowPathIcon size={13} color="#6D28D9" />
                          <Text className="text-violet-700 text-[12.5px] font-bold ml-1.5">
                            รีเฟช (ที่ใหม่ ไม่ซ้ำ)
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() =>
                            void startDiscovery(questionBefore(item.id), item.id)
                          }
                          activeOpacity={0.85}
                          className="flex-row items-center bg-white border border-gray-300 rounded-full px-3.5 py-2 mb-2"
                        >
                          <ArrowPathIcon size={13} color="#4B5563" />
                          <Text className="text-gray-700 text-[12.5px] font-bold ml-1.5">
                            เปลี่ยนแท็ก
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}

                  {/* ชื่อสถานที่ซ้ำหลายแห่ง → ให้ผู้ใช้เลือกแห่งที่ถูก
                      (แตะ = ถามคำเดิมซ้ำพร้อม placeId → ได้คำตอบใหม่ต่อท้าย) */}
                  {!mine &&
                    !failed &&
                    item.placeCandidates &&
                    item.placeCandidates.length > 0 && (
                      <View className="mt-2 self-stretch bg-white border border-violet-200 rounded-2xl overflow-hidden">
                        {item.placeCandidates.map((c, ci) => {
                          const chosen = chosenPlaces[item.id] === c.placeId;
                          const loc = [c.subdistrict, c.district, c.province]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <View
                              key={`${c.placeId}-${ci}`}
                              className={ci > 0 ? "border-t border-gray-100" : ""}
                            >
                              <TouchableOpacity
                                onPress={() => handlePickPlace(item.id, c)}
                                activeOpacity={0.7}
                                className="flex-row items-start px-3 py-2.5"
                              >
                                <View className="flex-1">
                                  <Text className="text-[13px] font-bold text-gray-900">
                                    {c.name}
                                  </Text>
                                  {loc ? (
                                    <Text className="text-[11.5px] text-gray-500 mt-0.5">
                                      {loc}
                                    </Text>
                                  ) : null}
                                  <View className="flex-row items-center flex-wrap mt-1">
                                    {c.rating != null ? (
                                      <Text className="text-[11.5px] font-semibold text-amber-600">
                                        ⭐ {c.rating.toFixed(1)}
                                        {c.userRatingsTotal != null
                                          ? ` (${c.userRatingsTotal})`
                                          : ""}
                                      </Text>
                                    ) : null}
                                    {c.community ? (
                                      <Text className="text-[11px] text-gray-500 ml-2">
                                        ชุมชน{c.community}
                                      </Text>
                                    ) : null}
                                    {chosen ? (
                                      <Text className="text-[11px] font-bold text-emerald-600 ml-2">
                                        เลือกแล้ว ✓
                                      </Text>
                                    ) : null}
                                  </View>
                                </View>
                                {chosen ? (
                                  <CheckBadgeIcon
                                    size={18}
                                    color="#059669"
                                    style={{ marginTop: 2 }}
                                  />
                                ) : (
                                  <ChevronRightIcon
                                    size={16}
                                    color="#9CA3AF"
                                    style={{ marginTop: 3 }}
                                  />
                                )}
                              </TouchableOpacity>
                              {c.googleMapsUrl ? (
                                <TouchableOpacity
                                  onPress={() => {
                                    Linking.openURL(c.googleMapsUrl as string).catch(
                                      () => undefined
                                    );
                                  }}
                                  activeOpacity={0.7}
                                  className="flex-row items-center px-3 pb-2.5"
                                >
                                  <ArrowTopRightOnSquareIcon size={12} color="#7C3AED" />
                                  <Text className="text-[11px] font-semibold text-violet-700 ml-1">
                                    เปิดใน Google Maps
                                  </Text>
                                </TouchableOpacity>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    )}
                </View>
              </View>
            );
          }}
          ListFooterComponent={
            aiStatusText ? (
              /* ฟอง "กำลังคิด" ฝั่งเอไai → ผู้ใช้เห็นว่าอีไอกำลังทำอะไรอยู่ */
              <View className="flex-row items-start ml-9 mb-3">
                <View className="flex-row items-center bg-gray-100 rounded-2xl rounded-tl-md px-3.5 py-2.5 self-start">
                  <TypingDots />
                  <Text className="text-gray-600 text-[12.5px] ml-2 font-medium">
                    {aiStatusText}
                  </Text>
                </View>
              </View>
            ) : undefined
          }
        />
      )}

      {/* Composer */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Origin display chip if chosen */}
        {currentOrigin && (
          <View className="flex-row items-center mx-3 mt-1.5 bg-violet-50 border border-violet-200 rounded-xl px-3 py-1.5">
            <MapPinIcon size={14} color="#7C3AED" />
            <Pressable
              onPress={() => setOriginModalOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="ดูและแก้ไขจุดเริ่มต้น"
              className="flex-1"
            >
              <Text className="text-violet-800 text-[11.5px] font-semibold ml-1.5" numberOfLines={1}>
                เริ่มจาก: {currentOrigin.label} ({currentOrigin.address})
              </Text>
            </Pressable>
            <TouchableOpacity onPress={() => setCurrentOrigin(null)} className="p-0.5">
              <XMarkIcon size={14} color="#7C3AED" />
            </TouchableOpacity>
          </View>
        )}

        <View
          className="flex-row items-center px-3 pt-2 border-t border-gray-100"
          style={{ paddingBottom: Math.max(insets.bottom, 10) }}
        >
          {/* Quick Origin Selector Button (House/Pin) */}
          <TouchableOpacity
            onPress={() => setOriginModalOpen(true)}
            disabled={sending}
            activeOpacity={0.7}
            className="w-10 h-10 rounded-full bg-violet-50 items-center justify-center mr-1.5 border border-violet-200"
          >
            <MapPinIcon size={18} color="#7C3AED" />
          </TouchableOpacity>

          {/* Attach a saved-clip folder */}
          {!threadFolder && (
            <TouchableOpacity
              onPress={() => setPickerOpen(true)}
              disabled={sending}
              activeOpacity={0.7}
              className="w-10 h-10 rounded-full bg-gray-100 items-center justify-center mr-2"
            >
              <PaperClipIcon size={18} color={attachedFolder ? "#D47A3A" : "#6B7280"} />
            </TouchableOpacity>
          )}

          <View className="flex-1 bg-gray-100 rounded-full px-4 py-2.5">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="ถามน้องโลคอล..."
              placeholderTextColor="#9CA3AF"
              className="text-[14px] text-gray-900 py-0"
              multiline
              editable={!sending}
            />
          </View>
          <TouchableOpacity
            onPress={() => send(draft)}
            disabled={!draft.trim() || sending}
            activeOpacity={0.8}
            className={`ml-2 w-11 h-11 rounded-full items-center justify-center ${
              draft.trim() && !sending ? "bg-violet-600" : "bg-gray-200"
            }`}
          >
            <PaperAirplaneIcon size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Folder picker — pick a saved-clip folder to attach to the next message */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setPickerOpen(false)}>
          <View className="flex-1 bg-black/40" />
        </TouchableWithoutFeedback>
        <View
          className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl"
          style={{ maxHeight: "70%", paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <View className="items-center pt-2.5 pb-1">
            <View className="w-10 h-1.5 rounded-full bg-gray-300" />
          </View>
          <View className="px-5 pt-1 pb-3 flex-row items-center justify-between border-b border-gray-100">
            <Text className="text-[16px] font-black text-gray-900">แนบโฟลเดอร์คลิป</Text>
            <TouchableOpacity onPress={() => setPickerOpen(false)} className="p-1">
              <XMarkIcon size={22} color="#6B7280" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={folders}
            keyExtractor={(f) => f.id}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => {
                  setAttachedFolderId(item.id);
                  setFolderBannerDismissed(false);
                  announcedFolderRef.current = null;
                  setPickerOpen(false);
                }}
                activeOpacity={0.8}
                className="flex-row items-center bg-gray-50 border border-gray-100 rounded-2xl p-4 mb-2.5"
              >
                <View className="w-11 h-11 rounded-2xl bg-amber-100 items-center justify-center mr-3">
                  <FolderIcon size={22} color="#D47A3A" />
                </View>
                <View className="flex-1">
                  <Text className="text-gray-900 font-bold text-[14px]">{item.name}</Text>
                  <Text className="text-gray-400 text-[12px]">{item.videoIds.length} คลิปที่บันทึก</Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View className="py-14 items-center px-8">
                <FolderIcon size={40} color="#D1D5DB" />
                <Text className="text-gray-400 text-sm text-center mt-3 leading-5">
                  ยังไม่มีโฟลเดอร์ ไปที่หน้าหลักแล้วกดบันทึกคลิปที่ชอบลงโฟลเดอร์ก่อน
                </Text>
              </View>
            }
          />
        </View>
      </Modal>

      {/* จุดใกล้เคียงที่ระบบเจอ → ผู้ใช้ต้องกด "เพิ่ม" เอง (ระบบไม่เพิ่มให้เงียบ ๆ) */}
      <Modal
        visible={nearbyOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setNearbyOpen(false)}
      >
        <TouchableWithoutFeedback onPress={() => setNearbyOpen(false)}>
          <View className="flex-1 bg-black/40" />
        </TouchableWithoutFeedback>
        <View
          className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl"
          style={{ maxHeight: "75%", paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <View className="items-center pt-2.5 pb-1">
            <View className="w-10 h-1.5 rounded-full bg-gray-300" />
          </View>
          <View className="px-5 pt-1 pb-3 flex-row items-center justify-between border-b border-gray-100">
            <Text className="text-[16px] font-black text-gray-900">
              จุดใกล้เคียงที่แนะนำ
            </Text>
            <TouchableOpacity onPress={() => setNearbyOpen(false)} className="p-1">
              <XMarkIcon size={22} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {nearbyLoading ? (
            <View className="py-14 items-center">
              <ActivityIndicator size="large" color="#7C3AED" />
              <Text className="text-gray-500 text-[13px] mt-3">
                กำลังหาจุดใกล้เคียง...
              </Text>
            </View>
          ) : (
            <FlatList
              data={nearby}
              keyExtractor={(p) => p.id}
              contentContainerStyle={{ padding: 16 }}
              renderItem={({ item: p }) => (
                <View className="bg-gray-50 border border-gray-100 rounded-2xl p-3.5 mb-2.5">
                  <View className="flex-row items-start">
                    <View className="flex-1">
                      <Text className="text-gray-900 font-bold text-[14px]">
                        {p.name}
                      </Text>
                      {p.address ? (
                        <Text className="text-gray-500 text-[12px] mt-0.5">
                          {p.address}
                        </Text>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        if (nearbyMessageId) void addNearbyStop(nearbyMessageId, p);
                      }}
                      activeOpacity={0.85}
                      className="bg-violet-600 px-3 py-1.5 rounded-xl ml-2"
                    >
                      <Text className="text-white text-[12.5px] font-bold">เพิ่ม</Text>
                    </TouchableOpacity>
                  </View>
                  <View className="flex-row items-center flex-wrap mt-2">
                    {p.distanceKm != null ? (
                      <View className="bg-blue-50 px-2 py-0.5 rounded-full mr-1.5 mb-1">
                        <Text className="text-blue-800 text-[12px] font-bold">
                          ห่าง {p.distanceKm.toFixed(1)} กม.
                        </Text>
                      </View>
                    ) : null}
                    {p.price ? (
                      <View className="bg-gray-100 px-2 py-0.5 rounded-full mr-1.5 mb-1">
                        <Text className="text-gray-800 text-[12px] font-bold">
                          {p.price}
                          {p.priceUnit ? ` / ${p.priceUnit}` : ""}
                        </Text>
                      </View>
                    ) : null}
                    {p.openingHours ? (
                      <View className="bg-emerald-50 px-2 py-0.5 rounded-full mr-1.5 mb-1">
                        <Text className="text-emerald-800 text-[12px] font-bold">
                          {p.openingHours}
                        </Text>
                      </View>
                    ) : null}
                    {p.rating != null ? (
                      <View className="bg-amber-50 px-2 py-0.5 rounded-full mr-1.5 mb-1">
                        <Text className="text-amber-800 text-[12px] font-bold">
                          ⭐ {p.rating.toFixed(1)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <View className="py-12 items-center px-8">
                  <MapPinIcon size={36} color="#D1D5DB" />
                  <Text className="text-gray-400 text-[13px] text-center mt-3 leading-5">
                    ไม่พบจุดใกล้เคียงในรัศมีนี้ — ลองเลือกจุดอื่นในแผนหรือเพิ่มจุดเอง
                  </Text>
                </View>
              }
            />
          )}
        </View>
      </Modal>

      {/* Origin selector modal */}
      <OriginSelectorModal
        visible={originModalOpen}
        onClose={() => setOriginModalOpen(false)}
        onSelectOrigin={handleSelectOrigin}
      />

      {/* ตัวเลือกจุดของการ์ดช่องข้อมูล — อยู่ที่ระดับหน้าจอ (นอกลิสต์) เพื่อไม่ให้ค้างกลืนการแตะ */}
      <OriginSelectorModal
        visible={cardOriginTarget !== null}
        onClose={() => {
          setCardOriginTarget(null);
          // ปิดหน้าต่างเลือกจุดเริ่มต้นโดยยังไม่ได้เลือก → ยกเลิกงานที่ค้างไว้
          // (ไม่งั้นผู้ใช้จะเลือกจุดเริ่มต้นทีหลังจากการ์ดตั้งค่า แล้ว flow เดิมกลับมาทำงานซ้ำ)
          setPendingStartPick(null);
        }}
        onSelectOrigin={handleCardOriginSelected}
        title={
          cardOriginTarget === "destination"
            ? "เพิ่มสถานที่ที่ต้องการไป"
            : cardOriginTarget === "end"
            ? "เลือกจุดสิ้นสุดตอนกลับ"
            : "เลือกจุดเริ่มต้นการเดินทาง"
        }
        subtitle={
          cardOriginTarget === "destination"
            ? "ค้นหาชื่อสถานที่ หรือวางลิงก์ Google Maps เพื่อบันทึกเข้าทริป"
            : "ระบุตำแหน่งบ้าน หอพัก หรือวางลิงก์ Google Maps"
        }
        defaultLabel={cardOriginTarget === "destination" ? "สถานที่ท่องเที่ยว" : "บ้าน"}
      />

      {/* ปฏิทินเลือกช่วงวันที่ (วันเริ่ม → วันสิ้นสุด ในหน้าเดียว)
          ไม่ใส่ key ที่ Modal — การเปลี่ยน key ของ Modal ที่ยังเปิดอยู่ทำให้ iOS
          ค้าง native modal เดิมไว้บนจอ (ล้อเลื่อนได้ แต่ปุ่มกดไม่ติด) */}
      <TripDateRangeSheet
        visible={cardPicker === "date"}
        startDate={draftSlots.startDate ?? null}
        endDate={draftSlots.endDate ?? null}
        resetKey={cardPickerSeq}
        onCancel={() => setCardPicker(null)}
        onConfirm={(startDate, endDate) => {
          setCardPicker(null);
          // ใช้ค่าล่าสุดจาก ref (ไม่ใช่ state ที่อาจค้างอยู่ตอนเปิด sheet)
          applyDraftSlots({
            ...draftSlotsRef.current,
            startDate,
            endDate,
          });
        }}
      />

      {/* ล้อเวลาออกเดินทาง */}
      <TripTimeSheet
        visible={cardPicker === "time"}
        value={draftSlots.startTime ?? null}
        resetKey={cardPickerSeq}
        onCancel={() => setCardPicker(null)}
        onConfirm={(time) => {
          setCardPicker(null);
          applyDraftSlots({
            ...draftSlotsRef.current,
            startTime: time,
          });
        }}
      />

      {/* Modal เลือกจุดหมายปลายทาง (โฟลเดอร์ / ค้นหาสถานที่ / ให้ AI คิดให้) เมื่อไม่มีสถานที่สำหรับวางแผน */}
      <TripDestinationPickerModal
        visible={showDestinationPicker}
        onClose={() => setShowDestinationPicker(false)}
        onSelectFolder={handlePickerSelectFolder}
        onSelectStops={handlePickerSelectStops}
        initialDestination={
          draftSlots.style?.includes("อยุธยา")
            ? "พระนครศรีอยุธยา"
            : draftSlots.startPoint?.label?.replace("จุดเริ่มต้น", "").trim() || ""
        }
        initialStyle={draftSlots.style || ""}
      />

      {/* ป๊อปอัปเลือกแท็กก่อนหาสถานที่ (ประเภท D) — มีปุ่มปิด/ยกเลิกเสมอ */}
      <ChatStylePickerModal
        visible={stylePickerOpen}
        tags={discoveryTags}
        loading={discoveryTagsLoading}
        busy={discoveryLoading}
        question={discoveryQuestion}
        onConfirm={(tags) => void handleDiscoveryConfirm(tags)}
        onAiPick={() => void handleDiscoveryAiPick()}
        onCancel={handleDiscoveryCancel}
      />

      {/* ป๊อปอัปแผนที่จากชิปสถานที่ที่ติ๊กในการ์ดตั้งค่า
          → เส้นทางจากจุดเริ่มต้นของผู้ใช้ → สถานที่ที่แตะชิป */}
      <ChatPlaceMapModal
        place={setupMapPlace}
        startPoint={originForMap}
        onClose={() => setSetupMapPlace(null)}
      />
    </View>
  );
}
