import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  MapPinIcon,
  SparklesIcon,
  CheckBadgeIcon,
  QuestionMarkCircleIcon,
} from "react-native-heroicons/outline";
import { CheckCircleIcon as CheckSolid } from "react-native-heroicons/solid";
import { useInteractions } from "../../state/InteractionContext";
import { useAiPlanner } from "../../state/AiPlannerContext";
import { useAuth } from "../../state/AuthContext";
import { generateTrip } from "../../services/tripService";
import {
  getFolderContext,
  toTripFolderPlaces,
  type FolderContextInfo,
} from "../../services/folderContextService";
import {
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
  const { session } = useAuth();

  const folder = initialFolderId ? folders.find((f) => f.id === initialFolderId) : undefined;
  // บริบทโฟลเดอร์จริง — ชื่อสถานที่ที่ backend จับคู่กับทะเบียนได้
  const [folderCtx, setFolderCtx] = useState<FolderContextInfo | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);

  const [step, setStep] = useState(1);
  const [startPoint, setStartPoint] = useState(START_POINTS[0]);
  const [selectedPlaces, setSelectedPlaces] = useState<string[]>([]);
  const [customDest, setCustomDest] = useState("");
  const [days, setDays] = useState(3);
  const [budget, setBudget] = useState(3000);
  const [style, setStyle] = useState<TravelStyle>("nature");
  const [generating, setGenerating] = useState(false);

  // โหลดสถานที่จริงของโฟลเดอร์ แล้วเลือกไว้ให้ทั้งหมดเป็นค่าเริ่มต้น
  useEffect(() => {
    if (!initialFolderId) return;
    let cancelled = false;
    (async () => {
      setLoadingCtx(true);
      const ctx = await getFolderContext(initialFolderId, session?.access_token ?? null).catch(
        () => null
      );
      if (cancelled) return;
      setFolderCtx(ctx);
      const names = (ctx?.places ?? []).map((p) => p.name).filter(Boolean);
      if (names.length) {
        setSelectedPlaces((prev) => (prev.length ? prev : names));
      }
      setLoadingCtx(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialFolderId, session?.access_token]);

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
    try {
      const result = await generateTrip(
        {
          startPoint,
          destinations: selectedPlaces,
          days,
          nights: Math.max(0, days - 1),
          budgetPerPerson: budget,
          style,
        },
        {
          folderId: initialFolderId ?? null,
          token: session?.access_token ?? null,
        }
      );
      const trip: Trip = {
        id: `trip-${Date.now()}`,
        planId: result.planId ?? undefined,
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
        // รายการสถานที่ของโฟลเดอร์พร้อมที่มา → ให้หน้าแพลนทริปแสดงด้วย
        folderPlaces: toTripFolderPlaces(folderCtx?.places),
        createdAt: Date.now(),
      };
      addTrip(trip);
      // The offline template used to be handed over silently, so a broken AI
      // looked like a working trip. Say so before navigating away.
      if (result.source === "local-fallback") {
        Alert.alert(
          "ใช้แผนสำรองแทน",
          `${result.fallbackReason ?? "AI ไม่สำเร็จ"}\n\nแผนทริปนี้มาจากเทมเพลตในแอป ไม่ใช่ AI — ดูรายละเอียดที่ Settings → AI Diagnostics`
        );
      } else if (result.folderWarning) {
        Alert.alert("แผนทริปพร้อมแล้ว", result.folderWarning);
      }
      onCreated(trip.id);
    } finally {
      setGenerating(false);
    }
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
              {folder ? `จากสถานที่ในโฟลเดอร์ "${folder.name}" หรือเพิ่มเอง` : "เพิ่มปลายทางที่อยากไป"}
            </Text>

            {loadingCtx ? (
              <View className="flex-row items-center py-4">
                <ActivityIndicator size="small" color="#7C3AED" />
                <Text className="text-gray-500 text-[12.5px] ml-2">
                  กำลังโหลดสถานที่ในโฟลเดอร์...
                </Text>
              </View>
            ) : null}

            {(folderCtx?.places ?? []).map((p) => {
              const picked = selectedPlaces.includes(p.name);
              const confirmed = p.source === "registry";
              return (
                <TouchableOpacity
                  key={p.key}
                  onPress={() => togglePlace(p.name)}
                  activeOpacity={0.7}
                  className={`flex-row items-center p-3.5 rounded-2xl border mb-2.5 ${
                    picked ? "bg-violet-50 border-violet-400" : "bg-gray-50 border-gray-200"
                  }`}
                >
                  <View className="flex-1">
                    <Text className="text-[14px] font-semibold text-gray-800">{p.name}</Text>
                    <View className="flex-row items-center mt-1">
                      {confirmed ? (
                        <CheckBadgeIcon size={12} color="#059669" />
                      ) : (
                        <QuestionMarkCircleIcon size={12} color="#D97706" />
                      )}
                      <Text className="text-[11px] text-gray-500 ml-1">
                        {confirmed ? "ลงทะเบียนแล้ว" : "ยังไม่ยืนยัน"} · {p.clipCount} คลิป
                      </Text>
                    </View>
                  </View>
                  {picked ? <CheckSolid size={22} color="#7C3AED" /> : <CheckCircleIcon size={22} color="#D1D5DB" />}
                </TouchableOpacity>
              );
            })}

            {folder && !loadingCtx && (folderCtx?.places ?? []).length === 0 ? (
              <Text className="text-[12.5px] text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 mb-2.5">
                ยังไม่พบชื่อสถานที่ในคลิปของโฟลเดอร์นี้ — เพิ่มปลายทางเองด้านล่างได้เลย
              </Text>
            ) : null}

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
                .filter((p) => !(folderCtx?.places ?? []).some((v) => v.name === p))
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
