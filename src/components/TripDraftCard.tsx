import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
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
  FUEL_TYPE_OPTIONS,
  computeTripMissing,
  formatThaiDateRange,
  tripRangeDays,
  tripTodayIso,
  vehicleClassOf,
  VEHICLE_CLASS_OPTIONS,
  type VehicleClass,
} from "../data/tripsData";
import { fetchFuelPrices, FuelPriceSnapshot } from "../services/tripService";
import EditableValueRow from "./EditableValueRow";

/**
 * การ์ด "ข้อมูลแผนทริป" ในแชท
 * =============================================================
 * แบ่งเป็น 2 กลุ่ม:
 *   · "ต้องกรอก"          — ข้อมูลที่ขาดไม่ได้จริง ๆ (จุดเริ่ม · จุดสิ้นสุดตอนกลับ · ช่วงวันที่ · เวลา · รถ)
 *   · "ข้อมูลเพิ่มเติม"      — ไม่บังคับ (งบ · จำนวนคน · จุดจบรายวัน) ปล่อยว่างไว้ให้เอไaiจัดให้
 *
 * ชนิดน้ำมัน **ไม่ใช่ช่องกรอก** — ผู้ใช้ใส่ชื่อ/รุ่นรถ แล้วเอไaiเป็นคนระบุว่ารถคันนั้นใช้น้ำมันอะไร
 * ราคา/ลิตรมาจาก cache รายวันของ backend และค่าน้ำมันในแผนคิดจากระยะทางจริงของแผน
 */

/** ราคาน้ำมันของวันนี้ (กันดึงซ้ำตอนมีการ์ดหลายใบในหน้าเดียว) */
let fuelCache: { day: string; snap: FuelPriceSnapshot | null } | null = null;

/**
 * จัดรูปแบบราคาให้ปลอดภัยเสมอ
 * -------------------------------------------------------------
 * ถ้าค่าที่ได้มาไม่ใช่ตัวเลข (เช่น backend ส่ง string มา หรือค่าหาย)
 * ให้แสดง "—" แทนการเรียก `.toFixed()` แล้วพังทั้งแอป
 */
function formatPrice(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n.toFixed(2);
  }
  return "—";
}

function fuelLabel(v?: string | null): string {
  if (!v) return "";
  return FUEL_TYPE_OPTIONS.find((o) => o.key === v || o.label === v)?.label ?? v;
}

/** เป้าหมายของตัวเลือกจุด — จุดเริ่มต้น / จุดสิ้นสุดตอนกลับ / จุดจบของแต่ละวัน */
export type TripOriginTarget = "start" | "end" | { day: number };

/** ช่องติ๊ก (ใช้กับ "จุดสิ้นสุดคือที่เดียวกับจุดเริ่มต้นไหม") */
function CheckBox({
  checked,
  onPress,
  label,
}: {
  checked: boolean;
  onPress: () => void;
  label: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      className="flex-row items-center"
    >
      <View
        className={`w-5 h-5 rounded-md border items-center justify-center ${
          checked ? "bg-violet-600 border-violet-600" : "bg-white border-gray-300"
        }`}
      >
        {checked ? <CheckIcon size={13} color="#FFFFFF" strokeWidth={3} /> : null}
      </View>
      <Text className="text-[13.5px] font-bold text-gray-800 ml-2">{label}</Text>
    </TouchableOpacity>
  );
}

