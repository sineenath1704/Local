import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import {
  CheckIcon,
  CalendarDaysIcon,
  SparklesIcon,
  ExclamationTriangleIcon,
  MapPinIcon,
} from "react-native-heroicons/outline";
import {
  TripSlots,
  VEHICLE_OPTIONS,
  FUEL_TYPE_OPTIONS,
  computeTripMissing,
} from "../data/tripsData";
import { fetchFuelPrices, FuelPriceSnapshot } from "../services/tripService";
import EditableValueRow from "./EditableValueRow";

/**
 * การ์ด "ข้อมูลแผนทริป" ในแชท
 * =============================================================
 * แสดงว่าเอไaiรู้อะไรแล้ว (✓) และอะไรยังขาด (…)
 * ผู้ใช้เติมเองได้ทีละช่อง → ปุ่ม "สร้างแพลนทริป" โผล่**เฉพาะเมื่อข้อมูลครบ**
 * (แก้ปัญหาปุ่ม "เลือกแพลนทริปนี้" ที่เดิมขึ้นทุกครั้งที่เอไaiตอบ)
 *
 * จุดเริ่มต้น / จุดสิ้นสุดตอนกลับ / จุดสิ้นสุดต่อวัน เป็นคนละช่องข้อมูลกัน
 */

const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
const THAI_WEEKDAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

/** ชนิดน้ำมันเริ่มต้นของแต่ละรถ (ต้องตรงกับ backend/src/vehicles.ts) */
const DEFAULT_FUEL_BY_VEHICLE: Record<string, string> = {
  private_car: "gasohol95",
  diesel_car: "diesel",
  pickup: "gasohol95",
  van: "diesel",
  motorbike: "gasohol95",
  ev: "electric",
  public: "",
};

/** รถที่ไม่ใช้น้ำมัน (ไฟฟ้า / ขนส่งสาธารณะ) → ไม่ต้องเลือกชนิดน้ำมัน */
const NO_FUEL_VEHICLES = ["ev", "public"];

const START_TIMES = [
  "06:00", "07:00", "08:00", "09:00", "10:00", "11:00",
  "12:00", "13:00", "14:00", "16:00", "18:00",
];

