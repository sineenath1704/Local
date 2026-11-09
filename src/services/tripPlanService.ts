import { supabase, isSupabaseConfigured } from "../lib/supabase";
import {
  ItineraryDay,
  TRAVEL_STYLES,
  TravelStyle,
  Trip,
  TripBudget,
  TripFolderPlace,
  TripPlanLodging,
  TripPlanVehicle,
} from "../data/tripsData";
import {
  normalizeItineraryDays,
  normalizeTripBudget,
} from "./tripService";

/**
 * แผนทริปที่บันทึกไว้ในระบบ (`trip_plans`)
 * =============================================================
 * ตัวสร้างแผนของ backend เขียนแผนลงตารางนี้เอง (ผูกด้วย `source_folder_id`)
 * → เปิดแอปใหม่แล้วแพลนเดิมยังอยู่ และรู้ว่ามาจากโฟลเดอร์ไหน
 *
 * อ่านผ่าน client ของแอป (anon key + session ของผู้ใช้) → RLS ของ `trip_plans`
 * บังคับให้เห็นเฉพาะแผนของตัวเอง (หรือที่แชร์) อยู่แล้ว
 */

interface TripPlanRow {
  id: string;
  creator_id: string | null;
  source_folder_id: string | null;
  plan_name: string;
  start_location: string;
  return_location: string | null;
  start_date: string | null;
  end_date: string | null;
  budget_limit: number | null;
  travel_style: string | null;
  itinerary_data: any;
  status: string | null;
  is_shared: boolean | null;
  created_at: string;
}

/** ค่าของแอป (`draft|planned|active|completed`) ← คอลัมน์ status ของ DB (`upcoming|draft|past`) */
function appStatus(row: TripPlanRow): Trip["status"] {
  const fromMeta = row.itinerary_data?.__meta?.appStatus;
  if (
    fromMeta === "draft" ||
    fromMeta === "planned" ||
    fromMeta === "active" ||
    fromMeta === "completed"
  ) {
    return fromMeta;
  }
  if (row.status === "upcoming") return "planned";
  if (row.status === "past") return "completed";
  return "draft";
}

/** สไตล์ใน DB เป็นข้อความไทย → กลับเป็น key ของแอป */
function styleKey(raw: string | null): TravelStyle {
  const label = (raw ?? "").trim();
  const hit = TRAVEL_STYLES.find((s) => s.label === label);
  if (hit) return hit.key;
  if (label === "nature" || label === "slowlife" || label === "culture" || label === "foodie") {
    return label;
  }
  return "nature";
}

/**
 * สถานที่ของโฟลเดอร์ที่ backend เก็บไว้ใน `itinerary_data.__meta.folderPlaces`
 * (รูปแบบของ backend: source/clips/community) → รูปแบบของแอป
 */
function folderPlacesFromMeta(meta: any): TripFolderPlace[] {
  const raw = meta?.folderPlaces;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p: any) => p && typeof p.name === "string" && p.name)
    .map((p: any) => ({
      name: String(p.name),
      source: p.source === "registry" ? "registry" : "clip",
      clipCount: Number(p.clips) || undefined,
      communityName: p.community ?? null,
      address: p.address ?? null,
    }));
}

/**
 * จุดในแผน (`{label, address?, coords:{lat,lng}}`) → พิกัดของแอป
 * คืน undefined ถ้าไม่มีพิกัดที่ใช้ได้ (ไม่เดาพิกัด)
 */
function coordsOf(raw: any): { lat: number; lng: number } | undefined {
  const c = raw?.coords ?? raw?.coordinates ?? null;
  if (!c) return undefined;
  const lat = Number(c.lat);
  const lng = Number(c.lng ?? c.lon ?? c.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

/** ชื่อจุดจากแผน (`{label}` / `{name}`) */
function labelOf(raw: any): string | undefined {
  const l = String(raw?.label ?? raw?.name ?? "").trim();
  return l || undefined;
}

/** ที่พักที่ระบบเสนอ (เก็บใน `itinerary_data.lodgingSuggestions`) */
function lodgingFromData(raw: any): TripPlanLodging[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l: any) => l && (l.name || l.label))
    .map((l: any) => ({
      name: String(l.name ?? l.label),
      address: l.address ?? null,
      coordinates: coordsOf(l) ?? null,
      price: typeof l.price === "number" ? l.price : null,
      priceUnit: l.priceUnit ?? null,
      priceText: l.priceText ?? null,
      distanceKm: typeof l.distanceKm === "number" ? l.distanceKm : null,
      phone: l.phone ?? null,
      website: l.website ?? null,
      rating: typeof l.rating === "number" ? l.rating : null,
      source: l.source ?? null,
    }));
}

