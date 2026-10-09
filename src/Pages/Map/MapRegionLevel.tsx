import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeftIcon, ChevronRightIcon, MapPinIcon } from "react-native-heroicons/outline";
import { RegionItem } from "../../data/thailandGeographicData";
import ThailandMapSvg from "./ThailandMapSvg";

interface MapRegionLevelProps {
  regions: RegionItem[];
  selectedRegion: RegionItem;
  onSelectRegion: (region: RegionItem) => void;
  onNextToProvince: (region: RegionItem) => void;
  onViewAllThailand: () => void;
  onBack: () => void;
}

export default function MapRegionLevel({
  regions,
  selectedRegion,
  onSelectRegion,
  onNextToProvince,
  onViewAllThailand,
  onBack,
}: MapRegionLevelProps) {
  const insets = useSafeAreaInsets();

  // Total visited & total provinces nationwide
  const totalVisitedProvinces = regions.reduce((sum, r) => sum + r.visitedProvinces, 0);
  const totalProvinces = regions.reduce((sum, r) => sum + r.totalProvinces, 0);

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 16) + 10,
          paddingBottom: Math.max(insets.bottom, 20) + 90,
          paddingHorizontal: 20,
        }}
      >
        {/* 1. Header Back Button */}
        <TouchableOpacity
          onPress={onBack}
          activeOpacity={0.7}
          className="flex-row items-center self-start mb-4"
        >
          <ArrowLeftIcon size={20} color="#2D6A4F" strokeWidth={2.5} />
          <Text className="text-[#2D6A4F] text-base font-bold ml-2">
            ย้อนกลับ
          </Text>
        </TouchableOpacity>

        {/* 2. Main Title: ระดับภาค 0/77 จังหวัด */}
        <View className="items-center mb-4">
          <Text className="text-xs font-bold text-gray-400 tracking-wider uppercase mb-1">
            ระดับที่ 1 • เลือกระดับภูมิภาค (6 ภาค)
          </Text>
          <Text className="text-2xl font-black text-gray-900 tracking-tight text-center">
            {selectedRegion.name}{" "}
            <Text className="text-[#00D26A] font-extrabold">
              {selectedRegion.visitedProvinces}/{selectedRegion.totalProvinces}
            </Text>{" "}
            จังหวัด
          </Text>
          <Text className="text-xs text-gray-500 mt-1">
            ทั่วประเทศ: {totalVisitedProvinces}/{totalProvinces} จังหวัด • 933 อำเภอ
          </Text>
        </View>

        {/* 3. Thailand Map Graphic with Interactive Regions */}
        <View className="items-center justify-center my-1 bg-gray-50/70 py-3 rounded-3xl border border-gray-100 overflow-hidden">
          <ThailandMapSvg 
            width={300} 
            height={400} 
            viewLevel="region" 
            selectedRegionId={selectedRegion.id} 
            onPressRegion={(regionId) => {
              const reg = regions.find((r) => r.id === regionId);
              if (reg) {
                if (selectedRegion.id === regionId) {
                  onNextToProvince(reg);
                } else {
                  onSelectRegion(reg);
                }
              }
            }} 
          />

          <Text className="text-gray-400 text-[11px] mt-1 text-center font-medium">
            แตะ 1 ครั้งเพื่อเลือก • แตะซ้ำเพื่อเข้าสู่ระดับจังหวัด • สองนิ้วเพื่อซูม
          </Text>
        </View>

        {/* 5. Action Button: [ เลือกดูทั้งหมดในประเทศไทย ] */}
        <TouchableOpacity
          onPress={onViewAllThailand}
          activeOpacity={0.85}
          className="bg-[#266348] py-3.5 rounded-2xl items-center justify-center mt-2 mb-4 shadow-sm shadow-emerald-950/20"
        >
          <Text className="text-white text-[15px] font-bold tracking-wide">
            เลือกดูทั้งหมดในประเทศไทย
          </Text>
        </TouchableOpacity>

        {/* 4. The 6 Regions Clean Cards Grid / List */}
        <View className="mt-5 mb-3">
          <Text className="text-gray-900 text-sm font-bold mb-3">
            เลือกภูมิภาคที่ต้องการสำรวจ:
          </Text>

          {regions.map((reg, index) => {
            const isSelected = reg.id === selectedRegion.id;

            return (
              <TouchableOpacity
                key={reg.id}
                onPress={() => {
                  onSelectRegion(reg);
                  onNextToProvince(reg);
                }}
                activeOpacity={0.8}
                className={`p-4 rounded-2xl mb-2.5 flex-row items-center justify-between border ${
                  isSelected
                    ? "bg-[#E8F5E9] border-[#00D26A]"
                    : "bg-gray-50/80 border-gray-200/70"
                }`}
              >
                <View className="flex-row items-center flex-1 mr-3">
                  <View
                    className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
                      isSelected ? "bg-[#2D6A4F]" : "bg-gray-200"
                    }`}
                  >
                    <MapPinIcon
                      size={20}
                      color={isSelected ? "#FFFFFF" : "#4B5563"}
                    />
                  </View>

                  <View className="flex-1">
                    <View className="flex-row items-center">
                      <Text
                        className={`text-base font-bold ${
                          isSelected ? "text-[#1B4332]" : "text-gray-900"
                        }`}
                      >
                        {index + 1}. {reg.name}
                      </Text>
                      <Text className="text-gray-400 text-xs ml-1.5 font-medium">
                        ({reg.nameEn})
                      </Text>
                    </View>
                    <Text className="text-gray-500 text-xs mt-0.5">
                      {reg.totalDistricts} อำเภอ • {reg.totalPlaces} ชุมชน OTOP
                    </Text>
                  </View>
                </View>

                {/* Province Count Badge & Arrow */}
                <View className="flex-row items-center">
                  <View className="bg-white px-2.5 py-1 rounded-full border border-gray-200 mr-2 shadow-xs">
                    <Text className="text-xs font-black text-[#00D26A]">
                      {reg.visitedProvinces}/{reg.totalProvinces} จว.
                    </Text>
                  </View>
                  <ChevronRightIcon size={18} color="#9CA3AF" />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

      </ScrollView>
    </View>
  );
}
