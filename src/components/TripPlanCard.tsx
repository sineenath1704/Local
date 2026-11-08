import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Linking,
  ActivityIndicator,
  Image,
  ScrollView,
  Modal,
} from "react-native";
import {
  MapPinIcon,
  ClockIcon,
  PhoneIcon,
  GlobeAltIcon,
  ExclamationTriangleIcon,
  CheckBadgeIcon,
  InformationCircleIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  TrashIcon,
  SparklesIcon,
  CalendarDaysIcon,
  BanknotesIcon,
  PlayIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  XMarkIcon,
  PencilSquareIcon,
} from "react-native-heroicons/outline";
import {
  TripPlan,
  TripPlanDay,
  TripPlanLodging,
  TripPlanOpenHours,
  VEHICLE_CLASS_OPTIONS,
  vehicleClassOf,
  type VehicleClass,
} from "../data/tripsData";
import TripRouteMap from "./TripRouteMap";
import TripRouteTimeline from "./TripRouteTimeline";
import EditableValueRow from "./EditableValueRow";
import {
  vehicleModelSuggestions,
  type VehicleCategory,
} from "../data/vehicleData";

/**
 * การ์ด "แผนทริปที่คำนวณแล้ว"
 * =============================================================
 * แสดง: จุดเริ่ม → จุดสิ้นสุด · แผนที่เส้นทางจริง · ตารางเวลารายวัน
 *       · เวลาเปิด-ปิด · วิธีจอง/ติดต่อ · ต้นทุน (พร้อมที่มาของราคาน้ำมัน)
 *       · ที่พักที่ระบบเสนอ · ข้อควรระวัง
 * และปุ่ม: ยืนยันและบันทึก · เพิ่มจุดแวะ · แก้ไขกับเอไai
 */

function money(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString("th-TH")} ฿`;
}

function km(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)} กม.`;
}

