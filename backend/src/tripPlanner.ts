/**
 * เครื่องคำนวณแผนทริป (deterministic)
 * -------------------------------------------------------------
 * แยกจาก route เพื่อให้ทดสอบออฟไลน์ได้ (inject dependency)
 *
 * หลักการที่ผู้ใช้ตัดสินใจไว้:
 * - เอไอ "เลือก" ว่าจะไปไหน (จากโฟลเดอร์เท่านั้น + จุดที่ผู้ใช้เพิ่มเอง)
 * - ระบบ "คำนวณ" เวลา/ระยะ/ค่าใช้จ่ายเอง (ไม่เชื่อตัวเลขที่โมเดลเดา)
 * - จุดที่ปิด ณ เวลาที่จะถึง → ขยับไปวันอื่น หรือตัดทิ้งพร้อมเหตุผล
 * - จุดสิ้นสุดตอนกลับ แยกจากจุดเริ่ม (returnMode)
 * - ราคาน้ำมันต้องมาจากเว็บจริง (ดู fuelPrice.ts) พร้อมที่มา + วันที่
 */

import {
  haversineKm,
  type LatLng,
  type RouteResult,
} from "./routing";
import {
  evaluateOpenHours,
  describeVerdict,
  type OpenVerdict,
} from "./openHours";
import { vehicleEnergyCost, type VehicleProfile, type FuelType } from "./vehicles";
import {
  resolveFuelPrice,
  describeFuelPrice,
  ELECTRICITY_PRICE_PER_KWH,
  type FuelPriceTable,
  type ResolvedFuelPrice,
} from "./fuelPrice";

// ─────────────────────────────────────────────
//  ชนิดข้อมูล
// ─────────────────────────────────────────────

export interface PlanPoint {
  label: string;
  address?: string | null;
  coords: { lat: number; lng: number };
}

export interface PlanStop {
  id: string;
  name: string;
  type: string;
  activity?: string;
  description?: string;
  coordinates: { lat: number; lng: number };
  arriveTime?: string;
  leaveTime?: string;
  stayHours?: number;
  /** สถานะเปิด/ปิด ณ เวลาที่มาถึง */
  openHours?: OpenVerdict | null;
  /** ระยะจากจุดก่อนหน้า (กม.) */
  distanceFromPrevKm?: number | null;
  /** เวลาขับไปจุดถัดไป (นาที) */
  driveToNextMins?: number | null;
  booking?: { phone?: string | null; website?: string | null; note?: string | null } | null;
  estimatedCost?: number | null;
  note?: string | null;
  dataSource?: string;
  verified?: boolean;
  /** ข้อความเตือนเฉพาะจุด (เช่น ปิดเวลานี้ / ย้ายวัน) */
  issues?: string[];
}

export interface PlanLeg {
  fromIndex: number;
  toIndex: number;
  km: number;
  minutes: number;
  source: "osrm" | "estimate";
  geometry: LatLng[];
}

export interface PlanDay {
  day: number;
  date: string;
  title?: string;
  theme?: string;
  startPoint: PlanPoint;
  endPoint: PlanPoint;
  endPointType: "return" | "lodging";
  stops: PlanStop[];
  legs: PlanLeg[];
  totalKm: number;
  totalDriveMinutes: number;
  fuelCost: number;
  warnings: string[];
}

export interface LodgingSuggestion {
  name: string;
  address?: string | null;
  coordinates?: { lat: number; lng: number } | null;
  price?: number | null;
  priceUnit?: string | null;
  priceText?: string | null;
  distanceKm?: number | null;
  phone?: string | null;
  website?: string | null;
  rating?: number | null;
  source?: string;
}

export interface PlanVehicleInfo {
  key: string;
  label: string;
  /** ชื่อ/รุ่นรถที่ผู้ใช้กรอก (ถ้ามี) */
  model?: string | null;
  kmPerLitre: number | null;
  fuelType: FuelType | null;
  fuelPricePerLitre: number | null;
  fuelPriceSource: string;
  fuelPriceEffectiveDate?: string;
  fuelPriceFetchedAt?: string;
  fuelPriceIsEstimate: boolean;
  fuelPriceText?: string;
}

export interface BuiltPlan {
  title: string;
  summary: string;
  startPoint: PlanPoint;
  endPoint: PlanPoint;
  returnMode: "same_as_start" | "custom";
  days: PlanDay[];
  lodgingSuggestions: LodgingSuggestion[];
  budget: {
    fuel: number;
    lodging: number;
    food: number;
    activities: number;
    other: number;
    total: number;
    perPerson: number;
    groupTotal: number;
    withinBudget: boolean;
  };
  warnings: string[];
  assumptions: string[];
  tips: string[];
  routeSource: "osrm" | "estimate" | "mixed";
  routeCredit: string;
  /** ข้อมูลราคาน้ำมันที่ใช้จริง — ไม่มีสำหรับรถที่ไม่ใช้น้ำมัน (รถสาธารณะ/รถไฟฟ้า) */
  fuel?: ResolvedFuelPrice & { text: string };
  aiUsed: boolean;
  aiNote?: string;
  /** เวลาเริ่มต้นของวันแรก (เก็บไว้ให้ฝั่งแอปคำนวณแผนใหม่ได้ตรง ๆ) */
  startTime: string;
  /** จำนวนผู้เดินทาง */
  travelers: number;
  /** งบต่อคนที่ผู้ใช้ระบุ */
  budgetPerPerson: number;
  /** สไตล์ทริปที่ผู้ใช้เลือก */
  style: string;
  /** จุดที่ถูกตัดออกจากแผน (พร้อมเหตุผล) */
  droppedStops: { name: string; day: number; reason: string }[];
  /** ข้อมูลรถ + ราคาน้ำมันที่ใช้จริง (ให้ฝั่งแอปแสดงที่มาของตัวเลข) */
  vehicle: PlanVehicleInfo;
}

