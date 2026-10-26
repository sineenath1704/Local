import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { normalizeThaiName } from "../data/thaiAdmin";

/**
 * ชุมชน (หมู่บ้าน OTOP) — registry ที่อ่านอย่างเดียว (D12)
 * -------------------------------------------------------------
 * PLAN_PLACE_MATCHING.md §2.1 / §6.7
 *
 * `communities` เคยเป็น schema ที่ไม่มีใครใช้ — แอปไม่เคยอ่านมันเลย
 * แต่มันคือคำตอบของคำถาม "สถานที่นี้อยู่ชุมชนไหน" ซึ่งจำเป็นต่อ D11
 * (จับคู่ชุมชนไม่ได้ = ไม่บันทึก) และ D4 (สถานที่ → ชุมชน)
 *
 * หมายเหตุ: ตารางนี้ยังว่างอยู่จนกว่าจะรัน `seed_communities.ts`
 * → ทุกฟังก์ชันในไฟล์นี้คืนค่าว่างได้ ไม่ใช่ error
 */

export interface CommunityRow {
  id: string;
  name: string;
  region: string | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  otop_village_id?: string | null;
}

/** แถวสถานที่ของชุมชน (จาก `GET /places/community`) */
export interface CommunityPlaceRow {
  place_id: string;
  place_name: string;
  /** มีเจ้าของ = เป็นสถานที่ประกอบการที่ host ลงทะเบียนไว้ */
  owner_id?: string | null;
  community_match_level?: string | null;
  formatted_address?: string | null;
  province?: string | null;
  district?: string | null;
  subdistrict?: string | null;
  village?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_maps_url?: string | null;
  phone?: string | null;
  opening_hours?: string | null;
  /** ราคาแบบข้อความ (ที่เจ้าของ/คลิปบันทึกไว้) */
  price_info?: string | null;
  /** ระดับราคาแบบ Google (฿ / ฿฿ …) */
  price_level?: string | null;
  website?: string | null;
  rating?: number | null;
  user_ratings_total?: number | null;
  /** ที่มาของแถว — host_verified / google_places */
  source?: string | null;
  business_hours?: Record<string, { open: string; close: string }[]> | null;
  business_pricing?: Record<string, any> | null;
  [key: string]: unknown;
}

/**
 * ป้ายที่มาของข้อมูลสถานที่ (D21)
 *
 * ค่าใน `community_places.source` บอกว่าใครเป็นคนบันทึก — ไม่ใช่ว่า
 * "ค่านี้มาจาก Google หรือเจ้าของ" แบบรายช่อง แต่ก็พอให้ผู้ใช้รู้ว่า
 * เป็นข้อมูลที่คนในชุมชนยืนยันหรือข้อมูลที่ระบบดึงมาเอง
 */
export const COMMUNITY_SOURCE_LABEL: Record<string, string> = {
  host_verified: "เจ้าของยืนยัน",
  google_places: "จาก Google",
  tourist_confirmed: "ผู้ใช้ยืนยัน",
  clip_confirmed: "จากคลิป",
};

export function communitySourceLabel(source: string | null | undefined): string {
  const key = (source ?? "").trim();
  if (!key) return "จากชุมชน";
  return COMMUNITY_SOURCE_LABEL[key] ?? "จากชุมชน";
}

// `otop_village_id` มากับ add_place_matching.sql — ถ้ายังไม่รัน อ่านชุดพื้นฐานแทน
const COMMUNITY_COLUMNS = "id, name, region, province, district, subdistrict";
const COMMUNITY_COLUMNS_FULL = `${COMMUNITY_COLUMNS}, otop_village_id`;

async function readCommunities(
  apply: (q: any) => any
): Promise<CommunityRow[]> {
  if (!isSupabaseConfigured) return [];
  for (const columns of [COMMUNITY_COLUMNS_FULL, COMMUNITY_COLUMNS]) {
    const { data, error } = await apply(supabase.from("communities").select(columns).limit(400));
    if (!error) return (data ?? []) as CommunityRow[];
  }
  return [];
}

/**
 * ชุมชนที่อยู่ในตำบล/อำเภอ/จังหวัดที่ระบุ
 *
 * ใช้ตอนผู้ใช้ยืนยันสถานที่แล้ว แล้วต้องรู้ว่ามันอยู่ชุมชนไหน
 * — ถ้าเจอ 1 ชุมชน = ใช้เลย · เจอหลาย = ให้ผู้ใช้เลือก · ไม่เจอ = ไม่บันทึก (D11)
 */
