import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  MapPinIcon,
  SparklesIcon,
} from "react-native-heroicons/outline";
import { CheckCircleIcon as CheckSolid } from "react-native-heroicons/solid";
import { useInteractions } from "../../state/InteractionContext";
import { useAiPlanner } from "../../state/AiPlannerContext";
import { generateTrip } from "../../services/tripService";
import {
  resolveSavedVideo,
  TRAVEL_STYLES,
  TravelStyle,
  Trip,
} from "../../data/tripsData";

interface TripWizardProps {
  initialFolderId?: string;
  onBack: () => void;
  onCreated: (tripId: string) => void;
}

const START_POINTS = ["สนามบินเชียงใหม่", "สนามบินเชียงราย", "สนามบินแม่ฮ่องสอน", "กรุงเทพฯ (ขับรถ)"];
const DAY_OPTIONS = [2, 3, 4, 5];
const BUDGET_OPTIONS = [2000, 3000, 5000, 8000];

export default function TripWizard({ initialFolderId, onBack, onCreated }: TripWizardProps) {
  const insets = useSafeAreaInsets();
  const { folders } = useInteractions();
  const { addTrip } = useAiPlanner();

  const folder = initialFolderId ? folders.find((f) => f.id === initialFolderId) : undefined;
  const folderVideos = (folder?.videoIds ?? []).map(resolveSavedVideo);

  const [step, setStep] = useState(1);
  const [startPoint, setStartPoint] = useState(START_POINTS[0]);
  const [selectedPlaces, setSelectedPlaces] = useState<string[]>(
    folderVideos.map((v) => v.placeLabel)
  );
  const [customDest, setCustomDest] = useState("");
  const [days, setDays] = useState(3);
  const [budget, setBudget] = useState(3000);
  const [style, setStyle] = useState<TravelStyle>("nature");
  const [generating, setGenerating] = useState(false);

  const togglePlace = (label: string) =>
    setSelectedPlaces((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]
    );

  const addCustom = () => {
    const v = customDest.trim();
    if (v && !selectedPlaces.includes(v)) setSelectedPlaces((prev) => [...prev, v]);
    setCustomDest("");
  };

  const handleGenerate = async () => {
    setGenerating(true);
    const result = await generateTrip({
      startPoint,
      destinations: selectedPlaces,
      days,
      nights: Math.max(0, days - 1),
      budgetPerPerson: budget,
      style,
    });
    const trip: Trip = {
      id: `trip-${Date.now()}`,
      title: result.title,
      summary: result.summary,
      status: "draft",
      startPoint,
      destinations: selectedPlaces,
      days,
      nights: Math.max(0, days - 1),
      budgetPerPerson: budget,
      style,
      itinerary: result.days,
      budget: result.budget,
      sourceFolderId: initialFolderId,
      createdAt: Date.now(),
    };
    addTrip(trip);
    setGenerating(false);
    onCreated(trip.id);
  };

  const canNext =
    step === 1 ? !!startPoint :
    step === 2 ? selectedPlaces.length > 0 :
    step === 3 ? days > 0 && budget > 0 :
    true;

  const StepDot = ({ n }: { n: number }) => (
    <View className={`w-7 h-7 rounded-full items-center justify-center ${step >= n ? "bg-violet-600" : "bg-gray-200"}`}>
      <Text className={`text-[12px] font-bold ${step >= n ? "text-white" : "text-gray-500"}`}>{n}</Text>
    </View>
  );

  return (
    <View className="flex-1 bg-white">
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <View
        style={{ paddingTop: Math.max(insets.top, 12) + (Platform.OS === "android" ? 8 : 4) }}
        className="px-3 pb-3 flex-row items-center border-b border-gray-100"
      >
        <TouchableOpacity onPress={() => (step > 1 ? setStep(step - 1) : onBack())} className="p-1 mr-1">
          <ArrowLeftIcon size={24} color="#18181B" strokeWidth={2} />
        </TouchableOpacity>
        <Text className="text-lg font-black text-gray-900 flex-1">สร้างทริปใหม่ด้วย AI</Text>
      </View>

      {/* Steps indicator */}
      <View className="flex-row items-center justify-center py-4">
        {[1, 2, 3, 4].map((n) => (
          <React.Fragment key={n}>
            <StepDot n={n} />
            {n < 4 && <View className={`w-8 h-0.5 ${step > n ? "bg-violet-600" : "bg-gray-200"}`} />}
          </React.Fragment>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        {/* STEP 1: Start point */}
        {step === 1 && (
          <View>
            <Text className="text-xl font-black text-gray-900 mb-1">1. เลือกจุดเริ่มต้น</Text>
            <Text className="text-gray-500 text-[13px] mb-5">คุณจะเริ่มออกเดินทางจากที่ไหน</Text>
            {START_POINTS.map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setStartPoint(p)}
                activeOpacity={0.7}
                className={`flex-row items-center p-4 rounded-2xl border mb-2.5 ${
                  startPoint === p ? "bg-violet-50 border-violet-400" : "bg-gray-50 border-gray-200"
                }`}
              >
                <MapPinIcon size={20} color={startPoint === p ? "#7C3AED" : "#9CA3AF"} />
                <Text className={`ml-3 text-[14px] font-semibold ${startPoint === p ? "text-violet-700" : "text-gray-700"}`}>
                  {p}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* STEP 2: Destinations / clips */}
        {step === 2 && (
          <View>
            <Text className="text-xl font-black text-gray-900 mb-1">2. เลือกปลายทาง</Text>
            <Text className="text-gray-500 text-[13px] mb-5">
              {folder ? `จากคลิปในโฟลเดอร์ "${folder.name}" หรือเพิ่มเอง` : "เพิ่มปลายทางที่อยากไป"}
            </Text>

            {folderVideos.map((v) => {
              const picked = selectedPlaces.includes(v.placeLabel);
              return (
                <TouchableOpacity
                  key={v.id}
                  onPress={() => togglePlace(v.placeLabel)}
                  activeOpacity={0.7}
                  className={`flex-row items-center p-3.5 rounded-2xl border mb-2.5 ${
                    picked ? "bg-violet-50 border-violet-400" : "bg-gray-50 border-gray-200"
                  }`}
                >
                  <View className="flex-1">
                    <Text className="text-[14px] font-semibold text-gray-800">{v.title}</Text>
                    <Text className="text-[12px] text-gray-500">{v.placeLabel}</Text>
                  </View>
                  {picked ? <CheckSolid size={22} color="#7C3AED" /> : <CheckCircleIcon size={22} color="#D1D5DB" />}
                </TouchableOpacity>
              );
            })}

            {/* Custom destination */}
            <View className="flex-row items-center mt-2">
              <TextInput
                value={customDest}
                onChangeText={setCustomDest}
                placeholder="เพิ่มปลายทางเอง..."
                placeholderTextColor="#9CA3AF"
                className="flex-1 bg-gray-100 rounded-xl px-3.5 py-2.5 text-[14px] text-gray-900"
              />
              <TouchableOpacity
                onPress={addCustom}
                disabled={!customDest.trim()}
                className={`ml-2 px-4 py-2.5 rounded-xl ${customDest.trim() ? "bg-violet-600" : "bg-gray-200"}`}
              >
                <Text className="text-white font-bold text-[13px]">เพิ่ม</Text>
              </TouchableOpacity>
            </View>

            {/* Chips of custom-added that aren't in folder */}
            <View className="flex-row flex-wrap mt-3">
              {selectedPlaces
                .filter((p) => !folderVideos.some((v) => v.placeLabel === p))
                .map((p) => (
                  <TouchableOpacity
                    key={p}
                    onPress={() => togglePlace(p)}
                    className="bg-violet-100 rounded-full px-3 py-1.5 mr-2 mb-2 flex-row items-center"
                  >
                    <Text className="text-violet-700 text-[12px] font-semibold">{p}</Text>
                    <Text className="text-violet-400 ml-1.5">✕</Text>
                  </TouchableOpacity>
                ))}
            </View>
          </View>
        )}

        {/* STEP 3: Days + budget */}
        {step === 3 && (
          <View>
            <Text className="text-xl font-black text-gray-900 mb-1">3. วันและงบประมาณ</Text>
            <Text className="text-gray-500 text-[13px] mb-5">กี่วัน และงบต่อคนเท่าไหร่</Text>

            <Text className="text-gray-700 font-bold text-[13px] mb-2">จำนวนวัน</Text>
            <View className="flex-row mb-6">
              {DAY_OPTIONS.map((d) => (
                <TouchableOpacity
                  key={d}
                  onPress={() => setDays(d)}
                  className={`flex-1 py-3 rounded-xl border mr-2 items-center ${
                    days === d ? "bg-violet-600 border-violet-600" : "bg-gray-50 border-gray-200"
                  }`}
                >
                  <Text className={`font-bold text-[13px] ${days === d ? "text-white" : "text-gray-700"}`}>
                    {d} วัน
                  </Text>
                  <Text className={`text-[10px] ${days === d ? "text-white/80" : "text-gray-400"}`}>
                    {d - 1} คืน
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text className="text-gray-700 font-bold text-[13px] mb-2">งบต่อคน (บาท)</Text>
            <View className="flex-row flex-wrap">
              {BUDGET_OPTIONS.map((b) => (
                <TouchableOpacity
                  key={b}
                  onPress={() => setBudget(b)}
                  className={`py-3 px-5 rounded-xl border mr-2 mb-2 ${
                    budget === b ? "bg-violet-600 border-violet-600" : "bg-gray-50 border-gray-200"
                  }`}
                >
                  <Text className={`font-bold text-[13px] ${budget === b ? "text-white" : "text-gray-700"}`}>
                    ≤ {b.toLocaleString()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* STEP 4: Style */}
        {step === 4 && (
          <View>
            <Text className="text-xl font-black text-gray-900 mb-1">4. สไตล์การเดินทาง</Text>
            <Text className="text-gray-500 text-[13px] mb-5">เลือกแนวทริปที่ใช่สำหรับคุณ</Text>
            {TRAVEL_STYLES.map((s) => (
              <TouchableOpacity
                key={s.key}
                onPress={() => setStyle(s.key)}
                activeOpacity={0.7}
                className={`flex-row items-center p-4 rounded-2xl border mb-2.5 ${
                  style === s.key ? "bg-violet-50 border-violet-400" : "bg-gray-50 border-gray-200"
                }`}
              >
                <Text className="text-2xl mr-3">{s.emoji}</Text>
                <Text className={`flex-1 text-[14px] font-semibold ${style === s.key ? "text-violet-700" : "text-gray-700"}`}>
                  {s.label}
                </Text>
                {style === s.key && <CheckSolid size={22} color="#7C3AED" />}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Footer action */}
      <View
        className="px-5 pt-3 border-t border-gray-100"
        style={{ paddingBottom: Math.max(insets.bottom, 14) }}
      >
        {step < 4 ? (
          <TouchableOpacity
            onPress={() => canNext && setStep(step + 1)}
            disabled={!canNext}
            activeOpacity={0.85}
            className={`py-4 rounded-2xl items-center ${canNext ? "bg-violet-600" : "bg-gray-200"}`}
          >
            <Text className={`font-bold text-[15px] ${canNext ? "text-white" : "text-gray-400"}`}>ถัดไป</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleGenerate}
            disabled={generating}
            activeOpacity={0.85}
            className="py-4 rounded-2xl items-center bg-violet-600 flex-row justify-center"
          >
            {generating ? (
              <>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text className="text-white font-bold text-[15px] ml-2">AI กำลังวางแผน...</Text>
              </>
            ) : (
              <>
                <SparklesIcon size={18} color="#FFFFFF" />
                <Text className="text-white font-bold text-[15px] ml-2">สร้างแผนทริป</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
