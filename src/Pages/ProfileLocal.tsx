import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  useWindowDimensions,
  Modal,
  Platform,
  TextInput,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Cog8ToothIcon,
  PlayIcon as PlayOutline,
  XMarkIcon,
  ShieldCheckIcon,
  PencilSquareIcon,
  FolderIcon,
  FolderPlusIcon,
  BuildingStorefrontIcon,
  CheckCircleIcon,
  MapPinIcon,
} from "react-native-heroicons/outline";
import {
  MapPinIcon as MapPinSolid,
  BookmarkIcon as BookmarkSolid,
  HeartIcon as HeartSolid,
  PlayIcon as PlaySolid,
} from "react-native-heroicons/solid";

import { VideoItemData } from "../data/profileLocalData";
import { useMyProfile } from "../state/MyProfileContext";
import { useAuth } from "../state/AuthContext";
import { useInteractions } from "../state/InteractionContext";
import { useMyVideos } from "../hooks/useMyVideos";
import { loadLikedVideos, loadSavedVideos } from "../services/interactionService";
import type { VideoPost } from "../data/homeFeedData";
import { getVideoById } from "../data/profilesData";
import { resolveSavedVideo } from "../data/tripsData";
import { verifyPlaceOnGoogle, type PlaceCandidate } from "../services/placesService";
import { supabase } from "../lib/supabase";
import EditProfileSheet from "../components/EditProfileSheet";
import SettingsSheet from "../components/SettingsSheet";
import MyVideoViewer from "../components/MyVideoViewer";

type ProfileTabKey = "videos" | "saved" | "liked";

interface ProfileLocalProps {
  onOpenFolder?: (folderId: string) => void;
  onFullScreenChange?: (full: boolean) => void;
}

