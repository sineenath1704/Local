import { API_TIMEOUT_MS } from "./apiConfig";
import {
  ItineraryDay,
  TripBudget,
  TripRequestInput,
  TripSlots,
  TripPlan,
  TripPlanLodging,
  TripPlanPoint,
  TRAVEL_STYLES,
  TRIP_MAX_DAYS,
  tripRangeDays,
  vehicleClassOf,
} from "../data/tripsData";
import { aiFetch, AiError, toastAiError } from "./aiHttp";

export interface GeneratedItinerary {
  title: string;
  summary: string;
  days: ItineraryDay[];
  budget: TripBudget;
  /**
   * Was this really written by the AI, or is it the offline template?
   * This used to be invisible: a 502 or a timeout silently produced a
   * plausible-looking itinerary with no marker at all.
   */
  source?: "ai" | "local-fallback";
  fallbackReason?: string;
  /** id ของแถวที่บันทึกไว้ใน `trip_plans` (null = ยังไม่ได้บันทึก) */
  planId?: string | null;
  /** backend บันทึกลง `trip_plans` สำเร็จไหม */
  persisted?: boolean;
  /** เหตุผลที่บันทึกไม่สำเร็จ (ถ้ามี) */
  persistReason?: string;
  /** backend อ่านโฟลเดอร์จริงได้ไหม (false = ใช้ชื่อสถานที่ที่ client ส่งมา) */
  folderResolved?: boolean;
  /** คำเตือนจาก backend เช่น โฟลเดอร์ยังไม่มีข้อมูลสถานที่ */
  folderWarning?: string | null;
}

/** ตัวเลือกเพิ่มเติมตอนเรียกตัวสร้างแพลน */
export interface GenerateTripOptions {
  /** รหัสโฟลเดอร์ต้นทาง — backend จะใช้สถานที่ในโฟลเดอร์เป็นจุดหมาย */
  folderId?: string | null;
  /** Supabase access token — จำเป็นเมื่อมี folderId */
  token?: string | null;
}

/**
 * ทำให้ข้อมูลที่ AI คืนมาใช้กับ UI ได้เสมอ
 * -----------------------------------------------------------------
 * โมเดลอาจตอบมาไม่ครบทุก field (เช่น stop ที่ไม่มี `stayHours`)
 * → ถ้าปล่อยผ่านไป หน้าทริปจะพังตอนอ่านค่าเลข (เช่น NaN หรือ crash)
 * ฟังก์ชันนี้เติมค่าเริ่มต้นให้ ไม่แตะข้อมูลที่มีอยู่แล้ว
 */
export function normalizeItineraryDays(days: unknown): ItineraryDay[] {
  if (!Array.isArray(days)) return [];
  return days.map((d: any, i: number) => ({
    ...d,
    day: Number(d?.day) || i + 1,
    ...(d?.date ? { date: String(d.date) } : {}),
    stops: (Array.isArray(d?.stops) ? d.stops : []).map((s: any) => ({
      ...s,
      name: String(s?.name ?? "จุดแวะ"),
      activity: String(s?.activity ?? ""),
      stayHours: Number(s?.stayHours) || 0,
      driveToNextMins: Number(s?.driveToNextMins) || 0,
      ...(s?.arriveTime ? { arriveTime: String(s.arriveTime) } : {}),
      ...(s?.leaveTime ? { leaveTime: String(s.leaveTime) } : {}),
    })),
  }));
}

/** เติมงบที่ขาดให้ครบ (UI อ่าน `perPerson.toLocaleString()` โดยตรง) */
export function normalizeTripBudget(budget: unknown): TripBudget {
  const b = (budget ?? {}) as any;
  const lodging = Number(b.lodging) || 0;
  const fuel = Number(b.fuel) || 0;
  const food = Number(b.food) || 0;
  const total = Number(b.total) || lodging + fuel + food;
  const perPerson = Number(b.perPerson) || total;
  return {
    lodging,
    fuel,
    food,
    total,
    perPerson,
    withinBudget: b.withinBudget !== false,
  };
}

function styleLabel(key: TripRequestInput["style"]): string {
  return TRAVEL_STYLES.find((s) => s.key === key)?.label ?? "โร้ดทริปเน้นธรรมชาติ";
}

