import React, { useState } from "react";
import { View } from "react-native";
import MapRegionLevel from "./MapRegionLevel";
import MapProvinceLevel from "./MapProvinceLevel";
import MapDistrictLevel from "./MapDistrictLevel";
import MapPlacesLevel from "./MapPlacesLevel";
import {
  THAILAND_GEOGRAPHIC_DATA,
  RegionItem,
  ProvinceItem,
  DistrictItem,
  PlaceItem,
  findProvinceByName,
} from "../../data/thailandGeographicData";

export type MapHierarchyLevel = "region" | "province" | "district" | "places";

export interface MapSelectionInfo {
  level: MapHierarchyLevel;
  label: string;       // display name (e.g. "ภาคเหนือ", "เชียงใหม่", "เมืองเชียงใหม่", "บ้านดอยปุย")
  regionName?: string;
  provinceName?: string;
  districtName?: string;
  placeName?: string;
}

interface MapScreenProps {
  initialProvinceName?: string;
  onBackToHome: () => void;
  onSelectPlaceForFeed?: (place: PlaceItem) => void;
  onSelectionChange?: (info: MapSelectionInfo) => void;
}

export default function MapScreen({
  initialProvinceName,
  onBackToHome,
  onSelectPlaceForFeed,
  onSelectionChange,
}: MapScreenProps) {
  // Master state holding all 6 regions, 77 provinces, 933 districts, and 3,882 OTOP spots
  const [geoData, setGeoData] = useState<RegionItem[]>(THAILAND_GEOGRAPHIC_DATA);

  // If initialProvinceName was provided, preset the selection context
  const initialMatch = initialProvinceName ? findProvinceByName(initialProvinceName) : null;
  const initialRegion = initialMatch ? initialMatch.region : geoData[0]; // defaults to North or matched
  const initialProvince = initialMatch ? initialMatch.province : initialRegion.provinces[0];
  const initialDistrict = initialProvince.districts[0];

  // Flow starts strictly at Level 1: ภาค (Region Level)
  const [currentLevel, setCurrentLevel] = useState<MapHierarchyLevel>("region");

  const [selectedRegionId, setSelectedRegionId] = useState<string>(initialRegion.id);
  const [selectedProvinceId, setSelectedProvinceId] = useState<string>(initialProvince.id);
  const [selectedDistrictId, setSelectedDistrictId] = useState<string>(initialDistrict.id);

  // Helper to get active references from refreshed geoData
  const activeRegion = geoData.find((r) => r.id === selectedRegionId) || geoData[0];
  const activeProvince =
    activeRegion.provinces.find((p) => p.id === selectedProvinceId) ||
    activeRegion.provinces[0];
  const activeDistrict =
    activeProvince.districts.find((d) => d.id === selectedDistrictId) ||
    activeProvince.districts[0];

  // Interactive toggle for visited / review checkmark
  const handleToggleVisitPlace = (placeId: string) => {
    setGeoData((prevData) => {
      return prevData.map((region) => {
        let regionVisitedProvinces = 0;
        let regionVisitedDistricts = 0;
        let regionVisitedPlaces = 0;

        const updatedProvinces = region.provinces.map((prov) => {
          let provVisitedDistricts = 0;
          let provVisitedPlaces = 0;

          const updatedDistricts = prov.districts.map((dist) => {
            const updatedPlaces = dist.places.map((place) => {
              if (place.id === placeId) {
                return { ...place, isVisited: !place.isVisited };
              }
              return place;
            });

            const visitedInDist = updatedPlaces.filter((p) => p.isVisited).length;
            provVisitedPlaces += visitedInDist;
            if (visitedInDist > 0) {
              provVisitedDistricts += 1;
            }

            return {
              ...dist,
              places: updatedPlaces,
              visitedPlaces: visitedInDist,
            };
          });

          if (provVisitedDistricts > 0) {
            regionVisitedProvinces += 1;
          }
          regionVisitedDistricts += provVisitedDistricts;
          regionVisitedPlaces += provVisitedPlaces;

          return {
            ...prov,
            districts: updatedDistricts,
            visitedDistricts: provVisitedDistricts,
            visitedPlaces: provVisitedPlaces,
          };
        });

        return {
          ...region,
          provinces: updatedProvinces,
          visitedProvinces: regionVisitedProvinces,
          visitedDistricts: regionVisitedDistricts,
          visitedPlaces: regionVisitedPlaces,
        };
      });
    });
  };

  // Step-by-step hierarchical back navigation
  const handleBack = () => {
    switch (currentLevel) {
      case "places":
        setCurrentLevel("district");
        break;
      case "district":
        setCurrentLevel("province");
        break;
      case "province":
        setCurrentLevel("region");
        break;
      case "region":
      default:
        onBackToHome();
        break;
    }
  };

  return (
    <View className="flex-1 bg-white">
      {/* 1. Level 1: ภาค (Region Level) - Choose from the 6 regions */}
      {currentLevel === "region" && (
        <MapRegionLevel
          regions={geoData}
          selectedRegion={activeRegion}
          onSelectRegion={(reg) => {
            setSelectedRegionId(reg.id);
            if (reg.provinces.length > 0) {
              setSelectedProvinceId(reg.provinces[0].id);
              if (reg.provinces[0].districts.length > 0) {
                setSelectedDistrictId(reg.provinces[0].districts[0].id);
              }
            }
            onSelectionChange?.({
              level: "region",
              label: reg.name,
              regionName: reg.name,
            });
          }}
          onNextToProvince={(reg) => {
            setSelectedRegionId(reg.id);
            if (reg.provinces.length > 0) {
              setSelectedProvinceId(reg.provinces[0].id);
              if (reg.provinces[0].districts.length > 0) {
                setSelectedDistrictId(reg.provinces[0].districts[0].id);
              }
            }
            onSelectionChange?.({
              level: "region",
              label: reg.name,
              regionName: reg.name,
            });
            setCurrentLevel("province");
          }}
          onViewAllThailand={() => {
            onBackToHome();
          }}
          onBack={handleBack}
        />
      )}

      {/* 2. Level 2: จังหวัด (Province Level) - Strictly provinces of the selected region */}
      {currentLevel === "province" && (
        <MapProvinceLevel
          region={activeRegion}
          currentProvince={activeProvince}
          onSelectProvince={(prov) => {
            setSelectedProvinceId(prov.id);
            if (prov.districts.length > 0) {
              setSelectedDistrictId(prov.districts[0].id);
            }
            onSelectionChange?.({
              level: "province",
              label: prov.name,
              regionName: activeRegion.name,
              provinceName: prov.name,
            });
          }}
          onNextToDistrict={(prov) => {
            setSelectedProvinceId(prov.id);
            if (prov.districts.length > 0) {
              setSelectedDistrictId(prov.districts[0].id);
            }
            onSelectionChange?.({
              level: "province",
              label: prov.name,
              regionName: activeRegion.name,
              provinceName: prov.name,
            });
            setCurrentLevel("district");
          }}
          onViewAllInRegion={() => {
            onBackToHome();
          }}
          onBack={handleBack}
        />
      )}

      {/* 3. Level 3: อำเภอ (District Level) - Strictly districts of the selected province */}
      {currentLevel === "district" && (
        <MapDistrictLevel
          province={activeProvince}
          currentDistrict={activeDistrict}
          onSelectDistrict={(dist) => {
            setSelectedDistrictId(dist.id);
            onSelectionChange?.({
              level: "district",
              label: dist.name,
              regionName: activeRegion.name,
              provinceName: activeProvince.name,
              districtName: dist.name,
            });
          }}
          onNextToPlaces={(dist) => {
            setSelectedDistrictId(dist.id);
            onSelectionChange?.({
              level: "district",
              label: dist.name,
              regionName: activeRegion.name,
              provinceName: activeProvince.name,
              districtName: dist.name,
            });
            setCurrentLevel("places");
          }}
          onViewAllInProvince={() => {
            onBackToHome();
          }}
          onBack={handleBack}
        />
      )}

      {/* 4. Level 4: สถานที่ท่องเที่ยวในอำเภอ (Places Level) - Grouped by 3 OTOP community types */}
      {currentLevel === "places" && (
        <MapPlacesLevel
          district={activeDistrict}
          places={activeDistrict.places}
          onToggleVisitPlace={(placeId) => {
            handleToggleVisitPlace(placeId);
            // Notify selection of a specific place
            const tappedPlace = activeDistrict.places.find((p) => p.id === placeId);
            if (tappedPlace) {
              onSelectionChange?.({
                level: "places",
                label: tappedPlace.name,
                regionName: activeRegion.name,
                provinceName: activeProvince.name,
                districtName: activeDistrict.name,
                placeName: tappedPlace.name,
              });
            }
          }}
          onViewPlaceVideo={(place) => {
            onSelectionChange?.({
              level: "places",
              label: place.name,
              regionName: activeRegion.name,
              provinceName: activeProvince.name,
              districtName: activeDistrict.name,
              placeName: place.name,
            });
            onSelectPlaceForFeed?.(place);
            onBackToHome();
          }}
          onViewAllInDistrict={() => {
            onBackToHome();
          }}
          onBack={handleBack}
        />
      )}
    </View>
  );
}
