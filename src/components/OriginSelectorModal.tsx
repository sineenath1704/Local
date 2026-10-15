import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import {
  XMarkIcon,
  MapPinIcon,
  HomeIcon,
  BuildingOfficeIcon,
  LinkIcon,
  BookmarkSquareIcon,
  CheckIcon,
  PlusIcon,
} from "react-native-heroicons/outline";
import {
  getSavedPlaces,
  saveUserPlace,
  resolveGoogleMapsUrl,
  UserSavedPlace,
} from "../services/savedPlacesService";

interface OriginSelectorModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectOrigin: (origin: { label: string; address: string; url?: string; coords?: { lat: number; lng: number } }) => void;
  onOpenMapPicker?: () => void;
}

export default function OriginSelectorModal({
  visible,
  onClose,
  onSelectOrigin,
  onOpenMapPicker,
}: OriginSelectorModalProps) {
  const [savedList, setSavedList] = useState<UserSavedPlace[]>([]);
  const [loading, setLoading] = useState(false);

  // Manual input state
  const [placeLabel, setPlaceLabel] = useState("บ้าน");
  const [inputAddress, setInputAddress] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [saveAsFav, setSaveAsFav] = useState(false);
  const [savingFav, setSavingFav] = useState(false);

  useEffect(() => {
    if (visible) {
      loadSaved();
    }
  }, [visible]);

  const loadSaved = async () => {
    setLoading(true);
    const list = await getSavedPlaces();
    setSavedList(list);
    setLoading(false);
  };

  const handleConfirmInput = async () => {
    const addr = inputAddress.trim();
    const url = mapsUrl.trim();

    if (!addr && !url) {
      Alert.alert("โปรดระบุข้อมูล", "กรุณาระบุที่อยู่หรือวางลิงก์ Google Maps");
      return;
    }

    setSavingFav(true);
    const parsed = await resolveGoogleMapsUrl(url);
    const placeTitle = parsed.placeName || placeLabel || "จุดเริ่มต้น";
    const displayAddress = addr
      ? addr
      : parsed.placeName
      ? `${parsed.placeName} (พิกัด: ${parsed.lat?.toFixed(4)}, ${parsed.lng?.toFixed(4)})`
      : parsed.lat && parsed.lng
      ? `พิกัด (${parsed.lat.toFixed(4)}, ${parsed.lng.toFixed(4)})`
      : url;

    if (saveAsFav) {
      await saveUserPlace({
        label: placeTitle,
        address_text: displayAddress,
        google_maps_url: url || undefined,
        lat: parsed.lat,
        lng: parsed.lng,
      });
    }
    setSavingFav(false);

    onSelectOrigin({
      label: placeTitle,
      address: displayAddress,
      url: url || undefined,
      coords: parsed.lat && parsed.lng ? { lat: parsed.lat, lng: parsed.lng } : undefined,
    });
    onClose();
  };

  const handlePickSaved = (item: UserSavedPlace) => {
    onSelectOrigin({
      label: item.label,
      address: item.address_text,
      url: item.google_maps_url,
      coords: item.lat && item.lng ? { lat: item.lat, lng: item.lng } : undefined,
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View className="bg-white rounded-t-3xl p-5 max-h-[85%]">
          {/* Header */}
          <View className="flex-row items-center justify-between pb-3 border-b border-gray-100">
            <View>
              <Text className="text-[17px] font-black text-gray-900">เลือกจุดเริ่มต้นการเดินทาง</Text>
              <Text className="text-[12px] text-gray-400">ระบุตำแหน่งบ้าน หอพัก หรือวางลิงก์ Google Maps</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="p-1.5 bg-gray-100 rounded-full">
              <XMarkIcon size={20} color="#4B5563" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} className="mt-3">
            {/* Saved favorite chips */}
            <Text className="text-[13px] font-bold text-gray-700 mb-2">ที่อยู่ประจำที่บันทึกไว้</Text>
            {loading ? (
              <ActivityIndicator size="small" color="#7C3AED" className="my-2" />
            ) : savedList.length > 0 ? (
              <View className="flex-row flex-wrap gap-2 mb-4">
                {savedList.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => handlePickSaved(item)}
                    activeOpacity={0.7}
                    className="flex-row items-center bg-violet-50 border border-violet-200 px-3.5 py-2 rounded-xl"
                  >
                    {item.label === "บ้าน" ? (
                      <HomeIcon size={16} color="#7C3AED" />
                    ) : item.label === "หอพัก" ? (
                      <BuildingOfficeIcon size={16} color="#7C3AED" />
                    ) : (
                      <MapPinIcon size={16} color="#7C3AED" />
                    )}
                    <View className="ml-2">
                      <Text className="text-[13px] font-bold text-violet-900">{item.label}</Text>
                      <Text className="text-[11px] text-violet-600" numberOfLines={1}>{item.address_text}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text className="text-[12px] text-gray-400 mb-3">ยังไม่มีที่อยู่ที่บันทึกไว้</Text>
            )}

            {/* Choose on App Map */}
            {onOpenMapPicker && (
              <TouchableOpacity
                onPress={() => {
                  onClose();
                  onOpenMapPicker();
                }}
                activeOpacity={0.8}
                className="flex-row items-center justify-between bg-emerald-50 border border-emerald-200 p-3.5 rounded-2xl mb-4"
              >
                <View className="flex-row items-center flex-1 mr-2">
                  <MapPinIcon size={20} color="#059669" />
                  <View className="ml-2.5">
                    <Text className="text-[13.5px] font-bold text-emerald-950">เลือกตำแหน่งจากแผนที่ในแอป</Text>
                    <Text className="text-[11px] text-emerald-700">จิ้มเลือกจังหวัดหรือชุมชนเริ่มต้นบนแผนที่</Text>
                  </View>
                </View>
                <Text className="text-emerald-700 font-bold text-[12px]">เปิดแผนที่ →</Text>
              </TouchableOpacity>
            )}

            {/* Manual Form / Google Maps link */}
            <View className="bg-gray-50 border border-gray-200 rounded-2xl p-4 mb-3">
              <Text className="text-[13.5px] font-black text-gray-900 mb-2">กำหนดจุดเริ่มต้นใหม่</Text>

              {/* Tag choice */}
              <View className="flex-row gap-2 mb-3">
                {["บ้าน", "หอพัก", "ที่ทำงาน", "จุดนัดพบ"].map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    onPress={() => setPlaceLabel(tag)}
                    className={`px-3 py-1.5 rounded-lg border ${placeLabel === tag ? "bg-violet-600 border-violet-600" : "bg-white border-gray-200"}`}
                  >
                    <Text className={`text-[12px] font-bold ${placeLabel === tag ? "text-white" : "text-gray-700"}`}>{tag}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Address input */}
              <Text className="text-[12px] font-semibold text-gray-700 mb-1">ชื่อสถานที่ / ที่อยู่เริ่มต้น</Text>
              <TextInput
                value={inputAddress}
                onChangeText={setInputAddress}
                placeholder="เช่น คอนโดเดอะเบส อ่อนนุช, บ้านเลขที่ 123..."
                placeholderTextColor="#9CA3AF"
                className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-[13px] text-gray-900 mb-2.5"
              />

              {/* Google Maps link input */}
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-[12px] font-semibold text-gray-700">วางลิงก์ Google Maps (ถ้ามี)</Text>
                <LinkIcon size={14} color="#7C3AED" />
              </View>
              <TextInput
                value={mapsUrl}
                onChangeText={setMapsUrl}
                placeholder="วางลิงก์ https://maps.app.goo.gl/... หรือ maps.google..."
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-gray-900 mb-3"
              />

              {/* Checkbox: Save to Favorites */}
              <TouchableOpacity
                onPress={() => setSaveAsFav(!saveAsFav)}
                activeOpacity={0.8}
                className="flex-row items-center mb-1"
              >
                <View className={`w-5 h-5 rounded-md border items-center justify-center mr-2 ${saveAsFav ? "bg-violet-600 border-violet-600" : "bg-white border-gray-300"}`}>
                  {saveAsFav && <CheckIcon size={13} color="#FFFFFF" strokeWidth={3} />}
                </View>
                <Text className="text-[12.5px] text-gray-700 font-medium">บันทึกเป็นที่อยู่ประจำสำหรับครั้งต่อไป</Text>
              </TouchableOpacity>
            </View>

            {/* Submit button */}
            <TouchableOpacity
              onPress={handleConfirmInput}
              disabled={savingFav}
              activeOpacity={0.85}
              className="bg-violet-600 rounded-2xl py-3.5 items-center justify-center mb-6 shadow-md shadow-violet-200"
            >
              {savingFav ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text className="text-white text-[14px] font-bold">ใช้จุดเริ่มต้นนี้ 🚗</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