/** Local fallback itinerary (if the backend is unreachable). */
function localItinerary(req: TripRequestInput): GeneratedItinerary {
  const stops = [req.startPoint, ...req.destinations];
  const perDay = Math.max(1, Math.ceil(stops.length / req.days));
  const days: ItineraryDay[] = [];
  let idx = 0;
  for (let d = 1; d <= req.days; d++) {
    const dayStops = [];
    for (let k = 0; k < perDay && idx < stops.length; k++, idx++) {
      dayStops.push({
        name: stops[idx],
        activity: d === 1 && k === 0 ? "เริ่มต้นเดินทาง" : "สำรวจชุมชน / พักผ่อน",
        stayHours: 2 + (k % 2),
        driveToNextMins: 60 + ((idx * 25) % 90),
      });
    }
    if (dayStops.length === 0) {
      dayStops.push({ name: "พักผ่อนอิสระ", activity: "เที่ยวชมรอบที่พัก", stayHours: 3, driveToNextMins: 0 });
    }
    days.push({ day: d, stops: dayStops });
  }
  const lodging = req.nights * 500;
  const fuel = req.days * 350;
  const food = req.days * 400;
  const total = lodging + fuel + food;
  return {
    title: `ทริป ${req.destinations[0] ?? req.startPoint} ${req.days} วัน`,
    summary: `โร้ดทริปสไตล์ ${styleLabel(req.style)} เริ่มจาก ${req.startPoint}`,
    days,
    budget: { lodging, fuel, food, total, perPerson: total, withinBudget: total <= req.budgetPerPerson },
    source: "local-fallback",
  };
}

/**
 * Ask the backend to generate a road-trip itinerary from the wizard inputs.
 *
 * Always resolves — but `source` tells the caller whether the AI actually
 * produced it. On failure we still return a usable plan (the app would be
 * useless otherwise) *and* record the real reason, so the UI can badge it and
 * the diagnostics screen can show what went wrong.
 */
export async function generateTrip(
  req: TripRequestInput,
  opts?: GenerateTripOptions
): Promise<GeneratedItinerary> {
  const payload = {
    startPoint: req.startPoint,
    destinations: req.destinations,
    days: req.days,
    nights: req.nights,
    budgetPerPerson: req.budgetPerPerson,
    style: styleLabel(req.style),
    // ถ้ามีโฟลเดอร์ → backend เป็นคนเลือกจุดหมายจากข้อมูลจริงในโฟลเดอร์
    folderId: opts?.folderId ?? undefined,
  };

  const headers: Record<string, string> = {};
  if (opts?.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }

  const local = (reason: string): GeneratedItinerary => ({
    ...localItinerary(req),
    fallbackReason: reason,
  });

  try {
    const data = await aiFetch<GeneratedItinerary & { fallback?: GeneratedItinerary; error?: string }>({
      label: "trips/generate",
      path: "/trips/generate",
      method: "POST",
      headers,
      body: payload,
      timeoutMs: API_TIMEOUT_MS * 4,
      onSettled: (ok, error) => {
        if (!ok && error) toastAiError(error);
      },
    });

    if (Array.isArray(data?.days) && data?.budget) {
      return {
        ...data,
        days: normalizeItineraryDays(data.days),
        budget: normalizeTripBudget(data.budget),
        source: data.source ?? "ai",
      };
    }
    return local(data?.fallbackReason ?? "AI ตอบมาไม่ใช่ข้อมูลทริปที่ใช้ได้");
  } catch (err: any) {
    if (err instanceof AiError) {
      // The backend sends a `fallback` alongside the error — prefer it over
      // rebuilding locally, and keep the real reason either way.
      //
      // The envelope is `{error, code, requestId, fallback: {...}}` → the
      // itinerary lives one level down. Reading the top level instead used to
      // hand back an object with no `days`/`budget` at all, and the trip
      // screen then crashed on it.
      const parsed = safeParse<any>(err.body);
      const fallback =
        parsed && Array.isArray(parsed.fallback?.days)
          ? {
              ...parsed.fallback,
              days: normalizeItineraryDays(parsed.fallback.days),
              budget: normalizeTripBudget(parsed.fallback.budget),
            }
          : null;
      return {
        ...(fallback ?? localItinerary(req)),
        fallbackReason: err.message,
      };
    }
    return local(err?.message ?? "เรียก AI ไม่สำเร็จ");
  }
}