/** ชิปเลือกค่า (ใช้ซ้ำทุกแถว) */
function Chip({
  label,
  active,
  onPress,
  sub,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  sub?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
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

/** หัวการ์ดย่อยของแต่ละกลุ่ม */
function SectionTitle({
  title,
  hint,
  tone,
}: {
  title: string;
  hint?: string;
  tone: "required" | "optional";
}) {
  const isRequired = tone === "required";
  return (
    <View className="flex-row items-center mt-1 mb-2">
      <View
        className={`px-2 py-0.5 rounded-full ${
          isRequired ? "bg-amber-100" : "bg-gray-100"
        }`}
      >
        <Text
          className={`text-[11px] font-black ${
            isRequired ? "text-amber-800" : "text-gray-500"
          }`}
        >
          {isRequired ? "ต้องกรอก" : "ไม่บังคับ"}
        </Text>
      </View>
      <Text className="text-[13px] font-black text-gray-800 ml-2">{title}</Text>
      {hint ? (
        <Text className="text-[11.5px] text-gray-400 ml-1.5 flex-1">{hint}</Text>
      ) : null}
    </View>
  );
}

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
   * (เคยเจอจริง: กดอะไรก็ไม่ได้ หน้าจอเหมือนค้าง)
   */
  onRequestOrigin: (target: TripOriginTarget) => void;
  /** ขอเปิดปฏิทินเลือกช่วงวันที่ (เปิดครั้งเดียว เลือกวันเริ่ม → วันสิ้นสุด) */
  onRequestDateRange: () => void;
  /** ขอเปิดล้อเวลาออกเดินทาง */
  onRequestTime: () => void;
}

function TripDraftCardInner({
  slots,
  onChange,
  onCreatePlan,
  creating,
  onRequestOrigin,
  onRequestDateRange,
  onRequestTime,
}: TripDraftCardProps) {
  const [editing, setEditing] = useState<string | null>(null);
  /**
   * ราคาน้ำมันที่เพิ่งดึงมา (เก็บใน state)
   * ถ้ามี cache ของวันนี้อยู่แล้วจะใช้ค่านั้นโดยตรง (ไม่ต้อง setState ใน effect)
   */
  const [fetchedFuel, setFetchedFuel] = useState<FuelPriceSnapshot | null>(
    null
  );
  const [fuelFailed, setFuelFailed] = useState(false);

  const missing = useMemo(() => computeTripMissing(slots), [slots]);
  const ready = missing.length === 0;
  const returnMode = slots.returnMode === "custom" ? "custom" : "same_as_start";
  const vehicleClass: VehicleClass | null = vehicleClassOf(slots.vehicle);
  const usesFuel = vehicleClass === "private_car";
  const days = tripRangeDays(slots.startDate, slots.endDate) ?? 1;

  /**
   * ดึงราคาน้ำมันแบบขี้เกียจ
   * -------------------------------------------------------------
   * ดึงเฉพาะตอนที่ "ใช้น้ำมัน" จริง ๆ (รถส่วนตัว) ไม่งั้นทุกครั้งที่เปิดการ์ด
   * และมี `.catch()` เสมอ → ราคาน้ำมันล้มเหลวไม่ทำให้การ์ดพัง
   *
   * ถ้ามี cache ของวันนี้อยู่แล้ว → ไม่ยิงซ้ำ (ค่าถูกอ่านตอน render อยู่แล้ว)
   */
  useEffect(() => {
    if (!usesFuel) return;
    const day = tripTodayIso();
    if (fuelCache?.day === day) return;
    let cancelled = false;
    fetchFuelPrices()
      .then((snap) => {
        fuelCache = { day, snap };
        if (!cancelled) {
          setFetchedFuel(snap);
          setFuelFailed(false);
        }
      })
      .catch(() => {
        // ราคาน้ำมันเป็นข้อมูลเสริม — ล้มเหลวไม่ทำให้ทั้งแอปล้ม
        if (!cancelled) setFuelFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [usesFuel]);

  const patch = (next: Partial<TripSlots>) => onChange({ ...slots, ...next });

  /**
   * ขอเปิดตัวเลือกจุด
   * -------------------------------------------------------------
   * `onRequestOrigin` เป็น prop บังคับ (TypeScript จับได้ถ้าลืมส่ง) แต่กันไว้อีกชั้น
   * เผื่อถูกเรียกจากที่ที่ callback ยังไม่พร้อม → เดิมเกิด "กดแล้วไม่มีอะไรเกิดขึ้น"
   * เงียบ ๆ (ผู้ใช้คิดว่าแอปค้าง)
   */
  const requestOrigin = (target: TripOriginTarget) => {
    if (typeof onRequestOrigin === "function") {
      onRequestOrigin(target);
      return;
    }
    Alert.alert(
      "เปิดตัวเลือกจุดไม่ได้",
      "หน้านี้ยังไม่พร้อมให้เลือกจุด — ลองกลับไปหน้าแชทแล้วเปิดใหม่"
    );
  };

  /** เปิด/ปิดแถวที่กำลังแก้ */
  const toggleRow = (key: string) => () => {
    setEditing((cur) => (cur === key ? null : key));
  };

  /**
   * ราคาน้ำมันที่ใช้แสดงผล
   * - ค่าที่เพิ่งดึงมา (state) ชนะก่อน
   * - ถ้ายังไม่มี → ใช้ cache ของ "วันนี้" (ข้ามวันแล้วถือว่าไม่มี)
   * - ยังไม่มีและยังไม่ล้มเหลว → กำลังโหลด
   */
  const todayKey = tripTodayIso();
  const cachedFuel = fuelCache?.day === todayKey ? fuelCache.snap : null;
  const fuelPrice = fetchedFuel ?? cachedFuel;
  const fuelLoading = usesFuel && !fuelPrice && !fuelFailed;

  const fuelKey = slots.fuelType ?? null;
  const livePrice =
    fuelPrice && fuelKey ? fuelPrice.prices[fuelKey] : undefined;
  const isStale = fuelPrice?.isStale === true;

  return (
    <View className="mt-2 self-stretch bg-violet-50 border border-violet-200 rounded-2xl overflow-hidden">
      <View className="flex-row items-center px-3.5 py-2.5 bg-violet-100">
        <SparklesIcon size={15} color="#6D28D9" />
        <Text className="text-violet-900 text-[13px] font-black ml-1.5 flex-1">
          ข้อมูลแผนทริปที่ต้องกร
        </Text>
        <Text className="text-violet-700 text-[12px] font-bold">
          {ready ? "ครบแล้ว ✓" : `ขาด ${missing.length} ช่อง`}
        </Text>
      </View>

      <View className="p-3">
        {/* ══ กลุ่มที่ต้องกรอก ═════════════════════════════════════ */}
        <SectionTitle
          title="ข้อมูลที่ต้องกรอก"
          hint="5 ช่องนี้พอวางแผนได้แล้ว"
          tone="required"
        />

        {/* ── จุดเริ่มต้น ───────────────────────────────────────── */}
        <EditableValueRow
          label="จุดเริ่มต้น"
          icon="🚗"
          tone="amber"
          value={slots.startPoint?.label ?? ""}
          emptyHint="ยังไม่ได้เลือก — ต้องมีพิกัด"
          editing={editing === "start"}
          onToggle={toggleRow("start")}
          badge={
            slots.startPoint?.coords
              ? { text: "มีพิกัด", tone: "green" }
              : slots.startPoint
              ? { text: "ไม่มีพิกัด", tone: "amber" }
              : undefined
          }
        >
          <TouchableOpacity
            onPress={() => requestOrigin("start")}
            activeOpacity={0.8}
            className="flex-row items-center bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5"
          >
            <MapPinIcon size={16} color="#7C3AED" />
            <Text className="text-violet-800 text-[13px] font-bold ml-1.5">
              เลือกจุดเริ่มต้น (ที่บันทึกไว้ · พิมพ์เอง · ลิงก์ Google Maps)
            </Text>
          </TouchableOpacity>
        </EditableValueRow>

        {/* ── จุดสิ้นสุดตอนกลับ (ช่องติ๊ก: เหมือนจุดเริ่มต้นไหม) ──── */}
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
          onToggle={toggleRow("end")}
          badge={
            returnMode === "custom"
              ? slots.endPoint?.coords
                ? { text: "คนละจุด", tone: "blue" }
                : { text: "ไม่มีพิกัด", tone: "amber" }
              : { text: "กลับจุดเดิม", tone: "gray" }
          }
        >
          <CheckBox
            checked={returnMode === "same_as_start"}
            onPress={() =>
              patch(
                returnMode === "same_as_start"
                  ? { returnMode: "custom" }
                  : { returnMode: "same_as_start", endPoint: null }
              )
            }
            label="จุดสิ้นสุดคือที่เดียวกับจุดเริ่มต้น"
          />
          {returnMode === "custom" ? (
            <TouchableOpacity
              onPress={() => requestOrigin("end")}
              activeOpacity={0.8}
              className="flex-row items-center bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5 mt-2"
            >
              <MapPinIcon size={16} color="#7C3AED" />
              <Text className="text-violet-800 text-[13px] font-bold ml-1.5">
                เลือกจุดสิ้นสุดตอนกลับ
              </Text>
            </TouchableOpacity>
          ) : (
            <Text className="text-gray-500 text-[12px] mt-1.5">
              กลับจุดเริ่มต้นเดิม — ไม่ต้องเลือกเพิ่ม
            </Text>
          )}
        </EditableValueRow>

        {/* ── วันเดินทาง (ช่วง) ────────────────────────────────── */}
        <EditableValueRow
          label="วันเดินทาง"
          icon="📅"
          tone="amber"
          value={formatThaiDateRange(slots.startDate, slots.endDate)}
          emptyHint="ยังไม่ได้เลือกวันที่"
          editing={editing === "date"}
          onToggle={toggleRow("date")}
          badge={
            slots.startDate && slots.endDate
              ? { text: `${days} วัน`, tone: "green" }
              : undefined
          }
        >
          <TouchableOpacity
            onPress={onRequestDateRange}
            activeOpacity={0.8}
            className="flex-row items-center bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5"
          >
            <CalendarDaysIcon size={16} color="#7C3AED" />
            <Text className="text-violet-800 text-[13px] font-bold ml-1.5">
              เลือกช่วงวันที่ (วันเริ่ม → วันสิ้นสุด)
            </Text>
          </TouchableOpacity>
          <Text className="text-gray-500 text-[12px] mt-1.5">
            เปิดปฏิทินครั้งเดียว กดวันเริ่มแล้วกดวันสิ้นสุด · ได้ไม่เกิน 7 วัน
          </Text>
        </EditableValueRow>

        {/* ── เวลาออกเดินทาง ────────────────────────────────────── */}
        <EditableValueRow
          label="เวลาออกเดินทาง"
          icon="⏰"
          tone="amber"
          value={slots.startTime ?? ""}
          emptyHint="ยังไม่ได้เลือกเวลา"
          editing={editing === "time"}
          onToggle={toggleRow("time")}
        >
          <TouchableOpacity
            onPress={onRequestTime}
            activeOpacity={0.8}
            className="flex-row items-center bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5"
          >
            <Text className="text-violet-800 text-[13px] font-bold">
              เลือกเวลาออกเดินทาง
            </Text>
          </TouchableOpacity>
        </EditableValueRow>

        {/* ── ประเภทรถ (+ ชื่อ/รุ่นรถ) ───────────────────────────── */}
        <EditableValueRow
          label="ประเภทรถ"
          icon="🚙"
          tone="amber"
          value={
            vehicleClass
              ? VEHICLE_CLASS_OPTIONS.find((o) => o.key === vehicleClass)?.label ??
                ""
              : ""
          }
          emptyHint="ยังไม่ได้เลือกรถ"
          editing={editing === "vehicle"}
          onToggle={toggleRow("vehicle")}
          badge={
            slots.vehicleModel?.trim()
              ? { text: slots.vehicleModel.trim(), tone: "blue" }
              : undefined
          }
        >
          <View className="flex-row flex-wrap">
            {VEHICLE_CLASS_OPTIONS.map((v) => (
              <Chip
                key={v.key}
                label={v.label}
                active={vehicleClass === v.key}
                onPress={() =>
                  patch(
                    v.key === "public"
                      ? { vehicle: v.key, vehicleModel: null, fuelType: null }
                      : { vehicle: v.key }
                  )
                }
              />
            ))}
          </View>

          {vehicleClass === "private_car" ? (
            <View className="mt-1">
              <Text className="text-[12.5px] font-bold text-gray-700 mb-1">
                ชื่อ/รุ่นรถ
              </Text>
              <TextInput
                value={slots.vehicleModel ?? ""}
                onChangeText={(t) => patch({ vehicleModel: t })}
                placeholder="เช่น Toyota Corolla Altis"
                placeholderTextColor="#9CA3AF"
                className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-gray-900"
                accessibilityLabel="ชื่อหรือรุ่นรถ"
              />
              <Text className="text-gray-500 text-[12px] mt-1.5 leading-4">
                เอไaiจะเป็นคนระบุว่ารถคันนี้ใช้น้ำมันอะไร และคิดราคาจากระยะทางในแผนจริง
              </Text>
            </View>
          ) : null}
        </EditableValueRow>

        {/* ══ กลุ่มข้อมูลเพิ่มเติม (ไม่บังคับ) ═════════════════════ */}
        <SectionTitle
          title="ข้อมูลเพิ่มเติม"
          hint="ปล่อยว่างไว้ได้ เอไaiจะจัดให้"
          tone="optional"
        />

        {/* ── จุดสิ้นสุดของแต่ละวัน ─────────────────────────────── */}
        {days > 1
          ? Array.from({ length: days - 1 }).map((_, i) => {
              const point = slots.dayEndPoints?.[i] ?? null;
              return (
                <EditableValueRow
                  key={`day-end-${i}`}
                  label={`จุดสิ้นสุดของวันที่ ${i + 1}`}
                  icon="🌙"
                  tone="green"
                  value={point?.label ?? ""}
                  emptyHint="ยังไม่ได้เลือก — ปล่อยว่างไว้ได้ ระบบจะจัดให้"
                  editing={editing === `day-${i}`}
                  onToggle={toggleRow(`day-${i}`)}
                  badge={
                    point?.coords ? { text: "มีพิกัด", tone: "green" } : undefined
                  }
                >
                  <TouchableOpacity
                    onPress={() => requestOrigin({ day: i })}
                    activeOpacity={0.8}
                    className="flex-row items-center bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5"
                  >
                    <MapPinIcon size={16} color="#2D6A4F" />
                    <Text className="text-emerald-800 text-[13px] font-bold ml-1.5">
                      เลือกจุดจบของวันที่ {i + 1}
                    </Text>
                  </TouchableOpacity>
                </EditableValueRow>
              );
            })
          : null}

        {/* ── ชนิดน้ำมัน (ผลจากเอไai — ไม่ใช่ช่องกรอก) ──────────── */}
        {usesFuel ? (
          <View className="bg-white border border-emerald-200 rounded-2xl p-3.5 mb-3">
            <View className="flex-row items-center flex-1 mr-2 flex-wrap">
              <Text className="text-[15px] mr-1.5">⛽</Text>
              <Text className="text-[14px] font-bold text-[#1B4332]">
                ชนิดน้ำมัน
              </Text>
              {livePrice != null ? (
                <View
                  className={`ml-2 px-2 py-0.5 rounded-full border ${
                    isStale
                      ? "bg-amber-100 text-amber-800 border-amber-200"
                      : "bg-emerald-100 text-emerald-800 border-emerald-200"
                  }`}
                >
                  <Text className="text-[10px] font-bold">
                    {formatPrice(livePrice)} ฿/ลิตร
                    {isStale ? " · ข้อมูลเก่า" : ""}
                  </Text>
                </View>
              ) : null}
            </View>

            <Text
              className={`text-[15px] font-bold mt-0.5 ${
                fuelKey ? "text-gray-900" : "text-gray-400"
              }`}
            >
              {fuelKey
                ? fuelLabel(fuelKey)
                : slots.vehicleModel?.trim()
                ? "รอให้เอไaiระบุ (พิมพ์ชื่อรถแล้วคุยกับเอไai)"
                : "เอไaiจะระบุให้จากชื่อ/รุ่นรถ"}
            </Text>

            <View className="mt-1.5">
              {fuelLoading ? (
                <View className="flex-row items-center">
                  <ActivityIndicator size="small" color="#7C3AED" />
                  <Text className="text-gray-500 text-[12px] ml-1.5">
                    กำลังดึงราคาน้ำมันล่าสุด...
                  </Text>
                </View>
              ) : fuelPrice ? (
                <Text className="text-gray-500 text-[12px] leading-5">
                  {isStale
                    ? fuelPrice.staleNotice ||
                      `ราคานี้เป็นข้อมูลวันที่ ${
                        fuelPrice.cacheDate ?? "ก่อนหน้า"
                      } — ดึงราคาวันนี้ไม่สำเร็จ`
                    : `ราคาวันนี้จาก ${fuelPrice.source}`}
                  {fuelPrice.effectiveDate
                    ? ` · มีผล ${fuelPrice.effectiveDate}`
                    : ""}
                  {fuelPrice.isEstimate ? " · ประมาณการ (ดึงเว็บไม่สำเร็จ)" : ""}
                  {"\n"}ตัวเลขนี้จะถูกใช้คิดค่าน้ำมันในแผนตามระยะทางจริง — แก้เองได้หลังสร้างแพลน
                </Text>
              ) : (
                <Text className="text-gray-500 text-[12px]">
                  ดึงราคาน้ำมันไม่สำเร็จ — ระบบจะใช้ค่าสำรองและติดป้าย "ประมาณการ"
                </Text>
              )}
            </View>
          </View>
        ) : null}

        {/* ── จำนวนผู้เดินทาง ─────────────────────────────────── */}
        <EditableValueRow
          label="จำนวนผู้เดินทาง"
          icon="👥"
          tone="green"
          value={slots.travelers ? `${slots.travelers} คน` : "1 คน (ค่าเริ่มต้น)"}
          emptyHint="1 คน (ค่าเริ่มต้น)"
          editing={editing === "travelers"}
          onToggle={toggleRow("travelers")}
        >
          <View className="flex-row flex-wrap">
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <Chip
                key={n}
                label={`${n} คน`}
                active={slots.travelers === n}
                onPress={() => patch({ travelers: n })}
              />
            ))}
          </View>
        </EditableValueRow>

        {/* ── งบต่อคน ─────────────────────────────────────────── */}
        <EditableValueRow
          label="งบต่อคน"
          icon="💰"
          tone="green"
          value={
            slots.budgetPerPerson
              ? `${slots.budgetPerPerson.toLocaleString("th-TH")} บาท`
              : "ใช้ค่าเริ่มต้น 3,000 บาท"
          }
          emptyHint="ใช้ค่าเริ่มต้น 3,000 บาท"
          editing={editing === "budget"}
          onToggle={toggleRow("budget")}
        >
          <View className="flex-row flex-wrap">
            {[1500, 3000, 5000, 8000, 12000].map((n) => (
              <Chip
                key={n}
                label={`${n.toLocaleString("th-TH")} บาท`}
                active={slots.budgetPerPerson === n}
                onPress={() => patch({ budgetPerPerson: n })}
              />
            ))}
          </View>
        </EditableValueRow>

        {/* ── สรุปว่าต้องเพิ่ม/แก้อะไร ───────────────────────────── */}
        {!ready ? (
          <View className="bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2.5 mb-3">
            <View className="flex-row items-center">
              <ExclamationTriangleIcon size={14} color="#B45309" />
              <Text className="text-amber-800 text-[12.5px] font-bold ml-1.5">
                ต้องเพิ่ม/แก้: {missing.join(" · ")}
              </Text>
            </View>
          </View>
        ) : null}

        {/* ── ปุ่มสร้างแพลน ────────────────────────────────────── */}
        <TouchableOpacity
          onPress={onCreatePlan}
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

/**
 * ด่านกัน error ตอน render การ์ด
 * ======================================================================
 * ถ้ามีอะไรพังในตัวการ์ด (ค่าที่ไม่คาดคิดจาก backend ฯลฯ) ให้แสดงข้อความแทน
 * ที่จะทำให้ **ทั้งแอปหลุด** (JS error ที่ไม่มีใครจับ → iOS ปิดแอปทันที)
 */
class TripDraftCardBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { failed: false, message: "" };
  }

  static getDerivedStateFromError(error: any) {
    return { failed: true, message: String(error?.message ?? error ?? "ไม่ทราบสาเหตุ") };
  }

  componentDidCatch(error: any) {
    console.warn("[TripDraftCard] แสดงการ์ดไม่ได้:", error?.message ?? error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View className="mt-2 self-stretch bg-red-50 border border-red-200 rounded-2xl px-3 py-2.5">
        <Text className="text-red-800 text-[12.5px] font-bold">
          การ์ดข้อมูลแสดงผิดพลาด (แอปไม่ได้หลุด)
        </Text>
        <Text className="text-red-700 text-[11.5px] mt-1 leading-4">
          {this.state.message}
        </Text>
      </View>
    );
  }
}

export default function TripDraftCard(props: TripDraftCardProps) {
  return (
    <TripDraftCardBoundary>
      <TripDraftCardInner {...props} />
    </TripDraftCardBoundary>
  );
}
