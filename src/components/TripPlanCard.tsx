import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Linking,
  ActivityIndicator,
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
} from "react-native-heroicons/outline";
import {
  TripPlan,
  TripPlanDay,
  TripPlanLodging,
  TripPlanOpenHours,
} from "../data/tripsData";
import TripRouteMap from "./TripRouteMap";
import EditableValueRow from "./EditableValueRow";

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
  /** กด "เพิ่มจุดแวะ" */
  onAddStop?: () => void;
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
}

export default function TripPlanCard({
  plan,
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
}: TripPlanCardProps) {
  const [dayIndex, setDayIndex] = useState(0);
  const [editingFuel, setEditingFuel] = useState(false);
  const [fuelText, setFuelText] = useState("");

  const days = plan.days ?? [];
  const day: TripPlanDay | undefined = days[dayIndex] ?? days[0];
  const veh = plan.vehicle;
  const budget = plan.budget;
  const isCustomEnd = plan.returnMode === "custom";

  const warnings = useMemo(
    () => [...(plan.warnings ?? []), ...(aiWarnings ?? [])],
    [plan.warnings, aiWarnings]
  );

  const fuelPriceText = useMemo(() => {
    if (fuelPriceOverride != null) return `${fuelPriceOverride.toFixed(2)} ฿/ลิตร`;
    if (veh?.fuelPricePerLitre != null) {
      return `${veh.fuelPricePerLitre.toFixed(2)} ฿/ลิตร`;
    }
    return veh?.fuelPriceText ?? "ไม่ทราบราคา";
  }, [fuelPriceOverride, veh]);

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
        {plan.summary ? (
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
                ค่าน้ำมัน {money(day.fuelCost)}
              </Text>
            ) : null}
            <Text className="text-[12px] text-gray-500">
              {day.endPointType === "lodging" ? "จบวันที่ที่พัก" : "จบวันที่จุดสิ้นสุด"}
            </Text>
          </View>
        </View>
      ) : null}

      {/* ── รายการจุดแวะ ─────────────────────────────────────── */}
      {day?.stops?.length ? (
        <View className="px-3 pt-3">
          <Text className="text-gray-900 text-[13.5px] font-black mb-1.5">
            จุดแวะวันที่ {day.day}
          </Text>
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
        </View>
      ) : null}

      {/* ── ต้นทุน ────────────────────────────────────────────── */}
      <View className="px-3 pt-3">
        <Text className="text-gray-900 text-[13.5px] font-black mb-1.5">
          ค่าใช้จ่ายโดยประมาณ
        </Text>
        <View className="bg-gray-50 border border-gray-100 rounded-2xl px-3 py-2.5">
          <CostRow label="ค่าน้ำมัน" value={money(budget?.fuel)} />
          <CostRow label="ค่าที่พัก" value={money(budget?.lodging)} />
          <CostRow label="ค่าอาหาร" value={money(budget?.food)} />
          {budget?.activities ? (
            <CostRow label="ค่ากิจกรรม" value={money(budget.activities)} />
          ) : null}
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
            label="ราคาน้ำมัน"
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
                placeholder="ราคาต่อลิตรที่ปั๊ม"
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
      </View>

      {/* ── ที่พักที่ระบบเสนอ ────────────────────────────────── */}
      {plan.lodgingSuggestions?.length ? (
        <View className="px-3 pt-1">
          <Text className="text-gray-900 text-[13.5px] font-black mb-1.5">
            ที่พักที่ระบบเสนอ
          </Text>
          {plan.lodgingSuggestions.map((l, i) => {
            const picked = selectedLodgingName === l.name;
            return (
              <View
                key={`${l.name}-${i}`}
                className={`border rounded-2xl p-3 mb-2 ${
                  picked
                    ? "bg-emerald-50 border-emerald-300"
                    : "bg-white border-gray-200"
                }`}
              >
                <View className="flex-row items-start">
                  <View className="flex-1">
                    <Text className="text-gray-900 text-[13.5px] font-bold">
                      {l.name}
                    </Text>
                    {l.address ? (
                      <Text className="text-gray-500 text-[12px] mt-0.5">
                        {l.address}
                      </Text>
                    ) : null}
                  </View>
                  {picked ? (
                    <CheckBadgeIcon size={17} color="#059669" />
                  ) : null}
                </View>
                <View className="flex-row items-center flex-wrap mt-1.5">
                  {l.price != null ? (
                    <View className="bg-gray-100 px-2 py-0.5 rounded-full mr-2 mb-1">
                      <Text className="text-gray-800 text-[12px] font-bold">
                        {money(l.price)}
                        {l.priceUnit ? ` / ${l.priceUnit}` : ""}
                      </Text>
                    </View>
                  ) : l.priceText ? (
                    <View className="bg-gray-100 px-2 py-0.5 rounded-full mr-2 mb-1">
                      <Text className="text-gray-800 text-[12px] font-bold">
                        {l.priceText}
                      </Text>
                    </View>
                  ) : null}
                  {l.distanceKm != null ? (
                    <View className="bg-blue-50 px-2 py-0.5 rounded-full mr-2 mb-1">
                      <Text className="text-blue-800 text-[12px] font-bold">
                        ห่างจากจุดสุดท้าย {km(l.distanceKm)}
                      </Text>
                    </View>
                  ) : null}
                  {l.rating != null ? (
                    <View className="bg-amber-50 px-2 py-0.5 rounded-full mr-2 mb-1">
                      <Text className="text-amber-800 text-[12px] font-bold">
                        ⭐ {l.rating.toFixed(1)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View className="flex-row items-center flex-wrap mt-1.5">
                  {l.phone ? (
                    <TouchableOpacity
                      onPress={() =>
                        Linking.openURL(`tel:${l.phone}`).catch(() => undefined)
                      }
                      activeOpacity={0.7}
                      className="flex-row items-center bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 mr-2 mb-1"
                    >
                      <PhoneIcon size={12} color="#047857" />
                      <Text className="text-emerald-800 text-[12px] font-bold ml-1">
                        {l.phone}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {l.website ? (
                    <TouchableOpacity
                      onPress={() =>
                        Linking.openURL(l.website!).catch(() => undefined)
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
                  {onSelectLodging ? (
                    <TouchableOpacity
                      onPress={() => onSelectLodging(l)}
                      activeOpacity={0.8}
                      className={`px-3 py-1 rounded-full ml-auto ${
                        picked
                          ? "bg-emerald-700"
                          : "bg-violet-600"
                      }`}
                    >
                      <Text className="text-white text-[12px] font-bold">
                        {picked ? "เลือกแล้ว ✓" : "เลือกที่พักนี้"}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })}
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
                onPress={onAddStop}
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
            onPress={onAddStop}
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
        <View className="px-3 pt-3 pb-1">
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
        </View>
      ) : null}

      {/* ── ปุ่มการกระทำ ─────────────────────────────────────── */}
      <View className="px-3 pt-3 pb-3.5">
        <TouchableOpacity
          onPress={onConfirm}
          disabled={busy}
          activeOpacity={0.85}
          className={`rounded-2xl py-3 items-center justify-center flex-row ${
            busy ? "bg-violet-300" : "bg-violet-600 shadow-md shadow-violet-200"
          }`}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <CheckBadgeIcon size={17} color="#FFFFFF" />
          )}
          <Text className="text-white text-[14px] font-bold ml-1.5">
            {busy ? "กำลังคำนวณใหม่..." : "ยืนยันและบันทึกแพลน"}
          </Text>
        </TouchableOpacity>

        <View className="flex-row mt-2">
          {onAddStop ? (
            <TouchableOpacity
              onPress={onAddStop}
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