/** รถ + ที่มาของราคาน้ำมัน */
function vehicleFromData(raw: any): TripPlanVehicle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const kmPerLitre = Number(raw.kmPerLitre);
  return {
    key: String(raw.key ?? ""),
    label: String(raw.label ?? ""),
    model: raw.model ?? null,
    kmPerLitre: Number.isFinite(kmPerLitre) ? kmPerLitre : null,
    fuelType: raw.fuelType ?? null,
    fuelPricePerLitre:
      typeof raw.fuelPricePerLitre === "number" ? raw.fuelPricePerLitre : null,
    fuelPriceSource: String(raw.fuelPriceSource ?? ""),
    fuelPriceEffectiveDate: raw.fuelPriceEffectiveDate ?? undefined,
    fuelPriceFetchedAt: raw.fuelPriceFetchedAt ?? undefined,
    fuelPriceIsEstimate: raw.fuelPriceIsEstimate === true,
    fuelPriceText: raw.fuelPriceText ?? undefined,
  };
}

/** แถวในตาราง → รูปแบบที่แอปใช้ */
export function tripPlanRowToTrip(row: TripPlanRow): Trip {
  const data = (row.itinerary_data ?? {}) as any;
  const days: ItineraryDay[] = normalizeItineraryDays(data.days);
  const meta = data.__meta ?? {};
  const destinations: string[] = Array.isArray(meta.destinations)
    ? meta.destinations
    : Array.from(
        new Set(
          days
            .flatMap((d) => d.stops ?? [])
            .map((s) => s?.name)
            .filter(Boolean) as string[]
        )
      );
  const budget: TripBudget = normalizeTripBudget(data.budget);

  // จุดเริ่ม/จุดสิ้นสุด — แผนเก็บเป็น object (มีพิกัด) ส่วนคอลัมน์เก็บแค่ชื่อ
  const startPointLabel = labelOf(data.startPoint) ?? row.start_location;
  const startPointCoords = coordsOf(data.startPoint);
  const returnMode: Trip["returnMode"] =
    (data.returnMode ?? meta.returnMode) === "custom" ? "custom" : "same_as_start";
  const endPointLabel =
    labelOf(data.endPoint) ?? labelOf(meta.endPoint) ?? row.return_location ?? undefined;
  const endPointCoords = coordsOf(data.endPoint) ?? coordsOf(meta.endPoint);

  const warnings = Array.isArray(data.warnings) ? data.warnings.map(String) : undefined;
  const assumptions = Array.isArray(data.assumptions)
    ? data.assumptions.map(String)
    : undefined;

  return {
    id: row.id,
    planId: row.id,
    title: row.plan_name,
    summary: typeof data.summary === "string" ? data.summary : "",
    status: appStatus(row),
    startPoint: startPointLabel,
    startPointCoords,
    startTime: typeof data.startTime === "string" ? data.startTime : undefined,
    destinations,
    days: days.length || Number(data.daysCount) || 1,
    nights: Math.max(0, (days.length || Number(data.daysCount) || 1) - 1),
    budgetPerPerson:
      Number(row.budget_limit) || Number(data.budgetPerPerson) || budget.perPerson || 0,
    style: styleKey(row.travel_style),
    itinerary: days,
    budget,
    sourceFolderId: row.source_folder_id ?? undefined,
    folderPlaces: folderPlacesFromMeta(meta),
    createdAt: new Date(row.created_at).getTime() || Date.now(),
    // ── ข้อมูลของแพลนที่คำนวณจริง (ต้องคืนมาให้ครบ ไม่งั้นแผนที่โหลดกลับมาไม่มีแผนที่/ตัวเลข) ──
    returnMode,
    endPoint: endPointLabel,
    endPointCoords,
    travelers: Number(data.travelers) || undefined,
    vehicle: vehicleFromData(data.vehicle ?? meta.vehicle),
    fuel: data.fuel ?? meta.fuel ?? undefined,
    lodging: lodgingFromData(data.lodgingSuggestions),
    warnings,
    assumptions,
    routeSource: typeof data.routeSource === "string" ? data.routeSource : undefined,
    routeCredit: typeof data.routeCredit === "string" ? data.routeCredit : undefined,
  };
}

