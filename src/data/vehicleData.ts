/**
 * ฐานข้อมูลรถยอดนิยมในไทย + ตัวช่วยแนะนำรุ่น (พิมพ์แบรนด์ → เลือกรุ่น)
 * ============================================================
 * ย้ายออกจาก `TripDraftCard` (การ์ดฟอร์ม 4 ขั้นตอนที่ถูกเลิกใช้แล้ว)
 * → ตอนนี้ทั้ง "การ์ดถามทีละคำถาม" (ก่อนสร้างแพลน) และ "การ์ดแพลน"
 *   (ตอนสรุปค่าใช้จ่าย) ใช้ชุดข้อมูลชุดเดียวกัน
 *
 * กติกาสำคัญ (ข้อ 2.3 ของผู้ใช้):
 *   แค่ "เลือกรถ" ห้ามคำนวณค่าใช้จ่ายทันที — ต้องรอผู้ใช้กดส่ง/ยืนยันก่อน
 *   → ทั้งสองที่ใช้ชุดนี้ ต้องเก็บค่าไว้ในสถานะก่อน แล้วค่อยคำนวณตอนกดส่ง
 */

/** หมวดรถที่ให้เลือกได้ (สั้น ๆ สำหรับผู้ใช้) */
export type VehicleCategory = "car" | "ev" | "motorcycle" | "van";

export interface VehicleModelPreset {
  /** ชื่อรุ่น (ใช้ทั้งเป็นคำค้นและเป็นชื่อที่ส่งให้ backend) */
  name: string;
  category: VehicleCategory;
  /** ป้ายชนิดพลังงานที่แนะนำ (แสดงใต้ชื่อรุ่น) */
  fuelLabel: string;
}

export const VEHICLE_CATEGORY_OPTIONS: {
  key: VehicleCategory;
  label: string;
}[] = [
  { key: "car", label: "รถยนต์" },
  { key: "ev", label: "รถไฟฟ้า" },
  { key: "motorcycle", label: "มอเตอร์ไซค์" },
  { key: "van", label: "รถตู้" },
];

/**
 * key ของรถที่ backend เข้าใจ (ดู `backend/src/vehicles.ts`)
 * → รถตู้ = "van" · มอเตอร์ไซค์ = "motorbike" (ไม่ใช่ "motorcycle")
 */
export const VEHICLE_KEY_BY_CATEGORY: Record<VehicleCategory, string> = {
  car: "private_car",
  ev: "ev",
  motorcycle: "motorbike",
  van: "van",
};