export default function ProfileLocal({ onOpenFolder, onFullScreenChange }: ProfileLocalProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const { name, username, bio, avatar, location, registeredInfo } = useMyProfile();
  const { user, updateBusinessProfile } = useAuth();
  const { followingCount, likedVideoIds, savedVideoIds, folders, createFolder } = useInteractions();

  const isOtopHost = user?.role === "host" && user?.otop_verified;

  // Own posted videos — real data from Supabase (no mock).
  const { videos: myVideos } = useMyVideos();

  const followersCount = 0;
  const totalLikesReceived = myVideos.reduce((sum, v) => sum + v.likesCount, 0);

  const [activeTab, setActiveTab] = useState<ProfileTabKey>("videos");
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [viewerVideoId, setViewerVideoId] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Business Profile Edit state
  type BizType = "homestay" | "activity" | "cafe" | "custom";
  const [bizType, setBizType] = useState<BizType>("homestay");
  const [bizWeekdayLabel, setBizWeekdayLabel] = useState("วันธรรมดา (อา.-พฤ.)");
  const [bizWeekendLabel, setBizWeekendLabel] = useState("วันหยุดสุดสัปดาห์ (ศ.-ส. & นักขัตฤกษ์)");
  const [bizWeekdayHours, setBizWeekdayHours] = useState("");
  const [bizWeekendHours, setBizWeekendHours] = useState("");
  const [bizClosedDays, setBizClosedDays] = useState("เปิดทุกวัน");
  const [bizWeekdayPrice, setBizWeekdayPrice] = useState("");
  const [bizWeekendPrice, setBizWeekendPrice] = useState("");

  const [showEditBusiness, setShowEditBusiness] = useState(false);
  const [bizPlaceName, setBizPlaceName] = useState("");
  const [bizPhone, setBizPhone] = useState("");
  const [bizSaving, setBizSaving] = useState(false);
  const [bizGpsCandidates, setBizGpsCandidates] = useState<PlaceCandidate[]>([]);
  const [bizGpsLoading, setBizGpsLoading] = useState(false);
  const [bizConfirmedPlace, setBizConfirmedPlace] = useState<PlaceCandidate | null>(null);

  const handleSelectBizType = (type: BizType) => {
    setBizType(type);
    if (type === "homestay") {
      setBizWeekdayLabel("วันธรรมดา (อา.-พฤ.)");
      setBizWeekendLabel("วันหยุดสุดสัปดาห์ (ศ.-ส. & นักขัตฤกษ์)");
    } else if (type === "activity") {
      setBizWeekdayLabel("วันธรรมดา (จ.-ศ.)");
      setBizWeekendLabel("วันหยุดสุดสัปดาห์ (ส.-อา. & นักขัตฤกษ์)");
    } else if (type === "cafe") {
      setBizWeekdayLabel("วันธรรมดา (จ.-ศ.)");
      setBizWeekendLabel("วันหยุดสุดสัปดาห์ (ส.-อา.)");
    } else {
      setBizWeekdayLabel("วันธรรมดา");
      setBizWeekendLabel("วันหยุด / เทศกาล");
    }
  };

  const parseGoogleHours = (openingHoursStr?: string | null) => {
    if (!openingHoursStr) return;
    const parts = openingHoursStr.split("|").map((p) => p.trim());
    const closedDayNames: string[] = [];
    parts.forEach((p) => {
      if (p.includes("ปิดทำการ") || p.toLowerCase().includes("closed")) {
        const dayName = p.split(":")[0]?.trim();
        if (dayName) closedDayNames.push(dayName.replace("วัน", ""));
      }
    });

    if (closedDayNames.length > 0) {
      setBizClosedDays(`ปิดทุกวัน${closedDayNames.join(", ")}`);
    } else {
      setBizClosedDays("เปิดทุกวัน");
    }

    const openPart = parts.find(
      (p) => !p.includes("ปิดทำการ") && !p.toLowerCase().includes("closed") && p.includes(":")
    );
    if (openPart) {
      const timeIdx = openPart.indexOf(":");
      if (timeIdx !== -1) {
        const timeStr = openPart.slice(timeIdx + 1).trim();
        setBizWeekdayHours(timeStr);
        setBizWeekendHours(timeStr);
      }
    }
  };

  const openEditBusiness = () => {
    setBizPlaceName(user?.business_place_name || user?.otop_village || "");
    setBizPhone(user?.business_phone || user?.phone_number || "");
    const rawPrice = user?.business_price_info || "";
    if (rawPrice.includes("|")) {
      const parts = rawPrice.split("|").map((x: string) => x.trim());
      setBizWeekdayPrice(parts[0] || "");
      setBizWeekendPrice(parts[1] || "");
    } else {
      setBizWeekdayPrice(rawPrice);
      setBizWeekendPrice("");
    }

    const rawHours = (user as any)?.business_opening_hours || "";
    if (rawHours.includes("|")) {
      const parts = rawHours.split("|").map((x: string) => x.trim());
      setBizWeekdayHours(parts[0] || "");
      setBizWeekendHours(parts[1] || "");
      setBizClosedDays(parts[2]?.replace("วันหยุดร้าน:", "").trim() || "เปิดทุกวัน");
    } else if (rawHours) {
      setBizWeekdayHours(rawHours);
      setBizWeekendHours(rawHours);
      setBizClosedDays("เปิดทุกวัน");
    }
    setBizGpsCandidates([]);
    if (user?.business_place_name && user?.business_lat && user?.business_lng) {
      setBizConfirmedPlace({
        name: user.business_place_name,
        address: user.business_address || "",
        placeId: "",
        latitude: user.business_lat,
        longitude: user.business_lng,
        province: user.business_province || user.otop_province || null,
        district: user.business_district || user.otop_amphur || null,
        subdistrict: user.business_subdistrict || user.otop_tambol || null,
        types: [],
      });
    } else {
      setBizConfirmedPlace(null);
    }
    setShowEditBusiness(true);
  };

  const selectBizCandidate = (c: PlaceCandidate) => {
    setBizConfirmedPlace(c);
    setBizPlaceName(c.name);
    if (c.phone) setBizPhone(c.phone);
    if (c.openingHours) parseGoogleHours(c.openingHours);
    setBizGpsCandidates([]);
  };

  const applyBizOtopFallback = () => {
    const otopFallback: PlaceCandidate = {
      name: bizPlaceName.trim(),
      address: [
        user?.otop_village,
        user?.otop_tambol && `ต.${user.otop_tambol}`,
        user?.otop_amphur && `อ.${user.otop_amphur}`,
        user?.otop_province && `จ.${user.otop_province}`,
      ]
        .filter(Boolean)
        .join(" "),
      placeId: `otop-fallback-${user?.otop_village_id || user?.id || Date.now()}`,
      latitude: user?.business_lat ?? 0,
      longitude: user?.business_lng ?? 0,
      province: user?.otop_province ?? null,
      district: user?.otop_amphur ?? null,
      subdistrict: user?.otop_tambol ?? null,
      types: ["point_of_interest"],
    };
    setBizConfirmedPlace(otopFallback);
    setBizGpsCandidates([]);
  };

  // ค้นหาพิกัด Google Maps อัตโนมัติเมื่อผู้ใช้พิมพ์ชื่อสถานที่ (Debounce 500ms)
  useEffect(() => {
    if (!showEditBusiness) return;
    const query = bizPlaceName.trim();
    if (!query || query.length < 2) {
      setBizGpsCandidates([]);
      setBizGpsLoading(false);
      return;
    }
    // หากเลือกหมุดชื่อนี้ไปแล้ว ไม่ต้องค้นหาซ้ำ
    if (bizConfirmedPlace && bizConfirmedPlace.name === query) {
      return;
    }

    setBizGpsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await verifyPlaceOnGoogle({
          placeName: query,
          community: user?.otop_village ?? undefined,
          district: user?.otop_amphur ?? undefined,
          province: user?.otop_province ?? undefined,
        });
        setBizGpsCandidates(res.candidates);
      } catch (err: any) {
        console.warn("[ProfileLocal] search GPS error:", err);
      } finally {
        setBizGpsLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [bizPlaceName, showEditBusiness, user?.otop_village, user?.otop_amphur, user?.otop_province, bizConfirmedPlace]);

  const handleSaveBusiness = async () => {
    if (!bizPhone.trim()) {
      Alert.alert("กรุณาระบุเบอร์โทร", "เบอร์โทรศัพท์จำเป็นสำหรับการติดต่อสถานที่ประกอบการ");
      return;
    }
    setBizSaving(true);
    const compOpening = [
      bizWeekdayHours.trim() ? `${bizWeekdayLabel}: ${bizWeekdayHours.trim()}` : "",
      bizWeekendHours.trim() ? `${bizWeekendLabel}: ${bizWeekendHours.trim()}` : "",
      bizClosedDays.trim() ? `วันหยุดร้าน: ${bizClosedDays.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    const compPrice = [
      bizWeekdayPrice.trim() ? `${bizWeekdayLabel}: ${bizWeekdayPrice.trim()}` : "",
      bizWeekendPrice.trim() ? `${bizWeekendLabel}: ${bizWeekendPrice.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    try {
      const { error } = await updateBusinessProfile({
        businessPlaceName: bizPlaceName.trim(),
        businessPriceInfo: compPrice,
        businessPhone: bizPhone.trim(),
        businessLat: bizConfirmedPlace?.latitude ?? user?.business_lat ?? null,
        businessLng: bizConfirmedPlace?.longitude ?? user?.business_lng ?? null,
        businessAddress: bizConfirmedPlace?.address ?? user?.business_address ?? null,
        businessSubdistrict: bizConfirmedPlace?.subdistrict ?? user?.business_subdistrict ?? user?.otop_tambol ?? null,
        businessDistrict: bizConfirmedPlace?.district ?? user?.business_district ?? user?.otop_amphur ?? null,
        businessProvince: bizConfirmedPlace?.province ?? user?.business_province ?? user?.otop_province ?? null,
      });

      // Upsert into community_places master table for AI chat & search
      if (bizConfirmedPlace) {
        const pId = bizConfirmedPlace.placeId || `otop-${user?.otop_village_id || user?.id || Date.now()}-${Date.now()}`;
        const gUrl =
          bizConfirmedPlace.googleMapsUri ||
          (bizConfirmedPlace.latitude != null && bizConfirmedPlace.longitude != null
            ? `https://www.google.com/maps?q=${bizConfirmedPlace.latitude},${bizConfirmedPlace.longitude}`
            : null);

        supabase
          .from("community_places")
          .upsert(
            {
              place_id: pId,
              place_name: bizPlaceName.trim(),
              formatted_address: bizConfirmedPlace.address || null,
              province: bizConfirmedPlace.province || user?.otop_province || "",
              district: bizConfirmedPlace.district || user?.otop_amphur || null,
              subdistrict: bizConfirmedPlace.subdistrict || user?.otop_tambol || null,
              village: user?.otop_village || null,
              latitude: bizConfirmedPlace.latitude ?? null,
              longitude: bizConfirmedPlace.longitude ?? null,
              google_maps_url: gUrl,
              phone: bizPhone.trim() || null,
              opening_hours: compOpening || null,
              price_info: compPrice || null,
              rating: bizConfirmedPlace.rating ?? null,
              user_ratings_total: bizConfirmedPlace.userRatingCount ?? null,
              website: bizConfirmedPlace.website ?? null,
              source: "host_verified",
              owner_id: user?.id,
            },
            { onConflict: "place_id" }
          )
          .then(({ error: cErr }: any) => {
            if (cErr) console.warn("[ProfileLocal] community_places upsert error:", cErr.message);
          });
      }

      setBizSaving(false);
      if (error) {
        Alert.alert(
          "บันทึกไม่สำเร็จ (Database Error)",
          `ไม่สามารถบันทึกข้อมูลลงระบบได้ สาเหตุ: ${error}\n\nกรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตหรือสิทธิ์การเข้าถึงฐานข้อมูล Supabase`
        );
      } else {
        setShowEditBusiness(false);
        Alert.alert("สำเร็จ", "อัปเดตข้อมูลสถานที่ประกอบการเรียบร้อยแล้ว");
      }
    } catch (e: any) {
      setBizSaving(false);
      Alert.alert(
        "บันทึกไม่สำเร็จ (Network/System Error)",
        `เกิดข้อผิดพลาดในการส่งข้อมูล: ${e?.message ?? String(e)}`
      );
    }
  };

  // Liked tab: the current user's liked videos, loaded from Supabase.
  const likedKey = likedVideoIds.join(",");
  const [likedVideos, setLikedVideos] = useState<VideoPost[]>([]);
  useEffect(() => {
    let active = true;
    loadLikedVideos().then((v) => {
      console.log("[profile] likedVideos fetched =", v.length, "likedIds =", likedVideoIds.length);
      if (active) setLikedVideos(v);
    });
    return () => {
      active = false;
    };
  }, [likedKey]);

  // Saved tab: loose saves (not in any folder), loaded from Supabase.
  const inFolderIds = new Set(folders.flatMap((f) => f.videoIds));
  const looseSavedIds = savedVideoIds.filter((id) => !inFolderIds.has(id));
  const looseKey = looseSavedIds.join(",");
  const [looseSaved, setLooseSaved] = useState<VideoPost[]>([]);
  useEffect(() => {
    let active = true;
    loadSavedVideos(looseKey ? looseKey.split(",") : []).then((v) => {
      console.log("[profile] looseSaved fetched =", v.length, "savedIds =", savedVideoIds.length, "loose =", looseSavedIds.length);
      if (active) setLooseSaved(v);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looseKey]);

  const gridItemWidth = (screenWidth - 4) / 3;

  const handleCreateFolder = () => {
    const n = newFolderName.trim();
    if (!n) return;
    createFolder(n);
    setNewFolderName("");
    setShowNewFolder(false);
  };

  // Tell host to hide the bottom bar while the own-video viewer is open
  React.useEffect(() => {
    onFullScreenChange?.(viewerVideoId !== null);
  }, [viewerVideoId, onFullScreenChange]);

  // Full-screen own-video viewer (feed-style) with edit/delete
  if (viewerVideoId) {
    return <MyVideoViewer initialVideoId={viewerVideoId} onBack={() => setViewerVideoId(null)} />;
  }

  return (
    <View className="flex-1 bg-white w-full h-full">
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <View className="flex-1 w-full bg-white">
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingTop: Math.max(insets.top, 16) + (Platform.OS === "android" ? 10 : 6),
            paddingBottom: Math.max(insets.bottom, 20) + 80,
          }}
        >
          {/* 1. Header (Settings Gear) */}
          <View className="px-5 flex-row justify-end items-center mb-1">
            <TouchableOpacity
              onPress={() => setShowSettings(true)}
              activeOpacity={0.7}
              className="w-10 h-10 items-center justify-center -mr-2"
            >
              <Cog8ToothIcon size={26} color="#18181B" strokeWidth={1.8} />
            </TouchableOpacity>
          </View>

          {/* 2. Location */}
          <View className="px-5 flex-row items-center mb-3">
            <MapPinSolid size={16} color="#EF4444" />
            <Text className="text-gray-500 text-[13px] font-medium ml-1.5">{location}</Text>
          </View>

          {/* 3. Name / Username / Bio + Avatar (editable via pencil) */}
          <View className="px-5 flex-row items-start justify-between mb-5">
            <View className="flex-1 pr-3">
              <View className="flex-row items-center mb-0.5">
                <Text className="text-2xl font-black text-black tracking-tight">{name}</Text>
                <TouchableOpacity onPress={() => setShowEdit(true)} activeOpacity={0.7} className="ml-2 p-1">
                  <PencilSquareIcon size={18} color="#2D6A4F" />
                </TouchableOpacity>
              </View>
              <Text className="text-sm font-semibold text-gray-700 mb-2">{username}</Text>
              <Text className="text-[13px] text-gray-800 leading-5">{bio}</Text>
            </View>

            <TouchableOpacity onPress={() => setShowEdit(true)} activeOpacity={0.85} className="items-center justify-center">
              <Image
                source={avatar}
                style={{ width: 97, height: 97, borderRadius: 97 / 2 }}
                className="bg-gray-100 border border-gray-200"
                resizeMode="cover"
              />
            </TouchableOpacity>
          </View>

          {/* 4. Stats + info button */}
          <View className="px-5 flex-row items-center justify-between mb-6">
            <View className="flex-row items-center">
              <View className="items-start mr-5">
                <Text className="text-base font-bold text-black tracking-tight">{followingCount}</Text>
                <Text className="text-[11px] text-gray-500 mt-0.5">กำลังติดตาม</Text>
              </View>
              <View className="items-start mr-5">
                <Text className="text-base font-bold text-black tracking-tight">{followersCount}</Text>
                <Text className="text-[11px] text-gray-500 mt-0.5">ผู้ติดตาม</Text>
              </View>
              <View className="items-start">
                <Text className="text-base font-bold text-black tracking-tight">{totalLikesReceived}</Text>
                <Text className="text-[11px] text-gray-500 mt-0.5">ถูกใจ</Text>
              </View>
            </View>

            {isOtopHost && (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setShowInfoModal(true)}
                  activeOpacity={0.8}
                  className="bg-[#D47A3A] px-3.5 py-2.5 rounded-xl flex-row items-center justify-center shadow-sm"
                >
                  <ShieldCheckIcon size={14} color="#FFFFFF" />
                  <Text className="text-white text-xs font-bold tracking-wide ml-1">OTOP</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={openEditBusiness}
                  activeOpacity={0.8}
                  className="bg-emerald-700 px-3.5 py-2.5 rounded-xl flex-row items-center justify-center shadow-sm"
                >
                  <BuildingStorefrontIcon size={14} color="#FFFFFF" />
                  <Text className="text-white text-xs font-bold tracking-wide ml-1">แก้ไขร้าน</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* 5. Tabs */}
          <View className="flex-row items-center border-b border-gray-200">
            <TouchableOpacity
              onPress={() => setActiveTab("videos")}
              activeOpacity={0.7}
              className={`flex-1 py-3 items-center flex-row justify-center border-b-2 ${activeTab === "videos" ? "border-black" : "border-transparent"}`}
            >
              <PlaySolid size={14} color={activeTab === "videos" ? "#000000" : "#6B7280"} />
              <Text className={`ml-1.5 text-xs ${activeTab === "videos" ? "font-bold text-black" : "font-medium text-gray-500"}`}>วิดีโอ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab("saved")}
              activeOpacity={0.7}
              className={`flex-1 py-3 items-center flex-row justify-center border-b-2 ${activeTab === "saved" ? "border-black" : "border-transparent"}`}
            >
              <BookmarkSolid size={14} color={activeTab === "saved" ? "#00D26A" : "#6B7280"} />
              <Text className={`ml-1.5 text-xs ${activeTab === "saved" ? "font-bold text-black" : "font-medium text-gray-500"}`}>วิดีโอที่บันทึก</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab("liked")}
              activeOpacity={0.7}
              className={`flex-1 py-3 items-center flex-row justify-center border-b-2 ${activeTab === "liked" ? "border-black" : "border-transparent"}`}
            >
              <HeartSolid size={14} color={activeTab === "liked" ? "#EF4444" : "#6B7280"} />
              <Text className={`ml-1.5 text-xs ${activeTab === "liked" ? "font-bold text-black" : "font-medium text-gray-500"}`}>วิดีโอที่ถูกใจ</Text>
            </TouchableOpacity>
          </View>

          {/* 6a. VIDEOS tab — owned videos (tap → feed-style viewer w/ edit & delete) */}
          {activeTab === "videos" && (
            <View className="flex-row flex-wrap">
              {myVideos.length > 0 ? (
                myVideos.map((video, index) => (
                  <TouchableOpacity
                    key={video.id}
                    onPress={() => setViewerVideoId(video.id)}
                    activeOpacity={0.85}
                    style={{
                      width: gridItemWidth,
                      height: gridItemWidth * 1.35,
                      marginRight: (index + 1) % 3 === 0 ? 0 : 2,
                      marginBottom: 2,
                    }}
                    className="bg-gray-100 relative overflow-hidden"
                  >
                    <Image
                      source={video.thumbnailUrl ? { uri: video.thumbnailUrl } : avatar}
                      className="w-full h-full"
                      resizeMode="cover"
                    />
                    <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 40, backgroundColor: "rgba(0,0,0,0.35)" }} />
                    <View className="absolute bottom-1.5 left-1.5 flex-row items-center">
                      <PlayOutline size={12} color="#FFFFFF" strokeWidth={2.5} />
                      <Text className="text-white text-[11px] font-bold ml-1">{video.likesCount}</Text>
                    </View>
                  </TouchableOpacity>
                ))
              ) : (
                <View className="w-full py-16 items-center justify-center">
                  <Text className="text-gray-400 text-sm">ยังไม่มีวิดีโอที่โพสต์</Text>
                </View>
              )}
            </View>
          )}

          {/* 6b. SAVED tab — folders on top (+create), loose clips below */}
          {activeTab === "saved" && (
            <View className="px-4 pt-4">
              {/* Create folder */}
              <TouchableOpacity
                onPress={() => setShowNewFolder(true)}
                activeOpacity={0.8}
                className="flex-row items-center bg-amber-50 border border-amber-200 rounded-2xl p-3.5 mb-3"
              >
                <View className="w-10 h-10 rounded-xl bg-amber-100 items-center justify-center mr-3">
                  <FolderPlusIcon size={22} color="#D47A3A" />
                </View>
                <Text className="text-[#B45309] font-bold text-[14px]">สร้างโฟลเดอร์ใหม่</Text>
              </TouchableOpacity>

              {/* Folders */}
              {folders.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  onPress={() => onOpenFolder?.(f.id)}
                  activeOpacity={0.8}
                  className="flex-row items-center bg-gray-50 border border-gray-100 rounded-2xl p-3.5 mb-2.5"
                >
                  <View className="w-10 h-10 rounded-xl bg-gray-200 items-center justify-center mr-3">
                    <FolderIcon size={22} color="#4B5563" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-gray-900 font-bold text-[14px]">{f.name}</Text>
                    <Text className="text-gray-400 text-[12px]">{f.videoIds.length} คลิป</Text>
                  </View>
                  <PlayOutline size={16} color="#9CA3AF" />
                </TouchableOpacity>
              ))}

              {/* Loose saved clips (not in any folder) */}
              <Text className="text-gray-400 text-[11px] font-bold mt-3 mb-2 uppercase">คลิปที่บันทึกไว้ (ยังไม่ได้จัดโฟลเดอร์)</Text>
              {looseSaved.length > 0 ? (
                <View className="flex-row flex-wrap -mx-0.5">
                  {looseSaved.map((v, index) => (
                    <View
                      key={v.id}
                      style={{ width: (screenWidth - 32 - 8) / 3, height: ((screenWidth - 32 - 8) / 3) * 1.35, margin: 2 }}
                      className="bg-gray-100 relative overflow-hidden rounded-lg"
                    >
                      {v.poster ? (
                        <Image source={v.poster} className="w-full h-full" resizeMode="cover" />
                      ) : (
                        <View className="w-full h-full items-center justify-center">
                          <PlayOutline size={20} color="#9CA3AF" />
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              ) : (
                <Text className="text-gray-400 text-[13px] py-6 text-center">
                  ยังไม่มีคลิปที่บันทึกนอกโฟลเดอร์
                </Text>
              )}
            </View>
          )}

          {/* 6c. LIKED tab */}
          {activeTab === "liked" && (
            <View className="flex-row flex-wrap">
              {likedVideos.length > 0 ? (
                likedVideos.map((video, index) => (
                  <View
                    key={video.id}
                    style={{
                      width: gridItemWidth,
                      height: gridItemWidth * 1.35,
                      marginRight: (index + 1) % 3 === 0 ? 0 : 2,
                      marginBottom: 2,
                    }}
                    className="bg-gray-100 relative overflow-hidden"
                  >
                    {video.poster ? (
                      <Image source={video.poster} className="w-full h-full" resizeMode="cover" />
                    ) : (
                      <View className="w-full h-full items-center justify-center">
                        <PlayOutline size={20} color="#9CA3AF" />
                      </View>
                    )}
                    <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 40, backgroundColor: "rgba(0,0,0,0.35)" }} />
                    <View className="absolute bottom-1.5 left-1.5 flex-row items-center">
                      <PlayOutline size={12} color="#FFFFFF" strokeWidth={2.5} />
                      <Text className="text-white text-[11px] font-bold ml-1">{video.initialLikes}</Text>
                    </View>
                  </View>
                ))
              ) : (
                <View className="w-full py-16 items-center justify-center">
                  <Text className="text-gray-400 text-sm">ยังไม่มีวิดีโอที่ถูกใจ</Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </View>

      {/* Edit profile + settings sheets */}
      <EditProfileSheet visible={showEdit} onClose={() => setShowEdit(false)} />
      <SettingsSheet visible={showSettings} onClose={() => setShowSettings(false)} />

      {/* New folder modal */}
      <Modal visible={showNewFolder} transparent animationType="fade" onRequestClose={() => setShowNewFolder(false)}>
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-3xl w-full max-w-sm p-5">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg font-black text-gray-900">สร้างโฟลเดอร์ใหม่</Text>
              <TouchableOpacity onPress={() => setShowNewFolder(false)} className="p-1">
                <XMarkIcon size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <TextInput
              value={newFolderName}
              onChangeText={setNewFolderName}
              placeholder="ชื่อโฟลเดอร์ เช่น ทริปเชียงใหม่"
              placeholderTextColor="#9CA3AF"
              autoFocus
              className="bg-gray-100 rounded-xl px-3.5 py-3 text-[14px] text-gray-900 mb-4"
            />
            <TouchableOpacity
              onPress={handleCreateFolder}
              disabled={!newFolderName.trim()}
              activeOpacity={0.85}
              className={`py-3 rounded-2xl items-center ${newFolderName.trim() ? "bg-[#2D6A4F]" : "bg-gray-200"}`}
            >
              <Text className={`font-bold text-[15px] ${newFolderName.trim() ? "text-white" : "text-gray-400"}`}>สร้าง</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Registration info modal (read-only, from OTOP registration) */}
      <Modal visible={showInfoModal} transparent animationType="fade" onRequestClose={() => setShowInfoModal(false)}>
        <View className="flex-1 bg-black/60 items-center justify-center px-5">
          <View className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <View className="flex-row items-center justify-between pb-3 border-b border-gray-100 mb-4">
              <View className="flex-row items-center">
                <ShieldCheckIcon size={22} color="#2D6A4F" />
                <Text className="text-lg font-bold text-gray-900 ml-2">ชุมชน OTOP นวัตวิถี</Text>
              </View>
              <TouchableOpacity onPress={() => setShowInfoModal(false)} className="w-8 h-8 rounded-full bg-gray-100 items-center justify-center">
                <XMarkIcon size={18} color="#4B5563" />
              </TouchableOpacity>
            </View>

            {/* Verified badge */}
            <View className="bg-emerald-50 rounded-xl p-3 border border-emerald-200 mb-4 flex-row items-center">
              <ShieldCheckIcon size={18} color="#2D6A4F" />
              <Text className="text-[#1B4332] text-[12px] font-semibold ml-2">
                ยืนยันกับทะเบียน OTOP แล้ว (เลขทะเบียน {user?.otop_village_id ?? "-"})
              </Text>
            </View>

            {[
              ["ชื่อ OTOP นวัตวิถี", user?.otop_nawatwithi],
              ["OTOP เพื่อการท่องเที่ยว", user?.otop_for_tourism],
              ["หมู่บ้านท่องเที่ยวโดยชุมชน", user?.otop_cbt_village],
              ["หมู่บ้าน", user?.otop_village],
              ["ตำบล", user?.otop_tambol],
              ["อำเภอ", user?.otop_amphur],
              ["จังหวัด", user?.otop_province],
              ["ภูมิภาค", user?.otop_region],
            ].map(([label, val], i) => (
              <View key={i} className="mb-2.5">
                <Text className="text-[11px] text-gray-400">{label}</Text>
                <Text className="text-sm font-semibold text-gray-800">{val || "ยังไม่ได้ระบุ"}</Text>
              </View>
            ))}

            <View className="bg-amber-50 rounded-xl p-3 border border-amber-200/60 mb-4">
              <Text className="text-amber-800 text-[11px] leading-4">
                📌 ข้อมูลส่วนนี้ดึงจากทะเบียน OTOP นวัตวิถี (กรมการพัฒนาชุมชน) แก้ไขในแอปไม่ได้
              </Text>
            </View>

            <TouchableOpacity onPress={() => setShowInfoModal(false)} className="bg-[#2D6A4F] py-3 rounded-xl items-center">
              <Text className="text-white text-sm font-bold">ตกลง</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* Edit Business Profile Modal */}
      <Modal visible={showEditBusiness} animationType="slide" transparent onRequestClose={() => setShowEditBusiness(false)}>
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white rounded-t-3xl p-5 max-h-[88%]">
            <View className="flex-row items-center justify-between pb-3 border-b border-gray-100 mb-3">
              <View className="flex-row items-center">
                <BuildingStorefrontIcon size={20} color="#2D6A4F" />
                <Text className="text-base font-bold text-gray-900 ml-2">แก้ไขข้อมูลสถานประกอบการ</Text>
              </View>
              <TouchableOpacity onPress={() => setShowEditBusiness(false)} className="w-8 h-8 rounded-full bg-gray-100 items-center justify-center">
                <XMarkIcon size={18} color="#4B5563" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* OTOP Community Location (Read-only) */}
              <View className="bg-emerald-50 rounded-xl p-3 border border-emerald-200 mb-4">
                <Text className="text-[#1B4332] text-xs font-bold mb-0.5">ที่ตั้งชุมชน OTOP (ล็อกตามทะเบียน)</Text>
                <Text className="text-gray-700 text-xs">
                  {[user?.otop_village, user?.otop_tambol && `ต.${user.otop_tambol}`,
                    user?.otop_amphur && `อ.${user.otop_amphur}`, user?.otop_province && `จ.${user.otop_province}`]
                    .filter(Boolean)
                    .join(" • ") || "-"}
                </Text>
              </View>

              {/* 1. Place name & Auto GPS Pin */}
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-gray-700 font-bold text-xs">
                  ชื่อสถานประกอบการ / ร้านค้า <Text className="text-red-500">*</Text>
                </Text>
                {bizGpsLoading && (
                  <View className="flex-row items-center">
                    <ActivityIndicator size="small" color="#2D6A4F" />
                    <Text className="text-emerald-700 text-[11px] font-medium ml-1">กำลังค้นหาพิกัด...</Text>
                  </View>
                )}
              </View>
              <TextInput
                value={bizPlaceName}
                onChangeText={(t) => {
                  setBizPlaceName(t);
                  setBizConfirmedPlace(null);
                }}
                placeholder="เช่น โฮมสเตย์ป้าสมศรี, กาแฟบ้านห้วยห้อม"
                placeholderTextColor="#9CA3AF"
                className="bg-gray-100 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 mb-2"
              />

              {/* Candidates found on Google Maps within community scope */}
              {bizGpsCandidates.length > 0 && !bizConfirmedPlace && (
                <View className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 mb-4">
                  <Text className="text-blue-900 font-bold text-[12px] mb-2">
                    📍 พบสถานที่ในเขต {user?.otop_amphur || user?.otop_province} — เลือกเพื่อดึงข้อมูลอัตโนมัติ:
                  </Text>
                  {bizGpsCandidates.map((c, idx) => (
                    <View key={idx} className="bg-white border border-blue-100 rounded-xl p-3 mb-2.5 shadow-sm">
                      <Text className="text-gray-900 font-bold text-[13.5px]">📍 {c.name}</Text>
                      <Text className="text-gray-500 text-[11px] mt-0.5" numberOfLines={2}>{c.address}</Text>

                      {(c.phone || c.openingHours) && (
                        <View className="mt-1.5 pt-1.5 border-t border-gray-100">
                          {c.phone && <Text className="text-gray-600 text-[11px]">📞 {c.phone}</Text>}
                          {c.openingHours && (
                            <Text className="text-gray-600 text-[11px] mt-0.5" numberOfLines={1}>
                              🕒 {c.openingHours}
                            </Text>
                          )}
                        </View>
                      )}

                      <View className="flex-row items-center justify-between mt-2.5">
                        {c.googleMapsUri ? (
                          <TouchableOpacity
                            onPress={() => Linking.openURL(c.googleMapsUri!)}
                            activeOpacity={0.7}
                            className="flex-row items-center px-2 py-1 bg-gray-100 rounded-lg"
                          >
                            <Text className="text-[11px] text-blue-700 font-semibold">🗺️ ดูบน Google Maps</Text>
                          </TouchableOpacity>
                        ) : <View />}

                        <TouchableOpacity
                          onPress={() => selectBizCandidate(c)}
                          activeOpacity={0.85}
                          className="bg-[#2D6A4F] py-1.5 px-3.5 rounded-lg"
                        >
                          <Text className="text-white font-bold text-[11px]">✓ เลือกสถานที่นี้</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Fallback button when not found on Google Maps */}
              {bizGpsCandidates.length === 0 &&
                bizPlaceName.trim().length >= 2 &&
                !bizGpsLoading &&
                !bizConfirmedPlace && (
                  <View className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 mb-4">
                    <Text className="text-amber-900 font-semibold text-[12px] mb-1">
                      ไม่พบหมุดร้าน "{bizPlaceName.trim()}" บน Google Maps ในเขต {user?.otop_amphur}
                    </Text>
                    <Text className="text-gray-500 text-[11px] mb-2.5 leading-4">
                      หากเป็นร้านเปิดใหม่หรือยังไม่มีหมุด สามารถกดใช้พิกัดของชุมชน OTOP แทน และกรอกข้อมูลด้วยตนเองได้เลยค่ะ
                    </Text>
                    <TouchableOpacity
                      onPress={applyBizOtopFallback}
                      activeOpacity={0.85}
                      className="bg-amber-600 py-2 px-3.5 rounded-xl flex-row items-center justify-center self-start"
                    >
                      <MapPinIcon size={15} color="#FFFFFF" />
                      <Text className="text-white font-bold text-[12px] ml-1.5">
                        📍 ใช้พิกัดของชุมชน OTOP แทน
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

              {/* Confirmed Pin & Review / Edit Section */}
              {bizConfirmedPlace && (
                <View className="mb-2">
                  <View className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-3.5 mb-4">
                    <View className="flex-row items-center justify-between mb-1">
                      <View className="flex-row items-center">
                        <CheckCircleIcon size={18} color="#2D6A4F" />
                        <Text className="text-[#1B4332] font-black text-[13px] ml-1.5">
                          ✓ ยืนยันพิกัดเรียบร้อยแล้ว
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => setBizConfirmedPlace(null)}
                        activeOpacity={0.7}
                        className="px-2 py-0.5 bg-white border border-emerald-200 rounded-lg"
                      >
                        <Text className="text-emerald-700 font-semibold text-[10.5px]">เปลี่ยนพิกัด</Text>
                      </TouchableOpacity>
                    </View>
                    <Text className="text-gray-800 font-bold text-[13px] mt-0.5">{bizConfirmedPlace.name}</Text>
                    <Text className="text-gray-500 text-[11px] mt-0.5">{bizConfirmedPlace.address}</Text>

                    {bizConfirmedPlace.googleMapsUri && (
                      <TouchableOpacity
                        onPress={() => Linking.openURL(bizConfirmedPlace.googleMapsUri!)}
                        activeOpacity={0.7}
                        className="mt-2 self-start flex-row items-center"
                      >
                        <Text className="text-[11px] text-blue-700 font-semibold">🗺️ ดูตำแหน่งบน Google Maps</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Preset Selector */}
                  <Text className="text-gray-700 font-bold text-xs mb-1.5 mt-1">
                    เลือกประเภทสถานประกอบการ <Text className="text-gray-400 font-normal text-[10.5px]">(ปรับรอบวันอัตโนมัติ)</Text>
                  </Text>
                  <View className="flex-row flex-wrap gap-1.5 mb-3.5">
                    {[
                      { id: "homestay", label: "🏡 โฮมสเตย์ / ที่พัก" },
                      { id: "activity", label: "🎨 กิจกรรม / ท่องเที่ยว" },
                      { id: "cafe", label: "☕ ร้านค้า / คาเฟ่" },
                      { id: "custom", label: "⚙️ กำหนดเอง" },
                    ].map((p) => (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => handleSelectBizType(p.id as BizType)}
                        activeOpacity={0.8}
                        className={`px-3 py-1.5 rounded-xl border ${
                          bizType === p.id
                            ? "bg-[#2D6A4F] border-[#2D6A4F]"
                            : "bg-gray-100 border-gray-200"
                        }`}
                      >
                        <Text
                          className={`text-[11.5px] font-bold ${
                            bizType === p.id ? "text-white" : "text-gray-700"
                          }`}
                        >
                          {p.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Section 1: Weekday Schedule & Price */}
                  <View className="bg-gray-50 p-3 rounded-2xl border border-gray-200 mb-3">
                    <View className="flex-row items-center justify-between mb-1.5">
                      <Text className="text-[#1B4332] font-bold text-xs">
                        1. รอบวันธรรมดา / วันปกติ
                      </Text>
                      <Text className="text-gray-400 text-[10px]">แตะแก้ไขชื่อวันได้</Text>
                    </View>
                    <TextInput
                      value={bizWeekdayLabel}
                      onChangeText={setBizWeekdayLabel}
                      placeholder="เช่น วันธรรมดา (อา.-พฤ.)"
                      placeholderTextColor="#9CA3AF"
                      className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-800 font-semibold mb-2"
                    />
                    <Text className="text-gray-600 text-[11px] font-medium mb-1">
                      เวลาเปิด-ปิดทำการ / Check-in
                    </Text>
                    <TextInput
                      value={bizWeekdayHours}
                      onChangeText={setBizWeekdayHours}
                      placeholder={
                        bizType === "homestay"
                          ? "เช่น เช็คอิน 14:00 / เช็คเอาท์ 11:00"
                          : "เช่น 08:30 - 17:00"
                      }
                      placeholderTextColor="#9CA3AF"
                      className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 mb-2"
                    />
                    <Text className="text-gray-600 text-[11px] font-medium mb-1">
                      อัตราค่าบริการ / ราคา
                    </Text>
                    <TextInput
                      value={bizWeekdayPrice}
                      onChangeText={setBizWeekdayPrice}
                      placeholder={
                        bizType === "homestay"
                          ? "เช่น 500 บาท / คืน"
                          : "เช่น 50-150 บาท"
                      }
                      placeholderTextColor="#9CA3AF"
                      className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900"
                    />
                  </View>

                  {/* Section 2: Weekend & Holiday Schedule & Price */}
                  <View className="bg-amber-50/50 p-3 rounded-2xl border border-amber-200 mb-3">
                    <View className="flex-row items-center justify-between mb-1.5">
                      <Text className="text-amber-900 font-bold text-xs">
                        2. รอบวันหยุด / สุดสัปดาห์ / เทศกาล
                      </Text>
                      <Text className="text-gray-400 text-[10px]">แตะแก้ไขชื่อวันได้</Text>
                    </View>
                    <TextInput
                      value={bizWeekendLabel}
                      onChangeText={setBizWeekendLabel}
                      placeholder="เช่น วันหยุดสุดสัปดาห์ (ศ.-ส. & นักขัตฤกษ์)"
                      placeholderTextColor="#9CA3AF"
                      className="bg-white border border-amber-200 rounded-xl px-3 py-2 text-xs text-gray-800 font-semibold mb-2"
                    />
                    <Text className="text-gray-600 text-[11px] font-medium mb-1">
                      เวลาเปิด-ปิดทำการ / Check-in
                    </Text>
                    <TextInput
                      value={bizWeekendHours}
                      onChangeText={setBizWeekendHours}
                      placeholder={
                        bizType === "homestay"
                          ? "เช่น เช็คอิน 14:00 / เช็คเอาท์ 11:00"
                          : "เช่น 08:00 - 18:00"
                      }
                      placeholderTextColor="#9CA3AF"
                      className="bg-white border border-amber-200 rounded-xl px-3 py-2 text-xs text-gray-900 mb-2"
                    />
                    <Text className="text-gray-600 text-[11px] font-medium mb-1">
                      อัตราค่าบริการ / ราคา
                    </Text>
                    <TextInput
                      value={bizWeekendPrice}
                      onChangeText={setBizWeekendPrice}
                      placeholder={
                        bizType === "homestay"
                          ? "เช่น 750 บาท / คืน"
                          : "เช่น 80-200 บาท"
                      }
                      placeholderTextColor="#9CA3AF"
                      className="bg-white border border-amber-200 rounded-xl px-3 py-2 text-xs text-gray-900"
                    />
                  </View>

                  {/* Section 3: Closed Days */}
                  <View className="bg-gray-50 p-3 rounded-2xl border border-gray-200 mb-3.5">
                    <Text className="text-gray-800 font-bold text-xs mb-1.5">
                      3. วันหยุดประจำร้าน / วันที่ไม่เปิดทำการ
                    </Text>
                    <View className="flex-row flex-wrap gap-1.5 mb-2">
                      {["เปิดทุกวัน", "ปิดวันจันทร์", "ปิดวันพุธ", "ปิดวันอาทิตย์"].map((opt) => (
                        <TouchableOpacity
                          key={opt}
                          onPress={() => setBizClosedDays(opt)}
                          activeOpacity={0.75}
                          className={`px-2.5 py-1 rounded-lg border ${
                            bizClosedDays === opt
                              ? "bg-red-500 border-red-500"
                              : "bg-white border-gray-200"
                          }`}
                        >
                          <Text
                            className={`text-[10.5px] font-semibold ${
                              bizClosedDays === opt ? "text-white" : "text-gray-600"
                            }`}
                          >
                            {opt}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput
                      value={bizClosedDays}
                      onChangeText={setBizClosedDays}
                      placeholder="เช่น เปิดทุกวัน หรือ ปิดทุกวันจันทร์"
                      placeholderTextColor="#9CA3AF"
                      className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900"
                    />
                  </View>
                </View>
              )}

              {/* 3. Phone */}
              <Text className="text-gray-700 font-bold text-xs mb-1">
                เบอร์โทรศัพท์ติดต่อ <Text className="text-red-500">*</Text>
              </Text>
              <TextInput
                value={bizPhone}
                onChangeText={setBizPhone}
                keyboardType="phone-pad"
                placeholder="เช่น 081-234-5678"
                placeholderTextColor="#9CA3AF"
                className="bg-gray-100 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 mb-4"
              />

              <TouchableOpacity
                onPress={handleSaveBusiness}
                disabled={bizSaving || !bizPhone.trim()}
                activeOpacity={0.85}
                className={`py-3.5 rounded-2xl items-center flex-row justify-center mb-6 ${
                  bizSaving || !bizPhone.trim() ? "bg-gray-200" : "bg-[#2D6A4F]"
                }`}
              >
                {bizSaving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text className={`font-bold text-sm ${bizSaving || !bizPhone.trim() ? "text-gray-400" : "text-white"}`}>
                    บันทึกข้อมูล
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