/**
 * โหลดแผนทริปของผู้ใช้จาก DB
 * คืน [] ถ้าไม่ได้ตั้งค่า Supabase / ไม่มีสิทธิ์ / ยังไม่มีตาราง
 * (ผู้เรียกต้องไม่พังเมื่อผลลัพธ์ว่าง)
 */
export async function fetchMyTripPlans(limit = 50): Promise<Trip[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const { data, error } = await supabase
      .from("trip_plans")
      .select(
        "id, creator_id, source_folder_id, plan_name, start_location, return_location, start_date, end_date, budget_limit, travel_style, itinerary_data, status, is_shared, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("[tripPlanService] โหลดแผนทริปไม่สำเร็จ:", error.message);
      return [];
    }
    return ((data ?? []) as unknown as TripPlanRow[]).map(tripPlanRowToTrip);
  } catch (e: any) {
    console.warn("[tripPlanService] โหลดแผนทริปไม่สำเร็จ:", e?.message ?? e);
    return [];
  }
}

/**
 * แก้ไขแผนที่บันทึกไว้ → บันทึกกลับลง `trip_plans`
 * =============================================================
 * RLS ของ `trip_plans` เปิดให้ผู้ใช้อัปเดตแถวของตัวเอง
 * (policy "trips write own" + grant `update` ให้ `authenticated`)
 * → แอปแก้แผนเองได้ ไม่ต้องผ่าน backend
 *
 * คืน true เมื่อบันทึกสำเร็จ (ผู้เรียกต้องจัดการกรณีล้มเหลวเอง)
 */
export interface TripPlanPatch {
  /** ไทม์ไลน์ที่ผู้ใช้แก้ → เขียนทับ `itinerary_data.days` */
  itinerary?: ItineraryDay[];
  /** ข้อมูลแผนที่แก้ทั้งก้อน → merge เข้า `itinerary_data` */
  itineraryData?: Record<string, unknown>;
  /** สถานะของแอป (draft|planned|active|completed) */
  appStatus?: Trip["status"];
  planName?: string;
  startLocation?: string;
  returnLocation?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  budgetLimit?: number | null;
  travelStyle?: string | null;
}

/** สถานะของแอป → ค่าที่คอลัมน์ status ของ DB ยอมรับ (upcoming|draft|past) */
function dbStatus(appStatusValue: Trip["status"]): "upcoming" | "draft" | "past" {
  if (appStatusValue === "completed") return "past";
  if (appStatusValue === "planned" || appStatusValue === "active") return "upcoming";
  return "draft";
}

