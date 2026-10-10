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
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
import * as ImagePicker from "expo-image-picker";
import {
  VideoCameraIcon,
  MapPinIcon,
  HashtagIcon,
  PaperAirplaneIcon,
  XMarkIcon,
  SparklesIcon,
} from "react-native-heroicons/outline";
import { useAuth } from "../state/AuthContext";
import { uploadVideo } from "../services/uploadService";
import { suggestCaptions, previewSummary } from "../services/captionService";
import { searchPlaces } from "../data/thailandGeographicData";
import type { PlaceItem } from "../data/thailandGeographicData";

interface CreatePostScreenProps {
  /** Called after a successful upload (host refreshes feed / switches tab). */
  onPosted?: () => void;
  /** Go back / cancel. */
  onCancel?: () => void;
}

export default function CreatePostScreen({ onPosted, onCancel }: CreatePostScreenProps) {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [uploading, setUploading] = useState(false);

  const [captionIdeas, setCaptionIdeas] = useState<string[]>([]);
  const [captionLoading, setCaptionLoading] = useState(false);

  const player = useVideoPlayer(videoUri ?? "", (p) => {
    p.loop = true;
    p.muted = true;
  });

  const placeResults = locationQuery.trim().length >= 1 ? searchPlaces(locationQuery) : [];

  const selectPlace = (p: PlaceItem) => {
    setLocationName(p.name);
    setProvince(p.provinceName);
    setDistrict(p.districtName);
    setLocationQuery("");
    setCaptionIdeas([]);
  };
  const clearLocation = () => {
    setLocationName("");
    setProvince("");
    setDistrict("");
    setLocationQuery("");
    setCaptionIdeas([]);
  };

  const pickVideo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("ต้องการสิทธิ์เข้าถึงคลังวิดีโอ", "โปรดอนุญาตให้แอปเข้าถึงคลังสื่อเพื่อเลือกวิดีโอ");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      quality: 1,
      videoMaxDuration: 120,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setVideoUri(result.assets[0].uri);
    }
  };

  const parseHashtags = (raw: string): string[] =>
    raw
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith("#") ? t : `#${t}`));

  // "ให้ AI ช่วยคิดแคปชัน" — ดึงสรุปจากสถานที่ แล้วให้ AI คิดแคปชัน
  const handleAiCaption = async () => {
    setCaptionLoading(true);
    setCaptionIdeas([]);
    const place = [locationName, district, province].filter(Boolean).join(" ");
    const summary = place ? await previewSummary(place) : null;
    const ideas = await suggestCaptions({
      draft: caption,
      locationName,
      province,
      district,
      hashtags: parseHashtags(hashtags),
      summaryText: summary?.text,
      highlights: summary?.highlights,
    });
    setCaptionIdeas(ideas);
    setCaptionLoading(false);
    if (ideas.length === 0) {
      Alert.alert("ขออภัย", "ตอนนี้ขอแคปชันจาก AI ไม่สำเร็จ ลองใหม่อีกครั้งนะคะ");
    }
  };

  const handlePost = async () => {
    if (!videoUri) {
      Alert.alert("ยังไม่ได้เลือกวิดีโอ", "กรุณาเลือกวิดีโอก่อนโพสต์");
      return;
    }
    setUploading(true);
    try {
      await uploadVideo({
        localUri: videoUri,
        caption: caption.trim(),
        hashtags: parseHashtags(hashtags),
        locationName: locationName.trim() || undefined,
        province: province.trim() || undefined,
        district: district.trim() || undefined,
      });
      setUploading(false);
      Alert.alert("โพสต์สำเร็จ 🎉", "วิดีโอของคุณขึ้นฟีดแล้ว AI กำลังสรุปให้อัตโนมัติ", [
        {
          text: "ตกลง",
          onPress: () => {
            setVideoUri(null);
            setCaption("");
            setHashtags("");
            clearLocation();
            onPosted?.();
          },
        },
      ]);
    } catch (e: any) {
      setUploading(false);
      Alert.alert("โพสต์ไม่สำเร็จ", e?.message ?? "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");
    }
  };

  if (!session) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-10" style={{ paddingTop: insets.top }}>
        <VideoCameraIcon size={44} color="#D1D5DB" />
        <Text className="text-gray-500 text-center mt-3 leading-6">
          กรุณาเข้าสู่ระบบก่อน จึงจะโพสต์วิดีโอได้
        </Text>
      </View>
    );
  }

  const canPost = !!videoUri && !uploading;

  return (
    <View className="flex-1 bg-white">
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header with cancel + inline post action */}
      <View
        style={{ paddingTop: Math.max(insets.top, 16) + (Platform.OS === "android" ? 8 : 4) }}
        className="px-4 pb-3 flex-row items-center justify-between border-b border-gray-100"
      >
        <TouchableOpacity onPress={onCancel} className="p-1">
          <XMarkIcon size={24} color="#18181B" />
        </TouchableOpacity>
        <Text className="text-[17px] font-black text-gray-900">สร้างโพสต์</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 18, paddingBottom: 40 }}
      >
        {/* Video picker / preview */}
        {videoUri ? (
          <View className="rounded-2xl overflow-hidden bg-black mb-4" style={{ height: 300 }}>
            <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={false} />
            <TouchableOpacity
              onPress={() => setVideoUri(null)}
              className="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/60 items-center justify-center"
            >
              <XMarkIcon size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={pickVideo}
            activeOpacity={0.8}
            className="rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 items-center justify-center mb-4"
            style={{ height: 200 }}
          >
            <VideoCameraIcon size={40} color="#9CA3AF" />
            <Text className="text-gray-500 font-semibold mt-2">แตะเพื่อเลือกวิดีโอจากคลัง</Text>
            <Text className="text-gray-400 text-[12px] mt-1">ความยาวไม่เกิน 2 นาที</Text>
          </TouchableOpacity>
        )}

        {/* 1) Location — searchable OTOP place picker (shown first) */}
        <View className="flex-row items-center mb-1.5">
          <MapPinIcon size={14} color="#EF4444" />
          <Text className="text-gray-700 font-bold text-[13px] ml-1">สถานที่ / ชุมชน</Text>
        </View>

        {locationName ? (
          <View className="flex-row items-center bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-3 mb-4">
            <MapPinIcon size={16} color="#2D6A4F" />
            <View className="flex-1 ml-2">
              <Text className="text-[#1B4332] font-bold text-[14px]">{locationName}</Text>
              <Text className="text-gray-500 text-[12px]">
                {district} • {province}
              </Text>
            </View>
            <TouchableOpacity onPress={clearLocation} className="p-1">
              <XMarkIcon size={18} color="#6B7280" />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TextInput
              value={locationQuery}
              onChangeText={setLocationQuery}
              placeholder="ค้นหาชุมชน OTOP เช่น ห้วยห้อม, เชียงใหม่..."
              placeholderTextColor="#9CA3AF"
              className="bg-gray-100 rounded-xl px-3.5 py-3 text-[14px] text-gray-900 mb-2"
            />
            {placeResults.length > 0 && (
              <View className="bg-white border border-gray-200 rounded-xl mb-4 overflow-hidden">
                {placeResults.slice(0, 8).map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => selectPlace(p)}
                    activeOpacity={0.7}
                    className="px-3.5 py-2.5 border-b border-gray-100"
                  >
                    <Text className="text-gray-900 text-[14px] font-semibold">{p.name}</Text>
                    <Text className="text-gray-400 text-[12px]">
                      อ.{p.districtName} • จ.{p.provinceName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {locationQuery.trim().length >= 1 && placeResults.length === 0 && (
              <Text className="text-gray-400 text-[12px] mb-4 px-1">ไม่พบชุมชนที่ค้นหา</Text>
            )}
          </>
        )}

        {/* 2) Caption (optional) + AI helper */}
        <View className="flex-row items-center justify-between mb-1.5">
          <Text className="text-gray-700 font-bold text-[13px]">
            คำบรรยาย <Text className="text-gray-400 font-normal">(ไม่บังคับ)</Text>
          </Text>
          <TouchableOpacity
            onPress={handleAiCaption}
            disabled={captionLoading}
            activeOpacity={0.8}
            className="flex-row items-center bg-violet-100 px-2.5 py-1.5 rounded-full"
          >
            {captionLoading ? (
              <ActivityIndicator size="small" color="#7C3AED" />
            ) : (
              <SparklesIcon size={14} color="#7C3AED" />
            )}
            <Text className="text-violet-700 text-[12px] font-bold ml-1">ให้ AI ช่วยคิด</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          value={caption}
          onChangeText={setCaption}
          placeholder="เล่าเรื่องราวของคลิปนี้..."
          placeholderTextColor="#9CA3AF"
          multiline
          className="bg-gray-100 rounded-xl px-3.5 py-3 text-[14px] text-gray-900 mb-2"
          style={{ minHeight: 76, textAlignVertical: "top" }}
        />

        {/* AI caption suggestions */}
        {captionIdeas.length > 0 && (
          <View className="mb-4">
            <Text className="text-gray-400 text-[11px] mb-1.5">แตะเพื่อใช้แคปชันนี้:</Text>
            {captionIdeas.map((idea, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => setCaption(idea)}
                activeOpacity={0.75}
                className="bg-violet-50 border border-violet-200 rounded-xl px-3.5 py-2.5 mb-2"
              >
                <Text className="text-gray-800 text-[13px] leading-5">{idea}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 3) Hashtags (optional) */}
        <View className="flex-row items-center mb-1.5">
          <HashtagIcon size={14} color="#2D6A4F" />
          <Text className="text-gray-700 font-bold text-[13px] ml-1">
            แฮชแท็ก <Text className="text-gray-400 font-normal">(ไม่บังคับ)</Text>
          </Text>
        </View>
        <TextInput
          value={hashtags}
          onChangeText={setHashtags}
          placeholder="เช่น เชียงใหม่ OTOP ชุมชน (เว้นวรรคคั่น)"
          placeholderTextColor="#9CA3AF"
          className="bg-gray-100 rounded-xl px-3.5 py-3 text-[14px] text-gray-900 mb-4"
        />
      </ScrollView>

      {/* Post button — fixed above the safe-area bottom (NOT covered by menu;
          the bottom menu bar is hidden on this tab). */}
      <View
        className="px-5 pt-3 border-t border-gray-100 bg-white"
        style={{ paddingBottom: Math.max(insets.bottom, 14) }}
      >
        <TouchableOpacity
          onPress={handlePost}
          disabled={!canPost}
          activeOpacity={0.85}
          className={`py-4 rounded-2xl flex-row items-center justify-center ${
            canPost ? "bg-[#2D6A4F]" : "bg-gray-200"
          }`}
        >
          {uploading ? (
            <>
              <ActivityIndicator color="#FFFFFF" />
              <Text className="text-white font-bold text-[15px] ml-2">กำลังอัปโหลด...</Text>
            </>
          ) : (
            <>
              <PaperAirplaneIcon size={18} color={videoUri ? "#FFFFFF" : "#9CA3AF"} />
              <Text className={`font-bold text-[15px] ml-2 ${videoUri ? "text-white" : "text-gray-400"}`}>
                โพสต์ลงฟีด
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
