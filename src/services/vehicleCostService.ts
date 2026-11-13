import type { VehicleCategory } from "../data/vehicleData";
import type { FuelPriceSnapshot } from "./tripService";

/**
 * ค่าใช้จ่ายการเดินทางฝั่งแอป (สำหรับแพลนที่ผู้ใช้สร้างเอง)
 * =============================================================
 * · ตารางรถ + สูตรคิดค่าน้ำมัน = ชุดเดียวกับที่ backend ใช้
 *   (ดู `backend/src/vehicles.ts`) → ตัวเลขตรงกันทั้งสองทาง
 *   รถน้ำมัน : ระยะ (กม.) ÷ กม./ลิตร × บาท/ลิตร
 *   รถไฟฟ้า : (ระยะ ÷ 100) × kWh/100กม. × บาท/หน่วย
 * · ราคาน้ำมันสด = ดึงจาก GET /trips/fuel-price (backend ไปอ่าน pttor.com)
 *   ผู้ใช้แก้เองได้ เพราะราคาของวันนี้อาจไม่ใช่ของวันที่เดินทาง
 * · รถไฟฟ้าไม่มีราคาน้ำมัน → ให้ผู้ใช้กรอกบาท/กิโลวัตต์เอง
 */

export type CostVehicleKey =
  | "private_car"
  | "diesel_car"
  | "pickup"
  | "van"
  | "motorbike"
  | "ev"
  | "public";

export interface CostVehicleOption {
  key: CostVehicleKey;
  /** ป้ายสั้นบนชิป */
  label: string;
  /** ป้ายเต็ม (ใช้ในสรุปแผน) */
  fullLabel: string;
  /** กม. ต่อลิตร · null = ไม่ใช้น้ำมัน */
  kmPerLitre: number | null;
  /** กิโลวัตต์ต่อ 100 กม. (รถไฟฟ้า) */
  energyPer100km?: number;
  /** key ของราคาใน `FuelPriceSnapshot.prices` */
  fuelPriceKey: string | null;
  usesFuel: boolean;
  /** หมวดรถ (ตาม `vehicleData.ts`) — ใช้กรองรุ่นรถที่แนะนำให้ตรง */
  category: VehicleCategory | null;
  /** หน่วยของราคาที่ต้องกรอก */
  priceUnit: "litre" | "kwh" | null;
}

/**
 * ตารางรถ — ค่าเดียวกับ `backend/src/vehicles.ts`
 * (ถ้าเปลี่ยนที่นี่ ต้องเปลี่ยนที่นั่นด้วย ไม่งั้นตัวเลขสองทางไม่ตรงกัน)
 */
export const COST_VEHICLES: CostVehicleOption[] = [
  {
    key: "private_car",
    label: "รถยนต์",
    fullLabel: "รถยนต์ส่วนตัว",
    kmPerLitre: 12,
    fuelPriceKey: "gasohol95",
    usesFuel: true,
    category: "car",
    priceUnit: "litre",
  },
  {
    key: "diesel_car",
    label: "รถดีเซล",
    fullLabel: "รถยนต์ดีเซล",
    kmPerLitre: 15,
    fuelPriceKey: "diesel",
    usesFuel: true,
    category: "car",
    priceUnit: "litre",
  },
  {
    key: "pickup",
    label: "ปิคอัพ",
    fullLabel: "รถปิคอัพ",
    kmPerLitre: 9,
    fuelPriceKey: "gasohol95",
    usesFuel: true,
    category: "car",
    priceUnit: "litre",
  },
  {
    key: "van",
    label: "รถตู้",
    fullLabel: "รถตู้ 7 ที่นั่ง",
    kmPerLitre: 10,
    fuelPriceKey: "diesel",
    usesFuel: true,
    category: "van",
    priceUnit: "litre",
  },
  {
    key: "motorbike",
    label: "มอเตอร์ไซค์",
    fullLabel: "มอเตอร์ไซค์",
    kmPerLitre: 30,
    fuelPriceKey: "gasohol95",
    usesFuel: true,
    category: "motorcycle",
    priceUnit: "litre",
  },
  {
    key: "ev",
    label: "รถไฟฟ้า",
    fullLabel: "รถไฟฟ้า",
    kmPerLitre: null,
    energyPer100km: 18,
    fuelPriceKey: null,
    usesFuel: false,
    category: "ev",
    priceUnit: "kwh",
  },
  {
    key: "public",
    label: "ขนส่งสาธารณะ",
    fullLabel: "ขนส่งสาธารณะ / รถไฟ / เครื่องบิน",
    kmPerLitre: null,
    fuelPriceKey: null,
    usesFuel: false,
    category: null,
    priceUnit: null,
  },
];

