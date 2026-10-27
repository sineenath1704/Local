import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  FlatList,
  StatusBar,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  ChatBubbleLeftRightIcon,
  SparklesIcon,
  PlayIcon,
  MapPinIcon,
  CheckBadgeIcon,
  QuestionMarkCircleIcon,
} from "react-native-heroicons/outline";
import { useInteractions } from "../../state/InteractionContext";
import { useAuth } from "../../state/AuthContext";
import {
  getFolderContext,
  type FolderContextInfo,
  type FolderPlaceInfo,
} from "../../services/folderContextService";

interface FolderDetailScreenProps {
  folderId: string;
  onBack: () => void;
  onChatFromFolder: (folderId: string, folderName: string) => void;
  onPlanTrip: (folderId: string, folderName: string) => void;
}

export default function FolderDetailScreen({
  folderId,
  onBack,
  onChatFromFolder,
  onPlanTrip,
}: FolderDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const { folders } = useInteractions();
  const { session } = useAuth();
  const folder = folders.find((f) => f.id === folderId);

  const [ctx, setCtx] = useState<FolderContextInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const folderName = ctx?.folderName || folder?.name || "โฟลเดอร์";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getFolderContext(folderId, session?.access_token ?? null);
        if (!cancelled) setCtx(data);
      } catch {
        if (!cancelled) setCtx(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId, session?.access_token]);

  const clips = useMemo(() => ctx?.clips ?? [], [ctx]);
  const places = useMemo(() => ctx?.places ?? [], [ctx]);

  /** ชื่อสถานที่ของคลิป (ไล่จากข้อมูลสรุป AI → คอลัมน์ในคลิป) */
  const clipPlace = (c: FolderContextInfo["clips"][number]): string => {
    return (
      c.placeName ||
      c.summary?.place?.place_name ||
      c.summary?.place?.community ||
      c.locationName ||
      "ไม่ระบุสถานที่"
    );
  };

  const header = (
    <View>
      {/* ── การ์ด "สถานที่ที่โฟลเดอร์นี้ไป" ───────────────────── */}
      <View className="mx-3.5 mb-3 bg-violet-50 border border-violet-100 rounded-2xl p-3.5">
        <View className="flex-row items-center justify-between">
          <Text className="text-[13px] font-black text-gray-900">
            สถานที่ที่โฟลเดอร์นี้ไป
          </Text>
          {loading ? (
            <ActivityIndicator size="small" color="#7C3AED" />
          ) : places.length > 0 ? (
            <Text className="text-[11px] font-bold text-violet-700">
              {places.length} แห่ง (ลงทะเบียน {ctx?.registryHits ?? 0} / จากคลิป{" "}
              {ctx?.aiFallbacks ?? 0})
            </Text>
          ) : null}
        </View>

        {!loading && places.length === 0 ? (
          <Text className="text-[12px] text-gray-500 mt-2">
            ยังไม่มีข้อมูลสถานที่ในคลิปของโฟลเดอร์นี้ — คลิปที่มีคำบรรยายสถานที่
            หรือผ่านการสรุป AI จะแสดงที่นี่
          </Text>
        ) : null}

        {places.map((p) => (
          <FolderPlaceRow key={p.key} place={p} />
        ))}

        {ctx && !ctx.fromBackend ? (
          <Text className="text-[11px] text-gray-400 mt-2">
            * แสดงจากข้อมูลคลิปในเครื่อง (ยังไม่ได้ตรวจกับทะเบียนสถานที่)
          </Text>
        ) : null}
      </View>

      <Text className="text-[12px] font-bold text-gray-500 px-4 mb-2">
        คลิปในโฟลเดอร์ ({clips.length})
      </Text>
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
        <TouchableOpacity onPress={onBack} className="p-1 mr-1">
          <ArrowLeftIcon size={24} color="#18181B" strokeWidth={2} />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-lg font-black text-gray-900" numberOfLines={1}>
            {folderName}
          </Text>
          <Text className="text-[11px] text-gray-400">
            {loading ? "กำลังโหลด…" : `${clips.length} คลิปที่บันทึก`}
          </Text>
        </View>
      </View>

      {/* Action buttons */}
      <View className="flex-row px-4 py-3">
        <TouchableOpacity
          onPress={() => onChatFromFolder(folderId, folderName)}
          activeOpacity={0.85}
          className="flex-1 flex-row items-center justify-center bg-violet-100 rounded-2xl py-3 mr-2"
        >
          <ChatBubbleLeftRightIcon size={18} color="#7C3AED" />
          <Text className="text-violet-700 font-bold text-[13px] ml-1.5">คุยกับ AI</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onPlanTrip(folderId, folderName)}
          activeOpacity={0.85}
          className="flex-1 flex-row items-center justify-center bg-violet-600 rounded-2xl py-3"
        >
          <SparklesIcon size={18} color="#FFFFFF" />
          <Text className="text-white font-bold text-[13px] ml-1.5">วางแผนทริป</Text>
        </TouchableOpacity>
      </View>

      {/* Places + saved videos */}
      <FlatList
        data={clips}
        keyExtractor={(v) => v.videoId}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: 14, paddingTop: 0, paddingBottom: 110 }}
        renderItem={({ item }) => (
          <View className="flex-row items-center bg-gray-50 border border-gray-100 rounded-2xl p-2.5 mb-2.5">
            <View className="w-16 h-20 rounded-xl overflow-hidden bg-gray-200 mr-3">
              {item.thumbnailUrl ? (
                <Image
                  source={{ uri: item.thumbnailUrl }}
                  className="w-full h-full"
                  resizeMode="cover"
                />
              ) : (
                <View className="w-full h-full items-center justify-center">
                  <PlayIcon size={22} color="#9CA3AF" />
                </View>
              )}
            </View>
            <View className="flex-1">
              <Text className="text-gray-900 font-bold text-[14px]" numberOfLines={1}>
                {item.caption || "คลิปที่บันทึกไว้"}
              </Text>
              <View className="flex-row items-center mt-1">
                <MapPinIcon size={13} color="#EF4444" />
                <Text className="text-gray-500 text-[12px] ml-1" numberOfLines={1}>
                  {clipPlace(item)}
                </Text>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={
          loading ? null : (
            <View className="py-16 items-center px-10">
              <PlayIcon size={40} color="#D1D5DB" />
              <Text className="text-gray-400 text-sm text-center mt-3">
                ยังไม่มีคลิปในโฟลเดอร์นี้ ไปที่หน้าหลักแล้วกดบันทึกคลิปที่ชอบเข้ามาได้เลย
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

/** แถวสถานที่ 1 แห่ง + ป้ายบอกแหล่งที่มา */
function FolderPlaceRow({ place }: { place: FolderPlaceInfo }) {
  const confirmed = place.source === "registry";
  const facts: string[] = [];
  if (place.facts.price) facts.push(`ราคา: ${place.facts.price}`);
  if (place.facts.openingHours) facts.push(`เปิด: ${place.facts.openingHours}`);
  if (place.facts.phone) facts.push(`โทร: ${place.facts.phone}`);

  const where = place.communityName || place.address || place.province || "";

  return (
    <View className="bg-white border border-gray-100 rounded-xl px-3 py-2.5 mt-2">
      <View className="flex-row items-start">
        <View className="flex-1">
          <Text className="text-[14px] font-bold text-gray-900" numberOfLines={2}>
            {place.name}
          </Text>
          {where ? (
            <Text className="text-[12px] text-gray-500 mt-0.5" numberOfLines={2}>
              {where}
            </Text>
          ) : null}
        </View>
        <View
          className={`flex-row items-center rounded-full px-2 py-1 ml-2 ${
            confirmed ? "bg-emerald-50" : "bg-amber-50"
          }`}
        >
          {confirmed ? (
            <CheckBadgeIcon size={12} color="#059669" />
          ) : (
            <QuestionMarkCircleIcon size={12} color="#D97706" />
          )}
          <Text
            className={`text-[10px] font-bold ml-1 ${
              confirmed ? "text-emerald-700" : "text-amber-700"
            }`}
          >
            {confirmed ? "ลงทะเบียนแล้ว" : "ยังไม่ยืนยัน"}
          </Text>
        </View>
      </View>

      {facts.length > 0 ? (
        <Text className="text-[11px] text-gray-500 mt-1.5" numberOfLines={3}>
          {facts.join(" · ")}
        </Text>
      ) : null}

      <Text className="text-[11px] text-gray-400 mt-1">
        {place.clipCount} คลิป
        {place.facts.highlights?.length
          ? ` · ${place.facts.highlights.slice(0, 3).join(" · ")}`
          : ""}
      </Text>
    </View>
  );
}
