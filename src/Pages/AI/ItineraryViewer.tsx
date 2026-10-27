import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  ClockIcon,
  TruckIcon,
  PencilSquareIcon,
  CheckIcon,
  ArrowDownTrayIcon,
  BanknotesIcon,
  MapPinIcon,
  ChatBubbleLeftRightIcon,
  VideoCameraIcon,
  HomeModernIcon,
  BuildingStorefrontIcon,
  SparklesIcon,
  ArrowRightCircleIcon,
  FlagIcon,
  CheckBadgeIcon,
  QuestionMarkCircleIcon,
} from "react-native-heroicons/outline";
import { useAiPlanner } from "../../state/AiPlannerContext";
import { ItineraryStop, StopType } from "../../data/tripsData";
import { InitialPostLocation } from "../CreatePostScreen";

interface ItineraryViewerProps {
  tripId: string;
  onBack: () => void;
  onPostCheckin?: (loc: InitialPostLocation) => void;
}

function driveLabel(mins: number): string {
  if (mins <= 0) return "";
  if (mins < 60) return `ขับรถ ~${mins} นาที`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `ขับรถ ~${h} ชม.${m ? ` ${m} นาที` : ""}`;
}

/** Color + icon + label per stop type — matches the trip plan UI in the app. */
function stopConfig(type?: StopType): {
  dotColor: string;
  badgeBg: string;
  badgeText: string;
  label: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
} {
  switch (type) {
    case "departure":
      return { dotColor: "#6366F1", badgeBg: "#EEF2FF", badgeText: "#4338CA", label: "เริ่มต้น", Icon: FlagIcon };
    case "community":
      return { dotColor: "#2D6A4F", badgeBg: "#ECFDF5", badgeText: "#065F46", label: "ชุมชน OTOP", Icon: HomeModernIcon };
    case "attraction":
      return { dotColor: "#EF4444", badgeBg: "#FEF2F2", badgeText: "#B91C1C", label: "สถานที่ท่องเที่ยว", Icon: MapPinIcon };
    case "food":
      return { dotColor: "#F59E0B", badgeBg: "#FFFBEB", badgeText: "#92400E", label: "อาหาร", Icon: SparklesIcon };
    case "cafe":
      return { dotColor: "#D97706", badgeBg: "#FEF3C7", badgeText: "#92400E", label: "คาเฟ่", Icon: BuildingStorefrontIcon };
    case "accommodation":
      return { dotColor: "#7C3AED", badgeBg: "#F5F3FF", badgeText: "#5B21B6", label: "ที่พัก", Icon: HomeModernIcon };
    case "activity":
      return { dotColor: "#0891B2", badgeBg: "#ECFEFF", badgeText: "#164E63", label: "กิจกรรม", Icon: SparklesIcon };
    case "return":
      return { dotColor: "#64748B", badgeBg: "#F1F5F9", badgeText: "#475569", label: "เดินทางกลับ", Icon: ArrowRightCircleIcon };
    default:
      return { dotColor: "#7C3AED", badgeBg: "#F5F3FF", badgeText: "#5B21B6", label: "จุดแวะ", Icon: MapPinIcon };
  }
}

