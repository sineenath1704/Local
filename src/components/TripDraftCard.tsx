import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import {
  CheckIcon,
  CalendarDaysIcon,
  SparklesIcon,
  MapPinIcon,
  ClockIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  XMarkIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  ChatBubbleLeftRightIcon,
  ForwardIcon,
} from "react-native-heroicons/outline";
import {
  TripSlots,
  TripPlanPoint,
  formatThaiDateRange,
  tripRangeDays,
  vehicleClassOf,
  VEHICLE_CLASS_OPTIONS,
  TRAVEL_STYLES,
  type VehicleClass,
} from "../data/tripsData";

export type TripOriginTarget = "start" | "end" | "destination" | { day: number };

export interface TripDraftCardProps {
  slots: TripSlots;
  /** ผู้ใช้แก้ช่องในการ์ด → ส่งค่าใหม่กลับไปเก็บสะสม */
  onChange: (slots: TripSlots) => void;
  /** ข้อมูลครบแล้ว หรือเอาเฉพาะที่มี → กดสร้างแพลน */
  onCreatePlan: () => void;
  /** กำลังเรียก backend อยู่ */
  creating?: boolean;
  /** ขอเปิดตัวเลือกจุด (จุดเริ่มต้น / จุดสิ้นสุด / สถานที่ปลายทาง) */
  onRequestOrigin: (target: TripOriginTarget) => void;
  /** ขอเปิดปฏิทินเลือกช่วงวันที่ (วันเริ่ม → วันสิ้นสุด) */
  onRequestDateRange: () => void;
  /** ขอเปิดล้อเวลาออกเดินทาง */
  onRequestTime: () => void;
  /** ส่งข้อความเริ่มการสนทนากับ AI ในแชท */
  onSendToChat?: (message: string, slots: TripSlots) => void;
}

/** ฐานข้อมูลรุ่นรถยอดนิยมในไทยสำหรับแสดงใน Dropdown */
interface VehicleModelPreset {
  name: string;
  category: "car" | "ev" | "motorcycle" | "van";
  fuelLabel: string;
}

const POPULAR_VEHICLE_MODELS: VehicleModelPreset[] = [
  // รถยนต์ไฟฟ้า (EV)
  { name: "BYD Atto 3", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "BYD Dolphin", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "BYD Seal", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "BYD Sealion 6", category: "ev", fuelLabel: "PHEV/ไฟฟ้า" },
  { name: "ORA Good Cat", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "ORA 07", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "Tesla Model 3", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "Tesla Model Y", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "MG 4 Electric", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "MG ZS EV", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "NETA V", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "NETA V-II", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "AION Y Plus", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "Deepal S07", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "Deepal L07", category: "ev", fuelLabel: "ไฟฟ้า 100%" },

  // รถยนต์ทั่วไป / Sedan / SUV / Eco Car
  { name: "Toyota Yaris Ativ", category: "car", fuelLabel: "เบนซิน/E20" },
  { name: "Toyota Yaris Cross", category: "car", fuelLabel: "ไฮบริด (HEV)" },
  { name: "Toyota Corolla Altis", category: "car", fuelLabel: "เบนซิน/E20" },
  { name: "Toyota Corolla Cross", category: "car", fuelLabel: "ไฮบริด (HEV)" },
  { name: "Toyota Fortuner", category: "car", fuelLabel: "ดีเซล" },
  { name: "Toyota Hilux Revo", category: "car", fuelLabel: "ดีเซล" },
  { name: "Toyota Camry", category: "car", fuelLabel: "เบนซิน/HEV" },
  { name: "Honda City", category: "car", fuelLabel: "เบนซิน/E20" },
  { name: "Honda City e:HEV", category: "car", fuelLabel: "ไฮบริด (e:HEV)" },
  { name: "Honda City Hatchback", category: "car", fuelLabel: "เบนซิน/E20" },
  { name: "Honda Civic", category: "car", fuelLabel: "เบนซิน/e:HEV" },
  { name: "Honda HR-V", category: "car", fuelLabel: "ไฮบริด (e:HEV)" },
  { name: "Honda CR-V", category: "car", fuelLabel: "เบนซิน/e:HEV" },
  { name: "Isuzu D-Max", category: "car", fuelLabel: "ดีเซล" },
  { name: "Isuzu MU-X", category: "car", fuelLabel: "ดีเซล" },
  { name: "Mazda 2", category: "car", fuelLabel: "เบนซิน/ดีเซล" },
  { name: "Mazda 3", category: "car", fuelLabel: "เบนซิน" },
  { name: "Mazda CX-30", category: "car", fuelLabel: "เบนซิน" },
  { name: "Mitsubishi Xpander", category: "car", fuelLabel: "เบนซิน/HEV" },
  { name: "Mitsubishi Pajero Sport", category: "car", fuelLabel: "ดีเซล" },
  { name: "Ford Ranger", category: "car", fuelLabel: "ดีเซล" },
  { name: "Ford Everest", category: "car", fuelLabel: "ดีเซล" },
  { name: "Nissan Almera", category: "car", fuelLabel: "เบนซิน Turbo" },
  { name: "Suzuki Swift", category: "car", fuelLabel: "เบนซิน/E20" },

  // มอเตอร์ไซค์
  { name: "Honda Wave 110i", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Honda Wave 125i", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Honda PCX 160", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Honda Click 160", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Honda ADV 160", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Honda ADV 350", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Honda Forza 350", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Yamaha Grand Filano", category: "motorcycle", fuelLabel: "เบนซิน Hybrid" },
  { name: "Yamaha Aerox 155", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Yamaha XMAX 300", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Vespa Sprint 150", category: "motorcycle", fuelLabel: "เบนซิน" },

  // รถตู้
  { name: "Toyota Commuter", category: "van", fuelLabel: "ดีเซล" },
  { name: "Toyota Hiace", category: "van", fuelLabel: "ดีเซล" },
  { name: "Hyundai H-1", category: "van", fuelLabel: "ดีเซล" },
  { name: "Hyundai Staria", category: "van", fuelLabel: "ดีเซล" },
  { name: "Toyota Majesty", category: "van", fuelLabel: "ดีเซล" },
  { name: "Toyota Alphard", category: "van", fuelLabel: "เบนซิน/HEV" },
];

/** CheckBox สไตล์คลีน */
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
      className="flex-row items-center py-1"
    >
      <View
        className={`w-5 h-5 rounded-md border items-center justify-center ${
          checked ? "bg-violet-600 border-violet-600" : "bg-white border-gray-300"
        }`}
      >
        {checked ? <CheckIcon size={13} color="#FFFFFF" strokeWidth={3} /> : null}
      </View>
      <Text className="text-[13px] font-bold text-gray-800 ml-2">{label}</Text>
    </TouchableOpacity>
  );
}

