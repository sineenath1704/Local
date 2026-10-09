import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  MapPinIcon,
  MagnifyingGlassIcon,
} from "react-native-heroicons/outline";
import { ProvinceItem, RegionItem } from "../../data/thailandGeographicData";
import ThailandMapSvg from "./ThailandMapSvg";

interface MapProvinceLevelProps {
  region: RegionItem;
  currentProvince: ProvinceItem;
  onSelectProvince: (province: ProvinceItem) => void;
  onNextToDistrict: (province: ProvinceItem) => void;
  onViewAllInRegion: () => void;
  onBack: () => void;
}

export default function MapProvinceLevel({
  region,
  currentProvince,
  onSelectProvince,
  onNextToDistrict,
  onViewAllInRegion,
  onBack,
}: MapProvinceLevelProps) {
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState("");

  // Filter ONLY provinces belonging to this region
  const filteredProvinces = region.provinces.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

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
            ย้อนกลับไประดับภาค
          </Text>
        </TouchableOpacity>

        {/* 2. Main Title: ระดับจังหวัด 0/XX จังหวัด */}
        <View className="items-center mb-4">
          <Text className="text-xs font-bold text-gray-400 tracking-wider uppercase mb-1">
            ระดับที่ 2 • เลือกระดับจังหวัด ({region.name})
          </Text>
          <Text className="text-2xl font-black text-gray-900 tracking-tight text-center">
            {region.name}{" "}
            <Text className="text-[#00D26A] font-extrabold">
              {region.visitedProvinces}/{region.totalProvinces}
            </Text>{" "}
            จังหวัด
          </Text>
          <Text className="text-xs text-gray-500 mt-1">
            มีทั้งหมด {region.totalDistricts} อำเภอ • {region.totalPlaces} แหล่งท่องเที่ยว OTOP
          </Text>
        </View>

        {/* 2.5 Map Graphic for Province Selection */}
        <View className="items-center justify-center my-1 bg-gray-50/70 py-3 rounded-3xl border border-gray-100 overflow-hidden">
          <ThailandMapSvg 
            width={300} 
            height={400} 
            viewLevel="province" 
            selectedRegionId={region.id}
            selectedProvinceName={currentProvince.name}
            onPressProvince={(provinceName) => {
              const prov = region.provinces.find((p) => p.name === provinceName);
              if (prov) {
                if (currentProvince.name === provinceName) {
                  onNextToDistrict(prov);
                } else {
                  onSelectProvince(prov);
                }
              }
            }}
          />
          <Text className="text-gray-400 text-[11px] mt-1 text-center font-medium">
            แตะ 1 ครั้งเพื่อเลือก • แตะซ้ำเพื่อเข้าสู่ระดับอำเภอ • สองนิ้วเพื่อซูม
          </Text>
        </View>

        {/* 5. Action Button: [ เลือกดูทั้งหมดในภาค... ] */}
        <TouchableOpacity
          onPress={onViewAllInRegion}
          activeOpacity={0.85}
          className="bg-[#266348] py-3.5 rounded-2xl items-center justify-center mt-2 mb-4 shadow-sm shadow-emerald-950/20"
        >
          <Text className="text-white text-[15px] font-bold tracking-wide">
            เลือกดูทั้งหมดใน{region.name}
          </Text>
        </TouchableOpacity>

        {/* 3. Search Bar for Provinces within this region */}
        <View className="flex-row items-center bg-gray-100 rounded-2xl px-3.5 py-2.5 mb-4 border border-gray-200">
          <MagnifyingGlassIcon size={18} color="#9CA3AF" />
          <TextInput
            placeholder={`ค้นหาจังหวัดใน${region.name}...`}
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
            className="flex-1 ml-2.5 text-sm text-gray-900 py-0"
          />
        </View>

        {/* 4. Provinces List of this Region */}
        <View className="mb-4">
          <Text className="text-gray-900 text-sm font-bold mb-3">
            จังหวัดใน{region.name} ({filteredProvinces.length} จังหวัด):
          </Text>

          {filteredProvinces.map((prov, index) => {
            const isSelected = prov.id === currentProvince.id;

            return (
              <TouchableOpacity
                key={prov.id}
                onPress={() => {
                  onSelectProvince(prov);
                  onNextToDistrict(prov);
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
                    <Text
                      className={`text-base font-bold ${
                        isSelected ? "text-[#1B4332]" : "text-gray-900"
                      }`}
                    >
                      จังหวัด{prov.name}
                    </Text>
                    <Text className="text-gray-500 text-xs mt-0.5">
                      {prov.totalDistricts} อำเภอ • {prov.totalPlaces} แหล่งท่องเที่ยว OTOP
                    </Text>
                  </View>
                </View>

                {/* District Count Badge & Arrow */}
                <View className="flex-row items-center">
                  <View className="bg-white px-2.5 py-1 rounded-full border border-gray-200 mr-2 shadow-xs">
                    <Text className="text-xs font-black text-[#00D26A]">
                      {prov.visitedDistricts}/{prov.totalDistricts} อ.
                    </Text>
                  </View>
                  <ChevronRightIcon size={18} color="#9CA3AF" />
                </View>
              </TouchableOpacity>
            );
          })}

          {filteredProvinces.length === 0 && (
            <View className="py-8 items-center justify-center">
              <Text className="text-gray-400 text-sm">
                ไม่พบจังหวัดที่ค้นหาใน{region.name}
              </Text>
            </View>
          )}
        </View>

      </ScrollView>
    </View>
  );
}
