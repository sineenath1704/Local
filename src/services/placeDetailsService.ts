import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";
import { supabase } from "../lib/supabase";

/**
 * A place's own details — the facts the AI chat answers from.
 *
 * `community_places` is the ground truth: the price band, the website, the
 * phone and the opening hours of a specific place, as confirmed by whoever
 * curates it. Google's version is a starting point, not the truth — a host
 * who knows their own shop corrects it here.
 */

/** ความจุของที่พัก — ทุกช่องเป็นข้อความ เพราะคลิปมักพูดเป็นช่วง ("4-6 คน") */
export interface PlaceCapacity {
  rooms?: string | null;
  guests_per_room?: string | null;
  max_guests?: string | null;
  beds?: string | null;
}

/** The row as it exists today (null fields = the place has no value yet). */
export interface PlaceDetailsRow {
  place_name: string | null;
  phone: string | null;
  opening_hours: string | null;
  price_info: string | null;
  price_level: string | null;
  website: string | null;
  /** ความจุของที่พัก */
  capacity: PlaceCapacity | null;
  /** กติกาของสถานที่ (คอลัมน์ `house_rules`) */
  house_rules: string[] | null;
  /** โซน/พื้นที่ในสถานที่ */
  areas: string[] | null;
  /** สิ่งอำนวยความสะดวก */
  facilities: string[] | null;
}

/** What the host confirmed. Every field is optional — only what it carries is written. */
export interface PlaceDetailsInput {
  /** Google place id — the place's identity. */
  placeId: string;
  placeName: string;
  province: string;
  district?: string | null;
  subdistrict?: string | null;
  village?: string | null;
  formattedAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  googleMapsUrl?: string | null;
  /** Price tier: ฟรี / ฿ / ฿฿ / ฿฿฿ / ฿฿฿฿. */
  priceLevel?: string | null;
  website?: string | null;
  phone?: string | null;
  openingHours?: string | null;
  /** ความจุของที่พัก — ที่มาจากคลิป */
  capacity?: PlaceCapacity | null;
  /** กติกาของสถานที่ — ที่มาจากคลิป */
  rules?: string[] | null;
  /** โซน/พื้นที่ในสถานที่ — ที่มาจากคลิป */
  areas?: string[] | null;
  /** สิ่งอำนวยความสะดวก — ที่มาจากคลิป */
  facilities?: string[] | null;
}

/**
 * The four fields, and what each state means to the server:
 * a string sets it, `null` clears it, `undefined` leaves the place's own
 * value alone. The last one matters: the row may already carry the owner's
 * value, and a place we simply don't know about must not blank it.
 */
const DETAIL_KEYS = ["priceLevel", "website", "phone", "openingHours"] as const;

/**
 * The facts the clip gave us — a list or an object, so they travel as JSON.
 *
 * "Cleared" is an empty list / empty object: the server empties the column
 * instead of leaving the old value behind. An empty list from the clip means
 * "this clip said nothing about it", so it is left out entirely and the
 * value the place already carries survives.
 */
const DETAIL_JSON_KEYS = ["rules", "areas", "facilities", "capacity"] as const;

export class PlaceDetailsError extends Error {}

async function authHeaders(): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    throw new PlaceDetailsError("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง");
  }
  return {
    Authorization: `Bearer ${data.session.access_token}`,
    "Content-Type": "application/json",
  };
}

/**
 * What we already hold for a place.
 *
 * Read before the editing card opens, so it shows the place's OWN values
 * (the owner's corrections) with Google's as the fallback. A missing row is
 * normal — most places have never been stored.
 */
export async function fetchPlaceDetailsRow(placeId: string): Promise<PlaceDetailsRow | null> {
  if (!placeId.trim()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE_URL}/places/place-details`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId: placeId.trim() }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as any));
      throw new PlaceDetailsError(body?.error ?? "อ่านข้อมูลสถานที่ไม่สำเร็จ");
    }
    const json = await res.json();
    return (json?.place ?? null) as PlaceDetailsRow | null;
  } catch (e: any) {
    if (e instanceof PlaceDetailsError) throw e;
    if (e?.name === "AbortError") {
      throw new PlaceDetailsError("เซิร์ฟเวอร์ตอบช้า กรุณาลองอีกครั้ง");
    }
    throw new PlaceDetailsError(e?.message ?? "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Save the details a host confirmed.
 *
 * The price of a place belongs to the place, so this lands on the place's row
 * — keeping the owner that row already had. The AI chat reads the same row,
 * so a correction here is what the next traveller is told.
 */
export async function savePlaceDetails(input: PlaceDetailsInput): Promise<void> {
  const headers = await authHeaders();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 2);
  const body: Record<string, unknown> = {
    placeId: input.placeId,
    placeName: input.placeName,
    province: input.province,
    district: input.district ?? null,
    subdistrict: input.subdistrict ?? null,
    village: input.village ?? null,
    formattedAddress: input.formattedAddress ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    googleMapsUrl: input.googleMapsUrl ?? null,
  };
  // Only the fields we actually know travel. "Cleared" travels as "" so the
  // server empties that column; "unknown" is left out, so a value the owner
  // already set survives.
  for (const key of DETAIL_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    body[key] = value === null ? "" : value;
  }
  for (const key of DETAIL_JSON_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue; // the clip said nothing
    body[key] = value === null ? (key === "capacity" ? {} : []) : value;
  }
  try {
    const res = await fetch(`${API_BASE_URL}/places/save-place-details`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as any));
      if (res.status === 401) {
        throw new PlaceDetailsError("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง");
      }
      throw new PlaceDetailsError(body?.error ?? "บันทึกข้อมูลสถานที่ไม่สำเร็จ");
    }
  } catch (e: any) {
    if (e instanceof PlaceDetailsError) throw e;
    if (e?.name === "AbortError") {
      throw new PlaceDetailsError("เซิร์ฟเวอร์ตอบช้า กรุณาลองอีกครั้ง");
    }
    throw new PlaceDetailsError(e?.message ?? "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์");
  } finally {
    clearTimeout(timer);
  }
}
