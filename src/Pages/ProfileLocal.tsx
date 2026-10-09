import React, { useState } from "react";
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
} from "react-native-heroicons/outline";
import {
  MapPinIcon as MapPinSolid,
  BookmarkIcon as BookmarkSolid,
  HeartIcon as HeartSolid,
  PlayIcon as PlaySolid,
} from "react-native-heroicons/solid";

import { VideoItemData } from "../data/profileLocalData";
import { useMyProfile } from "../state/MyProfileContext";
import { useInteractions } from "../state/InteractionContext";
import { getVideoById } from "../data/profilesData";
import { resolveSavedVideo } from "../data/tripsData";
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

  const { name, username, bio, avatar, location, registeredInfo, ownedVideos } = useMyProfile();
  const { followingCount, likedVideoIds, savedVideoIds, folders, createFolder } = useInteractions();

  const followersCount = 0;
  const totalLikesReceived = ownedVideos.filter((v) => likedVideoIds.includes(v.id)).length;

  const [activeTab, setActiveTab] = useState<ProfileTabKey>("videos");
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [viewerVideoId, setViewerVideoId] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // liked grid items (resolve ids → display info)
  const toGridItem = (videoId: string): VideoItemData => {
    const v = getVideoById(videoId);
    const info = resolveSavedVideo(videoId);
    return {
      id: videoId,
      title: v?.title ?? info.title,
      thumbnail: v?.thumbnail ?? info.poster ?? avatar,
      views: v?.views ?? "1K",
    };
  };
  const likedVideos = likedVideoIds.map(toGridItem);

  // Saved tab: videos NOT in any folder (loose), shown under the folders.
  const inFolderIds = new Set(folders.flatMap((f) => f.videoIds));
  const looseSavedIds = savedVideoIds.filter((id) => !inFolderIds.has(id));
  const looseSaved = looseSavedIds.map((id) => resolveSavedVideo(id));

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

            <TouchableOpacity
              onPress={() => setShowInfoModal(true)}
              activeOpacity={0.8}
              className="bg-[#D47A3A] px-5 py-2.5 rounded-xl items-center justify-center shadow-sm"
            >
              <Text className="text-white text-xs font-bold tracking-wide">ข้อมูลเพิ่มเติม</Text>
            </TouchableOpacity>
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
              {ownedVideos.length > 0 ? (
                ownedVideos.map((video, index) => (
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
                    <Image source={video.thumbnail} className="w-full h-full" resizeMode="cover" />
                    <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 40, backgroundColor: "rgba(0,0,0,0.35)" }} />
                    <View className="absolute bottom-1.5 left-1.5 flex-row items-center">
                      <PlayOutline size={12} color="#FFFFFF" strokeWidth={2.5} />
                      <Text className="text-white text-[11px] font-bold ml-1">{video.views}</Text>
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
                    <Image source={video.thumbnail} className="w-full h-full" resizeMode="cover" />
                    <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 40, backgroundColor: "rgba(0,0,0,0.35)" }} />
                    <View className="absolute bottom-1.5 left-1.5 flex-row items-center">
                      <PlayOutline size={12} color="#FFFFFF" strokeWidth={2.5} />
                      <Text className="text-white text-[11px] font-bold ml-1">{video.views}</Text>
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
                <Text className="text-lg font-bold text-gray-900 ml-2">ข้อมูลการลงทะเบียนชุมชน</Text>
              </View>
              <TouchableOpacity onPress={() => setShowInfoModal(false)} className="w-8 h-8 rounded-full bg-gray-100 items-center justify-center">
                <XMarkIcon size={18} color="#4B5563" />
              </TouchableOpacity>
            </View>

            {[
              ["รหัสวิสาหกิจชุมชน (SMCE)", registeredInfo.smceCode],
              ["ผู้ประสานงาน / ประธานกลุ่ม", registeredInfo.presidentName],
              ["หมวดหมู่บริการ", registeredInfo.category],
              ["เพดานราคาตายตัว", registeredInfo.pricingCeiling],
              ["ขีดความสามารถรองรับ", registeredInfo.carryingCapacity],
            ].map(([label, val], i) => (
              <View key={i} className="mb-2.5">
                <Text className="text-[11px] text-gray-400">{label}</Text>
                <Text className="text-sm font-semibold text-gray-800">{val || "ยังไม่ได้ระบุ"}</Text>
              </View>
            ))}

            <View className="bg-amber-50 rounded-xl p-3 border border-amber-200/60 mb-4">
              <Text className="text-amber-800 text-[11px] leading-4">
                📌 ข้อมูลส่วนนี้ดึงจากการลงทะเบียน OTOP เข้าสู่ระบบ (แก้ไขในแอปไม่ได้)
              </Text>
            </View>

            <TouchableOpacity onPress={() => setShowInfoModal(false)} className="bg-[#2D6A4F] py-3 rounded-xl items-center">
              <Text className="text-white text-sm font-bold">ตกลง</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