export default function ItineraryViewer({ tripId, onBack, onPostCheckin }: ItineraryViewerProps) {
  const insets = useSafeAreaInsets();
  const { trips, updateTrip, setTripStatus, openChatWithSeed } = useAiPlanner();
  const trip = trips.find((t) => t.id === tripId);
  const [editing, setEditing] = useState(false);

  if (!trip) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <Text className="text-gray-400">ไม่พบทริป</Text>
      </View>
    );
  }

  const updateStop = (dayIdx: number, stopIdx: number, patch: Partial<ItineraryStop>) => {
    const itinerary = trip.itinerary.map((d, di) =>
      di === dayIdx
        ? { ...d, stops: d.stops.map((s, si) => (si === stopIdx ? { ...s, ...patch } : s)) }
        : d
    );
    updateTrip(tripId, { itinerary });
  };

  const b = trip.budget;
  const overBudget = !b.withinBudget;

  // Build a readable summary of the (possibly edited) trip and hand it to the
  // AI chat so the user can ask น้องโลคอล to re-plan or discuss it further.
  const sendBackToAi = () => {
    const dayLines = trip.itinerary
      .map((day) => {
        const stops = day.stops
          .map((s) => `   • ${s.name} — ${s.activity} (~${s.stayHours} ชม.)`)
          .join("\n");
        return `วันที่ ${day.day}:\n${stops}`;
      })
      .join("\n");
    const summary =
      `ช่วยปรับ/จัดแผนทริปนี้ใหม่ให้หน่อย หรือแนะนำเพิ่มเติมได้เลย\n\n` +
      `ทริป: ${trip.title}\n` +
      `ออกจาก: ${trip.startPoint} • ${trip.days} วัน ${trip.nights} คืน\n` +
      `งบต่อคน: ${trip.budgetPerPerson.toLocaleString()} ฿ (ประเมินใช้จริง ${b.perPerson.toLocaleString()} ฿)\n\n` +
      `${dayLines}`;
    openChatWithSeed(summary);
  };

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
        <Text className="text-[15px] font-black text-gray-900 flex-1" numberOfLines={1}>
          {trip.title}
        </Text>
        <TouchableOpacity
          onPress={() => setEditing((e) => !e)}
          className={`flex-row items-center px-3 py-1.5 rounded-full ${editing ? "bg-emerald-100" : "bg-gray-100"}`}
        >
          {editing ? <CheckIcon size={15} color="#2D6A4F" /> : <PencilSquareIcon size={15} color="#4B5563" />}
          <Text className={`text-[12px] font-bold ml-1 ${editing ? "text-[#2D6A4F]" : "text-gray-600"}`}>
            {editing ? "เสร็จ" : "แก้ไข"}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        {/* Summary */}
        <View className="px-5 pt-4 pb-2">
          <Text className="text-gray-600 text-[13px] leading-5">{trip.summary}</Text>
          <View className="flex-row items-center mt-2 flex-wrap">
            <View className="flex-row items-center mr-4">
              <MapPinIcon size={14} color="#EF4444" />
              <Text className="text-gray-500 text-[12px] ml-1">{trip.startPoint}</Text>
            </View>
            <Text className="text-gray-500 text-[12px]">
              {trip.days} วัน {trip.nights} คืน
            </Text>
          </View>
        </View>

        {/* สถานที่ที่แพลนนี้ไป — รายการเดียวกับหน้าโฟลเดอร์และในแชท
            (มาจาก backend ชุดเดียวกัน → ป้ายที่มาตรงกันทั้ง 3 ที่) */}
        {trip.folderPlaces && trip.folderPlaces.length > 0 ? (
          <View className="mx-5 my-3 rounded-2xl p-4 bg-violet-50 border border-violet-200">
            <View className="flex-row items-center mb-2.5">
              <MapPinIcon size={18} color="#6D28D9" />
              <Text className="font-bold text-[13px] ml-2 text-violet-900">
                สถานที่ที่แพลนนี้ไป
              </Text>
              <Text className="text-[11px] text-violet-700 ml-auto font-medium">
                {trip.folderPlaces.length} แห่ง
              </Text>
            </View>
            {trip.folderPlaces.map((p) => {
              const confirmed = p.source === "registry";
              return (
                <View key={p.name} className="flex-row items-center py-1.5">
                  <View className="flex-1 pr-2">
                    <Text className="text-[12.5px] font-semibold text-gray-900">
                      {p.name}
                    </Text>
                    <Text className="text-[11px] text-gray-500 mt-0.5" numberOfLines={1}>
                      {[p.communityName, p.address].filter(Boolean).join(" · ") ||
                        (confirmed ? "ยืนยันในทะเบียนสถานที่แล้ว" : "มาจากข้อความในคลิป")}
                    </Text>
                  </View>
                  {p.clipCount ? (
                    <Text className="text-[11px] text-gray-500 mr-2">
                      {p.clipCount} คลิป
                    </Text>
                  ) : null}
                  <View
                    className={`flex-row items-center rounded-full px-2 py-1 ${
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
              );
            })}
          </View>
        ) : null}

        {/* Budget summary */}
        <View className={`mx-5 my-3 rounded-2xl p-4 border ${overBudget ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"}`}>
          <View className="flex-row items-center mb-2.5">
            <BanknotesIcon size={18} color={overBudget ? "#DC2626" : "#2D6A4F"} />
            <Text className={`font-bold text-[13px] ml-2 ${overBudget ? "text-red-700" : "text-[#1B4332]"}`}>
              สรุปงบประมาณ (ต่อคน)
            </Text>
          </View>
          {[
            ["ที่พัก", b.lodging],
            ["ค่าน้ำมัน", b.fuel],
            ["ค่าอาหาร", b.food],
          ].map(([label, val]) => (
            <View key={label as string} className="flex-row justify-between mb-1">
              <Text className="text-gray-600 text-[12.5px]">{label}</Text>
              <Text className="text-gray-800 text-[12.5px] font-medium">{(val as number).toLocaleString()} ฿</Text>
            </View>
          ))}
          <View className="h-px bg-gray-200 my-2" />
          <View className="flex-row justify-between items-center">
            <Text className="text-gray-900 font-bold text-[14px]">รวม</Text>
            <Text className={`font-black text-[16px] ${overBudget ? "text-red-600" : "text-[#2D6A4F]"}`}>
              {b.perPerson.toLocaleString()} ฿
            </Text>
          </View>
          <Text className={`text-[11px] mt-1 ${overBudget ? "text-red-500" : "text-emerald-600"}`}>
            {overBudget
              ? `เกินงบที่ตั้งไว้ (${trip.budgetPerPerson.toLocaleString()} ฿)`
              : `อยู่ในงบ ${trip.budgetPerPerson.toLocaleString()} ฿ ✓`}
          </Text>
        </View>

        {/* Timeline */}
        {trip.itinerary.map((day, di) => (
          <View key={day.day} className="px-5 mt-3">
            <View className="flex-row items-center mb-3">
              <View className="bg-violet-600 rounded-xl px-3 py-1.5">
                <Text className="text-white font-black text-[13px]">Day {day.day}</Text>
              </View>
              <View className="flex-1 h-px bg-gray-200 ml-3" />
            </View>

            {day.stops.map((stop, si) => {
              const cfg = stopConfig(stop.type);
              const isLast = si === day.stops.length - 1;
              return (
              <View key={si} className="flex-row mb-1">
                {/* Timeline rail */}
                <View className="items-center mr-3" style={{ width: 24 }}>
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: cfg.dotColor, marginTop: 14 }} />
                  {!isLast && <View style={{ width: 2, flex: 1, backgroundColor: cfg.dotColor + "35", marginVertical: 3 }} />}
                </View>

                {/* Stop card */}
                <View
                  className="flex-1 rounded-2xl mb-3 overflow-hidden"
                  style={{ borderWidth: 1, borderColor: cfg.dotColor + "30", backgroundColor: "#FAFAFA" }}
                >
                  {/* Header — time + type badge */}
                  <View
                    className="flex-row items-center justify-between px-3.5 py-2"
                    style={{ backgroundColor: cfg.dotColor + "10" }}
                  >
                    <View className="flex-row items-center">
                      <ClockIcon size={13} color={cfg.dotColor} />
                      <Text style={{ color: cfg.dotColor, fontSize: 12, fontWeight: "700", marginLeft: 4 }}>
                        {stop.startTime ?? ""}
                      </Text>
                    </View>
                    <View className="flex-row items-center rounded-full px-2.5 py-0.5" style={{ backgroundColor: cfg.badgeBg }}>
                      <cfg.Icon size={11} color={cfg.badgeText} />
                      <Text style={{ color: cfg.badgeText, fontSize: 10, fontWeight: "700", marginLeft: 3 }}>
                        {cfg.label}
                      </Text>
                    </View>
                  </View>

                  {/* Body */}
                  <View className="px-3.5 py-2.5">
                    {editing ? (
                      <TextInput
                        value={stop.name}
                        onChangeText={(t) => updateStop(di, si, { name: t })}
                        className="text-[14px] font-bold text-gray-900 bg-white rounded-lg px-2 py-1 mb-1.5 border border-gray-200"
                      />
                    ) : (
                      <Text className="text-[14px] font-bold text-gray-900 mb-0.5">{stop.name}</Text>
                    )}
                    {editing ? (
                      <TextInput
                        value={stop.activity}
                        onChangeText={(t) => updateStop(di, si, { activity: t })}
                        className="text-[12.5px] text-gray-700 bg-white rounded-lg px-2 py-1 mb-2 border border-gray-200"
                      />
                    ) : (
                      <Text className="text-[12.5px] text-gray-500 mb-2">{stop.activity}</Text>
                    )}

                    {/* Tags */}
                    <View className="flex-row flex-wrap items-center">
                      {stop.stayHours > 0 && (
                        <View className="flex-row items-center bg-white rounded-full px-2.5 py-1 mr-1.5 mb-1 border border-gray-200">
                          <ClockIcon size={11} color="#6B7280" />
                          <Text className="text-[11px] text-gray-600 ml-1">{stop.stayHours} ชม.</Text>
                        </View>
                      )}
                      {(stop.estimatedCost ?? 0) > 0 && (
                        <View className="flex-row items-center bg-white rounded-full px-2.5 py-1 mr-1.5 mb-1 border border-gray-200">
                          <BanknotesIcon size={11} color="#6B7280" />
                          <Text className="text-[11px] text-gray-600 ml-1">~{stop.estimatedCost!.toLocaleString()} ฿</Text>
                        </View>
                      )}
                      {stop.verified === false && (
                        <View className="bg-amber-50 rounded-full px-2.5 py-1 mr-1.5 mb-1 border border-amber-200">
                          <Text className="text-[10px] text-amber-700">ข้อมูลประมาณการ</Text>
                        </View>
                      )}
                    </View>
                    {stop.note ? <Text className="text-[11px] text-gray-400 mt-0.5 italic">{stop.note}</Text> : null}
                  </View>

                  {/* Drive to next */}
                  {stop.driveToNextMins > 0 && (
                    <View className="flex-row items-center px-3.5 py-2 border-t border-dashed" style={{ borderColor: cfg.dotColor + "25" }}>
                      <TruckIcon size={12} color={cfg.dotColor} />
                      <Text style={{ color: cfg.dotColor, fontSize: 11, marginLeft: 5 }}>{driveLabel(stop.driveToNextMins)}</Text>
                    </View>
                  )}

                  {/* Post check-in */}
                  {(trip.status === "completed" || trip.status === "active") && (
                    <TouchableOpacity
                      onPress={() => {
                        if (onPostCheckin) {
                          onPostCheckin({ placeName: stop.name, community: stop.community || stop.name, province: stop.province, district: stop.district, coords: stop.coordinates });
                        } else {
                          Alert.alert("โพสต์เช็คอิน", `ระบบจะเปิดหน้าโพสต์คลิปพร้อมดึงสถานที่ "${stop.name}" ให้อัตโนมัติ`);
                        }
                      }}
                      activeOpacity={0.85}
                      className="flex-row items-center justify-center px-3.5 py-2 border-t"
                      style={{ borderColor: cfg.dotColor + "25", backgroundColor: cfg.dotColor + "08" }}
                    >
                      <VideoCameraIcon size={14} color={cfg.dotColor} />
                      <Text style={{ color: cfg.dotColor, fontSize: 12, fontWeight: "700", marginLeft: 5 }}>โพสต์คลิป ณ ที่นี้</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              );
            })}
          </View>
        ))}
      </ScrollView>

      {/* Footer: status transitions + send-to-AI + action buttons */}
      <View
        className="px-5 pt-3 border-t border-gray-100 bg-white"
        style={{ paddingBottom: Math.max(insets.bottom, 14) }}
      >
        {/* Status indicator bar */}
        <View className="flex-row items-center justify-between mb-2.5 bg-gray-50 p-2 rounded-xl border border-gray-200">
          <Text className="text-[11.5px] font-bold text-gray-700">สถานะทริป:</Text>
          <View className="flex-row gap-1">
            {(
              [
                ["draft", "ดราฟ"],
                ["planned", "แพลนเสร็จ"],
                ["active", "กำลังเที่ยว"],
                ["completed", "เที่ยวสำเร็จ"],
              ] as const
            ).map(([sKey, sLabel]) => (
              <TouchableOpacity
                key={sKey}
                onPress={() => {
                  setTripStatus(tripId, sKey);
                  Alert.alert("อัปเดตสถานะแล้ว", `เปลี่ยนสถานะเป็น "${sLabel}" เรียบร้อย`);
                }}
                className={`px-2 py-1 rounded-lg ${trip.status === sKey ? "bg-violet-600" : "bg-white border border-gray-200"}`}
              >
                <Text
                  className={`text-[10.5px] font-bold ${trip.status === sKey ? "text-white" : "text-gray-600"}`}
                >
                  {sLabel}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Hand the plan back to น้องโลคอล to re-plan / discuss */}
        <TouchableOpacity
          onPress={sendBackToAi}
          activeOpacity={0.85}
          className="flex-row items-center justify-center bg-violet-50 border border-violet-200 rounded-2xl py-3 mb-2"
        >
          <ChatBubbleLeftRightIcon size={18} color="#7C3AED" />
          <Text className="text-violet-700 font-bold text-[13px] ml-1.5">
            ส่งกลับไปให้ AI ช่วยจัดใหม่ / คุยต่อในแชทเดิม
          </Text>
        </TouchableOpacity>

        <View className="flex-row">
          <TouchableOpacity
            onPress={() =>
              Alert.alert(
                "ส่งออกแผนการเดินทาง",
                "บันทึกกำหนดการลงปฏิทิน (.ics) หรือแชร์รูปสรุปทริปเรียบร้อย"
              )
            }
            activeOpacity={0.85}
            className="flex-1 flex-row items-center justify-center bg-gray-100 rounded-2xl py-3.5 mr-2"
          >
            <ArrowDownTrayIcon size={18} color="#374151" />
            <Text className="text-gray-700 font-bold text-[13px] ml-1.5">ส่งออกทริป</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              const nextStatus =
                trip.status === "draft"
                  ? "planned"
                  : trip.status === "planned"
                  ? "active"
                  : "completed";
              setTripStatus(tripId, nextStatus);
              Alert.alert("บันทึกทริปแล้ว", "อัปเดตสถานะเรียบร้อย");
              onBack();
            }}
            activeOpacity={0.85}
            className="flex-1 items-center justify-center bg-violet-600 rounded-2xl py-3.5"
          >
            <Text className="text-white font-bold text-[14px]">
              {trip.status === "draft"
                ? "ยืนยันแพลนทริปนี้"
                : trip.status === "planned"
                ? "เริ่มออกเดินทาง 🚗"
                : "ปิดทริปสำเร็จ 🎉"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
