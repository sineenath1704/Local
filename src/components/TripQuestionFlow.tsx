import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import {
  CalendarDaysIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  MapPinIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
} from "react-native-heroicons/outline";
import {
  TripSlots,
  TripQuestionKey,
  formatThaiDateRange,
  nextTripQuestion,
  tripQuestionList,
} from "../data/tripsData";
import {
  VehicleCategory,
  VEHICLE_CATEGORY_OPTIONS,
  VEHICLE_KEY_BY_CATEGORY,
  vehicleCategoryOf,
  vehicleModelSuggestions,
} from "../data/vehicleData";
import { parseGoogleMapsUrl } from "../services/savedPlacesService";
import { resolvePlaceCoords } from "../services/placesService";

/** จุดที่การ์ดจะขอให้ผู้ใช้เลือก (ใช้คีย์เดียวกับ OriginSelectorModal ที่แอปใช้อยู่แล้ว) */
export type TripOriginTarget = "start" | "end" | "destination" | { day: number };

export interface TripQuestionFlowProps {
  /** ข้อมูลที่เก็บสะสมมาแล้ว (จากแชท + จากที่ผู้ใช้เลือกในการ์ดนี้) */
  slots: TripSlots;
  /** ผู้ใช้เลือกตัวเลือก → อัปเดตข้อมูล (ยังไม่คำนวณค่าใช้จ่าย) */
  onChange: (slots: TripSlots) => void;
  /** ผู้ใช้พิมพ์คำตอบเอง → ส่งเข้าแชทให้เอไaiจัดการต่อ */
  onSubmitText: (text: string) => void;
  /** ข้อมูลครบแล้ว → กดสร้างแพลน (นี่คือจุดที่ "ค่าใช้จ่าย" เริ่มคำนวณ) */
  onCreatePlan: () => void;
  /** กำลังคำนวณแผนอยู่ */
  creating?: boolean;
  /** ขอเปิดตัวเลือกจุด (จุดเริ่มต้น / จุดสิ้นสุด) */
  onRequestOrigin: (target: TripOriginTarget) => void;
  /** ขอเปิดปฏิทินเลือกช่วงวันที่ (ของแอปเอง ไม่ใช่ของภายนอก) */
  onRequestDateRange: () => void;
  /** ขอเปิดล้อเวลาออกเดินทาง (ของแอปเอง) */
  onRequestTime: () => void;
}

/** ข้อความ/วิธีตอบของแต่ละคำถาม */
const QUESTION_META: Record<
  TripQuestionKey,
  { title: string; hint: string; kind: "point" | "date" | "time" | "mode" }
> = {
  startPoint: {
    title: "เริ่มจากที่ไหนครับ?",
    hint: "เลือกจากที่บันทึกไว้ หรือพิมพ์ชื่อที่ต้องการ",
    kind: "point",
  },
  startPointCoords: {
    title: "ขอพิกัดของจุดเริ่มต้นหน่อยครับ",
    hint: "พิมพ์ที่อยู่ให้ละเอียด หรือวางลิงก์ Google Maps (ต้องมีพิกัดถึงจะวางแผนเส้นทางได้)",
    kind: "point",
  },
  returnMode: {
    title: "จบทริปแล้วกลับที่เดิมไหมครับ?",
    hint: "เลือกได้เลย หรือพิมพ์บอกเองก็ได้",
    kind: "mode",
  },
  endPoint: {
    title: "จะกลับไปจบที่ไหนครับ?",
    hint: "เลือกจุดที่จบทริป หรือพิมพ์ชื่อที่ต้องการ",
    kind: "point",
  },
  endPointCoords: {
    title: "ขอพิกัดของจุดสิ้นสุดหน่อยครับ",
    hint: "พิมพ์ที่อยู่ให้ละเอียด หรือวางลิงก์ Google Maps",
    kind: "point",
  },
  startDate: {
    title: "ไปกันวันไหนครับ?",
    hint: "เลือกช่วงวันที่ หรือพิมพ์บอกเองก็ได้",
    kind: "date",
  },
  endDate: {
    title: "ทริปนี้ถึงวันไหนครับ?",
    hint: "เลือกช่วงวันที่ หรือพิมพ์ว่ากี่วันก็ได้",
    kind: "date",
  },
  startTime: {
    title: "ออกเดินทางกี่โมงครับ?",
    hint: "เลือกเวลา หรือพิมพ์เวลาที่ต้องการ",
    kind: "time",
  },
};

