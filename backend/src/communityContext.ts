/**
 * บริบท "ชุมชน" สำหรับ AI แชท
 * -------------------------------------------------------------
 * PLAN_PLACE_MATCHING.md §7.3 / §7.4 — D22 + D23
 *
 * เฟส 1-3 ทำให้ "สถานที่ในชุมชน" มีที่มาจริงแล้ว (community_places.community_id)
 * แต่ AI แชทยังไม่เคยได้ยิดข้อมูลนั้น — มันรู้แค่ "สถานที่ที่คนถามถึง"
 *
 * ไฟล์นี้เป็นตัวกลางที่อ่านข้อมูลชุมชนแล้วแปลงเป็นบล็อกข้อความสำหรับ prompt
 * โดย **ไม่แตะ tripPrompt.ts** (ไฟล์นั้นมีการแก้ค้างอยู่ — PLAN §8)
 * → บล็อกที่ได้ถูกต่อท้าย system prompt ที่ buildChatSystemPrompt คืนมา
 *
 * สองอย่างที่ไฟล์นี้ทำ:
 *   ① retrieved_context   = สถานที่ที่ยืนยันแล้วของชุมชนนั้น (cap 20)
 *   ② nearby_communities  = ชุมชนอื่นในจังหวัดเดียวกัน เรียงตามจำนวน
 *                            สถานที่ที่ยืนยันแล้ว (D23 — ไม่คำนวณระยะทาง
 *                            เพราะชุมชนไม่มีพิกัดที่เชื่อถือได้)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { THAI_PROVINCES } from "./routes/places";

export interface CommunitySummary {
  id: string;
  name: string | null;
  region: string | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
}

/** แถวสถานที่ของชุมชน — เฉพาะคอลัมน์ที่ prompt ใช้จริง */
export interface CommunityPlaceSummary {
  place_id: string | null;
  place_name: string | null;
  formatted_address: string | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  village: string | null;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string | null;
  phone: string | null;
  opening_hours: string | null;
  price_info: string | null;
  price_level?: string | null;
  website: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  source: string | null;
  owner_id: string | null;
  community_match_level?: string | null;
  business_hours?: Record<string, { open: string; close: string }[]> | null;
  business_pricing?: Record<string, any> | null;
}

export interface CommunityBundle {
  community: CommunitySummary | null;
  places: CommunityPlaceSummary[];
  /**
   * true = อ่านได้ไม่ครบ (คอลัมน์ของ migration ยังไม่ถูกรัน)
   * → บล็อกที่ส่งให้โมเดลจะมีข้อมูลน้อยกว่าจริง แต่ไม่ควรหยุดแชท
   */
  partial: boolean;
}

export interface NearbyCommunity {
  id: string;
  name: string | null;
  /** จำนวนสถานที่ที่ยืนยันแล้วในชุมชนนี้ */
  placeCount: number;
}

const COMMUNITY_COLUMNS = "id, name, region, province, district, subdistrict";

/** คอลัมน์เต็ม — รวมของ migration หลายไฟล์ (ถ้ายังไม่รันจะ error) */
const PLACE_COLUMNS_FULL =
  "id, place_id, place_name, formatted_address, province, district, subdistrict, village, " +
  "latitude, longitude, google_maps_url, phone, opening_hours, price_info, price_level, " +
  "website, rating, user_ratings_total, source, owner_id, recorded_by, " +
  "community_match_level, business_hours, business_pricing, updated_at, " +
  "capacity, house_rules, areas, facilities";

/** คอลัมน์พื้นฐาน — มีตั้งแต่ create_community_places.sql (ปลอดภัยที่สุด) */
const PLACE_COLUMNS_BASE =
  "id, place_id, place_name, formatted_address, province, district, subdistrict, village, " +
  "latitude, longitude, google_maps_url, phone, opening_hours, price_info, website, " +
  "rating, user_ratings_total, source, owner_id, updated_at";

/** จำนวนสถานที่สูงสุดต่อชุมชนที่ส่งให้โมเดล (แผน §7.1 ใช้ cap เดียวกัน) */
export const COMMUNITY_PLACE_CAP = 20;

/** จำนวนชุมชนใกล้เคียงที่ส่งไปพร้อมกัน */
const NEARBY_CAP = 5;

/**
 * อ่านชุมชน + สถานที่ที่ยืนยันแล้วของชุมชนนั้น
 *
 * ทนกับ migration ที่ยังไม่รัน: ถ้าคอลัมน์ของ migration หาย → ถอยไปอ่าน
 * ชุดพื้นฐาน; ถ้า `community_id` ยังไม่มีในตาราง → คืนชุมชนเปล่า + partial
 */
