import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";
import type { PlaceCandidate } from "./placeTypes";

export type { PlaceCandidate };

/**
 * Google Places verification (via our backend). Called only when offline +
 * the Local `places` store can't resolve a specific place. Returns multiple
 * candidates — the UI lets the user choose; never auto-pick.
 *
 * `PlaceCandidate` นิยามไว้ที่ `placeTypes.ts` (บ้านเดียวกับ `MatchLevel`
 * และ `PlaceResolution`) เพื่อไม่ให้มีชนิดข้อมูลซ้ำสองชุด
 */

export interface VerifyPlacesResult {
  configured: boolean; // false when the backend has no Google key
  candidates: PlaceCandidate[];
}

export interface PlaceDetailsResult {
  configured: boolean;
  place: PlaceCandidate | null;
}

export async function verifyPlaceOnGoogle(input: {
  placeName: string;
  community?: string | null;
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
  /**
   * true = กรองจริงตามขอบเขต (ไม่เหลือก็คืนรายการว่าง)
   * ใช้ตอน "ค้นใหม่ในชุมชน" — default false เพื่อไม่ให้ผู้เรียกเดิมได้ผลเปลี่ยน
   */
  strict?: boolean;
  /** ระดับที่กรอง — ตำบล (ค่าเริ่มต้น) หรืออำเภอ (ปุ่ม "ค้นกว้างขึ้น") */
  scopeLevel?: "subdistrict" | "district";
}): Promise<VerifyPlacesResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 3);
  try {
    const res = await fetch(`${API_BASE_URL}/places/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(input),
    });
    if (!res.ok) return { configured: false, candidates: [] };
    const data = await res.json();
    return {
      configured: Boolean(data?.configured),
      candidates: Array.isArray(data?.candidates) ? data.candidates : [],
    };
  } catch {
    return { configured: false, candidates: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the full record for ONE place — phone, opening hours, website, rating.
 *
 * Called only AFTER the user ticks a candidate, so we spend a single
 * billable Places Details call per confirmed place.
 */
export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetailsResult> {
  if (!placeId) return { configured: false, place: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 3);
  try {
    const res = await fetch(`${API_BASE_URL}/places/details`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ placeId }),
    });
    if (!res.ok) return { configured: false, place: null };
    const data = await res.json();
    return {
      configured: Boolean(data?.configured),
      place: data?.place ?? null,
    };
  } catch {
    return { configured: false, place: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * URL ของรูปสถานที่ ที่เอาไปใช้โดยตรงได้ (เช่นใส่ `<Image source={{ uri }} />`)
 *
 * backend คืน path สัมพัทธ์ (`/places/photo?ref=…`) เพราะมันไม่รู้ public URL
 * ของตัวเอง — ที่นี่จึงต่อด้วย API_BASE_URL ให้เป็น URL เต็ม
 *
 * รูปมาจาก route ของ backend (ไม่ใช่ Google โดยตรง) เพราะ API key ของ
 * Google เป็น server-only — ถ้าให้แอปยิงเอง key จะหลุดไปกับไบนารี
 */
export function placePhotoUrl(photoUrl?: string | null): string | null {
  const raw = (photoUrl ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${API_BASE_URL}${raw}`;
  return null;
}

/**
 * พิกัดที่หาได้จากลิงก์/ชื่อสถานที่
 */
export interface ResolvedCoords {
  lat: number;
  lng: number;
  /** ชื่อที่ backend หามาให้ (ถ้ามี) */
  label?: string;
  /** ที่มาของพิกัด: ในลิงก์ / ลิงก์ที่กางแล้ว / Google Places */
  source?: "url" | "redirect" | "places";
}

/**
 * หาพิกัดจากลิงก์ Google Maps (หรือชื่อ/ที่อยู่ที่พิมพ์เอง)
 * -------------------------------------------------------------
 * เรียก backend เพราะสองอย่างที่แอปทำเองไม่ได้
 *   · ลิงก์สั้น `maps.app.goo.gl/…` — React Native ตาม redirect แล้วไม่เห็น
 *     URL ปลายทาง → ต้องให้เซิร์ฟเวอร์กางให้
 *   · ลิงก์ที่มีแต่ชื่อสถานที่ — ต้องค้น Google Places
 *     (คีย์ของ Google เป็น server-only → แอปยิงเองไม่ได้)
 *
 * คืน null เมื่อหาไม่ได้ (ไม่ throw — ผู้เรียกต้องแยกได้ว่า "ไม่มีพิกัด")
 */
export async function resolvePlaceCoords(input: {
  url?: string | null;
  text?: string | null;
}): Promise<ResolvedCoords | null> {
  const url = (input.url ?? "").trim();
  const text = (input.text ?? "").trim();
  if (!url && !text) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 3);
  try {
    const res = await fetch(`${API_BASE_URL}/places/resolve-coords`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        url: url || undefined,
        text: text || undefined,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.ok) return null;
    const lat = Number(data.lat);
    const lng = Number(data.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat,
      lng,
      label: typeof data.label === "string" ? data.label : undefined,
      source: data.source,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
