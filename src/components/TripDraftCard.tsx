import React, { useMemo, useState } from "react";
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
  computeTripMissing,
  formatThaiDateRange,
  tripRangeDays,
  vehicleClassOf,
  VEHICLE_CLASS_OPTIONS,
  type VehicleClass,
} from "../data/tripsData";
import EditableValueRow from "./EditableValueRow";

/**
 * การ์ด "ข้อมูลแผนทริป" ในแชท
 * =============================================================
 * การ์ดนี้เป็น **ฟอร์มล้วน** — ระหว่างกรอกไม่ส่งค่าอะไรออกไปไหนเลย
 *   (ไม่ดึงราคาน้ำมัน ไม่ยิง backend ไม่คุยกับเอไai)
 *   ค่าจะถูกใช้ต่อเมื่อผู้ใช้กดปุ่ม "ส่งข้อมูล" เท่านั้น
 *
 * แบ่งเป็น 2 กลุ่ม:
 *   · "ต้องกรอก"    — รอบแรกขอแค่ 5 อย่าง
 *                    (จุดเริ่ม · จุดสิ้นสุดตอนกลับ · ช่วงวันที่ · เวลา · งบ)
 *   · "ข้อมูลเพิ่มเติม" — ประเภทรถ/ชื่อรุ่นรถ (ไม่บังคับ)
 *                    ถ้ายังไม่รู้ ระบบจะถามอีกรอบตอนสรุปค่าใช้จ่าย
 */

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

  const missing = useMemo(() => computeTripMissing(slots), [slots]);
  const ready = missing.length === 0;
  const returnMode = slots.returnMode === "custom" ? "custom" : "same_as_start";
  const vehicleClass: VehicleClass | null = vehicleClassOf(slots.vehicle);
  const days = tripRangeDays(slots.startDate, slots.endDate) ?? 1;

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

      {/* บอกผู้ใช้ให้ชัดว่าตอนนี้ยังไม่มีอะไรถูกส่งออกไปไหน */}
      <View className="flex-row items-start bg-violet-100 px-3.5 pb-2.5">
        <Text className="text-violet-800 text-[11.5px] leading-4 flex-1">
          การ์ดนี้เป็นฟอร์ม — ระหว่างกรอกยังไม่ส่งค่าอะไรออกไปไหน
          กด “ส่งข้อมูล” ตอนท้ายแล้วค่อยนำไปคำนวณแผน
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

        {/* ── งบต่อคน ─────────────────────────────────────────── */}
        <EditableValueRow
          label="งบต่อคน"
          icon="💰"
          tone="amber"
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

        {/* ══ กลุ่มข้อมูลเพิ่มเติม (ไม่บังคับ) ═════════════════════ */}
        <SectionTitle
          title="ข้อมูลเพิ่มเติม"
          hint="ไม่บังคับ · ถ้ายังไม่รู้ ระบบจะถามอีกรอบตอนสรุปค่าใช้จ่าย"
          tone="optional"
        />

        {/* ── ประเภทรถ (+ ชื่อ/รุ่นรถ) ───────────────────────────── */}
        <EditableValueRow
          label="ประเภทรถ"
          icon="🚙"
          tone="green"
          value={
            vehicleClass
              ? VEHICLE_CLASS_OPTIONS.find((o) => o.key === vehicleClass)?.label ??
                ""
              : ""
          }
          emptyHint="ยังไม่ได้เลือก — จะถามอีกรอบตอนสรุปค่าใช้จ่าย"
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
                onPress={() => {
                  // กดชิปเดิม → ไม่ต้องทำอะไร (ไม่ลบชนิดน้ำมันที่เอไaiเคยระบุ)
                  if (vehicleClass === v.key) return;
                  patch(
                    v.key === "public"
                      ? { vehicle: v.key, vehicleModel: null, fuelType: null }
                      : v.key === "ev"
                      ? {
                          vehicle: v.key,
                          vehicleModel: null,
                          fuelType: "electric",
                        }
                      : { vehicle: v.key, fuelType: null }
                  );
                }}
              />
            ))}
          </View>

          {vehicleClass && vehicleClass !== "public" ? (
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
                {vehicleClass === "ev"
                  ? "ระบุรุ่นได้ ระบบจะคิดค่าไฟจากระยะทางจริงในแผน"
                  : "เอไaiจะเป็นคนระบุว่ารถคันนี้ใช้น้ำมันอะไร และคิดราคาจากระยะทางในแผนจริง"}
              </Text>
            </View>
          ) : null}
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

        {/* ── ปุ่มส่งข้อมูล (จุดที่ค่าจะถูกใช้) ─────────────────── */}
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
              ? "ส่งข้อมูลให้สรุปแผน"
              : "กรอกข้อมูลให้ครบก่อน"}
          </Text>
        </TouchableOpacity>

        {ready ? (
          <View className="flex-row items-start mt-2">
            <CheckIcon size={13} color="#059669" style={{ marginTop: 2 }} />
            <Text className="text-gray-500 text-[12px] ml-1 flex-1 leading-4">
              กดส่งแล้วระบบจะคำนวณเส้นทางจริง · เวลาเปิด-ปิด · ค่าใช้จ่าย
              (รถ/จำนวนคนจะถามอีกรอบตอนสรุปค่าใช้จ่าย)
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
