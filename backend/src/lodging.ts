/**
 * หาที่พักใกล้เส้นทาง (สำหรับแผนหลายวัน)
 * ============================================================
 * ทำไมต้องมีโมดูลนี้
 *   · `community_places` **ไม่มีคอลัมน์ประเภทสถานที่** → หาที่พักจากทะเบียน
 *     ต้องดูคำในชื่อ (บ้านพัก / โรงแรม / รีสอร์ท / คริสตัล / สตาง / โฮมสเตย์)
 *   · `googleMaps.ts` **ห้ามแตะ** (ใช้ร่วมกับสรุปคลิปอยู่แล้ว) → ต้องเขียน
 *     ตัวเรียก Places Legacy ของที่พักแยกไว้ที่นี่
 *
 * ข้อมูลที่คืนให้ผู้ใช้ตัดสินใจ (ตามที่ผู้ใช้ต้องการ):
 *   ราคา · ระยะจากจุดสุดท้ายของวัน · เบอร์โทร · เว็บ · เรตติง
 *   (ระบบเสนอเท่านั้น — ผู้ใช้ต้องกดเลือกเอง)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { config, isPlacesConfigured } from "./config";
import { haversineKm } from "./routing";
import type { LodgingSuggestion } from "./tripPlanner";
import { normalizePlaceName } from "./folderContext";

/** คำที่บอกว่าเป็นที่พัก (ไทย + อังกฤษ) */
const LODGING_KEYWORDS = [
  "บ้านพัก",
  "ที่พัก",
  "โรงแรม",
  "รีสอร์ท",
  "รีสอร์ท",
  "คริสตัล",
  "สตาง",
  "สถานที่พัก",
  "แคมป์ปิ้ง",
  "แคมป์",
  "โฮมสเตย์",
  "เกสต์เฮาส์",
  "ฮอเทล",
  "โรงแรม",
  "hotel",
  "resort",
  "hostel",
  "homestay",
  "guesthouse",
  "guest house",
  "lodge",
  "lodging",
];

/** ระยะที่ยังเรียกว่า "ใกล้" (กม.) */
const DEFAULT_RADIUS_KM = 20;
const REGISTRY_LIMIT = 200;
const REQUEST_TIMEOUT_MS = 4000;

/** แปลง "1,200" / "฿1,200" / "1200 บาท/คืน" → ตัวเลข */
export function parsePriceNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /(\d[\d,]*)/.exec(String(text));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** ชื่อดูเป็นที่พักไหม */
export function looksLikeLodging(name: string | null | undefined): boolean {
  const n = String(name ?? "").toLowerCase();
  if (!n.trim()) return false;
  return LODGING_KEYWORDS.some((k) => n.includes(k.toLowerCase()));
}

/** แถวในทะเบียน (ชุดคอลัมน์ที่ใช้) */
interface RegistryLodgingRow {
  place_name?: string | null;
  formatted_address?: string | null;
  province?: string | null;
  district?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  opening_hours?: string | null;
  price_info?: string | null;
  rating?: number | null;
  website?: string | null;
  business_pricing?: {
    weekday?: { amount?: string; currency?: string } | null;
    weekend?: { amount?: string; currency?: string } | null;
    unit?: string | null;
  } | null;
}