/** `AiError.body` may be a JSON string, an upstream string, or anything. */
function safeParse<T>(text: string): T | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  ระบบวางแผนทริปจริง (POST /trips/plan)
// ─────────────────────────────────────────────────────────────────────────

/** คำขอวางแผน — ต้องตรงกับ body ที่ backend อ่าน */
export interface PlanTripRequest {
  folderId?: string | null;
  days: number;
  date?: string | null;
  startTime?: string | null;
  /** จุดเริ่มต้น (ต้องมีพิกัด) */
  startPoint: TripPlanPoint;
  returnMode: "same_as_start" | "custom";
  /** จุดสิ้นสุดตอนกลับ (บังคับเมื่อ returnMode = "custom") */
  endPoint?: TripPlanPoint | null;
  /** จุดสิ้นสุดของแต่ละวัน (หลายวัน) */
  dayEndPoints?: (TripPlanPoint | null)[];
  vehicle: string;
  /** ชื่อ/รุ่นรถที่ผู้ใช้พิมพ์เอง (เช่น "Toyota Corolla Altis") — ให้ backend หาชนิดน้ำมันให้ */
  vehicleModel?: string | null;
  fuelType?: string | null;
  travelers: number;
  budgetPerPerson: number;
  style: string;
  /** จุดที่ผู้ใช้เพิ่มเองจากแผนที่ */
  extraStops?: {
    label: string;
    address?: string | null;
    coords: { lat: number; lng: number };
    price?: string | null;
    openingHours?: string | null;
    phone?: string | null;
    website?: string | null;
  }[];
  /**
   * รายการจุดที่ผู้ใช้แก้เอง (ลบ · สลับลำดับ · เพิ่ม) พร้อมวันที่
   * → เมื่อส่งมา ระบบจะยึดรายการนี้เป็นจริง ไม่ให้ AI เลือกซ้ำ
   * (ถ้าไม่ส่ง = ให้ AI เลือกตามปกติ)
   */
  selectedStops?: { id?: string; name: string; day: number }[];
  /** ราคาน้ำมันที่ผู้ใช้พิมพ์เองจากที่ปั๊ม → ชนะราคาสดเสมอ */
  fuelPriceOverride?: number | null;
  /** true = ให้ backend บันทึกลง trip_plans ด้วย */
  save?: boolean;
  /**
   * รหัสแผนเดิมที่ต้องการอัปเดตทับ (แก้แผนที่บันทึกไว้แล้ว → ยืนยันอีกครั้ง)
   * → backend จะอัปเดตแถวเดิมของผู้ใช้คนนี้ ไม่สร้างแผนซ้ำ
   */
  planId?: string | null;
}

export interface PlanTripResult {
  plan: TripPlan;
  planId: string | null;
  persisted?: boolean;
  persistReason?: string;
  source: string;
  aiUsed?: boolean;
  aiWarnings?: string[];
  droppedByAi?: string[];
  notSelected?: { id: string; name: string; type: string }[];
  folderResolved?: boolean;
  folderWarning?: string | null;
}

/**
 * วางแผนทริปจริง — คำนวณเส้นทาง/เวลา/ค่าน้ำมันทั้งหมดที่ backend
 * (ไม่แต่งตัวเลขปลอมในแอป)
 */
export async function generateTripPlan(
  req: PlanTripRequest,
  opts?: { token?: string | null }
): Promise<PlanTripResult> {
  const headers: Record<string, string> = {};
  if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;

  const data = await aiFetch<any>({
    label: "trips/plan",
    path: "/trips/plan",
    method: "POST",
    headers,
    body: {
      folderId: req.folderId ?? undefined,
      days: req.days,
      date: req.date ?? undefined,
      startTime: req.startTime ?? undefined,
      startPoint: req.startPoint,
      returnMode: req.returnMode,
      endPoint: req.endPoint ?? undefined,
      dayEndPoints: req.dayEndPoints ?? undefined,
      vehicle: req.vehicle,
      vehicleModel: req.vehicleModel ?? undefined,
      fuelType: req.fuelType ?? undefined,
      travelers: req.travelers,
      budgetPerPerson: req.budgetPerPerson,
      style: req.style,
      extraStops: req.extraStops ?? undefined,
      selectedStops: req.selectedStops ?? undefined,
      fuelPriceOverride: req.fuelPriceOverride ?? undefined,
      save: req.save ?? false,
      planId: req.planId ?? undefined,
    },
    timeoutMs: API_TIMEOUT_MS * 6,
    onSettled: (ok, error) => {
      if (!ok && error) toastAiError(error);
    },
  });

  const plan = (data?.plan ?? data) as TripPlan;
  return {
    plan,
    planId: data?.planId ?? null,
    persisted: data?.persisted,
    persistReason: data?.persistReason,
    source: data?.source ?? "planner",
    aiUsed: data?.aiUsed,
    aiWarnings: data?.aiWarnings,
    droppedByAi: data?.droppedByAi,
    notSelected: data?.notSelected,
    folderResolved: data?.folderResolved,
    folderWarning: data?.folderWarning ?? null,
  };
}

