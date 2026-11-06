/**
 * โปรไฟล์รถ + สูตรคิดค่าน้ำมัน
 * -------------------------------------------------------------
 * ใช้กับแผนทริปของ AI (POST /trips/plan)
 *
 * หลักการ: ชนิดน้ำมันไม่ผูกกับรถ — ผู้ใช้เลือกเองได้ เพราะรถคันเดียวกัน
 * จะเติมน้ำมันคนละชนิดกันได้ และราคามาจากตารางสดใน `fuelPrice.ts`
 */

export type VehicleKey =
  | "private_car"
  | "diesel_car"
  | "pickup"
  | "van"
  | "motorbike"
  | "ev"
  | "public";

export type FuelType =
  | "gasohol95"
  | "gasohol91"
  | "gasoholE20"
  | "dieselB20"
  | "diesel"
  | "premiumDiesel"
  | "gsh95"
  | "x99"
  | "gasoline95"
  | "electric";

/** ชื่อที่แสดงในแอป (ใช้ตรงกับ alt ของภาพบนเว็บ pttor.com) */
export const FUEL_TYPE_LABELS: Record<string, string> = {
  gasohol95: "แก๊สโซฮอล์ 95",
  gasohol91: "แก๊สโซฮอล์ 91",
  gasoholE20: "แก๊สโซฮอล์ E20",
  dieselB20: "ดีเซล B20",
  diesel: "ดีเซล",
  premiumDiesel: "พรีเมียมดีเซล",
  gsh95: "ซูเปอร์โพเวอร์ GSH95",
  x99: "ซูเปอร์โพเวอร์ X99",
  gasoline95: "แก๊สโซฮอล์ 95 (พรีเมียม)",
  electric: "ไฟฟ้า",
};

export interface VehicleProfile {
  key: VehicleKey;
  label: string;
  /** กิโลเมตรต่อลิตร · null = ไม่ใช้น้ำมัน (ไฟฟ้า / ขนส่งสาธารณะ) */
  kmPerLitre: number | null;
  /** กิโลวัตต์ต่อ 100 กม. (รถไฟฟ้าเท่านั้น) */
  energyPer100km?: number;
  /** ชนิดน้ำมันที่ตั้งเป็นค่าเริ่มต้นของรถ (ผู้ใช้เปลี่ยนได้) */
  defaultFuelType: FuelType | null;
  /** true = คิดค่าเดินทางแยก ไม่คิดค่าน้ำมัน */
  usesFuel: boolean;
}

export const VEHICLES: VehicleProfile[] = [
  {
    key: "private_car",
    label: "รถยนต์ส่วนตัว",
    kmPerLitre: 12,
    defaultFuelType: "gasohol95",
    usesFuel: true,
  },
  {
    key: "diesel_car",
    label: "รถยนต์ดีเซล",
    kmPerLitre: 15,
    defaultFuelType: "diesel",
    usesFuel: true,
  },
  {
    key: "pickup",
    label: "รถปิคอัพ",
    kmPerLitre: 9,
    defaultFuelType: "gasohol95",
    usesFuel: true,
  },
  {
    key: "van",
    label: "รถตู้ 7 ที่นั่ง",
    kmPerLitre: 10,
    defaultFuelType: "diesel",
    usesFuel: true,
  },
  {
    key: "motorbike",
    label: "มอเตอร์ไซค์",
    kmPerLitre: 30,
    defaultFuelType: "gasohol95",
    usesFuel: true,
  },
  {
    key: "ev",
    label: "รถไฟฟ้า",
    kmPerLitre: null,
    // ค่ากลางของรถไฟฟ้าในไทย (~15–20 kWh/100 กม.) → ใช้ 18 เป็นค่าประมาณการ
    energyPer100km: 18,
    defaultFuelType: "electric",
    usesFuel: false,
  },
  {
    key: "public",
    label: "ขนส่งสาธารณะ / รถไฟ / เครื่องบิน",
    kmPerLitre: null,
    defaultFuelType: null,
    usesFuel: false,
  },
];

export const VEHICLE_BY_KEY: Record<string, VehicleProfile> = VEHICLES.reduce(
  (acc, v) => {
    acc[v.key] = v;
    return acc;
  },
  {} as Record<string, VehicleProfile>
);

export function getVehicle(key: string | null | undefined): VehicleProfile {
  if (key && VEHICLE_BY_KEY[key]) return VEHICLE_BY_KEY[key];
  return VEHICLES[0];
}

/**
 * ค่าน้ำมัน (บาท)
 * สูตรเดียวกับที่ TRIP_SYSTEM_PROMPT เขียนไว้แล้ว:
 *   ระยะ (กม.) ÷ อัตราการสิ้นกิโลเมตรต่อลิตร × ราคาต่อลิตร
 */
export function fuelCost(
  km: number,
  vehicle: VehicleProfile,
  pricePerLitre: number | null
): number {
  if (!vehicle.usesFuel) return 0;
  if (!vehicle.kmPerLitre || !pricePerLitre) return 0;
  if (!Number.isFinite(km) || km <= 0) return 0;
  const litres = km / vehicle.kmPerLitre;
  const cost = litres * pricePerLitre;
  return Math.round(cost * 100) / 100;
}

/**
 * รถไฟฟ้า — คิดเป็น กิโลวัตต์ต่อ 100 กม. × ราคาต่อกิโลวัตต์
 * (ไม่ดึงราคาไฟจากเว็บ เพราะราคาขึ้นกับหน่วยงาน/โรงไฟฟ้า → ให้ผู้ใช้กรอกเอง)
 */
export function evCost(
  km: number,
  kwhPer100km: number | null,
  pricePerKwh: number | null
): number {
  if (!kwhPer100km || !pricePerKwh) return 0;
  if (!Number.isFinite(km) || km <= 0) return 0;
  const kwh = (km / 100) * kwhPer100km;
  return Math.round(kwh * pricePerKwh * 100) / 100;
}

/**
 * ค่าเดินทางตามพลังงานของรถ (หน่วยของ `pricePerUnit` ขึ้นกับประเภทรถ)
 * -------------------------------------------------------------
 * · รถน้ำมัน  → กม. ÷ (กม./ลิตร) × บาท/ลิตร
 * · รถไฟฟ้า → (กม./100) × kWh/100 กม. × บาท/หน่วย
 * · รถสาธารณะ → 0 (ไม่มีค่าเดินทางในแผน)
 */
export function vehicleEnergyCost(
  km: number,
  vehicle: VehicleProfile,
  pricePerUnit: number | null
): number {
  if (vehicle.key === "ev") {
    return evCost(km, vehicle.energyPer100km ?? null, pricePerUnit);
  }
  return fuelCost(km, vehicle, pricePerUnit);
}
