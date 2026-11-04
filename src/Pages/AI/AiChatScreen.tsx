import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  FlatList,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
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
  QuestionMarkCircleIcon,
  PlayIcon,
} from "react-native-heroicons/outline";
import { useAiPlanner } from "../../state/AiPlannerContext";
import { useInteractions } from "../../state/InteractionContext";
import { useAuth } from "../../state/AuthContext";
import { sendChat } from "../../services/aiChatService";
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
  ClipContext,
  ItineraryDay,
  PlaceChoice,
  StopType,
  Trip,
  TripPlan,
  TripPlanLodging,
  TripPlanMeta,
  TripSlots,
  computeTripMissing,
  isTripPlanReady,
} from "../../data/tripsData";
import type { VideoPost } from "../../data/homeFeedData";
import OriginSelectorModal from "../../components/OriginSelectorModal";
import MyVideoViewer from "../../components/MyVideoViewer";
import TripDraftCard from "../../components/TripDraftCard";
import TripPlanCard from "../../components/TripPlanCard";
import { parseGoogleMapsUrl } from "../../services/savedPlacesService";

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
  const first = itinerary[0] ?? {};
  const vehicle = t.vehicle ?? null;
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
    date: first.date ?? null,
    startTime: t.startTime ?? "08:00",
    days: Number(t.days) || itinerary.length || 1,
    vehicle: vehicle?.key ?? null,
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
    const t = getThread(threadId);
    const last = [...(t?.messages ?? [])].reverse().find((m) => m.tripDraft);
    return last?.tripDraft?.slots ?? {};
  });
  /** ข้อความที่กำลังแก้แผนอยู่ (กด "แก้ไขกับเอไai" → แผนใหม่จะกลับไปอัปเดตข้อความเดิม) */
  const [editingPlanMessageId, setEditingPlanMessageId] = useState<string | null>(null);
  /** กำลังคำนวณแผนใหม่ (ลบ/สลับลำดับ/เปลี่ยนราคาน้ำมัน) — key = id ข้อความ */
  const [replanning, setReplanning] = useState<string | null>(null);
  /** ราคาน้ำมันที่ผู้ใช้ระบุเอง — key = id ข้อความ */
  const [fuelOverride, setFuelOverride] = useState<Record<string, number | null>>({});
  /** จุดที่ผู้ใช้เพิ่มเองจากรายการจุดใกล้เคียง — key = id ข้อความ */
  const [extraStops, setExtraStops] = useState<Record<string, PlanTripRequest["extraStops"]>>({});
  /** sheet จุดใกล้เคียง */
  const [nearbyOpen, setNearbyOpen] = useState(false);
  const [nearbyMessageId, setNearbyMessageId] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyPlace[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  /** ที่พักที่ผู้ใช้เลือกจากข้อเสนอ — key = id ข้อความ */
  const [selectedLodging, setSelectedLodging] = useState<Record<string, string>>({});

  const listRef = useRef<FlatList<AiChatMessage>>(null);
  const autoSentRef = useRef(false);

  const thread = getThread(threadId);
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

  const handleSelectOrigin = (origin: { label: string; address: string; url?: string; coords?: { lat: number; lng: number } }) => {
    setCurrentOrigin(origin);
    // จุดเริ่มต้นที่ผู้ใช้เลือก = ช่องข้อมูลจุดเริ่มต้นของแผนทริป (ไม่ต้องพิมพ์ซ้ำ)
    const coords = origin.coords ?? null;
    setDraftSlots((prev) => ({
      ...prev,
      startPoint: {
        label: origin.label,
        address: origin.address || null,
        coords,
      },
    }));
    const msg = `🚗 จุดเริ่มต้นเดินทางของฉัน: ${origin.label} (${origin.address})${origin.url ? `\nลิงก์: ${origin.url}` : ""}`;
    void send(msg);
  };

  // ── ระบบวางแผนทริป ────────────────────────────────────────────────
  /**
   * รวมช่องข้อมูลที่เอไaiสกัดได้ กับช่องที่ผู้ใช้เคยกรอกไว้
   * · ค่าที่โมเดลไม่รู้ (null) จะไม่ทับค่าเดิม
   * · `dayEndPoints` เก็บฝั่งแอปเท่านั้น (backend ไม่รู้จัก) → ต้องคงเดิม
   * · ถ้ากลับไป "กลับจุดเดิม" → ล้างจุดสิ้นสุดที่เคยเลือกทิ้ง
   */
  const mergeSlots = (current: TripSlots, incoming: TripSlots): TripSlots => {
    const next: TripSlots = { ...current };
    if (incoming.startPoint) next.startPoint = incoming.startPoint;
    if (incoming.returnMode) next.returnMode = incoming.returnMode;
    if (incoming.endPoint) next.endPoint = incoming.endPoint;
    if (incoming.date) next.date = incoming.date;
    if (incoming.startTime) next.startTime = incoming.startTime;
    if (incoming.days) next.days = incoming.days;
    if (incoming.vehicle) next.vehicle = incoming.vehicle;
    if (incoming.fuelType) next.fuelType = incoming.fuelType;
    if (incoming.travelers) next.travelers = incoming.travelers;
    if (incoming.budgetPerPerson) next.budgetPerPerson = incoming.budgetPerPerson;
    if (incoming.style) next.style = incoming.style;
    if (current.dayEndPoints) next.dayEndPoints = current.dayEndPoints;
    if (next.returnMode === "same_as_start") next.endPoint = null;
    return next;
  };

  /**
   * สร้างช่องข้อมูลจากแพลนที่วาดแล้ว → ใช้ตอนคำนวณใหม่
   * (ลบจุด · ขยับลำดับ · เปลี่ยนราคาน้ำมัน) เพื่อให้ใช้พิกัด/วันที่/รถเดิมเป๊ะ ๆ
   */
  const slotsFromPlan = (plan: TripPlan): TripSlots => {
    const days = plan.days ?? [];
    return {
      startPoint: plan.startPoint,
      returnMode: plan.returnMode,
      endPoint: plan.returnMode === "custom" ? plan.endPoint : null,
      date: days[0]?.date ?? null,
      startTime: plan.startTime ?? "08:00",
      days: days.length || 1,
      vehicle: plan.vehicle?.key ?? "private_car",
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
    return {
      ...base,
      selectedStops: opts?.selectedStops,
      extraStops: opts?.extraStops,
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
      updateMessage(threadId, messageId, { plan: result.plan, planMeta: meta });
      return result.plan;
    } catch (err) {
      const aiErr = asAiError(err);
      Alert.alert(
        "คำนวณแผนไม่สำเร็จ",
        aiErr?.message ?? "เรียกตัวคำนวณแผนทริปไม่สำเร็จ ลองใหม่อีกครั้ง"
      );
      return null;
    } finally {
      setReplanning(null);
    }
  };

  /** กด "สร้างแพลนทริป" ในการ์ดข้อมูล */
  const handleCreatePlan = async (messageId: string) => {
    // ถ้ากำลังแก้แผนเดิมอยู่ → แผนใหม่ต้องไปทับแผนเดิม ไม่ใช่สร้างการ์ดใหม่
    const targetId = editingPlanMessageId ?? messageId;
    setPlanning(true);
    try {
      const plan = await runPlan(
        targetId,
        buildPlanRequest(draftSlots, {
          extraStops: extraStops[targetId] ?? [],
          fuelPriceOverride: fuelOverride[targetId] ?? null,
        })
      );
      if (plan) {
        clearDraftCards();
        setEditingPlanMessageId(null);
      }
    } finally {
      setPlanning(false);
    }
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

  /** เปิดรายการจุดใกล้เคียง (ระบบเสนอ — ผู้ใช้ต้องกดเพิ่มเอง) */
  const openNearby = async (messageId: string, plan: TripPlan) => {
    setNearbyMessageId(messageId);
    setNearbyOpen(true);
    setNearbyLoading(true);
    setNearby([]);
    try {
      const day = plan.days?.[0];
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

  /** ผู้ใช้กดเพิ่มจุดใกล้เคียง → คำนวณแผนใหม่ */
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
    await runPlan(
      messageId,
      buildPlanRequest(slotsFromPlan(plan), {
        selectedStops: collectSelectedStops(plan.days),
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
    }
  ) => {
    const body = text.trim();
    if (!body || !thread || sending) return;

    // If a folder is attached, make it visible in the transcript too.
    const visibleContent = attachedFolder
      ? `📁 แนบโฟลเดอร์ "${attachedFolder.name}" (${attachedFolder.videoIds.length} คลิป)\n${body}`
      : body;
    // ผู้ใช้เลือกสถานที่จากรายการ → บอกโมเดลด้วยว่าเลือกอันไหน (คำถามเดิมยังอยู่ข้างบน)
    const selectionNote = opts?.placeLabel ? `\n📍 เลือกสถานที่: ${opts.placeLabel}` : "";

    appendMessage(threadId, {
      role: "user",
      content: visibleContent + selectionNote,
      video: opts?.video ?? undefined,
    });
    setDraft("");
    setSending(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

    // If the user typed or pasted a Google Maps URL, pre-parse it so AI understands immediately
    let processedForAi = visibleContent + selectionNote;
    const gmapsMatch = body.match(/https?:\/\/(?:maps\.app\.goo\.gl\/[^\s]+|www\.google\.com\/maps[^\s]+)/i);
    if (gmapsMatch) {
      const url = gmapsMatch[0];
      const parsed = parseGoogleMapsUrl(url);
      if (parsed.lat && parsed.lng) {
        processedForAi = `${visibleContent + selectionNote}\n[ข้อมูลพิกัดจากลิงก์: ละติจูด ${parsed.lat.toFixed(4)}, ลองจิจูด ${parsed.lng.toFixed(4)}]`;
      } else {
        processedForAi = `${visibleContent + selectionNote}\n[หมายเหตุ: ลิงก์จุดเริ่มต้นการเดินทางของผู้ใช้ ให้เริ่มวางแผนจากจุดนี้ได้ทันที ไม่ต้องกดเปิดลิงก์ภายนอก]`;
      }
    }

    const history = [...thread.messages.map((m) => ({ role: m.role, content: m.content })), {
      role: "user" as const,
      content: processedForAi,
    }];

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
        tripDraft: Object.keys(draftSlots).length > 0 ? draftSlots : null,
        // แผนที่กำลังแก้ → backend แทรกลง system prompt ให้เอไaiอ้างอิงได้
        planContext: opts?.planContext ?? null,
      });
      // เอไaiสกัดช่องข้อมูลได้ → รวมกับที่ผู้ใช้เคยกรอก (ค่าที่โมเดลไม่รู้จะไม่ทับของเดิม)
      const mergedSlots = result.tripDraft
        ? mergeSlots(draftSlots, result.tripDraft.slots)
        : null;
      if (mergedSlots) setDraftSlots(mergedSlots);
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
        tripDraft: mergedSlots
          ? {
              slots: mergedSlots,
              missing: computeTripMissing(mergedSlots),
              planReady: isTripPlanReady(mergedSlots),
            }
          : undefined,
      });
      setAttachedFolderId(null); // attachment is one-shot per send
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
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
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
   * การ์ดข้อมูลแผนทริปโผล่ที่ข้อความล่าสุดที่มี `tripDraft` เท่านั้น
   * (ไม่งั้นจะมีการ์ดซ้ำทุกข้อความ — ปัญหาเดิมที่ปุ่มขึ้นทุกครั้งที่เอไaiตอบ)
   */
  const lastDraftMessageId = (() => {
    const msgs = thread?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m && m.tripDraft) return m.id;
    }
    return null;
  })();

  /** การ์ดแผนที่คำนวณเสร็จแล้ว (ผูกกับข้อความที่สร้างมัน) */
  const renderPlanCard = (messageId: string, plan: TripPlan) => (
    <TripPlanCard
      plan={plan}
      notSelected={thread?.messages.find((m) => m.id === messageId)?.planMeta?.notSelected}
      aiWarnings={thread?.messages.find((m) => m.id === messageId)?.planMeta?.aiWarnings}
      folderWarning={
        thread?.messages.find((m) => m.id === messageId)?.planMeta?.folderWarning ?? null
      }
      busy={replanning === messageId || planning}
      onConfirm={() => handleConfirmPlan(messageId, plan)}
      onEditWithAi={() => handleEditWithAi(messageId, plan)}
      onAddStop={() => openNearby(messageId, plan)}
      onRemoveStop={(stopId) => handleRemoveStop(messageId, plan, stopId)}
      onMoveStop={(stopId, dir) => handleMoveStop(messageId, plan, stopId, dir)}
      onSelectLodging={(lodging) => handleSelectLodging(messageId, plan, lodging)}
      selectedLodgingName={selectedLodging[messageId] ?? null}
      onFuelPriceOverride={(price) => handleFuelOverride(messageId, plan, price)}
      fuelPriceOverride={fuelOverride[messageId] ?? null}
    />
  );

  /** การ์ดช่องข้อมูล (ก่อนสร้างแพลน) — ผู้ใช้แก้ช่องว่างได้ตรงนี้ */
  const renderDraftCard = () => (
    <TripDraftCard
      slots={draftSlots}
      onChange={(next) => setDraftSlots(next)}
      onCreatePlan={() => void handleCreatePlan(lastDraftMessageId ?? "")}
      creating={planning}
    />
  );

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
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
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
                      {item.content}
                    </Text>
                  </View>

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

                  {/* ยังไม่ได้สร้างแพลน → การ์ดช่องข้อมูล (โผล่ที่ข้อความล่าสุดที่มี draft เท่านั้น
                      เพื่อไม่ให้การ์ดซ้ำทุกข้อความ — เดิมปุ่ม "เลือกแพลนทริปนี้" ขึ้นทุกครั้งที่เอไaiตอบ) */}
                  {!mine &&
                  !failed &&
                  !item.plan &&
                  item.tripDraft &&
                  item.id === lastDraftMessageId
                    ? renderDraftCard()
                    : null}

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
            sending ? (
              <View className="flex-row items-center ml-9 mb-3">
                <ActivityIndicator size="small" color="#7C3AED" />
                <Text className="text-gray-400 text-[12px] ml-2">กำลังคิด...</Text>
              </View>
            ) : null
          }
        />
      )}

      {/* Composer */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Origin display chip if chosen */}
        {currentOrigin && (
          <View className="flex-row items-center mx-3 mt-1.5 bg-violet-50 border border-violet-200 rounded-xl px-3 py-1.5">
            <MapPinIcon size={14} color="#7C3AED" />
            <Text className="flex-1 text-violet-800 text-[11.5px] font-semibold ml-1.5" numberOfLines={1}>
              เริ่มจาก: {currentOrigin.label} ({currentOrigin.address})
            </Text>
            <TouchableOpacity onPress={() => setCurrentOrigin(null)} className="p-0.5">
              <XMarkIcon size={14} color="#7C3AED" />
            </TouchableOpacity>
          </View>
        )}

        {/* Attached-folder chip (only for a per-message attachment) */}
        {attachedFolder && (
          <View className="flex-row items-center mx-3 mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <FolderIcon size={16} color="#D47A3A" />
            <Text className="flex-1 text-amber-800 text-[12px] font-semibold ml-2" numberOfLines={1}>
              {attachedFolder.name} • {attachedFolder.videoIds.length} คลิป
            </Text>
            <TouchableOpacity onPress={() => setAttachedFolderId(null)} className="p-0.5">
              <XMarkIcon size={16} color="#B45309" />
            </TouchableOpacity>
          </View>
        )}

        {/* การ์ดโฟลเดอร์: รายชื่อสถานที่จริงที่โฟลเดอร์นี้ไป (แหล่งข้อมูลเดียวกับหน้าโฟลเดอร์) */}
        {folder && folderCtx && folderCtx.places.length > 0 && (
          <View className="mx-3 mt-2 bg-violet-50 border border-violet-100 rounded-xl px-3 py-2.5">
            <View className="flex-row items-center">
              <FolderIcon size={14} color="#7C3AED" />
              <Text className="text-violet-800 text-[11.5px] font-bold ml-1.5" numberOfLines={1}>
                {folder.name} • {folderCtx.clipCount} คลิป • {folderCtx.places.length} สถานที่
              </Text>
            </View>
            <View className="flex-row flex-wrap mt-1.5">
              {folderCtx.places.slice(0, 6).map((p) => (
                <View
                  key={p.key}
                  className={`flex-row items-center rounded-full px-2 py-0.5 mr-1.5 mb-1 ${
                    p.source === "registry" ? "bg-emerald-100" : "bg-amber-100"
                  }`}
                >
                  {p.source === "registry" ? (
                    <CheckBadgeIcon size={10} color="#059669" />
                  ) : (
                    <QuestionMarkCircleIcon size={10} color="#D97706" />
                  )}
                  <Text
                    className={`text-[10.5px] font-semibold ml-1 ${
                      p.source === "registry" ? "text-emerald-800" : "text-amber-800"
                    }`}
                  >
                    {p.name}
                  </Text>
                </View>
              ))}
              {folderCtx.places.length > 6 ? (
                <Text className="text-[10.5px] text-gray-500 self-center">
                  +{folderCtx.places.length - 6} แห่ง
                </Text>
              ) : null}
            </View>
            <Text className="text-[10.5px] text-gray-500">
              ลงทะเบียนแล้ว {folderCtx.registryHits} · จากคลิป {folderCtx.aiFallbacks}
            </Text>
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
    </View>
  );
}