/**
 * แปลงช่องข้อมูลที่เอไaiสกัดมา → คำขอวางแผน
 * ค่าที่ยังไม่ครบจะถูกเติมด้วยค่าเริ่มต้นของระบบ (ผู้ใช้เปลี่ยนได้ในการ์ด)
 *
 * ช่วงวันที่ของแอป = `startDate` + `endDate` แต่ขา `/trips/plan` ของ backend
 * ยังรับแค่ `date` (วันเริ่ม) + `days` (จำนวนวัน) → แปลงตรงนี้ที่จุดเดียว
 */
export function planRequestFromSlots(
  slots: TripSlots,
  folderId?: string | null
): PlanTripRequest {
  const returnMode: "same_as_start" | "custom" =
    slots.returnMode === "custom" ? "custom" : "same_as_start";
  const startPoint: TripPlanPoint = slots.startPoint ?? {
    label: "จุดเริ่มต้น",
    coords: null,
  };
  const endPoint: TripPlanPoint | null =
    returnMode === "custom"
      ? slots.endPoint ?? null
      : { label: startPoint.label, address: startPoint.address, coords: startPoint.coords };

  // จำนวนวัน = ช่วงวันที่ที่ผู้ใช้เลือก (ถ้ายังไม่เลือก → 1 วัน)
  const rangeDays = tripRangeDays(slots.startDate, slots.endDate);
  const days = Math.min(TRIP_MAX_DAYS, Math.max(1, rangeDays ?? 1));

  // รถ: 2 คลาส (ส่วนตัว / สาธารณะ) → backend รู้จัก key เดิม
  const vehicleClass = vehicleClassOf(slots.vehicle);
  const vehicle =
    slots.fuelType === "electric"
      ? "ev"
      : vehicleClass === "public"
      ? "public"
      : slots.vehicle ?? "private_car";

  return {
    folderId: folderId ?? null,
    days,
    date: slots.startDate ?? null,
    startTime: slots.startTime ?? "08:00",
    startPoint,
    returnMode,
    endPoint,
    dayEndPoints: slots.dayEndPoints ?? undefined,
    vehicle,
    vehicleModel: slots.vehicleModel ?? null,
    fuelType: slots.fuelType ?? null,
    travelers: Math.max(1, Number(slots.travelers) || 1),
    budgetPerPerson: Number(slots.budgetPerPerson) || 3000,
    style: slots.style || "ท่องเที่ยวธรรมชาติและชุมชนท้องถิ่น",
    save: false,
  };
}

/** จุดใกล้เคียงที่ระบบเสนอ (ผู้ใช้ต้องกดเพิ่มเอง — ระบบไม่เพิ่มให้เงียบ ๆ) */
export interface NearbyPlace {
  id: string;
  name: string;
  address?: string | null;
  province?: string | null;
  district?: string | null;
  coordinates: { lat: number; lng: number };
  price?: string | null;
  priceUnit?: string | null;
  openingHours?: string | null;
  phone?: string | null;
  website?: string | null;
  rating?: number | null;
  distanceKm?: number | null;
  source: string;
}

