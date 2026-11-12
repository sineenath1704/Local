import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  ClockIcon,
  TruckIcon,
  PencilSquareIcon,
  CheckIcon,
  ArrowDownTrayIcon,
  BanknotesIcon,
  MapPinIcon,
  ChatBubbleLeftRightIcon,
  VideoCameraIcon,
  HomeModernIcon,
  BuildingStorefrontIcon,
  SparklesIcon,
  ArrowRightCircleIcon,
  FlagIcon,
  CheckBadgeIcon,
  QuestionMarkCircleIcon,
  ExclamationTriangleIcon,
  PlusIcon,
} from "react-native-heroicons/outline";
import { useAiPlanner } from "../../state/AiPlannerContext";
import {
  ItineraryDay,
  ItineraryStop,
  StopType,
  TripPlanLeg,
  WaypointKind,
} from "../../data/tripsData";
import { InitialPostLocation } from "../CreatePostScreen";
import TripRouteMap from "../../components/TripRouteMap";
import TripTimeRangeSheet, { timeToMinutes } from "../../components/TripTimeRangeSheet";

interface ItineraryViewerProps {
  tripId: string;
  onBack: () => void;
  onPostCheckin?: (loc: InitialPostLocation) => void;
}

function driveLabel(mins: number): string {
  if (mins <= 0) return "";
  if (mins < 60) return `ขับรถ ~${mins} นาที`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `ขับรถ ~${h} ชม.${m ? ` ${m} นาที` : ""}`;
}

/** ป้าย/สีของจุดแวะระหว่างทาง (ปั๊ม · ร้านอาหาร · ร้านสะดวกซื้อ · จุดพักรถ) */
const WAYPOINT_META: Record<
  WaypointKind,
  { label: string; emoji: string; color: string; bg: string; text: string }
> = {
  fuel: { label: "ปั๊ม", emoji: "⛽", color: "#EA580C", bg: "#FFF7ED", text: "#9A3412" },
  food: { label: "ร้านอาหาร", emoji: "🍜", color: "#D97706", bg: "#FFFBEB", text: "#92400E" },
  convenience: { label: "ร้านสะดวกซื้อ", emoji: "🏪", color: "#0891B2", bg: "#ECFEFF", text: "#164E63" },
  rest: { label: "จุดพักรถ", emoji: "🅿️", color: "#4F46E5", bg: "#EEF2FF", text: "#3730A3" },
};

const WAYPOINT_KINDS: WaypointKind[] = ["fuel", "food", "convenience", "rest"];

/** ค่าว่างคงที่ (ไม่สร้าง array ใหม่ทุก render) */
const EMPTY_DAYS: ItineraryDay[] = [];

/** "HH:mm" → นาที (null = ไม่ใช่เวลา) */
function toMinutesOrNull(t?: string | null): number | null {
  return timeToMinutes(t);
}

