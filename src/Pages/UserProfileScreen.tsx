import React, { useMemo, useState } from "react";
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  PlayIcon as PlayOutline,
  XMarkIcon,
  ShieldCheckIcon,
  MapPinIcon,
  BuildingStorefrontIcon,
  CheckBadgeIcon,
} from "react-native-heroicons/outline";
import { PlayIcon as PlaySolid } from "react-native-heroicons/solid";

import { UserProfile } from "../data/profilesData";
import { useInteractions } from "../state/InteractionContext";

interface UserProfileScreenProps {
  profile: UserProfile;
  onBack: () => void;
  onVideoPress?: (videoId: string) => void;
}

/**
 * Read-only profile viewer (tourist + community). Opened when a user taps an
 * author's avatar in the feed. You can follow, but cannot edit their content.
 *
 * Total likes shown = sum of each video's baseLikes + 1 for every video the
 * CURRENT user has liked (real action-driven, no mock total).
 */
export default function UserProfileScreen({
  profile,
  onBack,
  onVideoPress,
}: UserProfileScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { isFollowing, toggleFollow, likedVideoIds } = useInteractions();
  const [showInfoModal, setShowInfoModal] = useState(false);

  const following = isFollowing(profile.id);

  // Followers reflect real taps: base + 1 while the current user follows.
  const followersDisplay = profile.followersBase + (following ? 1 : 0);

  // Total likes across this profile's videos (base + current user's real likes).
  const totalLikes = useMemo(() => {
    const base = profile.videos.reduce((sum, v) => sum + v.baseLikes, 0);
    const mine = profile.videos.filter((v) => likedVideoIds.includes(v.id)).length;
    return base + mine;
  }, [profile.videos, likedVideoIds]);

  const gridItemWidth = (screenWidth - 4) / 3;
  const isCommunity = profile.kind === "community";

  const formatCount = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n));

  return (
    <View className="flex-1 bg-white w-full h-full">
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 16) + (Platform.OS === "android" ? 10 : 6),
          paddingBottom: Math.max(insets.bottom, 20) + 80,
        }}
      >
        {/* Header: back + kind badge */}
        <View className="px-5 flex-row justify-between items-center mb-1">
          <TouchableOpacity onPress={onBack} activeOpacity={0.7} className="w-10 h-10 items-center justify-center -ml-2">
            <ArrowLeftIcon size={24} color="#18181B" strokeWidth={2} />
          </TouchableOpacity>
          <View className={`flex-row items-center px-3 py-1 rounded-full ${isCommunity ? "bg-emerald-50" : "bg-blue-50"}`}>
            {isCommunity ? (
              <CheckBadgeIcon size={14} color="#2D6A4F" />
            ) : (
              <PlayOutline size={13} color="#2563EB" />
            )}
            <Text className={`text-[11px] font-bold ml-1 ${isCommunity ? "text-[#2D6A4F]" : "text-[#2563EB]"}`}>
              {isCommunity ? "ชุมชน" : "นักท่องเที่ยว"}
            </Text>
          </View>
        </View>

        {/* Location (community shows map label) */}
        <View className="px-5 flex-row items-center mb-3">
          <MapPinIcon size={16} color="#EF4444" />
          <Text className="text-gray-500 text-[13px] font-medium ml-1.5">
            {isCommunity && profile.community ? profile.community.mapLabel : profile.location}
          </Text>
        </View>

        {/* Name + avatar */}
        <View className="px-5 flex-row items-start justify-between mb-5">
          <View className="flex-1 pr-3">
            <Text className="text-2xl font-black text-black tracking-tight mb-0.5">{profile.name}</Text>
            <Text className="text-sm font-semibold text-gray-700 mb-2">{profile.username}</Text>
            <Text className="text-[13px] text-gray-800 leading-5">{profile.bio}</Text>
          </View>
          <View className="items-center justify-center">
            {profile.avatar ? (
              <Image
                source={profile.avatar}
                style={{ width: 97, height: 97, borderRadius: 97 / 2 }}
                className="bg-gray-100 border border-gray-200"
                resizeMode="cover"
              />
            ) : (
              <View style={{ width: 97, height: 97, borderRadius: 97 / 2 }} className="bg-emerald-100 items-center justify-center">
                <Text className="text-[#2D6A4F] font-black text-4xl">{profile.name.trim().charAt(0)}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Stats + follow / info buttons */}
        <View className="px-5 flex-row items-center justify-between mb-6">
          <View className="flex-row items-center">
            <View className="items-start mr-5">
              <Text className="text-base font-bold text-black">{formatCount(followersDisplay)}</Text>
              <Text className="text-[11px] text-gray-500 mt-0.5">ผู้ติดตาม</Text>
            </View>
            <View className="items-start">
              <Text className="text-base font-bold text-black">{formatCount(totalLikes)}</Text>
              <Text className="text-[11px] text-gray-500 mt-0.5">ถูกใจทั้งหมด</Text>
            </View>
          </View>

          <View className="flex-row items-center">
            {isCommunity && (
              <TouchableOpacity
                onPress={() => setShowInfoModal(true)}
                activeOpacity={0.8}
                className="bg-[#D47A3A] px-4 py-2.5 rounded-xl mr-2"
              >
                <Text className="text-white text-xs font-bold">ข้อมูลเพิ่มเติม</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => toggleFollow(profile.id)}
              activeOpacity={0.8}
              className={`px-6 py-2.5 rounded-xl border ${
                following ? "bg-white border-gray-300" : "bg-[#00D26A] border-[#00D26A]"
              }`}
            >
              <Text className={`text-xs font-bold ${following ? "text-gray-700" : "text-white"}`}>
                {following ? "กำลังติดตาม" : "ติดตาม"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Community business block */}
        {isCommunity && profile.community && (
          <View className="mx-5 mb-6 bg-emerald-50/60 border border-emerald-100 rounded-2xl p-4">
            <View className="flex-row items-center mb-2">
              <BuildingStorefrontIcon size={18} color="#2D6A4F" />
              <Text className="text-[#1B4332] font-bold text-[13px] ml-2">เกี่ยวกับธุรกิจชุมชน</Text>
            </View>
            <Text className="text-gray-700 text-[12.5px] leading-5 mb-2">
              {profile.community.business.aboutText}
            </Text>
            <Text className="text-gray-500 text-[11px] mb-2">🕒 {profile.community.business.openHours}</Text>
            <View className="flex-row flex-wrap">
              {profile.community.business.services.map((s, i) => (
                <View key={i} className="bg-white border border-emerald-200 rounded-full px-2.5 py-1 mr-2 mb-2">
                  <Text className="text-[#2D6A4F] text-[11px] font-semibold">{s}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Videos header */}
        <View className="flex-row items-center border-b border-gray-200">
          <View className="flex-1 py-3 items-center flex-row justify-center border-b-2 border-black">
            <PlaySolid size={14} color="#000000" />
            <Text className="ml-1.5 text-xs font-bold text-black">
              วิดีโอ ({profile.videos.length})
            </Text>
          </View>
        </View>

        {/* Videos grid (read-only) */}
        <View className="flex-row flex-wrap">
          {profile.videos.map((video, index) => (
            <TouchableOpacity
              key={video.id}
              onPress={() => onVideoPress?.(video.id)}
              activeOpacity={0.85}
              style={{
                width: gridItemWidth,
                height: gridItemWidth * 1.35,
                marginRight: (index + 1) % 3 === 0 ? 0 : 2,
                marginBottom: 2,
              }}
              className="bg-gray-100 relative overflow-hidden"
            >
              <Image source={video.thumbnail} className="w-full h-full" resizeMode="cover" />
              <View
                style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 40, backgroundColor: "rgba(0,0,0,0.35)" }}
              />
              <View className="absolute bottom-1.5 left-1.5 flex-row items-center">
                <PlayOutline size={12} color="#FFFFFF" strokeWidth={2.5} />
                <Text className="text-white text-[11px] font-bold ml-1">{video.views}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Community registration modal */}
      {isCommunity && profile.community && (
        <Modal visible={showInfoModal} transparent animationType="fade" onRequestClose={() => setShowInfoModal(false)}>
          <View className="flex-1 bg-black/60 items-center justify-center px-5">
            <View className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
              <View className="flex-row items-center justify-between pb-3 border-b border-gray-100 mb-4">
                <View className="flex-row items-center">
                  <ShieldCheckIcon size={22} color="#2D6A4F" />
                  <Text className="text-lg font-bold text-gray-900 ml-2">ข้อมูลการลงทะเบียนชุมชน</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setShowInfoModal(false)}
                  className="w-8 h-8 rounded-full bg-gray-100 items-center justify-center"
                >
                  <XMarkIcon size={18} color="#4B5563" />
                </TouchableOpacity>
              </View>

              {[
                ["รหัสวิสาหกิจชุมชน (SMCE)", profile.community.registeredInfo.smceCode],
                ["ผู้ประสานงาน / ประธานกลุ่ม", profile.community.registeredInfo.presidentName],
                ["หมวดหมู่บริการ", profile.community.registeredInfo.category],
                ["เพดานราคา", profile.community.registeredInfo.pricingCeiling],
                ["ขีดความสามารถรองรับ", profile.community.registeredInfo.carryingCapacity],
              ].map(([label, val], i) => (
                <View key={i} className="mb-2.5">
                  <Text className="text-[11px] text-gray-400">{label}</Text>
                  <Text className="text-sm font-semibold text-gray-800">{val || "ยังไม่ได้ระบุ"}</Text>
                </View>
              ))}

              <View className="bg-amber-50 rounded-xl p-3 border border-amber-200/60 my-3">
                <Text className="text-amber-800 text-[11px] leading-4">
                  📌 ข้อมูลเชื่อมโยงจากการลงทะเบียนชุมชน เพื่อรับรองความปลอดภัยและป้องกันนายทุน
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => setShowInfoModal(false)}
                className="bg-[#2D6A4F] py-3 rounded-xl items-center"
              >
                <Text className="text-white text-sm font-bold">ตกลง</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}