export async function loadCommunityBundle(
  admin: SupabaseClient,
  communityId: string | null | undefined
): Promise<CommunityBundle> {
  const id = (communityId ?? "").trim();
  if (!id) return { community: null, places: [], partial: false };

  const { data: community, error: communityErr } = await admin
    .from("communities")
    .select(COMMUNITY_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (communityErr) {
    console.warn("[communityContext] อ่านชุมชนไม่สำเร็จ:", communityErr.message);
    return { community: null, places: [], partial: true };
  }
  if (!community) return { community: null, places: [], partial: false };

  const readPlaces = async (columns: string) =>
    admin
      .from("community_places")
      .select(columns)
      .eq("community_id", id)
      .order("updated_at", { ascending: false })
      .limit(COMMUNITY_PLACE_CAP);

  const { data: rows, error } = await readPlaces(PLACE_COLUMNS_FULL);
  if (!error) {
    return {
      community: community as CommunitySummary,
      places: ((rows ?? []) as unknown as CommunityPlaceSummary[]),
      partial: false,
    };
  }

  // คอลัมน์ของ migration ที่ยังไม่รัน → อ่านชุดพื้นฐานแทน
  const { data: fallback, error: fallbackErr } = await readPlaces(PLACE_COLUMNS_BASE);
  if (fallbackErr) {
    // `community_id` เองยังไม่มี → ชุมชนนี้ยังไม่มีสถานที่ที่ผูกไว้ให้อ่าน
    console.warn("[communityContext] อ่านสถานที่ของชุมชนไม่ได้:", fallbackErr.message);
    return { community: community as CommunitySummary, places: [], partial: true };
  }
  return {
    community: community as CommunitySummary,
    places: ((fallback ?? []) as unknown as CommunityPlaceSummary[]),
    partial: true,
  };
}

/**
 * ชุมชนอื่นในจังหวัดเดียวกัน เรียงตามจำนวนสถานที่ที่ยืนยันแล้ว (D23)
 *
 * ไม่คำนวณระยะทาง — ชุมชนไม่มี lat/lng ที่เชื่อถือได้ (PLAN §7.4)
 * และชุมชนที่ยังไม่มีสถานที่เลยไม่มีอะไรให้แนะนำ → ตัดทิ้ง
 */
export async function loadNearbyCommunities(
  admin: SupabaseClient,
  province: string | null | undefined,
  excludeCommunityId: string | null | undefined,
  limit: number = NEARBY_CAP
): Promise<NearbyCommunity[]> {
  const prov = (province ?? "").trim();
  if (!prov) return [];

  const { data: communities, error } = await admin
    .from("communities")
    .select("id, name")
    .eq("province", prov)
    .limit(300);
  if (error || !communities?.length) {
    if (error) console.warn("[communityContext] อ่านชุมชนจังหวัดเดียวกันไม่สำเร็จ:", error.message);
    return [];
  }

  const exclude = (excludeCommunityId ?? "").trim();
  const ids = communities.map((c) => c.id).filter((id) => id !== exclude);
  if (ids.length === 0) return [];

  const { data: rows, error: placesErr } = await admin
    .from("community_places")
    .select("community_id")
    .in("community_id", ids);
  if (placesErr) {
    // ยังไม่มี community_id → นับไม่ได้ → ไม่ส่งรายการที่เดา
    console.warn("[communityContext] นับสถานที่รายชุมชนไม่สำเร็จ:", placesErr.message);
    return [];
  }

  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    const cid = (row as any)?.community_id;
    if (!cid) continue;
    counts.set(cid, (counts.get(cid) ?? 0) + 1);
  }

  return communities
    .filter((c) => c.id !== exclude && (counts.get(c.id) ?? 0) > 0)
    .map((c) => ({ id: c.id, name: c.name ?? null, placeCount: counts.get(c.id) ?? 0 }))
    .sort((a, b) => b.placeCount - a.placeCount || (a.name ?? "").localeCompare(b.name ?? "", "th"))
    .slice(0, limit);
}

/** ตัดชื่อไทยให้เทียบกันได้ (ลบช่องว่าง/วรรคตอน/ขีด) */
function normalizeThai(value: string | null | undefined): string {
  return (value ?? "").replace(/[\s.,\-/()]+/g, "").trim();
}

/** จังหวัดที่โผล่ในข้อความ (ใช้จำกัดขอบเขตตอนหาชุมชนด้วยชื่อ) */
export function detectProvinceInText(text: string | null | undefined): string | null {
  const combined = text ?? "";
  if (!combined) return null;
  for (const prov of THAI_PROVINCES) {
    if (combined.includes(prov)) return prov;
  }
  return null;
}

/**
 * หาชุมชนจากชื่อที่ผู้ใช้พิมพ์ (D22 — tourist ที่ยังไม่รู้ community_id)
 *
 * จำกัดขอบเขตด้วยจังหวัดก่อนเสมอ — ชุมชนทั้งประเทศมีชื่อซ้ำกันเยอะ
 * ถ้าไม่รู้จังหวัด → ไม่เดา (คืน null)
 */
