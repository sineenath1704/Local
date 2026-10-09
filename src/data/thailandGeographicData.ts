import rawData from "./thailand_hierarchy.json";

export interface PlaceItem {
  id: string;
  name: string;
  subdistrict: string;
  districtName: string;
  provinceName: string;
  regionName: string;
  category: "ชุมชนท่องเที่ยว OTOP นวัตวิถี" | "ชุมชน OTOP เพื่อการท่องเที่ยว" | "หมู่บ้านท่องเที่ยวโดยชุมชน";
  highlight: string;
  isVisited: boolean; // ติ๊กถูกแล้ว (ลงคลิปรีวิวและปักหมุดแล้ว)
  reviewClipCount: number;
}

export interface DistrictItem {
  id: string;
  name: string;
  provinceName: string;
  regionId: string;
  regionName: string;
  totalPlaces: number;
  visitedPlaces: number;
  places: PlaceItem[];
}

export interface ProvinceItem {
  id: string;
  name: string;
  regionId: string;
  regionName: string;
  totalDistricts: number;
  visitedDistricts: number;
  totalPlaces: number;
  visitedPlaces: number;
  districts: DistrictItem[];
}

export interface RegionItem {
  id: string;
  name: string;
  nameEn: string;
  color: string;
  totalProvinces: number;
  visitedProvinces: number;
  totalDistricts: number;
  visitedDistricts: number;
  totalPlaces: number;
  visitedPlaces: number;
  provinces: ProvinceItem[];
}

export const THAILAND_GEOGRAPHIC_DATA: RegionItem[] = rawData as RegionItem[];

/** Helper to find a province by its name anywhere in Thailand */
export function findProvinceByName(provinceName: string): { region: RegionItem; province: ProvinceItem } | null {
  const cleanName = provinceName.replace("จ.", "").replace("จังหวัด", "").trim();
  for (const region of THAILAND_GEOGRAPHIC_DATA) {
    const foundProv = region.provinces.find((p) => p.name === cleanName || p.name.includes(cleanName) || cleanName.includes(p.name));
    if (foundProv) {
      return { region, province: foundProv };
    }
  }
  return null;
}
