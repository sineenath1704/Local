import { supabase, isSupabaseConfigured } from "../lib/supabase";
import {
  ItineraryDay,
  TRAVEL_STYLES,
  TravelStyle,
  Trip,
  TripBudget,
  TripFolderPlace,
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

  return {
    id: row.id,
    planId: row.id,
    title: row.plan_name,
    summary: typeof data.summary === "string" ? data.summary : "",
    status: appStatus(row),
    startPoint: row.start_location,
    destinations,
    days: days.length || Number(data.daysCount) || 1,
    nights: Math.max(0, (days.length || Number(data.daysCount) || 1) - 1),
    budgetPerPerson: Number(row.budget_limit) || budget.perPerson || 0,
    style: styleKey(row.travel_style),
    itinerary: days,
    budget,
    sourceFolderId: row.source_folder_id ?? undefined,
    folderPlaces: folderPlacesFromMeta(meta),
    createdAt: new Date(row.created_at).getTime() || Date.now(),
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