/** ชิปเลือกตัวเลือก */
function Chip({
  label,
  active,
  onPress,
  emoji,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  emoji?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      className={`px-3 py-2 rounded-xl border mr-2 mb-2 flex-row items-center ${
        active ? "bg-violet-600 border-violet-600" : "bg-white border-gray-200"
      }`}
    >
      {emoji ? <Text className="mr-1 text-[13px]">{emoji}</Text> : null}
      <Text className={`text-[13px] font-bold ${active ? "text-white" : "text-gray-700"}`}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function TripDraftCardInner({
  slots,
  onChange,
  onCreatePlan,
  creating,
  onRequestOrigin,
  onRequestDateRange,
  onRequestTime,
  onSendToChat,
}: TripDraftCardProps) {
  // ควบคุม Step ปัจจุบัน (1: วันเวลา, 2: จุดเริ่ม & รถ, 3: สถานที่หรือแนะนำ, 4: งบประมาณ & สรุป)
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // ควบคุม Dropdown ค้นหารุ่นรถ
  const [vehicleDropdownOpen, setVehicleDropdownOpen] = useState(false);

  // โหมดของ Step 3: "custom" = มีสถานที่ในใจ, "recommend" = ให้แนะนำตามงบ
  const [destMode, setDestMode] = useState<"custom" | "recommend">(() => {
    return slots.destinations && slots.destinations.length > 0 ? "custom" : "recommend";
  });

  const patch = (next: Partial<TripSlots>) => {
    console.log("[TripDraftCard] patch called with:", next);
    onChange({ ...slots, ...next });
  };

  const returnMode = slots.returnMode === "custom" ? "custom" : "same_as_start";
  const vehicleClass: VehicleClass | null = vehicleClassOf(slots.vehicle);
  const days = tripRangeDays(slots.startDate, slots.endDate) ?? 1;

  const destinations: TripPlanPoint[] = slots.destinations ?? [];

  const handleRemoveDestination = (idx: number) => {
    console.log("[TripDraftCard] removing destination at index:", idx);
    const next = [...destinations];
    next.splice(idx, 1);
    patch({ destinations: next });
  };

  const requestOriginSafely = (target: TripOriginTarget) => {
    console.log("[TripDraftCard] requestOriginSafely:", target);
    if (typeof onRequestOrigin === "function") {
      onRequestOrigin(target);
      return;
    }
    Alert.alert("ไม่พร้อมใช้งาน", "ยังไม่พร้อมให้เลือกจุด ลองเปิดใหม่อีกครั้ง");
  };

  // กรองรายการรุ่นรถตามที่ผู้ใช้พิมพ์ และหมวดหมู่ที่เลือก
  const vehicleSuggestions = useMemo(() => {
    const query = (slots.vehicleModel ?? "").trim().toLowerCase();
    const vKey = (slots.vehicle ?? "").toLowerCase();
    const cat =
      vehicleClass === "ev" || vKey === "ev"
        ? "ev"
        : vKey.includes("motorcycle") || vKey.includes("มอเตอร์ไซค์")
        ? "motorcycle"
        : vKey.includes("van") || vKey.includes("ตู้")
        ? "van"
        : "car";

    let list = POPULAR_VEHICLE_MODELS;

    if (!query) {
      return list.filter((m) => m.category === cat).slice(0, 8);
    }

    return list
      .filter((m) => m.name.toLowerCase().includes(query))
      .slice(0, 10);
  }, [slots.vehicleModel, slots.vehicle, vehicleClass]);

  const selectVehicleModel = (preset: VehicleModelPreset) => {
    console.log("[TripDraftCard] selectVehicleModel:", preset.name);
    const nextVehicle =
      preset.category === "ev"
        ? "ev"
        : preset.category === "motorcycle"
        ? "motorcycle"
        : preset.category === "van"
        ? "van"
        : "private_car";

    const nextFuelType = preset.category === "ev" ? "electric" : null;

    patch({
      vehicleModel: preset.name,
      vehicle: nextVehicle,
      fuelType: nextFuelType,
    });
    setVehicleDropdownOpen(false);
  };

  // ส่งช่วงเวลาเพื่อเริ่มคุยกับ AI ในแชท
  const handleStartChatWithDates = () => {
    const dateRangeStr = formatThaiDateRange(slots.startDate, slots.endDate);
    const msg = `อยากไปเที่ยวช่วง ${dateRangeStr} (${days} วัน) ออกเดินทางประมาณ ${slots.startTime ?? "08:00"} น. ครับ ช่วยวางแผนให้หน่อย`;
    console.log("[TripDraftCard] handleStartChatWithDates:", msg);
    if (onSendToChat) {
      onSendToChat(msg, slots);
    } else {
      setCurrentStep(2);
    }
  };

  const handleSkipStep = (next: 1 | 2 | 3 | 4) => {
    console.log("[TripDraftCard] user skipped step", currentStep, "-> jumping to step", next);
    setCurrentStep(next);
  };

  // ตรวจสอบความพร้อมของแต่ละ Step เพื่อนำทาง
  const step1Valid = !!slots.startDate && !!slots.endDate && !!slots.startTime;
  const step2Valid = !!slots.startPoint?.coords;
  const step3Valid = true;
  // ยืดหยุ่น: มีวันเดินทาง และมีจุดเริ่มต้น (หรือถ้าไม่มีจุดเริ่ม ให้กดส่งเพื่อวิเคราะห์ได้)
  const canAnalyze = !!slots.startDate && !!slots.endDate;

  return (
    <View className="mt-2 self-stretch bg-white border border-violet-200 rounded-3xl overflow-hidden shadow-sm">
      {/* ── หัวการ์ด & ตัวบอกขั้นตอน (Stepper Tabs) ── */}
      <View className="bg-violet-50 px-3.5 pt-3 pb-2.5 border-b border-violet-100">
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center">
            <View className="w-6 h-6 rounded-full bg-violet-600 items-center justify-center mr-1.5">
              <SparklesIcon size={14} color="#FFFFFF" />
            </View>
            <Text className="text-violet-950 text-[13.5px] font-black">
              วางแผนทริปทีละขั้นตอน (ข้ามได้)
            </Text>
          </View>
          <View className="bg-violet-200/60 px-2 py-0.5 rounded-full">
            <Text className="text-violet-800 text-[11px] font-bold">
              คำถามที่ {currentStep} จาก 4
            </Text>
          </View>
        </View>

        {/* แถบ Tab ลัดสำหรับแตะข้ามขั้นตอน */}
        <View className="flex-row items-center justify-between mt-1">
          {[
            { step: 1, label: "วันเวลา", done: step1Valid, icon: "📅" },
            { step: 2, label: "จุดเริ่ม&รถ", done: step2Valid, icon: "🚗" },
            { step: 3, label: "สถานที่", done: step3Valid, icon: "📍" },
            { step: 4, label: "งบ&สร้าง", done: canAnalyze, icon: "💰" },
          ].map((item) => {
            const isActive = currentStep === item.step;
            return (
              <TouchableOpacity
                key={item.step}
                onPress={() => {
                  console.log("[TripDraftCard] tab clicked:", item.step);
                  setCurrentStep(item.step as any);
                }}
                activeOpacity={0.7}
                className={`flex-1 py-1 px-1 rounded-xl mx-0.5 items-center justify-center border ${
                  isActive
                    ? "bg-violet-600 border-violet-600 shadow-sm"
                    : item.done
                    ? "bg-violet-100/70 border-violet-200"
                    : "bg-white border-gray-200"
                }`}
              >
                <Text
                  className={`text-[11px] font-bold ${
                    isActive ? "text-white" : item.done ? "text-violet-900" : "text-gray-500"
                  }`}
                  numberOfLines={1}
                >
                  {item.icon} {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── เนื้อหาของแต่ละ Step ── */}
      <View className="p-3.5">
        {/* ══════════════════════════════════════════════════════════════
            STEP 1: วันและเวลาเดินทาง
           ══════════════════════════════════════════════════════════════ */}
        {currentStep === 1 && (
          <View>
            <View className="mb-3">
              <Text className="text-[15px] font-black text-gray-900">
                1. ทริปนี้วางแผนไปช่วงไหนครับ?
              </Text>
              <Text className="text-[12px] text-gray-500 mt-0.5">
                เลือกช่วงวันที่เดินทาง เพื่อนำไปจัดแผนเที่ยวในแต่ละวัน
              </Text>
            </View>

            {/* เลือกช่วงวันที่ */}
            <View className="mb-3">
              <Text className="text-[12.5px] font-bold text-gray-700 mb-1.5">
                ช่วงวันเดินทาง (ไม่เกิน 7 วัน)
              </Text>
              <TouchableOpacity
                onPress={() => {
                  console.log("[TripDraftCard] opening date range sheet");
                  onRequestDateRange();
                }}
                activeOpacity={0.8}
                className="flex-row items-center justify-between bg-violet-50/70 border border-violet-200 rounded-2xl px-3.5 py-3"
              >
                <View className="flex-row items-center flex-1 mr-2">
                  <CalendarDaysIcon size={18} color="#7C3AED" />
                  <Text className="text-violet-950 text-[13.5px] font-bold ml-2">
                    {formatThaiDateRange(slots.startDate, slots.endDate) || "กดเลือกช่วงวันเดินทาง"}
                  </Text>
                </View>
                {slots.startDate && slots.endDate ? (
                  <View className="bg-emerald-100 px-2 py-0.5 rounded-full">
                    <Text className="text-emerald-800 text-[11px] font-black">{days} วัน</Text>
                  </View>
                ) : (
                  <Text className="text-violet-600 text-[12px] font-bold">เลือกวันที่ ➔</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* เลือกเวลาออกเดินทาง */}
            <View className="mb-3">
              <Text className="text-[12.5px] font-bold text-gray-700 mb-1.5">
                เวลาออกเดินทางวันแรก
              </Text>
              <TouchableOpacity
                onPress={() => {
                  console.log("[TripDraftCard] opening time sheet");
                  onRequestTime();
                }}
                activeOpacity={0.8}
                className="flex-row items-center justify-between bg-violet-50/70 border border-violet-200 rounded-2xl px-3.5 py-3"
              >
                <View className="flex-row items-center">
                  <ClockIcon size={18} color="#7C3AED" />
                  <Text className="text-violet-950 text-[13.5px] font-bold ml-2">
                    {slots.startTime ? `${slots.startTime} น.` : "กดเลือกเวลาออกเดินทาง (เช่น 08:00)"}
                  </Text>
                </View>
                <Text className="text-violet-600 text-[12px] font-bold">
                  {slots.startTime ? "เปลี่ยน" : "เลือกเวลา ➔"}
                </Text>
              </TouchableOpacity>
            </View>

            {/* ทางเลือก: เริ่มคุยในแชททันที หรือ ตอบทีละสเต็ป */}
            {step1Valid ? (
              <View className="gap-2 mt-2">
                <TouchableOpacity
                  onPress={handleStartChatWithDates}
                  activeOpacity={0.85}
                  className="rounded-2xl py-3 px-4 bg-violet-600 flex-row items-center justify-center shadow-sm"
                >
                  <ChatBubbleLeftRightIcon size={17} color="#FFFFFF" />
                  <Text className="text-white text-[13.5px] font-bold ml-1.5">
                    ส่งช่วงเวลานี้ แล้วเริ่มคุยกับน้องโลคอล 💬
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setCurrentStep(2)}
                  activeOpacity={0.8}
                  className="rounded-2xl py-2.5 px-4 bg-gray-100 flex-row items-center justify-center"
                >
                  <Text className="text-gray-700 text-[12.5px] font-bold">
                    ตั้งค่าคำถามอื่นเพิ่มเติมเอง ➔
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="bg-gray-100 rounded-2xl py-3 items-center justify-center mt-2">
                <Text className="text-gray-400 text-[13px] font-bold">
                  กรุณาเลือกช่วงวันเดินทางด้านบนก่อนครับ
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ══════════════════════════════════════════════════════════════
            STEP 2: จุดเริ่มต้น & รถที่ใช้ (มีปุ่มข้ามคำถามนี้)
           ══════════════════════════════════════════════════════════════ */}
        {currentStep === 2 && (
          <View>
            <View className="flex-row items-start justify-between mb-2">
              <View className="flex-1 mr-2">
                <Text className="text-[15px] font-black text-gray-900">
                  2. ออกเดินทางจากที่ไหน และใช้รถอะไร?
                </Text>
                <Text className="text-[12px] text-gray-500 mt-0.5">
                  (ไม่บังคับตอบ — สามารถกดข้ามได้ครับ)
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => handleSkipStep(3)}
                className="px-2.5 py-1 rounded-full bg-gray-100 border border-gray-200 flex-row items-center"
              >
                <ForwardIcon size={13} color="#6B7280" />
                <Text className="text-gray-600 text-[11px] font-bold ml-1">ข้ามคำถามนี้</Text>
              </TouchableOpacity>
            </View>

            {/* จุดเริ่มต้น */}
            <View className="mb-3">
              <Text className="text-[12.5px] font-bold text-gray-700 mb-1.5">
                จุดเริ่มต้นเดินทาง
              </Text>
              <TouchableOpacity
                onPress={() => requestOriginSafely("start")}
                activeOpacity={0.8}
                className="flex-row items-center justify-between bg-violet-50/70 border border-violet-200 rounded-2xl px-3.5 py-3"
              >
                <View className="flex-row items-center flex-1 mr-2">
                  <MapPinIcon size={18} color="#7C3AED" />
                  <View className="ml-2 flex-1">
                    <Text className="text-violet-950 text-[13.5px] font-bold" numberOfLines={1}>
                      {slots.startPoint?.label || "แตะเลือกจุดเริ่มต้น (บ้าน, ที่ทำงาน, ลิงก์)"}
                    </Text>
                    {slots.startPoint?.address ? (
                      <Text className="text-gray-500 text-[11px]" numberOfLines={1}>
                        {slots.startPoint.address}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {slots.startPoint?.coords ? (
                  <View className="bg-emerald-100 px-2 py-0.5 rounded-full">
                    <Text className="text-emerald-800 text-[11px] font-black">มีพิกัด ✓</Text>
                  </View>
                ) : (
                  <Text className="text-violet-600 text-[12px] font-bold">เลือกจุด ➔</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* จุดสิ้นสุดตอนกลับ */}
            <View className="mb-3 bg-gray-50 border border-gray-200 rounded-2xl p-2.5">
              <CheckBox
                checked={returnMode === "same_as_start"}
                onPress={() =>
                  patch(
                    returnMode === "same_as_start"
                      ? { returnMode: "custom" }
                      : { returnMode: "same_as_start", endPoint: null }
                  )
                }
                label="จุดสิ้นสุดคือที่เดียวกับจุดเริ่มต้น (กลับจุดเดิม)"
              />
              {returnMode === "custom" ? (
                <TouchableOpacity
                  onPress={() => requestOriginSafely("end")}
                  activeOpacity={0.8}
                  className="flex-row items-center justify-between bg-white border border-violet-200 rounded-xl px-3 py-2 mt-2"
                >
                  <Text className="text-violet-900 text-[13px] font-bold flex-1" numberOfLines={1}>
                    {slots.endPoint?.label || "แตะเลือกจุดสิ้นสุดตอนกลับ"}
                  </Text>
                  <Text className="text-violet-600 text-[12px] font-bold">เลือก</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* ประเภทยานพาหนะ */}
            <View className="mb-2">
              <Text className="text-[12.5px] font-bold text-gray-700 mb-1.5">
                ประเภทรถที่ใช้เดินทาง
              </Text>
              <View className="flex-row flex-wrap">
                {VEHICLE_CLASS_OPTIONS.map((v) => (
                  <Chip
                    key={v.key}
                    label={v.label}
                    active={vehicleClass === v.key}
                    onPress={() => {
                      if (vehicleClass === v.key) return;
                      patch(
                        v.key === "public"
                          ? { vehicle: v.key, vehicleModel: null, fuelType: null }
                          : v.key === "ev"
                          ? { vehicle: v.key, fuelType: "electric" }
                          : { vehicle: v.key, fuelType: null }
                      );
                    }}
                  />
                ))}
              </View>
            </View>

            {/* ช่องพิมพ์/เลือก Dropdown รุ่นรถ */}
            {vehicleClass && vehicleClass !== "public" ? (
              <View className="mb-3 bg-violet-50/60 border border-violet-200 rounded-2xl p-3">
                <View className="flex-row items-center justify-between mb-1.5">
                  <Text className="text-[12.5px] font-bold text-violet-950">
                    ชื่อหรือรุ่นรถ (พิมพ์ค้นหาหรือเลือกจาก Dropdown)
                  </Text>
                  {slots.vehicleModel ? (
                    <TouchableOpacity
                      onPress={() => patch({ vehicleModel: "" })}
                      className="px-1.5 py-0.5 rounded bg-gray-200"
                    >
                      <Text className="text-gray-600 text-[11px] font-bold">ล้าง ✕</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Input ค้นหา */}
                <View className="flex-row items-center bg-white border border-violet-200 rounded-xl px-3 py-1">
                  <MagnifyingGlassIcon size={16} color="#7C3AED" />
                  <TextInput
                    value={slots.vehicleModel ?? ""}
                    onChangeText={(t) => {
                      patch({ vehicleModel: t });
                      if (!vehicleDropdownOpen) setVehicleDropdownOpen(true);
                    }}
                    onFocus={() => setVehicleDropdownOpen(true)}
                    placeholder="พิมพ์ชื่อรุ่น เช่น Yaris, City, BYD Atto 3, PCX..."
                    placeholderTextColor="#9CA3AF"
                    className="flex-1 ml-2 py-2 text-[13.5px] text-gray-900"
                  />
                </View>

                {/* Dropdown รายการแนะนำ */}
                {vehicleDropdownOpen && vehicleSuggestions.length > 0 ? (
                  <View className="bg-white border border-gray-200 rounded-xl mt-1.5 shadow-sm max-h-48 overflow-hidden">
                    <View className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 flex-row items-center justify-between">
                      <Text className="text-[11px] font-bold text-gray-500 uppercase">
                        รุ่นรถยอดนิยม (แตะเพื่อเลือก)
                      </Text>
                      <TouchableOpacity onPress={() => setVehicleDropdownOpen(false)}>
                        <Text className="text-violet-600 text-[11px] font-bold">ปิด ✕</Text>
                      </TouchableOpacity>
                    </View>
                    <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                      {vehicleSuggestions.map((item, idx) => (
                        <TouchableOpacity
                          key={`${item.name}-${idx}`}
                          onPress={() => selectVehicleModel(item)}
                          activeOpacity={0.7}
                          className="px-3.5 py-2.5 flex-row items-center justify-between border-b border-gray-50"
                        >
                          <Text className="text-gray-900 text-[13px] font-bold flex-1 mr-2">
                            {item.name}
                          </Text>
                          <View
                            className={`px-2 py-0.5 rounded-full ${
                              item.category === "ev"
                                ? "bg-emerald-100"
                                : item.fuelLabel.includes("ไฮบริด")
                                ? "bg-blue-100"
                                : "bg-gray-100"
                            }`}
                          >
                            <Text
                              className={`text-[10.5px] font-black ${
                                item.category === "ev"
                                  ? "text-emerald-800"
                                  : item.fuelLabel.includes("ไฮบริด")
                                  ? "text-blue-800"
                                  : "text-gray-600"
                              }`}
                            >
                              {item.fuelLabel}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                <Text className="text-gray-500 text-[11.5px] mt-1.5 leading-4">
                  💡 ระบบจะค้นหาอัตราสิ้นเปลืองและราคาน้ำมัน/ไฟ เพื่อคำนวณงบเดินทางตามระยะทางจริง
                </Text>
              </View>
            ) : null}

            {/* ปุ่ม ย้อนกลับ / ถัดไป */}
            <View className="flex-row items-center gap-2 mt-2">
              <TouchableOpacity
                onPress={() => setCurrentStep(1)}
                activeOpacity={0.8}
                className="flex-1 py-3 rounded-2xl border border-gray-300 items-center justify-center flex-row"
              >
                <ChevronLeftIcon size={16} color="#4B5563" />
                <Text className="text-gray-700 text-[13.5px] font-bold ml-1">ย้อนกลับ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setCurrentStep(3)}
                activeOpacity={0.85}
                className="flex-2 py-3 px-4 rounded-2xl bg-violet-600 items-center justify-center flex-row"
              >
                <Text className="text-white text-[13.5px] font-bold">
                  ถัดไป: ปลายทาง
                </Text>
                <ChevronRightIcon size={16} color="#FFFFFF" className="ml-1" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ══════════════════════════════════════════════════════════════
            STEP 3: สถานที่เป้าหมาย (Data-only / มีปุ่มข้าม)
           ══════════════════════════════════════════════════════════════ */}
        {currentStep === 3 && (
          <View>
            <View className="flex-row items-start justify-between mb-2">
              <View className="flex-1 mr-2">
                <Text className="text-[15px] font-black text-gray-900">
                  3. มีสถานที่ที่อยากไปเป็นพิเศษไหมครับ?
                </Text>
                <Text className="text-[12px] text-gray-500 mt-0.5">
                  (ไม่บังคับ — กดข้ามเพื่อให้ระบบแนะนำตามงบได้ครับ)
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => handleSkipStep(4)}
                className="px-2.5 py-1 rounded-full bg-gray-100 border border-gray-200 flex-row items-center"
              >
                <ForwardIcon size={13} color="#6B7280" />
                <Text className="text-gray-600 text-[11px] font-bold ml-1">ข้ามคำถามนี้</Text>
              </TouchableOpacity>
            </View>

            {/* สลับโหมด */}
            <View className="flex-row bg-gray-100 p-1 rounded-2xl mb-3">
              <TouchableOpacity
                onPress={() => setDestMode("custom")}
                activeOpacity={0.8}
                className={`flex-1 py-2 rounded-xl items-center justify-center ${
                  destMode === "custom" ? "bg-white shadow-sm" : ""
                }`}
              >
                <Text
                  className={`text-[12.5px] font-bold ${
                    destMode === "custom" ? "text-violet-900" : "text-gray-600"
                  }`}
                >
                  📍 มีสถานที่ในใจแล้ว
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setDestMode("recommend")}
                activeOpacity={0.8}
                className={`flex-1 py-2 rounded-xl items-center justify-center ${
                  destMode === "recommend" ? "bg-white shadow-sm" : ""
                }`}
              >
                <Text
                  className={`text-[12.5px] font-bold ${
                    destMode === "recommend" ? "text-violet-900" : "text-gray-600"
                  }`}
                >
                  ✨ แนะนำตามงบและความสะดวก
                </Text>
              </TouchableOpacity>
            </View>

            {/* 🅰️ มีสถานที่ในใจ: จัดการเพิ่ม/ลบสถานที่ลง Data ทันที */}
            {destMode === "custom" ? (
              <View className="bg-violet-50/50 border border-violet-100 rounded-2xl p-3 mb-2">
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-[12.5px] font-bold text-violet-900">
                    สถานที่ที่เลือกไว้ ({destinations.length})
                  </Text>
                  <TouchableOpacity
                    onPress={() => requestOriginSafely("destination")}
                    activeOpacity={0.8}
                    className="flex-row items-center bg-violet-600 px-3 py-1.5 rounded-xl"
                  >
                    <PlusIcon size={14} color="#FFFFFF" strokeWidth={2.5} />
                    <Text className="text-white text-[12px] font-bold ml-1">เพิ่มสถานที่</Text>
                  </TouchableOpacity>
                </View>

                {destinations.length === 0 ? (
                  <View className="py-4 items-center justify-center bg-white border border-dashed border-gray-200 rounded-xl">
                    <MapPinIcon size={22} color="#9CA3AF" />
                    <Text className="text-gray-500 text-[12px] font-medium mt-1">
                      ยังไม่ได้เพิ่มสถานที่ — กดปุ่ม + เพิ่มสถานที่ ด้านบน
                    </Text>
                    <Text className="text-gray-400 text-[11px] mt-0.5">
                      (บันทึกชื่อและพิกัดลงในทริปทันที โดยไม่ต้องรอ AI)
                    </Text>
                  </View>
                ) : (
                  <View className="gap-1.5">
                    {destinations.map((dest, idx) => (
                      <View
                        key={`${dest.label}-${idx}`}
                        className="flex-row items-center justify-between bg-white border border-gray-200 rounded-xl px-3 py-2"
                      >
                        <View className="flex-row items-center flex-1 mr-2">
                          <MapPinIcon size={15} color="#7C3AED" />
                          <Text className="text-gray-900 text-[13px] font-bold ml-1.5" numberOfLines={1}>
                            {dest.label}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleRemoveDestination(idx)}
                          className="p-1 rounded-full bg-gray-100"
                        >
                          <XMarkIcon size={14} color="#6B7280" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              /* 🅱️ ยังไม่มีที่ในใจ: ให้ระบบช่วยแนะนำตามสไตล์และงบ */
              <View className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-3 mb-2">
                <View className="flex-row items-center mb-1.5">
                  <SparklesIcon size={16} color="#059669" />
                  <Text className="text-emerald-900 text-[13px] font-black ml-1.5">
                    ไม่ต้องกังวล! น้องโลคอลช่วยคิดให้
                  </Text>
                </View>
                <Text className="text-emerald-800 text-[11.5px] leading-4 mb-2.5">
                  ระบบจะคัดเลือกจุดแวะและชุมชนที่ขับสะดวก และจัดแผนให้คุมงบประมาณได้อยู่หมัด
                </Text>

                <Text className="text-[12px] font-bold text-gray-700 mb-1.5">
                  เลือกสไตล์การเที่ยวที่คุณชอบ:
                </Text>
                <View className="flex-row flex-wrap">
                  {TRAVEL_STYLES.map((st) => (
                    <Chip
                      key={st.key}
                      label={st.label}
                      emoji={st.emoji}
                      active={(slots.style ?? "nature") === st.key}
                      onPress={() => patch({ style: st.key })}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* ปุ่ม ย้อนกลับ / ถัดไป */}
            <View className="flex-row items-center gap-2 mt-2">
              <TouchableOpacity
                onPress={() => setCurrentStep(2)}
                activeOpacity={0.8}
                className="flex-1 py-3 rounded-2xl border border-gray-300 items-center justify-center flex-row"
              >
                <ChevronLeftIcon size={16} color="#4B5563" />
                <Text className="text-gray-700 text-[13.5px] font-bold ml-1">ย้อนกลับ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setCurrentStep(4)}
                activeOpacity={0.85}
                className="flex-2 py-3 px-4 rounded-2xl bg-violet-600 items-center justify-center flex-row"
              >
                <Text className="text-white text-[13.5px] font-bold">
                  ถัดไป: งบประมาณ & สรุป
                </Text>
                <ChevronRightIcon size={16} color="#FFFFFF" className="ml-1" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ══════════════════════════════════════════════════════════════
            STEP 4: งบประมาณ & วิเคราะห์จัดทริปเฉพาะคำตอบที่ได้
           ══════════════════════════════════════════════════════════════ */}
        {currentStep === 4 && (
          <View>
            <View className="mb-3">
              <Text className="text-[15px] font-black text-gray-900">
                4. งบประมาณต่อคน และสรุปแผนทริป
              </Text>
              <Text className="text-[12px] text-gray-500 mt-0.5">
                เลือกงบต่อคน หรือกดสร้างแผนทันทีโดยใช้เฉพาะคำตอบที่คุณระบุ
              </Text>
            </View>

            {/* ชิปเลือกงบ */}
            <View className="mb-3">
              <Text className="text-[12.5px] font-bold text-gray-700 mb-1.5">
                งบประมาณต่อคน (แตะเลือก หรือใช้ค่าเริ่มต้น 3,000 บาท)
              </Text>
              <View className="flex-row flex-wrap">
                {[1500, 3000, 5000, 8000, 12000].map((n) => (
                  <Chip
                    key={n}
                    label={`${n.toLocaleString("th-TH")} บาท`}
                    active={(slots.budgetPerPerson ?? 3000) === n}
                    onPress={() => patch({ budgetPerPerson: n })}
                  />
                ))}
              </View>
            </View>

            {/* การ์ดสรุปเฉพาะข้อมูลที่ได้มา */}
            <View className="bg-gray-50 border border-gray-200 rounded-2xl p-3 mb-3">
              <Text className="text-[12.5px] font-bold text-gray-800 mb-2">
                📋 ข้อมูลที่จะนำมาวิเคราะห์จัดทริป:
              </Text>
              <View className="gap-1.5 text-[12px]">
                <Text className="text-gray-700 text-[12px]">
                  📅 <Text className="font-bold">วันเดินทาง:</Text>{" "}
                  {formatThaiDateRange(slots.startDate, slots.endDate) || "ยังไม่ระบุ"} ({days} วัน) เวลา {slots.startTime ?? "08:00"} น.
                </Text>
                <Text className="text-gray-700 text-[12px]">
                  🚗 <Text className="font-bold">การเดินทาง:</Text>{" "}
                  {slots.startPoint?.label ?? "จุดเริ่มต้นในพื้นที่"} ➔{" "}
                  {slots.vehicleModel?.trim() ? slots.vehicleModel : slots.vehicle ?? "รถยนต์ส่วนตัว"}
                </Text>
                <Text className="text-gray-700 text-[12px]">
                  📍 <Text className="font-bold">เป้าหมาย:</Text>{" "}
                  {destMode === "custom" && destinations.length > 0
                    ? `${destinations.length} สถานที่ (${destinations.map((d) => d.label).join(", ")})`
                    : `แนะนำตามงบ (สไตล์ ${TRAVEL_STYLES.find((s) => s.key === slots.style)?.label ?? "ธรรมชาติ"})`}
                </Text>
                <Text className="text-gray-700 text-[12px]">
                  💰 <Text className="font-bold">งบต่อคน:</Text>{" "}
                  {(slots.budgetPerPerson ?? 3000).toLocaleString("th-TH")} บาท
                </Text>
              </View>
            </View>

            {/* ปุ่ม ย้อนกลับ / วิเคราะห์จัดทริปทันที */}
            <View className="flex-row items-center gap-2">
              <TouchableOpacity
                onPress={() => setCurrentStep(3)}
                activeOpacity={0.8}
                className="flex-1 py-3.5 rounded-2xl border border-gray-300 items-center justify-center flex-row"
              >
                <ChevronLeftIcon size={16} color="#4B5563" />
                <Text className="text-gray-700 text-[13.5px] font-bold ml-1">ย้อนกลับ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  console.log("[TripDraftCard] onCreatePlan clicked, slots:", slots);
                  onCreatePlan();
                }}
                disabled={creating || !canAnalyze}
                activeOpacity={0.85}
                className={`flex-2 py-3.5 px-4 rounded-2xl items-center justify-center flex-row ${
                  canAnalyze && !creating
                    ? "bg-violet-600 shadow-md shadow-violet-200"
                    : "bg-gray-200"
                }`}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <SparklesIcon size={17} color={canAnalyze ? "#FFFFFF" : "#9CA3AF"} />
                )}
                <Text
                  className={`text-[14px] font-black ml-1.5 ${
                    canAnalyze ? "text-white" : "text-gray-500"
                  }`}
                >
                  {creating ? "กำลังวิเคราะห์จัดทริป..." : "🚀 วิเคราะห์และจัดทริปเลย"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

/** Error Boundary ป้องกัน Crash ระดับ Native */
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
