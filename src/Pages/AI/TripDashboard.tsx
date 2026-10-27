import React, { useState } from "react";
import { View, Text, TouchableOpacity, FlatList } from "react-native";
import {
  SparklesIcon,
  MapIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  FolderIcon,
} from "react-native-heroicons/outline";
import { useAiPlanner } from "../../state/AiPlannerContext";
import { Trip, TripStatus } from "../../data/tripsData";

interface TripDashboardProps {
  onNewTrip: () => void;
  onOpenTrip: (tripId: string) => void;
}

const TABS: { key: TripStatus; label: string; icon: string }[] = [
  { key: "draft", label: "ดราฟ", icon: "📝" },
  { key: "planned", label: "แพลนเสร็จ", icon: "🗓️" },
  { key: "active", label: "กำลังเที่ยว", icon: "🚗" },
  { key: "completed", label: "เที่ยวสำเร็จ", icon: "✅" },
];

export default function TripDashboard({ onNewTrip, onOpenTrip }: TripDashboardProps) {
  const { tripsByStatus } = useAiPlanner();
  const [tab, setTab] = useState<TripStatus>("draft");
  const list = tripsByStatus(tab);

  const renderTrip = ({ item }: { item: Trip }) => (
    <TouchableOpacity
      onPress={() => onOpenTrip(item.id)}
      activeOpacity={0.8}
      className="bg-white border border-gray-200 rounded-2xl p-4 mb-3 shadow-sm"
    >
      <View className="flex-row items-center justify-between mb-1.5">
        <Text className="text-[15px] font-black text-gray-900 flex-1 mr-2" numberOfLines={1}>
          {item.title}
        </Text>
        <View className="bg-violet-100 rounded-full px-2.5 py-0.5">
          <Text className="text-violet-700 text-[10px] font-bold">
            {item.days} วัน {item.nights} คืน
          </Text>
        </View>
      </View>
      <Text className="text-gray-500 text-[12px] mb-3" numberOfLines={2}>
        {item.summary}
      </Text>
      <View className="flex-row items-center">
        <View className="flex-row items-center mr-4">
          <MapIcon size={14} color="#7C3AED" />
          <Text className="text-gray-600 text-[11px] ml-1">{item.destinations.length} จุดแวะ</Text>
        </View>
        <View className="flex-row items-center">
          <BanknotesIcon size={14} color={item.budget.withinBudget ? "#2D6A4F" : "#DC2626"} />
          <Text className={`text-[11px] ml-1 font-semibold ${item.budget.withinBudget ? "text-[#2D6A4F]" : "text-red-600"}`}>
            {item.budget.perPerson.toLocaleString()} ฿/คน
          </Text>
        </View>
      </View>
      {item.sourceFolderId ? (
        <View className="flex-row items-center mt-2 self-start bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
          <FolderIcon size={11} color="#B45309" />
          <Text className="text-amber-800 text-[10.5px] font-semibold ml-1">
            มาจากโฟลเดอร์ที่บันทึกไว้
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View className="flex-1">
      {/* New trip CTA */}
      <TouchableOpacity
        onPress={onNewTrip}
        activeOpacity={0.9}
        className="mx-4 mt-3 mb-4 bg-violet-600 rounded-2xl p-4 flex-row items-center justify-center shadow-lg shadow-violet-300"
      >
        <SparklesIcon size={20} color="#FFFFFF" />
        <Text className="text-white font-black text-[15px] ml-2">สร้างทริปใหม่ด้วย AI</Text>
      </TouchableOpacity>

      {/* Sub-tabs */}
      <View className="flex-row px-4 mb-2">
        {TABS.map((t) => {
          const active = tab === t.key;
          const count = tripsByStatus(t.key).length;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setTab(t.key)}
              activeOpacity={0.7}
              className={`flex-1 flex-row items-center justify-center py-2 rounded-xl mx-0.5 ${
                active ? "bg-violet-600" : "bg-gray-100"
              }`}
            >
              <Text className="text-[11px] mr-1">{t.icon}</Text>
              <Text className={`text-[11.5px] font-bold ${active ? "text-white" : "text-gray-600"}`}>
                {t.label} {count > 0 ? `(${count})` : ""}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={list}
        keyExtractor={(t) => t.id}
        renderItem={renderTrip}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View className="py-16 items-center px-8">
            <Text className="text-[36px] mb-2">{TABS.find((t) => t.key === tab)?.icon || "🗺️"}</Text>
            <Text className="text-gray-900 font-bold text-[15px] mb-1">
              ยังไม่มีทริปในหมวด "{TABS.find((t) => t.key === tab)?.label}"
            </Text>
            <Text className="text-gray-400 text-[12px] text-center leading-5 max-w-[260px]">
              {tab === "draft"
                ? "คุยกับ AI ในแท็บแชทแล้วกด 'เลือกแพลนทริปนี้' เพื่อนำมาบันทึกร่างที่นี่"
                : tab === "planned"
                ? "เมื่อตรวจสอบร่างทริปเรียบร้อย กด 'ยืนยันแพลนทริป' เพื่อเตรียมเดินทาง"
                : tab === "active"
                ? "กด 'เริ่มออกเดินทาง' เพื่อติดตามกิจกรรมและเวลาจริงระหว่างเที่ยว"
                : "ทริปที่เที่ยวเสร็จสิ้นแล้ว สามารถกดโพสต์คลิปรีวิวและเช็คอินเพื่อสะสมตราปั๊มได้ที่นี่"}
            </Text>
          </View>
        }
      />
    </View>
  );
}
