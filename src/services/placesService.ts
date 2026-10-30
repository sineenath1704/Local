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