// ─────────────────────────────────────────────
//  ตัวช่วยเวลา
// ─────────────────────────────────────────────

export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatMinutes(total: number): string {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function addMinutes(hhmm: string, minutes: number): string {
  return formatMinutes(toMinutes(hhmm) + minutes);
}

/** วันที่ YYYY-MM-DD ของวันที่ d (เริ่มที่ baseDate) */
export function addDays(baseDate: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(baseDate ?? "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** เวลาของวันที่+เวลา → Date (เวลาท้องถิ่น) สำหรับตรวจเวลาเปิด-ปิด */
export function atLocalTime(date: string | null, hhmm: string): Date {
  const base = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "2026-01-01";
  const t = /^\d{1,2}:\d{2}$/.test(hhmm) ? hhmm : "09:00";
  const d = new Date(`${base}T${t}:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

// ─────────────────────────────────────────────
//  จุดที่ผู้ใช้เลือกได้
// ─────────────────────────────────────────────

export interface CandidateStop {
  /** id ที่ backend ใช้ (คีย์ของโฟลเดอร์ หรือ slug ของจุดที่เพิ่มเอง) */
  id: string;
  name: string;
  type: string;
  coordinates: { lat: number; lng: number };
  address?: string | null;
  province?: string | null;
  district?: string | null;
  /** ราคา/ค่าใช้จ่ายที่ทราบ (ข้อความ) */
  price?: string | null;
  /** เวลาเปิด-ปิดแบบข้อความ */
  openingHours?: string | null;
  /** เวลาเปิด-ปิดแบบโครงสร้าง (เจ้าของยืนยัน) */
  businessHours?: Record<string, { open: string; close: string }[]> | null;
  phone?: string | null;
  website?: string | null;
  rating?: number | null;
  /** true = ผู้ใช้เพิ่มเอง → ต้องอยู่ในแผนเสมอ */
  userAdded?: boolean;
  source?: string;
  /** กิจกรรมที่ AI แนะนำ (ถ้ามี) */
  activity?: string | null;
  /** คำอธิบายจุดจาก AI (ถ้ามี) */
  description?: string | null;
  /** เวลาที่แนะนำให้พัก (ชั่วโมง) */
  stayHours?: number | null;
  /** หมายเหตุที่ผู้ใช้/ระบบใส่ไว้ (เช่น "ควรจองล่วงหน้า") */
  note?: string | null;
}

export interface PlannerInput {
  days: number;
  date: string | null;
  startTime: string;
  startPoint: PlanPoint;
  endPoint: PlanPoint;
  returnMode: "same_as_start" | "custom";
  /** จุดสิ้นสุดของแต่ละวัน (หลายวัน) — วันสุดท้ายใช้ endPoint */
  dayEndPoints?: (PlanPoint | null)[];
  vehicle: VehicleProfile;
  /** ชื่อ/รุ่นรถที่ผู้ใช้กรอก (เช่น "Toyota Corolla Altis") */
  vehicleModel?: string | null;
  fuelType: FuelType | null;
  fuelPriceOverride?: number | null;
  travelers: number;
  budgetPerPerson: number;
  style: string;
  candidates: CandidateStop[];
  /** ผลจาก AI (ถ้ามี) — ใช้เลือกและจัดกลุ่มจุด */
  aiSelection?: AiSelection | null;
  /** ค่าประมาณอาหาร/กิจกรรมจาก AI */
  aiBudget?: { food?: number; activities?: number; other?: number } | null;
  aiTitle?: string | null;
  aiSummary?: string | null;
  aiTips?: string[] | null;
  aiWarnings?: string[] | null;
  /** เวลาเริ่มของวันที่ 2 ขึ้นไป (ไม่ระบุ = 08:30) */
  laterDayStartTime?: string;
  /**
   * ผู้ใช้กำหนดลำดับจุดเอง (ลบ · สลับลำดับ) → true = ห้ามเรียงใหม่ให้สั้นที่สุด
   * (ระบบต้องเคารพลำดับที่ผู้ใช้จัด ไม่ใช่สลับกลับเอง)
   */
  preserveStopOrder?: boolean;
}

export interface AiSelection {
  /** วันที่ d → รายชื่อจุดที่ AI เลือก (เรียงตามที่ AI แนะนำ) */
  days: { day: number; title?: string; theme?: string; stops: AiStop[] }[];
}

export interface AiStop {
  name: string;
  type?: string;
  activity?: string;
  description?: string;
  stayHours?: number;
  note?: string;
}

// ─────────────────────────────────────────────
//  dependency ที่ฉีดเข้ามาได้ (ทดสอบออฟไลน์)
// ─────────────────────────────────────────────

export interface PlannerDeps {
  route: (points: LatLng[]) => Promise<RouteResult>;
  fuelPrices: () => Promise<FuelPriceTable>;
  findLodging?: (
    near: LatLng,
    opts: { province?: string | null; district?: string | null; limit?: number }
  ) => Promise<LodgingSuggestion[]>;
}

// ─────────────────────────────────────────────
//  จัดกลุ่มจุดตามวัน
// ─────────────────────────────────────────────

/** เรียงชื่อให้ตรงกับจุดที่มีจริง (ห้ามใช้ชื่อที่โมเดลแต่ง) */
export function matchCandidate(
  name: string,
  candidates: CandidateStop[]
): CandidateStop | null {
  const target = normalizeName(name);
  if (!target) return null;
  for (const c of candidates) {
    if (normalizeName(c.name) === target) return c;
  }
  for (const c of candidates) {
    if (normalizeName(c.name).includes(target) || target.includes(normalizeName(c.name))) {
      return c;
    }
  }
  return null;
}

function normalizeName(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
}

/**
 * แบ่งจุดเป็นรายวัน
 * - ถ้ามีผลจาก AI → ใช้ตามนั้น (แต่ตัดชื่อที่ไม่มีจริงออก)
 * - ไม่มี AI → เรียงตามระยะจากจุดเริ่ม แล้วแบ่งเป็นก้อนเท่า ๆ กัน
 */
export function groupStopsByDay(
  input: PlannerInput
): { day: number; title?: string; theme?: string; stops: CandidateStop[] }[] {
  const days = Math.max(1, input.days);
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const result: { day: number; title?: string; theme?: string; stops: CandidateStop[] }[] = [];

  if (input.aiSelection?.days?.length) {
    const used = new Set<string>();
    for (let d = 1; d <= days; d++) {
      const src = input.aiSelection.days.find((x) => x.day === d) ??
        input.aiSelection.days[d - 1];
      const stops: CandidateStop[] = [];
      for (const s of src?.stops ?? []) {
        const c = matchCandidate(s.name, input.candidates);
        if (!c || used.has(c.id)) continue;
        used.add(c.id);
        // ข้อมูลที่ AI แนะนำเพิ่มเติม (กิจกรรม/คำอธิบาย/เวลาพัก) — แนบไปกับจุด
        stops.push({
          ...c,
          activity: s.activity ?? c.activity ?? null,
          description: s.description ?? c.description ?? null,
          stayHours: s.stayHours ?? c.stayHours ?? null,
          note: s.note ?? c.note ?? null,
        });
      }
      result.push({ day: d, title: src?.title, theme: src?.theme, stops });
    }
    // จุดที่ผู้ใช้เพิ่มเอง → ต้องอยู่ในแผนเสมอ
    for (const c of input.candidates) {
      if (!c.userAdded || used.has(c.id)) continue;
      const target = result.reduce((best, day) => {
        const dayStart = day.stops[0]?.coordinates ?? input.startPoint.coords;
        const dist = haversineKm(
          { lat: dayStart.lat, lng: dayStart.lng },
          { lat: c.coordinates.lat, lng: c.coordinates.lng }
        );
        return !best || dist < best.dist ? { day, dist } : best;
      }, null as { day: (typeof result)[number]; dist: number } | null);
      (target?.day ?? result[0]).stops.push(c);
    }
    return result;
  }

  // ── ไม่มี AI: เรียงตามระยะจากจุดเริ่ม แล้วแบ่งเป็นก้อน ──
  const sorted = [...input.candidates].sort(
    (a, b) =>
      haversineKm(
        { lat: input.startPoint.coords.lat, lng: input.startPoint.coords.lng },
        { lat: a.coordinates.lat, lng: a.coordinates.lng }
      ) -
      haversineKm(
        { lat: input.startPoint.coords.lat, lng: input.startPoint.coords.lng },
        { lat: b.coordinates.lat, lng: b.coordinates.lng }
      )
  );
  const perDay = Math.max(1, Math.ceil(sorted.length / days));
  for (let d = 1; d <= days; d++) {
    result.push({ day: d, stops: sorted.slice((d - 1) * perDay, d * perDay) });
  }
  return result;
}

// ─────────────────────────────────────────────
//  ลำดับจุดในวัน (เทียบกับเส้นทางที่สั้นที่สุด)
// ─────────────────────────────────────────────

/** nearest-neighbour: เริ่มจากจุดเริ่ม ไปจุดใกล้สุดเสมอ */
export function nearestNeighbourOrder(
  start: LatLng,
  stops: CandidateStop[]
): CandidateStop[] {
  const remaining = [...stops];
  const out: CandidateStop[] = [];
  let cur = start;
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i].coordinates;
      const d = haversineKm(cur, { lat: p.lat, lng: p.lng });
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    out.push(picked);
    cur = { lat: picked.coordinates.lat, lng: picked.coordinates.lng };
  }
  return out;
}

/** ระยะรวมของลำดับจุด (ใช้เทียบว่าลำดับไหนสั้นกว่า) */
export function orderDistance(start: LatLng, stops: CandidateStop[]): number {
  let total = 0;
  let cur = start;
  for (const s of stops) {
    const p = { lat: s.coordinates.lat, lng: s.coordinates.lng };
    total += haversineKm(cur, p);
    cur = p;
  }
  return total;
}

// ─────────────────────────────────────────────
//  เวลาเปิด-ปิด
// ─────────────────────────────────────────────

export function checkOpen(
  stop: CandidateStop,
  at: Date
): OpenVerdict {
  return evaluateOpenHours(
    {
      businessHours: stop.businessHours ?? undefined,
      openingHours: stop.openingHours ?? undefined,
    },
    at
  );
}

// ─────────────────────────────────────────────
//  คำนวณแผน
// ─────────────────────────────────────────────

const DEFAULT_STAY_HOURS: Record<string, number> = {
  attraction: 1.25,
  community: 1.75,
  food: 1.25,
  cafe: 0.75,
  activity: 1.5,
  accommodation: 0,
  departure: 0,
  return: 0,
};

/**
 * สถานะของหนึ่งวันระหว่างคำนวณ
 * (เก็บจุดดิบไว้ด้วย เพื่อย้ายวัน/ตัดทิ้งแล้วคำนวณใหม่ได้)
 */
interface DayState {
  day: number;
  date: string | null;
  title?: string;
  theme?: string;
  /** จุดเริ่มของวันนี้ (วันที่ 2+ = จุดจบของเมื่อวาน) */
  startPoint: PlanPoint;
  /** จุดสิ้นสุดที่ผู้ใช้เลือกไว้ (null = ใช้จุดสุดท้ายของวันชั่วคราว) */
  endPointOverride: PlanPoint | null;
  endPointType: "return" | "lodging";
  /** จุดดิบของวันนี้ */
  stops: CandidateStop[];
  startTime: string;
  /** หมายเหตุที่ต้องติดไปกับวันนี้เสมอ (เช่น "ย้าย X มาวันนี้") */
  notes: string[];
  /** จุดจบที่คำนวณได้จริงของวันนี้ (วันถัดไปเริ่มที่นี่) */
  resolvedEnd: PlanPoint;
  /** ผลคำนวณ */
  plan: PlanDay | null;
  /** จุดที่ปิดจริง ณ เวลาที่จะถึง (ต้องย้ายวัน/ตัดทิ้ง) */
  hardClosed: CandidateStop[];
  /** ผู้ใช้จัดลำดับเอง → ห้ามเรียงใหม่ให้สั้นที่สุด */
  preserveOrder?: boolean;
}

/** จุดสองจุดเดียวกันไหม (พิกัดเท่ากัน) */
function samePoint(a: PlanPoint, b: PlanPoint): boolean {
  return (
    Math.abs(a.coords.lat - b.coords.lat) < 1e-6 &&
    Math.abs(a.coords.lng - b.coords.lng) < 1e-6
  );
}

/**
 * สถานที่นี้ "มีช่วงที่เปิด" ในวันที่กำหนดไหม
 * ตรวจหลายช่วงเวลา เพราะบางที่เปิดเฉพาะช่วงเย็น (เช่น 17:00-21:00)
 */
export function isOpenOnDay(stop: CandidateStop, date: string | null): boolean {
  const probes = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"];
  for (const p of probes) {
    if (checkOpen(stop, atLocalTime(date, p)).status === "open") return true;
  }
  return false;
}

export async function buildTripPlan(
  input: PlannerInput,
  deps: PlannerDeps
): Promise<BuiltPlan> {
  const warnings: string[] = [];
  const assumptions: string[] = [];
  const droppedStops: { name: string; day: number; reason: string }[] = [];
  const days = Math.max(1, input.days);
  const nights = Math.max(0, days - 1);

  // ── ราคาน้ำมัน (เฉพาะรถที่ใช้น้ำมัน — รถสาธารณะ/รถไฟฟ้าไม่มีค่าน้ำมัน) ──
  // รถสาธารณะ → ไม่ต้องดึงราคา · ไม่มีชนิดน้ำมัน · ไม่มีค่าน้ำมันในแผน
  const usesFuel = input.vehicle.usesFuel;
  const isEv = input.vehicle.key === "ev";
  const fuelTable = usesFuel ? await deps.fuelPrices() : null;
  // รถไฟฟ้ายังมีชนิดพลังงาน (electric) แต่ไม่มี "ราคาน้ำมัน" → เก็บชนิดไว้ ค่าไฟคิดแยก
  const fuelType: FuelType | null =
    input.fuelType ?? input.vehicle.defaultFuelType ?? null;
  const resolvedFuel: ResolvedFuelPrice | null =
    usesFuel && fuelTable && fuelType
      ? resolveFuelPrice(fuelTable, fuelType, input.fuelPriceOverride)
      : null;
  /**
   * รถไฟฟ้า → คิดค่าไฟ (บาท/kWh) แทนค่าน้ำมัน
   * ราคาที่ผู้ใช้ระบุเอง (fuelPriceOverride) ชนะค่าประมาณการเสมอ
   */
  const electricityPrice: number | null = isEv
    ? input.fuelPriceOverride ?? ELECTRICITY_PRICE_PER_KWH
    : null;
  if (isEv) {
    assumptions.push(
      `ราคาไฟ ${electricityPrice?.toFixed(2)} บาท/หน่วย · ค่าประมาณการ ` +
        `(รถไฟฟ้าใช้พลังงาน ${input.vehicle.energyPer100km ?? 18} kWh/100 กม.)`
    );
  }
  if (resolvedFuel) {
    if (!resolvedFuel.pricePerLitre) {
      warnings.push(
        "ยังไม่ทราบราคาน้ำมันของชนิดนี้ — ค่าน้ำมันในแผนเป็น 0 กรุณากรอกราคาที่ปั๊มเอง"
      );
    } else {
      assumptions.push(
        `ราคาน้ำมัน ${resolvedFuel.pricePerLitre.toFixed(2)} ฿/ลิตร · ที่มา: ${resolvedFuel.sourceLabel}` +
          (resolvedFuel.effectiveDate ? ` · มีผล ${resolvedFuel.effectiveDate}` : "") +
          (resolvedFuel.isEstimate ? " · เป็นค่าประมาณการ" : "")
      );
      // ดึงราคาวันนี้ไม่สำเร็จ → ใช้ราคาของวันก่อน (ห้ามแสดงเป็นราคาวันนี้)
      if (resolvedFuel.isStale) {
        assumptions.push(
          fuelTable?.staleNotice ||
            `ราคาน้ำมันที่ใช้เป็นข้อมูลวันที่ ${
              fuelTable?.cacheDate ?? "ก่อนหน้า"
            } — ดึงราคาวันนี้ไม่สำเร็จ`
        );
      }
    }
  }

  // ── จัดกลุ่มจุดตามวัน ──
  const grouped = groupStopsByDay(input);

  // ── จุดสิ้นสุดที่ผู้ใช้เลือกไว้ต่อวัน (วันสุดท้าย = จุดสิ้นสุดตอนกลับ) ──
  const chosenDayEnds: (PlanPoint | null)[] = [];
  for (let d = 1; d <= days; d++) {
    if (d === days) chosenDayEnds.push(input.endPoint);
    else chosenDayEnds.push(input.dayEndPoints?.[d - 1] ?? null);
  }

  // ── สร้างสถานะของแต่ละวัน ──
  const states: DayState[] = [];
  for (let d = 1; d <= days; d++) {
    const group = grouped[d - 1];
    states.push({
      day: d,
      date: input.date ? addDays(input.date, d - 1) : null,
      title: group?.title,
      theme: group?.theme,
      startPoint: input.startPoint,
      endPointOverride: chosenDayEnds[d - 1],
      endPointType: d === days ? "return" : "lodging",
      stops: [...(group?.stops ?? [])],
      startTime: d === 1 ? input.startTime : input.laterDayStartTime ?? "08:30",
      notes: [],
      resolvedEnd: input.startPoint,
      plan: null,
      hardClosed: [],
      preserveOrder: input.preserveStopOrder === true,
    });
  }

  // ── รอบที่ 1: คำนวณเส้นทาง + ไทม์ไลน์ของทุกวัน ──
  const fuelInfo = {
    vehicle: input.vehicle,
    pricePerLitre: resolvedFuel?.pricePerLitre ?? electricityPrice,
  };
  for (const st of states) {
    await computeDayState(st, deps, fuelInfo);
  }

  // ── รอบที่ 2: จุดที่ปิด ณ เวลาที่จะถึง → ย้ายวัน หรือตัดทิ้งพร้อมเหตุผล ──
  const dirty = new Set<number>();
  for (const st of states) {
    if (!st.hardClosed.length) continue;
    for (const stop of [...st.hardClosed]) {
      const target = findOpenDay(stop, states, st.day);
      if (target != null && target !== st.day) {
        const fromIdx = st.stops.findIndex((s) => s.id === stop.id);
        if (fromIdx >= 0) st.stops.splice(fromIdx, 1);
        const dest = states[target - 1];
        dest.stops.push(stop);
        dest.notes.push(`ย้าย "${stop.name}" มาวันที่ ${target} — วันเดิมปิด`);
        dirty.add(st.day);
        dirty.add(target);
        continue;
      }
      // ไม่มีวันไหนเปิด → ตัดทิ้งพร้อมเหตุผล
      const reason = stop.openingHours
        ? `"${stop.name}" ไม่มีวันไหนที่เปิดตามข้อมูลที่มี — ตัดออกจากแผน`
        : `"${stop.name}" ไม่ทราบเวลาเปิด และวันที่จะถึงน่าจะปิด — ตัดออกจากแผน`;
      const idx = st.stops.findIndex((s) => s.id === stop.id);
      if (idx >= 0) st.stops.splice(idx, 1);
      droppedStops.push({ name: stop.name, day: st.day, reason });
      warnings.push(reason);
      dirty.add(st.day);
    }
  }

  // ── รอบที่ 3: คำนวณใหม่เฉพาะวันที่เปลี่ยน (วันถัดไปเริ่มที่จุดจบของวันนี้) ──
  for (let i = 0; i < states.length; i++) {
    const st = states[i];
    const expectedStart = i === 0 ? input.startPoint : states[i - 1].resolvedEnd;
    const startChanged = !samePoint(st.startPoint, expectedStart);
    if (dirty.has(st.day) || startChanged) {
      st.startPoint = expectedStart;
      await computeDayState(st, deps, fuelInfo);
    }
  }

  const builtDays: PlanDay[] = states
    .map((st) => st.plan)
    .filter((p): p is PlanDay => Boolean(p));
  const usedEstimate = builtDays.some((d) =>
    d.legs.some((l) => l.source === "estimate")
  );
  const usedOsrm = builtDays.some((d) =>
    d.legs.some((l) => l.source === "osrm")
  );

  // ── ที่พัก (หลายวัน) ──
  const lodgingSuggestions: LodgingSuggestion[] = [];
  if (nights > 0 && deps.findLodging) {
    const lastStopOfDay1 =
      builtDays[0]?.stops?.[builtDays[0].stops.length - 1]?.coordinates;
    if (lastStopOfDay1) {
      try {
        const first = input.candidates.find((c) => c.type === "accommodation");
        if (first) {
          lodgingSuggestions.push({
            name: first.name,
            address: first.address ?? null,
            coordinates: first.coordinates,
            priceText: first.price ?? null,
            phone: first.phone ?? null,
            website: first.website ?? null,
            rating: first.rating ?? null,
            source: "folder",
          });
        }
        const near = await deps.findLodging(
          { lat: lastStopOfDay1.lat, lng: lastStopOfDay1.lng },
          {
            province: input.candidates.find((c) => c.province)?.province ?? null,
            district: input.candidates.find((c) => c.district)?.district ?? null,
            limit: 5,
          }
        );
        for (const l of near) {
          if (lodgingSuggestions.some((x) => x.name === l.name)) continue;
          lodgingSuggestions.push(l);
        }
      } catch (e: any) {
        console.warn("[tripPlanner] หาที่พักไม่สำเร็จ:", e?.message ?? e);
      }
    }
    if (!lodgingSuggestions.length) {
      warnings.push(
        "ยังไม่พบที่พักใกล้เส้นทาง — เลือกเองได้จากปุ่ม 'เสนอที่พัก' ในการ์ดแผน"
      );
    }
  }

  // ── งบประมาณ ──
  const totalKm = builtDays.reduce((s, d) => s + d.totalKm, 0);
  const totalFuel = vehicleEnergyCost(
    totalKm,
    input.vehicle,
    resolvedFuel?.pricePerLitre ?? electricityPrice
  );
  const food = Number(input.aiBudget?.food ?? 0) || 0;
  // คำนวณค่าเข้าชม/กิจกรรมจากราคาของแต่ละจุดแวะ (ถ้า AI ไม่ได้ส่งมา หรือส่ง 0 ให้ใช้ผลรวมราคาจากสถานที่จริง)
  const stopsAdmissionSum = builtDays.reduce(
    (sum, d) =>
      sum +
      d.stops.reduce(
        (sSum, st) => sSum + (st.estimatedCost ? Number(st.estimatedCost) : 0),
        0
      ),
    0
  );
  const activities =
    Number(input.aiBudget?.activities ?? 0) > 0
      ? Number(input.aiBudget!.activities)
      : stopsAdmissionSum * Math.max(1, input.travelers);
  const other = Number(input.aiBudget?.other ?? 0) || 0;
  const lodging = 0;
  const total = totalFuel + lodging + food + activities + other;
  const travelers = Math.max(1, input.travelers);
  const perPerson = round1(total / travelers);
  const withinBudget = perPerson <= input.budgetPerPerson;

  if (!withinBudget) {
    warnings.push(
      `งบที่วางไว้ ${input.budgetPerPerson.toLocaleString("th-TH")} บาท/คน แต่แผนใช้ประมาณ ${perPerson.toLocaleString("th-TH")} บาท/คน`
    );
  }

  const routeSource: BuiltPlan["routeSource"] =
    usedOsrm && usedEstimate ? "mixed" : usedOsrm ? "osrm" : "estimate";
  if (usedEstimate) {
    warnings.push(
      "บางช่วงคำนวณเส้นทางจริงไม่ได้ ใช้ค่าประมาณจากระยะเป็นเส้นตรงแทน"
    );
  }
  warnings.push("เวลาเดินทางมาจากเส้นทางจริง ไม่รวมสภาพจราจรและเวลาจอดรถ");

  return {
    title: input.aiTitle?.trim() || defaultTitle(input, days),
    summary: input.aiSummary?.trim() || defaultSummary(input, days, totalKm),
    startPoint: input.startPoint,
    endPoint: input.endPoint,
    returnMode: input.returnMode,
    days: builtDays,
    lodgingSuggestions,
    budget: {
      fuel: totalFuel,
      lodging,
      food,
      activities,
      other,
      total: round1(total),
      perPerson,
      groupTotal: round1(total),
      withinBudget,
    },
    warnings,
    assumptions,
    tips: input.aiTips ?? [],
    routeSource,
    routeCredit: "ข้อมูลเส้นทาง: © OpenStreetMap contributors (ผ่าน OSRM)",
    // รถที่ไม่ใช้น้ำมัน (รถสาธารณะ/รถไฟฟ้า) → ไม่มีข้อมูลราคาน้ำมันในแผน
    ...(resolvedFuel
      ? { fuel: { ...resolvedFuel, text: describeFuelPrice(resolvedFuel) } }
      : {}),
    aiUsed: Boolean(input.aiSelection),
    droppedStops,
    startTime: input.startTime,
    travelers: input.travelers,
    budgetPerPerson: input.budgetPerPerson,
    style: input.style,
    vehicle: {
      key: input.vehicle.key,
      label: input.vehicle.label,
      model: input.vehicleModel ?? null,
      kmPerLitre: input.vehicle.kmPerLitre,
      fuelType,
      fuelPricePerLitre: resolvedFuel?.pricePerLitre ?? electricityPrice,
      fuelPriceSource:
        resolvedFuel?.sourceLabel ??
        (isEv ? "ราคาไฟโดยประมาณ" : "ไม่มีค่าน้ำมัน"),
      fuelPriceEffectiveDate: resolvedFuel?.effectiveDate,
      fuelPriceFetchedAt: resolvedFuel?.fetchedAt,
      fuelPriceIsEstimate: resolvedFuel?.isEstimate ?? isEv,
      fuelPriceText: resolvedFuel
        ? describeFuelPrice(resolvedFuel)
        : isEv
        ? `ราคาไฟ ${electricityPrice?.toFixed(2)} บาท/หน่วย · ค่าประมาณการ`
        : `${input.vehicle.label} — ไม่มีค่าน้ำมัน`,
    },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function defaultTitle(input: PlannerInput, days: number): string {
  const label = input.endPoint?.label || input.startPoint.label;
  return `ทริป${label} ${days} วัน`;
}

function defaultSummary(input: PlannerInput, days: number, km: number): string {
  return `เริ่มจาก ${input.startPoint.label} วันที่ ${input.date ?? "ไม่ระบุ"} · ${days} วัน · ขับรวมประมาณ ${round1(km)} กม. · รถ: ${input.vehicle.label}`;
}

// ─────────────────────────────────────────────
//  คำนวณหนึ่งวัน (เรียกซ้ำได้ ถ้าจุดของวันนั้นเปลี่ยน)
// ─────────────────────────────────────────────

async function computeDayState(
  st: DayState,
  deps: PlannerDeps,
  fuel: { vehicle: VehicleProfile; pricePerLitre: number | null }
): Promise<void> {
  const dayWarnings: string[] = [];
  const stops = [...st.stops];

  if (!stops.length) {
    const endPoint = st.endPointOverride ?? st.startPoint;
    st.resolvedEnd = endPoint;
    st.hardClosed = [];
    st.plan = {
      day: st.day,
      date: st.date ?? "",
      title: st.title,
      theme: st.theme,
      startPoint: st.startPoint,
      endPoint,
      endPointType: st.endPointType,
      stops: [],
      legs: [],
      totalKm: 0,
      totalDriveMinutes: 0,
      fuelCost: 0,
      warnings: [...st.notes, "ยังไม่มีจุดแวะในวันนี้"],
    };
    return;
  }

  // ── เลือกลำดับที่ประหยัดเวลาที่สุด ──
  // (ถ้าผู้ใช้จัดลำดับเอง → เคารพลำดับนั้น ไม่สลับกลับ)
  if (!st.preserveOrder) {
    const nnOrder = nearestNeighbourOrder(st.startPoint.coords, stops);
    if (
      orderDistance(st.startPoint.coords, nnOrder) + 0.5 <
      orderDistance(st.startPoint.coords, stops)
    ) {
      stops.splice(0, stops.length, ...nnOrder);
      dayWarnings.push("เรียงลำดับใหม่ให้เส้นทางสั้นที่สุด (ระยะลดลง)");
    }
  }

  // ── จุดจบของวัน (ยังไม่เลือก = ใช้จุดสุดท้ายของวันชั่วคราว) ──
  let dayEnd = st.endPointOverride;
  if (!dayEnd) {
    const last = stops[stops.length - 1];
    dayEnd = {
      label: last.name,
      address: last.address ?? null,
      coords: { ...last.coordinates },
    };
    if (st.endPointType === "lodging") {
      dayWarnings.push(
        `วันที่ ${st.day} ยังไม่ได้เลือกจุดสิ้นสุด (ที่พัก) — ใช้ "${last.name}" เป็นจุดจบชั่วคราว`
      );
    }
  }

  // ── คำนวณเส้นทางจริง ──
  const route = await computeDayRoute(st.startPoint, stops, dayEnd, deps);

  // ── คำนวณเวลา + ตรวจเวลาเปิด-ปิด ──
  const timeline = buildDayTimeline({
    day: st.day,
    date: st.date,
    endPoint: dayEnd,
    endPointType: st.endPointType,
    stops,
    legs: route.legs,
    startTime: st.startTime,
  });

  st.resolvedEnd = dayEnd;
  st.hardClosed = timeline.hardClosed;
  st.plan = {
    day: st.day,
    date: st.date ?? "",
    title: st.title,
    theme: st.theme,
    startPoint: st.startPoint,
    endPoint: dayEnd,
    endPointType: st.endPointType,
    stops: timeline.stops,
    legs: route.legs,
    totalKm: round1(route.km),
    totalDriveMinutes: route.minutes,
    fuelCost: vehicleEnergyCost(route.km, fuel.vehicle, fuel.pricePerLitre),
    warnings: [...st.notes, ...dayWarnings, ...timeline.warnings],
  };
}

/**
 * หาวันที่สถานที่นี้ "เปิด" — ใช้ตอนจุดที่ไปถึงแล้วปิด
 * ถ้าไม่มีวันไหนเปิดเลย → คืน null (ให้ผู้เรียกตัดทิ้งพร้อมเหตุผล)
 */
export function findOpenDay(
  stop: CandidateStop,
  states: DayState[],
  currentDay: number
): number | null {
  for (const st of states) {
    if (st.day === currentDay) continue;
    if (isOpenOnDay(stop, st.date)) return st.day;
  }
  return null;
}

// ─────────────────────────────────────────────
//  เส้นทางรายวัน
// ─────────────────────────────────────────────

async function computeDayRoute(
  startPoint: PlanPoint,
  stops: CandidateStop[],
  endPoint: PlanPoint,
  deps: PlannerDeps
): Promise<{ legs: PlanLeg[]; km: number; minutes: number; source: "osrm" | "estimate" }> {
  const points: LatLng[] = [
    { lat: startPoint.coords.lat, lng: startPoint.coords.lng },
    ...stops.map((s) => ({ lat: s.coordinates.lat, lng: s.coordinates.lng })),
    { lat: endPoint.coords.lat, lng: endPoint.coords.lng },
  ];
  const result = await deps.route(points);
  const legs: PlanLeg[] = result.legs.map((l) => ({
    fromIndex: l.fromIndex,
    toIndex: l.toIndex,
    km: round1(l.km),
    minutes: l.minutes,
    source: result.source,
    geometry: result.geometry,
  }));
  return { legs, km: result.km, minutes: result.minutes, source: result.source };
}

// ─────────────────────────────────────────────
//  ไทม์ไลน์รายวัน + ตรวจเวลาเปิด-ปิด
// ─────────────────────────────────────────────

function buildDayTimeline(args: {
  day: number;
  date: string | null;
  endPoint: PlanPoint;
  endPointType: "return" | "lodging";
  stops: CandidateStop[];
  legs: PlanLeg[];
  startTime: string;
}): {
  stops: PlanStop[];
  warnings: string[];
  hardClosed: CandidateStop[];
} {
  const { date, stops, legs, startTime } = args;
  const dayWarnings: string[] = [];
  const hardClosed: CandidateStop[] = [];

  const out: PlanStop[] = [];
  let clock = startTime;

  for (let i = 0; i < stops.length; i++) {
    const c = stops[i];
    const legIn = legs.find((l) => l.toIndex === i + 1);
    const legOut = legs.find((l) => l.fromIndex === i + 1);

    // เวลามาถึง = เวลาออกจุดก่อนหน้า + เวลาขับ + 10 นาที (จอดรถ/เดินเข้าจุด)
    const driveIn = legIn?.minutes ?? 0;
    const arrive = addMinutes(clock, driveIn + 10);

    // เวลาพัก: ใช้ค่าที่ AI แนะนำก่อน · ไม่มีใช้ค่าเริ่มต้นตามชนิดจุด
    const stayHours =
      typeof c.stayHours === "number" && c.stayHours > 0
        ? c.stayHours
        : (DEFAULT_STAY_HOURS[c.type] ?? 1);
    const leave = addMinutes(arrive, stayHours * 60);

    const verdict = checkOpen(c, atLocalTime(date, arrive));
    const issues: string[] = [];
    let finalArrive = arrive;
    let finalStay = stayHours;

    if (verdict.status === "closed") {
      const opensLater =
        verdict.openFrom != null && toMinutes(verdict.openFrom) > toMinutes(arrive);
      if (opensLater) {
        // มาถึงก่อนเปิด → รอ
        finalArrive = verdict.openFrom as string;
        finalStay = Math.max(
          0.25,
          (toMinutes(leave) - toMinutes(finalArrive)) / 60
        );
        issues.push(`ถึงก่อนเปิด — รอถึง ${verdict.openFrom} น.`);
      } else {
        // ปิดจริง ณ เวลาที่จะถึง → ต้องย้ายวันหรือตัดทิ้ง
        hardClosed.push(c);
        issues.push(
          `ปิดในเวลาที่ถึง (${verdict.openFrom ?? "?"}-${
            verdict.closeTo ?? "?"
          }) — กำลังหาวันอื่นที่เปิด`
        );
      }
    } else if (verdict.status === "unknown") {
      issues.push("ไม่ทราบเวลาเปิด-ปิด — ควรโทรเช็คก่อนไป");
    }

    out.push({
      id: c.id,
      name: c.name,
      type: c.type,
      activity: c.activity ?? undefined,
      description: c.description ?? undefined,
      coordinates: { ...c.coordinates },
      arriveTime: finalArrive,
      leaveTime: addMinutes(finalArrive, finalStay * 60),
      stayHours: round1(finalStay),
      openHours: verdict,
      distanceFromPrevKm: legIn ? legIn.km : null,
      driveToNextMins: legOut ? legOut.minutes : null,
      booking: {
        phone: c.phone ?? null,
        website: c.website ?? null,
        note: c.note ?? c.openingHours ?? null,
      },
      estimatedCost:
        c.price != null
          ? typeof c.price === "number"
            ? c.price
            : (() => {
                const m = String(c.price).match(/\d+(?:[.,]\d+)?/);
                return m ? parseFloat(m[0].replace(/,/g, "")) : null;
              })()
          : null,
      note: c.note ?? null,
      dataSource: c.source ?? "community",
      verified: false,
      issues,
    });

    // ถัดไป = เวลาออก + เวลาขับ + 10 นาที
    const nextDrive = legOut?.minutes ?? 0;
    clock = addMinutes(finalArrive, finalStay * 60 + nextDrive + 10);
  }

  // จุดจบของวัน (จุดสิ้นสุด/จุดกลับ)
  const lastLeg = legs.find((l) => l.toIndex === stops.length + 1);
  out.push({
    id: `end-${args.day}`,
    name:
      args.endPointType === "return"
        ? `กลับ ${args.endPoint.label}`
        : `จบวันที่ ${args.day} — ${args.endPoint.label}`,
    type: args.endPointType === "return" ? "return" : "accommodation",
    coordinates: { ...args.endPoint.coords },
    arriveTime: clock,
    leaveTime: clock,
    stayHours: 0,
    openHours: null,
    distanceFromPrevKm: lastLeg ? lastLeg.km : null,
    driveToNextMins: null,
    booking: null,
    estimatedCost: null,
    note:
      args.endPointType === "return"
        ? "จุดสิ้นสุดตอนกลับ"
        : "จุดจบของวัน (ควรเลือกที่พักที่ยืนยันแล้ว)",
    dataSource: "user",
    verified: true,
    issues: [],
  });

  return { stops: out, warnings: dayWarnings, hardClosed };
}

export { describeVerdict };
