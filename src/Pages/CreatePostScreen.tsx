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
  PencilSquareIcon,
  CheckIcon,
  ArrowPathIcon,
  StarIcon as StarOutline,
} from "react-native-heroicons/outline";
import { StarIcon as StarSolid } from "react-native-heroicons/solid";
import { useAuth } from "../state/AuthContext";
import { uploadVideo, uploadDraftVideo } from "../services/uploadService";
import {
  suggestCaptions,
  generatePreviewSummary,
  type AiSummaryResult,
} from "../services/captionService";
import { searchPlaces } from "../data/thailandGeographicData";
import type { PlaceItem } from "../data/thailandGeographicData";
import { verifyLocationOffline, type VerifyResult } from "../services/placeVerifyService";
import { findLocalPlaces, saveVerifiedPlace, type LocalPlace } from "../services/placesLocalService";
import { verifyPlaceOnGoogle, type PlaceCandidate } from "../services/placesService";

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
  const [subdistrict, setSubdistrict] = useState("");
  const [community, setCommunity] = useState("");
  const [placeName, setPlaceName] = useState(""); // specific place (ร้าน/จุด)
  const [locationName, setLocationName] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [uploading, setUploading] = useState(false);

  // Location verification (offline + Local places store).
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [localPlaceCandidates, setLocalPlaceCandidates] = useState<LocalPlace[]>([]);
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [googleCandidates, setGoogleCandidates] = useState<PlaceCandidate[]>([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  // coordinates captured when a Google candidate is chosen
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const [captionIdeas, setCaptionIdeas] = useState<string[]>([]);
  const [captionLoading, setCaptionLoading] = useState(false);

  // --- AI summary (generated at upload time, before posting) ---
  const [summary, setSummary] = useState<AiSummaryResult | null>(null);
  const [draftVideoUrl, setDraftVideoUrl] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [accuracy, setAccuracy] = useState<number>(0); // 1–5, 0 = not rated

  const player = useVideoPlayer(videoUri ?? "", (p) => {
    p.loop = true;
    p.muted = true;
  });

  const placeResults = locationQuery.trim().length >= 1 ? searchPlaces(locationQuery) : [];

  // Generate the AI summary from the VIDEO itself (video-only, no caption).
  const runSummary = async (overrides?: { videoUrl?: string }) => {
    // Summary is produced from the VIDEO itself only (no caption/location),
    // so it can feed the caption helper as an independent source.
    const url = overrides?.videoUrl ?? draftVideoUrl;
    if (!url) return;
    setSummaryLoading(true);
    setSummaryEditing(false);
    const result = await generatePreviewSummary({
      videoUrl: url,
      audioType: "none",
      uploaderType: "tourist",
    });
    setSummary(result);
    setSummaryDraft(result?.text ?? "");
    setAccuracy(0);
    setSummaryLoading(false);

    // Verify the location the AI extracted (offline + Local places store).
    if (result?.place) await runLocationVerify(result.place);

    if (!result) {
      Alert.alert("สรุปไม่สำเร็จ", "ตอนนี้ให้ AI สรุปวิดีโอไม่ได้ ลองกดสรุปใหม่อีกครั้งได้เลย");
    }
  };

  // Verify + reconcile the AI's location against local data; never auto-pick
  // when ambiguous — surface candidates for the user to choose.
  const runLocationVerify = async (place: NonNullable<AiSummaryResult["place"]>) => {
    const aiPlaceName = place.place_name ?? null;
    const aiCommunity = place.community ?? null;
    const loc = place.location ?? ({} as any);

    const res = verifyLocationOffline({
      placeName: aiPlaceName,
      community: aiCommunity,
      subdistrict: loc.subdistrict ?? null,
      district: loc.district ?? null,
      province: loc.province ?? null,
    });
    setVerify(res);
    setLocationConfirmed(false);

    // Prefill the fields from the normalized guess (user can still change).
    const n = res.normalized;
    if (aiPlaceName) setPlaceName(aiPlaceName);
    if (n.community) setCommunity(n.community);
    if (n.subdistrict) setSubdistrict(n.subdistrict);
    if (n.district) setDistrict(n.district);
    if (n.province) setProvince(n.province);
    // locationName shown in the picker chip = specific place or community.
    const label = aiPlaceName || n.community || "";
    if (label) setLocationName(label);

    setGoogleCandidates([]);
    setCoords(null);

    // If the AI named a specific place, see if we've confirmed it before.
    if (aiPlaceName) {
      const local = await findLocalPlaces({
        name: aiPlaceName,
        province: n.province,
        district: n.district,
      });
      setLocalPlaceCandidates(local);
      // Exactly one previously-confirmed place → treat as verified.
      if (local.length === 1 && res.status !== "needs_choice") {
        applyLocalPlace(local[0]);
        return;
      }
      // Not in our store yet → look it up on Google Maps to find WHERE it is
      // (province/district/subdistrict + coordinates). User still chooses.
      if (local.length === 0) {
        void lookupOnGoogle(aiPlaceName, n.community, n.district, n.province);
      }
    } else {
      setLocalPlaceCandidates([]);
    }
  };

  const lookupOnGoogle = async (
    name: string,
    comm?: string | null,
    dist?: string | null,
    prov?: string | null
  ) => {
    setGoogleLoading(true);
    const r = await verifyPlaceOnGoogle({ placeName: name, community: comm, district: dist, province: prov });
    setGoogleCandidates(r.candidates);
    setGoogleLoading(false);
  };

  const applyGoogleCandidate = (c: PlaceCandidate) => {
    setPlaceName(c.name);
    if (c.subdistrict) setSubdistrict(c.subdistrict);
    if (c.district) setDistrict(c.district);
    if (c.province) setProvince(c.province);
    setLocationName(c.name);
    if (c.latitude != null && c.longitude != null) setCoords({ lat: c.latitude, lng: c.longitude });
    setLocationConfirmed(true);
  };

  const applyLocalPlace = (p: LocalPlace) => {
    setPlaceName(p.name);
    if (p.community) setCommunity(p.community);
    if (p.subdistrict) setSubdistrict(p.subdistrict);
    if (p.district) setDistrict(p.district);
    if (p.province) setProvince(p.province);
    setLocationName(p.name);
    setLocationConfirmed(true);
  };

  const selectPlace = (p: PlaceItem) => {
    setLocationName(p.name);
    setCommunity(p.name);
    setSubdistrict(p.subdistrict);
    setProvince(p.provinceName);
    setDistrict(p.districtName);
    setLocationQuery("");
    setCaptionIdeas([]);
    setLocationConfirmed(true);
    setVerify(null);
  };
  const clearLocation = () => {
    setLocationName("");
    setPlaceName("");
    setCommunity("");
    setSubdistrict("");
    setProvince("");
    setDistrict("");
    setLocationQuery("");
    setCaptionIdeas([]);
    setVerify(null);
    setLocalPlaceCandidates([]);
    setLocationConfirmed(false);
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
      const uri = result.assets[0].uri;
      setVideoUri(uri);
      // Upload a draft copy to Storage → get a public URL → let the backend
      // AI analyze the VIDEO directly, right after the clip is picked.
      setSummaryLoading(true);
      try {
        const { url } = await uploadDraftVideo(uri);
        setDraftVideoUrl(url);
        await runSummary({ videoUrl: url });
      } catch (e: any) {
        setSummaryLoading(false);
        Alert.alert("เตรียมวิดีโอไม่สำเร็จ", e?.message ?? "ลองเลือกวิดีโอใหม่อีกครั้ง");
      }
    }
  };

  const removeVideo = () => {
    setVideoUri(null);
    setDraftVideoUrl(null);
    setSummary(null);
    setSummaryDraft("");
    setSummaryEditing(false);
    setAccuracy(0);
  };

  const parseHashtags = (raw: string): string[] =>
    raw
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith("#") ? t : `#${t}`));

  // Save the edited summary text back into the summary object.
  const saveSummaryEdit = () => {
    setSummary((prev) => (prev ? { ...prev, text: summaryDraft.trim() } : prev));
    setSummaryEditing(false);
  };

  // "ให้ AI ช่วยคิดแคปชัน" — use the already-generated summary as context.
  const handleAiCaption = async () => {
    setCaptionLoading(true);
    setCaptionIdeas([]);
    const ideas = await suggestCaptions({
      draft: caption,
      locationName,
      province,
      district,
      hashtags: parseHashtags(hashtags),
      summaryText: summary?.text,
      highlights: summary?.highlights ?? summary?.place?.highlights,
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
      // Persist the reviewed summary text (if the user edited it in-place).
      const finalSummary: AiSummaryResult | null = summary
        ? { ...summary, text: summaryEditing ? summaryDraft.trim() : summary.text }
        : null;

      // Save the specific place to the Local `places` store (accumulates so
      // later posts resolve it for free). Only when the user confirmed one.
      if (placeName.trim() && (province.trim() || district.trim())) {
        void saveVerifiedPlace({
          name: placeName.trim(),
          community: community.trim() || null,
          subdistrict: subdistrict.trim() || null,
          district: district.trim() || null,
          province: province.trim() || null,
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
          source: coords ? "google" : "manual",
        });
      }

      await uploadVideo({
        localUri: videoUri,
        caption: caption.trim(),
        hashtags: parseHashtags(hashtags),
        locationName: locationName.trim() || undefined,
        placeName: placeName.trim() || undefined,
        community: community.trim() || undefined,
        subdistrict: subdistrict.trim() || undefined,
        province: province.trim() || undefined,
        district: district.trim() || undefined,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        aiSummary: finalSummary,
        summaryAccuracy: accuracy > 0 ? accuracy : null,
      });
      setUploading(false);
      Alert.alert("โพสต์สำเร็จ 🎉", "วิดีโอของคุณขึ้นฟีดแล้ว พร้อมสรุปจาก AI", [
        {
          text: "ตกลง",
          onPress: () => {
            removeVideo();
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

      {/* Header with cancel + title */}
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
              onPress={removeVideo}
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

        {/* AI Summary card — generated right after a clip is picked */}
        {videoUri && (
          <View className="mb-4 bg-amber-50 border border-amber-200/80 rounded-2xl p-4">
            <View className="flex-row items-center mb-2">
              <View className="w-8 h-8 rounded-full bg-amber-100 items-center justify-center mr-2">
                <SparklesIcon size={16} color="#D97706" />
              </View>
              <View className="flex-1">
                <Text className="text-gray-900 font-black text-[14px]">สรุปวิดีโอโดย AI</Text>
                <Text className="text-gray-400 text-[10px]">
                  สรุปอัตโนมัติตั้งแต่ตอนเลือกคลิป • แก้ไขได้ก่อนโพสต์
                </Text>
              </View>
              {!summaryLoading && (
                <TouchableOpacity
                  onPress={() => runSummary()}
                  activeOpacity={0.7}
                  className="w-8 h-8 rounded-full bg-white border border-amber-200 items-center justify-center"
                >
                  <ArrowPathIcon size={15} color="#D97706" />
                </TouchableOpacity>
              )}
            </View>

            {summaryLoading ? (
              <View className="py-6 items-center">
                <ActivityIndicator color="#D97706" />
                <Text className="text-amber-700/80 text-[12px] mt-2">AI กำลังสรุปวิดีโอ...</Text>
              </View>
            ) : summary ? (
              <>
                {summaryEditing ? (
                  <TextInput
                    value={summaryDraft}
                    onChangeText={setSummaryDraft}
                    multiline
                    autoFocus
                    placeholder="แก้ไขสรุปให้ตรงกับวิดีโอ..."
                    placeholderTextColor="#B45309"
                    className="bg-white border border-amber-200 rounded-xl px-3 py-2.5 text-[13.5px] text-gray-800"
                    style={{ minHeight: 90, textAlignVertical: "top" }}
                  />
                ) : (
                  <Text className="text-gray-800 text-[13.5px] leading-6">
                    {summary.text || "AI ไม่ได้ส่งเนื้อหาสรุปกลับมา"}
                  </Text>
                )}

                {/* Highlights (read-only preview) */}
                {!summaryEditing && !!(summary.highlights ?? summary.place?.highlights)?.length && (
                  <View className="mt-2.5">
                    {(summary.highlights ?? summary.place?.highlights)!.slice(0, 4).map((h, i) => (
                      <View key={i} className="flex-row mb-1">
                        <Text className="text-amber-600 mr-1.5">•</Text>
                        <Text className="text-gray-600 text-[12px] leading-5 flex-1">{h}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Edit / Save control */}
                <View className="flex-row justify-end mt-2">
                  {summaryEditing ? (
                    <TouchableOpacity
                      onPress={saveSummaryEdit}
                      activeOpacity={0.8}
                      className="flex-row items-center bg-[#2D6A4F] px-3 py-1.5 rounded-full"
                    >
                      <CheckIcon size={14} color="#FFFFFF" />
                      <Text className="text-white text-[12px] font-bold ml-1">บันทึกสรุป</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => {
                        setSummaryDraft(summary.text ?? "");
                        setSummaryEditing(true);
                      }}
                      activeOpacity={0.8}
                      className="flex-row items-center bg-white border border-amber-300 px-3 py-1.5 rounded-full"
                    >
                      <PencilSquareIcon size={14} color="#B45309" />
                      <Text className="text-amber-700 text-[12px] font-bold ml-1">แก้ไขสรุป</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Accuracy rating — feedback for improving the AI */}
                <View className="mt-3 pt-3 border-t border-amber-200/70">
                  <Text className="text-gray-600 text-[12px] mb-1.5">
                    สรุปของ AI ตรงกับวิดีโอแค่ไหน?{" "}
                    <Text className="text-gray-400">(ช่วยพัฒนา AI)</Text>
                  </Text>
                  <View className="flex-row items-center">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <TouchableOpacity
                        key={n}
                        onPress={() => setAccuracy(n)}
                        activeOpacity={0.7}
                        className="mr-1.5"
                      >
                        {n <= accuracy ? (
                          <StarSolid size={24} color="#F59E0B" />
                        ) : (
                          <StarOutline size={24} color="#D1A75A" />
                        )}
                      </TouchableOpacity>
                    ))}
                    {accuracy > 0 && (
                      <Text className="text-amber-700 text-[12px] font-semibold ml-1.5">
                        {accuracy}/5
                      </Text>
                    )}
                  </View>
                </View>
              </>
            ) : (
              <View className="py-3 items-center">
                <Text className="text-amber-700/80 text-[12px] mb-2 text-center">
                  ยังไม่มีสรุป — ลองกดสรุปอีกครั้ง
                </Text>
                <TouchableOpacity
                  onPress={() => runSummary()}
                  activeOpacity={0.8}
                  className="flex-row items-center bg-amber-500 px-3.5 py-2 rounded-full"
                >
                  <SparklesIcon size={14} color="#FFFFFF" />
                  <Text className="text-white text-[12px] font-bold ml-1">ให้ AI สรุป</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* AI location verification card */}
        {verify && !locationConfirmed && (
          <View className="mb-4 bg-blue-50 border border-blue-200 rounded-2xl p-4">
            <View className="flex-row items-center mb-2">
              <MapPinIcon size={16} color="#2563EB" />
              <Text className="text-blue-900 font-black text-[13px] ml-1.5">ตรวจสอบสถานที่จาก AI</Text>
            </View>

            {/* What the AI extracted */}
            <View className="bg-white rounded-xl p-3 mb-2">
              {placeName ? (
                <Text className="text-gray-900 font-bold text-[14px]">📍 {placeName}</Text>
              ) : null}
              <Text className="text-gray-500 text-[12px] mt-0.5">
                {[community, subdistrict && `ต.${subdistrict}`, district && `อ.${district}`, province && `จ.${province}`]
                  .filter(Boolean)
                  .join(" • ") || "ไม่พบข้อมูลสถานที่ในคลิป"}
              </Text>
            </View>

            {/* Warnings */}
            {verify.warnings.map((w, i) => (
              <Text key={i} className="text-amber-700 text-[11px] mb-1">⚠️ {w}</Text>
            ))}

            {/* Previously-confirmed places in Local (choose, don't auto-pick) */}
            {localPlaceCandidates.length > 0 && (
              <>
                <Text className="text-gray-500 text-[11px] font-bold mt-1 mb-1">สถานที่ที่ยืนยันแล้วใน Local:</Text>
                {localPlaceCandidates.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => applyLocalPlace(p)}
                    activeOpacity={0.8}
                    className="bg-white border border-emerald-200 rounded-xl px-3 py-2 mb-1.5"
                  >
                    <Text className="text-gray-900 text-[13px] font-semibold">{p.name}</Text>
                    <Text className="text-gray-400 text-[11px]">
                      {[p.district && `อ.${p.district}`, p.province && `จ.${p.province}`].filter(Boolean).join(" • ")}
                    </Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* OTOP community candidates (choose) */}
            {verify.communityCandidates.length > 0 && (
              <>
                <Text className="text-gray-500 text-[11px] font-bold mt-1 mb-1">
                  {verify.communityCandidates.length > 1 ? "พบหลายชุมชน เลือกที่ถูกต้อง:" : "ชุมชนที่ตรวจพบ:"}
                </Text>
                {verify.communityCandidates.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => selectPlace(p)}
                    activeOpacity={0.8}
                    className="bg-white border border-gray-200 rounded-xl px-3 py-2 mb-1.5"
                  >
                    <Text className="text-gray-900 text-[13px] font-semibold">{p.name}</Text>
                    <Text className="text-gray-400 text-[11px]">อ.{p.districtName} • จ.{p.provinceName}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Google Maps lookup — find WHERE a specific place is */}
            {googleLoading && (
              <View className="flex-row items-center py-2">
                <ActivityIndicator size="small" color="#2563EB" />
                <Text className="text-blue-700 text-[12px] ml-2">กำลังค้นหาใน Google Maps...</Text>
              </View>
            )}
            {googleCandidates.length > 0 && (
              <>
                <Text className="text-gray-500 text-[11px] font-bold mt-1 mb-1">
                  {googleCandidates.length > 1 ? "พบหลายที่บน Google Maps เลือกที่ถูกต้อง:" : "พบบน Google Maps:"}
                </Text>
                {googleCandidates.map((c) => (
                  <TouchableOpacity
                    key={c.placeId}
                    onPress={() => applyGoogleCandidate(c)}
                    activeOpacity={0.8}
                    className="bg-white border border-blue-200 rounded-xl px-3 py-2 mb-1.5"
                  >
                    <Text className="text-gray-900 text-[13px] font-semibold">{c.name}</Text>
                    <Text className="text-gray-400 text-[11px]" numberOfLines={1}>{c.address}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Manual Google search trigger (if auto lookup found nothing) */}
            {placeName && !googleLoading && googleCandidates.length === 0 && (
              <TouchableOpacity
                onPress={() => lookupOnGoogle(placeName, community, district, province)}
                activeOpacity={0.8}
                className="flex-row items-center justify-center bg-blue-100 rounded-xl py-2.5 mb-1 mt-1"
              >
                <MapPinIcon size={15} color="#2563EB" />
                <Text className="text-blue-700 font-bold text-[12px] ml-1.5">ค้นหาที่ตั้งใน Google Maps</Text>
              </TouchableOpacity>
            )}

            {/* Confirm the AI's reconciled location as-is, or search below */}
            <View className="flex-row mt-2">
              <TouchableOpacity
                onPress={() => setLocationConfirmed(true)}
                disabled={!locationName}
                activeOpacity={0.85}
                className={`flex-1 items-center justify-center rounded-xl py-2.5 mr-2 ${locationName ? "bg-[#2D6A4F]" : "bg-gray-200"}`}
              >
                <Text className={`font-bold text-[13px] ${locationName ? "text-white" : "text-gray-400"}`}>
                  ยืนยันสถานที่นี้
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={clearLocation}
                activeOpacity={0.85}
                className="flex-1 items-center justify-center rounded-xl py-2.5 bg-gray-100"
              >
                <Text className="text-gray-600 font-bold text-[13px]">ค้นหา/แก้เอง</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 1) Location — searchable OTOP place picker */}
        <View className="flex-row items-center mb-1.5">
          <MapPinIcon size={14} color="#EF4444" />
          <Text className="text-gray-700 font-bold text-[13px] ml-1">สถานที่ / ชุมชน</Text>
        </View>

        {verify && !locationConfirmed ? (
          // While verifying, the verification card above handles the choice.
          <Text className="text-gray-400 text-[12px] mb-4 px-1">
            ตรวจสอบสถานที่จาก AI ด้านบน หรือเลือก "ค้นหา/แก้เอง"
          </Text>
        ) : locationName ? (
          <View className="flex-row items-center bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-3 mb-4">
            <MapPinIcon size={16} color="#2D6A4F" />
            <View className="flex-1 ml-2">
              <Text className="text-[#1B4332] font-bold text-[14px]">{locationName}</Text>
              <Text className="text-gray-500 text-[12px]">
                {[subdistrict && `ต.${subdistrict}`, district && `อ.${district}`, province && `จ.${province}`]
                  .filter(Boolean)
                  .join(" • ")}
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

      {/* Post button — fixed above the safe-area bottom (bottom menu bar is
          hidden on this tab, so it's never covered). */}
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