/** จุดที่คำถามเรื่องพิกัด/จุดเริ่มต้นหมายถึง */
function originTargetOf(key: TripQuestionKey): "start" | "end" {
  return key === "startPoint" || key === "startPointCoords" ? "start" : "end";
}

/** แปลงเวลาที่พิมพ์มา ("8:30", "8.30", "9โมง") → "HH:mm" · อ่านไม่ได้ = null */
function parseTimeText(raw: string): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  let m = /^(\d{1,2})[:.\s](\d{2})$/.exec(t);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h <= 23 && min <= 59) {
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
  }
  m = /^(\d{1,2})\s*(?:โมง|น\.?)?$/.exec(t);
  if (m) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
  }
  return null;
}

/** แถวสรุปข้อมูลที่ผู้ใช้เลือกไว้ (กด "แก้ไข" เพื่อเปลี่ยน) */
function SummaryRow({
  icon,
  label,
  value,
  onEdit,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onEdit?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <View className="mb-2">
      <View className="flex-row items-center">
        <View className="w-6 items-center">{icon}</View>
        <View className="flex-1 ml-1">
          <Text className="text-[11px] font-semibold text-gray-400">{label}</Text>
          <Text className="text-[13px] font-bold text-gray-900" numberOfLines={1}>
            {value}
          </Text>
        </View>
        {onEdit ? (
          <TouchableOpacity
            onPress={onEdit}
            activeOpacity={0.7}
            className="px-2.5 py-1 rounded-full bg-gray-100"
          >
            <Text className="text-[11px] font-bold text-gray-600">แก้ไข</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/**
 * การ์ด "ถามทีละคำถาม" (แทนการ์ดฟอร์ม 4 ขั้นตอนเดิม — ข้อ 2.3)
 * =============================================================
 * หลักการ
 *   · ถามทีละคำถาม ไม่ถามรวมหลายอย่างในจอเดียว
 *   · ตอบได้สองทาง: **พิมพ์** เอง หรือ **เลือกตัวเลือก** (ชิป/ปุ่ม)
 *   · วันที่/เวลา ใช้ตัวเลือกของแอปเอง (ปฏิทิน + ล้อเวลา) ไม่ใช่ของภายนอก
 *   · รถ: พิมพ์แบรนด์ → เลือกรุ่น → **ยังไม่คำนวณค่าใช้จ่าย**
 *     (คำนวณตอนผู้ใช้กด "สรุปและสร้างแพลน" เท่านั้น)
 */
export default function TripQuestionFlow({
  slots,
  onChange,
  onSubmitText,
  onCreatePlan,
  creating,
  onRequestOrigin,
  onRequestDateRange,
  onRequestTime,
}: TripQuestionFlowProps) {
  /** ค่าล่าสุดของ slots (กันกดซ้ำเร็ว ๆ แล้วใช้ค่าเก่า) */
  const latest = useRef(slots);
  useEffect(() => {
    latest.current = slots;
  }, [slots]);

  const [answerText, setAnswerText] = useState("");
  const [resolving, setResolving] = useState(false);
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory>(
    () => vehicleCategoryOf(slots.vehicle, slots.vehicleModel) ?? "car"
  );
  const [brandText, setBrandText] = useState(slots.vehicleModel ?? "");
  const [editingReturn, setEditingReturn] = useState(false);

  const question = nextTripQuestion(slots);
  const questionList = useMemo(() => tripQuestionList(slots), [slots]);
  const questionNumber = question ? questionList.indexOf(question) + 1 : questionList.length;

  /** ตัวเลือกรถที่แนะนำตามที่พิมพ์ */
  const vehicleOptions = useMemo(
    () => vehicleModelSuggestions(brandText, vehicleCategory),
    [brandText, vehicleCategory]
  );

  /** อัปเดตจุด (จุดเริ่มต้น / จุดสิ้นสุด) */
  const applyPoint = (
    target: "start" | "end",
    patch: { label?: string; address?: string | null; coords?: { lat: number; lng: number } | null }
  ) => {
    const prev = latest.current;
    if (target === "start") {
      onChange({
        ...prev,
        startPoint: {
          label: patch.label ?? prev.startPoint?.label ?? "",
          address: patch.address ?? prev.startPoint?.address ?? null,
          coords: patch.coords ?? prev.startPoint?.coords ?? null,
        },
      });
      return;
    }
    onChange({
      ...prev,
      returnMode: "custom",
      endPoint: {
        label: patch.label ?? prev.endPoint?.label ?? "",
        address: patch.address ?? prev.endPoint?.address ?? null,
        coords: patch.coords ?? prev.endPoint?.coords ?? null,
      },
    });
  };

  /** ผู้ใช้พิมพ์คำตอบเอง → ลองจัดการในแอปก่อน ถ้าไม่ได้ค่อยส่งให้เอไai */
  const handleSubmitTyped = async () => {
    const text = answerText.trim();
    if (!text || resolving || !question) return;

    // กลับจุดเดิม / กลับคนละจุด → ให้เอไaiเป็นคนจัดการคำพูด
    if (QUESTION_META[question].kind === "mode") {
      setAnswerText("");
      onSubmitText(text);
      return;
    }

    // เวลา → อ่านเองได้เลย ("8:30")
    if (QUESTION_META[question].kind === "time") {
      const parsed = parseTimeText(text);
      if (parsed) {
        onChange({ ...latest.current, startTime: parsed });
        setAnswerText("");
        return;
      }
      setAnswerText("");
      onSubmitText(text);
      return;
    }

    // วันที่ → ให้เอไaiเป็นคนแปลง (เดือนไทย/คำอย่าง "3 วัน" เป็นเรื่องของโมเดล)
    if (QUESTION_META[question].kind === "date") {
      setAnswerText("");
      onSubmitText(text);
      return;
    }

    // จุด → หาพิกัดเองก่อน (สำคัญ เพราะแผนต้องมีพิกัดถึงคำนวณเส้นทางได้)
    setResolving(true);
    try {
      const parsed = parseGoogleMapsUrl(text);
      let coords =
        parsed.lat != null && parsed.lng != null
          ? { lat: parsed.lat, lng: parsed.lng }
          : null;
      let placeName: string | null = parsed.placeName ?? null;

      if (!coords) {
        const resolved = await resolvePlaceCoords({ text });
        if (resolved) {
          coords = { lat: resolved.lat, lng: resolved.lng };
          placeName = resolved.label ?? placeName;
        }
      }

      const target = originTargetOf(question);
      const prev = latest.current;
      if (coords) {
        const isFirstAsk = question === "startPoint" || question === "endPoint";
        applyPoint(target, {
          label:
            (isFirstAsk ? null : prev[target === "start" ? "startPoint" : "endPoint"]?.label) ||
            placeName ||
            text,
          address: text,
          coords,
        });
        setAnswerText("");
        return;
      }

      // หาพิกัดไม่ได้ → ให้เอไaiช่วยต่อ (มักหาชื่อสถานที่ให้แม่นกว่า)
      setAnswerText("");
      onSubmitText(text);
    } finally {
      setResolving(false);
    }
  };

  /** เลือกรถ (พิมพ์แบรนด์ → เลือกรุ่น) — แค่บันทึกไว้ ยังไม่คำนวณค่าใช้จ่าย */
  const applyVehicle = (modelName: string | null) => {
    const prev = latest.current;
    if (!modelName) {
      onChange({ ...prev, vehicle: null, vehicleModel: null, fuelType: null });
      setBrandText("");
      return;
    }
    const preset = vehicleOptions.find((m) => m.name === modelName);
    const category = preset?.category ?? vehicleCategory;
    onChange({
      ...prev,
      vehicle: VEHICLE_KEY_BY_CATEGORY[category],
      vehicleModel: modelName,
      fuelType: category === "ev" ? "electric" : null,
    });
    setBrandText(modelName);
  };

  const meta = question ? QUESTION_META[question] : null;
  const startLabel = slots.startPoint?.label ?? "ยังไม่ได้เลือก";
  const returnLabel =
    slots.returnMode === "custom"
      ? slots.endPoint?.label ?? "ยังไม่ได้เลือก"
      : "กลับจุดเดิม";
  const vehicleLabel =
    slots.vehicleModel?.trim() ||
    (slots.vehicle ? vehicleCategoryLabel(slots.vehicle) : "ยังไม่ได้ระบุ");

  return (
    <View className="bg-white border border-violet-200 rounded-3xl p-4 mt-2">
      {/* ── หัวการ์ด ─────────────────────────────────────────── */}
      <View className="flex-row items-center mb-1">
        <SparklesIcon size={16} color="#7C3AED" />
        <Text className="text-[13px] font-black text-violet-800 ml-1.5">
          วางแผนทริป
        </Text>
        <View className="flex-1" />
        {question ? (
          <Text className="text-[11px] font-bold text-gray-400">
            คำถามที่ {questionNumber}/{questionList.length}
          </Text>
        ) : null}
      </View>

      {/* ── สรุปสิ่งที่เลือกไว้แล้ว ─────────────────────────────── */}
      <View className="bg-gray-50 rounded-2xl p-3 mt-2">
        <SummaryRow
          icon={<MapPinIcon size={15} color="#7C3AED" />}
          label="จุดเริ่มต้น"
          value={startLabel}
          onEdit={() => onRequestOrigin("start")}
        />
        <SummaryRow
          icon={<MapPinIcon size={15} color="#7C3AED" />}
          label="กลับตอนกลับ"
          value={returnLabel}
          onEdit={() => setEditingReturn((v) => !v)}
        >
          {editingReturn ? (
            <View className="flex-row flex-wrap gap-2 mt-1.5 mb-1">
              <TouchableOpacity
                onPress={() => {
                  onChange({
                    ...latest.current,
                    returnMode: "same_as_start",
                    endPoint: null,
                  });
                  setEditingReturn(false);
                }}
                activeOpacity={0.8}
                className="px-3 py-1.5 rounded-full bg-violet-600"
              >
                <Text className="text-[11.5px] font-bold text-white">
                  กลับจุดเดิม
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  onChange({ ...latest.current, returnMode: "custom" });
                  setEditingReturn(false);
                }}
                activeOpacity={0.8}
                className="px-3 py-1.5 rounded-full bg-white border border-violet-300"
              >
                <Text className="text-[11.5px] font-bold text-violet-700">
                  กลับคนละจุด
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setEditingReturn(false)}
                activeOpacity={0.8}
                className="px-3 py-1.5 rounded-full bg-white border border-gray-300"
              >
                <Text className="text-[11.5px] font-bold text-gray-600">
                  ยกเลิก
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </SummaryRow>
        <SummaryRow
          icon={<CalendarDaysIcon size={15} color="#7C3AED" />}
          label="ช่วงวันที่"
          value={
            slots.startDate
              ? formatThaiDateRange(slots.startDate, slots.endDate)
              : "ยังไม่ได้เลือก"
          }
          onEdit={onRequestDateRange}
        />
        <SummaryRow
          icon={<ClockIcon size={15} color="#7C3AED" />}
          label="ออกเดินทาง"
          value={slots.startTime ?? "ยังไม่ได้เลือก"}
          onEdit={onRequestTime}
        />
      </View>

      {/* ── คำถาม (ทีละคำถาม) ─────────────────────────────────── */}
      {question && meta ? (
        <View className="mt-3">
          <Text className="text-[14px] font-black text-gray-900">
            {meta.title}
          </Text>
          <Text className="text-[11.5px] text-gray-500 mt-0.5">{meta.hint}</Text>

          {/* ตัวเลือกแบบกดเลือก */}
          {meta.kind === "mode" ? (
            <View className="flex-row flex-wrap gap-2 mt-3">
              <TouchableOpacity
                onPress={() =>
                  onChange({
                    ...latest.current,
                    returnMode: "same_as_start",
                    endPoint: null,
                  })
                }
                activeOpacity={0.8}
                className={`px-3.5 py-2 rounded-full border ${
                  slots.returnMode === "same_as_start"
                    ? "bg-violet-600 border-violet-600"
                    : "bg-white border-gray-200"
                }`}
              >
                <Text
                  className={`text-[12.5px] font-bold ${
                    slots.returnMode === "same_as_start"
                      ? "text-white"
                      : "text-gray-700"
                  }`}
                >
                  กลับจุดเดิม
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onChange({ ...latest.current, returnMode: "custom" })}
                activeOpacity={0.8}
                className={`px-3.5 py-2 rounded-full border ${
                  slots.returnMode === "custom"
                    ? "bg-violet-600 border-violet-600"
                    : "bg-white border-gray-200"
                }`}
              >
                <Text
                  className={`text-[12.5px] font-bold ${
                    slots.returnMode === "custom"
                      ? "text-white"
                      : "text-gray-700"
                  }`}
                >
                  กลับคนละจุด
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* ปุ่มเปิดตัวเลือกของแอปเอง (ปฏิทิน / ล้อเวลา / เลือกจุด) */}
          {meta.kind === "point" ? (
            <>
              <TouchableOpacity
                onPress={() => onRequestOrigin(originTargetOf(question))}
                activeOpacity={0.8}
                className="flex-row items-center bg-violet-50 border border-violet-200 rounded-2xl px-3.5 py-3 mt-3"
              >
                <MapPinIcon size={18} color="#7C3AED" />
                <Text className="flex-1 text-[13px] font-bold text-violet-800 ml-2">
                  {originTargetOf(question) === "start"
                    ? "เลือกจุดเริ่มต้น (หรือจากโฟลเดอร์ที่เซฟ)"
                    : "เลือกจุดสิ้นสุด"}
                </Text>
                <ChevronRightIcon size={16} color="#7C3AED" />
              </TouchableOpacity>

              {originTargetOf(question) === "start" ? (
                <View className="flex-row flex-wrap gap-2 mt-2">
                  <TouchableOpacity
                    onPress={() => onSubmitText("ช่วยคิดทริปท่องเที่ยวให้หน่อย จัดแพลนและเลือกจุดเริ่มต้นให้เลย")}
                    activeOpacity={0.8}
                    className="px-3 py-1.5 rounded-full bg-violet-100 border border-violet-200"
                  >
                    <Text className="text-[12px] font-bold text-violet-800">
                      ✨ ให้ AI วางแผนและเลือกจุดให้เลย
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </>
          ) : null}
          {meta.kind === "date" ? (
            <TouchableOpacity
              onPress={onRequestDateRange}
              activeOpacity={0.8}
              className="flex-row items-center bg-violet-50 border border-violet-200 rounded-2xl px-3.5 py-3 mt-3"
            >
              <CalendarDaysIcon size={18} color="#7C3AED" />
              <Text className="flex-1 text-[13px] font-bold text-violet-800 ml-2">
                เลือกช่วงวันที่
              </Text>
              <ChevronRightIcon size={16} color="#7C3AED" />
            </TouchableOpacity>
          ) : null}
          {meta.kind === "time" ? (
            <TouchableOpacity
              onPress={onRequestTime}
              activeOpacity={0.8}
              className="flex-row items-center bg-violet-50 border border-violet-200 rounded-2xl px-3.5 py-3 mt-3"
            >
              <ClockIcon size={18} color="#7C3AED" />
              <Text className="flex-1 text-[13px] font-bold text-violet-800 ml-2">
                เลือกเวลาออกเดินทาง
              </Text>
              <ChevronRightIcon size={16} color="#7C3AED" />
            </TouchableOpacity>
          ) : null}

          {/* พิมพ์คำตอบเอง */}
          <View className="flex-row items-center mt-3">
            <View className="flex-1 flex-row items-center bg-gray-100 rounded-2xl px-3">
              <MagnifyingGlassIcon size={15} color="#9CA3AF" />
              <TextInput
                value={answerText}
                onChangeText={setAnswerText}
                onSubmitEditing={() => void handleSubmitTyped()}
                editable={!resolving}
                returnKeyType="send"
                placeholder={
                  meta.kind === "point"
                    ? "พิมพ์ชื่อสถานที่หรือที่อยู่…"
                    : meta.kind === "date"
                    ? "พิมพ์วันที่ เช่น 12 ธ.ค. หรือ 3 วัน…"
                    : meta.kind === "time"
                    ? "พิมพ์เวลา เช่น 08:30…"
                    : "พิมพ์คำตอบ…"
                }
                placeholderTextColor="#9CA3AF"
                className="flex-1 py-2.5 px-2 text-[13px] text-gray-900"
              />
            </View>
            <TouchableOpacity
              onPress={() => void handleSubmitTyped()}
              disabled={!answerText.trim() || resolving}
              activeOpacity={0.8}
              className={`ml-2 px-3.5 py-2.5 rounded-2xl ${
                !answerText.trim() || resolving
                  ? "bg-gray-200"
                  : "bg-violet-600"
              }`}
            >
              {resolving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text
                  className={`text-[12.5px] font-bold ${
                    !answerText.trim() ? "text-gray-400" : "text-white"
                  }`}
                >
                  ส่ง
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* ปุ่มทางลัดสำหรับผู้ใช้ที่ต้องการให้ AI สร้างแพลนออกมาเลย */}
          <View className="flex-row items-center justify-between mt-3 pt-2.5 border-t border-gray-100">
            <Text className="text-[11.5px] text-gray-400">หรือให้ระบบคำนวณแผนที่ทันที</Text>
            <TouchableOpacity
              onPress={onCreatePlan}
              disabled={creating}
              activeOpacity={0.8}
              className="px-3.5 py-1.5 rounded-full bg-violet-600 flex-row items-center"
            >
              <SparklesIcon size={12} color="#FFFFFF" />
              <Text className="text-[11.5px] font-bold text-white ml-1">
                {creating ? "กำลังสร้างแพลน..." : "สร้างแพลนเลย"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* ── ข้อมูลครบ → เลือกรถ (ยังไม่คำนวณ) แล้วสรุป ─────── */}
      {!question ? (
        <View className="mt-3">
          <View className="bg-emerald-50 border border-emerald-200 rounded-2xl px-3.5 py-2.5">
            <Text className="text-[12.5px] font-bold text-emerald-800">
              ข้อมูลครบแล้วครับ — เลือกรถที่จะใช้ (ถ้าระบุไว้ ค่าน้ำมัน/ค่าไฟจะคำนวณตามรถคันนี้)
            </Text>
          </View>

          <View className="mt-3">
            <View className="flex-row flex-wrap gap-2">
              {VEHICLE_CATEGORY_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => setVehicleCategory(opt.key)}
                  activeOpacity={0.8}
                  className={`px-3 py-1.5 rounded-full border ${
                    vehicleCategory === opt.key
                      ? "bg-violet-600 border-violet-600"
                      : "bg-white border-gray-200"
                  }`}
                >
                  <Text
                    className={`text-[12px] font-bold ${
                      vehicleCategory === opt.key ? "text-white" : "text-gray-700"
                    }`}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View className="flex-row items-center bg-gray-100 rounded-2xl px-3 mt-2.5">
              <MagnifyingGlassIcon size={15} color="#9CA3AF" />
              <TextInput
                value={brandText}
                onChangeText={setBrandText}
                placeholder="พิมพ์แบรนด์หรือรุ่นรถ เช่น Toyota"
                placeholderTextColor="#9CA3AF"
                className="flex-1 py-2.5 px-2 text-[13px] text-gray-900"
              />
              {brandText ? (
                <TouchableOpacity
                  onPress={() => applyVehicle(null)}
                  activeOpacity={0.7}
                  className="p-1"
                >
                  <Text className="text-[11.5px] font-bold text-gray-500">ล้าง</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {vehicleOptions.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="mt-2"
                contentContainerStyle={{ paddingRight: 4 }}
              >
                {vehicleOptions.map((m) => {
                  const selected = slots.vehicleModel === m.name;
                  return (
                    <TouchableOpacity
                      key={`${m.category}-${m.name}`}
                      onPress={() => applyVehicle(m.name)}
                      activeOpacity={0.8}
                      className={`flex-row items-center mr-2 px-3 py-2 rounded-2xl border ${
                        selected
                          ? "bg-violet-600 border-violet-600"
                          : "bg-white border-gray-200"
                      }`}
                    >
                      {selected ? (
                        <CheckIcon size={13} color="#FFFFFF" strokeWidth={3} />
                      ) : null}
                      <View className={selected ? "ml-1.5" : ""}>
                        <Text
                          className={`text-[12.5px] font-bold ${
                            selected ? "text-white" : "text-gray-800"
                          }`}
                        >
                          {m.name}
                        </Text>
                        <Text
                          className={`text-[10.5px] ${
                            selected ? "text-violet-100" : "text-gray-400"
                          }`}
                        >
                          {m.fuelLabel}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : brandText.trim() ? (
              <TouchableOpacity
                onPress={() => applyVehicle(brandText.trim())}
                activeOpacity={0.8}
                className="flex-row items-center mt-2 self-start px-3 py-2 rounded-2xl bg-white border border-violet-300"
              >
                <Text className="text-[12.5px] font-bold text-violet-700">
                  ใช้ “{brandText.trim()}” ตามที่พิมพ์
                </Text>
              </TouchableOpacity>
            ) : null}

            <Text className="text-[11px] text-gray-400 mt-2">
              รถที่ใช้: {vehicleLabel} — ค่าใช้จ่ายจะคำนวณตอนกดปุ่มด้านล่างเท่านั้น
            </Text>
          </View>

          <TouchableOpacity
            onPress={onCreatePlan}
            disabled={creating}
            activeOpacity={0.85}
            className={`mt-3.5 rounded-2xl py-3.5 items-center justify-center ${
              creating ? "bg-gray-300" : "bg-violet-600"
            }`}
          >
            {creating ? (
              <View className="flex-row items-center">
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text className="text-white text-[13.5px] font-bold ml-2">
                  กำลังวางแผน...
                </Text>
              </View>
            ) : (
              <Text className="text-white text-[14px] font-bold">
                สรุปและสร้างแพลนทริป
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

/** ป้ายสั้น ๆ ของรถที่เลือกไว้ (สำหรับแถวสรุป) */
function vehicleCategoryLabel(vehicle: string): string {
  const v = vehicle.trim().toLowerCase();
  if (v === "ev") return "รถไฟฟ้า";
  if (v === "van") return "รถตู้";
  if (v === "motorbike" || v === "motorcycle") return "มอเตอร์ไซค์";
  if (v === "public") return "ขนส่งสาธารณะ";
  return "รถยนต์ส่วนตัว";
}
