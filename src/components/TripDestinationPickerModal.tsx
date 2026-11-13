import React, { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Image,
  Linking,
} from "react-native";
import {
  XMarkIcon,
  FolderIcon,
  SparklesIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
} from "react-native-heroicons/outline";
import { CheckIcon } from "react-native-heroicons/solid";
import { useInteractions } from "../state/InteractionContext";
import { verifyPlaceOnGoogle, placePhotoUrl } from "../services/placesService";
import {
  suggestTripPlaces,
  fetchNearbySuggestions,
  type SuggestedPlace,
  type NearbyPlace,
  type PlanTripRequest,
} from "../services/tripService";

export type TripExtraStop = NonNullable<PlanTripRequest["extraStops"]>[number];

// รายชื่อจังหวัด 77 จังหวัดในประเทศไทย สำหรับ Autocomplete รวดเร็ว
// (export เพราะชีต "เพิ่มสถานที่ด้วย AI" ใช้รายชื่อชุดเดียวกัน)
export const THAI_PROVINCES = [
  "กรุงเทพมหานคร", "กระบี่", "กาญจนบุรี", "กาฬสินธุ์", "กำแพงเพชร",
  "ขอนแก่น", "จันทบุรี", "ฉะเชิงเทรา", "ชลบุรี", "ชัยนาท",
  "ชัยภูมิ", "ชุมพร", "เชียงราย", "เชียงใหม่", "ตรัง",
  "ตราด", "ตาก", "นครนายก", "นครปฐม", "นครพนม",
  "นครราชสีมา", "นครศรีธรรมราช", "นครสวรรค์", "นนทบุรี", "นราธิวาส",
  "น่าน", "บึงกาฬ", "บุรีรัมย์", "ปทุมธานี", "ประจวบคีรีขันธ์",
  "ปราจีนบุรี", "ปัตตานี", "พระนครศรีอยุธยา", "พะเยา", "พังงา",
  "พัทลุง", "พิจิตร", "พิษณุโลก", "เพชรบุรี", "เพชรบูรณ์",
  "แพร่", "ภูเก็ต", "มหาสารคาม", "มุกดาหาร", "แม่ฮ่องสอน",
  "ยโสธร", "ยะลา", "ร้อยเอ็ด", "ระนอง", "ระยอง",
  "ราชบุรี", "ลพบุรี", "ลำปาง", "ลำพูน", "เลย",
  "ศรีสะเกษ", "สกลนคร", "สงขลา", "สตูล", "สมุทรปราการ",
  "สมุทรสงคราม", "สมุทรสาคร", "สระแก้ว", "สระบุรี", "สิงห์บุรี",
  "สุโขทัย", "สุพรรณบุรี", "สุราษฎร์ธานี", "สุรินทร์", "หนองคาย",
  "หนองบัวลำภู", "อ่างทอง", "อำนาจเจริญ", "อุดรธานี", "อุตรดิตถ์",
  "อุทัยธานี", "อุบลราชธานี"
];

// หมวดหมู่สไตล์การท่องเที่ยว
const TRAVEL_STYLES = [
  { id: "culture", title: "วัด ประวัติศาสตร์ และวัฒนธรรม", emoji: "🏛️", desc: "โบราณสถาน วัดสำคัญ วิถีชีวิตท้องถิ่น" },
  { id: "nature", title: "ธรรมชาติ ภูเขา และวิวสวย", emoji: "🌿", desc: "จุดชมวิว อุทยานแห่งชาติ ป่าไม้ น้ำตก" },
  { id: "cafe", title: "คาเฟ่ ถ่ายรูป ชิคๆ", emoji: "☕", desc: "ร้านกาแฟบรรยากาศดี มุมถ่ายรูป จุดเช็คอินยอดฮิต" },
  { id: "food", title: "ตะลุยกิน สตรีทฟู้ด ร้านเด็ด", emoji: "🍜", desc: "ของกินขึ้นชื่อ ร้านมิชลิน ตลาดกลางคืน" },
  { id: "adventure", title: "กิจกรรมลุยๆ ผจญภัย", emoji: "🚣", desc: "เดินป่า ล่องแก่ง ขี่เอทีวี พายเรือ" },
  { id: "relax", title: "พักผ่อน สบายๆ ไม่เร่งรีบ", emoji: "🏖️", desc: "แคมป์ปิ้ง ริมน้ำ สปา วิถีสโลว์ไลฟ์" },
];

export interface TripDestinationPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectFolder: (folderId: string) => void;
  onSelectStops: (stops: TripExtraStop[]) => void;
  initialDestination?: string;
  initialStyle?: string;
  /**
   * จุดอ้างอิงสำหรับ "สถานที่ใกล้เคียง" (จุดเริ่มต้น + สถานที่ที่ผู้ใช้ติ๊กไว้)
   * → ถ้ามี จะมีปุ่ม "สถานที่ใกล้เคียง" ให้เลือก
   */
  nearbyAnchors?: { label: string; coords: { lat: number; lng: number } }[];
}