export const POPULAR_VEHICLE_MODELS: VehicleModelPreset[] = [
  // รถยนต์ไฟฟ้า (EV)
  { name: "BYD Atto 3", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "BYD Dolphin", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "BYD Seal", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "BYD Sealion 6", category: "ev", fuelLabel: "PHEV/ไฟฟ้า" },
  { name: "ORA Good Cat", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "ORA 07", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "Tesla Model 3", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "Tesla Model Y", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "MG 4 Electric", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "MG ZS EV", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "NETA V", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "NETA V-II", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "AION Y Plus", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "Deepal S07", category: "ev", fuelLabel: "ไฟฟ้า 100%" },
  { name: "Deepal L07", category: "ev", fuelLabel: "ไฟฟ้า 100%" },

  // รถยนต์ทั่วไป / Sedan / SUV / Eco Car
  { name: "Toyota Yaris Ativ", category: "car", fuelLabel: "เบนซิน/E20" },
  { name: "Toyota Yaris Cross", category: "car", fuelLabel: "ไฮบริด (HEV)" },
  { name: "Toyota Corolla Altis", category: "car", fuelLabel: "เบนซิน/E20" },
  { name: "Toyota Corolla Cross", category: "car", fuelLabel: "ไฮบริด (HEV)" },
  { name: "Toyota Fortuner", category: "car", fuelLabel: "ดีเซล" },
  { name: "Toyota Hilux Revo", category: "car", fuelLabel: "ดีเซล" },
  { name: "Toyota Camry", category: "car", fuelLabel: "เบนซิน/HEV" },
  { name: "Honda City", category: "car", fuelLabel: "เบนซิน/E20" },
  { name: "Honda City e:HEV", category: "car", fuelLabel: "ไฮบริด (e:HEV)" },
  { name: "Honda City Hatchback", category: "car", fuelLabel: "เบนซิน/E20" },
  { name: "Honda Civic", category: "car", fuelLabel: "เบนซิน/e:HEV" },
  { name: "Honda HR-V", category: "car", fuelLabel: "ไฮบริด (e:HEV)" },
  { name: "Honda CR-V", category: "car", fuelLabel: "เบนซิน/e:HEV" },
  { name: "Isuzu D-Max", category: "car", fuelLabel: "ดีเซล" },
  { name: "Isuzu MU-X", category: "car", fuelLabel: "ดีเซล" },
  { name: "Mazda 2", category: "car", fuelLabel: "เบนซิน/ดีเซล" },
  { name: "Mazda 3", category: "car", fuelLabel: "เบนซิน" },
  { name: "Mazda CX-30", category: "car", fuelLabel: "เบนซิน" },
  { name: "Mitsubishi Xpander", category: "car", fuelLabel: "เบนซิน/HEV" },
  { name: "Mitsubishi Pajero Sport", category: "car", fuelLabel: "ดีเซล" },
  { name: "Ford Ranger", category: "car", fuelLabel: "ดีเซล" },
  { name: "Ford Everest", category: "car", fuelLabel: "ดีเซล" },
  { name: "Nissan Almera", category: "car", fuelLabel: "เบนซิน Turbo" },
  { name: "Suzuki Swift", category: "car", fuelLabel: "เบนซิน/E20" },

  // มอเตอร์ไซค์
  { name: "Honda Wave 110i", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Honda Wave 125i", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Honda PCX 160", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Honda Click 160", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Honda ADV 160", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Honda ADV 350", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Honda Forza 350", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Yamaha Grand Filano", category: "motorcycle", fuelLabel: "เบนซิน Hybrid" },
  { name: "Yamaha Aerox 155", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Yamaha XMAX 300", category: "motorcycle", fuelLabel: "เบนซิน" },
  { name: "Vespa Sprint 150", category: "motorcycle", fuelLabel: "เบนซิน" },

  // รถตู้
  { name: "Toyota Commuter", category: "van", fuelLabel: "ดีเซล" },
  { name: "Toyota Hiace", category: "van", fuelLabel: "ดีเซล" },
  { name: "Hyundai H-1", category: "van", fuelLabel: "ดีเซล" },
  { name: "Hyundai Staria", category: "van", fuelLabel: "ดีเซล" },
  { name: "Toyota Majesty", category: "van", fuelLabel: "ดีเซล" },
  { name: "Toyota Alphard", category: "van", fuelLabel: "เบนซิน/HEV" },
];

/**
 * แนะนำรุ่นรถจากคำที่พิมพ์ (พิมพ์แบรนด์ → ได้รุ่นที่ตรงกับแบรนด์นั้น)
 * -------------------------------------------------------------
 * · พิมพ์ยังไม่ครบ (ว่าง) → แสดงรุ่นยอดนิยมของหมวดนั้น
 * · พิมพ์แล้ว → กรองเฉพาะรุ่นที่ชื่อมีคำที่พิมพ์
 */
export function vehicleModelSuggestions(
  query: string,
  category?: VehicleCategory | null,
  limit = 10
): VehicleModelPreset[] {
  const q = (query ?? "").trim().toLowerCase();
  const pool = category
    ? POPULAR_VEHICLE_MODELS.filter((m) => m.category === category)
    : POPULAR_VEHICLE_MODELS;
  if (!q) return pool.slice(0, 8);
  return pool.filter((m) => m.name.toLowerCase().includes(q)).slice(0, limit);
}

/**
 * แปลง "ประเภทรถ" ที่ผู้ใช้เลือกไว้ (หรือที่ระบบเดาจากรุ่นรถ) → หมวดของเรา
 * → ใช้กรองรายการรุ่นให้ตรงกับรถที่ผู้ใช้มี
 */
export function vehicleCategoryOf(
  vehicle?: string | null,
  model?: string | null
): VehicleCategory | null {
  const raw = (vehicle ?? "").trim().toLowerCase();
  if (raw === "ev") return "ev";
  if (raw === "van" || raw === "public") return raw === "van" ? "van" : null;
  if (raw === "motorbike" || raw === "motorcycle") return "motorcycle";
  if (raw === "private_car" || raw === "diesel_car" || raw === "pickup") return "car";
  // ไม่ระบุประเภท → เดาจากชื่อรุ่นที่ผู้ใช้พิมพ์
  const name = (model ?? "").trim().toLowerCase();
  if (!name) return null;
  const hit = POPULAR_VEHICLE_MODELS.find(
    (m) => m.name.toLowerCase() === name
  );
  return hit?.category ?? null;
}
