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

export interface InitialPostLocation {
  placeName?: string;
  community?: string;
  province?: string;
  district?: string;
  subdistrict?: string;
  coords?: { lat: number; lng: number };
}

interface CreatePostScreenProps {
  /** Called after a successful upload (host refreshes feed / switches tab). */
  onPosted?: () => void;
  /** Go back / cancel. */
  onCancel?: () => void;
  /** Prefilled location from a completed trip stop */
  initialLocation?: InitialPostLocation;
}

export default function CreatePostScreen({ onPosted, onCancel, initialLocation }: CreatePostScreenProps) {
  const insets = useSafeAreaInsets();
  const { session, user } = useAuth();

  // Pre-fill location for OTOP hosts from their verified business profile.
  const isHost = user?.role === "host" && Boolean(user?.otop_verified);
  const hostBusinessName = user?.business_place_name || user?.otop_village || user?.otop_nawatwithi || "";
  const hostLocation = isHost ? {
    locationName: hostBusinessName,
    placeName: hostBusinessName,
    community: user?.otop_village || "",
    subdistrict: user?.business_subdistrict || user?.otop_tambol || "",
    district: user?.business_district || user?.otop_amphur || "",
    province: user?.business_province || user?.otop_province || "",
    lat: user?.business_lat ?? null,
    lng: user?.business_lng ?? null,
  } : null;

  // Host mode: "own_business" (locked to own shop) or "community_spot" (within own tambol/village)
  const [hostPostMode, setHostPostMode] = useState<"own_business" | "community_spot">("own_business");

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [province, setProvince] = useState(hostLocation?.province || initialLocation?.province || "");
  const [district, setDistrict] = useState(hostLocation?.district || initialLocation?.district || "");
  const [subdistrict, setSubdistrict] = useState(hostLocation?.subdistrict || initialLocation?.subdistrict || "");
  const [community, setCommunity] = useState(hostLocation?.community || initialLocation?.community || "");
  const [placeName, setPlaceName] = useState(hostLocation?.placeName || initialLocation?.placeName || "");
  const [locationName, setLocationName] = useState(
    hostLocation?.locationName || initialLocation?.placeName || initialLocation?.community || ""
  );
  const [locationQuery, setLocationQuery] = useState(
    initialLocation?.placeName || initialLocation?.community || ""
  );
  // Host location is pre-confirmed (from OTOP profile), tourist needs to verify.
  const [locationConfirmedInit] = useState(isHost && !!hostLocation?.province);
  const [locationSource, setLocationSource] = useState<"otop" | "ai" | "manual">(
    isHost && hostLocation ? "otop" : "manual"
  );
  const [uploading, setUploading] = useState(false);

  // Location verification (offline + Local places store).
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [localPlaceCandidates, setLocalPlaceCandidates] = useState<LocalPlace[]>([]);
  const [locationConfirmed, setLocationConfirmed] = useState(locationConfirmedInit);
  const [googleCandidates, setGoogleCandidates] = useState<PlaceCandidate[]>([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  // Single Google result pending confirmation (with editable fields).
  const [pendingConfirm, setPendingConfirm] = useState<PlaceCandidate | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [pendingAddress, setPendingAddress] = useState("");
  // coordinates captured when a Google candidate is chosen or from host registration
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    hostLocation?.lat != null && hostLocation?.lng != null ? { lat: hostLocation.lat, lng: hostLocation.lng } : null
  );

  const [captionIdeas, setCaptionIdeas] = useState<string[]>([]);
  const [captionLoading, setCaptionLoading] = useState(false);

  // Switch functions for host post modes
  const applyHostOwnBusiness = () => {
    setHostPostMode("own_business");
    if (hostLocation) {
      setPlaceName(hostLocation.placeName);
      setLocationName(hostLocation.locationName);
      setCommunity(hostLocation.community);
      setSubdistrict(hostLocation.subdistrict);
      setDistrict(hostLocation.district);
      setProvince(hostLocation.province);
      if (hostLocation.lat != null && hostLocation.lng != null) {
        setCoords({ lat: hostLocation.lat, lng: hostLocation.lng });
      }
      setLocationSource("otop");
      setLocationConfirmed(true);
      setVerify(null);
    }
  };

  const applyHostCommunitySpot = () => {
    setHostPostMode("community_spot");
    setLocationConfirmed(false);
    setLocationSource("manual");
    setPlaceName("");
    setLocationName("");
    setLocationQuery("");
    setVerify(null);
    setCoords(null);
  };

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

  const rawPlaceResults = locationQuery.trim().length >= 1 ? searchPlaces(locationQuery) : [];
  // For host in community spot mode, restrict results to their own province
  const placeResults = isHost && hostPostMode === "community_spot" && user?.otop_province
    ? rawPlaceResults.filter(p => p.provinceName === user.otop_province)
    : rawPlaceResults;

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
      audioType: "speech",
      // In own_business mode for hosts, pass their registered place as context
      // so AI summarizes atmosphere only, NOT guessing location.
      uploaderType: isHost && hostPostMode === "own_business" ? "community" : "tourist",
      location: isHost && hostPostMode === "own_business" && hostLocation
        ? [hostLocation.placeName, hostLocation.community, hostLocation.subdistrict,
           hostLocation.district, hostLocation.province].filter(Boolean).join(" ")
        : undefined,
    });
    setSummary(result);
    setSummaryDraft(result?.text ?? "");
    setAccuracy(0);
    setSummaryLoading(false);

    // Diagnostic log — check what M3 returned
    console.log("[summary] status =", result?.status,
      "place_name =", result?.place?.place_name ?? "null",
      "community =", (result?.place as any)?.community ?? "null",
      "province =", result?.place?.location?.province ?? "null"
    );

    // ── Host in own_business mode: location is ALWAYS locked to registered business ──
    // AI is only used for atmosphere summary, never for location extraction.
    if (isHost && hostLocation && hostPostMode === "own_business") {
      console.log("[summary] host own_business → keeping OTOP location locked");
      setLocationSource("otop");
      setLocationConfirmed(true);
      setVerify(null);
      // Restore host coords in case they were cleared
      if (hostLocation.lat != null && hostLocation.lng != null) {
        setCoords({ lat: hostLocation.lat, lng: hostLocation.lng });
      }
      setPlaceName(hostLocation.placeName);
      setLocationName(hostLocation.locationName);
      setCommunity(hostLocation.community);
      setSubdistrict(hostLocation.subdistrict);
      setDistrict(hostLocation.district);
      setProvince(hostLocation.province);
    } else if (result?.place) {
      // Tourist or host in community_spot mode: verify AI location normally
      const aiPlaceName = result.place.place_name ?? null;
      const aiCommunity = (result.place as any).community ?? null;
      const aiLoc = result.place.location ?? ({} as any);
      const aiProvince = aiLoc.province ?? null;
      const aiName = aiPlaceName || aiCommunity || "";

      if (isHost && hostLocation && hostPostMode === "community_spot") {
        // community_spot: AI may suggest a nearby place — still verify but scoped to tambol
        console.log("[summary] host community_spot → AI location verify (scoped to tambol)");
        setLocationSource("ai");
        if (aiName || aiProvince) {
          await runLocationVerify(result.place);
        }
      } else {
        setLocationSource("ai");
        await runLocationVerify(result.place);
      }
    } else {
      // No place from AI → clear location (tourist/community_spot mode only)
      if (!(isHost && hostPostMode === "own_business")) {
        console.log("[summary] AI found no place → clearing location");
        setLocationName("");
        setPlaceName("");
        setCommunity("");
        setSubdistrict("");
        setDistrict("");
        setProvince("");
        setCoords(null);
        setLocationConfirmed(false);
        setVerify(null);
        setLocationSource("manual");
      }
    }

    if (!result) {
      Alert.alert("สรุปไม่สำเร็จ", "ตอนนี้ให้ AI สรุปวิดีโอไม่ได้ ลองกดสรุปใหม่อีกครั้งได้เลย");
    }
  };

  // Verify + reconcile the AI's location against local data; never auto-pick
  // when ambiguous — surface candidates for the user to choose.
  const runLocationVerify = async (place: NonNullable<AiSummaryResult["place"]>) => {
    const aiPlaceName = place.place_name ?? null;
    const aiCommunity = (place as any).community ?? null;
    const loc = place.location ?? ({} as any);
    // Backend may have already run Google Places enrichment.
    const backendCandidates: PlaceCandidate[] = (place as any).google_candidates ?? [];
    const backendGps: string | null = (place as any).gps ?? null;

    console.log("[verify] aiPlaceName =", aiPlaceName, "community =", aiCommunity,
      "province =", loc.province, "district =", loc.district,
      "backendCandidates =", backendCandidates.length, "backendGps =", backendGps);

    const res = verifyLocationOffline({
      placeName: aiPlaceName,
      community: aiCommunity,
      subdistrict: loc.subdistrict ?? null,
      district: loc.district ?? null,
      province: loc.province ?? null,
    });
    setVerify(res);
    setLocationConfirmed(false);

    setGoogleCandidates([]);
    setCoords(null);
    setPendingConfirm(null);

    // ── Priority 1: use Google Places results from backend (already fetched) ──
    if (backendCandidates.length > 1) {
      // Multiple locations from backend → show picker immediately
      console.log("[verify] using", backendCandidates.length, "backend Google candidates");
      setGoogleCandidates(backendCandidates);
      return;
    }
    if (backendCandidates.length === 1) {
      const c = backendCandidates[0];
      console.log("[verify] single backend candidate →", c.name, "province:", c.province, "district:", c.district);
      setPendingConfirm(c);
      setPendingName(c.name);
      setPendingAddress(c.address);
      if (c.name) {
        setPlaceName(c.name);
        setLocationName(c.name);
      }
      if (c.province) setProvince(c.province);
      if (c.district) setDistrict(c.district);
      if (c.subdistrict) setSubdistrict(c.subdistrict);
      if (c.latitude != null && c.longitude != null) {
        setCoords({ lat: c.latitude, lng: c.longitude });
      }
      return;
    }
    if (backendGps) {
      const [lat, lng] = backendGps.split(",").map(Number);
      console.log("[verify] backend GPS received → lat:", lat, "lng:", lng);
      if (!isNaN(lat) && !isNaN(lng)) {
        setCoords({ lat, lng });
      }
    }

    // Prefill fields from AI place extraction
    if (aiPlaceName) setPlaceName(aiPlaceName);
    if (aiCommunity) setCommunity(aiCommunity);
    if (loc.subdistrict) setSubdistrict(loc.subdistrict);
    if (loc.district) setDistrict(loc.district);
    if (loc.province) setProvince(loc.province);
    const label = aiPlaceName || aiCommunity || "";
    if (label) setLocationName(label);

    // ── Priority 2: check our local confirmed places store ──
    if (aiPlaceName) {
      const local = await findLocalPlaces({
        name: aiPlaceName,
        province: loc.province,
        district: loc.district,
      });
      setLocalPlaceCandidates(local);
      if (local.length === 1 && res.status !== "needs_choice") {
        applyLocalPlace(local[0]);
        return;
      }
      // ── Priority 3: call Google ourselves if backend didn't enrich ──
      if (local.length === 0) {
        void lookupOnGoogle(aiPlaceName);
      }
    } else {
      setLocalPlaceCandidates([]);
    }
  };

  const lookupOnGoogle = async (
    name: string
  ) => {
    console.log("[google] lookupOnGoogle name =", name);
    setGoogleLoading(true);
    setPendingConfirm(null);
    setGoogleCandidates([]);
    const r = await verifyPlaceOnGoogle({
      placeName: name,
      community: community.trim() || undefined,
      district: district.trim() || undefined,
      province: province.trim() || undefined,
    });
    console.log("[google] result configured =", r.configured, "candidates =", r.candidates.length);
    setGoogleLoading(false);
    if (r.candidates.length === 1) {
      const c = r.candidates[0];
      setPendingConfirm(c);
      setPendingName(c.name);
      setPendingAddress(c.address);
      if (c.name) {
        setPlaceName(c.name);
        setLocationName(c.name);
      }
      if (c.province) setProvince(c.province);
      if (c.district) setDistrict(c.district);
      if (c.subdistrict) setSubdistrict(c.subdistrict);
      if (c.latitude != null && c.longitude != null) {
        setCoords({ lat: c.latitude, lng: c.longitude });
      }
    } else {
      setGoogleCandidates(r.candidates);
    }
  };

  // Confirm the single Google result (after optional editing).
  const confirmPending = async () => {
    if (!pendingConfirm) return;
    const confirmed: PlaceCandidate = {
      ...pendingConfirm,
      name: pendingName.trim() || pendingConfirm.name,
    };
    applyGoogleCandidate(confirmed);
    // Save to Supabase places store immediately so it appears on the map.
    void saveVerifiedPlace({
      name: confirmed.name,
      community: community.trim() || null,
      subdistrict: (confirmed.subdistrict ?? subdistrict.trim()) || null,
      district: (confirmed.district ?? district.trim()) || null,
      province: (confirmed.province ?? province.trim()) || null,
      latitude: confirmed.latitude,
      longitude: confirmed.longitude,
      googlePlaceId: confirmed.placeId || null,
      source: "google",
    });
    setPendingConfirm(null);
  };

  const applyGoogleCandidate = (c: PlaceCandidate) => {
    setPlaceName(c.name);
    if (c.subdistrict) setSubdistrict(c.subdistrict);
    if (c.district) setDistrict(c.district);
    if (c.province) setProvince(c.province);
    setLocationName(c.name);
    if (c.latitude != null && c.longitude != null) setCoords({ lat: c.latitude, lng: c.longitude });
    setLocationConfirmed(true);
    setPendingConfirm(null);
    setGoogleCandidates([]);
    setLocationSource("ai");
    setVerify(null);
  };

  const applyLocalPlace = (p: LocalPlace) => {
    setPlaceName(p.name);
    if (p.community) setCommunity(p.community);
    if (p.subdistrict) setSubdistrict(p.subdistrict);
    if (p.district) setDistrict(p.district);
    if (p.province) setProvince(p.province);
    setLocationName(p.name);
    setLocationConfirmed(true);
    setLocationSource("ai");
    setVerify(null);
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
    setLocationSource("manual");
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
    setGoogleCandidates([]);
    setPendingConfirm(null);
    setLocationSource("manual");
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
    // Reset location back to OTOP defaults for hosts, or clear for tourists.
    if (isHost && hostLocation) {
      setLocationName(hostLocation.locationName);
      setCommunity(hostLocation.community);
      setSubdistrict(hostLocation.subdistrict);
      setDistrict(hostLocation.district);
      setProvince(hostLocation.province);
      setPlaceName("");
      setLocationConfirmed(true);
      setVerify(null);
      setGoogleCandidates([]);
      setPendingConfirm(null);
      setLocationSource("otop");
    } else {
      setLocationName("");
      setPlaceName("");
      setCommunity("");
      setSubdistrict("");
      setDistrict("");
      setProvince("");
      setLocationQuery("");
      setVerify(null);
      setLocalPlaceCandidates([]);
      setLocationConfirmed(false);
      setGoogleCandidates([]);
      setPendingConfirm(null);
      setCoords(null);
    }
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

            {/* Single Google result → confirmation card (editable before confirming) */}
            {pendingConfirm && !googleLoading && (
              <View className="bg-blue-50 border border-blue-300 rounded-xl p-3 mb-2">
                <Text className="text-blue-800 text-[11px] font-bold mb-1.5">📍 พบสถานที่บน Google Maps — ยืนยันหรือแก้ไขก่อน</Text>

                <Text className="text-gray-500 text-[11px] mb-0.5">ชื่อสถานที่</Text>
                <TextInput
                  value={pendingName}
                  onChangeText={setPendingName}
                  className="bg-white border border-blue-200 rounded-lg px-2.5 py-2 text-[13px] text-gray-900 mb-1.5"
                />

                <Text className="text-gray-400 text-[11px]" numberOfLines={1}>{pendingAddress}</Text>
                <Text className="text-gray-500 text-[11px] mt-1">
                  {[pendingConfirm.subdistrict && `ต.${pendingConfirm.subdistrict}`,
                    pendingConfirm.district && `อ.${pendingConfirm.district}`,
                    pendingConfirm.province && `จ.${pendingConfirm.province}`]
                    .filter(Boolean).join(" • ")}
                </Text>

                <View className="flex-row mt-2.5">
                  <TouchableOpacity
                    onPress={confirmPending}
                    activeOpacity={0.85}
                    className="flex-1 bg-[#2D6A4F] rounded-xl py-2.5 items-center mr-1.5"
                  >
                    <Text className="text-white font-bold text-[12px]">✓ ถูกต้อง (ยืนยัน)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={clearLocation}
                    activeOpacity={0.8}
                    className="flex-1 bg-gray-100 border border-gray-200 rounded-xl py-2.5 items-center"
                  >
                    <Text className="text-gray-600 font-bold text-[12px]">✕ ไม่ถูกต้อง (ค้นหาเอง)</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Multiple Google results → list to choose from */}
            {googleCandidates.length > 1 && !googleLoading && (
              <>
                <Text className="text-gray-500 text-[11px] font-bold mt-1 mb-1">
                  พบหลายที่บน Google Maps — เลือกที่ถูกต้อง:
                </Text>
                {googleCandidates.map((c) => (
                  <TouchableOpacity
                    key={c.placeId}
                    onPress={() => {
                      applyGoogleCandidate(c);
                      void saveVerifiedPlace({
                        name: c.name,
                        community: community.trim() || null,
                        subdistrict: c.subdistrict ?? null,
                        district: c.district ?? null,
                        province: c.province ?? null,
                        latitude: c.latitude,
                        longitude: c.longitude,
                        googlePlaceId: c.placeId || null,
                        source: "google",
                      });
                    }}
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
            {placeName && !googleLoading && googleCandidates.length === 0 && !pendingConfirm && (
              <TouchableOpacity
                onPress={() => lookupOnGoogle(placeName)}
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
                onPress={() => {
                  setLocationConfirmed(true);
                  setVerify(null);
                }}
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

        {/* Host mode selector: 🏠 own business vs 📍 community spot */}
        {isHost && (
          <View className="mb-4">
            <Text className="text-gray-700 font-bold text-[13px] mb-2">📍 โพสต์นี้เป็นสถานที่ไหน?</Text>
            <View className="flex-row gap-x-2">
              <TouchableOpacity
                onPress={applyHostOwnBusiness}
                activeOpacity={0.8}
                className={`flex-1 py-3 rounded-xl border items-center ${
                  hostPostMode === "own_business"
                    ? "bg-[#2D6A4F] border-[#2D6A4F]"
                    : "bg-white border-gray-300"
                }`}
              >
                <Text className={`text-[13px] font-bold ${
                  hostPostMode === "own_business" ? "text-white" : "text-gray-600"
                }`}>🏠 สถานที่ของตัวเอง</Text>
                {hostPostMode === "own_business" && (
                  <Text className="text-white/80 text-[10px] mt-0.5">🔒 ตำแหน่งล็อกจากทะเบียน</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={applyHostCommunitySpot}
                activeOpacity={0.8}
                className={`flex-1 py-3 rounded-xl border items-center ${
                  hostPostMode === "community_spot"
                    ? "bg-blue-600 border-blue-600"
                    : "bg-white border-gray-300"
                }`}
              >
                <Text className={`text-[13px] font-bold ${
                  hostPostMode === "community_spot" ? "text-white" : "text-gray-600"
                }`}>📍 ภายในหมู่บ้าน/ตำบล</Text>
                {hostPostMode === "community_spot" && (
                  <Text className="text-white/80 text-[10px] mt-0.5">ค้นหาจุดในตำบลตนเอง</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 1) Location — searchable OTOP place picker */}
        <View className="flex-row items-center mb-1.5">
          <MapPinIcon size={14} color="#EF4444" />
          <Text className="text-gray-700 font-bold text-[13px] ml-1">สถานที่ / ชุมชน</Text>
          {isHost && locationSource === "otop" && (
            <View className="ml-2 bg-emerald-100 rounded-full px-2 py-0.5">
              <Text className="text-[#2D6A4F] text-[10px] font-bold">ชุมชน OTOP ของคุณ</Text>
            </View>
          )}
          {locationSource === "ai" && locationConfirmed && (
            <View className="ml-2 bg-blue-100 rounded-full px-2 py-0.5">
              <Text className="text-blue-700 text-[10px] font-bold">สถานที่จาก AI</Text>
            </View>
          )}
        </View>

        {/* Host own_business: LOCKED card 🔒 — no X button, read-only */}
        {isHost && hostPostMode === "own_business" && locationSource === "otop" && locationName && locationConfirmed && !verify ? (
          <View className="bg-emerald-50 border-2 border-emerald-300 rounded-xl px-3.5 py-3 mb-4">
            <View className="flex-row items-center mb-1">
              <MapPinIcon size={16} color="#2D6A4F" />
              <Text className="text-[#1B4332] font-bold text-[14px] flex-1 ml-2">{locationName}</Text>
              <View className="bg-emerald-200 rounded-full px-2 py-0.5">
                <Text className="text-[#1B4332] text-[10px] font-bold">🔒 ล็อก</Text>
              </View>
            </View>
            <Text className="text-gray-500 text-[12px] ml-6">
              {[subdistrict && `ต.${subdistrict}`, district && `อ.${district}`, province && `จ.${province}`]
                .filter(Boolean)
                .join(" • ")}
            </Text>
            <Text className="text-emerald-600 text-[10px] mt-1 ml-6">📋 ตำแหน่งนี้ดึงจากทะเบียน OTOP ของคุณ — แก้ไขได้ในหน้าโปรไฟล์</Text>
          </View>
        ) : verify && !locationConfirmed ? (
          // While verifying, the verification card above handles the choice.
          <Text className="text-gray-400 text-[12px] mb-4 px-1">
            {'ตรวจสอบสถานที่จาก AI ด้านบน หรือเลือก "ค้นหา/แก้เอง"'}
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
              {locationSource === "ai" && (
                <Text className="text-blue-600 text-[10px] mt-0.5">✨ จากการสรุปของ AI & Google Maps • แตะกากบาทเพื่อเปลี่ยน</Text>
              )}
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
            {locationQuery.trim().length >= 1 && (
              <TouchableOpacity
                onPress={() => lookupOnGoogle(locationQuery.trim())}
                activeOpacity={0.8}
                className="flex-row items-center justify-center bg-blue-50 border border-blue-200 rounded-xl py-2.5 mb-3"
              >
                <MapPinIcon size={16} color="#2563EB" />
                <Text className="text-blue-700 font-bold text-[13px] ml-1.5">
                  {`ค้นหา "${locationQuery.trim()}" ใน Google Maps`}
                </Text>
              </TouchableOpacity>
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
