import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import type { TextInputInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CalendarDaysIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  MapPinIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
  BanknotesIcon,
  XMarkIcon,
} from "react-native-heroicons/outline";
import {
  TripSlots,
  TripQuestionKey,
  formatThaiDateRange,
  isQuestionAnswered,
  nextTripQuestion,
  tripQuestionList,
  vehicleCategoryLabel,
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
  /**
   * "ask"   = โหมดเดิม (ถามทีละคำถาม ไม่ข้าม · ต้องครบถึงจะสร้างแพลนได้)
   * "setup" = โหมด "ตั้งค่าแพลน" หลังผู้ใช้ติ๊กสถานที่
   *          (ข้ามได้ทุกข้อ · ไม่บังคับต้องครบ · ปุ่มยืนยันแสดงตลอด)
   */
  mode?: "ask" | "setup";
  /** ชื่อสถานที่ที่ผู้ใช้ติ๊กมา (โหมด setup) → แสดงเป็นชิปด้านบนการ์ด */
  places?: string[];
  /**
   * แตะชิปสถานที่ที่ติ๊กมา (โหมด setup) → เปิดป๊อปอัปแผนที่จากจุดเริ่มต้นไปที่สถานที่นั้น
   * → รับ "ลำดับ" ของชิปที่ถูกแตะ (0 = อันแรก) ให้ฝั่งแอปเปิดแผนที่ให้ตรงจุด
   */
  onSelectPlace?: (index: number) => void;
  /**
   * ข้อความเตือน "จุดเริ่มต้นอยู่ไกลจากสถานที่ที่เลือก" (โหมด setup)
   * → คำนวณระยะทางฝั่งแอป (haversine) แล้วส่งข้อความมาโชว์ · null = ไม่ต้องเตือน
   */
  startDistanceHint?: string | null;
  /** ข้อมูลที่เก็บสะสมมาแล้ว (จากแชท + จากที่ผู้ใช้เลือกในการ์ดนี้) */
  slots: TripSlots;
  /** ผู้ใช้เลือกตัวเลือก → อัปเดตข้อมูล (ยังไม่คำนวณค่าใช้จ่าย) */
  onChange: (slots: TripSlots) => void;
  /** ผู้ใช้พิมพ์คำตอบเอง → ส่งเข้าแชทให้ AI จัดการต่อ */
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
  mode = "ask",
  places,
  onSelectPlace,
  startDistanceHint,
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

  const insets = useSafeAreaInsets();

  const [answerText, setAnswerText] = useState("");
  const [resolving, setResolving] = useState(false);
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory>(
    () => vehicleCategoryOf(slots.vehicle, slots.vehicleModel) ?? "car"
  );
  const [brandText, setBrandText] = useState(slots.vehicleModel ?? "");
  /**
   * ช่องพิมพ์แบรนด์รถ (โฟกัสให้อัตโนมัติตอนผู้ใช้กด "แก้ไข" ที่แถวรถ)
   * ใช้ TextInputInstance (ไม่ใช่ TextInput) — ใน RN 0.88 `TextInput` เป็น
   * "ค่า" ไม่ใช่ "ชนิด" แล้ว (type ที่ถูกต้องคือ TextInputInstance)
   */
  const brandInputRef = useRef<TextInputInstance>(null);
  const [editingReturn, setEditingReturn] = useState(false);
  /** โหมด setup: คำถามที่ผู้ใช้กด "ข้าม" (ข้ามถาวรในการ์ดนี้) */
  const [skipped, setSkipped] = useState<TripQuestionKey[]>([]);
  /**
   * ตัวเลือกรถอยู่ใน **โมดัล** (ไม่ใช่ในตัวการ์ด)
   * → เดิมบล็อกอยู่ในการ์ด = เปิดแล้วโดนแป้นพิมพ์บัง/เลื่อนออกจอ
   *   ผู้ใช้เลยรู้สึกว่า "กดแก้ไขแล้วไม่ขึ้นอะไรเลย" (แม้โหลดแอปใหม่แล้วก็ยังเป็น)
   */
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  /** โหมด setup: งบประมาณต่อคน (พิมพ์เอง · ว่าง = ข้าม) */
  const [budgetText, setBudgetText] = useState(
    slots.budgetPerPerson != null ? String(slots.budgetPerPerson) : ""
  );

  // ถ้าค่างบถูกเปลี่ยนจากที่อื่น (เช่น AI เติมให้) → ช่องกรอกต้องตาม
  useEffect(() => {
    const fromSlots = slots.budgetPerPerson != null ? String(slots.budgetPerPerson) : "";
    if (fromSlots === budgetText.replace(/[^0-9]/g, "")) return;
    // React Compiler: ห้าม setState ตรง ๆ ใน effect → เลื่อนไป tick ถัดไป
    const t = setTimeout(() => setBudgetText(fromSlots), 0);
    return () => clearTimeout(t);
  }, [slots.budgetPerPerson, budgetText]);

  const questionList = useMemo(() => tripQuestionList(slots), [slots]);

  /**
   * คำถามที่กำลังถามอยู่
   * · โหมด ask   = คำถามแรกที่ยังไม่ตอบ (ของเดิม)
   * · โหมด setup = คำถามแรกที่ยังไม่ตอบ **และไม่ได้ถูกข้าม** (ข้ามได้ทุกข้อ)
   */
  const question = useMemo(() => {
    if (mode !== "setup") return nextTripQuestion(slots);
    for (const key of questionList) {
      if (skipped.includes(key)) continue;
      if (!isQuestionAnswered(key, slots)) return key;
    }
    return null;
  }, [mode, questionList, skipped, slots]);

  const questionNumber = question ? questionList.indexOf(question) + 1 : questionList.length;
  const isSetup = mode === "setup";

  /**
   * ผู้ใช้กด "แก้ไข" ที่แถว "รถที่ใช้" → เปิดโมดัลตัวเลือกรถ
   * และโฟกัสช่องพิมพ์แบรนด์ให้อัตโนมัติ (ถ้ายังไม่มีรถที่เลือกไว้)
   * → พิมพ์ต่อได้เลย ไม่ต้องแตะเองอีกครั้ง
   */
  useEffect(() => {
    if (!vehicleModalOpen) return;
    if (brandText.trim()) return;
    const t = setTimeout(() => brandInputRef.current?.focus(), 280);
    return () => clearTimeout(t);
  }, [vehicleModalOpen, brandText]);

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

  /** ผู้ใช้พิมพ์คำตอบเอง → ลองจัดการในแอปก่อน ถ้าไม่ได้ค่อยส่งให้AI*/
  const handleSubmitTyped = async () => {
    const text = answerText.trim();
    if (!text || resolving || !question) return;

    // กลับจุดเดิม / กลับคนละจุด → ให้ AI เป็นคนจัดการคำพูด
    if (QUESTION_META[question].kind === "mode") {
      setAnswerText("");
      // โหมด setup: ไม่ยิง AI (ผู้ใช้กด "ข้าม" ได้แทน) → ใช้ค่าเริ่มต้น "กลับจุดเดิม"
      if (isSetup) {
        onChange({ ...latest.current, returnMode: "same_as_start", endPoint: null });
        return;
      }
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
      if (isSetup) return; // อ่านไม่ได้ → ข้ามได้ ไม่ต้องยิง AI
      onSubmitText(text);
      return;
    }

    // วันที่ → ให้ AI เป็นคนแปลง (เดือนไทย/คำอย่าง "3 วัน" เป็นเรื่องของโมเดล)
    if (QUESTION_META[question].kind === "date") {
      setAnswerText("");
      if (isSetup) return; // โหมด setup ใช้ปฏิทินของแอปแทน (ไม่ยิง AI)
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

      // หาพิกัดไม่ได้ → ให้ AI ช่วยต่อ (มักหาชื่อสถานที่ให้แม่นกว่า)
      setAnswerText("");
      if (isSetup) {
        // โหมด setup: เก็บแค่ชื่อไว้ (ยังไม่มีพิกัด) → ผู้ใช้แก้ต่อได้ที่แถวสรุป
        // ไม่ยิง AI (ผู้ใช้ยืนยันแล้วค่อยคำนวณแพลน)
        const target = originTargetOf(question);
        const prev = latest.current;
        const isFirstAsk = question === "startPoint" || question === "endPoint";
        applyPoint(target, {
          label:
            (isFirstAsk ? null : prev[target === "start" ? "startPoint" : "endPoint"]?.label) ||
            text,
          address: text,
          coords: null,
        });
        return;
      }
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
    // เลือกรถเสร็จ → ปิดโมดัล (แถว "รถที่ใช้" ในการ์ดจะโชว์ชื่อรถให้เห็นเอง)
    setVehicleModalOpen(false);
  };

  /**
   * บล็อกเลือกรถ (หมวดรถ · ช่องพิมพ์แบรนด์ · รุ่นรถที่ตรงกับที่พิมพ์)
   * -------------------------------------------------------------
   * อยู่ใน **โมดัล** ชุดเดียว ใช้ทั้ง 2 โหมด:
   * · โหมด setup = กด "แก้ไข" ที่แถว "รถที่ใช้"
   * · โหมด ask   = กดปุ่ม "เลือกรถ" ตอน "ข้อมูลครบแล้ว"
   */
  const renderVehiclePicker = () => (
    <View>
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
          ref={brandInputRef}
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
        รถที่ใช้: {vehicleLabel} — ค่าใช้จ่ายจะคำนวณตอนกดยืนยันสร้างแพลนเท่านั้น
      </Text>
    </View>
  );

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
          {isSetup ? "ตั้งค่าแพลนทริป" : "วางแผนทริป"}
        </Text>
        <View className="flex-1" />
        {question ? (
          <Text className="text-[11px] font-bold text-gray-400">
            คำถามที่ {questionNumber}/{questionList.length}
          </Text>
        ) : null}
      </View>

      {/* สถานที่ที่ผู้ใช้ติ๊กมา (โหมด setup) → ให้เห็นว่ากำลังจัดแผนจากอะไร */}
      {isSetup && places && places.length > 0 ? (
        <View className="mt-2">
          <Text className="text-[11px] font-bold text-gray-400 mb-1">
            สถานที่ที่เลือก ({places.length})
          </Text>
          <View className="flex-row flex-wrap gap-1.5">
            {places.map((name, i) => (
              <TouchableOpacity
                key={`place-${i}-${name}`}
                onPress={onSelectPlace ? () => onSelectPlace(i) : undefined}
                activeOpacity={onSelectPlace ? 0.75 : 1}
                disabled={!onSelectPlace}
                className="bg-violet-50 border border-violet-200 rounded-full px-2.5 py-1 flex-row items-center"
              >
                <Text className="text-[11.5px] font-bold text-violet-800">{name}</Text>
                {onSelectPlace ? (
                  <MapPinIcon size={11} color="#7C3AED" style={{ marginLeft: 4 }} />
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
          {/* จุดเริ่มต้นอยู่ไกลจากสถานที่ที่เลือก → เตือนก่อนกดยืนยัน */}
          {startDistanceHint ? (
            <View className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <Text className="text-amber-800 text-[11.5px] font-bold">
                จุดเริ่มต้นอยู่ไกลจากสถานที่ที่เลือก
              </Text>
              <Text className="text-amber-700 text-[11.5px] mt-0.5">
                {startDistanceHint}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

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

        {/* ── โหมด setup: รถ · จำนวนคน · งบ ───────────────────── */}
        {isSetup ? (
          <>
            <SummaryRow
              icon={<MapPinIcon size={15} color="#7C3AED" />}
              label="รถที่ใช้"
              value={vehicleLabel}
              onEdit={() => setVehicleModalOpen(true)}
            />

            {/* จำนวนผู้เดินทาง — ปุ่ม –/+ (ไม่บังคับต้องกรอก) */}
            <View className="mb-2">
              <View className="flex-row items-center">
                <View className="w-6 items-center">
                  <SparklesIcon size={15} color="#7C3AED" />
                </View>
                <View className="flex-1 ml-1">
                  <Text className="text-[11px] font-semibold text-gray-400">
                    ไปกี่คน
                  </Text>
                  <Text className="text-[13px] font-bold text-gray-900">
                    {slots.travelers != null ? `${slots.travelers} คน` : "ยังไม่ได้เลือก"}
                  </Text>
                </View>
                <View className="flex-row items-center bg-white border border-gray-200 rounded-full">
                  <TouchableOpacity
                    onPress={() =>
                      onChange({
                        ...latest.current,
                        travelers: Math.max(1, (slots.travelers ?? 1) - 1),
                      })
                    }
                    activeOpacity={0.7}
                    className="px-3 py-1"
                  >
                    <Text className="text-[14px] font-black text-gray-600">−</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() =>
                      onChange({
                        ...latest.current,
                        travelers: Math.min(50, (slots.travelers ?? 1) + 1),
                      })
                    }
                    activeOpacity={0.7}
                    className="px-3 py-1"
                  >
                    <Text className="text-[14px] font-black text-violet-700">+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* งบประมาณต่อคน — กรอกเอง (ว่าง = ข้าม) */}
            <View className="mb-2">
              <View className="flex-row items-center">
                <View className="w-6 items-center">
                  <BanknotesIcon size={15} color="#7C3AED" />
                </View>
                <View className="flex-1 ml-1">
                  <Text className="text-[11px] font-semibold text-gray-400">
                    งบประมาณต่อคน
                  </Text>
                  <View className="flex-row items-center bg-white border border-gray-200 rounded-xl px-2 mt-1">
                    <TextInput
                      value={budgetText}
                      onChangeText={(t) => {
                        const digits = t.replace(/[^0-9]/g, "");
                        setBudgetText(digits);
                        onChange({
                          ...latest.current,
                          budgetPerPerson: digits ? Number(digits) : null,
                        });
                      }}
                      keyboardType="number-pad"
                      placeholder="เช่น 3000"
                      placeholderTextColor="#9CA3AF"
                      className="flex-1 py-1.5 px-1 text-[13px] text-gray-900"
                    />
                    <Text className="text-[12px] font-bold text-gray-500">บาท</Text>
                  </View>
                </View>
              </View>
            </View>
          </>
        ) : null}
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

              {originTargetOf(question) === "start" && !isSetup ? (
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

          {/* พิมพ์คำตอบเอง — โหมด setup ซ่อนไว้สำหรับวันที่/กลับที่ (เพราะให้ AI แปลง)
              ใช้ตัวเลือกของแอปแทน (ปฏิทิน/ล้อเวลา/ชิป) */}
          {!(isSetup && (meta.kind === "date" || meta.kind === "mode")) ? (
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
          ) : null}

          {/* โหมด setup: ข้ามคำถามนี้ได้ (ไม่บังคับต้องตอบทุกข้อ) */}
          {isSetup ? (
            <View className="flex-row items-center justify-between mt-3 pt-2.5 border-t border-gray-100">
              <Text className="text-[11.5px] text-gray-400">
                ไม่ต้องการกรอกข้อนี้ก็ได้
              </Text>
              <TouchableOpacity
                onPress={() => {
                  if (!question) return;
                  setSkipped((prev) =>
                    prev.includes(question) ? prev : [...prev, question]
                  );
                }}
                activeOpacity={0.8}
                className="px-3.5 py-1.5 rounded-full bg-gray-100 border border-gray-200 flex-row items-center"
              >
                <Text className="text-[11.5px] font-bold text-gray-600">ข้าม</Text>
              </TouchableOpacity>
            </View>
          ) : (
          /* ปุ่มทางลัดสำหรับผู้ใช้ที่ต้องการให้ AI สร้างแพลนออกมาเลย */
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
          )}
        </View>
      ) : null}

      {/* ── เลือกรถ (ยังไม่คำนวณ) ─────────────────────────────
          · โหมด setup = กด "แก้ไข" ที่แถว "รถที่ใช้" → เปิดโมดัล
          · โหมด ask   = กดปุ่ม "เลือกรถ" ตอน "ข้อมูลครบ" → เปิดโมดัลเดียวกัน */}
      {!isSetup && !question ? (
        <View className="mt-3">
          <View className="bg-emerald-50 border border-emerald-200 rounded-2xl px-3.5 py-2.5">
            <Text className="text-[12.5px] font-bold text-emerald-800">
              ข้อมูลครบแล้วครับ — เลือกรถที่จะใช้ (ถ้าระบุไว้ ค่าน้ำมัน/ค่าไฟจะคำนวณตามรถคันนี้)
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => setVehicleModalOpen(true)}
            activeOpacity={0.85}
            className="mt-3 rounded-2xl border border-violet-200 bg-violet-50 px-3.5 py-3 flex-row items-center"
          >
            <MapPinIcon size={16} color="#7C3AED" />
            <Text className="text-[13px] font-bold text-violet-800 ml-1.5 flex-1">
              {slots.vehicleModel?.trim()
                ? `รถที่ใช้: ${slots.vehicleModel.trim()}`
                : "เลือกรถที่จะใช้"}
            </Text>
            <Text className="text-[11.5px] font-bold text-violet-500">แก้ไข</Text>
          </TouchableOpacity>

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

      {/* ── โหมด setup: ปุ่มยืนยัน (แสดงตลอด ไม่บังคับต้องกรอกครบ) ── */}
      {isSetup ? (
        <TouchableOpacity
          onPress={onCreatePlan}
          disabled={creating}
          activeOpacity={0.85}
          className={`mt-3.5 rounded-2xl py-3.5 items-center justify-center flex-row ${
            creating ? "bg-gray-300" : "bg-violet-600"
          }`}
        >
          {creating ? (
            <>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text className="text-white text-[13.5px] font-bold ml-2">
                กำลังวางแผน...
              </Text>
            </>
          ) : (
            <>
              <CheckIcon size={16} color="#FFFFFF" strokeWidth={3} />
              <Text className="text-white text-[14px] font-bold ml-1.5">
                ยืนยันและสร้างแพลน
              </Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}

      {/* ── โมดัลเลือกรถ ─────────────────────────────────────────
          อยู่ที่นี่ (ไม่ใช่ในการ์ด) = เปิดแล้วอยู่กลางจอเสมอ
          ไม่โดนแป้นพิมพ์บัง · ไม่ต้องเลื่อนหา · ไม่มีทาง "กดแล้วไม่ขึ้น" */}
      <Modal
        visible={vehicleModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setVehicleModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          {/* พื้นหลังมืด → กดที่ใดก็ได้เพื่อปิด */}
          <Pressable
            className="flex-1 bg-black/40"
            onPress={() => setVehicleModalOpen(false)}
          />
          <View
            className="bg-white rounded-t-3xl px-4 pt-2.5"
            style={{ paddingBottom: Math.max(insets.bottom, 16) }}
          >
            <View className="items-center mb-1.5">
              <View className="h-1 w-10 rounded-full bg-gray-300" />
            </View>
            <View className="flex-row items-center mb-2">
              <Text className="text-[15px] font-black text-gray-900 flex-1">
                เลือกรถที่ใช้
              </Text>
              <TouchableOpacity
                onPress={() => setVehicleModalOpen(false)}
                activeOpacity={0.8}
                className="p-1.5 rounded-full bg-gray-100"
              >
                <XMarkIcon size={16} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {renderVehiclePicker()}

            <TouchableOpacity
              onPress={() => setVehicleModalOpen(false)}
              activeOpacity={0.85}
              className="mt-3 rounded-2xl py-3 items-center justify-center bg-violet-600"
            >
              <Text className="text-white text-[13.5px] font-bold">เสร็จแล้ว</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
