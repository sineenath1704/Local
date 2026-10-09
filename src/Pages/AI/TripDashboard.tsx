import React, { useState } from "react";
import { View, Text, TouchableOpacity, FlatList } from "react-native";
import {
  SparklesIcon,
  MapIcon,
  BanknotesIcon,
  CalendarDaysIcon,
} from "react-native-heroicons/outline";
import { useAiPlanner } from "../../state/AiPlannerContext";
import { Trip, TripStatus } from "../../data/tripsData";

interface TripDashboardProps {
  onNewTrip: () => void;
  onOpenTrip: (tripId: string) => void;
}

const TABS: { key: TripStatus; label: string }[] = [
  { key: "upcoming", label: "กำลังจะไป" },
  { key: "draft", label: "แบบร่าง" },
  { key: "past", label: "ผ่านมาแล้ว" },
];

export default function TripDashboard({ onNewTrip, onOpenTrip }: TripDashboardProps) {
  const { tripsByStatus } = useAiPlanner();
  const [tab, setTab] = useState<TripStatus>("upcoming");
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
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setTab(t.key)}
              activeOpacity={0.7}
              className={`mr-2 px-4 py-2 rounded-full ${active ? "bg-gray-900" : "bg-gray-100"}`}
            >
              <Text className={`text-[12px] font-bold ${active ? "text-white" : "text-gray-500"}`}>
                {t.label} ({tripsByStatus(t.key).length})
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
          <View className="py-16 items-center px-10">
            <CalendarDaysIcon size={40} color="#D1D5DB" />
            <Text className="text-gray-400 text-sm text-center mt-3">
              {tab === "upcoming"
                ? "ยังไม่มีทริปที่กำลังจะไป กดสร้างทริปใหม่ด้วย AI ได้เลย"
                : tab === "draft"
                ? "ยังไม่มีแบบร่าง"
                : "ยังไม่มีทริปที่ผ่านมา"}
            </Text>
          </View>
        }
      />
    </View>
  );
}