function toIso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${THAI_WEEKDAYS[d.getDay()]} ${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

/** 14 วันนับจากวันนี้ — เลือกวันที่ได้โดยไม่ต้องมี date-picker */
function upcomingDays(count = 14): { iso: string; label: string; dow: string; day: string }[] {
  const out: { iso: string; label: string; dow: string; day: string }[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    out.push({
      iso: toIso(d),
      label: THAI_MONTHS[d.getMonth()],
      dow: THAI_WEEKDAYS[d.getDay()],
      day: String(d.getDate()),
    });
  }
  return out;
}

function vehicleKey(v?: string | null): string | null {
  if (!v) return null;
  const hit = VEHICLE_OPTIONS.find((o) => o.key === v || o.label === v);
  return hit?.key ?? null;
}

function vehicleLabel(v?: string | null): string {
  if (!v) return "";
  return VEHICLE_OPTIONS.find((o) => o.key === v || o.label === v)?.label ?? v;
}

function fuelLabel(v?: string | null): string {
  if (!v) return "";
  return FUEL_TYPE_OPTIONS.find((o) => o.key === v || o.label === v)?.label ?? v;
}

/** ชิปเลือกค่า (ใช้ซ้ำทุกแถว) */
function Chip({
  label,
  active,
  onPress,
  sub,
  onTapReport,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  sub?: string;
  onTapReport?: TapReport;
}) {
  return (
    <TouchableOpacity
      onPress={() => {
        onTapReport?.(label, "press");
        onPress();
      }}
      onPressIn={() => onTapReport?.(label, "down")}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      className={`px-3 py-1.5 rounded-xl border mr-2 mb-2 ${
        active ? "bg-violet-600 border-violet-600" : "bg-white border-gray-200"
      }`}
    >
      <Text
        className={`text-[13px] font-bold ${active ? "text-white" : "text-gray-700"}`}
      >
        {label}
      </Text>
      {sub ? (
        <Text
          className={`text-[12px] ${active ? "text-violet-100" : "text-gray-400"}`}
        >
          {sub}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

/** เป้าหมายของตัวเลือกจุด — จุดเริ่มต้น / จุดสิ้นสุดตอนกลับ / จุดจบของแต่ละวัน */
export type TripOriginTarget = "start" | "end" | { day: number };

/**
 * รายงานการแตะ (phase = "down" คือนิ้วแตะลง · "press" คือกดสำเร็จ)
 * ใช้ตรวจอาการ "กดการ์ดแล้วไม่มีอะไรเกิดขึ้น" — ชั่วคราว แก้เสร็จแล้วเอาออก
 */
export type TapReport = (label: string, phase: "down" | "press") => void;

/**
 * ตัวนับจำนวนครั้งที่ render (ชั่วคราว — ใช้วินิจฉัยว่าแอปค้างเพราะ render loop)
 * · chat = หน้าจอแชท · card = การ์ดช่องข้อมูล
 */
export const renderCounter = { chat: 0, card: 0 };

interface TripDraftCardProps {
  slots: TripSlots;
  /** ผู้ใช้แก้ช่องในการ์ด → ส่งค่าใหม่กลับไปเก็บสะสม */
  onChange: (slots: TripSlots) => void;
  /** ข้อมูลครบแล้ว → กดสร้างแพลน */
  onCreatePlan: () => void;
  /** กำลังเรียก backend อยู่ */
  creating?: boolean;
  /**
   * ขอเปิดตัวเลือกจุด
   * -------------------------------------------------------------
   * ตัวเลือกจุด (Modal ของ native) ต้องอยู่ **นอก** ลิสต์ ไม่ใช่ในแถวที่ลิสต์
   * เอาไว้ recycle เพราะ modal ที่ค้างอยู่ในแถวจะกลืนการแตะทั้งหน้าจอ
   * (เคยเจอจริง: กดอะไรก็ไม่ได้ หน้าจะเหมือนค้าง)
   */
  onRequestOrigin?: (target: TripOriginTarget) => void;
  /** รายงานการแตะทุกปุ่มในการ์ด (ใช้วินิจฉัยอาการกดไม่ได้ — ชั่วคราว) */
  onTapReport?: TapReport;
}

export default function TripDraftCard({
  slots,
  onChange,
  onCreatePlan,
  creating,
  onRequestOrigin,
  onTapReport,
}: TripDraftCardProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [fuelPrice, setFuelPrice] = useState<FuelPriceSnapshot | null>(null);
  // เริ่มที่ true เพราะกำลังดึงราคาทันทีที่เปิดการ์ด (ไม่ต้อง setState ซ้ำใน effect)
  const [fuelLoading, setFuelLoading] = useState(true);

  const days = Math.min(7, Math.max(1, Number(slots.days) || 1));
  const missing = useMemo(() => computeTripMissing(slots), [slots]);
  const ready = missing.length === 0;
  const returnMode = slots.returnMode === "custom" ? "custom" : "same_as_start";
  const vehKey = vehicleKey(slots.vehicle);
  const usesFuel = !!vehKey && !NO_FUEL_VEHICLES.includes(vehKey);

  // ราคาน้ำมันสด — ดึงครั้งเดียวตอนเปิดการ์ด (backend แคป 3 ชม. อยู่แล้ว)
  useEffect(() => {
    renderCounter.card += 1;
  });

  useEffect(() => {
    let cancelled = false;
    fetchFuelPrices()
      .then((snap) => {
        if (!cancelled) setFuelPrice(snap);
      })
      .finally(() => {
        if (!cancelled) setFuelLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = (next: Partial<TripSlots>) => onChange({ ...slots, ...next });

  /** เปิด/ปิดแถวที่กำลังแก้ (พร้อมรายงานการแตะไว้วินิจฉัย) */
  const toggleRow = (key: string, label: string) => () => {
    onTapReport?.(label, "press");
    setEditing((cur) => (cur === key ? null : key));
  };

  const days7 = upcomingDays(14);
  const fuelKey = slots.fuelType ?? (vehKey ? DEFAULT_FUEL_BY_VEHICLE[vehKey] : null);
  const livePrice =
    fuelPrice && fuelKey ? fuelPrice.prices?.[fuelKey] : undefined;

  return (
    <View className="mt-2 self-stretch bg-violet-50 border border-violet-200 rounded-2xl overflow-hidden">
      <View className="flex-row items-center px-3.5 py-2.5 bg-violet-100">
        <SparklesIcon size={15} color="#6D28D9" />
        <Text className="text-violet-900 text-[13px] font-black ml-1.5 flex-1">
          ข้อมูลแผนทริปที่ต้องการ
        </Text>
        <Text className="text-violet-700 text-[12px] font-bold">
          {ready ? "ครบแล้ว ✓" : `ขาด ${missing.length} ช่อง`}
        </Text>
      </View>

      <View className="p-3">
        {/* ── จุดเริ่มต้น ───────────────────────────────────────── */}
        <EditableValueRow
          label="จุดเริ่มต้น"
          icon="🚗"
          tone="amber"
          value={slots.startPoint?.label ?? ""}
          emptyHint="ยังไม่ได้เลือก — ต้องมีพิกัด"
          editing={editing === "start"}
          onToggle={toggleRow("start", "จุดเริ่มต้น")}
          badge={
            slots.startPoint?.coords
              ? { text: "มีพิกัด", tone: "green" }
              : slots.startPoint
              ? { text: "ไม่มีพิกัด", tone: "amber" }
              : undefined
          }
        >
          <TouchableOpacity
            onPress={() => onRequestOrigin?.("start")}
            onPressIn={() => onTapReport?.("เลือกจุดเริ่มต้น", "down")}
            activeOpacity={0.8}
            className="flex-row items-center bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5"
          >
            <MapPinIcon size={16} color="#7C3AED" />
            <Text className="text-violet-800 text-[13px] font-bold ml-1.5">
              เลือกจุดเริ่มต้น (ที่บันทึกไว้ · พิมพ์เอง · ลิงก์ Google Maps)
            </Text>
          </TouchableOpacity>
        </EditableValueRow>

        {/* ── จุดสิ้นสุดตอนกลับ (แยกจากจุดเริ่มต้น) ─────────────── */}
        <EditableValueRow
          label="จุดสิ้นสุดตอนกลับ"
          icon="🏁"
          tone="amber"
          value={
            returnMode === "custom"
              ? slots.endPoint?.label ?? ""
              : `กลับจุดเดิม${slots.startPoint?.label ? ` (${slots.startPoint.label})` : ""}`
          }
          emptyHint="ยังไม่ได้เลือก"
          editing={editing === "end"}
          onToggle={toggleRow("end", "จุดสิ้นสุดตอนกลับ")}
          badge={
            returnMode === "custom"
              ? slots.endPoint?.coords
                ? { text: "คนละจุด", tone: "blue" }
                : { text: "ไม่มีพิกัด", tone: "amber" }
              : { text: "กลับจุดเดิม", tone: "gray" }
          }
        >
          <View className="flex-row flex-wrap mb-2">
            <Chip
              label="กลับจุดเดิม"
              active={returnMode === "same_as_start"}
              onTapReport={onTapReport}
              onPress={() =>
                patch({ returnMode: "same_as_start", endPoint: null })
              }
            />
            <Chip
              label="กลับคนละจุดกับจุดเริ่ม"
              active={returnMode === "custom"}
              onTapReport={onTapReport}
              onPress={() => patch({ returnMode: "custom" })}
            />
          </View>
          {returnMode === "custom" ? (
            <TouchableOpacity
              onPress={() => onRequestOrigin?.("end")}
              onPressIn={() => onTapReport?.("เลือกจุดสิ้นสุดตอนกลับ", "down")}
              activeOpacity={0.8}
              className="flex-row items-center bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5"
            >
              <MapPinIcon size={16} color="#7C3AED" />
              <Text className="text-violet-800 text-[13px] font-bold ml-1.5">
                เลือกจุดสิ้นสุดตอนกลับ
              </Text>
            </TouchableOpacity>
          ) : null}
        </EditableValueRow>

        {/* ── จุดสิ้นสุดของแต่ละวัน (หลายวัน) ──────────────────── */}
        {days > 1
          ? Array.from({ length: days - 1 }).map((_, i) => {
              const point = slots.dayEndPoints?.[i] ?? null;
              return (
                <EditableValueRow
                  key={`day-end-${i}`}
                  label={`จุดสิ้นสุดของวันที่ ${i + 1}`}
                  icon="🌙"
                  tone="amber"
                  value={point?.label ?? ""}
                  emptyHint="ยังไม่ได้เลือก — ปล่อยว่างไว้ได้ ระบบจะจัดให้"
                  editing={editing === `day-${i}`}
                  onToggle={toggleRow(`day-${i}`, `จุดสิ้นสุดของวันที่ ${i + 1}`)}
                  badge={
                    point?.coords
                      ? { text: "มีพิกัด", tone: "green" }
                      : undefined
                  }
                >
                  <TouchableOpacity
                    onPress={() => onRequestOrigin?.({ day: i })}
                    onPressIn={() =>
                      onTapReport?.(`เลือกจุดจบของวันที่ ${i + 1}`, "down")
                    }
                    activeOpacity={0.8}
                    className="flex-row items-center bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5"
                  >
                    <MapPinIcon size={16} color="#7C3AED" />
                    <Text className="text-violet-800 text-[13px] font-bold ml-1.5">
                      เลือกจุดจบของวันที่ {i + 1}
                    </Text>
                  </TouchableOpacity>
                </EditableValueRow>
              );
            })
          : null}

        {/* ── วันที่ ────────────────────────────────────────────── */}
        <EditableValueRow
          label="วันที่"
          icon="📅"
          tone="amber"
          value={slots.date ? formatDate(slots.date) : ""}
          emptyHint="ยังไม่ได้เลือกวันที่"
          editing={editing === "date"}
          onToggle={toggleRow("date", "วันที่")}
        >
          <View className="flex-row flex-wrap">
            {days7.map((d) => (
              <Chip
                key={d.iso}
                label={`${d.dow} ${d.day} ${d.label}`}
                active={slots.date === d.iso}
                onTapReport={onTapReport}
                onPress={() => patch({ date: d.iso })}
              />
            ))}
          </View>
        </EditableValueRow>

        {/* ── เวลาเริ่มต้น ─────────────────────────────────────── */}
        <EditableValueRow
          label="เวลาเริ่มต้น"
          icon="⏰"
          tone="amber"
          value={slots.startTime ?? ""}
          emptyHint="ยังไม่ได้เลือกเวลา"
          editing={editing === "time"}
          onToggle={toggleRow("time", "เวลาเริ่มต้น")}
        >
          <View className="flex-row flex-wrap">
            {START_TIMES.map((t) => (
              <Chip
                key={t}
                label={t}
                active={slots.startTime === t}
                onTapReport={onTapReport}
                onPress={() => patch({ startTime: t })}
              />
            ))}
          </View>
        </EditableValueRow>

        {/* ── จำนวนวัน ─────────────────────────────────────────── */}
        <EditableValueRow
          label="จำนวนวัน"
          icon="📆"
          tone="amber"
          value={slots.days ? `${slots.days} วัน` : ""}
          emptyHint="ยังไม่ได้เลือก"
          editing={editing === "days"}
          onToggle={toggleRow("days", "จำนวนวัน")}
        >
          <View className="flex-row flex-wrap">
            {[1, 2, 3, 4, 5].map((n) => (
              <Chip
                key={n}
                label={`${n} วัน`}
                sub={n > 1 ? `ค้างคืน ${n - 1}` : "ไป-กลับ"}
                active={slots.days === n}
                onTapReport={onTapReport}
                onPress={() =>
                  patch({
                    days: n,
                    dayEndPoints:
                      n <= 1 ? null : (slots.dayEndPoints ?? []).slice(0, n - 1),
                  })
                }
              />
            ))}
          </View>
        </EditableValueRow>

        {/* ── รถที่ใช้ ─────────────────────────────────────────── */}
        <EditableValueRow
          label="รถที่ใช้"
          icon="🚙"
          tone="amber"
          value={vehicleLabel(slots.vehicle)}
          emptyHint="ยังไม่ได้เลือกรถ"
          editing={editing === "vehicle"}
          onToggle={toggleRow("vehicle", "รถที่ใช้")}
        >
          <View className="flex-row flex-wrap">
            {VEHICLE_OPTIONS.map((v) => (
              <Chip
                key={v.key}
                label={v.label}
                active={vehKey === v.key}
                onTapReport={onTapReport}
                onPress={() => {
                  const nextFuel = DEFAULT_FUEL_BY_VEHICLE[v.key] || null;
                  patch({
                    vehicle: v.key,
                    fuelType: nextFuel,
                  });
                }}
              />
            ))}
          </View>
        </EditableValueRow>

        {/* ── ชนิดน้ำมัน (+ ราคาสด) ────────────────────────────── */}
        {usesFuel ? (
          <EditableValueRow
            label="ชนิดน้ำมัน"
            icon="⛽"
            tone="amber"
            value={fuelLabel(fuelKey)}
            emptyHint="ยังไม่ได้เลือก"
            editing={editing === "fuel"}
            onToggle={toggleRow("fuel", "ชนิดน้ำมัน")}
            badge={
              livePrice != null
                ? {
                    text: `${livePrice.toFixed(2)} ฿/ลิตร`,
                    tone: fuelPrice?.isEstimate ? "amber" : "green",
                  }
                : undefined
            }
          >
            <View className="flex-row flex-wrap mb-2">
              {FUEL_TYPE_OPTIONS.filter((f) => f.key !== "electric").map((f) => (
                <Chip
                  key={f.key}
                  label={f.label}
                  sub={
                    fuelPrice?.prices?.[f.key] != null
                      ? `${fuelPrice.prices[f.key].toFixed(2)} ฿`
                      : undefined
                  }
                  active={fuelKey === f.key}
                  onTapReport={onTapReport}
                  onPress={() => patch({ fuelType: f.key })}
                />
              ))}
            </View>
            {fuelLoading ? (
              <View className="flex-row items-center">
                <ActivityIndicator size="small" color="#7C3AED" />
                <Text className="text-gray-500 text-[12px] ml-1.5">
                  กำลังดึงราคาน้ำมันล่าสุด...
                </Text>
              </View>
            ) : fuelPrice ? (
              <Text className="text-gray-500 text-[12px] leading-5">
                ราคาวันนี้จาก {fuelPrice.source}
                {fuelPrice.effectiveDate ? ` · มีผล ${fuelPrice.effectiveDate}` : ""}
                {fuelPrice.isEstimate ? " · ประมาณการ (ดึงเว็บไม่สำเร็จ)" : ""}
                {"\n"}ตัวเลขนี้จะถูกใช้คิดค่าน้ำมันในแผน — แก้เองได้หลังสร้างแพลน
              </Text>
            ) : (
              <Text className="text-gray-500 text-[12px]">
                ดึงราคาน้ำมันไม่สำเร็จ — ระบบจะใช้ค่าสำรองและติดป้าย "ประมาณการ"
              </Text>
            )}
          </EditableValueRow>
        ) : null}

        {/* ── จำนวนผู้เดินทาง ─────────────────────────────────── */}
        <EditableValueRow
          label="จำนวนผู้เดินทาง"
          icon="👥"
          tone="amber"
          value={slots.travelers ? `${slots.travelers} คน` : ""}
          emptyHint="ยังไม่ได้ระบุ"
          editing={editing === "travelers"}
          onToggle={toggleRow("travelers", "จำนวนผู้เดินทาง")}
        >
          <View className="flex-row flex-wrap">
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <Chip
                key={n}
                label={`${n} คน`}
                active={slots.travelers === n}
                onTapReport={onTapReport}
                onPress={() => patch({ travelers: n })}
              />
            ))}
          </View>
        </EditableValueRow>

        {/* ── งบต่อคน ─────────────────────────────────────────── */}
        <EditableValueRow
          label="งบต่อคน"
          icon="💰"
          tone="amber"
          value={
            slots.budgetPerPerson
              ? `${slots.budgetPerPerson.toLocaleString("th-TH")} บาท`
              : ""
          }
          emptyHint="ยังไม่ได้ระบุ"
          editing={editing === "budget"}
          onToggle={toggleRow("budget", "งบต่อคน")}
        >
          <View className="flex-row flex-wrap">
            {[1500, 3000, 5000, 8000, 12000].map((n) => (
              <Chip
                key={n}
                label={`${n.toLocaleString("th-TH")} บาท`}
                active={slots.budgetPerPerson === n}
                onTapReport={onTapReport}
                onPress={() => patch({ budgetPerPerson: n })}
              />
            ))}
          </View>
        </EditableValueRow>

        {/* ── สรุปว่าขาดอะไร ───────────────────────────────────── */}
        {!ready ? (
          <View className="bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2.5 mb-3">
            <View className="flex-row items-center">
              <ExclamationTriangleIcon size={14} color="#B45309" />
              <Text className="text-amber-800 text-[12.5px] font-bold ml-1.5">
                ยังขาด: {missing.join(" · ")}
              </Text>
            </View>
          </View>
        ) : null}

        {/* ── ปุ่มสร้างแพลน ────────────────────────────────────── */}
        <TouchableOpacity
          onPress={onCreatePlan}
          onPressIn={() => onTapReport?.("สร้างแพลนทริป", "down")}
          disabled={!ready || creating}
          activeOpacity={0.85}
          className={`rounded-2xl py-3 items-center justify-center flex-row ${
            ready && !creating ? "bg-violet-600 shadow-md shadow-violet-200" : "bg-gray-200"
          }`}
        >
          {creating ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <CalendarDaysIcon size={17} color={ready ? "#FFFFFF" : "#9CA3AF"} />
          )}
          <Text
            className={`text-[14px] font-bold ml-1.5 ${
              ready ? "text-white" : "text-gray-500"
            }`}
          >
            {creating
              ? "กำลังคำนวณเส้นทาง..."
              : ready
              ? "สร้างแพลนทริป"
              : "กรอกข้อมูลให้ครบก่อน"}
          </Text>
        </TouchableOpacity>

        {ready ? (
          <View className="flex-row items-center mt-2">
            <CheckIcon size={13} color="#059669" />
            <Text className="text-gray-500 text-[12px] ml-1 flex-1">
              ระบบจะคำนวณเส้นทางจริง · เวลาเปิด-ปิด · ค่าน้ำมันจากราคาสด ให้อัตโนมัติ
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