export async function fetchNearbySuggestions(params: {
  near: TripPlanPoint;
  radiusKm?: number;
  limit?: number;
  type?: string | null;
  /** จุดบนเส้นทาง → วัดระยะจากเส้นทางจริงแทนระยะเป็นเส้นตรง */
  routePoints?: { lat: number; lng: number }[];
  excludeIds?: string[];
}): Promise<NearbyPlace[]> {
  const data = await aiFetch<{ places?: any[] }>({
    label: "trips/nearby",
    path: "/trips/nearby",
    method: "POST",
    body: {
      near: params.near,
      radiusKm: params.radiusKm ?? 10,
      limit: params.limit ?? 8,
      type: params.type ?? null,
      routePoints: params.routePoints ?? [],
      excludeIds: params.excludeIds ?? [],
    },
    timeoutMs: API_TIMEOUT_MS * 4,
    onSettled: (ok, error) => {
      if (!ok && error) toastAiError(error);
    },
  });
  const list = Array.isArray(data?.places) ? data.places : [];
  return list
    .filter((p: any) => p && typeof p.name === "string" && p?.coordinates)
    .map((p: any) => ({
      id: String(p.id ?? p.name),
      name: String(p.name),
      address: p.address ?? null,
      province: p.province ?? null,
      district: p.district ?? null,
      coordinates: {
        lat: Number(p.coordinates.lat),
        lng: Number(p.coordinates.lng),
      },
      price: p.price ?? null,
      priceUnit: p.priceUnit ?? null,
      openingHours: p.openingHours ?? null,
      phone: p.phone ?? null,
      website: p.website ?? null,
      rating: typeof p.rating === "number" ? p.rating : null,
      distanceKm: typeof p.distanceKm === "number" ? p.distanceKm : null,
      source: String(p.source ?? "unknown"),
    }));
}

/** ราคาน้ำมันล่าสุดที่ backend ดึงสดจากเว็บ (cache รายวันตามเวลาไทย) */
export interface FuelPriceSnapshot {
  prices: Record<string, number>;
  labels: Record<string, string>;
  fetchedAt: string;
  effectiveDate: string | null;
  effectiveDateAlt: string | null;
  source: string;
  origin: string;
  isEstimate: boolean;
  url: string | null;
  /**
   * วันที่ของราคาใน cache ("YYYY-MM-DD" เวลาไทย)
   * → ถ้าไม่ตรงกับวันไทยวันนี้ = ข้อมูลเก่า (ห้ามแสดงเป็น "ราคาวันนี้")
   */
  cacheDate?: string | null;
  /** true = ดึงราคาวันนี้ไม่สำเร็จ ใช้ค่าล่าสุดที่มีอยู่แทน */
  isStale?: boolean;
  /** ข้อความแจ้งผู้ใช้ว่าเป็นข้อมูลเก่า */
  staleNotice?: string | null;
  /** วันไทยวันนี้ ("YYYY-MM-DD") ที่ backend ใช้ตัดสินว่า cache หมดอายุหรือยัง */
  bangkokDate?: string | null;
}

export async function fetchFuelPrices(): Promise<FuelPriceSnapshot | null> {
  try {
    const data = await aiFetch<any>({
      label: "trips/fuel-price",
      path: "/trips/fuel-price",
      method: "GET",
      timeoutMs: API_TIMEOUT_MS * 2,
      onSettled: (ok, error) => {
        if (!ok && error) toastAiError(error);
      },
    });
    if (!data || typeof data !== "object" || !data.prices) return null;
    return {
      prices: data.prices ?? {},
      labels: data.labels ?? {},
      fetchedAt: String(data.fetchedAt ?? ""),
      effectiveDate: data.effectiveDate ?? null,
      effectiveDateAlt: data.effectiveDateAlt ?? null,
      source: String(data.source ?? "unknown"),
      origin: String(data.origin ?? ""),
      isEstimate: data.isEstimate === true,
      url: data.url ?? null,
      cacheDate: data.cacheDate ?? null,
      isStale: data.isStale === true,
      staleNotice: data.staleNotice ?? null,
      bangkokDate: data.bangkokDate ?? null,
    };
  } catch {
    // ราคาน้ำมันเป็นข้อมูลเสริม — ล้มเหลวไม่ทำให้ทั้งระบบล้ม
    return null;
  }
}

/** ที่พักที่ระบบเสนอ (หลายวัน) — แปลงเป็นรูปแบบที่แอปเก็บไว้กับทริป */
export function lodgingToTripLodging(l: TripPlanLodging): TripPlanLodging {
  return l;
}