export async function resolveCommunityByName(
  admin: SupabaseClient,
  text: string | null | undefined
): Promise<CommunitySummary | null> {
  const province = detectProvinceInText(text);
  if (!province) return null;

  const { data, error } = await admin
    .from("communities")
    .select(COMMUNITY_COLUMNS)
    .eq("province", province)
    .limit(500);
  if (error || !data?.length) {
    if (error) console.warn("[communityContext] อ่านชุมชนตามจังหวัดไม่สำเร็จ:", error.message);
    return null;
  }

  const needle = normalizeThai(text);
  if (!needle) return null;

  // ชื่อที่ยาวที่สุดที่โผล่ในข้อความ = ชุมชนที่เจาะจงที่สุด
  const hits = (data as CommunitySummary[])
    .filter((c) => {
      const key = normalizeThai(c.name);
      return key.length >= 4 && needle.includes(key);
    })
    .sort((a, b) => normalizeThai(b.name).length - normalizeThai(a.name).length);

  return hits[0] ?? null;
}

/**
 * แปลงบริบทชุมชนเป็นบล็อกข้อความสำหรับ system prompt
 *
 * ไม่แตะ tripPrompt.ts → บล็อกนี้จะถูกต่อท้าย prompt ที่ buildChatSystemPrompt คืนมา
 */
export function formatCommunityContext(
  bundle: CommunityBundle,
  nearby: NearbyCommunity[],
  mode: "host" | "tourist"
): string {
  if (!bundle.community && bundle.places.length === 0 && nearby.length === 0) return "";

  const lines: string[] = [];
  const c = bundle.community;

  if (c) {
    const area = [c.subdistrict && `ต.${c.subdistrict}`, c.district && `อ.${c.district}`, c.province && `จ.${c.province}`]
      .filter(Boolean)
      .join(" ");
    lines.push(`ชุมชน: ${c.name ?? "ไม่ทราบชื่อ"}${area ? ` (${area})` : ""}`);
  }

  if (bundle.places.length > 0) {
    lines.push(`สถานที่ที่ยืนยันแล้วในชุมชนนี้ (${bundle.places.length} แห่ง):`);
    bundle.places.forEach((p, i) => {
      const bits: string[] = [];
      if (p.price_info) bits.push(`ราคา: ${p.price_info}`);
      if (p.price_level) bits.push(`ระดับราคา: ${p.price_level}`);
      if (p.opening_hours) bits.push(`เปิด: ${p.opening_hours}`);
      if (p.phone) bits.push(`โทร: ${p.phone}`);
      if (p.website) bits.push(`เว็บ: ${p.website}`);
      if (p.formatted_address) bits.push(`ที่อยู่: ${p.formatted_address}`);
      lines.push(`${i + 1}. ${p.place_name ?? "ไม่ทราบชื่อ"}${bits.length ? ` — ${bits.join(" • ")}` : ""}`);
    });
  } else if (c) {
    lines.push("ยังไม่มีสถานที่ที่ยืนยันแล้วในชุมชนนี้");
  }

  lines.push("");
  lines.push(
    mode === "host"
      ? '* ถามได้ทั้งเรื่อง "ของฉัน" (บล็อกข้อมูลธุรกิจของคุณ) และ "ทุกที่ในหมู่บ้าน" (รายการข้างบน)'
      : '* เมื่อผู้ใช้ถามเกี่ยวกับ "ที่นี่" "ในหมู่บ้านนี้" หรือ "ทุกที่ในชุมชน" ให้ตอบจากรายการข้างบนก่อน'
  );
  lines.push("* ห้ามแต่งข้อมูลที่ไม่มีในบล็อกนี้ — ถ้าไม่มี ให้บอกตรง ๆ ว่ายังไม่มีข้อมูล");

  let block = `
[ข้อมูลชุมชนจากระบบ (retrieved_context — ใช้เป็นแหล่งข้อมูลหลัก)]:
${lines.join("\n")}`;

  if (nearby.length > 0) {
    block += `

[ชุมชนอื่นในจังหวัดเดียวกัน (nearby_communities — เรียงตามจำนวนสถานที่ที่ยืนยันแล้ว)]:
${nearby.map((n, i) => `${i + 1}. ${n.name ?? "ไม่ทราบชื่อ"} (มีสถานที่ที่ยืนยันแล้ว ${n.placeCount} แห่ง)`).join("\n")}

* ใช้เป็นทางเลือกเมื่อผู้ใช้ถามว่ามีที่อื่นในจังหวัดนี้ไหม — ห้ามแต่งสถานทะในชุมชนที่ไม่ได้อยู่ในรายการ`;
  }

  if (bundle.partial) {
    block += `

* (ระบบยังอ่านข้อมูลบางส่วนของชุมชนไม่ได้ เช่น ราคา/เวลาเปิดที่ยืนยันไว้ — ถ้าผู้ใช้ถามและไม่มีข้อมูล ให้บอกว่ายังไม่มีในระบบ)`;
  }

  return block;
}