export function TripDestinationPickerModal({
  visible,
  onClose,
  onSelectFolder,
  onSelectStops,
  initialDestination = "",
  initialStyle = "",
  nearbyAnchors = [],
}: TripDestinationPickerModalProps) {
  const { folders } = useInteractions();

  // "main" | "ai_style" | "ai_results" | "nearby"
  const [step, setStep] = useState<"main" | "ai_style" | "ai_results" | "nearby">("main");

  // แท็บในหน้า main: "folder" | "search"
  const [activeTab, setActiveTab] = useState<"folder" | "search">("folder");

  // การค้นหาสถานที่/จังหวัด
  const [searchQuery, setSearchQuery] = useState("");
  const [matchedProvinces, setMatchedProvinces] = useState<string[]>([]);
  const [googlePlaces, setGooglePlaces] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedSearchPlaces, setSelectedSearchPlaces] = useState<any[]>([]);

  // ส่วนของ AI
  const [targetDestination, setTargetDestination] = useState(initialDestination);
  const [selectedStyle, setSelectedStyle] = useState(initialStyle || TRAVEL_STYLES[0].title);
  const [customStyle, setCustomStyle] = useState("");
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [suggestedPlaces, setSuggestedPlaces] = useState<SuggestedPlace[]>([]);
  const [selectedAiPlaces, setSelectedAiPlaces] = useState<string[]>([]);

  // ส่วนของ "สถานที่ใกล้เคียง"
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  const [selectedNearby, setSelectedNearby] = useState<string[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);

  // รีเซ็ตเมื่อเปิด Modal
  // หมายเหตุ: setState ต้องอยู่ใน setTimeout (กฎ react-hooks/set-state-in-effect)
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      setStep("main");
      setSearchQuery("");
      setMatchedProvinces([]);
      setGooglePlaces([]);
      setSelectedSearchPlaces([]);
      setTargetDestination(initialDestination);
      setSelectedStyle(initialStyle || TRAVEL_STYLES[0].title);
      setCustomStyle("");
      setSuggestedPlaces([]);
      setSelectedAiPlaces([]);
      setNearbyPlaces([]);
      setSelectedNearby([]);
      setNearbyError(null);
      if (folders.length === 0) {
        setActiveTab("search");
      } else {
        setActiveTab("folder");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [visible, initialDestination, initialStyle, folders.length]);

  // ค้นหาจังหวัดและ Google Places ตามคำค้นหา
  // หมายเหตุ: setState ต้องอยู่ใน setTimeout (กฎ react-hooks/set-state-in-effect)
  useEffect(() => {
    const q = searchQuery.trim();

    const syncTimer = setTimeout(() => {
      if (!q) {
        setMatchedProvinces([]);
        setGooglePlaces([]);
        return;
      }

      // กรองจังหวัด 77 จังหวัด
      const provs = THAI_PROVINCES.filter((p) => p.toLowerCase().includes(q.toLowerCase())).slice(0, 5);
      setMatchedProvinces(provs);
    }, 0);

    // ค้นหาผ่าน Google Places เมื่อพิมพ์เกิน 2 ตัวอักษร
    const timer = setTimeout(async () => {
      if (q.length >= 2) {
        setIsSearching(true);
        try {
          const res = await verifyPlaceOnGoogle({ placeName: q, strict: false });
          setGooglePlaces(res.candidates || []);
        } catch {
          setGooglePlaces([]);
        } finally {
          setIsSearching(false);
        }
      }
    }, 450);

    return () => {
      clearTimeout(syncTimer);
      clearTimeout(timer);
    };
  }, [searchQuery]);

  // เลือก/ยกเลิกเลือกสถานที่จากผลค้นหา
  const toggleSelectPlace = (place: any) => {
    const exists = selectedSearchPlaces.some((p) => (p.placeId || p.name) === (place.placeId || place.name));
    if (exists) {
      setSelectedSearchPlaces(selectedSearchPlaces.filter((p) => (p.placeId || p.name) !== (place.placeId || place.name)));
    } else {
      setSelectedSearchPlaces([...selectedSearchPlaces, place]);
    }
  };

  // ยืนยันสถานที่ที่เลือกจากการค้นหา
  const handleConfirmSearchStops = () => {
    if (selectedSearchPlaces.length === 0) return;
    const stops: TripExtraStop[] = selectedSearchPlaces.map((p) => ({
      label: p.name,
      address: p.address || null,
      coords: {
        lat: p.latitude ?? 14.3532,
        lng: p.longitude ?? 100.5684,
      },
      price: null,
      openingHours: p.openingHours || null,
      phone: p.phone || null,
      website: p.website || null,
    }));
    onSelectStops(stops);
    onClose();
  };

  // แนะนำสถานที่จาก AI
  const handleRequestAiSuggest = async () => {
    setIsLoadingAi(true);
    setStep("ai_results");
    try {
      const finalStyle = customStyle.trim() || selectedStyle;
      const finalDest = targetDestination.trim() || "พระนครศรีอยุธยา";
      const places = await suggestTripPlaces({
        destination: finalDest,
        style: finalStyle,
        count: 6,
      });
      setSuggestedPlaces(places);
      // เลือกทั้งหมดเป็นค่าเริ่มต้น เพื่อความสะดวก
      setSelectedAiPlaces(places.map((p) => p.placeId || p.name));
    } catch {
      setSuggestedPlaces([]);
    } finally {
      setIsLoadingAi(false);
    }
  };

  // ติ๊กเลือก/ไม่เลือกสถานที่ของ AI
  const toggleSelectAiPlace = (idOrName: string) => {
    if (selectedAiPlaces.includes(idOrName)) {
      setSelectedAiPlaces(selectedAiPlaces.filter((id) => id !== idOrName));
    } else {
      setSelectedAiPlaces([...selectedAiPlaces, idOrName]);
    }
  };

  // ยืนยันสถานที่จาก AI
  const handleConfirmAiStops = () => {
    const chosen = suggestedPlaces.filter((p) => selectedAiPlaces.includes(p.placeId || p.name));
    if (chosen.length === 0) return;
    const stops: TripExtraStop[] = chosen.map((p) => ({
      label: p.name,
      address: p.address || null,
      coords: {
        lat: p.latitude ?? 14.3532,
        lng: p.longitude ?? 100.5684,
      },
      price: null,
      openingHours: null,
      phone: null,
      website: null,
    }));
    onSelectStops(stops);
    onClose();
  };

  // ── สถานที่ใกล้เคียง (รอบจุดที่ผู้ใช้ติ๊ก/จุดเริ่มต้น) ────────────────────
  const handleRequestNearby = async () => {
    const anchor = nearbyAnchors[0];
    if (!anchor) return;
    setStep("nearby");
    setLoadingNearby(true);
    setNearbyError(null);
    try {
      const list = await fetchNearbySuggestions({
        near: { label: anchor.label, coords: anchor.coords },
        radiusKm: 30,
        limit: 12,
        routePoints: nearbyAnchors.map((a) => a.coords),
      });
      setNearbyPlaces(list);
      setSelectedNearby(list.map((p) => p.id));
    } catch {
      setNearbyError("หาสถานที่ไม่สำเร็จ — ต่อเน็ตใหม่แล้วลองอีกครั้ง");
      setNearbyPlaces([]);
    } finally {
      setLoadingNearby(false);
    }
  };

  const toggleNearby = (id: string) => {
    setSelectedNearby((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleConfirmNearbyStops = () => {
    const chosen = nearbyPlaces.filter((p) => selectedNearby.includes(p.id));
    if (chosen.length === 0) return;
    const stops: TripExtraStop[] = chosen.map((p) => ({
      label: p.name,
      address: p.address || null,
      coords: {
        lat: p.coordinates.lat,
        lng: p.coordinates.lng,
      },
      price: null,
      openingHours: p.openingHours ?? null,
      phone: p.phone ?? null,
      website: p.website ?? null,
    }));
    onSelectStops(stops);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-end">
        <View className="bg-white rounded-t-3xl max-h-[88%] min-h-[500px] flex-col">
          {/* Header */}
          <View className="flex-row items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
            <View className="flex-row items-center">
              {step !== "main" ? (
                <TouchableOpacity
                  onPress={() => setStep(step === "ai_results" ? "ai_style" : "main")}
                  className="mr-3 p-1 rounded-full bg-gray-100"
                >
                  <ArrowLeftIcon size={18} color="#374151" />
                </TouchableOpacity>
              ) : null}
              <Text className="text-[17px] font-bold text-gray-900">
                {step === "main"
                  ? "เลือกสถานที่สำหรับวางแผนทริป"
                  : step === "ai_style"
                  ? "สไตล์ทริปที่คุณต้องการ"
                  : step === "nearby"
                  ? "สถานที่ใกล้เคียงกับจุดที่คุณเลือก"
                  : "สถานที่ที่ AI แนะนำให้คุณ"}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} className="p-1 rounded-full bg-gray-100">
              <XMarkIcon size={20} color="#4B5563" />
            </TouchableOpacity>
          </View>

          {/* Body: Step 1 Main */}
          {step === "main" ? (
            <View className="flex-1">
              {/* ปุ่มเด่น: ให้ AI จัดทริปให้เลย */}
              <View className="p-4 pb-2">
                <TouchableOpacity
                  onPress={() => setStep("ai_style")}
                  activeOpacity={0.85}
                  className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-violet-600 rounded-2xl p-4 shadow-sm flex-row items-center justify-between"
                >
                  <View className="flex-row items-center flex-1 mr-2">
                    <View className="w-10 h-10 rounded-xl bg-white/20 items-center justify-center mr-3">
                      <SparklesIcon size={22} color="#FFFFFF" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-white font-bold text-[15px]">
                        ให้ AI คิดและจัดทริปให้เลย ✨
                      </Text>
                      <Text className="text-white/80 text-[12px] mt-0.5">
                        เลือกสไตล์ที่ชอบ แล้วระบบจะคัดสรรสถานที่ยอดนิยมให้ทันที
                      </Text>
                    </View>
                  </View>
                  <ChevronRightIcon size={18} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              <View className="flex-row items-center px-4 my-2">
                <View className="flex-1 h-[1px] bg-gray-200" />
                <Text className="mx-3 text-[12px] text-gray-400 font-medium">หรือเลือกจุดหมายเอง</Text>
                <View className="flex-1 h-[1px] bg-gray-200" />
              </View>

              {/* สถานที่ใกล้เคียงกับจุดที่ผู้ใช้ติ๊ก/จุดเริ่มต้น */}
              {nearbyAnchors.length > 0 ? (
                <View className="px-4 mb-3">
                  <TouchableOpacity
                    onPress={() => void handleRequestNearby()}
                    activeOpacity={0.85}
                    className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 flex-row items-center"
                  >
                    <View className="w-9 h-9 rounded-xl bg-white items-center justify-center mr-3">
                      <MapPinIcon size={18} color="#059669" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-[14px] font-bold text-gray-900">
                        สถานที่ใกล้เคียงกับจุดที่เลือก
                      </Text>
                      <Text className="text-[11.5px] text-gray-500 mt-0.5">
                        หารอบ {nearbyAnchors[0].label} (รัศมี 30 กม.)
                      </Text>
                    </View>
                    <ChevronRightIcon size={18} color="#059669" />
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* แท็บสลับ: เลือกจากโฟลเดอร์ vs ค้นหาสถานที่/จังหวัด */}
              <View className="flex-row px-4 mb-3">
                <TouchableOpacity
                  onPress={() => setActiveTab("folder")}
                  className={`flex-1 py-2.5 items-center rounded-xl mr-2 flex-row justify-center ${
                    activeTab === "folder" ? "bg-violet-100 border border-violet-300" : "bg-gray-100"
                  }`}
                >
                  <FolderIcon size={16} color={activeTab === "folder" ? "#7C3AED" : "#6B7280"} />
                  <Text
                    className={`ml-1.5 text-[13px] font-bold ${
                      activeTab === "folder" ? "text-violet-700" : "text-gray-600"
                    }`}
                  >
                    จากโฟลเดอร์ ({folders.length})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setActiveTab("search")}
                  className={`flex-1 py-2.5 items-center rounded-xl flex-row justify-center ${
                    activeTab === "search" ? "bg-violet-100 border border-violet-300" : "bg-gray-100"
                  }`}
                >
                  <MagnifyingGlassIcon size={16} color={activeTab === "search" ? "#7C3AED" : "#6B7280"} />
                  <Text
                    className={`ml-1.5 text-[13px] font-bold ${
                      activeTab === "search" ? "text-violet-700" : "text-gray-600"
                    }`}
                  >
                    ค้นหาจังหวัด/สถานที่
                  </Text>
                </TouchableOpacity>
              </View>

              {/* เนื้อหาตามแท็บ */}
              {activeTab === "folder" ? (
                <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 24 }}>
                  {folders.length === 0 ? (
                    <View className="items-center py-10 px-4">
                      <FolderIcon size={44} color="#D1D5DB" />
                      <Text className="text-gray-700 font-bold text-[14px] mt-3">ยังไม่มีโฟลเดอร์ที่บันทึกไว้</Text>
                      <Text className="text-gray-400 text-[12px] text-center mt-1">
                        คุณสามารถใช้แท็บ “ค้นหาจังหวัด/สถานที่” หรือกดปุ่ม “ให้ AI จัดทริปให้เลย” ด้านบนได้
                      </Text>
                    </View>
                  ) : (
                    folders.map((folder) => (
                      <TouchableOpacity
                        key={folder.id}
                        onPress={() => {
                          onSelectFolder(folder.id);
                          onClose();
                        }}
                        activeOpacity={0.7}
                        className="bg-white border border-gray-200 rounded-2xl p-3.5 mb-2.5 flex-row items-center justify-between"
                      >
                        <View className="flex-row items-center flex-1 mr-3">
                          <View className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 items-center justify-center mr-3">
                            <FolderIcon size={20} color="#D97706" />
                          </View>
                          <View className="flex-1">
                            <Text className="text-[14px] font-bold text-gray-900" numberOfLines={1}>
                              {folder.name}
                            </Text>
                            <Text className="text-[12px] text-gray-500 mt-0.5">
                              {folder.videoIds?.length || 0} คลิปสถานที่ในโฟลเดอร์
                            </Text>
                          </View>
                        </View>
                        <ChevronRightIcon size={18} color="#9CA3AF" />
                      </TouchableOpacity>
                    ))
                  )}
                </ScrollView>
              ) : (
                <View className="flex-1 px-4">
                  {/* ช่องค้นหา */}
                  <View className="flex-row items-center bg-gray-100 rounded-xl px-3.5 py-2.5 mb-3 border border-gray-200">
                    <MagnifyingGlassIcon size={18} color="#6B7280" />
                    <TextInput
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      placeholder="พิมพ์ชื่อจังหวัด หรือสถานที่ เช่น อยุธยา, เชียงใหม่"
                      placeholderTextColor="#9CA3AF"
                      className="flex-1 text-[14px] text-gray-900 ml-2 py-0"
                      autoFocus
                    />
                    {searchQuery.length > 0 ? (
                      <TouchableOpacity onPress={() => setSearchQuery("")}>
                        <XMarkIcon size={18} color="#9CA3AF" />
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 80 }}>
                    {/* ผลการจับคู่จังหวัด (Autocomplete) */}
                    {matchedProvinces.length > 0 ? (
                      <View className="mb-3">
                        <Text className="text-[12px] font-bold text-gray-500 mb-2">จังหวัดที่แนะนำ</Text>
                        <View className="flex-row flex-wrap">
                          {matchedProvinces.map((prov) => (
                            <TouchableOpacity
                              key={prov}
                              onPress={() => {
                                setTargetDestination(prov);
                                setStep("ai_style");
                              }}
                              className="bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5 mr-2 mb-2 flex-row items-center"
                            >
                              <MapPinIcon size={13} color="#059669" />
                              <Text className="text-[12.5px] font-bold text-emerald-800 ml-1">{prov}</Text>
                              <Text className="text-[11px] text-emerald-600 ml-1.5">ให้ AI แพลน →</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    ) : null}

                    {/* ผลค้นหาสถานที่จาก Google Places */}
                    {isSearching ? (
                      <View className="py-6 items-center">
                        <ActivityIndicator color="#7C3AED" />
                        <Text className="text-gray-500 text-[12px] mt-2">กำลังค้นหาสถานที่จริงจาก Google Places...</Text>
                      </View>
                    ) : googlePlaces.length > 0 ? (
                      <View>
                        <Text className="text-[12px] font-bold text-gray-500 mb-2">สถานที่ที่พบ</Text>
                        {googlePlaces.map((place, idx) => {
                          const isSelected = selectedSearchPlaces.some(
                            (p) => (p.placeId || p.name) === (place.placeId || place.name)
                          );
                          return (
                            <TouchableOpacity
                              key={`${place.placeId || place.name}-${idx}`}
                              onPress={() => toggleSelectPlace(place)}
                              className={`border rounded-2xl p-3 mb-2 flex-row items-center justify-between ${
                                isSelected ? "bg-violet-50 border-violet-400" : "bg-white border-gray-200"
                              }`}
                            >
                              <View className="flex-1 mr-3">
                                <Text className="text-[13.5px] font-bold text-gray-900" numberOfLines={1}>
                                  {place.name}
                                </Text>
                                <Text className="text-[11.5px] text-gray-500 mt-0.5" numberOfLines={2}>
                                  {place.address}
                                </Text>
                                {place.rating ? (
                                  <Text className="text-[11.5px] font-semibold text-amber-600 mt-1">
                                    ⭐ {place.rating.toFixed(1)}
                                  </Text>
                                ) : null}
                              </View>
                              <View
                                className={`w-6 h-6 rounded-full border items-center justify-center ${
                                  isSelected ? "bg-violet-600 border-violet-600" : "border-gray-300"
                                }`}
                              >
                                {isSelected ? <CheckIcon size={14} color="#FFFFFF" /> : null}
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ) : searchQuery.length >= 2 && !isSearching ? (
                      <View className="py-8 items-center">
                        <Text className="text-gray-400 text-[13px]">ไม่พบสถานที่ที่ตรงกับคำค้น</Text>
                      </View>
                    ) : (
                      <View className="py-8 items-center">
                        <Text className="text-gray-400 text-[12.5px] text-center">
                          ลองพิมพ์ชื่อจังหวัด เช่น “เชีย”, “อยุธยา” หรือชื่อสถานที่ท่องเที่ยว
                        </Text>
                      </View>
                    )}
                  </ScrollView>

                  {/* ปุ่มยืนยันการเลือกสถานที่จากค้นหา */}
                  {selectedSearchPlaces.length > 0 ? (
                    <View className="absolute bottom-4 left-4 right-4 bg-white pt-2 border-t border-gray-100">
                      <TouchableOpacity
                        onPress={handleConfirmSearchStops}
                        activeOpacity={0.85}
                        className="bg-violet-600 rounded-xl py-3.5 items-center justify-center flex-row"
                      >
                        <CheckCircleIcon size={20} color="#FFFFFF" />
                        <Text className="text-white font-bold text-[14px] ml-2">
                          ใช้นำไปคำนวณแผนทริป ({selectedSearchPlaces.length} แห่ง)
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              )}
            </View>
          ) : null}

          {/* Body: Step 2 ถามสไตล์ทริป */}
          {step === "ai_style" ? (
            <ScrollView className="flex-1 px-5 pt-3" contentContainerStyle={{ paddingBottom: 32 }}>
              <Text className="text-[13px] text-gray-500 mb-3">
                กำหนดพื้นที่และแนวทริป เพื่อให้ AI คัดเลือกสถานที่ที่ตรงใจคุณที่สุด
              </Text>

              {/* จังหวัด/จุดหมายปลายทาง */}
              <View className="mb-4">
                <Text className="text-[12.5px] font-bold text-gray-700 mb-1.5">จุดหมายปลายทาง / จังหวัด</Text>
                <View className="flex-row items-center bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5">
                  <MapPinIcon size={18} color="#7C3AED" />
                  <TextInput
                    value={targetDestination}
                    onChangeText={setTargetDestination}
                    placeholder="เช่น พระนครศรีอยุธยา, เชียงใหม่, เขาใหญ่"
                    placeholderTextColor="#9CA3AF"
                    className="flex-1 text-[14px] text-gray-900 ml-2 py-0"
                  />
                </View>
              </View>

              {/* สไตล์การท่องเที่ยว */}
              <Text className="text-[12.5px] font-bold text-gray-700 mb-2">อยากไปแนวไหนเป็นพิเศษ?</Text>
              <View className="space-y-2 mb-4">
                {TRAVEL_STYLES.map((st) => {
                  const isSelected = selectedStyle === st.title;
                  return (
                    <TouchableOpacity
                      key={st.id}
                      onPress={() => setSelectedStyle(st.title)}
                      activeOpacity={0.8}
                      className={`p-3.5 rounded-2xl border flex-row items-center justify-between ${
                        isSelected ? "bg-violet-50 border-violet-500" : "bg-white border-gray-200"
                      }`}
                    >
                      <View className="flex-row items-center flex-1 mr-3">
                        <Text className="text-[22px] mr-3">{st.emoji}</Text>
                        <View className="flex-1">
                          <Text className="text-[14px] font-bold text-gray-900">{st.title}</Text>
                          <Text className="text-[12px] text-gray-500 mt-0.5">{st.desc}</Text>
                        </View>
                      </View>
                      <View
                        className={`w-5 h-5 rounded-full border items-center justify-center ${
                          isSelected ? "bg-violet-600 border-violet-600" : "border-gray-300"
                        }`}
                      >
                        {isSelected ? <CheckIcon size={12} color="#FFFFFF" /> : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* ระบุสไตล์เพิ่มเติม */}
              <View className="mb-6">
                <Text className="text-[12px] font-bold text-gray-500 mb-1.5">หรือพิมพ์บอกสไตล์ที่คุณต้องการ</Text>
                <TextInput
                  value={customStyle}
                  onChangeText={setCustomStyle}
                  placeholder="เช่น อยากได้วัดริมน้ำ คาเฟ่วินเทจ และร้านโรตีสายไหม"
                  placeholderTextColor="#9CA3AF"
                  className="bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-[13px] text-gray-900"
                />
              </View>

              {/* ปุ่มค้นหาด้วย AI */}
              <TouchableOpacity
                onPress={handleRequestAiSuggest}
                activeOpacity={0.85}
                className="bg-violet-600 rounded-xl py-3.5 items-center justify-center flex-row shadow-sm"
              >
                <SparklesIcon size={18} color="#FFFFFF" />
                <Text className="text-white font-bold text-[14.5px] ml-2">ให้ AI ค้นหาสถานที่แนะนำ</Text>
              </TouchableOpacity>
            </ScrollView>
          ) : null}

          {/* Body: Step 3 แสดงกล่องสี่เหลี่ยมของสถานที่แนะนำจาก AI */}
          {step === "ai_results" ? (
            <View className="flex-1 px-4 pt-3">
              {isLoadingAi ? (
                <View className="flex-1 items-center justify-center py-16">
                  <ActivityIndicator size="large" color="#7C3AED" />
                  <Text className="text-gray-800 font-bold text-[15px] mt-4">
                    กำลังจัดสรรสถานที่ท่องเที่ยวให้คุณ...
                  </Text>
                  <Text className="text-gray-500 text-[12.5px] mt-1 text-center px-6">
                    ระบบกำลังดึงรูปภาพ พิกัดจริง และรีวิวจาก Google Places
                  </Text>
                </View>
              ) : suggestedPlaces.length === 0 ? (
                <View className="flex-1 items-center justify-center py-16">
                  <Text className="text-gray-700 font-bold text-[14px]">ไม่พบสถานที่แนะนำ</Text>
                  <TouchableOpacity
                    onPress={() => setStep("ai_style")}
                    className="mt-4 bg-gray-100 rounded-xl px-4 py-2"
                  >
                    <Text className="text-violet-700 font-bold text-[13px]">← ลองเปลี่ยนพื้นที่หรือสไตล์</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View className="flex-1">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-[12.5px] text-gray-500">
                      แตะที่กล่องเพื่อเลือก หรือเปิดลิงก์ Google Maps เพื่อดูแผนที่
                    </Text>
                    <TouchableOpacity
                      onPress={() => {
                        if (selectedAiPlaces.length === suggestedPlaces.length) {
                          setSelectedAiPlaces([]);
                        } else {
                          setSelectedAiPlaces(suggestedPlaces.map((p) => p.placeId || p.name));
                        }
                      }}
                    >
                      <Text className="text-[12px] font-bold text-violet-700">
                        {selectedAiPlaces.length === suggestedPlaces.length ? "ล้างทั้งหมด" : "เลือกทั้งหมด"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 90 }}>
                    {suggestedPlaces.map((place, idx) => {
                      const idKey = place.placeId || place.name;
                      const isSelected = selectedAiPlaces.includes(idKey);
                      const imgUrl = placePhotoUrl(place.photoUrl);

                      return (
                        <TouchableOpacity
                          key={`${idKey}-${idx}`}
                          onPress={() => toggleSelectAiPlace(idKey)}
                          activeOpacity={0.88}
                          className={`mb-3.5 rounded-2xl border overflow-hidden bg-white shadow-xs ${
                            isSelected ? "border-violet-500 ring-2 ring-violet-200" : "border-gray-200"
                          }`}
                        >
                          {/* ภาพประกอบ */}
                          {imgUrl ? (
                            <Image
                              source={{ uri: imgUrl }}
                              className="w-full h-36 bg-gray-100"
                              resizeMode="cover"
                            />
                          ) : (
                            <View className="w-full h-24 bg-gray-100 items-center justify-center">
                              <MapPinIcon size={28} color="#9CA3AF" />
                              <Text className="text-gray-400 text-[11px] mt-1">{place.name}</Text>
                            </View>
                          )}

                          {/* รายละเอียดสถานที่ */}
                          <View className="p-3.5">
                            <View className="flex-row items-start justify-between">
                              <View className="flex-1 mr-2">
                                <Text className="text-[15px] font-bold text-gray-900" numberOfLines={1}>
                                  {place.name}
                                </Text>
                                {place.address ? (
                                  <Text className="text-[11.5px] text-gray-500 mt-0.5" numberOfLines={1}>
                                    {place.address}
                                  </Text>
                                ) : null}
                              </View>

                              {/* ปุ่ม Checkbox */}
                              <View
                                className={`w-6 h-6 rounded-full border items-center justify-center ${
                                  isSelected ? "bg-violet-600 border-violet-600" : "border-gray-300"
                                }`}
                              >
                                {isSelected ? <CheckIcon size={14} color="#FFFFFF" /> : null}
                              </View>
                            </View>

                            {/* คำบรรยายสถานที่ */}
                            {place.description ? (
                              <Text className="text-[12.5px] text-gray-700 leading-5 mt-2">
                                {place.description}
                              </Text>
                            ) : null}

                            {/* ดาวรีวิว และ ลิงก์ Google Maps */}
                            <View className="flex-row items-center justify-between mt-3 pt-2.5 border-t border-gray-100">
                              <View className="flex-row items-center">
                                {place.rating ? (
                                  <Text className="text-[12px] font-bold text-amber-600">
                                    ⭐ {place.rating.toFixed(1)}
                                    {place.userRatingCount ? ` (${place.userRatingCount})` : ""}
                                  </Text>
                                ) : (
                                  <Text className="text-[11.5px] text-gray-400">สถานที่ท่องเที่ยวแนะนำ</Text>
                                )}
                              </View>

                              {place.googleMapsUri ? (
                                <TouchableOpacity
                                  onPress={() => {
                                    if (place.googleMapsUri) {
                                      Linking.openURL(place.googleMapsUri).catch(() => {});
                                    }
                                  }}
                                  activeOpacity={0.7}
                                  className="flex-row items-center bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200"
                                >
                                  <Text className="text-[11px] font-bold text-blue-700 mr-1">Google Maps</Text>
                                  <ArrowTopRightOnSquareIcon size={12} color="#1D4ED8" />
                                </TouchableOpacity>
                              ) : null}
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {/* แถบกดยืนยันด้านล่าง */}
                  <View className="absolute bottom-4 left-4 right-4 bg-white pt-2 border-t border-gray-100">
                    <TouchableOpacity
                      onPress={handleConfirmAiStops}
                      disabled={selectedAiPlaces.length === 0}
                      activeOpacity={0.85}
                      className={`rounded-xl py-3.5 items-center justify-center flex-row shadow-sm ${
                        selectedAiPlaces.length > 0 ? "bg-violet-600" : "bg-gray-300"
                      }`}
                    >
                      <SparklesIcon size={18} color="#FFFFFF" />
                      <Text className="text-white font-bold text-[14px] ml-2">
                        นำ {selectedAiPlaces.length} สถานที่นี้ไปสร้างแผนทริป
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ) : null}

          {/* Body: Step "ใกล้เคียง" — สถานที่รอบจุดที่ผู้ใช้ติ๊ก/จุดเริ่มต้น */}
          {step === "nearby" ? (
            <View className="flex-1 px-4 pt-3">
              {loadingNearby ? (
                <View className="flex-1 items-center justify-center py-16">
                  <ActivityIndicator size="large" color="#059669" />
                  <Text className="text-gray-800 font-bold text-[15px] mt-4">
                    กำลังหาสถานที่ใกล้เคียง...
                  </Text>
                  <Text className="text-gray-500 text-[12.5px] mt-1 text-center px-6">
                    ระบบกำลังดูรอบจุดที่คุณเลือก
                  </Text>
                </View>
              ) : nearbyPlaces.length === 0 ? (
                <View className="flex-1 items-center justify-center py-16">
                  <Text className="text-gray-700 font-bold text-[14px]">
                    ไม่พบสถานที่ใกล้เคียง
                  </Text>
                  {nearbyError ? (
                    <Text className="text-gray-500 text-[12.5px] mt-2 text-center px-6">
                      {nearbyError}
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => setStep("main")}
                    className="mt-4 bg-gray-100 rounded-xl px-4 py-2"
                  >
                    <Text className="text-violet-700 font-bold text-[13px]">← กลับไปเลือกวิธีอื่น</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View className="flex-1">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-[12.5px] text-gray-500">
                      แตะที่กล่องเพื่อเลือก ({selectedNearby.length}/{nearbyPlaces.length})
                    </Text>
                    <TouchableOpacity
                      onPress={() =>
                        setSelectedNearby(
                          selectedNearby.length === nearbyPlaces.length
                            ? []
                            : nearbyPlaces.map((p) => p.id)
                        )
                      }
                    >
                      <Text className="text-[12px] font-bold text-violet-700">
                        {selectedNearby.length === nearbyPlaces.length
                          ? "ล้างทั้งหมด"
                          : "เลือกทั้งหมด"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 90 }}>
                    {nearbyPlaces.map((p) => {
                      const isSelected = selectedNearby.includes(p.id);
                      return (
                        <TouchableOpacity
                          key={p.id}
                          onPress={() => toggleNearby(p.id)}
                          activeOpacity={0.85}
                          className={`mb-2.5 rounded-2xl border p-3.5 flex-row items-center ${
                            isSelected
                              ? "bg-emerald-50 border-emerald-400"
                              : "bg-white border-gray-200"
                          }`}
                        >
                          <View className="flex-1 mr-3">
                            <Text className="text-[14px] font-bold text-gray-900" numberOfLines={1}>
                              {p.name}
                            </Text>
                            {p.address ? (
                              <Text className="text-[11.5px] text-gray-500 mt-0.5" numberOfLines={2}>
                                {p.address}
                              </Text>
                            ) : null}
                            <View className="flex-row items-center flex-wrap mt-1.5">
                              {p.distanceKm != null ? (
                                <View className="bg-white rounded-full px-2 py-0.5 mr-1.5 border border-gray-200">
                                  <Text className="text-[10.5px] text-gray-600">
                                    {p.distanceKm.toFixed(1)} กม.
                                  </Text>
                                </View>
                              ) : null}
                              {p.province ? (
                                <View className="bg-emerald-50 rounded-full px-2 py-0.5 mr-1.5">
                                  <Text className="text-[10.5px] font-bold text-emerald-700">
                                    {p.province}
                                  </Text>
                                </View>
                              ) : null}
                              {p.rating ? (
                                <Text className="text-[10.5px] font-bold text-amber-600">
                                  ⭐ {p.rating.toFixed(1)}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                          <View
                            className={`w-6 h-6 rounded-full border items-center justify-center ${
                              isSelected
                                ? "bg-emerald-600 border-emerald-600"
                                : "border-gray-300"
                            }`}
                          >
                            {isSelected ? <CheckIcon size={13} color="#FFFFFF" /> : null}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <View className="absolute bottom-4 left-4 right-4 bg-white pt-2 border-t border-gray-100">
                    <TouchableOpacity
                      onPress={handleConfirmNearbyStops}
                      disabled={selectedNearby.length === 0}
                      activeOpacity={0.85}
                      className={`rounded-xl py-3.5 items-center justify-center flex-row shadow-sm ${
                        selectedNearby.length > 0 ? "bg-emerald-600" : "bg-gray-300"
                      }`}
                    >
                      <CheckCircleIcon size={20} color="#FFFFFF" />
                      <Text className="text-white font-bold text-[14px] ml-2">
                        ใช้นำไปคำนวณแผนทริป ({selectedNearby.length} แห่ง)
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