export async function findCommunitiesByArea(opts: {
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
}): Promise<CommunityRow[]> {
  const sub = normalizeThaiName(opts.subdistrict);
  const dist = normalizeThaiName(opts.district);
  const prov = normalizeThaiName(opts.province);
  if (!sub && !dist) return [];

  // ① เจาะจงที่สุด: ตำบล + อำเภอ + จังหวัด
  if (sub) {
    const exact = await readCommunities((q) => {
      let query = q.eq("subdistrict", sub);
      if (dist) query = query.eq("district", dist);
      if (prov) query = query.eq("province", prov);
      return query;
    });
    if (exact.length > 0) return exact;
  }

  // ② กว้างขึ้น: ทั้งอำเภอ → กรองชื่อเอง (กันกรณีชื่อในฐานเขียนไม่ตรง)
  if (dist) {
    const wide = await readCommunities((q) => {
      let query = q.eq("district", dist);
      if (prov) query = query.eq("province", prov);
      return query;
    });
    const filtered = wide.filter((r) => {
      if (sub && normalizeThaiName(r.subdistrict) !== sub) return false;
      if (dist && normalizeThaiName(r.district) !== dist) return false;
      if (prov && normalizeThaiName(r.province) !== prov) return false;
      return true;
    });
    if (filtered.length > 0) return filtered;
    if (wide.length > 0) return wide;
  }

  return [];
}

/**
 * ชุมชนจากเลขทะเบียน OTOP (CDD Village_ID)
 *
 * `communities.otop_village_id` คือเลขทะเบียนเดียวกับที่ host ยืนยันตอนสมัคร
 * → ผูก host เข้ากับชุมชนได้โดยไม่ต้องเดาจากชื่อ (ชื่อหมู่บ้านซ้ำกันเยอะ)
 *
 * คืน null ได้ — แปลว่ายังไม่มีชุมชนนี้ในทะเบียน (หรือยังไม่ได้ seed)
 */
export async function findCommunityByOtopVillage(
  villageId: string | null | undefined
): Promise<CommunityRow | null> {
  const id = (villageId ?? "").trim();
  if (!id || !isSupabaseConfigured) return null;
  for (const columns of [COMMUNITY_COLUMNS_FULL, COMMUNITY_COLUMNS]) {
    const { data, error } = await supabase
      .from("communities")
      .select(columns)
      .eq("otop_village_id", id)
      .limit(1);
    if (!error) {
      const rows = (data ?? []) as unknown as CommunityRow[];
      return rows[0] ?? null;
    }
  }
  return null;
}

/** ชุมชนจาก id ที่รู้แน่ (users.community_id) */
export async function findCommunityById(
  communityId: string | null | undefined
): Promise<CommunityRow | null> {
  const id = (communityId ?? "").trim();
  if (!id || !isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from("communities")
    .select(COMMUNITY_COLUMNS)
    .eq("id", id)
    .limit(1);
  if (error) return null;
  const rows = (data ?? []) as unknown as CommunityRow[];
  return rows[0] ?? null;
}

/** สถานที่ทั้งหมดของชุมชน (จาก backend) — อ่านผ่าน API เพราะ RLS ไม่ให้ anon อ่าน */
export async function fetchCommunityPlaces(
  communityId: string
): Promise<{ community: CommunityRow | null; places: CommunityPlaceRow[]; partial: boolean }> {
  const empty = { community: null, places: [], partial: false };
  if (!communityId.trim()) return empty;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 2);
  try {
    const res = await fetch(
      `${API_BASE_URL}/places/community?communityId=${encodeURIComponent(communityId.trim())}`,
      { signal: controller.signal }
    );
    if (!res.ok) return empty;
    const json = await res.json();
    return {
      community: (json?.community ?? null) as CommunityRow | null,
      places: Array.isArray(json?.places) ? (json.places as CommunityPlaceRow[]) : [],
      partial: Boolean(json?.partial),
    };
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * สถานที่ที่ "ชุมชนลงทะเบียนไว้" = แถวที่มีเจ้าของ (host ลงทะเบียนไว้)
 *
 * นี่คือปลายทางของ D2 — candidate จาก Google จะถูกเทียบกับ id ของแถวนี้
 * ไม่ใช่กับชื่อ ไม่ใช่กับระยะทาง
 */
export async function registeredPlaceOf(
  communityId: string
): Promise<CommunityPlaceRow | null> {
  const { places } = await fetchCommunityPlaces(communityId);
  const owned = places.find((p) => Boolean(p.owner_id));
  return owned ?? null;
}

/**
 * สถานที่ที่ยืนยันแล้วในอำเภอหนึ่ง ๆ (ชั้นหมุดระดับสถานที่ — PLAN §7.2)
 *
 * อ่านจาก backend (RLS ไม่ให้ anon อ่านตารางผ่าน client ได้โดยตรง)
 * → คืน [] ได้ถ้ายังไม่มีข้อมูล ไม่ใช่ error
 */
export async function fetchDistrictPlaces(
  province: string | null | undefined,
  district: string | null | undefined
): Promise<CommunityPlaceRow[]> {
  const dis = (district ?? "").trim();
  if (!dis) return [];
  const params = new URLSearchParams({ district: dis });
  const prov = (province ?? "").trim();
  if (prov) params.set("province", prov);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 2);
  try {
    const res = await fetch(`${API_BASE_URL}/places/district?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.places) ? (json.places as CommunityPlaceRow[]) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