function mins(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const m = Math.round(n);
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} ชม. ${r} นาที` : `${h} ชม.`;
}

/** ขาเส้นทางว่าง — ใช้ค่าเดียวทั้งแอป ไม่สร้าง array ใหม่ทุกครั้งที่ re-render */
const EMPTY_LEGS: TripPlanDay["legs"] = [];

/** คลิปว่าง — ค่าเดียวทั้งแอป (ไม่สร้าง array ใหม่ทุกครั้งที่ re-render) */
const EMPTY_STOP_CLIPS: {
  videoId: string;
  thumbnailUrl: string | null;
  caption: string | null;
}[] = [];

/** แปลงวันที่ ISO (2026-11-08) เป็นข้อความไทยอ่านง่าย */
const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function openHoursBadge(h?: TripPlanOpenHours | null) {
  if (!h || h.status === "unknown") {
    return {
      text: "ไม่ทราบเวลาเปิด",
      cls: "bg-gray-100 text-gray-600",
      icon: <InformationCircleIcon size={11} color="#6B7280" />,
    };
  }
  if (h.status === "closed") {
    return {
      text: h.openFrom ? `ปิด (ปิด ${h.openFrom})` : "ปิด",
      cls: "bg-red-100 text-red-700",
      icon: <ExclamationTriangleIcon size={11} color="#B91C1C" />,
    };
  }
  const range =
    h.openFrom && h.openTo ? `เปิด ${h.openFrom}–${h.openTo}` : "เปิด";
  return {
    text: range,
    cls: "bg-emerald-100 text-emerald-800",
    icon: <CheckBadgeIcon size={11} color="#047857" />,
  };
}

interface TripPlanCardProps {
  plan: TripPlan;
  /**
   * โหมดการ์ด
   * · "plan"   = โหมดเดิม: แผนที่เส้นทาง + จุดแวะ + งบ + ที่พัก (ผู้ใช้จัดลำดับเอง)
   * · "summary" = โหมดสรุป: กล่อง "เวลา — สถานที่" เรียงลงล่าง + ปุ่มยืนยัน
   */
  view?: "plan" | "summary";
  /**
   * ซ่อนบรรทัดสรุปของเอไaiที่หัวการ์ดหรือไม่
   * · false = ซ่อน (ตอนยังไม่ยืนยันแพลน ผู้ใช้ยังไม่อยากเห็นสรุปยาว ๆ)
   * · true  = แสดง (ตอนเป็นการ์ดสรุปสุดท้าย)
   */
  showSummary?: boolean;
  /** กด "แก้ไขแพลน" (โหมด summary) → กลับไปโหมดแผนที่+จุดแวะ */
  onBackToEdit?: () => void;
  /**
   * ปุ่มหลักของการ์ดโหมด "plan"
   * · "preview" (ค่าเริ่มต้น) = เปิด modal ดูไทม์ไลน์ก่อน → ยืนยันเข้าทริป (เส้นทางเดิมของแอป)
   * · "confirm"            = กดแล้วยืนยันเลย (flow ใหม่: ผู้ใช้จัดลำดับจุดเสร็จแล้ว)
   */
  primaryAction?: "preview" | "confirm";
  /** ข้อความบนปุ่มหลัก (ใช้ตอน primaryAction = "confirm") */
  primaryLabel?: string;
  /** จุดในโฟลเดอร์ที่ AI ไม่ได้เลือก → เสนอให้ผู้ใช้กดเพิ่มเอง */
  notSelected?: { id: string; name: string; type: string }[];
  /** คำเตือนจาก AI */
  aiWarnings?: string[];
  /** คำเตือนจาก backend (เช่น โฟลเดอร์ยังไม่มีข้อมูล) */
  folderWarning?: string | null;
  /** กำลังคำนวณใหม่ (ลบ/เพิ่มจุด) */
  busy?: boolean;
  /** กด "ยืนยันและบันทึกแพลน" */
  onConfirm?: () => void;
  /** กด "แก้ไขกับเอไai" */
  onEditWithAi?: () => void;
  /** กด "เพิ่มจุดแวะ" (ระบุวันได้) */
  onAddStop?: (dayIndex?: number) => void;
  /** กด "ลบ" จุด → คำนวณใหม่ */
  onRemoveStop?: (stopId: string) => void;
  /** ขยับลำดับจุดขึ้น/ลง */
  onMoveStop?: (stopId: string, dir: -1 | 1) => void;
  /** เลือกที่พักที่ระบบเสนอ */
  onSelectLodging?: (lodging: TripPlanLodging) => void;
  selectedLodgingName?: string | null;
  /** แก้ราคาน้ำมันเอง (ชนะราคาสดเสมอ) */
  onFuelPriceOverride?: (price: number | null) => void;
  fuelPriceOverride?: number | null;
  /**
   * ผู้ใช้/เอไai ระบุรถเองหรือยัง
   * -------------------------------------------------------------
   * false = ยังไม่ได้ระบุ (backend ใช้ค่าเริ่มต้น) → ต้องถามอีกรอบตอนสรุปค่าใช้จ่าย
   */
  vehicleSpecified?: boolean;
  /** เปลี่ยนรถที่ใช้ → คำนวณแผนใหม่ (ค่าน้ำมัน/ค่าไฟเปลี่ยนตาม) */
  onVehicleChange?: (vehicle: string, vehicleModel: string | null) => void;
  /** เปลี่ยนจำนวนผู้เดินทาง → คำนวณแผนใหม่ (ต่อคนเปลี่ยนตาม) */
  onTravelersChange?: (travelers: number) => void;
  /**
   * คลิปของแต่ละจุดแวะ (key = id ของจุด) — มาจากโฟลเดอร์ที่แนบ
   * → ให้ผู้ใช้เห็นว่าจุดนี้มีคลิปอะไรบ้าง ก่อนตัดสินใจลบ/เพิ่มจุด (ข้อ 2.3)
   */
  stopClips?: Record<
    string,
    { videoId: string; thumbnailUrl: string | null; caption: string | null }[]
  >;
  /** กดคลิปของจุดแวะ → เปิดดูคลิปเต็มจอ */
  onOpenClip?: (videoId: string) => void;
}

export default function TripPlanCard({
  plan,
  view = "plan",
  showSummary = true,
  onBackToEdit,
  primaryAction = "preview",
  primaryLabel,
  notSelected,
  aiWarnings,
  folderWarning,
  busy,
  onConfirm,
  onEditWithAi,
  onAddStop,
  onRemoveStop,
  onMoveStop,
  onSelectLodging,
  selectedLodgingName,
  onFuelPriceOverride,
  fuelPriceOverride,
  vehicleSpecified = true,
  onVehicleChange,
  onTravelersChange,
  stopClips,
  onOpenClip,
}: TripPlanCardProps) {
  const [dayIndex, setDayIndex] = useState(0);
  const [editingFuel, setEditingFuel] = useState(false);
  const [fuelText, setFuelText] = useState("");
  const [editingVehicle, setEditingVehicle] = useState(false);
  const [vehicleChoice, setVehicleChoice] = useState<VehicleClass | null>(null);
  const [vehicleModelText, setVehicleModelText] = useState("");
  const [editingTravelers, setEditingTravelers] = useState(false);

  // สถานะเปิด-ปิดของแต่ละเซ็คชั่น (Accordion)
  const [sectionMap, setSectionMap] = useState(true);
  const [sectionStops, setSectionStops] = useState(true);
  const [sectionBudget, setSectionBudget] = useState(true);
  const [sectionLodging, setSectionLodging] = useState(true);
  const [sectionTips, setSectionTips] = useState(false);

  // สถานะ Popup ดูรายละเอียดที่พักที่แนะนำ
  const [detailLodging, setDetailLodging] = useState<TripPlanLodging | null>(null);

  // สถานะเปิด Timeline Preview Modal (ข้อ 6)
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDayIndex, setPreviewDayIndex] = useState(0);

  const days = plan.days ?? [];
  const day: TripPlanDay | undefined = days[dayIndex] ?? days[0];
  const veh = plan.vehicle;
  const budget = plan.budget;
  const isCustomEnd = plan.returnMode === "custom";
  /** โหมดสรุป = กล่อง "เวลา — สถานที่" เรียงลงล่าง (ไม่มีแผนที่/งบ/ที่พัก) */
  const isSummary = view === "summary";

  /** คลาสรถที่ใช้จริง (รถยนต์ส่วนตัว / รถไฟฟ้า / รถสาธารณะ) */
  const vehicleClass: VehicleClass | null = vehicleClassOf(veh?.key ?? null);
  /** รถไฟฟ้า → ค่าใช้จ่ายเดินทางคือค่าไฟ ไม่ใช่ค่าน้ำมัน */
  const isEv = vehicleClass === "ev";
  const travelers = plan.travelers ?? 1;

  const warnings = useMemo(
    () => [...(plan.warnings ?? []), ...(aiWarnings ?? [])],
    [plan.warnings, aiWarnings]
  );

  const fuelPriceText = useMemo(() => {
    const unit = isEv ? " ฿/หน่วย" : " ฿/ลิตร";
    if (fuelPriceOverride != null) return `${fuelPriceOverride.toFixed(2)}${unit}`;
    if (veh?.fuelPricePerLitre != null) {
      return `${veh.fuelPricePerLitre.toFixed(2)}${unit}`;
    }
    return veh?.fuelPriceText ?? "ไม่ทราบราคา";
  }, [fuelPriceOverride, veh, isEv]);

  /**
   * จุดหยุดสำหรับแผนที่ — ต้องคงตัวอ้างเดิมไว้เสมอ
   * ถ้าสร้าง array/objects ใหม่ทุกครั้งที่ re-render แผนที่ native จะได้รับ
   * ค่าใหม่ทั้งที่ข้อมูลไม่เปลี่ยน → โหลด marker/polyline ใหม่ทุกครั้ง
   * → แอปค้างตอนผู้ใช้กดแก้ข้อมูลในการ์ด (เช่น แถว "รถที่ใช้")
   */
  const mapStops = useMemo(
    () =>
      (day?.stops ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        coords: s.coordinates,
      })),
    [day?.stops]
  );

  /**
   * หมวดรถที่เลือก → ใช้กรองรุ่นรถที่แนะนำ (พิมพ์แบรนด์ → เลือกรุ่น)
   */
  const vehicleCategory: VehicleCategory | null = useMemo(() => {
    if (vehicleChoice === "ev") return "ev";
    if (vehicleChoice === "private_car") return "car";
    return null;
  }, [vehicleChoice]);

  const modelOptions = useMemo(
    () => vehicleModelSuggestions(vehicleModelText, vehicleCategory),
    [vehicleModelText, vehicleCategory]
  );

  /** คลิปของจุดแวะนี้ (จากโฟลเดอร์ที่แนบ) */
  const clipsOfStop = (stopId: string) => stopClips?.[stopId] ?? EMPTY_STOP_CLIPS;

  const fuelSourceText = useMemo(() => {
    const bits: string[] = [];
    if (fuelPriceOverride != null) {
      bits.push("ระบุเองโดยผู้ใช้");
    } else {
      bits.push(`ราคาจาก ${veh?.fuelPriceSource ?? "ระบบ"}`);
      if (veh?.fuelPriceEffectiveDate) bits.push(`มีผล ${veh.fuelPriceEffectiveDate}`);
      if (veh?.fuelPriceFetchedAt) {
        const t = new Date(veh.fuelPriceFetchedAt);
        if (!Number.isNaN(t.getTime())) {
          bits.push(
            `ดึง ${t.toLocaleDateString("th-TH")} ${t.toLocaleTimeString("th-TH", {
              hour: "2-digit",
              minute: "2-digit",
            })}`
          );
        }
      }
      if (veh?.fuelPriceIsEstimate) bits.push("ประมาณการ");
    }
    return bits.join(" · ");
  }, [fuelPriceOverride, veh]);

  const commitFuel = () => {
    const n = Number(fuelText.replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) {
      setEditingFuel(false);
      return;
    }
    onFuelPriceOverride?.(n);
    setEditingFuel(false);
  };

  /**
   * บันทึกรถที่ผู้ใช้ระบุ → คำนวณแผนใหม่ (ค่าน้ำมัน/ค่าไฟเปลี่ยนตามรถ)
   * - รถสาธารณะ → ไม่มีค่าน้ำมัน/ค่าไฟในแผน
   * - รถไฟฟ้า → บอก backend ให้คิดเป็นค่าไฟ (fuelType = electric)
   */
  const commitVehicle = (next: VehicleClass) => {
    const model =
      next === "public" ? null : vehicleModelText.trim() || null;
    const vehicle = next === "ev" ? "ev" : next;
    onVehicleChange?.(vehicle, model);
    setEditingVehicle(false);
  };

  return (
    <View className="mt-2 self-stretch bg-white border border-violet-200 rounded-2xl overflow-hidden">
      {/* ── หัวเรื่อง ─────────────────────────────────────────── */}
      <View className="px-3.5 pt-3 pb-2 bg-violet-50 border-b border-violet-100">
        <View className="flex-row items-center">
          <SparklesIcon size={15} color="#6D28D9" />
          <Text className="text-violet-900 text-[14px] font-black ml-1.5 flex-1">
            {plan.title || "แผนทริป"}
          </Text>
          {plan.aiUsed ? (
            <View className="bg-violet-100 px-2 py-0.5 rounded-full">
              <Text className="text-violet-700 text-[11px] font-bold">
                เอไai ช่วยเลือกจุด
              </Text>
            </View>
          ) : (
            <View className="bg-gray-100 px-2 py-0.5 rounded-full">
              <Text className="text-gray-600 text-[11px] font-bold">
                ระบบจัดลำดับเอง
              </Text>
            </View>
          )}
        </View>
        {showSummary && plan.summary ? (
          <Text className="text-gray-700 text-[12.5px] leading-5 mt-1">
            {plan.summary}
          </Text>
        ) : null}

        {/* จุดเริ่ม → จุดสิ้นสุด */}
        <View className="bg-white border border-violet-100 rounded-xl px-3 py-2 mt-2">
          <View className="flex-row items-start">
            <View className="w-5 h-5 rounded-full bg-blue-600 items-center justify-center mt-0.5">
              <Text className="text-white text-[10px] font-black">A</Text>
            </View>
            <View className="flex-1 ml-2">
              <Text className="text-gray-900 text-[13px] font-bold">
                {plan.startPoint?.label ?? "จุดเริ่มต้น"}
              </Text>
              {plan.startPoint?.address ? (
                <Text className="text-gray-500 text-[12px]">{plan.startPoint.address}</Text>
              ) : null}
            </View>
          </View>
          <View className="flex-row items-start mt-1.5">
            <View className="w-5 h-5 rounded-full bg-red-600 items-center justify-center mt-0.5">
              <Text className="text-white text-[10px] font-black">B</Text>
            </View>
            <View className="flex-1 ml-2">
              <Text className="text-gray-900 text-[13px] font-bold">
                {plan.endPoint?.label ?? "จุดสิ้นสุด"}
              </Text>
              {plan.endPoint?.address ? (
                <Text className="text-gray-500 text-[12px]">{plan.endPoint.address}</Text>
              ) : null}
              {isCustomEnd ? (
                <Text className="text-red-600 text-[12px] font-bold mt-0.5">
                  กลับคนละจุดกับจุดเริ่ม
                </Text>
              ) : (
                <Text className="text-gray-500 text-[12px] mt-0.5">
                  ไป-กลับจุดเดิม
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* ข้อมูลสรุป */}
        <View className="flex-row flex-wrap mt-2">
          {day?.date ? (
            <InfoChip icon={<CalendarDaysIcon size={11} color="#6D28D9" />} text={formatDate(day.date)} />
          ) : null}
          <InfoChip icon={<CalendarDaysIcon size={11} color="#6D28D9" />} text={`${days.length || plan.days?.length || 1} วัน`} />
          {veh?.label ? (
            <InfoChip icon={<MapPinIcon size={11} color="#6D28D9" />} text={veh.label} />
          ) : null}
          {veh?.fuelType ? (
            <InfoChip icon={<BanknotesIcon size={11} color="#6D28D9" />} text={veh.fuelType} />
          ) : null}
          {plan.budget?.perPerson ? (
            <InfoChip
              icon={<BanknotesIcon size={11} color="#6D28D9" />}
              text={`งบ ${money(plan.budget.perPerson)}/คน`}
            />
          ) : null}
        </View>
      </View>

      {/* ── เนื้อหาการ์ด ─────────────────────────────────────── */}
      {isSummary ? (
        /* โหมดสรุป: กล่อง "เวลา — สถานที่" เรียงลงล่าง */
        <TripRouteTimeline days={days} />
      ) : (
        <>
      {/* ── แท็บวัน ───────────────────────────────────────────── */}
      {days.length > 1 ? (
        <View className="flex-row px-3 pt-2.5" style={{ flexWrap: "wrap" }}>
          {days.map((d, i) => (
            <TouchableOpacity
              key={`tab-${d.day}-${i}`}
              onPress={() => setDayIndex(i)}
              activeOpacity={0.75}
              className={`px-3 py-1.5 rounded-xl border mr-2 mb-2 ${
                i === dayIndex
                  ? "bg-violet-600 border-violet-600"
                  : "bg-white border-gray-200"
              }`}
            >
              <Text
                className={`text-[13px] font-bold ${
                  i === dayIndex ? "text-white" : "text-gray-700"
                }`}
              >
                วันที่ {d.day}
              </Text>
              {d.date ? (
                <Text
                  className={`text-[12px] ${
                    i === dayIndex ? "text-violet-100" : "text-gray-400"
                  }`}
                >
                  {formatDate(d.date)}
                </Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* ── แผนที่ ────────────────────────────────────────────── */}
      {day ? (
        <View className="px-3 pt-2">
          <TouchableOpacity
            onPress={() => setSectionMap((v) => !v)}
            activeOpacity={0.7}
            className="flex-row items-center justify-between py-2 px-3 bg-gray-50 rounded-xl mb-2 border border-gray-100"
          >
            <View className="flex-row items-center">
              <MapPinIcon size={16} color="#7C3AED" />
              <Text className="text-gray-900 text-[13.5px] font-bold ml-2">แผนที่เส้นทาง</Text>
            </View>
            {sectionMap ? (
              <ChevronUpIcon size={16} color="#6B7280" />
            ) : (
              <ChevronDownIcon size={16} color="#6B7280" />
            )}
          </TouchableOpacity>

          {sectionMap && (
            <>
              <TripRouteMap
                startPoint={day.startPoint}
                endPoint={day.endPoint}
                returnMode={plan.returnMode}
                stops={mapStops}
                legs={day.legs ?? EMPTY_LEGS}
                height={230}
                routeSource={plan.routeSource}
                routeCredit={plan.routeCredit}
              />

              <View className="flex-row items-center mt-2 flex-wrap">
                <Text className="text-[12px] text-gray-600 font-bold mr-3">
                  รวมวันนี้ {km(day.totalKm)} · {mins(day.totalDriveMinutes)} ขับ
                </Text>
                {day.fuelCost ? (
                  <Text className="text-[12px] text-gray-600 mr-3">
                    {isEv ? "ค่าไฟ" : "ค่าน้ำมัน"} {money(day.fuelCost)}
                  </Text>
                ) : null}
                <Text className="text-[12px] text-gray-500">
                  {day.endPointType === "lodging" ? "จบวันที่ที่พัก" : "จบวันที่จุดสิ้นสุด"}
                </Text>
              </View>
            </>
          )}
        </View>
      ) : null}

      {/* ── รายการจุดแวะ ─────────────────────────────────────── */}
      {day?.stops?.length ? (
        <View className="px-3 pt-2">
          <TouchableOpacity
            onPress={() => setSectionStops((v) => !v)}
            activeOpacity={0.7}
            className="flex-row items-center justify-between py-2 px-3 bg-gray-50 rounded-xl mb-2 border border-gray-100"
          >
            <View className="flex-row items-center">
              <ClockIcon size={16} color="#7C3AED" />
              <Text className="text-gray-900 text-[13.5px] font-bold ml-2">
                จุดแวะวันที่ {day.day}
              </Text>
              <View className="bg-violet-100 px-2 py-0.5 rounded-full ml-2">
                <Text className="text-violet-700 text-[11px] font-bold">{day.stops.length} จุด</Text>
              </View>
            </View>
            {sectionStops ? (
              <ChevronUpIcon size={16} color="#6B7280" />
            ) : (
              <ChevronDownIcon size={16} color="#6B7280" />
            )}
          </TouchableOpacity>

          {sectionStops && (
            <>
              {day.stops.map((stop, i) => {
            const oh = openHoursBadge(stop.openHours);
            return (
              <View
                key={stop.id}
                className="bg-gray-50 border border-gray-100 rounded-2xl p-3 mb-2"
              >
                <View className="flex-row items-start">
                  <View className="w-6 h-6 rounded-full bg-violet-600 items-center justify-center mt-0.5">
                    <Text className="text-white text-[11px] font-black">{i + 1}</Text>
                  </View>
                  <View className="flex-1 ml-2">
                    <Text className="text-gray-900 text-[14px] font-bold">
                      {stop.name}
                    </Text>
                    {stop.activity ? (
                      <Text className="text-gray-600 text-[12.5px] mt-0.5">
                        {stop.activity}
                      </Text>
                    ) : null}
                    {stop.description ? (
                      <Text className="text-gray-500 text-[12.5px] mt-0.5 leading-5">
                        {stop.description}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {/* เวลา / ระยะ / เวลาเปิด */}
                <View className="flex-row items-center flex-wrap mt-2">
                  {stop.arriveTime ? (
                    <Text className="text-[12.5px] font-bold text-gray-800 mr-3">
                      มาถึง {stop.arriveTime}
                      {stop.leaveTime ? ` · ออก ${stop.leaveTime}` : ""}
                    </Text>
                  ) : null}
                  {stop.driveToNextMins ? (
                    <Text className="text-[12.5px] text-gray-600 mr-3">
                      <ClockIcon size={10} color="#6B7280" /> ขับต่อ{" "}
                      {mins(stop.driveToNextMins)}
                    </Text>
                  ) : null}
                  {stop.distanceFromPrevKm != null ? (
                    <Text className="text-[12.5px] text-gray-600 mr-3">
                      จากจุดก่อน {km(stop.distanceFromPrevKm)}
                    </Text>
                  ) : null}
                  {stop.stayHours ? (
                    <Text className="text-[12.5px] text-gray-600 mr-3">
                      พัก {stop.stayHours} ชม.
                    </Text>
                  ) : null}
                </View>

                <View className="flex-row items-center flex-wrap mt-1.5">
                  <View
                    className={`flex-row items-center px-2 py-0.5 rounded-full ${oh.cls} mr-2 mb-1`}
                  >
                    {oh.icon}
                    <Text className="text-[12px] font-bold ml-1">{oh.text}</Text>
                  </View>
                  {stop.estimatedCost ? (
                    <View className="bg-gray-100 px-2 py-0.5 rounded-full mr-2 mb-1">
                      <Text className="text-gray-700 text-[12px] font-bold">
                        ~{money(stop.estimatedCost)}
                      </Text>
                    </View>
                  ) : null}
                  {stop.verified === false ? (
                    <View className="bg-amber-100 px-2 py-0.5 rounded-full mr-2 mb-1">
                      <Text className="text-amber-800 text-[12px] font-bold">
                        ข้อมูลยังไม่ยืนยัน
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* คลิปของจุดนี้ในโฟลเดอร์ (ข้อ 2.3)
                    → ผู้ใช้เห็นคลิปของจุดนี้ก่อนตัดสินใจว่าจะลบ/เพิ่มจุด */}
                {clipsOfStop(stop.id).length > 0 ? (
                  <View className="mt-2">
                    <Text className="text-[11.5px] font-bold text-gray-500 mb-1">
                      คลิปในโฟลเดอร์ ({clipsOfStop(stop.id).length})
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ paddingRight: 4 }}
                    >
                      {clipsOfStop(stop.id).map((clip) => (
                        <TouchableOpacity
                          key={clip.videoId}
                          onPress={() => onOpenClip?.(clip.videoId)}
                          activeOpacity={0.85}
                          accessibilityRole="button"
                          accessibilityLabel={`เปิดคลิป ${clip.caption ?? "ในโฟลเดอร์"}`}
                          style={{ width: 46, height: 62, marginRight: 6 }}
                          className="rounded-lg overflow-hidden bg-gray-800"
                        >
                          {clip.thumbnailUrl ? (
                            <Image
                              source={{ uri: clip.thumbnailUrl }}
                              style={{ width: "100%", height: "100%" }}
                              resizeMode="cover"
                            />
                          ) : (
                            <View className="flex-1 items-center justify-center">
                              <PlayIcon size={16} color="#FFFFFF" />
                            </View>
                          )}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                {/* วิธีจอง / ติดต่อ */}
                {stop.booking ? (
                  <View className="mt-2 bg-white border border-gray-200 rounded-xl px-2.5 py-2">
                    {stop.booking.note ? (
                      <Text className="text-gray-700 text-[12.5px] mb-1">
                        📌 {stop.booking.note}
                      </Text>
                    ) : null}
                    <View className="flex-row items-center flex-wrap">
                      {stop.booking.phone ? (
                        <TouchableOpacity
                          onPress={() =>
                            Linking.openURL(`tel:${stop.booking!.phone}`).catch(
                              () => undefined
                            )
                          }
                          activeOpacity={0.7}
                          className="flex-row items-center bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 mr-2 mb-1"
                        >
                          <PhoneIcon size={12} color="#047857" />
                          <Text className="text-emerald-800 text-[12px] font-bold ml-1">
                            {stop.booking.phone}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      {stop.booking.website ? (
                        <TouchableOpacity
                          onPress={() =>
                            Linking.openURL(stop.booking!.website!).catch(
                              () => undefined
                            )
                          }
                          activeOpacity={0.7}
                          className="flex-row items-center bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1 mr-2 mb-1"
                        >
                          <GlobeAltIcon size={12} color="#1D4ED8" />
                          <Text className="text-blue-700 text-[12px] font-bold ml-1">
                            เว็บไซต์
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                ) : null}

                {stop.issues?.length ? (
                  <View className="mt-1.5">
                    {stop.issues.map((iss, ii) => (
                      <Text key={`iss-${ii}`} className="text-amber-700 text-[12px]">
                        ⚠️ {iss}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {stop.note ? (
                  <Text className="text-gray-500 text-[12px] mt-1">💡 {stop.note}</Text>
                ) : null}

                {/* ปุ่มจัดการจุด */}
                {onRemoveStop || onMoveStop ? (
                  <View className="flex-row items-center mt-2">
                    {onMoveStop ? (
                      <>
                        <TouchableOpacity
                          onPress={() => onMoveStop(stop.id, -1)}
                          disabled={i === 0}
                          activeOpacity={0.7}
                          className={`flex-row items-center px-2.5 py-1 rounded-lg border mr-1.5 ${
                            i === 0
                              ? "bg-gray-50 border-gray-100"
                              : "bg-white border-gray-200"
                          }`}
                        >
                          <ArrowUpIcon size={12} color={i === 0 ? "#D1D5DB" : "#4B5563"} />
                          <Text
                            className={`text-[12px] font-bold ml-1 ${
                              i === 0 ? "text-gray-300" : "text-gray-700"
                            }`}
                          >
                            ขึ้น
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => onMoveStop(stop.id, 1)}
                          disabled={i === day.stops.length - 1}
                          activeOpacity={0.7}
                          className={`flex-row items-center px-2.5 py-1 rounded-lg border mr-1.5 ${
                            i === day.stops.length - 1
                              ? "bg-gray-50 border-gray-100"
                              : "bg-white border-gray-200"
                          }`}
                        >
                          <ArrowDownIcon
                            size={12}
                            color={
                              i === day.stops.length - 1 ? "#D1D5DB" : "#4B5563"
                            }
                          />
                          <Text
                            className={`text-[12px] font-bold ml-1 ${
                              i === day.stops.length - 1
                                ? "text-gray-300"
                                : "text-gray-700"
                            }`}
                          >
                            ลง
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                    {onRemoveStop ? (
                      <TouchableOpacity
                        onPress={() => onRemoveStop(stop.id)}
                        activeOpacity={0.7}
                        className="flex-row items-center bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg"
                      >
                        <TrashIcon size={12} color="#B91C1C" />
                        <Text className="text-red-700 text-[12px] font-bold ml-1">
                          ลบจุดนี้
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
              {onAddStop ? (
                <TouchableOpacity
                  onPress={() => onAddStop(dayIndex)}
                  activeOpacity={0.8}
                  className="flex-row items-center justify-center bg-violet-50 border border-violet-200 rounded-xl py-2 mt-1 mb-2"
                >
                  <MapPinIcon size={14} color="#7C3AED" />
                  <Text className="text-violet-700 text-[12.5px] font-bold ml-1.5">
                    + เพิ่มจุดแวะในวันที่ {day.day}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </View>
      ) : null}

      {/* ── ต้นทุน ────────────────────────────────────────────── */}
      <View className="px-3 pt-2">
        <TouchableOpacity
          onPress={() => setSectionBudget((v) => !v)}
          activeOpacity={0.7}
          className="flex-row items-center justify-between py-2 px-3 bg-gray-50 rounded-xl mb-2 border border-gray-100"
        >
          <View className="flex-row items-center">
            <BanknotesIcon size={16} color="#7C3AED" />
            <Text className="text-gray-900 text-[13.5px] font-bold ml-2">ค่าใช้จ่ายและยานพาหนะ</Text>
            {budget?.perPerson ? (
              <View className="bg-emerald-100 px-2 py-0.5 rounded-full ml-2">
                <Text className="text-emerald-800 text-[11px] font-bold">{money(budget.perPerson)}/คน</Text>
              </View>
            ) : null}
          </View>
          {sectionBudget ? (
            <ChevronUpIcon size={16} color="#6B7280" />
          ) : (
            <ChevronDownIcon size={16} color="#6B7280" />
          )}
        </TouchableOpacity>

        {sectionBudget && (
          <>

        {/* ── ถามอีกรอบตอนสรุปค่าใช้จ่าย: รถ + จำนวนคน ─────────── */}
        {!vehicleSpecified ? (
          <View className="bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2.5 mb-3">
            <View className="flex-row items-start">
              <ExclamationTriangleIcon size={14} color="#B45309" />
              <Text className="text-amber-800 text-[12.5px] font-bold ml-1.5 flex-1 leading-4">
                ยังไม่ได้ระบุว่าใช้รถอะไร — ค่าเดินทางตอนนี้คิดจากค่าเริ่มต้น
                ระบุรถด้านล่างเพื่อให้ค่าน้ำมัน/ค่าไฟตรงกับของจริง
              </Text>
            </View>
          </View>
        ) : null}

        <EditableValueRow
          label="รถที่ใช้"
          icon="🚙"
          tone="amber"
          value={
            // ยังไม่ได้ระบุ → อย่าโชว์ค่าเริ่มต้นของ backend เหมือนผู้ใช้เลือกเอง
            !vehicleSpecified
              ? ""
              : vehicleClass
              ? `${VEHICLE_CLASS_OPTIONS.find((o) => o.key === vehicleClass)?.label ?? ""}${
                  veh?.model ? ` · ${veh.model}` : ""
                }`
              : ""
          }
          emptyHint="ยังไม่ได้ระบุ — ระบุได้ด้านล่าง"
          editing={editingVehicle}
          onToggle={() => {
            setVehicleChoice(vehicleClass);
            setVehicleModelText(veh?.model ?? "");
            setEditingVehicle((v) => !v);
          }}
          badge={
            vehicleSpecified
              ? veh?.model
                ? { text: veh.model, tone: "blue" }
                : undefined
              : { text: "ยังไม่ระบุ", tone: "amber" }
          }
        >
          <View className="flex-row flex-wrap">
            {VEHICLE_CLASS_OPTIONS.map((v) => (
              <TouchableOpacity
                key={v.key}
                onPress={() => setVehicleChoice(v.key)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityState={{ selected: vehicleChoice === v.key }}
                className={`px-3 py-1.5 rounded-xl border mr-2 mb-2 ${
                  vehicleChoice === v.key
                    ? "bg-violet-600 border-violet-600"
                    : "bg-white border-gray-200"
                }`}
              >
                <Text
                  className={`text-[13px] font-bold ${
                    vehicleChoice === v.key ? "text-white" : "text-gray-700"
                  }`}
                >
                  {v.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {vehicleChoice && vehicleChoice !== "public" ? (
            <View className="mt-1">
              <Text className="text-[12.5px] font-bold text-gray-700 mb-1">
                ชื่อ/รุ่นรถ (ถ้าจำได้)
              </Text>
              <TextInput
                value={vehicleModelText}
                onChangeText={setVehicleModelText}
                placeholder="พิมพ์แบรนด์ เช่น Toyota"
                placeholderTextColor="#9CA3AF"
                className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-gray-900"
                accessibilityLabel="ชื่อหรือรุ่นรถ"
              />
              {/* รุ่นที่แนะนำ — เลือกแล้วยังไม่คำนวณ ต้องกด "ตกลง · คำนวณใหม่" (ข้อ 2.3) */}
              {vehicleModelText.trim() && modelOptions.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  className="mt-2"
                  contentContainerStyle={{ paddingRight: 4 }}
                >
                  {modelOptions.map((m) => (
                    <TouchableOpacity
                      key={`${m.category}-${m.name}`}
                      onPress={() => setVehicleModelText(m.name)}
                      activeOpacity={0.75}
                      className="mr-2 px-3 py-1.5 rounded-xl border border-violet-200 bg-violet-50"
                    >
                      <Text className="text-[12.5px] font-bold text-violet-800">
                        {m.name}
                      </Text>
                      <Text className="text-[10.5px] text-gray-500">{m.fuelLabel}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : null}
            </View>
          ) : null}

          <View className="flex-row items-center mt-2">
            <TouchableOpacity
              onPress={() =>
                commitVehicle(vehicleChoice ?? vehicleClass ?? "private_car")
              }
              activeOpacity={0.85}
              className="bg-violet-600 px-4 py-2.5 rounded-xl"
            >
              <Text className="text-white text-[13px] font-bold">
                ตกลง · คำนวณใหม่
              </Text>
            </TouchableOpacity>
            <Text className="text-gray-500 text-[12px] ml-2 flex-1 leading-4">
              ระบบจะรู้ว่าใช้น้ำมันหรือไฟฟ้า และคิดราคาจากระยะทางในแผน
            </Text>
          </View>
        </EditableValueRow>

        <EditableValueRow
          label="จำนวนผู้เดินทาง"
          icon="👥"
          tone="green"
          value={`${travelers} คน`}
          emptyHint="1 คน (ค่าเริ่มต้น)"
          editing={editingTravelers}
          onToggle={() => setEditingTravelers((v) => !v)}
        >
          <View className="flex-row flex-wrap">
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <TouchableOpacity
                key={n}
                onPress={() => {
                  onTravelersChange?.(n);
                  setEditingTravelers(false);
                }}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityState={{ selected: travelers === n }}
                className={`px-3 py-1.5 rounded-xl border mr-2 mb-2 ${
                  travelers === n
                    ? "bg-emerald-700 border-emerald-700"
                    : "bg-white border-gray-200"
                }`}
              >
                <Text
                  className={`text-[13px] font-bold ${
                    travelers === n ? "text-white" : "text-gray-700"
                  }`}
                >
                  {n} คน
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </EditableValueRow>

        <View className="bg-gray-50 border border-gray-100 rounded-2xl px-3 py-2.5">
          <CostRow
            label={isEv ? "ค่าไฟฟ้า" : "ค่าน้ำมัน"}
            value={money(budget?.fuel)}
          />
          <CostRow label="ค่าที่พัก" value={money(budget?.lodging)} />
          <CostRow label="ค่าอาหาร" value={money(budget?.food)} />
          <CostRow
            label="ค่าเข้าชมสถานที่ / กิจกรรม"
            value={money(budget?.activities)}
          />
          {budget?.other ? (
            <CostRow label="ค่าใช้จ่ายอื่น" value={money(budget.other)} />
          ) : null}
          <View className="h-px bg-gray-200 my-1.5" />
          <CostRow
            label="รวมทั้งหมด"
            value={money(budget?.total)}
            strong
          />
          <CostRow
            label={`ต่อคน (${plan.budget?.groupTotal ? "ทั้งกลุ่ม" : "ทั้งทริป"})`}
            value={money(budget?.perPerson)}
            strong
          />
          {budget?.withinBudget === false ? (
            <View className="flex-row items-center bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-1.5 mt-2">
              <ExclamationTriangleIcon size={13} color="#B45309" />
              <Text className="text-amber-800 text-[12.5px] font-bold ml-1.5 flex-1">
                เกินงบที่ตั้งไว้ — ลองลดจำนวนวัน หรือเลือกที่พักราคาถูกกว่า
              </Text>
            </View>
          ) : null}
        </View>

        {/* ราคาน้ำมัน + ที่มา */}
        <View className="mt-2">
          <EditableValueRow
            label={isEv ? "ราคาไฟ" : "ราคาน้ำมัน"}
            icon="⛽"
            tone="green"
            value={fuelPriceText}
            emptyHint="ไม่ทราบราคา"
            editing={editingFuel}
            onToggle={() => {
              setFuelText(
                String(
                  fuelPriceOverride ??
                    veh?.fuelPricePerLitre ??
                    plan.fuel?.pricePerLitre ??
                    ""
                )
              );
              setEditingFuel((v) => !v);
            }}
            badge={
              veh?.fuelPriceIsEstimate && fuelPriceOverride == null
                ? { text: "ประมาณการ", tone: "amber" }
                : fuelPriceOverride != null
                ? { text: "ระบุเอง", tone: "blue" }
                : undefined
            }
          >
            <View className="flex-row items-center">
              <TextInput
                value={fuelText}
                onChangeText={setFuelText}
                keyboardType="decimal-pad"
                placeholder={
                  isEv ? "ราคาไฟต่อหน่วย (บาท/kWh)" : "ราคาต่อลิตรที่ปั๊ม"
                }
                placeholderTextColor="#9CA3AF"
                className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-[14px] text-gray-900"
              />
              <TouchableOpacity
                onPress={commitFuel}
                activeOpacity={0.8}
                className="bg-emerald-700 px-3.5 py-2.5 rounded-xl ml-2"
              >
                <Text className="text-white text-[13px] font-bold">ตกลง</Text>
              </TouchableOpacity>
            </View>
          </EditableValueRow>

          {/* ที่มาของราคา — ต้องเห็นเสมอ ไม่ว่าจะกำลังแก้หรือไม่ */}
          <Text className="text-gray-500 text-[12px] leading-5 mt-1">
            {fuelSourceText}
          </Text>
          {fuelPriceOverride != null ? (
            <TouchableOpacity
              onPress={() => {
                onFuelPriceOverride?.(null);
                setEditingFuel(false);
              }}
              activeOpacity={0.7}
              className="self-start mt-1"
            >
              <Text className="text-gray-500 text-[12.5px] font-bold underline">
                ยกเลิกราคาที่ระบุเอง · ใช้ราคาสด
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
          </>
        )}
      </View>

      {/* ── ที่พักที่ระบบเสนอ ────────────────────────────────── */}
      {plan.lodgingSuggestions?.length ? (
        <View className="px-3 pt-2">
          <TouchableOpacity
            onPress={() => setSectionLodging((v) => !v)}
            activeOpacity={0.7}
            className="flex-row items-center justify-between py-2 px-3 bg-gray-50 rounded-xl mb-2 border border-gray-100"
          >
            <View className="flex-row items-center">
              <SparklesIcon size={16} color="#7C3AED" />
              <Text className="text-gray-900 text-[13.5px] font-bold ml-2">ที่พักที่แนะนำ</Text>
              <View className="bg-violet-100 px-2 py-0.5 rounded-full ml-2">
                <Text className="text-violet-700 text-[11px] font-bold">{plan.lodgingSuggestions.length} แห่ง</Text>
              </View>
            </View>
            {sectionLodging ? (
              <ChevronUpIcon size={16} color="#6B7280" />
            ) : (
              <ChevronDownIcon size={16} color="#6B7280" />
            )}
          </TouchableOpacity>

          {sectionLodging && (
            <View className="flex-row flex-wrap mt-1">
              {plan.lodgingSuggestions.map((l, i) => {
                const picked = selectedLodgingName === l.name;
                return (
                  <TouchableOpacity
                    key={`${l.name}-${i}`}
                    onPress={() => setDetailLodging(l)}
                    activeOpacity={0.75}
                    className={`flex-row items-center rounded-2xl px-3 py-2 mr-2 mb-2 border ${
                      picked
                        ? "bg-emerald-50 border-emerald-400"
                        : "bg-white border-gray-200"
                    }`}
                  >
                    <Text className="text-[13px] font-bold text-gray-800 mr-1.5">
                      🏨 {l.name}
                    </Text>
                    {l.price != null ? (
                      <Text className="text-[11.5px] font-bold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded-md">
                        {money(l.price)}
                      </Text>
                    ) : null}
                    {picked && (
                      <CheckBadgeIcon size={15} color="#059669" style={{ marginLeft: 4 }} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      ) : null}

      {/* ── จุดที่ยังไม่ได้ไป ─────────────────────────────────── */}
      {notSelected?.length ? (
        <View className="px-3 pt-1">
          <View className="flex-row items-center mb-1.5">
            <Text className="text-gray-900 text-[13.5px] font-black flex-1">
              จุดในโฟลเดอร์ที่ยังไม่ได้ไป ({notSelected.length})
            </Text>
            {onAddStop ? (
              <TouchableOpacity
                onPress={() => onAddStop(dayIndex)}
                activeOpacity={0.8}
                className="flex-row items-center bg-violet-50 border border-violet-200 rounded-full px-2.5 py-1"
              >
                <MapPinIcon size={12} color="#7C3AED" />
                <Text className="text-violet-700 text-[12px] font-bold ml-1">
                  เพิ่มจุดแวะ
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <View className="flex-row flex-wrap">
            {notSelected.slice(0, 12).map((p) => (
              <View
                key={p.id}
                className="bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1 mr-1.5 mb-1.5"
              >
                <Text className="text-gray-700 text-[12.5px] font-semibold">
                  {p.name}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : onAddStop ? (
        <View className="px-3 pt-1">
          <TouchableOpacity
            onPress={() => onAddStop(dayIndex)}
            activeOpacity={0.8}
            className="flex-row items-center justify-center bg-violet-50 border border-violet-200 rounded-2xl py-2.5"
          >
            <MapPinIcon size={15} color="#7C3AED" />
            <Text className="text-violet-700 text-[13px] font-bold ml-1.5">
              เพิ่มจุดแวะใกล้เคียง
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* ── ข้อควรระวัง / สมมติฐาน ─────────────────────────────── */}
      {warnings.length || plan.assumptions?.length || plan.tips?.length ? (
        <View className="px-3 pt-2 pb-1">
          <TouchableOpacity
            onPress={() => setSectionTips((v) => !v)}
            activeOpacity={0.7}
            className="flex-row items-center justify-between py-2 px-3 bg-gray-50 rounded-xl mb-1.5 border border-gray-100"
          >
            <View className="flex-row items-center">
              <ExclamationTriangleIcon size={15} color="#B45309" />
              <Text className="text-gray-900 text-[13.5px] font-bold ml-2">คำแนะนำและข้อควรระวัง</Text>
            </View>
            {sectionTips ? (
              <ChevronUpIcon size={16} color="#6B7280" />
            ) : (
              <ChevronDownIcon size={16} color="#6B7280" />
            )}
          </TouchableOpacity>

          {sectionTips && (
            <>
              {folderWarning ? (
                <NoticeBox tone="amber" title="หมายเหตุ">
                  {folderWarning}
                </NoticeBox>
              ) : null}
              {warnings.map((w, i) => (
                <NoticeBox key={`w-${i}`} tone="amber" title="ข้อควรระวัง">
                  {w}
                </NoticeBox>
              ))}
              {plan.assumptions?.map((a, i) => (
                <NoticeBox key={`a-${i}`} tone="gray" title="สมมติฐานที่ใช้คำนวณ">
                  {a}
                </NoticeBox>
              ))}
              {plan.tips?.map((t, i) => (
                <NoticeBox key={`t-${i}`} tone="blue" title="เคล็ดลับ">
                  {t}
                </NoticeBox>
              ))}
            </>
          )}
        </View>
      ) : null}
        </>
      )}

      {/* ── ปุ่มการกระทำ ─────────────────────────────────────── */}
      {isSummary ? (
        /* โหมดสรุป: แก้ไข · เพิ่มจุดแวะ · ยืนยันเข้าทริป */
        <View className="px-3 pt-3 pb-3.5">
          <TouchableOpacity
            onPress={onConfirm}
            disabled={busy}
            activeOpacity={0.85}
            className={`rounded-2xl py-3.5 items-center justify-center flex-row ${
              busy ? "bg-violet-300" : "bg-emerald-600 shadow-md shadow-emerald-200"
            }`}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <CheckBadgeIcon size={18} color="#FFFFFF" />
            )}
            <Text className="text-white text-[15px] font-bold ml-1.5">
              {busy ? "กำลังบันทึก..." : "ยืนยันและบันทึกเข้าทริป"}
            </Text>
          </TouchableOpacity>

          <View className="flex-row mt-2">
            {onBackToEdit ? (
              <TouchableOpacity
                onPress={onBackToEdit}
                disabled={busy}
                activeOpacity={0.8}
                className="flex-1 flex-row items-center justify-center bg-white border border-violet-200 rounded-2xl py-2.5 mr-1.5"
              >
                <PencilSquareIcon size={15} color="#7C3AED" />
                <Text className="text-violet-700 text-[13px] font-bold ml-1.5">
                  แก้ไขแพลน
                </Text>
              </TouchableOpacity>
            ) : null}
            {onAddStop ? (
              <TouchableOpacity
                onPress={() => onAddStop(dayIndex)}
                disabled={busy}
                activeOpacity={0.8}
                className="flex-1 flex-row items-center justify-center bg-white border border-gray-200 rounded-2xl py-2.5"
              >
                <MapPinIcon size={15} color="#4B5563" />
                <Text className="text-gray-700 text-[13px] font-bold ml-1.5">
                  เพิ่มจุดแวะ
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : (
        <View className="px-3 pt-3 pb-3.5">
          <TouchableOpacity
            onPress={() => {
              // flow ใหม่: ผู้ใช้จัดลำดับจุดเสร็จแล้ว → ยืนยันได้เลย (ไม่ต้องเปิด modal)
              if (primaryAction === "confirm") {
                onConfirm?.();
                return;
              }
              setPreviewDayIndex(dayIndex);
              setPreviewOpen(true);
            }}
            disabled={busy}
            activeOpacity={0.85}
            className={`rounded-2xl py-3.5 items-center justify-center flex-row ${
              busy ? "bg-violet-300" : "bg-violet-600 shadow-md shadow-violet-200"
            }`}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <SparklesIcon size={18} color="#FFFFFF" />
            )}
            <Text className="text-white text-[15px] font-bold ml-1.5">
              {busy
                ? "กำลังคำนวณใหม่..."
                : primaryAction === "confirm"
                ? primaryLabel ?? "ยืนยันแพลนทริป"
                : "สร้างแพลน"}
            </Text>
          </TouchableOpacity>

          <View className="flex-row mt-2">
            {onAddStop ? (
              <TouchableOpacity
                onPress={() => onAddStop(dayIndex)}
                disabled={busy}
                activeOpacity={0.8}
                className="flex-1 flex-row items-center justify-center bg-white border border-violet-200 rounded-2xl py-2.5 mr-1.5"
              >
                <MapPinIcon size={15} color="#7C3AED" />
                <Text className="text-violet-700 text-[13px] font-bold ml-1.5">
                  เพิ่มจุดแวะ
                </Text>
              </TouchableOpacity>
            ) : null}
            {onEditWithAi ? (
              <TouchableOpacity
                onPress={onEditWithAi}
                disabled={busy}
                activeOpacity={0.8}
                className="flex-1 flex-row items-center justify-center bg-white border border-gray-200 rounded-2xl py-2.5"
              >
                <SparklesIcon size={15} color="#4B5563" />
                <Text className="text-gray-700 text-[13px] font-bold ml-1.5">
                  แก้ไขกับเอไai
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      )}

      {/* ── Modal ดูรายละเอียดที่พัก ───────────────────────────── */}
      <Modal
        visible={!!detailLodging}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailLodging(null)}
      >
        <View className="flex-1 bg-black/50 justify-center items-center px-4">
          <View className="bg-white rounded-3xl p-5 w-full max-w-sm">
            <View className="flex-row items-center justify-between mb-3 border-b border-gray-100 pb-2">
              <View className="flex-row items-center flex-1">
                <Text className="text-base font-black text-gray-900 mr-2" numberOfLines={1}>
                  🏨 {detailLodging?.name}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setDetailLodging(null)} className="p-1">
                <XMarkIcon size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {detailLodging?.address ? (
              <Text className="text-gray-600 text-xs mb-2 leading-4">
                📍 {detailLodging.address}
              </Text>
            ) : null}

            <View className="flex-row flex-wrap gap-2 my-2">
              {detailLodging?.price != null ? (
                <View className="bg-violet-50 px-2.5 py-1 rounded-full border border-violet-100">
                  <Text className="text-violet-700 text-xs font-bold">
                    {money(detailLodging.price)} {detailLodging.priceUnit ? `/ ${detailLodging.priceUnit}` : ""}
                  </Text>
                </View>
              ) : null}
              {detailLodging?.distanceKm != null ? (
                <View className="bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100">
                  <Text className="text-blue-700 text-xs font-bold">
                    ห่าง {km(detailLodging.distanceKm)}
                  </Text>
                </View>
              ) : null}
              {detailLodging?.rating != null ? (
                <View className="bg-amber-50 px-2.5 py-1 rounded-full border border-amber-100">
                  <Text className="text-amber-800 text-xs font-bold">
                    ⭐ {detailLodging.rating.toFixed(1)}
                  </Text>
                </View>
              ) : null}
            </View>

            <View className="flex-row gap-2 mt-4">
              {detailLodging?.phone ? (
                <TouchableOpacity
                  onPress={() => Linking.openURL(`tel:${detailLodging.phone}`).catch(() => undefined)}
                  className="flex-1 bg-emerald-50 border border-emerald-200 py-2.5 rounded-xl items-center justify-center flex-row"
                >
                  <PhoneIcon size={14} color="#047857" />
                  <Text className="text-emerald-800 text-xs font-bold ml-1">โทรสอบถาม</Text>
                </TouchableOpacity>
              ) : null}
              {onSelectLodging && detailLodging ? (
                <TouchableOpacity
                  onPress={() => {
                    onSelectLodging(detailLodging);
                    setDetailLodging(null);
                  }}
                  className={`flex-1 py-2.5 rounded-xl items-center justify-center ${
                    selectedLodgingName === detailLodging.name ? "bg-emerald-700" : "bg-violet-600"
                  }`}
                >
                  <Text className="text-white text-xs font-bold">
                    {selectedLodgingName === detailLodging.name ? "เลือกแล้ว ✓" : "เลือกที่พักนี้"}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modal สรุปไทม์ไลน์และยืนยันแพลน (Timeline Preview Modal) ── */}
      <Modal
        visible={previewOpen}
        animationType="slide"
        onRequestClose={() => setPreviewOpen(false)}
      >
        <View className="flex-1 bg-gray-50">
          {/* Header */}
          <View className="bg-white px-4 pt-12 pb-3 border-b border-gray-100 flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-lg font-black text-gray-900" numberOfLines={1}>
                {plan.title || "แผนการท่องเที่ยว"}
              </Text>
              <Text className="text-xs text-gray-500">
                ตรวจเช็คเวลาและลำดับสถานที่ก่อนยืนยันเข้าทริป
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setPreviewOpen(false)}
              className="p-2 rounded-full bg-gray-100"
            >
              <XMarkIcon size={20} color="#374151" />
            </TouchableOpacity>
          </View>

          {/* สลับวัน (ถ้ามีหลายวัน) */}
          {days.length > 1 ? (
            <View className="bg-white px-3 py-2 border-b border-gray-100">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {days.map((d, i) => (
                  <TouchableOpacity
                    key={`preview-tab-${i}`}
                    onPress={() => setPreviewDayIndex(i)}
                    className={`px-3 py-1.5 rounded-full mr-2 ${
                      i === previewDayIndex ? "bg-violet-600" : "bg-gray-100"
                    }`}
                  >
                    <Text
                      className={`text-xs font-bold ${
                        i === previewDayIndex ? "text-white" : "text-gray-700"
                      }`}
                    >
                      วันที่ {d.day}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* Timeline Content */}
          <ScrollView className="flex-1 px-4 pt-3" showsVerticalScrollIndicator={false}>
            {/* Timeline รายวัน: เวลา --- [กล่องชื่อสถานที่] */}
            <View className="bg-white rounded-3xl p-4 shadow-sm border border-gray-100 mb-4">
              <Text className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                กำหนดการ • วันที่ {days[previewDayIndex]?.day ?? 1}
              </Text>

              {days[previewDayIndex]?.stops?.map((stop, sIdx) => {
                const isLast = sIdx === (days[previewDayIndex]?.stops?.length ?? 0) - 1;
                return (
                  <View key={`timeline-${stop.id}-${sIdx}`} className="flex-row">
                    {/* คอลัมน์เวลา */}
                    <View className="w-16 items-end pr-3 pt-1">
                      <Text className="text-sm font-black text-violet-700">
                        {stop.arriveTime || "--:--"}
                      </Text>
                      {stop.stayHours ? (
                        <Text className="text-[10.5px] text-gray-400">
                          {stop.stayHours} ชม.
                        </Text>
                      ) : null}
                    </View>

                    {/* เส้น timeline */}
                    <View className="items-center mr-3">
                      <View className="w-3.5 h-3.5 rounded-full bg-violet-600 border-2 border-white shadow-sm mt-1" />
                      {!isLast && <View className="w-0.5 flex-1 bg-violet-200 my-1" />}
                    </View>

                    {/* กล่องชื่อสถานที่ */}
                    <View className="flex-1 mb-4">
                      <View className="bg-gray-50 border border-gray-100 rounded-2xl p-3">
                        <Text className="text-[14px] font-bold text-gray-900">
                          {stop.name}
                        </Text>
                        {stop.activity ? (
                          <Text className="text-xs text-gray-600 mt-0.5">
                            {stop.activity}
                          </Text>
                        ) : null}
                        {stop.estimatedCost != null && stop.estimatedCost > 0 ? (
                          <Text className="text-xs font-bold text-emerald-700 mt-1">
                            ค่าเข้า/กิจกรรม: {money(stop.estimatedCost)}
                          </Text>
                        ) : null}
                      </View>

                      {/* ระยะทาง/เวลาขับไปจุดถัดไป */}
                      {stop.driveToNextMins ? (
                        <View className="flex-row items-center mt-1 ml-1">
                          <Text className="text-[11px] text-gray-400 font-medium">
                            ↓ ขับรถ {stop.driveToNextMins} นาที
                            {stop.distanceFromPrevKm ? ` (${stop.distanceFromPrevKm.toFixed(1)} กม.)` : ""}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>

            {/* ข้อมูลงบประมาณที่คำนวณ (ตัวเลขโดดเด่นมาก) */}
            <View className="rounded-3xl p-5 shadow-md shadow-violet-200 mb-6 bg-violet-600">
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-violet-100 text-xs font-bold uppercase tracking-wider">
                  งบประมาณรวมเฉลี่ย
                </Text>
                <View className="bg-violet-500/40 px-2.5 py-0.5 rounded-full">
                  <Text className="text-white text-xs font-bold">
                    {travelers} ผู้เดินทาง
                  </Text>
                </View>
              </View>

              {/* ตัวเลขเด่น */}
              <View className="flex-row items-baseline my-1">
                <Text className="text-3xl font-black text-white">
                  {money(budget?.perPerson)}
                </Text>
                <Text className="text-violet-200 text-sm font-semibold ml-2">
                  / คน
                </Text>
              </View>
              <Text className="text-violet-200 text-xs mb-3">
                รวมทั้งหมดทั้งกลุ่ม: {money(budget?.total)}
              </Text>

              {/* Breakdown */}
              <View className="bg-white/10 rounded-2xl p-3 border border-white/15">
                <View className="flex-row justify-between py-1 border-b border-white/10">
                  <Text className="text-violet-100 text-xs">
                    {isEv ? "ค่าไฟฟ้า" : "ค่าน้ำมัน"}
                  </Text>
                  <Text className="text-white text-xs font-bold">{money(budget?.fuel)}</Text>
                </View>
                <View className="flex-row justify-between py-1 border-b border-white/10">
                  <Text className="text-violet-100 text-xs">ค่าที่พัก</Text>
                  <Text className="text-white text-xs font-bold">{money(budget?.lodging)}</Text>
                </View>
                <View className="flex-row justify-between py-1 border-b border-white/10">
                  <Text className="text-violet-100 text-xs">ค่าเข้าชมสถานที่ / กิจกรรม</Text>
                  <Text className="text-white text-xs font-bold">{money(budget?.activities)}</Text>
                </View>
                <View className="flex-row justify-between py-1">
                  <Text className="text-violet-100 text-xs">ค่าอาหารโดยประมาณ</Text>
                  <Text className="text-white text-xs font-bold">{money(budget?.food)}</Text>
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Footer Action Button */}
          <View className="bg-white p-4 border-t border-gray-100">
            <TouchableOpacity
              onPress={() => {
                setPreviewOpen(false);
                onConfirm?.();
              }}
              activeOpacity={0.85}
              className="bg-emerald-600 rounded-2xl py-3.5 items-center justify-center shadow-md shadow-emerald-200 flex-row"
            >
              <CheckBadgeIcon size={20} color="#FFFFFF" />
              <Text className="text-white text-base font-black ml-2">
                ยืนยันแพลนนี้และบันทึกเข้าทริป
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** ป้ายข้อมูลสรุป */
function InfoChip({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View className="flex-row items-center bg-white border border-violet-100 rounded-full px-2.5 py-1 mr-1.5 mb-1.5">
      {icon}
      <Text className="text-gray-700 text-[12px] font-bold ml-1">{text}</Text>
    </View>
  );
}

/** แถวต้นทุน */
function CostRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between py-0.5">
      <Text
        className={`text-gray-700 ${strong ? "text-[13.5px] font-black" : "text-[12.5px]"}`}
      >
        {label}
      </Text>
      <Text
        className={`text-gray-900 ${
          strong ? "text-[13.5px] font-black" : "text-[12.5px] font-bold"
        }`}
      >
        {value}
      </Text>
    </View>
  );
}

/** กล่องข้อความเตือน */
function NoticeBox({
  tone,
  title,
  children,
}: {
  tone: "amber" | "gray" | "blue";
  title: string;
  children: React.ReactNode;
}) {
  const map = {
    amber: "bg-amber-50 border-amber-200 text-amber-900",
    gray: "bg-gray-50 border-gray-200 text-gray-700",
    blue: "bg-blue-50 border-blue-200 text-blue-900",
  } as const;
  return (
    <View className={`border rounded-xl px-3 py-2 mb-1.5 ${map[tone]}`}>
      <Text className="text-[12px] font-black">{title}</Text>
      <Text className="text-[12.5px] leading-5 mt-0.5">{children}</Text>
    </View>
  );
}