export async function updateMyTripPlan(
  planId: string,
  patch: TripPlanPatch
): Promise<boolean> {
  if (!isSupabaseConfigured || !planId) return false;
  try {
    // อ่านของเดิมก่อน → merge ไม่ให้ข้อมูลที่ไม่ได้แก้หาย
    const { data: row, error: readErr } = await supabase
      .from("trip_plans")
      .select("id, creator_id, itinerary_data")
      .eq("id", planId)
      .maybeSingle();
    if (readErr) {
      console.warn("[tripPlanService] อ่านแผนเพื่อแก้ไขไม่สำเร็จ:", readErr.message);
      return false;
    }
    if (!row) return false;

    const current = (row.itinerary_data ?? {}) as any;
    const meta = (current.__meta ?? {}) as any;
    const nextData: any = {
      ...current,
      ...(patch.itineraryData ?? {}),
    };
    if (patch.itinerary) nextData.days = patch.itinerary;
    nextData.__meta = {
      ...meta,
      ...(patch.appStatus ? { appStatus: patch.appStatus } : {}),
      editedAt: new Date().toISOString(),
    };

    const update: Record<string, unknown> = { itinerary_data: nextData };
    if (patch.planName !== undefined) update.plan_name = patch.planName;
    if (patch.startLocation !== undefined) update.start_location = patch.startLocation;
    if (patch.returnLocation !== undefined) update.return_location = patch.returnLocation;
    if (patch.startDate !== undefined) update.start_date = patch.startDate;
    if (patch.endDate !== undefined) update.end_date = patch.endDate;
    if (patch.budgetLimit !== undefined) update.budget_limit = patch.budgetLimit;
    if (patch.travelStyle !== undefined) update.travel_style = patch.travelStyle;
    if (patch.appStatus !== undefined) update.status = dbStatus(patch.appStatus);

    let query = supabase.from("trip_plans").update(update).eq("id", planId);
    // กันไปแก้แผวของคนอื่น (RLS ก็บังคับอยู่แล้ว แต่กรองซ้ำชัดกว่า)
    if (row.creator_id) query = query.eq("creator_id", row.creator_id);
    const { error } = await query;
    if (error) {
      console.warn("[tripPlanService] บันทึกการแก้ไขแผนไม่สำเร็จ:", error.message);
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn("[tripPlanService] บันทึกการแก้ไขแผนไม่สำเร็จ:", e?.message ?? e);
    return false;
  }
}

/**
 * สร้างแพลนทริปที่ผู้ใช้สร้างเอง (ไม่ผ่าน AI) → INSERT ลง `trip_plans`
 * =============================================================
 * RLS ของ `trip_plans` มี policy "trips write own" (FOR ALL) + grant `insert`
 * ให้ `authenticated` อยู่แล้ว → แอปเขียนแผนเองได้ ไม่ต้องผ่าน backend
 *
 * รูปแบบ `itinerary_data` ต้องเป็นรูปแบบเดียวกับที่ `tripPlanRowToTrip()`
 * อ่านกลับ → เปิดแอปใหม่แล้วแพลนยังครบทุกอย่าง (แผนที่/เวลา/จุดแวะ)
 *
 * คืน `planId` (uuid ของแถว) — ใส่ใน `Trip.planId` เพื่อให้การแก้ไขครั้งต่อไป
 * sync กลับลง DB ผ่าน `updateMyTripPlan` (เส้นทางเดียวกับแพลนจาก AI)
 */
export interface NewTripPlanInput {
  /** ชื่อแพลน */
  planName: string;
  /** จุดเริ่มต้น (ข้อความ) */
  startLocation: string;
  /** จุดสิ้นสุด (ข้อความ) */
  returnLocation?: string | null;
  /** โฟลเดอร์ที่มา (ถ้าสร้างจากโฟลเดอร์) */
  sourceFolderId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  budgetLimit?: number | null;
  travelStyle?: string | null;
  /** ข้อมูลแพลนทั้งก้อน (days + __meta + ...) */
  itineraryData: Record<string, unknown>;
}

/** uid ของผู้ใช้ที่ล็อกอินอยู่ (ใช้เป็น creator_id) */
async function currentUid(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function createMyTripPlan(
  input: NewTripPlanInput
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const uid = await currentUid();
  if (!uid) {
    console.warn("[tripPlanService] สร้างแพลนไม่สำเร็จ: ยังไม่ได้ล็อกอิน");
    return null;
  }

  try {
    const row = {
      creator_id: uid,
      source_folder_id: input.sourceFolderId ?? null,
      plan_name: (input.planName || "แพลนทริปของฉัน").slice(0, 100),
      start_location: input.startLocation || "จุดเริ่มต้น",
      return_location: input.returnLocation ?? null,
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      budget_limit: input.budgetLimit ?? null,
      travel_style: input.travelStyle ?? null,
      itinerary_data: input.itineraryData,
      status: "draft",
      is_shared: false,
    };

    const { data, error } = await supabase
      .from("trip_plans")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      console.warn("[tripPlanService] สร้างแพลนไม่สำเร็จ:", error.message);
      return null;
    }
    return (data as any)?.id ?? null;
  } catch (e: any) {
    console.warn("[tripPlanService] สร้างแพลนไม่สำเร็จ:", e?.message ?? e);
    return null;
  }
}