/** หารถตาม key (key ไม่รู้จัก → รถยนต์ส่วนตัว) */
export function costVehicleByKey(
  key: string | null | undefined
): CostVehicleOption {
  return COST_VEHICLES.find((v) => v.key === key) ?? COST_VEHICLES[0];
}

/**
 * ราคาสดของชนิดน้ำมันที่รถใช้ จาก snapshot ที่ดึงมา
 * คืน null ถ้าดึงไม่ได้ / ไม่มีชนิดนี้ในตาราง → ให้ผู้ใช้กรอกเอง
 */
export function fuelPriceFromSnapshot(
  snapshot: FuelPriceSnapshot | null,
  vehicle: CostVehicleOption
): number | null {
  if (!snapshot || !vehicle.fuelPriceKey) return null;
  const raw = snapshot.prices?.[vehicle.fuelPriceKey];
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * ค่าเดินทาง (บาท)
 * -------------------------------------------------------------
 * · รถน้ำมัน → กม. ÷ กม./ลิตร × บาท/ลิตร
 * · รถไฟฟ้า → (กม. ÷ 100) × kWh/100 กม. × บาท/หน่วย
 * · ไม่ใช้น้ำมัน (รถไฟฟ้า/ขนส่งสาธารณะที่ไม่กรอกราคา) → 0
 */
export function computeTravelCost(
  km: number,
  vehicle: CostVehicleOption,
  pricePerUnit: number | null
): number {
  if (!Number.isFinite(km) || km <= 0) return 0;
  if (!vehicle.usesFuel) return 0;
  if (!Number.isFinite(pricePerUnit ?? NaN) || (pricePerUnit ?? 0) <= 0) return 0;

  if (vehicle.key === "ev") {
    const per100 = vehicle.energyPer100km ?? null;
    if (!per100) return 0;
    const kwh = (km / 100) * per100;
    return round2(kwh * (pricePerUnit as number));
  }
  const perLitre = vehicle.kmPerLitre ?? null;
  if (!perLitre) return 0;
  const litres = km / perLitre;
  return round2(litres * (pricePerUnit as number));
}

/** จำนวนลิตรที่ใช้ (รถน้ำมัน) — ใช้แสดงรายละเอียดในสรุป */
export function computeFuelLitres(
  km: number,
  vehicle: CostVehicleOption
): number | null {
  if (!vehicle.usesFuel || !vehicle.kmPerLitre) return null;
  if (!Number.isFinite(km) || km <= 0) return 0;
  return round2(km / vehicle.kmPerLitre);
}

/** จำนวนกิโลวัตต์ที่ใช้ (รถไฟฟ้า) */
export function computeKwh(
  km: number,
  vehicle: CostVehicleOption
): number | null {
  if (vehicle.key !== "ev" || !vehicle.energyPer100km) return null;
  if (!Number.isFinite(km) || km <= 0) return 0;
  return round2((km / 100) * vehicle.energyPer100km);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** จัดรูปแบบเงินบาท (มีจุดทศนิยมเมื่อมีเศษ) */
export function formatBaht(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  const rounded = Math.round(v * 100) / 100;
  const hasDecimals = Math.abs(rounded % 1) > 0.001;
  const fixed = hasDecimals ? rounded.toFixed(2) : String(Math.round(rounded));
  const [int, dec] = fixed.split(".");
  const withComma = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec ? `${withComma}.${dec}` : withComma;
}