/** เทียบจังหวัด/อำเภอแบบยืดหยุ่น (ข้อมูลคนละที่เขียนคนละแบบ) */
function sameArea(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizePlaceName(a ?? "");
  const y = normalizePlaceName(b ?? "");
  if (!x || !y) return true; // ไม่ระบุ = ไม่กรอง
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * ที่พักจากทะเบียน `community_places`
 * (ไม่มีคอลัมน์ประเภท → ดูคำในชื่อ)
 */
async function fromRegistry(
  admin: SupabaseClient,
  near: { lat: number; lng: number },
  opts: { province?: string | null; district?: string | null; limit?: number }
): Promise<LodgingSuggestion[]> {
  try {
    const { data, error } = await admin
      .from("community_places")
      .select(
        "place_name, formatted_address, province, district, latitude, longitude, phone, opening_hours, price_info, rating, website, business_pricing"
      )
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .limit(REGISTRY_LIMIT);

    if (error) {
      console.warn("[lodging] อ่านทะเบียนที่พักไม่สำเร็จ:", error.message);
      return [];
    }

    const rows = (data ?? []) as unknown as RegistryLodgingRow[];
    const out: LodgingSuggestion[] = [];

    for (const row of rows) {
      const name = (row.place_name ?? "").trim();
      if (!looksLikeLodging(name)) continue;
      if (!sameArea(row.province, opts.province)) continue;
      if (!sameArea(row.district, opts.district)) continue;

      const lat = Number(row.latitude);
      const lng = Number(row.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const distanceKm = haversineKm(
        { lat: near.lat, lng: near.lng },
        { lat, lng }
      );
      if (distanceKm > DEFAULT_RADIUS_KM) continue;

      const pricing = row.business_pricing ?? null;
      const priceText =
        pricing?.weekday?.amount ??
        pricing?.weekend?.amount ??
        row.price_info ??
        null;
      const priceUnit = pricing?.unit ?? (priceText ? "คืน" : null);

      out.push({
        name,
        address: row.formatted_address ?? null,
        coordinates: { lat, lng },
        price: parsePriceNumber(priceText),
        priceUnit,
        priceText,
        distanceKm: Math.round(distanceKm * 10) / 10,
        phone: row.phone ?? null,
        website: row.website ?? null,
        rating: typeof row.rating === "number" ? row.rating : null,
        source: "registry",
      });
    }

    out.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    return out.slice(0, opts.limit ?? 5);
  } catch (e: any) {
    console.warn("[lodging] ทะเบียนที่พักล้ม:", e?.message ?? e);
    return [];
  }
}

/** ผลจาก Google Places Legacy (nearbysearch type=lodging) */
interface GoogleLodging {
  name?: string;
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  rating?: number;
  price_level?: number;
  place_id?: string;
  website?: string;
  phone?: string;
}

/** ระดับราคาของ Google (0-4) → ข้อความ */
const PRICE_LEVEL_TEXT = ["ฟรี", "ถูก", "ปานกลาง", "แพง", "แพงมาก"];

/**
 * ที่พักจาก Google Places Legacy
 * ล้มเงียบ ๆ — ไม่มี key หรือยิงไม่ผ่าน → คืน [] (ไม่ทำให้ทั้งระบบล้ม)
 */
async function fromGoogle(
  near: { lat: number; lng: number },
  opts: { radiusKm?: number; limit?: number }
): Promise<LodgingSuggestion[]> {
  if (!isPlacesConfigured()) return [];
  const key = config.places.googleKey;
  if (!key) return [];

  const radius = Math.min(
    Math.round((opts.radiusKm ?? DEFAULT_RADIUS_KM) * 1000),
    50000
  );
  const url =
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json" +
    `?location=${near.lat},${near.lng}` +
    `&radius=${radius}` +
    "&type=lodging" +
    "&language=th" +
    `&key=${encodeURIComponent(key)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const json: any = await res.json();
    if (json?.status !== "OK" || !Array.isArray(json.results)) return [];

    const out: LodgingSuggestion[] = [];
    for (const r of (json.results as GoogleLodging[]).slice(0, opts.limit ?? 5)) {
      const lat = Number(r.geometry?.location?.lat);
      const lng = Number(r.geometry?.location?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      out.push({
        name: (r.name ?? "").trim(),
        address: r.formatted_address ?? null,
        coordinates: { lat, lng },
        price: null,
        priceUnit: null,
        priceText:
          typeof r.price_level === "number"
            ? PRICE_LEVEL_TEXT[r.price_level] ?? null
            : null,
        distanceKm:
          Math.round(
            haversineKm({ lat: near.lat, lng: near.lng }, { lat, lng }) * 10
          ) / 10,
        phone: r.phone ?? null,
        website: r.website ?? null,
        rating: typeof r.rating === "number" ? r.rating : null,
        source: "google",
      });
    }
    return out;
  } catch (e: any) {
    console.warn("[lodging] Google ล้ม:", e?.message ?? e);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * รวมที่พักจากทั้งสองแหล่ง
 * -------------------------------------------------------------
 * ทะเบียนมาก่อน (ราคาจริงจากเจ้าของ) · Google เติมจุดที่ทะเบียนไม่มี
 */
export async function findLodging(
  admin: SupabaseClient | null,
  near: { lat: number; lng: number },
  opts: {
    province?: string | null;
    district?: string | null;
    limit?: number;
    radiusKm?: number;
    includeGoogle?: boolean;
  } = {}
): Promise<LodgingSuggestion[]> {
  const limit = opts.limit ?? 5;
  const registry = admin
    ? await fromRegistry(admin, near, {
        province: opts.province ?? null,
        district: opts.district ?? null,
        limit,
      })
    : [];

  const google =
    opts.includeGoogle === false
      ? []
      : await fromGoogle(near, { radiusKm: opts.radiusKm, limit });

  const seen = new Set(registry.map((x) => x.name.toLowerCase()));
  for (const g of google) {
    if (seen.has(g.name.toLowerCase())) continue;
    registry.push(g);
  }

  registry.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
  return registry.slice(0, limit);
}