/** นาที → "HH:mm" (หมุนวัน) */
function fromMinutes(m: number): string {
  const total = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** ขยับเวลาไปข้างหน้า/หลังกี่นาที */
function shiftTime(t: string | undefined | null, delta: number): string | undefined {
  if (!t || !delta) return t ?? undefined;
  const m = toMinutesOrNull(t);
  if (m == null) return t;
  return fromMinutes(m + delta);
}

/** จุดที่ถูกเลือกไว้ในแผนที่ */
function shiftStop(s: ItineraryStop, delta: number): ItineraryStop {
  if (!delta) return s;
  return {
    ...s,
    startTime: shiftTime(s.startTime, delta),
    endTime: shiftTime(s.endTime, delta),
    arriveTime: shiftTime(s.arriveTime, delta),
    leaveTime: shiftTime(s.leaveTime, delta),
  };
}

/** ช่วงเวลาที่เลือก (เริ่ม–จบ) = กี่นาที (รองรับข้ามคืน) */
function rangeMinutes(start: string, end: string): number {
  const s = toMinutesOrNull(start) ?? 0;
  const e = toMinutesOrNull(end) ?? 0;
  if (e > s) return e - s;
  if (e === s) return 0;
  return e + 1440 - s;
}

/** เวลาที่อยู่ที่จุดนั้นเท่ากับกี่นาที (อ่านจากช่วงเวลา ถ้าไม่มีใช้ stayHours) */
function stayMinutesOf(stop: ItineraryStop): number {
  const s = toMinutesOrNull(stop.startTime);
  const e = toMinutesOrNull(stop.endTime);
  if (s != null && e != null && stop.startTime && stop.endTime) {
    return rangeMinutes(stop.startTime, stop.endTime);
  }
  return (stop.stayHours ?? 0) * 60;
}

/** รูปแบบของการ์ดจุด (สี · ป้าย · ไอคอน) — ใช้ทั้งจุดปกติและจุดแวะระหว่างทาง */
interface StopCfg {
  dotColor: string;
  badgeBg: string;
  badgeText: string;
  label: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
}

/** Color + icon + label per stop type — matches the trip plan UI in the app. */
function stopConfig(type?: StopType): StopCfg {
  switch (type) {
    case "departure":
      return { dotColor: "#6366F1", badgeBg: "#EEF2FF", badgeText: "#4338CA", label: "เริ่มต้น", Icon: FlagIcon };
    case "community":
      return { dotColor: "#2D6A4F", badgeBg: "#ECFDF5", badgeText: "#065F46", label: "ชุมชน OTOP", Icon: HomeModernIcon };
    case "attraction":
      return { dotColor: "#EF4444", badgeBg: "#FEF2F2", badgeText: "#B91C1C", label: "สถานที่ท่องเที่ยว", Icon: MapPinIcon };
    case "food":
      return { dotColor: "#F59E0B", badgeBg: "#FFFBEB", badgeText: "#92400E", label: "อาหาร", Icon: SparklesIcon };
    case "cafe":
      return { dotColor: "#D97706", badgeBg: "#FEF3C7", badgeText: "#92400E", label: "คาเฟ่", Icon: BuildingStorefrontIcon };
    case "accommodation":
      return { dotColor: "#7C3AED", badgeBg: "#F5F3FF", badgeText: "#5B21B6", label: "ที่พัก", Icon: HomeModernIcon };
    case "activity":
      return { dotColor: "#0891B2", badgeBg: "#ECFEFF", badgeText: "#164E63", label: "กิจกรรม", Icon: SparklesIcon };
    case "return":
      return { dotColor: "#64748B", badgeBg: "#F1F5F9", badgeText: "#475569", label: "เดินทางกลับ", Icon: ArrowRightCircleIcon };
    default:
      return { dotColor: "#7C3AED", badgeBg: "#F5F3FF", badgeText: "#5B21B6", label: "จุดแวะ", Icon: MapPinIcon };
  }
}

/**
 * แถว "จุดเริ่มต้น" — แถวแรกของแต่ละวันในไทม์ไลน์
 * -------------------------------------------------------------
 * จุดเริ่มต้นไม่ได้อยู่ใน `day.stops` (มันคือ “จุดที่บันทึกไว้” ไม่ใช่จุดแวะของทริป)
 * แต่แผนต้องอ่านออกว่า จุดเริ่มต้น → จุดเที่ยว → จุดกลับ
 * → วาดแยกแถวหนึ่ง พร้อมระยะ/เวลาของ “ขาแรก” (ขาออกจากจุดเริ่มต้น)
 * ขาแรก = leg ที่ fromIndex = 0 (จุดเริ่มต้นคือจุดแรกใน points)
 */
function StartPointRow({
  label,
  address,
  time,
  leg,
}: {
  label?: string | null;
  address?: string | null;
  time?: string;
  leg?: TripPlanLeg;
}) {
  if (!label) return null;
  const cfg = stopConfig("departure");
  return (
    <View className="flex-row mb-1">
      {/* Timeline rail */}
      <View className="items-center mr-3" style={{ width: 24 }}>
        <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: cfg.dotColor, marginTop: 14 }} />
        <View style={{ width: 2, flex: 1, backgroundColor: cfg.dotColor + "35", marginVertical: 3 }} />
      </View>

      {/* การ์ดจุดเริ่มต้น */}
      <View
        className="flex-1 rounded-2xl mb-3 overflow-hidden"
        style={{ borderWidth: 1, borderColor: cfg.dotColor + "30", backgroundColor: "#FAFAFA" }}
      >
        {/* Header — เวลา + ป้าย */}
        <View className="flex-row items-center justify-between px-3.5 py-2" style={{ backgroundColor: cfg.dotColor + "10" }}>
          <View className="flex-row items-center">
            <ClockIcon size={13} color={cfg.dotColor} />
            <Text style={{ color: cfg.dotColor, fontSize: 12, fontWeight: "700", marginLeft: 4 }}>
              {time ?? ""}
            </Text>
          </View>
          <View className="flex-row items-center rounded-full px-2.5 py-0.5" style={{ backgroundColor: cfg.badgeBg }}>
            <cfg.Icon size={11} color={cfg.badgeText} />
            <Text style={{ color: cfg.badgeText, fontSize: 10, fontWeight: "700", marginLeft: 3 }}>
              {cfg.label}
            </Text>
          </View>
        </View>

        {/* Body */}
        <View className="px-3.5 py-2.5">
          <Text className="text-[14px] font-bold text-gray-900 mb-0.5">{label}</Text>
          {address ? (
            <Text className="text-[11px] text-gray-400 mt-0.5 italic">{address}</Text>
          ) : null}
        </View>

        {/* ขาแรก: จุดเริ่มต้น → จุดแรก */}
        {leg ? (
          <View className="flex-row items-center px-3.5 py-2 border-t border-dashed" style={{ borderColor: cfg.dotColor + "25" }}>
            <TruckIcon size={12} color={cfg.dotColor} />
            <Text style={{ color: cfg.dotColor, fontSize: 11, marginLeft: 5 }}>
              {driveLabel(leg.minutes) || "เดินทาง"}
              {leg.km != null ? ` · ${leg.km.toFixed(1)} กม.` : ""} ไปจุดแรก
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function ItineraryViewer({ tripId, onBack, onPostCheckin }: ItineraryViewerProps) {
  const insets = useSafeAreaInsets();
  const { trips, updateTrip, setTripStatus, openChatWithSeed } = useAiPlanner();
  const trip = trips.find((t) => t.id === tripId);
  const [editing, setEditing] = useState(false);
  /**
   * ร่างที่แก้ไข (ยังไม่บันทึกลง DB)
   * → แก้ในร่างก่อน แล้วกด "ยืนยันการแก้ไข" ค่อยเขียนกลับ (ผู้ใช้มั่นใจว่าแก้จริง)
   */
  const [draft, setDraft] = useState<ItineraryDay[] | null>(null);
  /** กำลังเพิ่มจุดแวะในวันไหน (null = ไม่ได้กำลังเพิ่ม) */
  const [addingDay, setAddingDay] = useState<number | null>(null);
  const [newStopName, setNewStopName] = useState("");
  const [newStopTime, setNewStopTime] = useState("09:00");
  /** จุดที่เลือกในแผนที่ (ไฮไลต์การ์ดจุดนั้น) */
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  /** วันที่เลือกดูแผนที่ */
  const [mapDayIdx, setMapDayIdx] = useState(0);
  /** กำลังแก้ช่วงเวลาของจุดไหน */
  const [timeEdit, setTimeEdit] = useState<{ dayIdx: number; stopIdx: number } | null>(null);
  const [timeSheetOpen, setTimeSheetOpen] = useState(false);
  /** แผงเพิ่มจุดแวะระหว่างทาง (ใส่ในไทม์ไลน์ ไม่ซ้อน modal) */
  const [waypointPanel, setWaypointPanel] = useState<{ dayIdx: number; afterIdx: number } | null>(null);
  const [waypointKind, setWaypointKind] = useState<WaypointKind>("fuel");
  const [waypointName, setWaypointName] = useState("");
  const [waypointRange, setWaypointRange] = useState<{ start: string; end: string } | null>(null);
  const [wpSheetOpen, setWpSheetOpen] = useState(false);
  /** เลขรอบการเปิดล้อเวลา (บังคับให้ล้อกลับไปค่าที่เลือกทุกครั้งที่เปิด) */
  const [sheetKey, setSheetKey] = useState(0);

  /**
   * ข้อมูลที่แสดง = ร่างที่กำลังแก้ (ถ้ามี) ไม่งั้นใช้ของที่บันทึกแล้ว
   * (คำนวณก่อน early return เสมอ — hook ต้องมาก่อน return ทุกครั้งที่ render)
   */
  const days = draft ?? trip?.itinerary ?? EMPTY_DAYS;
  const hasDraft =
    !!draft && JSON.stringify(draft) !== JSON.stringify(trip?.itinerary);

  // ── ข้อมูลสำหรับแผนที่ ────────────────────────────────────────────
  const mapDay = days[Math.min(mapDayIdx, Math.max(0, days.length - 1))];
  // คำนวณตรง ๆ (ไม่ห่อ useMemo) — ให้ React Compiler จัดการ memoization เอง
  // (useMemo ที่ครอบ dependency ซึ่งอาจถูกแก้ในร่าง → compiler ข้ามการ optimize ทั้ง component)
  const mapStops = (mapDay?.stops ?? []).map((s, i) => ({
    id: `s-${mapDayIdx}-${i}`,
    name: s.name,
    coords: s.coordinates ?? null,
  }));
  const mapLegs = mapDay?.legs ?? [];

  if (!trip) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <Text className="text-gray-400">ไม่พบทริป</Text>
      </View>
    );
  }

  /** แก้วันที่ไหน (เขียนลงร่าง ไม่เขียนทับของเดิมทันที) */
  const patchDay = (dayIdx: number, fn: (d: ItineraryDay) => ItineraryDay) => {
    setDraft((prev) => {
      const base = prev ?? trip.itinerary;
      return base.map((d, i) => (i === dayIdx ? fn(d) : d));
    });
  };

  /** เริ่มแก้ไข — สร้างร่างจากของที่บันทึกแล้ว */
  const startEditing = () => {
    setDraft((prev) => prev ?? trip.itinerary);
    setEditing(true);
  };

  const updateStop = (dayIdx: number, stopIdx: number, patch: Partial<ItineraryStop>) => {
    patchDay(dayIdx, (d) => ({
      ...d,
      stops: d.stops.map((s, si) => (si === stopIdx ? { ...s, ...patch } : s)),
    }));
  };

  /** เวลาเริ่มต้นของจุดใหม่ = เวลาจุดสุดท้ายของวัน + 1 ชม. (ไม่มีข้อมูล → 09:00) */
  const suggestNextTime = (day: ItineraryDay): string => {
    const last = day.stops[day.stops.length - 1];
    const base = last?.startTime ?? last?.arriveTime ?? last?.leaveTime;
    if (!base) return "09:00";
    const m = /^(\d{1,2}):(\d{2})$/.exec(base.trim());
    if (!m) return "09:00";
    const total = (Number(m[1]) * 60 + Number(m[2]) + 60) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };

  /** เพิ่มจุดแวะท้ายวัน (กล่องใหม่โผล่ท้ายวันในรูปแบบเดียวกับกล่องเดิม) */
  const addStopToDay = (dayIdx: number) => {
    const name = newStopName.trim();
    if (!name) {
      Alert.alert("ยังไม่ได้ใส่ชื่อ", "พิมพ์ชื่อสถานที่ที่จะเพิ่มก่อน");
      return;
    }
    patchDay(dayIdx, (d) => ({
      ...d,
      stops: [
        ...d.stops,
        {
          name,
          activity: "",
          stayHours: 1,
          driveToNextMins: 0,
          startTime: newStopTime.trim() || "09:00",
          type: "attraction",
        },
      ],
    }));
    setNewStopName("");
    setAddingDay(null);
  };

  /**
   * แก้ช่วงเวลาที่จะอยู่ที่จุดนั้น (เริ่ม–จบ)
   * → จุดนั้นใช้เวลาใหม่ · จุดหลังจากนั้นเลื่อนตาม (ให้ทั้งวันต่อกัน)
   */
  const applyRangeToStop = (
    dayIdx: number,
    stopIdx: number,
    range: { start: string; end: string }
  ) => {
    patchDay(dayIdx, (d) => {
      const old = d.stops[stopIdx];
      if (!old) return d;
      const newStay = rangeMinutes(range.start, range.end);
      const delta = newStay - stayMinutesOf(old);
      const stops: ItineraryStop[] = d.stops.map((s, i) =>
        i === stopIdx
          ? {
              ...s,
              startTime: range.start,
              endTime: range.end,
              arriveTime: range.start,
              leaveTime: range.end,
              stayHours: Math.round((newStay / 60) * 100) / 100,
            }
          : i > stopIdx
          ? shiftStop(s, delta)
          : s
      );
      return { ...d, stops };
    });
  };

  /** เพิ่มจุดแวะระหว่างทาง (ปั๊ม · ร้านอาหาร · ร้านสะดวกซื้อ · จุดพักรถ) */
  const insertWaypoint = () => {
    if (!waypointPanel) return;
    const name = waypointName.trim();
    if (!name) {
      Alert.alert("ยังไม่ได้ใส่ชื่อ", "พิมพ์ชื่อจุดแวะที่จะเพิ่มก่อน");
      return;
    }
    if (!waypointRange) {
      Alert.alert("ยังไม่ได้ตั้งเวลา", "ต้องเลือกเวลาที่จะอยู่ที่จุดแวะนี้ก่อน");
      return;
    }
    const { dayIdx, afterIdx } = waypointPanel;
    const range = waypointRange;
    const kind = waypointKind;

    patchDay(dayIdx, (d) => {
      const stops = [...d.stops];
      const prev = stops[afterIdx];
      if (!prev) return d;
      const next = stops[afterIdx + 1];

      // แบ่งเวลา/ระยะเดินทางของจุดก่อนหน้าให้จุดแวะครึ่งหนึ่ง (รวมยอดเท่าเดิม)
      const halfDrive = Math.round((prev.driveToNextMins ?? 0) / 2);
      const halfKm =
        prev.distanceFromPrevKm != null
          ? Math.round((prev.distanceFromPrevKm / 2) * 10) / 10
          : null;

      const stay = rangeMinutes(range.start, range.end);
      const waypoint: ItineraryStop = {
        name,
        activity: WAYPOINT_META[kind].label,
        stayHours: Math.round((stay / 60) * 100) / 100,
        driveToNextMins: Math.max(0, (prev.driveToNextMins ?? 0) - halfDrive),
        startTime: range.start,
        endTime: range.end,
        arriveTime: range.start,
        leaveTime: range.end,
        type: "attraction",
        isWaypoint: true,
        waypointKind: kind,
        distanceFromPrevKm: halfKm,
        note: "จุดแวะระหว่างทาง",
      };

      // จุดก่อนหน้า: เวลาเดินทางไปจุดแวะ = ครึ่งหนึ่งของขาเดิม
      // (ระยะจากจุดก่อนหน้าของจุดนี้ไม่แตะ — มันคือระยะจากจุดก่อนหน้าของจุดก่อนหน้า)
      const updated: ItineraryStop[] = stops.map((s, i) =>
        i === afterIdx
          ? { ...s, driveToNextMins: halfDrive }
          : i === afterIdx + 1
          ? { ...s, distanceFromPrevKm: halfKm }
          : s
      );
      updated.splice(afterIdx + 1, 0, waypoint);

      // จุดหลังจากจุดแวะ → เลื่อนให้ต่อกับเวลาที่แวะจบ (คงช่องว่างเดิมไว้)
      const nextStart = toMinutesOrNull(next?.startTime);
      const prevEnd =
        toMinutesOrNull(prev.leaveTime ?? prev.endTime) ??
        toMinutesOrNull(prev.startTime);
      if (nextStart != null && prevEnd != null) {
        const gap = Math.max(0, nextStart - prevEnd);
        const newStart = rangeMinutes(range.start, range.end) + (toMinutesOrNull(range.start) ?? 0) + gap;
        const delta = newStart - nextStart;
        if (delta) {
          for (let i = afterIdx + 2; i < updated.length; i++) {
            updated[i] = shiftStop(updated[i], delta);
          }
        }
      }

      return { ...d, stops: updated };
    });

    setWaypointPanel(null);
    setWaypointName("");
    setWaypointRange(null);
    setWaypointKind("fuel");
  };

  /** ยืนยันการแก้ไข → เขียนกลับ (ซิงก์ลง trip_plans ผ่าน updateTrip) */
  const confirmEdits = () => {
    if (!draft) return;
    updateTrip(tripId, { itinerary: draft });
    setDraft(null);
    setEditing(false);
    Alert.alert(
      "บันทึกการแก้ไขแล้ว",
      "แผนที่แก้ไขถูกบันทึกเรียบร้อย (ซิงก์กับเซิร์ฟเวอร์ในไม่กี่วินาที)"
    );
  };

  /** ทิ้งร่าง → กลับไปใช้ของที่บันทึกไว้ */
  const discardEdits = () => {
    setDraft(null);
    setEditing(false);
    setWaypointPanel(null);
    Alert.alert("ยกเลิกการแก้ไข", "กลับไปใช้แพลนที่บันทึกไว้ก่อนแก้");
  };

  const b = trip.budget;
  const overBudget = !b.withinBudget;

  /**
   * สรุปแพลน (ร่างที่ยังไม่ยืนยัน ถ้ามี) → ส่งให้เอไAI ช่วยปรับ
   * มีช่วงเวลาที่อยู่ · จุดแวะระหว่างทาง · เวลาเดินทางต่อขา · ระยะ/เวลารวม
   */
  const sendBackToAi = () => {
    const source = draft ?? trip.itinerary;
    const dayLines = source
      .map((day) => {
        /** ลำดับจุดบนเส้นทาง (จุดแวะไม่มีพิกัด → ไม่นับ) */
        const routeIdxOf = (si: number) =>
          day.stops.slice(0, si).filter((s) => !s.isWaypoint).length;
        const stops = day.stops
          .map((s, i) => {
            const bits: string[] = [];
            if (s.startTime && s.endTime) bits.push(`${s.startTime}–${s.endTime}`);
            if (s.isWaypoint) {
              bits.push(`จุดแวะระหว่างทาง: ${WAYPOINT_META[s.waypointKind ?? "fuel"].label}`);
            }
            if (s.activity) bits.push(s.activity);
            if (s.stayHours > 0) bits.push(`อยู่ ${s.stayHours} ชม.`);

            // เวลา/ระยะที่เดินทาง "มาถึง" จุดนี้
            // → อ่านค่าที่บันทึกไว้ในจุด (ตรงกับที่แสดงในไทม์ไลน์) · ถ้าไม่มีค่อยดูขาเดินทาง
            const prevStop = day.stops[i - 1];
            const leg = (day.legs ?? []).find((l) => l.toIndex === routeIdxOf(i) + 1);
            // จุดแวะระหว่างทางแบ่งขาเดินทางครึ่งหนึ่ง (ตอนเพิ่มจุดแวะ)
            const factor = s.isWaypoint ? 0.5 : 1;
            const inMins =
              prevStop?.driveToNextMins ||
              (leg ? Math.round(leg.minutes * factor) : 0);
            const inKm =
              s.distanceFromPrevKm != null
                ? s.distanceFromPrevKm
                : leg
                ? Math.round(leg.km * factor * 10) / 10
                : null;
            if (inMins > 0 || inKm != null) {
              bits.push(
                `เดินทางมา ${inKm != null ? inKm.toFixed(1) : "-"} กม. / ${inMins} นาที`
              );
            }
            return `   • ${s.name}${bits.length ? ` — ${bits.join(" · ")}` : ""}`;
          })
          .join("\n");
        const totalKm = day.totalKm ?? 0;
        const totalDrive = day.totalDriveMinutes ?? 0;
        return (
          `วันที่ ${day.day}:\n${stops}\n` +
          `   รวมวันนี้: ${totalKm.toFixed(1)} กม. · เวลาเดินทาง ${totalDrive} นาที`
        );
      })
      .join("\n");

    const summary =
      `ช่วยปรับแผนทริปนี้ให้หน่อย — ผมแก้เวลา/จุดแวะเองแล้ว ` +
      `ช่วยเช็คให้เข้ากันและแนะนำจุดที่ควรเพิ่ม\n\n` +
      (hasDraft ? "⚠️ ด้านล่างคือร่างที่ยังไม่ได้กดยืนยัน\n\n" : "") +
      `ทริป: ${trip.title}\n` +
      `ออกจาก: ${trip.startPoint} • ${trip.days} วัน ${trip.nights} คืน` +
      `${trip.startTime ? ` • ออกเดินทาง ${trip.startTime}` : ""}\n` +
      `งบต่อคน: ${trip.budgetPerPerson.toLocaleString()} ฿ (ประเมินใช้จริง ${b.perPerson.toLocaleString()} ฿)\n\n` +
      `${dayLines}`;
    openChatWithSeed(summary, { planContext: trip });
  };

  return (
    <View className="flex-1 bg-white">
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View
        style={{ paddingTop: Math.max(insets.top, 12) + (Platform.OS === "android" ? 8 : 4) }}
        className="px-3 pb-3 flex-row items-center border-b border-gray-100"
      >
        <TouchableOpacity onPress={onBack} className="p-1 mr-1">
          <ArrowLeftIcon size={24} color="#18181B" strokeWidth={2} />
        </TouchableOpacity>
        <Text className="text-[15px] font-black text-gray-900 flex-1" numberOfLines={1}>
          {trip.title}
        </Text>
        <TouchableOpacity
          onPress={() => {
            if (editing) {
              setEditing(false);
            } else {
              startEditing();
            }
          }}
          className={`flex-row items-center px-3 py-1.5 rounded-full ${editing ? "bg-emerald-100" : "bg-gray-100"}`}
        >
          {editing ? <CheckIcon size={15} color="#2D6A4F" /> : <PencilSquareIcon size={15} color="#4B5563" />}
          <Text className={`text-[12px] font-bold ml-1 ${editing ? "text-[#2D6A4F]" : "text-gray-600"}`}>
            {editing ? "เสร็จ" : "แก้ไข"}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 220 }} showsVerticalScrollIndicator={false}>
        {/* Summary */}
        <View className="px-5 pt-4 pb-2">
          <Text className="text-gray-600 text-[13px] leading-5">{trip.summary}</Text>
          <View className="flex-row items-center mt-2 flex-wrap">
            <View className="flex-row items-center mr-4">
              <MapPinIcon size={14} color="#EF4444" />
              <Text className="text-gray-500 text-[12px] ml-1">{trip.startPoint}</Text>
            </View>
            <Text className="text-gray-500 text-[12px]">
              {trip.days} วัน {trip.nights} คืน
            </Text>
          </View>
        </View>

        {/* ── แผนที่เส้นทาง ─────────────────────────────────────── */}
        <View className="px-5 mt-3">
          {days.length > 1 ? (
            <View className="flex-row mb-2 flex-wrap">
              {days.map((d, i) => (
                <TouchableOpacity
                  key={d.day}
                  onPress={() => setMapDayIdx(i)}
                  activeOpacity={0.8}
                  className={`mr-2 px-3 py-1.5 rounded-full ${
                    mapDayIdx === i
                      ? "bg-violet-600"
                      : "bg-gray-100"
                  }`}
                >
                  <Text
                    className={`text-[12px] font-bold ${
                      mapDayIdx === i ? "text-white" : "text-gray-600"
                    }`}
                  >
                    วันที่ {d.day}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <TripRouteMap
            startPoint={{
              label: trip.startPoint,
              coords: trip.startPointCoords ?? mapDay?.startPoint?.coords ?? null,
            }}
            endPoint={{
              label: trip.endPoint ?? trip.startPoint,
              coords:
                trip.endPointCoords ??
                mapDay?.endPoint?.coords ??
                trip.startPointCoords ??
                null,
            }}
            returnMode={trip.returnMode ?? "same_as_start"}
            stops={mapStops}
            legs={mapLegs}
            height={230}
            onSelectStop={(id) => setSelectedStopId(id)}
            selectedStopId={selectedStopId}
            routeSource={trip.routeSource}
            routeCredit={trip.routeCredit}
          />
        </View>

        {/* สถานที่ที่แพลนนี้ไป — รายการเดียวกับหน้าโฟลเดอร์และในแชท
            (มาจาก backend ชุดเดียวกัน → ป้ายที่มาตรงกันทั้ง 3 ที่) */}
        {trip.folderPlaces && trip.folderPlaces.length > 0 ? (
          <View className="mx-5 my-3 rounded-2xl p-4 bg-violet-50 border border-violet-200">
            <View className="flex-row items-center mb-2.5">
              <MapPinIcon size={18} color="#6D28D9" />
              <Text className="font-bold text-[13px] ml-2 text-violet-900">
                สถานที่ที่แพลนนี้ไป
              </Text>
              <Text className="text-[11px] text-violet-700 ml-auto font-medium">
                {trip.folderPlaces.length} แห่ง
              </Text>
            </View>
            {trip.folderPlaces.map((p) => {
              const confirmed = p.source === "registry";
              return (
                <View key={p.name} className="flex-row items-center py-1.5">
                  <View className="flex-1 pr-2">
                    <Text className="text-[12.5px] font-semibold text-gray-900">
                      {p.name}
                    </Text>
                    <Text className="text-[11px] text-gray-500 mt-0.5" numberOfLines={1}>
                      {[p.communityName, p.address].filter(Boolean).join(" · ") ||
                        (confirmed ? "ยืนยันในทะเบียนสถานที่แล้ว" : "มาจากข้อความในคลิป")}
                    </Text>
                  </View>
                  {p.clipCount ? (
                    <Text className="text-[11px] text-gray-500 mr-2">
                      {p.clipCount} คลิป
                    </Text>
                  ) : null}
                  <View
                    className={`flex-row items-center rounded-full px-2 py-1 ${
                      confirmed ? "bg-emerald-50" : "bg-amber-50"
                    }`}
                  >
                    {confirmed ? (
                      <CheckBadgeIcon size={12} color="#059669" />
                    ) : (
                      <QuestionMarkCircleIcon size={12} color="#D97706" />
                    )}
                    <Text
                      className={`text-[10px] font-bold ml-1 ${
                        confirmed ? "text-emerald-700" : "text-amber-700"
                      }`}
                    >
                      {confirmed ? "ลงทะเบียนแล้ว" : "ยังไม่ยืนยัน"}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Budget summary */}
        <View className={`mx-5 my-3 rounded-2xl p-4 border ${overBudget ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"}`}>
          <View className="flex-row items-center mb-2.5">
            <BanknotesIcon size={18} color={overBudget ? "#DC2626" : "#2D6A4F"} />
            <Text className={`font-bold text-[13px] ml-2 ${overBudget ? "text-red-700" : "text-[#1B4332]"}`}>
              สรุปงบประมาณ (ต่อคน)
            </Text>
          </View>
          {[
            ["ที่พัก", b.lodging],
            ["ค่าน้ำมัน", b.fuel],
            ["ค่าอาหาร", b.food],
          ].map(([label, val]) => (
            <View key={label as string} className="flex-row justify-between mb-1">
              <Text className="text-gray-600 text-[12.5px]">{label}</Text>
              <Text className="text-gray-800 text-[12.5px] font-medium">{(val as number).toLocaleString()} ฿</Text>
            </View>
          ))}
          <View className="h-px bg-gray-200 my-2" />
          <View className="flex-row justify-between items-center">
            <Text className="text-gray-900 font-bold text-[14px]">รวม</Text>
            <Text className={`font-black text-[16px] ${overBudget ? "text-red-600" : "text-[#2D6A4F]"}`}>
              {b.perPerson.toLocaleString()} ฿
            </Text>
          </View>
          <Text className={`text-[11px] mt-1 ${overBudget ? "text-red-500" : "text-emerald-600"}`}>
            {overBudget
              ? `เกินงบที่ตั้งไว้ (${trip.budgetPerPerson.toLocaleString()} ฿)`
              : `อยู่ในงบ ${trip.budgetPerPerson.toLocaleString()} ฿ ✓`}
          </Text>
        </View>

        {/* Timeline */}
        {days.map((day, di) => (
          <View key={day.day} className="px-5 mt-3">
            <View className="flex-row items-center mb-3">
              <View className="bg-violet-600 rounded-xl px-3 py-1.5">
                <Text className="text-white font-black text-[13px]">Day {day.day}</Text>
              </View>
              <View className="flex-1 h-px bg-gray-200 ml-3" />
              {day.totalKm ? (
                <Text className="text-[11.5px] text-gray-500 ml-2">
                  {day.totalKm.toFixed(1)} กม. · เดินทาง {day.totalDriveMinutes ?? 0} นาที
                </Text>
              ) : null}
            </View>

            {/* ── จุดเริ่มต้น (แถวแรกของแพลน) ───────────────────────── */}
            <StartPointRow
              label={day.startPoint?.label ?? trip.startPoint}
              address={day.startPoint?.address ?? null}
              time={di === 0 ? trip.startTime : undefined}
              leg={(day.legs ?? []).find((l) => l.fromIndex === 0)}
            />

            {day.stops.map((stop, si) => {
              const isWaypoint = !!stop.isWaypoint;
              const wpMeta = isWaypoint
                ? WAYPOINT_META[stop.waypointKind ?? "fuel"]
                : null;
              const cfg: StopCfg = wpMeta
                ? {
                    dotColor: wpMeta.color,
                    badgeBg: wpMeta.bg,
                    badgeText: wpMeta.text,
                    label: `${wpMeta.emoji} ${wpMeta.label}`,
                    Icon: MapPinIcon,
                  }
                : stopConfig(stop.type);
              const isLast = si === day.stops.length - 1;
              const stopId = `s-${di}-${si}`;
              /**
               * ลำดับจุดบนเส้นทาง (จุดแวะไม่มีพิกัด → ไม่นับ)
               * → ขาเดินทางอ้างอิงด้วยลำดับนี้ (ไม่ใช่ลำดับในรายการ)
               */
              const routeIdx = day.stops.slice(0, si).filter((s) => !s.isWaypoint).length;
              /** ขาเดินทางที่พาจากจุดนี้ไปจุดถัดไป */
              const legOut = (day.legs ?? []).find((l) => l.fromIndex === routeIdx + 1);
              /** จุดถัดไปในลำดับ (รวมจุดแวะ) — ระยะจากจุดนี้ไปจุดถัดไปอยู่ที่จุดนั้น */
              const nextStop = day.stops[si + 1];
              // ใช้ค่าที่บันทึกไว้ในจุดก่อน (ตรงกับการแบ่งขาเดินทางตอนเพิ่มจุดแวะ)
              const driveMins = stop.driveToNextMins || legOut?.minutes || 0;
              const driveKm = nextStop?.distanceFromPrevKm ?? legOut?.km ?? null;
              return (
              <React.Fragment key={stop.id ?? `${stop.name}-${si}`}>
              <View className="flex-row mb-1">
                {/* Timeline rail */}
                <View className="items-center mr-3" style={{ width: 24 }}>
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: cfg.dotColor, marginTop: 14 }} />
                  {!isLast && <View style={{ width: 2, flex: 1, backgroundColor: cfg.dotColor + "35", marginVertical: 3 }} />}
                </View>

                {/* Stop card */}
                <View
                  className="flex-1 rounded-2xl mb-3 overflow-hidden"
                  style={{
                    borderWidth: 1,
                    borderColor:
                      selectedStopId === stopId ? "#7C3AED" : cfg.dotColor + "30",
                    backgroundColor: "#FAFAFA",
                  }}
                >
                  {/* Header — time + type badge */}
                  <TouchableOpacity
                    onPress={() => setSelectedStopId(stopId === selectedStopId ? null : stopId)}
                    activeOpacity={0.8}
                    className="flex-row items-center justify-between px-3.5 py-2"
                    style={{ backgroundColor: cfg.dotColor + "10" }}
                  >
                    <View className="flex-row items-center">
                      <ClockIcon size={13} color={cfg.dotColor} />
                      <Text style={{ color: cfg.dotColor, fontSize: 12, fontWeight: "700", marginLeft: 4 }}>
                        {stop.startTime ?? ""}
                        {stop.endTime ? ` – ${stop.endTime}` : ""}
                      </Text>
                    </View>
                    <View className="flex-row items-center rounded-full px-2.5 py-0.5" style={{ backgroundColor: cfg.badgeBg }}>
                      <cfg.Icon size={11} color={cfg.badgeText} />
                      <Text style={{ color: cfg.badgeText, fontSize: 10, fontWeight: "700", marginLeft: 3 }}>
                        {cfg.label}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {/* Body */}
                  <View className="px-3.5 py-2.5">
                    {editing ? (
                      <TextInput
                        value={stop.name}
                        onChangeText={(t) => updateStop(di, si, { name: t })}
                        className="text-[14px] font-bold text-gray-900 bg-white rounded-lg px-2 py-1 mb-1.5 border border-gray-200"
                      />
                    ) : (
                      <Text className="text-[14px] font-bold text-gray-900 mb-0.5">{stop.name}</Text>
                    )}
                    {editing ? (
                      <TextInput
                        value={stop.activity}
                        onChangeText={(t) => updateStop(di, si, { activity: t })}
                        className="text-[12.5px] text-gray-700 bg-white rounded-lg px-2 py-1 mb-2 border border-gray-200"
                      />
                    ) : (
                      <Text className="text-[12.5px] text-gray-500 mb-2">{stop.activity}</Text>
                    )}

                    {/* Tags */}
                    <View className="flex-row flex-wrap items-center">
                      {stop.stayHours > 0 && (
                        <View className="flex-row items-center bg-white rounded-full px-2.5 py-1 mr-1.5 mb-1 border border-gray-200">
                          <ClockIcon size={11} color="#6B7280" />
                          <Text className="text-[11px] text-gray-600 ml-1">อยู่ {stop.stayHours} ชม.</Text>
                        </View>
                      )}
                      {stop.estimatedCost != null && stop.estimatedCost > 0 && (
                        <View className="flex-row items-center bg-white rounded-full px-2.5 py-1 mr-1.5 mb-1 border border-gray-200">
                          <BanknotesIcon size={11} color="#6B7280" />
                          <Text className="text-[11px] text-gray-600 ml-1">~{stop.estimatedCost.toLocaleString()} ฿</Text>
                        </View>
                      )}
                      {stop.verified === false && (
                        <View className="bg-amber-50 rounded-full px-2.5 py-1 mr-1.5 mb-1 border border-amber-200">
                          <Text className="text-[10px] text-amber-700">ข้อมูลประมาณการ</Text>
                        </View>
                      )}
                    </View>
                    {stop.note ? <Text className="text-[11px] text-gray-400 mt-0.5 italic">{stop.note}</Text> : null}

                    {/* แก้เวลาที่จะอยู่ (ล้อเริ่ม–จบ) */}
                    {editing ? (
                      <TouchableOpacity
                        onPress={() => {
                          setTimeEdit({ dayIdx: di, stopIdx: si });
                          setSheetKey((k) => k + 1);
                          setTimeSheetOpen(true);
                        }}
                        activeOpacity={0.85}
                        className="flex-row items-center self-start mt-2 bg-violet-50 border border-violet-200 rounded-full px-2.5 py-1"
                      >
                        <PencilSquareIcon size={11} color="#7C3AED" />
                        <Text className="text-[11px] font-bold text-violet-700 ml-1">
                          แก้ไขเวลาที่จะอยู่
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  {/* Drive to next */}
                  {(driveMins > 0 || driveKm != null) && (
                    <View className="flex-row items-center px-3.5 py-2 border-t border-dashed" style={{ borderColor: cfg.dotColor + "25" }}>
                      <TruckIcon size={12} color={cfg.dotColor} />
                      <Text style={{ color: cfg.dotColor, fontSize: 11, marginLeft: 5 }}>
                        {driveLabel(driveMins) || "เดินทางต่อ"}
                        {driveKm != null ? ` · ${driveKm.toFixed(1)} กม.` : ""}
                      </Text>
                    </View>
                  )}

                  {/* เพิ่มจุดแวะระหว่างทาง */}
                  {editing && !isLast ? (
                    <TouchableOpacity
                      onPress={() => {
                        setWaypointPanel({ dayIdx: di, afterIdx: si });
                        setWaypointKind("fuel");
                        setWaypointName("");
                        setWaypointRange(null);
                      }}
                      activeOpacity={0.85}
                      className="flex-row items-center justify-center px-3.5 py-2 border-t"
                      style={{ borderColor: cfg.dotColor + "25", backgroundColor: cfg.dotColor + "08" }}
                    >
                      <PlusIcon size={13} color={cfg.dotColor} />
                      <Text style={{ color: cfg.dotColor, fontSize: 12, fontWeight: "700", marginLeft: 5 }}>
                        เพิ่มจุดแวะระหว่างทาง
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  {/* Post check-in */}
                  {(trip.status === "completed" || trip.status === "active") && (
                    <TouchableOpacity
                      onPress={() => {
                        if (onPostCheckin) {
                          onPostCheckin({ placeName: stop.name, community: stop.community || stop.name, province: stop.province, district: stop.district, coords: stop.coordinates });
                        } else {
                          Alert.alert("โพสต์เช็คอิน", `ระบบจะเปิดหน้าโพสต์คลิปพร้อมดึงสถานที่ "${stop.name}" ให้อัตโนมัติ`);
                        }
                      }}
                      activeOpacity={0.85}
                      className="flex-row items-center justify-center px-3.5 py-2 border-t"
                      style={{ borderColor: cfg.dotColor + "25", backgroundColor: cfg.dotColor + "08" }}
                    >
                      <VideoCameraIcon size={14} color={cfg.dotColor} />
                      <Text style={{ color: cfg.dotColor, fontSize: 12, fontWeight: "700", marginLeft: 5 }}>โพสต์คลิป ณ ที่นี้</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* ── แผงเพิ่มจุดแวะระหว่างทาง ───────────────────── */}
              {waypointPanel &&
              waypointPanel.dayIdx === di &&
              waypointPanel.afterIdx === si ? (
                <View className="flex-row mb-1">
                  <View style={{ width: 24 }} className="mr-3" />
                  <View className="flex-1 mb-3">
                    <View className="bg-orange-50 border border-orange-200 rounded-2xl p-3">
                      <Text className="text-[12.5px] font-bold text-gray-900 mb-2">
                        จุดแวะระหว่างทาง (ระหว่าง {day.stops[si]?.name} →{" "}
                        {day.stops[si + 1]?.name})
                      </Text>

                      <View className="flex-row flex-wrap mb-2">
                        {WAYPOINT_KINDS.map((k) => {
                          const meta = WAYPOINT_META[k];
                          const active = waypointKind === k;
                          return (
                            <TouchableOpacity
                              key={k}
                              onPress={() => setWaypointKind(k)}
                              activeOpacity={0.8}
                              className={`mr-1.5 mb-1.5 px-2.5 py-1.5 rounded-full border ${
                                active
                                  ? "bg-orange-500 border-orange-500"
                                  : "bg-white border-gray-200"
                              }`}
                            >
                              <Text
                                className={`text-[11.5px] font-bold ${
                                  active ? "text-white" : "text-gray-700"
                                }`}
                              >
                                {meta.emoji} {meta.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      <TextInput
                        value={waypointName}
                        onChangeText={setWaypointName}
                        placeholder="ชื่อจุดแวะ (เช่น ปั๊มบางใหญ่)"
                        placeholderTextColor="#9CA3AF"
                        className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-[13.5px] text-gray-900"
                      />

                      <TouchableOpacity
                        onPress={() => {
                          setSheetKey((k) => k + 1);
                          setWpSheetOpen(true);
                        }}
                        activeOpacity={0.85}
                        className="flex-row items-center justify-between bg-white border border-gray-200 rounded-xl px-3 py-2 mt-2"
                      >
                        <View className="flex-row items-center">
                          <ClockIcon size={14} color="#7C3AED" />
                          <Text className="text-[12.5px] text-gray-700 ml-1.5">
                            เวลาที่จะอยู่
                          </Text>
                        </View>
                        <Text
                          className={`text-[13px] font-bold ${
                            waypointRange ? "text-violet-700" : "text-gray-400"
                          }`}
                        >
                          {waypointRange
                            ? `${waypointRange.start} – ${waypointRange.end}`
                            : "ยังไม่ได้ตั้ง"}
                        </Text>
                      </TouchableOpacity>

                      <View className="flex-row items-center mt-2.5">
                        <TouchableOpacity
                          onPress={insertWaypoint}
                          activeOpacity={0.85}
                          className="bg-orange-500 rounded-xl px-4 py-2"
                        >
                          <Text className="text-white text-[13px] font-bold">เพิ่มจุดแวะ</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => {
                            setWaypointPanel(null);
                            setWaypointRange(null);
                          }}
                          activeOpacity={0.7}
                          className="px-3 py-2 ml-1"
                        >
                          <Text className="text-gray-500 text-[12.5px] font-bold">ยกเลิก</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>
              ) : null}
              </React.Fragment>
              );
            })}

            {/* ── เพิ่มจุดแวะท้ายวัน ───────────────────────────────── */}
            <View className="flex-row">
              <View style={{ width: 24 }} className="mr-3" />
              <View className="flex-1 mb-3">
                {addingDay === di ? (
                  <View className="bg-violet-50 border border-violet-200 rounded-2xl p-3">
                    <TextInput
                      value={newStopName}
                      onChangeText={setNewStopName}
                      placeholder="ชื่อสถานที่ที่จะเพิ่ม"
                      placeholderTextColor="#9CA3AF"
                      className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-gray-900"
                    />
                    <View className="flex-row items-center mt-2">
                      <TextInput
                        value={newStopTime}
                        onChangeText={setNewStopTime}
                        placeholder="09:00"
                        placeholderTextColor="#9CA3AF"
                        keyboardType="numbers-and-punctuation"
                        className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-[13px] text-gray-900 w-24"
                      />
                      <TouchableOpacity
                        onPress={() => addStopToDay(di)}
                        activeOpacity={0.85}
                        className="bg-violet-600 rounded-xl px-4 py-2 ml-2"
                      >
                        <Text className="text-white text-[13px] font-bold">เพิ่ม</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          setAddingDay(null);
                          setNewStopName("");
                        }}
                        activeOpacity={0.7}
                        className="px-3 py-2 ml-1"
                      >
                        <Text className="text-gray-500 text-[12.5px] font-bold">ยกเลิก</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => {
                      if (!editing) startEditing();
                      setAddingDay(di);
                      setNewStopName("");
                      setNewStopTime(suggestNextTime(day));
                    }}
                    activeOpacity={0.8}
                    className="flex-row items-center justify-center bg-white border border-dashed border-violet-300 rounded-2xl py-2.5"
                  >
                    <MapPinIcon size={15} color="#7C3AED" />
                    <Text className="text-violet-700 text-[13px] font-bold ml-1.5">
                      + เพิ่มจุดแวะ
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Footer: แถบยืนยันการแก้ไข + สถานะ + ส่งให้ AI + ปุ่มอื่น */}
      <View
        className="px-5 pt-3 border-t border-gray-100 bg-white"
        style={{ paddingBottom: Math.max(insets.bottom, 14) }}
      >
        {/* แถบยืนยันการแก้ไข — โผล่เมื่อมีร่างที่ยังไม่บันทึก */}
        {hasDraft ? (
          <View className="flex-row items-center bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2.5 mb-2.5">
            <ExclamationTriangleIcon size={16} color="#B45309" />
            <Text className="text-amber-900 text-[11.5px] font-bold ml-1.5 flex-1">
              มีการแก้ไขที่ยังไม่บันทึก
            </Text>
            <TouchableOpacity
              onPress={discardEdits}
              activeOpacity={0.8}
              className="px-2.5 py-1.5 rounded-lg border border-amber-300 bg-white"
            >
              <Text className="text-[11.5px] font-bold text-gray-600">ยกเลิก</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={confirmEdits}
              activeOpacity={0.85}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 ml-1.5"
            >
              <Text className="text-[11.5px] font-bold text-white">ยืนยันการแก้ไข</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Status indicator bar */}
        <View className="flex-row items-center justify-between mb-2.5 bg-gray-50 p-2 rounded-xl border border-gray-200">
          <Text className="text-[11.5px] font-bold text-gray-700">สถานะทริป:</Text>
          <View className="flex-row gap-1">
            {(
              [
                ["draft", "ดราฟ"],
                ["planned", "แพลนเสร็จ"],
                ["active", "กำลังเที่ยว"],
                ["completed", "เที่ยวสำเร็จ"],
              ] as const
            ).map(([sKey, sLabel]) => (
              <TouchableOpacity
                key={sKey}
                onPress={() => {
                  setTripStatus(tripId, sKey);
                  Alert.alert("อัปเดตสถานะแล้ว", `เปลี่ยนสถานะเป็น "${sLabel}" เรียบร้อย`);
                }}
                className={`px-2 py-1 rounded-lg ${trip.status === sKey ? "bg-violet-600" : "bg-white border border-gray-200"}`}
              >
                <Text
                  className={`text-[10.5px] font-bold ${trip.status === sKey ? "text-white" : "text-gray-600"}`}
                >
                  {sLabel}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Hand the plan back to น้องโลคอล to re-plan / discuss */}
        <TouchableOpacity
          onPress={sendBackToAi}
          activeOpacity={0.85}
          className="flex-row items-center justify-center bg-violet-50 border border-violet-200 rounded-2xl py-3 mb-2"
        >
          <ChatBubbleLeftRightIcon size={18} color="#7C3AED" />
          <Text className="text-violet-700 font-bold text-[13px] ml-1.5">
            ส่งให้ AI ช่วยปรับ / คุยต่อในแชทเดิม
          </Text>
        </TouchableOpacity>

        <View className="flex-row">
          <TouchableOpacity
            onPress={() =>
              Alert.alert(
                "ส่งออกแผนการเดินทาง",
                "บันทึกกำหนดการลงปฏิทิน (.ics) หรือแชร์รูปสรุปทริปเรียบร้อย"
              )
            }
            activeOpacity={0.85}
            className="flex-1 flex-row items-center justify-center bg-gray-100 rounded-2xl py-3.5 mr-2"
          >
            <ArrowDownTrayIcon size={18} color="#374151" />
            <Text className="text-gray-700 font-bold text-[13px] ml-1.5">ส่งออกทริป</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              const nextStatus =
                trip.status === "draft"
                  ? "planned"
                  : trip.status === "planned"
                  ? "active"
                  : "completed";
              setTripStatus(tripId, nextStatus);
              Alert.alert("บันทึกทริปแล้ว", "อัปเดตสถานะเรียบร้อย");
              onBack();
            }}
            activeOpacity={0.85}
            className="flex-1 items-center justify-center bg-violet-600 rounded-2xl py-3.5"
          >
            <Text className="text-white font-bold text-[14px]">
              {trip.status === "draft"
                ? "ยืนยันแพลนทริปนี้"
                : trip.status === "planned"
                ? "เริ่มออกเดินทาง 🚗"
                : "ปิดทริปสำเร็จ 🎉"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── ล้อเลือกช่วงเวลาของจุด ───────────────────────────────── */}
      <TripTimeRangeSheet
        visible={timeSheetOpen}
        initialStart={
          timeEdit ? days[timeEdit.dayIdx]?.stops[timeEdit.stopIdx]?.startTime : undefined
        }
        initialEnd={
          timeEdit ? days[timeEdit.dayIdx]?.stops[timeEdit.stopIdx]?.endTime : undefined
        }
        title="เวลาที่จะอยู่ที่จุดนี้"
        subtitle="เลือกเวลาเริ่มที่จะอยู่ และเวลาสิ้นสุด (ทีละ 5 นาที)"
        resetKey={sheetKey}
        onCancel={() => {
          setTimeSheetOpen(false);
          setTimeEdit(null);
        }}
        onConfirm={(range) => {
          if (timeEdit) applyRangeToStop(timeEdit.dayIdx, timeEdit.stopIdx, range);
          setTimeSheetOpen(false);
          setTimeEdit(null);
        }}
      />

      {/* ── ล้อเลือกช่วงเวลาของจุดแวะระหว่างทาง ─────────────────── */}
      <TripTimeRangeSheet
        visible={wpSheetOpen}
        initialStart={waypointRange?.start}
        initialEnd={waypointRange?.end}
        title="เวลาที่จะแวะจุดนี้"
        subtitle="เลือกเวลาเริ่มที่จะอยู่ และเวลาสิ้นสุด (ทีละ 5 นาที)"
        resetKey={sheetKey}
        onCancel={() => setWpSheetOpen(false)}
        onConfirm={(range) => {
          setWaypointRange(range);
          setWpSheetOpen(false);
        }}
      />
    </View>
  );
}
