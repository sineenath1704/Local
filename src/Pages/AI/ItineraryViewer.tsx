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
} from "react-native-heroicons/outline";
import { useAiPlanner } from "../../state/AiPlannerContext";
import { ItineraryStop } from "../../data/tripsData";
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

            {day.stops.map((stop, si) => (
              <View key={si} className="flex-row mb-1">
                {/* Timeline rail */}
                <View className="items-center mr-3">
                  <View className="w-3 h-3 rounded-full bg-violet-600 mt-1.5" />
                  {si < day.stops.length - 1 && <View className="w-0.5 flex-1 bg-violet-200 my-1" />}
                </View>

                {/* Stop card */}
                <View className="flex-1 bg-gray-50 border border-gray-100 rounded-2xl p-3.5 mb-2">
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
                    <Text className="text-[12.5px] text-gray-600 mb-2">{stop.activity}</Text>
                  )}

                  <View className="flex-row items-center flex-wrap">
                    <View className="flex-row items-center bg-white rounded-full px-2.5 py-1 mr-2 border border-gray-200">
                      <ClockIcon size={12} color="#2D6A4F" />
                      {editing ? (
                        <TextInput
                          value={String(stop.stayHours)}
                          onChangeText={(t) => updateStop(di, si, { stayHours: Number(t) || 0 })}
                          keyboardType="numeric"
                          className="text-[11px] text-gray-700 ml-1 min-w-[24px] py-0"
                        />
                      ) : (
                        <Text className="text-[11px] text-gray-700 ml-1">อยู่ ~{stop.stayHours} ชม.</Text>
                      )}
                    </View>
                    {stop.driveToNextMins > 0 && (
                      <View className="flex-row items-center bg-white rounded-full px-2.5 py-1 border border-gray-200">
                        <TruckIcon size={12} color="#D47A3A" />
                        <Text className="text-[11px] text-gray-700 ml-1">{driveLabel(stop.driveToNextMins)}</Text>
                      </View>
                    )}
                  </View>

                  {/* Post check-in button if trip is completed or active */}
                  {(trip.status === "completed" || trip.status === "active") && (
                    <TouchableOpacity
                      onPress={() => {
                        if (onPostCheckin) {
                          onPostCheckin({
                            placeName: stop.name,
                            community: stop.community || stop.name,
                            province: stop.province,
                            district: stop.district,
                            coords: stop.coordinates,
                          });
                        } else {
                          Alert.alert(
                            "โพสต์เช็คอิน",
                            `ระบบจะเปิดหน้าโพสต์คลิปพร้อมดึงสถานที่ "${stop.name}" ให้อัตโนมัติ`
                          );
                        }
                      }}
                      activeOpacity={0.8}
                      className="mt-2.5 bg-violet-600 rounded-xl py-2 px-3 flex-row items-center justify-center self-start"
                    >
                      <VideoCameraIcon size={14} color="#FFFFFF" />
                      <Text className="text-white text-[11.5px] font-bold ml-1.5">
                        โพสต์คลิปที่นี่ 📹
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
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
